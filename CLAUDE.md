# CLAUDE.md

Delphy Agent is an open, desktop-first **agent hub** built with Tauri v2 + React + TypeScript. It wraps Claude Code, Codex, and direct LLM APIs (Claude, Gemini, OpenAI, Kimi) behind a single adapter interface; plugins are MCP servers.

**Why this product exists (strategic framing).** Delphy Agent serves a dual purpose: it is a genuinely useful standalone multi-model agent hub *and* the universal distribution channel for the maintainer's Delphy @identity registry (delphy.network). Without it, reaching the long tail of model surfaces (ChatGPT, Kimi, Gemini, DeepSeek) requires building and maintaining N custom connectors forever; with it, one install gives any user any model + Delphy MCP preinstalled + every other MCP server they want. This duality is non-negotiable — the standalone product must be useful even to users who don't care about Delphy, and Delphy MCP ships as default-installed, not an opt-in plugin. See `docs/DECISIONS.md` 2026-05-27 "Delphy Agent is dual-purpose" for the full rationale and constraints this locks in.

**Current state (high-level — `memory/MEMORY.md` is the authoritative living snapshot; keep it current and treat it as source of truth over this paragraph).** Tauri v2 + React 19 + TS + Tailwind v4 + shadcn + Biome + Vitest. A **multi-provider** direct-API hub via Vercel AI SDK v6 + per-provider `ProviderProfile` — 8 providers shipped (natives `anthropic`/`openai`/`google`/`xai` + first-class OpenAI-compatible `openrouter`/`kimi`/`deepseek`/`groq` + a generic Custom OpenAI-compatible profile). Real token streaming, three-tier system prompt, auto-compaction + `/compact` + `/status`. Secret store via OS keychain. **SQLite** session persistence + resume + built-in `update_memory` tool. **MCP fully wired** — Rust stdio bridge + tool/approval flow + CRUD UI + fail-fast on child exit. Theme system (6 built-ins). Tabbed Settings (Providers/Models/Plugins/Appearance). Echo adapter = boot fallback + test fixture. The chat UI is decomposed: `App.tsx` is a ~450-line shell composing focused hooks (`src/hooks/use-{session,mcp-servers,providers,themes,chat-scroll}.ts`) + presentational components (`src/components/{app-header,chat-stream,chat-message,composer,boot-banner,toast}.tsx`) + a pure event reducer (`src/core/chat/items-reducer.ts`); the five non-chat surfaces are `React.memo`-wrapped so streaming re-renders only the chat. Latest shipped: BACKLOG #21 App.tsx decomposition (`ca454d2` + docs, 2026-06-08; behavior-preserving, 10 increments). Prior: BACKLOG #12.C first-class OpenAI-compatible providers (`5ceea31`, 2026-06-02). See `memory/delphy-agent-tasks.md` for the live backlog and `docs/DECISIONS.md` for the decision log.

## Read these first (in order)

1. **`memory/MEMORY.md`** — always-loaded index. Current state, pointers to all source-of-truth docs, paths to reference repos.
2. **`BLUEPRINT.md`** — the workflow you must follow (plan → build → review → fix → verify → approve), file naming, memory-artifact maintenance protocol.
3. **`docs/VISION.md`** — what Delphy Agent is and the 10 principles. The first three (security, token-frugal, speed) are non-negotiable quality bars. Principle #10 "Agent-native in the Delphy ecosystem" added 2026-05-26 — locks Delphy Agent as a peer in the broader Delphy identity-registry agentic-web (separate product the user is building).
4. **`docs/ARCHITECTURE.md`** — process model, stack, adapter pattern, MCP plugin system, storage, three-tier prompt + head/middle/tail compaction, language split, open questions.
5. **`docs/SPEC.md`** — external contracts (MCP config, settings file, session export, theme JSON, versioning policy).
6. **`docs/THEMES.md`** — theme JSON format and runtime loader.
7. **`docs/LESSONS-FROM-ASTRA.md`** — patterns we are deliberately carrying forward from astra-cli (atomic writes, layered timeouts, resilient retry, audit logging, provider quirks). The "why" behind several architectural choices lives here.
8. **`docs/DECISIONS.md`** — architectural decisions log, newest first (36+ entries as of 2026-06-02 — see the file; do not enumerate here). The design-phase and 2026-05-26 direct-API decisions are at the bottom; the multi-provider, settings-redesign, and MCP-reliability decisions are at the top.

## Reference repos (outside this codebase)

- **astra-cli** (predecessor — paused project, lessons folded in; see `docs/LESSONS-FROM-ASTRA.md`).

## Hard rules

- **Do not commit unless explicitly asked.**
- **Do not skip the BLUEPRINT workflow.** Non-trivial work goes through a plan in `.hermes/plans/YYYY-MM-DD_HHMMSS-name.md` with user approval before coding. Reviewer is Codex CLI; reviews are written to `.hermes/reviews/` only on `REQUEST_CHANGES`.
- **Update memory artifacts before claiming done.** `memory/MEMORY.md`, source map, task file (these are *local working artifacts* — see `BLUEPRINT.md` § Memory Artifacts; the project gitignores them out of the public tree), and `docs/DECISIONS.md` for any architectural choice. **Updating the map means: (1) every new/moved/deleted file is reflected in the file index, and (2) re-read in full every map section describing a subsystem you changed — don't just grep moved paths (stale prose has no symbol to grep). See `BLUEPRINT.md` § End-of-Slice Sweep.**
- **Keep this file (`CLAUDE.md`) current when a slice ships.** When you update the memory artifacts at end-of-slice, also refresh CLAUDE.md's **"Current state"** paragraph and **"What does NOT exist yet"** list to match reality. CLAUDE.md is tracked (committed) — fold its update into the slice's commit. It drifted four slices behind once (caught 2026-06-02); don't let it happen again. Keep "Current state" high-level and defer live detail to `memory/MEMORY.md` so it drifts slowly.
- **The docs are the source of truth for design.** If you disagree with something documented, raise it as a new decision in `docs/DECISIONS.md` (with rationale and supersession link). Do not silently deviate.
- **No emojis in files** unless the user explicitly asks.
- **Smallest clean change** — don't refactor surrounding code unless the task is refactoring. No abstractions for hypothetical futures.

## What does NOT exist yet

(See `memory/delphy-agent-tasks.md` for the full backlog; this is the high-level "not yet" list.)

- No agent-CLI backends — Claude Code is deferred; Codex adapter is **BACKLOG #7** (rides on MCP; sequenced next)
- No AWS Bedrock / non-(key+baseURL)-auth providers — **BACKLOG #16** (SigV4 credential auth)
- No Custom-profile base-URL edit UI or no-key/local (Ollama/LM Studio) support — **BACKLOG #17** (the Custom profile is currently only configurable via the settings file)
- No per-tool enable/disable or progressive tool disclosure — every connected MCP tool's full schema loads every turn (**BACKLOG #18/#19**; token-frugality)
- No HTTP/SSE MCP transport — stdio only (**BACKLOG #9**)
- No MCP catalog/picker (**#11**), skills system (**#10**), or MCP-secrets manager UI (**#13**)
- `replaceMessages` still uses an unsafe cross-call SQLite transaction (**BACKLOG #15** — latent; `replaceMcpConfigs` already fixed)
- No Zustand; no CI, signing, notarization, or auto-updater

## Build & test commands

| Command | Purpose |
|---------|---------|
| `pnpm install` | Install Node deps |
| `pnpm dev` | Vite webview-only dev (no Tauri window) |
| `pnpm tauri:dev` | Full Tauri dev with native window |
| `pnpm build` | Frontend production bundle (`tsc && vite build`) |
| `pnpm test` | Run Vitest suite once |
| `pnpm lint` | Biome lint + format check |
| `pnpm typecheck` | `tsc --noEmit` |
| `cargo check --manifest-path src-tauri/Cargo.toml` | Rust type check |
| `cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings` | Rust lints |

Stack reference and gotchas live in `memory/delphy-agent-map.md`.
