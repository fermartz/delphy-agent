# CLAUDE.md

Delphy Agent is an open, desktop-first **agent hub** built with Tauri v2 + React + TypeScript. It wraps Claude Code, Codex, and direct LLM APIs (Claude, Gemini, OpenAI, Kimi) behind a single adapter interface; plugins are MCP servers.

**Why this product exists (strategic framing).** Delphy Agent serves a dual purpose: it is a genuinely useful standalone multi-model agent hub *and* the universal distribution channel for the maintainer's Delphy @identity registry (delphy.network). Without it, reaching the long tail of model surfaces (ChatGPT, Kimi, Gemini, DeepSeek) requires building and maintaining N custom connectors forever; with it, one install gives any user any model + Delphy MCP preinstalled + every other MCP server they want. This duality is non-negotiable — the standalone product must be useful even to users who don't care about Delphy, and Delphy MCP ships as default-installed, not an opt-in plugin. See `docs/DECISIONS.md` 2026-05-27 "Delphy Agent is dual-purpose" for the full rationale and constraints this locks in.

**Current state: direct-API adapter (Anthropic) shipped as Slice A — first real backend.** Tauri v2 + React 19 + TS + Tailwind v4 + Biome + Vitest. Chat against `claude-sonnet-4-6` via Vercel AI SDK v6 + `@ai-sdk/anthropic`. Real token streaming. Three-tier system prompt builder in place (compaction populates `context` slot in Slice B). Secret store via OS keychain (`keyring` Rust crate) — first custom Tauri commands + first capabilities edit. API-key entry UI with branched UX per error kind; runtime errors render with kind-specific buttons. Echo adapter retained as boot fallback + test fixture. 22/22 vitest passing. See `docs/DECISIONS.md` 2026-05-26 entries for: direct-API as primary backend, codex via MCP-server, Claude Code deferred, two-slice direct-API plan, secret-store choice, default model.

## Read these first (in order)

1. **`memory/MEMORY.md`** — always-loaded index. Current state, pointers to all source-of-truth docs, paths to reference repos.
2. **`BLUEPRINT.md`** — the workflow you must follow (plan → build → review → fix → verify → approve), file naming, memory-artifact maintenance protocol.
3. **`docs/VISION.md`** — what Delphy Agent is and the 10 principles. The first three (security, token-frugal, speed) are non-negotiable quality bars. Principle #10 "Agent-native in the Delphy ecosystem" added 2026-05-26 — locks Delphy Agent as a peer in the broader Delphy identity-registry agentic-web (separate product the user is building).
4. **`docs/ARCHITECTURE.md`** — process model, stack, adapter pattern, MCP plugin system, storage, three-tier prompt + head/middle/tail compaction, language split, open questions.
5. **`docs/SPEC.md`** — external contracts (MCP config, settings file, session export, theme JSON, versioning policy).
6. **`docs/THEMES.md`** — theme JSON format and runtime loader.
7. **`docs/LESSONS-FROM-ASTRA.md`** — patterns we are deliberately carrying forward from astra-cli (atomic writes, layered timeouts, resilient retry, audit logging, provider quirks). The "why" behind several architectural choices lives here.
8. **`docs/DECISIONS.md`** — architectural decisions log, newest first. Fifteen decisions: seven from 2026-05-25 (six design-phase + React 19); eight from 2026-05-26 (direct-API as primary backend; codex via MCP-server; Claude Code deferred; v1 direct-API in two slices; secret store via `keyring` crate; default model `claude-sonnet-4-6`; VISION principle #10 agent-native; local-only agent-workflow artifacts).

## Reference repos (outside this codebase)

- **astra-cli** (predecessor — paused project, lessons folded in; see `docs/LESSONS-FROM-ASTRA.md`).

## Hard rules

- **Do not commit unless explicitly asked.**
- **Do not skip the BLUEPRINT workflow.** Non-trivial work goes through a plan in `.hermes/plans/YYYY-MM-DD_HHMMSS-name.md` with user approval before coding. Reviewer is Codex CLI; reviews are written to `.hermes/reviews/` only on `REQUEST_CHANGES`.
- **Update memory artifacts before claiming done.** `memory/MEMORY.md`, source map, task file (these are *local working artifacts* — see `BLUEPRINT.md` § Memory Artifacts; the project gitignores them out of the public tree), and `docs/DECISIONS.md` for any architectural choice.
- **The docs are the source of truth for design.** If you disagree with something documented, raise it as a new decision in `docs/DECISIONS.md` (with rationale and supersession link). Do not silently deviate.
- **No emojis in files** unless the user explicitly asks.
- **Smallest clean change** — don't refactor surrounding code unless the task is refactoring. No abstractions for hypothetical futures.

## What does NOT exist yet

- No MCP client, no Rust stdio bridge — approval-card / tool-call / tool-result rendering paths in `App.tsx` are wired but dormant until MCP lands (BACKLOG #6)
- No agent-CLI backends — Claude Code is deferred; Codex (BACKLOG #7) rides on MCP
- No additional direct-API providers beyond Anthropic — OpenAI / Gemini / Kimi are future profile modules
- No compaction / AuxiliaryClient — Slice B per the two-slice decision; context-near-limit warning is the v1 safety net
- No SQLite / `tauri-plugin-sql` — sessions are in-memory only (BACKLOG #4 ships persistence)
- No `tauri-plugin-store` — no persisted settings (model picker, theme, etc. — BACKLOG #2)
- No theme system / shadcn / Zustand (BACKLOG #3 + #2)
- No `README.md`, `ROADMAP.md`, or `CONTRIBUTING.md` (premature until v1 plan is firm)
- No CI, signing, notarization, or auto-updater

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
