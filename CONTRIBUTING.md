# Contributing to Delphy Agent

Contributions are welcome. This document is the entry point.

## Read these first

Before opening a PR for anything non-trivial:

- [docs/VISION.md](docs/VISION.md) — what Delphy Agent is, what it is NOT, and the ten principles. The first three (security-first, token-frugal, speed) are non-negotiable quality bars.
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — process model, stack, adapter pattern, MCP plugin shape, storage plan.
- [BLUEPRINT.md](BLUEPRINT.md) — the project's plan → build → review workflow (internal authoring process; see "How to propose a change" below for how this maps to external PRs).
- [docs/DECISIONS.md](docs/DECISIONS.md) — architectural decisions log, newest first. If a PR contradicts a logged decision, it needs a new decision entry justifying the supersession.

## Setup

Same as the [README quick-start](README.md#quick-start). Node 20+, pnpm, Rust toolchain.

```bash
pnpm install
pnpm tauri:dev
```

Run the full verification suite before opening a PR:

```bash
pnpm test
pnpm lint
pnpm typecheck
pnpm build
cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings
```

All five must pass.

## How to propose a change

**Small fix or improvement:** open a PR with a clear diff. Reference an issue if one exists; if not, the PR itself can be the discussion thread.

**Non-trivial change** (new feature, refactor, dependency, behavior change): **open an issue first**. Describe what you want to change and why before writing code. This avoids the case where a large PR lands ready-to-merge but conflicts with planned architecture or a logged decision.

The internal authoring workflow uses plan documents under `.hermes/plans/` (see [BLUEPRINT.md](BLUEPRINT.md)). External contributors are **not** required to produce these — that's an internal process. Standard GitHub flow (issue → PR → review → merge) is the contributor path.

## Code style

- **TypeScript / React**: enforced by Biome. Run `pnpm lint` (lint + format check). PRs must be lint-clean.
- **Rust**: enforced by clippy with `-D warnings`. Run `cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings`. No warnings allowed.
- **Tests**: Vitest. Required for any TS code change that adds or modifies behavior. Run `pnpm test`.
- **Type safety**: `pnpm typecheck` must pass. No `any` cast without a clear justification.

## What to avoid

These are not just style preferences — they're aligned with [docs/VISION.md](docs/VISION.md):

- **No bundled language runtimes or sidecar processes** (principle #8). Most code lives in TypeScript; system access goes through thin Rust.
- **No coding-agent reimplementation.** Delphy Agent *drives* coding agents (Claude Code, Codex via MCP) — it does not reimplement file editing, shell exec, or apply_patch. If a tool exists in an MCP-published server, use that.
- **No CLI distribution.** Delphy Agent is a desktop app; no `npm i -g`, no terminal install.
- **No credentials in LLM context.** Ever. API keys live in the OS keychain; MCP configs use `${secret:…}` placeholders.

## Where decisions are recorded

[docs/DECISIONS.md](docs/DECISIONS.md). Every architectural choice has a dated entry with rationale, alternatives considered, and what it supersedes (if anything). If a PR contradicts a logged decision, the PR description must propose a new decision entry that explains the supersession.

## Security

See [SECURITY.md](SECURITY.md). For security issues, use GitHub's private vulnerability reporting — do not open a public issue.

## License

By contributing, you agree that your contributions will be licensed under the MIT License (see [LICENSE](LICENSE)).
