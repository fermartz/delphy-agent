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
| Component library | **shadcn/ui** | Same as Astra Tauri build |
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

MCP server configs live in SQLite (table `mcp_servers`, see Storage). Each entry:

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

The bridge is the one nontrivial Rust component. It exists because the TS MCP SDK can't spawn child processes directly from a webview.

Responsibilities:
- `spawn_mcp_server(config)` Tauri command — launches the configured command, returns a `server_handle_id`
- For each running server, emit Tauri events with stdout lines as they arrive
- Tauri command `send_mcp_stdin(server_handle_id, line)` — writes to the child's stdin
- Cleanup on app shutdown — SIGTERM all children, then SIGKILL after a grace period

The TS MCP client uses a custom `Transport` implementation that wraps these Tauri commands and events, so the rest of the SDK is unaware.

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

When estimated token usage approaches the compaction threshold (default 75% of the active model's context window):

1. **Head protected.** System prompt + first `N` messages (default `N=2`) are never compacted.
2. **Tail kept by token budget**, not message count (default `tail_token_budget=8000`). Walk from the newest message backwards, accumulating tokens until the budget is hit.
3. **Middle compressed** by sending the middle slice to the auxiliary client with a fixed `[CONTEXT COMPACTION — REFERENCE ONLY]` preamble that instructs the model to treat the summary as background, not new instructions. Output structure: `Resolved / Pending / Active Task / Remaining Work`.
4. **Iterative refinement.** Each compaction passes the previous summary in, asking the auxiliary model to update it rather than write a new one. Avoids drift across multiple compactions.
5. **Anti-thrashing.** If the last two compactions each saved less than 10% of tokens, skip — we're churning rather than condensing.
6. **Failure cooldown.** If a compaction LLM call fails, wait 10 minutes before retrying. Fall back to dropping the oldest tool results.

A focused compaction (`/compact <focus>`) lets the user steer the summary toward a particular topic — useful when the conversation pivots and old detail is no longer relevant.

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

Themes are JSON files validated by Zod. Built-in themes are bundled and statically imported; user themes are read from `~/.config/delphy-agent/themes/*.json` via a Rust file-watcher command. The loader merges both sources into an in-memory registry, then injects one `<style>` element per theme containing `[data-theme="<id>"]` + `[data-theme="<id>"].dark` rule blocks. Active theme is switched by setting `data-theme` on `<html>` and toggling the `.dark` class.

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

1. **Secret store choice.** Stronghold vs. OS keychain (`tauri-plugin-keyring`) vs. encrypted SQLite column. Lean toward Stronghold for cross-platform consistency, but it's heavier.
2. **Session resumption across backends.** Claude Code and Codex have their own resume primitives; for direct-API, we replay messages. Should "switch backend mid-session" replay the conversation into the new backend (best effort), warn the user, or start fresh? Default: warn + start fresh, with an explicit "copy context" action.
3. **Streaming protocol from Rust to webview.** Tauri events are simple but unordered under load. If we see ordering issues with high-frequency token streams, switch to a single per-process channel with sequence numbers.
4. **Approval flow UX.** Inline in the chat stream or modal? Affects how `approval_request` events are surfaced.
5. **MCP server lifecycle.** Per-session (spawn on session start, kill on close) or app-lifetime (spawn at app start, reuse across sessions)? Per-session is safer; app-lifetime is faster. Lean app-lifetime with explicit "restart MCP server" action.
6. **Multi-window or single-window.** Single window is simpler for v1. Multi-window (one per session) is a nice-to-have but not required.
