# Delphy Agent

A desktop-first **agent hub** that gives you one interface to drive multiple AI agents — existing agent CLIs (Claude Code, Codex) and direct LLM APIs (Claude, Gemini, Kimi, OpenAI) — and extends every backend through MCP-based plugins. Built with Tauri v2, React, and TypeScript.

> **Early development.** Anthropic direct-API chat working; MCP plugins, additional providers, and persistence still ahead. See [docs/DECISIONS.md](docs/DECISIONS.md) for the architecture log and current scope.

## Why it exists

There is no one model, no one agent, and no one tool that wins for every task. Users should be able to pick the right backend per moment, and extend any of them through a standard plugin protocol. Delphy Agent is the shell that makes that possible.

The full vision and the ten principles live in [docs/VISION.md](docs/VISION.md). The first three — security-first, token-frugal, speed — are non-negotiable quality bars.

## Quick start

Prerequisites:

- **Node 20+** (see `.nvmrc`)
- **pnpm** (`npm install -g pnpm` or via Corepack)
- **Rust toolchain** (`rustup` — Tauri builds the native shell)
- Platform-specific Tauri dependencies — see the [Tauri v2 prerequisites guide](https://v2.tauri.app/start/prerequisites/)

```bash
pnpm install
pnpm tauri:dev      # full Tauri dev (native window)
# or
pnpm dev            # webview-only Vite dev (no native window)
```

Other useful commands:

| Command | Purpose |
|---|---|
| `pnpm build` | Frontend production bundle (`tsc && vite build`) |
| `pnpm test` | Run Vitest suite once |
| `pnpm lint` | Biome lint + format check |
| `pnpm typecheck` | `tsc --noEmit` |
| `cargo check --manifest-path src-tauri/Cargo.toml` | Rust type check |
| `cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings` | Rust lints |

## How it's built

Tauri v2 (Rust shell) + React + TypeScript + Tailwind in the webview. Each backend is an adapter exposing the same contract — `sendMessage`, `streamEvents`, tool calls. The first adapter shipped is the direct-API adapter for Anthropic via the Vercel AI SDK. MCP plugins (BACKLOG) attach to any active backend.

For the full architectural picture, read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). For external contracts (MCP config shape, settings file, theme JSON), [docs/SPEC.md](docs/SPEC.md).

## What does not exist yet

This is honest scoping, not a roadmap. Currently missing:

- MCP plugin system (TS client + Rust stdio bridge)
- Codex adapter and any agent-CLI backend
- Provider profiles beyond Anthropic (OpenAI, Gemini, Kimi)
- Context compaction (lands as Slice B of v1 direct-API)
- SQLite session persistence
- Theme system, settings store, model picker UI
- CI, code signing, notarization, auto-updater

See [docs/DECISIONS.md](docs/DECISIONS.md) for what's been decided and why; [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) § "Open questions" for what hasn't.

## Contributing

Contributions welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a PR — the project follows a plan → build → review workflow described in [BLUEPRINT.md](BLUEPRINT.md), and design decisions are recorded in [docs/DECISIONS.md](docs/DECISIONS.md).

## Security

Found a vulnerability? See [SECURITY.md](SECURITY.md) — please do **not** open a public issue.

## Status and stability

This is not production software. No release builds yet. APIs, storage schemas, and UI surfaces will change without migration support until v1.

## License

MIT — see [LICENSE](LICENSE).
