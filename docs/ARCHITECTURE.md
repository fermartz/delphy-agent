# Architecture

This document describes how Delphy Agent is built: the process model, the tech stack, the internal component shape, and the contracts between layers.

For *why* the app exists, see `VISION.md`. For external-facing contracts (plugin format, theme file format, etc.) see `SPEC.md` and `THEMES.md`.

---

## Process model

Delphy Agent runs as three kinds of processes:

```
┌─────────────────────────────────────────────────────────────┐
│  Tauri main process (Rust)                                  │
│  - Window, tray, menus, notifications                       │
│  - Spawns and supervises subprocesses                       │
│  - Owns the file system and SQLite                          │
│  - Exposes Tauri commands to the webview                    │
└─────────────────────────────────────────────────────────────┘
            ▲                              ▲
            │ Tauri IPC                    │ stdio + signals
            ▼                              ▼
┌─────────────────────────┐    ┌──────────────────────────────┐
│  Webview (Chromium)     │    │  Subprocess children          │
│  - React UI             │    │  - `claude` (Claude Code)     │
│  - Agent core (TS)      │    │  - `codex` exec --json        │
│  - MCP client (TS)      │    │  - MCP stdio servers          │
│  - Direct-API calls     │    │                              │
│    via Vercel AI SDK    │    │  Spawned and proxied         │
└─────────────────────────┘    │  by Rust                     │
                               └──────────────────────────────┘
```

**No Node sidecar.** The agent core (provider routing, session logic, MCP client, Vercel AI SDK calls) runs inside the webview as TypeScript. The Rust process is responsible for everything the webview can't safely do on its own: spawning binaries, reading/writing arbitrary files, persistent storage, OS integration.

---

## Stack

| Layer | Tech | Notes |
|-------|------|-------|
| Shell | **Tauri v2** | Rust, native webview, ~10MB base bundle |
| Frontend framework | **React 18 + TypeScript** | |
| Build tool | **Vite** | Fast dev server, ESM, matches Tauri's expectations |
| Styling | **Tailwind v4** | Same as Astra Tauri build |
| Component library | **shadcn/ui** | Same as Astra Tauri build. Installed 2026-05-27 (chrome port): `button`, `dialog`, `select`, `radio-group`, `dropdown-menu`. Paired with **`lucide-react`** for icons (added via shadcn's Nova preset). |
| State | **Zustand** | Lightweight, fits chat/session shape; avoid Redux unless we need its devtools/middleware |
| Direct-API LLM access | **Vercel AI SDK v5 (`ai` + `@ai-sdk/anthropic` + `@ai-sdk/openai` + `@ai-sdk/google`)** | Unified streaming, tool calls, Responses API support |
| Claude Code | **`@anthropic-ai/claude-agent-sdk`** | TS, async-generator API, runtime model/MCP swap, `canUseTool` permission callback |
| Codex | **Spawn `codex exec --json`** | Subprocess + JSONL parsing; richer than the Codex SDK as of May 2026 |
| MCP client | **`@modelcontextprotocol/sdk`** (TS) | Used by the direct-API path; Claude Code and Codex consume MCP natively |
| Validation | **Zod v3** | Tool schemas, theme JSON, MCP config, settings shape |
| Persistent storage | **`tauri-plugin-sql` (SQLite)** | Sessions, messages, MCP configs |
| App preferences | **`tauri-plugin-store`** | Selected theme, color mode, default backend, window state |
| Secrets | **`tauri-plugin-stronghold`** *(tentative)* | API keys, OAuth tokens — encrypted at rest |
| Notifications | **`tauri-plugin-notification`** | Desktop notifications for background events |
| Auto-updater | **`tauri-plugin-updater`** | |
| Linting / formatting | **Biome** | Single tool, faster than ESLint+Prettier |
| Test (TS) | **Vitest** | |
| Test (Rust) | **`cargo test`** | |
| Package manager | **pnpm** | |

Versions are pinned at install time and documented in package.json / Cargo.toml. This table records the *choice*, not the *current version*.

---

## Repo layout

```
delphy-agent/
├── docs/                              # Source-of-truth docs (this file lives here)
├── .hermes/                           # Plans + reviews (see BLUEPRINT.md)
├── memory/                            # Memory artifacts (MEMORY.md, map, tasks)
├── src/                               # Webview: React + agent core (TypeScript)
│   ├── App.tsx
│   ├── main.tsx
│   ├── components/                    # UI components (chat, picker, settings, etc.)
│   │   └── ui/                        # shadcn primitives
│   ├── core/                          # Agent core — pure TS, no React imports
│   │   ├── adapters/                  # One file per backend kind
│   │   │   ├── claude-code.ts
│   │   │   ├── codex.ts
│   │   │   └── direct-api.ts          # Loads ProviderProfiles from providers/
│   │   ├── providers/                 # ProviderProfile modules (anthropic, openai, google, kimi, ...)
│   │   ├── llm/
│   │   │   └── auxiliary.ts           # Cheap-model client for compaction / titles / search
│   │   ├── mcp/                       # MCP client + Rust bridge wrapper
│   │   ├── prompts/                   # Three-tier system prompt builder
│   │   ├── session/                   # Session manager, persistence glue
│   │   │   └── compactor.ts           # Head/middle/tail context compaction
│   │   ├── storage/                   # SQLite + Tauri Store wrappers
│   │   └── types.ts                   # Adapter + event types
│   ├── themes/
│   │   └── builtin/                   # Built-in theme JSONs (see THEMES.md)
│   ├── hooks/
│   ├── lib/                           # UI utilities only — domain logic goes in core/
│   └── pages/                         # Route-level views
├── src-tauri/                         # Tauri main process (Rust)
│   ├── src/
│   │   ├── main.rs
│   │   ├── lib.rs
│   │   ├── commands/                  # Tauri commands invokable from webview
│   │   ├── subprocess/                # Spawn + stream claude/codex
│   │   └── mcp_bridge/                # Spawn MCP stdio servers, proxy stdin/stdout
│   ├── Cargo.toml
│   └── tauri.conf.json
├── BLUEPRINT.md                       # Workflow / process guide
└── package.json
```

**Rule of thumb:** if a module is imported by a React component, it lives in `src/` (TS). If it spawns a process or touches the file system directly, it lives in `src-tauri/` (Rust) and is reached via a Tauri command.

---

## The backend adapter pattern

Every supported backend — agent CLI or direct API — implements the same interface. The UI does not branch on backend kind; it asks the active adapter for a session and consumes a normalized event stream.

### Adapter interface (sketch)

```typescript
type BackendKind = "agent-cli" | "direct-api";

interface BackendAdapter {
  readonly id: string;          // e.g. "claude-code", "codex", "claude-api", "gemini-api"
  readonly kind: BackendKind;
  readonly label: string;       // UI label

  // Lifecycle
  start(opts: SessionOptions): Promise<Session>;
}

interface Session {
  readonly id: string;
  sendMessage(text: string, opts?: SendOptions): Promise<void>;
  events: AsyncIterable<AgentEvent>;
  interrupt(): Promise<void>;
  close(): Promise<void>;
}

type AgentEvent =
  | { type: "text"; delta: string }
  | { type: "thinking"; delta: string }
  | { type: "tool_call"; id: string; name: string; input: unknown }
  | { type: "tool_result"; id: string; output: unknown; isError?: boolean }
  | { type: "approval_request"; id: string; action: string; payload: unknown }
  | { type: "usage"; inputTokens: number; outputTokens: number }
  | { type: "error"; error: Error }
  | { type: "done"; reason: "complete" | "interrupted" | "error" | "max_turns" };
```

### What each adapter does

**`claude-code.ts`** — wraps `@anthropic-ai/claude-agent-sdk`:
- Constructs a `query({...})` with model, permission mode, MCP servers
- Maps SDK message types to `AgentEvent`s
- Forwards `canUseTool` calls to the UI as `approval_request` events
- Calls `q.setModel()` / `q.setMcpServers()` when settings change mid-session
- `interrupt()` → `q.interrupt()`

**`codex.ts`** — wraps a Rust-spawned `codex exec --json` subprocess:
- Asks Rust to spawn the process via a Tauri command; receives a process handle ID
- Subscribes to a Tauri event channel that delivers JSONL lines from stdout
- Parses each line and emits a normalized `AgentEvent`
- Maps Codex item types (`agent_message`, `reasoning`, `command_execution`, `file_change`, `mcp_tool_call`, `web_search`, `plan_update`) to our event types
- `interrupt()` → asks Rust to send SIGTERM

**`direct-api.ts`** — wraps Vercel AI SDK v5:
- Switches on `id` to pick the right provider (`anthropic`, `openai`, `google`, OpenAI-compatible endpoints like Kimi/Groq/etc.)
- Uses `streamText({ model, messages, tools, ... })` and translates streaming chunks into `AgentEvent`s
- Tool list is composed from connected MCP servers (see MCP section)
- API keys are pulled from secret store via a Tauri command; never live in the React state

### Adapter registry

A registry in `src/core/adapters/index.ts` maps adapter IDs to factory functions:

```typescript
const ADAPTERS = {
  "claude-code": createClaudeCodeAdapter,
  "codex":       createCodexAdapter,
  "claude-api":  () => createDirectApiAdapter("anthropic"),
  "openai-api":  () => createDirectApiAdapter("openai"),
  "gemini-api":  () => createDirectApiAdapter("google"),
  "kimi-api":    () => createDirectApiAdapter("openai-compat", { baseUrl: "..." }),
} as const;
```

Adding a new direct-API provider = one line. Adding a new agent CLI = one adapter file.

---

## MCP plugin system

MCP is the unified plugin format across all backends. A single configured MCP server should work whether the user is running Claude Code, Codex, or a direct-API session.

### Plugin config

MCP server configs are persisted via `tauri-plugin-store` under the `mcp_servers` key in `settings.json` (interim implementation until BACKLOG #4 ships SQLite — see `docs/DECISIONS.md` 2026-05-28 entry). The store layer (`src/core/mcp/store.ts`) handles Zod validation, default seeding, and CRUD; the migration to SQLite will be a module swap. Each entry:

```typescript
interface McpServerConfig {
  id: string;                 // unique slug
  name: string;               // display name
  enabled: boolean;
  transport: "stdio" | "http" | "sse";
  command?: string;           // for stdio
  args?: string[];            // for stdio
  env?: Record<string, string>; // for stdio
  url?: string;               // for http / sse
  headers?: Record<string, string>; // for http / sse
  scopes?: string[];          // optional, future
}
```

### How each backend gets MCP

| Backend | Mechanism |
|---------|-----------|
| **Claude Code** | Pass `mcpServers` option to `query()` from the Agent SDK |
| **Codex** | Write configs to a temp JSON file, pass via `codex exec --mcp-config <file>` |
| **Direct API** | MCP TS client connects in the webview. For stdio servers, Rust spawns the process and proxies stdin/stdout over Tauri events (the "MCP stdio bridge") |

### MCP stdio bridge (Rust)

The bridge is the one nontrivial Rust component. It exists because the TS MCP SDK can't spawn child processes directly from a webview. Slice A of BACKLOG #6 (shipped 2026-05-27) wired the foundation; slices B + C build on it.

Responsibilities (shipped):
- `spawn_mcp_server(config)` Tauri command — launches the configured `tokio::process::Command` child with piped stdin/stdout/stderr, spawns background tasks that read stdout + stderr line-by-line and emit per-handle Tauri events, returns the config's `id` as the handle. Lives in `src-tauri/src/mcp_bridge.rs`.
- For each running server, per-handle Tauri events `mcp:<handle>:stdout` and `mcp:<handle>:stderr` carry `{ line: String }` payloads. Topic isolation gives ordering for free (one emitter per topic); no sequence numbers needed at MCP message rates — see `docs/DECISIONS.md` 2026-05-27 entry for the streaming-protocol decision.
- `send_mcp_stdin(handle, line)` Tauri command — writes `line + '\n'` to the child's stdin.
- `stop_mcp_server(handle)` Tauri command — async; SIGTERM → 2-second `tokio::time::timeout(child.wait())` → SIGKILL-fallback. Used by future slice C's restart-server action.
- Cleanup on app shutdown — **best-effort synchronous SIGKILL** of each managed child by raw `pid` (Unix: `libc::kill`; Windows: no-op + log, deferred). Tauri's `RunEvent::Exit` hook is synchronous + late in shutdown with no clean place to await per-child teardown — this is an honest limit, not the SIGTERM + grace pattern initially considered. See the same DECISIONS.md entry for the full rationale + acknowledged limits + stale-process recovery being deferred to slice C.

The TS MCP client uses a custom `Transport` implementation (`src/core/mcp/tauri-transport.ts`) that wraps these Tauri commands and events to satisfy the SDK's `Transport` interface, so the rest of the SDK is unaware. The `McpManager` singleton in `src/core/mcp/manager.ts` owns the lifetime of configured servers: spawn at app boot, connect a `Client` over `TauriTransport`, call `client.connect(transport)` (which auto-runs the MCP initialize handshake), call `client.listTools()`, and surface the result. Per-server failures are captured and reported in the Settings modal's read-only "MCP servers" section without blocking chat. `init()` is idempotent across concurrent + repeat callers via a shared in-flight promise — important for React Strict Mode.

Slice B (shipped 2026-05-28) wires `mcpManager.getAllTools()` into `streamText({ tools })` via a `buildToolSet()` helper that maps each MCP tool to an AI SDK `tool({ needsApproval: true, execute: ... })`. The approval flow is a per-turn multi-streamText loop: when `finishReason === "tool-calls"` with pending approvals, the session awaits user verdicts, appends `ToolApprovalResponse[]` to the messages array, and calls `streamText` again. `mcpManager.callTool(namespacedName, args)` executes approved tool calls with a 30-second timeout. `APPROVAL_CYCLE_CAP = 5` limits chained tool calls per user turn. See `docs/DECISIONS.md` 2026-05-28 entry for the full design + alternatives considered. Slice C (shipped 2026-05-28) replaced the hardcoded `configs.ts` with user-managed config persistence via `tauri-plugin-store` + a full CRUD UI in Settings (add/edit/remove/restart/toggle) + `${secret:key}` resolution against the OS keychain at boot time + inline API key rejection at save time. Non-stdio transports are preserved in the store but shown as unsupported; see BACKLOG #9 for HTTP/SSE.

---

## IPC: Tauri commands

The webview talks to Rust via Tauri's `invoke` API. Commands are grouped by domain:

- **subprocess**: `spawn_codex(args, env)`, `spawn_claude_cli(args, env)`, `send_signal(pid, signal)`, `kill_process(pid)`
- **mcp_bridge**: `spawn_mcp_server(config)`, `send_mcp_stdin(handle, data)`, `stop_mcp_server(handle)`
- **secrets**: `get_secret(key)`, `set_secret(key, value)`, `delete_secret(key)` — backed by Stronghold or OS keychain
- **fs_user**: `read_user_themes()`, `write_user_theme(filename, json)` — sandboxed to the user theme directory
- **storage**: thin pass-through to `tauri-plugin-sql` and `tauri-plugin-store` (mostly used directly from TS)
- **window**: tray show/hide, focus, etc.

Each child process spawned by Rust streams stdout to the webview via Tauri events on channels like `subprocess:<handle_id>:stdout` and `subprocess:<handle_id>:stderr`.

---

## Storage layout

### SQLite (via `tauri-plugin-sql`)

Used for anything we query, filter, or join.

```sql
-- Conversations
sessions(
  id TEXT PRIMARY KEY,
  backend_id TEXT NOT NULL,
  title TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  archived INTEGER DEFAULT 0
);

messages(
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,             -- ordering within a session
  role TEXT NOT NULL,                -- "user" | "assistant" | "system" | "tool"
  content TEXT NOT NULL,             -- JSON-serialized blocks
  created_at INTEGER NOT NULL,
  UNIQUE(session_id, seq)
);

-- Full-text search index over messages (FTS5). Kept in sync via triggers.
-- The CJK trigram variant is deferred until a real user need surfaces.
CREATE VIRTUAL TABLE messages_fts USING fts5(
  content,
  content='messages',
  content_rowid='rowid'
);

CREATE TRIGGER messages_ai AFTER INSERT ON messages BEGIN
  INSERT INTO messages_fts(rowid, content) VALUES (new.rowid, new.content);
END;
CREATE TRIGGER messages_ad AFTER DELETE ON messages BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, content) VALUES('delete', old.rowid, old.content);
END;
CREATE TRIGGER messages_au AFTER UPDATE ON messages BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, content) VALUES('delete', old.rowid, old.content);
  INSERT INTO messages_fts(rowid, content) VALUES (new.rowid, new.content);
END;

-- Backend configs (auth, defaults). Secrets stay out — they live in Stronghold.
backend_configs(
  id TEXT PRIMARY KEY,
  backend_id TEXT NOT NULL,
  settings TEXT NOT NULL              -- JSON
);

-- MCP servers (see "Plugin config" above)
mcp_servers(
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  enabled INTEGER NOT NULL,
  transport TEXT NOT NULL,
  config TEXT NOT NULL                -- JSON: command/args/env/url/headers/etc.
);
```

### Tauri Store (key/value)

Used for simple app preferences where queries are unnecessary.

- `selected_theme` — current theme ID
- `color_mode` — `"light" | "dark" | "system"`
- `default_backend` — adapter ID to start with on launch
- `window_state` — last position, size

### Secret store

API keys, OAuth tokens, and any other credential material live in a separate, encrypted store (Stronghold tentatively — to confirm during scaffolding). Never in SQLite, never in Tauri Store, never in React state for longer than the lifetime of a single request.

---

## Sessions: prompts and compaction

Direct-API mode runs the agent loop in-process and must manage its own context window. (Claude Code and Codex compact themselves; nothing in this section applies to them.) The strategy is the standard head/middle/tail compaction pattern used across agent-hub implementations.

### Three-tier system prompt

The system prompt is built once per session and **must not mutate mid-session** — that's the prompt-cache discipline that makes everything else efficient. It is composed of three slices joined with `\n\n`:

| Slice | Mutable? | Contains |
|-------|----------|----------|
| `stable` | Never within a session | Identity, tool guidance, formatting rules — the parts that benefit most from caching |
| `context` | Rebuilt only on compaction | Conversation summary (when present), MCP toolset descriptions, user-edited persona |
| `volatile` | Reserved | For future per-turn hook outputs. Unused in v1 |

Mutating `stable` from settings ends the current session; a fresh one starts on the next turn. Mid-session mutation is rejected.

### Auxiliary model tier

Compaction, session-title generation, and search-helper LLM calls all route through a separate **auxiliary client** that uses a cheap, fast model. The user picks both Main and Auxiliary in settings. Default Auxiliary: Claude Haiku or Gemini Flash, depending on which providers are configured.

```typescript
interface AuxiliaryClient {
  call(
    task: "compression" | "title_generation" | "search_helper",
    input: AuxiliaryInput,
  ): Promise<string>;
}
```

Each task can pin its own model / max_tokens / temperature. Premium tokens are reserved for the user-visible turn.

### Head / middle / tail compaction

**Where compaction lives.** Within a session, compaction mutates the `messages: ModelMessage[]` array on `DirectApiSession`, not the three-tier system prompt's `context` slot. The system prompt is immutable mid-session per the prompt-cache discipline rule above; the messages array is allowed to change every turn. The three-tier `context` slot is reserved for cross-session content (e.g., a summary of the prior session, loaded at session-resume time from SQLite once persistence ships).

**B.1 — shipped manually via `/compact`:**

1. **Head protected.** First `headSize` messages (default `4`) are never compacted.
2. **Tail kept by token budget**, not message count (default `tailTokenBudget=8000`). Walk from the newest message backwards, accumulating per-message token estimates (`chars/3.5`, same estimator as the chat path) until the budget is hit. The boundary becomes the start of tail.
3. **Middle compressed** by sending `[<prior summary if any>, ...new middle messages]` plus an optional focus line to the auxiliary client. The auxiliary's response is wrapped as a single `assistant`-role message with the sentinel prefix `[Earlier conversation summary, generated for token economy]`. The resulting array shape is `[...head, summaryMessage, ...tail]`.
4. **Iterative refinement.** On re-compaction, the prior summary at position `middle[0]` (the position left by the previous compaction) is detected via the sentinel prefix and folded into the new summarization prompt. Prevents drift across multiple passes.
5. **Focused compaction.** `/compact <focus>` lets the user steer the summary toward a particular topic — useful when the conversation pivots and old detail is no longer relevant. The focus text is appended to the auxiliary's prompt as `Focus the summary on: <focus>`.

**B.2 — shipped:**

6. **Automatic threshold trigger.** When estimated token usage crosses `AUTO_COMPACT_THRESHOLD` (default 85% of the model's context window) after appending the user message, compaction fires before `streamText` starts. The user sees a `system_message` event ("Compacting older turns…") before the auxiliary call and a result banner ("Auto-compacted: N → M, ~X tokens saved.") after.
7. **Anti-thrashing.** If the most recent compaction saved less than `ANTI_THRASHING_MIN_SAVED_RATIO` (default 10%) of tokens, the next auto-trigger is skipped. Prevents churn when there's no productive compaction available. Manual `/compact` is exempt from anti-thrashing.
8. **Failure handling.** On auxiliary failure, the error is caught, a failure `system_message` is emitted, and the chat turn proceeds with the un-compacted messages array. No dedicated cooldown state — the single-check-per-`sendMessage` design naturally prevents in-turn retries, and the next typed message re-evaluates the trigger from scratch.

**AbortController lifecycle.** `DirectApiSession.currentAbort` is created at the top of `sendMessage` (before the auto-trigger check) and reused by both auto-compaction's auxiliary call and the subsequent `streamText`. `interrupt()` cancels both with one `abort()` call. The shared signal is threaded through `compactMessages({ signal })` → `AuxiliaryClient.complete({ signal })` → `generateText({ abortSignal })`.

**Event surface.** Auto-compaction status surfaces via a dedicated `system_message` AgentEvent variant (added in this slice). Routed by `App.tsx` to a `system` chat item — distinct from `text` (assistant-streaming) and `runtime-error`. Manual `/compact` continues to surface its result via the slash-command dispatcher's existing system chat-item path; the two paths converge on the same renderer.

### Token estimation

We use a cheap character-based heuristic, not a real tokenizer, to stay light on dependencies (principle #8). Per-provider-family multipliers:

| Family | Heuristic |
|--------|-----------|
| Anthropic | `chars / 3.5` |
| OpenAI | `chars / 4.0` |
| Google (Gemini) | `chars / 4.5` |

If observed drift becomes a problem in practice, a per-adapter tokenizer can be swapped in without changing the compaction logic.

---

## Theming

See `docs/THEMES.md` for the full theme system (file format, runtime loader, validation). The architectural shape in one paragraph:

Themes are JSON files validated by Zod. Built-in themes are bundled and statically imported from `src/themes/builtin/*.json`; user themes are read from `app_data_dir()/themes/*.json` via the Rust Tauri command `list_user_themes` (the literal `~/.config/...` path in earlier drafts of `docs/THEMES.md` is superseded — see `docs/DECISIONS.md`). A `notify`-crate-spawned file watcher running in the Tauri setup hook emits a `themes-changed` event on any FS change to a `*.json` file in that directory; the TS-side subscriber debounces 200 ms then re-loads + re-injects + re-applies — the picker updates live without an app restart. The loader merges both sources into an in-memory registry, then injects a single `<style id="delphy-themes">` element holding `[data-theme="<id>"]` + `[data-theme="<id>"].dark` rule blocks for every loaded theme. Active theme is switched by setting `data-theme` on `<html>` and toggling the `.dark` class; "system" color mode reads `matchMedia("(prefers-color-scheme: dark)")` and reacts to OS changes. Tailwind v4's `@theme inline` directive (in `src/index.css`) maps Tailwind utility tokens (`bg-background`, `text-foreground`, …) onto the CSS variables driven by the active theme — no shadcn dependency is required.

---

## Language split

| Concern | Lives in | Reason |
|---------|----------|--------|
| React UI | TS | |
| Agent core (adapters, event normalization, session manager) | TS | Vercel AI SDK and Claude Agent SDK are TS-native |
| MCP client | TS | Official MCP TS SDK |
| Zod schemas | TS | Shared across UI and core |
| Spawning `claude` / `codex` | Rust | Webview can't spawn processes safely |
| MCP stdio bridge | Rust | Same reason |
| File watcher for user themes | Rust | Native fs APIs |
| Secret storage | Rust | Stronghold / OS keychain |
| SQLite glue | Rust (plugin), consumed from TS | `tauri-plugin-sql` does this |
| Tray, menus, notifications, auto-updater | Rust | Tauri plugins |

**Target ratio:** ~70% TS, ~30% Rust. The Rust is mostly subprocess and IPC plumbing, not deep business logic.

---

## What we explicitly do NOT do

Each one is a code path we are *not* writing this time. For carry-forward patterns we **are** taking from Astra (atomic writes, layered timeouts, resilient retry, audit logging, provider quirks), see [`LESSONS-FROM-ASTRA.md`](./LESSONS-FROM-ASTRA.md).

- **No Ink TUI.** UI is a webview, not a terminal redraw loop.
- **No xterm.js / embedded terminal.** We are not wrapping a terminal in a window.
- **No node-pty.** No PTY in the app at all.
- **No bundled Node runtime.** The agent core runs in the webview's V8.
- **No custom OpenAI Responses API SSE handler.** Vercel AI SDK v5 covers it; Codex CLI owns its own backend.
- **No custom OAuth flows for Codex or Claude.** The CLIs/SDKs own their auth.
- **No journey-stage system prompt branching.** That was AstraNova-specific. System prompts here are per-backend defaults the user can edit, not domain-shaped.

---

## Open questions

These are decisions we should make before or during scaffolding. Decisions already made live in `docs/DECISIONS.md`.

1. **Secret store choice.** ~~Stronghold vs. OS keychain (`tauri-plugin-keyring`) vs. encrypted SQLite column. Lean toward Stronghold for cross-platform consistency, but it's heavier.~~ **CLOSED 2026-05-26** — OS keychain via `keyring` crate. See `docs/DECISIONS.md`.
2. **Session resumption across backends.** Claude Code and Codex have their own resume primitives; for direct-API, we replay messages. Should "switch backend mid-session" replay the conversation into the new backend (best effort), warn the user, or start fresh? Default: warn + start fresh, with an explicit "copy context" action.
3. ~~**Streaming protocol from Rust to webview.** Tauri events are simple but unordered under load. If we see ordering issues with high-frequency token streams, switch to a single per-process channel with sequence numbers.~~ **CLOSED 2026-05-27** — per-handle Tauri events with topic isolation (`mcp:<handle>:stdout|stderr`), no sequence numbers. Justified by MCP message rates being far below the threshold the seq-number upgrade was reserved for. See `docs/DECISIONS.md` 2026-05-27 MCP stdio bridge entry.
4. ~~**Approval flow UX.** Inline in the chat stream or modal? Affects how `approval_request` events are surfaced. (Slice B of BACKLOG #6 forces this.)~~ **CLOSED 2026-05-28** — inline in the chat stream, always-ask approval policy. See `docs/DECISIONS.md` 2026-05-28 MCP slice B entry.
5. ~~**MCP server lifecycle.** Per-session (spawn on session start, kill on close) or app-lifetime (spawn at app start, reuse across sessions)? Per-session is safer; app-lifetime is faster. Lean app-lifetime with explicit "restart MCP server" action.~~ **CLOSED 2026-05-27** — app-lifetime with best-effort synchronous kill on `RunEvent::Exit`; the SIGTERM → 2s grace → SIGKILL pattern lives on the `stop_mcp_server` Tauri command instead. See `docs/DECISIONS.md` 2026-05-27 MCP stdio bridge entry.
6. **Multi-window or single-window.** Single window is simpler for v1. Multi-window (one per session) is a nice-to-have but not required.
