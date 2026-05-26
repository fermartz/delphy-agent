# Delphy Agent — Vision

## What it is

Delphy Agent is an open, desktop-first **agent hub**. It gives users a single interface to drive multiple AI agents — both **existing agent CLIs** (Claude Code, Codex) and **direct LLM APIs** (Claude, Gemini, Kimi, OpenAI, and others) — and extends every backend through **MCP-based plugins**.

## Why it exists

Astra CLI proved out the agent loop pattern in a domain-specific shape (AstraNova trading). With AstraNova paused, the goal is to lift those capabilities into something open: not a coding agent, not a trading agent, but a **shell** that lets a user talk to any agent of their choosing, with any tools they choose to plug in.

The thesis: there is no one model, no one agent, and no one tool that wins for every task. Users should be able to pick the right backend per moment, and extend any of them through a standard plugin protocol.

## Core principles

The first three are non-negotiable quality bars. The rest are architectural commitments.

1. **Security-first.** Credentials never enter LLM context. API keys live in an encrypted store. MCP configs reference secrets via `${secret:<key>}` placeholders, never inline. File-system access is scoped to known paths. Validate at boundaries; trust internal code.
2. **Token-frugal by default.** Saving tokens is a design goal, not an afterthought. Prompt caching is preserved by an immutable system prompt within a session. Context compaction is structured (head/middle/tail, iterative summary, focused topic) rather than naive truncation. A cheap auxiliary model handles compaction, titles, and search — premium tokens are reserved for the user-visible turn. Tool lists carry only what the active backend needs.
3. **Speed matters.** First token on screen as soon as the backend produces one — streaming everywhere it's available. The UI thread is never blocked on storage or LLM calls. MCP servers and other long-lived subprocesses are kept warm when they can be. Hot SQLite queries use prepared statements. Perceived latency is treated as a feature.
4. **Backend-agnostic by design.** Claude Code, Codex, and raw API calls all live behind a shared adapter interface. Switching backends is an action in the app, not a reinstall.
5. **Don't reimplement what others maintain.** When an agent CLI (`claude`, `codex`) already handles auth, native tools, sandboxing, and approvals, we drive it — we don't reinvent its loop.
6. **MCP is the plugin protocol.** One plugin format, works across every backend. Claude Code and Codex consume MCP natively; for direct-API mode we run the MCP client ourselves so plugins still work.
7. **Desktop-native, not terminal-wrapped.** No TUI, no embedded terminal emulator. A real desktop app with a real UI.
8. **Small surface, small bundle.** No bundled language runtimes, no sidecar processes. Most code in TypeScript, system access in thin Rust.
9. **Open and inspectable.** Public-facing codebase. Code should be readable. Names should explain themselves. Dependencies should be justified.
10. **Agent-native in the Delphy ecosystem.** Delphy Agent isn't only a client that drives AI — it's a peer in the Delphy agentic-web. It has an @identity on Delphy (the identity registry for the agentic web), exposes a machine-readable manifest plus a `skill.md` describing what it does for other agents to read, and runs an inbound MCP server so other agents can call it (open a session, send a message, query history, switch backend). Outbound MCP (principle #6) and inbound MCP are symmetric: same protocol, both directions.

## What it is NOT

- **Not a coding agent.** It can drive coding agents (Claude Code, Codex); it doesn't reimplement file editing, bash, or apply_patch itself.
- **Not a CLI.** Distribution is a desktop app — no `npm i -g`, no terminal install.
- **Not a single-provider client.** No "the OpenAI app" or "the Claude app" framing. Provider choice is first-class and switchable.
- **Not a re-skin of Astra.** Lessons from Astra carry over (the agent loop, MCP, session persistence), but no Ink, no xterm.js, no Node sidecar, no AstraNova-specific code.

## Architectural shape

The full picture lives in `docs/ARCHITECTURE.md`. One-paragraph version:

Tauri v2 (Rust shell) + React + TypeScript + Tailwind/shadcn in the webview. Each backend is an adapter exposing the same `sendMessage` / `streamEvents` / `listTools` shape: Claude Code via `@anthropic-ai/claude-agent-sdk`, Codex via spawned `codex exec --json` subprocess, direct APIs via Vercel AI SDK v5. MCP plugins are configured once and routed to whichever backend is active. Storage: SQLite (sessions, MCP configs, settings) via `tauri-plugin-sql`. No Node sidecar — agent core runs in the webview; Rust handles subprocess spawning, the MCP stdio bridge, and file system access.

## Lessons folded in from Astra

- **Adapter pattern over per-provider branches.** Provider routing in Astra (`isCodexOAuth()` → `runCodexTurn()`, etc.) becomes a uniform adapter interface here.
- **No custom SSE handlers.** Vercel AI SDK v5 covers the OpenAI Responses API natively; the Codex chatgpt.com backend is owned by `codex exec`, not us.
- **Atomic, scoped credential storage.** chmod 600 / 700, atomic writes, never in LLM context — same posture, scoped per backend.
- **Session compaction at provider-aware thresholds.** The 85%-of-window rule earned its keep; bring it forward.
- **Explicit consent before consequential actions.** Approval flows are surfaced in the UI, not implicit.
