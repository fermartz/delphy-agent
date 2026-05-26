# Decisions

Architectural and product decisions, newest first. Each entry: date, decision, why, alternatives considered, where it lives.

When a decision is later reversed, do not delete the entry — add a new dated entry that supersedes it and link back. The history matters.

> **A note on path references in this file.** Some entries below reference paths under `.hermes/plans/`, `.hermes/reviews/`, `memory/MEMORY.md`, and `memory/<project>-tasks.md`. These are local working artifacts of the project's plan → build → review workflow (see [BLUEPRINT.md](../BLUEPRINT.md)). They're gitignored from this repository and live only on the maintainer's filesystem. The references stay here as historical context for why each decision was made; treat them as pointers into a private working trail, not links you can follow from this repo.

---

## 2026-05-26 — Local-only agent-workflow artifacts (`.hermes/`, `memory/`)

**Decision.** The plan → build → review workflow generates working notes — plans under `.hermes/plans/`, reviews under `.hermes/reviews/`, an always-loaded `memory/MEMORY.md` index, source maps under `memory/<project>-map.md`, and task trackers under `memory/<project>-tasks.md`. These are **not** tracked in this repository. `.gitignore` keeps the entire `.hermes/` and `memory/` directories out of every commit. Only the *outcomes* of the workflow ship: source-of-truth docs in `docs/`, the curated architectural decision log in this file (`docs/DECISIONS.md`), and the code itself. The `.claude/` directory (project-local Claude Code metadata) is also gitignored as defense-in-depth.

**Why.** Two reasons.

1. **Ongoing transparency cost.** Publishing every plan and every review would obligate every future change to produce those artifacts publicly, including ones that touch sensitive design (security posture, unpublished credentials, plugin auth shapes, partner integrations). That cost compounds over the project lifetime.
2. **Signal-to-noise.** The artifacts are noisy reading for an outside observer — they're working notes by and for whoever is driving the next change, not narrative documentation for a stranger landing on the repo. Their *value* is captured already in the docs they produce; the docs ship, the artifacts don't.

**Alternatives considered.**
- **Keep everything tracked.** Full transparency, but binds future planning to public production. Rejected per the cost above.
- **Track `.hermes/` only after a scrub of personal absolute paths.** Same binding problem, plus a per-plan scrub cost on every future plan. Worse than the bundled option.
- **Move *all* of `memory/` into `docs/` so the entirety of the working notes ships.** Even worse signal-to-noise than the first alternative.

**Lives in.** `.gitignore` (three lines: `.hermes/`, `memory/`, `.claude/`); [BLUEPRINT.md](../BLUEPRINT.md) § "Memory Artifacts" (clarifying note that three of the four memory files are local-only; only `decisions.md` ships, as this file); [CLAUDE.md](../CLAUDE.md) (mirror note for anyone using Claude Code on the project); [CONTRIBUTING.md](../CONTRIBUTING.md) (so external contributors aren't surprised the plan workflow doesn't appear in their PRs).

**Supersession.** None. This decision is foundational for the public repository's shape.

---

## 2026-05-26 — VISION principle #10: Agent-native in the Delphy ecosystem

**Decision.** Add a 10th principle to `docs/VISION.md`: "Agent-native in the Delphy ecosystem." Delphy Agent participates as a peer in the broader Delphy agentic-web (the @identity registry the user is building separately) — has an @identity, exposes a machine-readable manifest + `skill.md`, runs an inbound MCP server symmetric to the outbound MCP client of principle #6.

**Why.** Without this principle in VISION, future slice planning treats Delphy Agent as a standalone client app, and per-slice decisions accumulate that make ecosystem integration retroactively costly. The first three slices (scaffold, Claude-Code attempt, direct-API Slice A) were all client-shaped — sensible as a first-pass MVP, but without the principle they could ossify into "Delphy Agent is just a chat client" and the Delphy-platform positioning would require a major refactor later. Locking the intent now means every future slice gets sanity-checked against "does this advance agent-native participation, or block it?"

**Alternatives considered.**
- **Keep VISION at 9 principles; describe agent-native in a separate `docs/AGENT-NATIVE.md`.** Cleaner doc layering but easier to ignore — VISION is what gets read first per `CLAUDE.md`'s "Read these first" order. A principle in VISION carries more design weight per slice.
- **Wait for BACKLOG #6 (MCP stdio bridge) to land, then add the principle.** Defers the design check — slices #2 (settings), #4 (SQLite) could bake in client-only assumptions before the principle exists. Cheaper to add now and apply as a planning filter.
- **Don't add it — Delphy-the-platform is upstream; Delphy Agent doesn't need to know about it.** Rejected because the user is building both, and the implicit coupling is real. Better to make the coupling explicit in VISION than have it leak into per-slice decisions silently.

**What changes operationally.**
- Future plans include a check: does this slice block agent-native integration, or is it neutral / advancing? E.g., the settings-persistence slice (BACKLOG #2) can store the @identity binding without overhead — near-free if planned, costly if retrofitted.
- A future slice (post-BACKLOG #6, since the MCP stdio bridge is the prerequisite for both inbound and outbound) ships: `skill.md`, a machine-readable manifest, and an inbound MCP server exposing 3-5 tools (likely `open_session`, `send_message`, `list_history`, `switch_backend`, `change_model`). Surfaces Delphy Agent into the Delphy registry.
- A `docs/AGENT-NATIVE.md` companion may be created later to spec the manifest + skill.md format in detail. VISION stays brief; AGENT-NATIVE.md would be the deep spec.

**Note on the broader Delphy platform.** Delphy (the @identity registry for the agentic web) is a separate product the user is building. Delphy Agent's relationship to it: Delphy Agent is a participant — one of many entities (people, businesses, APIs, services, agents) that have an @identity on Delphy. This decision locks Delphy Agent's role in that broader ecosystem, without requiring this codebase to know everything about Delphy-the-platform. The integration surfaces (manifest format, skill.md schema, identity-binding mechanism) come from the Delphy-platform side; this principle just commits Delphy Agent to honoring them.

**Lives in.** `docs/VISION.md` § "Core principles" (new entry #10). Future `docs/AGENT-NATIVE.md` for the integration-format details when a slice plans the work. `memory/MEMORY.md` "Read these first" tally + `CLAUDE.md` "Read these first" tally updated from "9 principles" to "10."

---

## 2026-05-26 — Secret store: OS keychain via the `keyring` Rust crate (option A; closes open question #1)

**Decision.** Secrets (API keys for direct-API providers, OAuth tokens for future agent CLIs) live in the OS-native credential store, accessed from Rust via the `keyring` crate (v4.0.1, with the platform-native crates `apple-keychain-store`, `windows-native-keyring-store`, `zbus-secret-service-keyring-store` pulled transitively). Three Tauri commands (`get_secret` / `set_secret` / `delete_secret` in `src-tauri/src/secrets.rs`) wrap `keyring_core::Entry::new("app.delphy.agent", key)`. On boot, `keyring::use_native_store(true)` selects the OS-native store (not Linux's volatile kernel keyutils). Closes `docs/ARCHITECTURE.md` § "Open questions" #1.

**Why.** Native keychain integration is the smallest, lowest-friction story for the realistic user base (macOS + Windows + Linux-with-desktop-environment) — zero setup on macOS/Windows, works out of the box on GNOME / KDE. Stronghold would have introduced a master-password concept that adds setup friction every user pays regardless of platform, for a benefit (cross-platform consistency) that only matters on bare/headless Linux.

**Linux edge case.** When no Secret Service daemon is running (bare/headless installs without GNOME / KDE), `keyring` returns `keyring::Error::NoStorageAccess(_)`. The Tauri command translates this to a typed error prefix `SECURE_STORAGE_UNAVAILABLE: <details>`; the TS adapter (`src/core/adapters/direct-api.ts`) recognizes the prefix and falls back to a non-persistent module-level holder (`src/core/providers/anthropic-runtime-key.ts`). The UI shows a "session-only key" banner so the user knows the key won't survive restart, with remediation copy pointing at GNOME Keyring / KWallet installation.

**Alternatives considered.**
- **Stronghold (`tauri-plugin-stronghold`)** — cross-platform consistency, but every user enters a master password at launch. Higher upfront UX cost for a benefit narrow to bare Linux. Remains a future option if every-Linux-distro support becomes load-bearing.
- **chmod-600 JSON file** (astra-cli's pattern from `docs/LESSONS-FROM-ASTRA.md`) — works everywhere, no native deps, but weakest security on macOS / Windows (no OS-level lock integration). The native paths give us stronger guarantees for free.
- **Encrypted SQLite column** — would require us to manage encryption key derivation. Pushes the same problem one level down.
- **`tauri-plugin-keyring` (community plugin)** — exists, but not first-party. We author commands directly to keep the security-critical surface small and reviewable.

**Lives in.** `src-tauri/src/secrets.rs`; `src-tauri/permissions/secrets.toml`; `src-tauri/capabilities/default.json`; `src/core/providers/anthropic-runtime-key.ts`; gotchas section of `memory/delphy-agent-map.md`.

---

## 2026-05-26 — Default Anthropic model: `claude-sonnet-4-6` for v1

**Decision.** The Anthropic ProviderProfile (`src/core/providers/anthropic.ts`) ships with `defaultModel: "claude-sonnet-4-6"`. This is the active model when no settings UI exists; user can override once BACKLOG #2 (Settings + Tauri Store) lands a model picker.

**Why.** Sonnet 4.6 is Anthropic's latest 4.x mid-tier as of 2026-05 (confirmed via `@ai-sdk/anthropic` 3.0.79's published model list — `claude-opus-4-7`, `claude-opus-4-6`, `claude-sonnet-4-6`, `claude-opus-4-5`, `claude-haiku-4-5`, `claude-sonnet-4-5`, ...). Sensible default: cheaper than Opus per token, faster, demo-quality answers. Opus would be the right default for a "premium product" framing but burns money in dev / casual use.

**Alternatives considered.**
- **`claude-opus-4-7`** — best quality, ~5× the cost. Reasonable for a user who's set this up deliberately; not a default that respects token-frugal principle #2.
- **`claude-haiku-4-5`** — cheapest, fastest, but quality is noticeably lower for non-trivial chat. The auxiliary-model tier (Slice B) is where Haiku belongs.
- **Date-suffixed ID** (e.g. `claude-sonnet-4-6-20250514`) — locks the version. Sensible for reproducibility but stale faster. The undated `claude-sonnet-4-6` aliases to the latest minor of that line. Use the alias.

**Lives in.** `src/core/providers/anthropic.ts` (`defaultModel` field). Will become a user-overridable setting when BACKLOG #2 ships the Settings UI.

---

## 2026-05-26 — v1 direct-API mode ships in two slices: base + compaction/auxiliary

**Decision.** The v1 direct-API milestone — committed to in the 2026-05-25 "Three-tier system prompt with cache-invalidation discipline," "Auxiliary model tier in v1," and "Add a head/middle/tail context compactor in v1" decisions below — is implemented across **two consecutive slices**, not one. Slice A (the slice planned at `.hermes/plans/2026-05-26_045615-direct-api-adapter.md`) ships: the `ProviderProfile` contract, the Anthropic profile, the direct-API adapter, secret-store Tauri commands + first capabilities edit, the API-key entry UI, the three-tier system prompt builder (with `stable` populated, `context`/`volatile` empty), and a char-based "context near limit" warning as a v1 safety net for long conversations. Slice B (next, no plan yet) ships: `src/core/llm/auxiliary.ts` (`AuxiliaryClient` with Claude Haiku 4.5 default per the auxiliary-tier decision), `src/core/session/compactor.ts` (~600 LOC head/middle/tail compactor implementing the established agent-hub compaction pattern), and integration so the direct-API adapter compacts the `context` slot when usage crosses the threshold. The auxiliary-tier picker UI is still deferred to BACKLOG #2 (Settings + Tauri Store); slice B uses the hardcoded default specified in the auxiliary decision.

**Why.** Slicing for ergonomics. Slice A is already a substantial unit of work — direct-API + ProviderProfile + secret-store Rust commands + first capabilities edit + key-entry UI + three-tier prompt structure + Linux edge-case handling. Bundling compaction (~600 LOC) and the `AuxiliaryClient` (additional model wiring + system-prompt-cache regression checks) on top risks burying real bugs in a single review pass. The three-tier prompt structure landing in slice A means compaction in slice B plugs into the existing `context` slot with zero friction; the underlying architectural commitment is preserved.

**Alternatives considered.**
- **Land everything in slice A.** Honors the v1 decisions literally. Trade-off: ~2-3x slice size, higher review-cycle cost, more concurrent unknowns. Codex review round 2 on rev 3 of slice A's plan effectively recommended this (REQUEST_CHANGES citing "compaction and auxiliary-model/settings tier remain deferred"); we're choosing instead to formalize the slicing here.
- **Defer compaction + auxiliary indefinitely (to BACKLOG #8 or later).** Rejected because the v1 decisions explicitly commit to them and a v1 direct-API without compaction degrades silently on the first long session. The two-slice plan is the *minimum* split that satisfies the v1 commitment; we're not deferring beyond it.
- **Land the compaction logic as a stub now, fully fleshed later.** Rejected because a stubbed compactor that doesn't actually compact is worse than a "context near limit" warning that's honest about its limits.

**Supersedes / amends.** Does NOT supersede the three v1-commitment decisions (Three-tier system prompt; Auxiliary model tier in v1; Add a head/middle/tail context compactor in v1). All three still stand for the v1 product release. This decision amends only the **slicing**, splitting v1 direct-API into two implementation passes.

**Lives in.** `.hermes/plans/2026-05-26_045615-direct-api-adapter.md` (slice A); future plan in `.hermes/plans/` for slice B; `memory/delphy-agent-tasks.md` BACKLOG once slice A is APPROVED.

---

## 2026-05-26 — Direct-API via Vercel AI SDK is the primary backend mechanism

**Decision.** The first real backend ships through the Vercel AI SDK (`ai` + `@ai-sdk/anthropic`, plus `@anthropic-ai/sdk` where the higher-level SDK isn't enough). Every direct-API provider is implemented as a `ProviderProfile` module per the locked decision below. This replaces the prior implicit assumption that the first real backend would be Claude Code wrapped via `@anthropic-ai/claude-agent-sdk`.

**Why.** Three converging reasons:
1. The TS Claude Agent SDK is Node-only — it shebangs `#!/usr/bin/env node`, uses `child_process`/`fs`, and crashes Vite's webview bundler. We confirmed this empirically when `pnpm build` failed mid-Checkpoint 5 of `.hermes/plans/2026-05-25_163727-claude-code-adapter.md`.
2. The Vercel AI SDK + `@anthropic-ai/sdk` are browser-compatible (HTTP over `fetch`) and give us real token-level streaming — what Claude Code's higher-level SDK aggregates away. Better UX for free.
3. Driving providers via standard SDKs (not wrapping CLIs) with per-provider quirks routed through a `ProviderProfile` is the established pattern for agent hubs that want to support multiple LLM backends behind one interface. That's the shape we're modelling on — same universal-client posture (e.g. an OpenAI-compatible client as the default surface, native-shape SDKs as fallbacks for providers whose responses don't fit the universal mold), with per-provider profiles handling the divergence.

**Alternatives considered.**
- Claude Code via the TS Agent SDK — blocked by Node-only bundling. Would require a Node sidecar (rejected; see VISION principle #8).
- Claude Code via Rust-spawned subprocess + JSONL — fragile (undocumented output contract) and the CLI doesn't expose an "agent-as-server" mode (its `claude mcp serve` only exposes the tool surface, not Claude-the-agent). See the Claude-Code-deferral decision below.
- Reverse "no Node sidecar" — explicitly rejected in VISION #8 and ARCHITECTURE.md § "What we explicitly do NOT do." Astra-cli ran on that pattern and we are not repeating it.

**Lives in.** `docs/ARCHITECTURE.md` § "Stack" (already named `ai`, `@ai-sdk/anthropic`, etc.) and § "The backend adapter pattern" → `direct-api.ts`. Implementation lands with the next slice (former BACKLOG #5).

---

## 2026-05-26 — Codex adapter uses `codex mcp-server` (supersedes ARCHITECTURE.md's `codex exec --json` spec)

**Decision.** When the codex adapter ships, it drives `codex` via `codex mcp-server` mode: Rust spawns the subprocess, the TS MCP client in the webview drives it over stdio MCP. Tool calls from Claude/Codex (the model) flow back through MCP elicitations and surface as `approval_request` events to the UI. The configuration shape is `{"codex": {"command": "codex", "args": ["mcp-server"]}}`, plus a bidirectional setup where Delphy exposes its own tool surface back via a second MCP server so user-installed plugins remain reachable inside a codex turn.

`docs/ARCHITECTURE.md` § "The backend adapter pattern" → `codex.ts` currently specifies `codex exec --json` + JSONL parsing. That description is superseded by this entry; the doc will be updated on the next ARCHITECTURE.md touch-up pass.

**Why.** MCP-server mode is the documented, structured, bidirectional protocol designed for exactly this use case. The `codex exec --json` JSONL-output mode is one-shot per prompt (no persistent session) and the line shape is an internal contract that can change between versions. MCP gives us: a stable wire format, a session abstraction we can build multi-turn chat on, and a clear path for the bidirectional tool-callback story (we expose Delphy's MCP server back to codex so user-installed plugins work inside a codex turn).

**Alternatives considered.**
- Keep ARCHITECTURE.md's `codex exec --json` spec — rejected because (a) one-shot per prompt doesn't fit multi-turn chat, and (b) MCP-server mode is the documented, stable interface; the JSONL stdout shape is internal and version-volatile.
- Implement both modes — premature; no requirement that needs the one-shot path.

**Lives in.** `docs/ARCHITECTURE.md` § "The backend adapter pattern" → `codex.ts` (description needs update on next doc pass). Implementation lands with BACKLOG #7 whenever that's slotted; the MCP stdio bridge from BACKLOG #6 has to land first since codex's MCP connection rides on the same bridge.

---

## 2026-05-26 — Defer Claude Code wrapping; no claude-code adapter ships in v1

**Decision.** The `claude-code` adapter is abandoned. There is no clean path to drive Claude Code from a webview-based desktop app in our current architecture, and we are not adding the architecture-level workarounds that would unblock one. "Talking to Claude" is satisfied by the direct-API adapter against `@ai-sdk/anthropic`; Claude Code's native tool surface (Read/Edit/Bash/etc.) is reachable via MCP later (BACKLOG #6 ships the bridge; MCP-published tools can mirror Claude Code's reach). The slice plan at `.hermes/plans/2026-05-25_163727-claude-code-adapter.md` is marked SUPERSEDED by this decision.

**Why.** Three independent blockers:
1. **TS Agent SDK is Node-only.** `@anthropic-ai/claude-agent-sdk` shebangs `#!/usr/bin/env node`, uses `child_process` to spawn the `claude` binary, reads/writes the filesystem. It cannot run inside the webview. Empirically confirmed: `pnpm build` failed during Checkpoint 5 of the now-superseded slice.
2. **`claude mcp serve` is the wrong shape.** Reconnaissance (results recorded in the slice's review file, round 5) confirmed `claude mcp serve` exposes Claude Code's *tool surface* (Read, Edit, LS, Bash, WebFetch) as MCP tools to a client — it does NOT expose Claude-the-agent as a driveable agent server. Approval flows still go through Claude Code's own UI, not ours. This is not analogous to `codex mcp-server`, which DOES expose codex as an agent (this is why the MCP-server approach can drive codex but cannot drive claude).
3. **JSONL-from-CLI is fragile.** The `claude` CLI's text/streaming output formats are internal contracts, undocumented, and version-dependent. Parsing them is the same anti-pattern Astra used for the OpenAI Responses API; we are not repeating it.

**What replaces it.** Direct-API via Vercel AI SDK + Anthropic (decision above). Users get Claude-the-model with real token streaming. Tool reach comes through MCP-published tools (BACKLOG #6) — a Delphy user can install an MCP server that provides Bash/Read/Edit equivalents, and it works against any direct-API backend uniformly.

**Alternatives considered.**
- Spawn `claude` as a subprocess and hand-parse its output — rejected per blocker #3.
- Reverse "no Node sidecar" to host the Agent SDK — rejected per VISION #8 and ARCHITECTURE.md "What we explicitly do NOT do." Astra precedent.
- Build a thin Node shim that runs only the Agent SDK and proxies via Tauri events — same fundamental blocker as "Node sidecar." High bundle/complexity cost for one backend.
- Pause v1 entirely and wait for Anthropic to ship a browser-compatible Agent SDK — unbounded timeline; not how we ship.

**Salvage.** The contract extension `Session.respondToApproval(id, allowed)` added to `src/core/types.ts` during the abandoned slice stays — it earns its keep when MCP tool approvals land (BACKLOG #6). The `App.tsx` approval-card UI and tool-call/tool-result rendering paths also stay, dormant until MCP tools start triggering them. The plan + reviews under `.hermes/plans/` and `.hermes/reviews/` remain in place as historical record; the plan's Status header is updated to SUPERSEDED.

**If revisited later.** The cleanest path back is the same `codex mcp-server` pattern *if* Anthropic ever ships an analogous `claude mcp serve --agent` (or whatever name) that exposes Claude-the-agent over MCP. The contract Delphy already commits to (MCP plugin protocol) would absorb that day-one with no architecture change. Until then, no.

**Lives in.** `.hermes/plans/2026-05-25_163727-claude-code-adapter.md` (marked SUPERSEDED), `.hermes/reviews/2026-05-25-claude-code-adapter.md` (history of the slice's 5 review rounds), `memory/delphy-agent-tasks.md` (BACKLOG #1 removed; "Claude Code adapter (deferred)" recorded in DONE with deferred verdict), `memory/MEMORY.md` § "Current state."

---

## 2026-05-25 — React 19 (supersedes the React 18 mention in ARCHITECTURE.md)

**Decision.** Ship on React 19, not React 18 as originally noted in `docs/ARCHITECTURE.md` § "Stack". The walking-skeleton scaffold pulled in `react@19.2` and `react-dom@19.2` via `pnpm create tauri-app`'s current defaults.

**Why.** React 19 is the current stable (released late 2024, widely adopted by 2026-05). `create-tauri-app`'s react-ts template ships it. Downgrading would mean fighting both the template default and the broader ecosystem (`@types/react@19`, Vite 7's bundled assumptions, etc.) for no observable benefit. The features we rely on for v0 (`useState`, `useEffect`, `useRef`, async patterns) are identical across the two.

**Alternatives considered.**
- Pin React 18 to match the doc verbatim — pure churn cost. The `react@19` types are also what `create-tauri-app` ships; reverting cascades into version pins across `@types/react`, `@types/react-dom`, and possibly Vite plugin variants.
- Pin neither, leave as caret range — already done (`^19.1.0`); this entry just records the decision behind the major.

**Action.** Update `docs/ARCHITECTURE.md` § "Stack" "Frontend framework" row to read "React 19 + TypeScript" when a touch-up pass happens. Not blocking — the docs-vs-code discrepancy is fully captured here.

**Lives in.** `package.json` (`react`, `react-dom`, `@types/react`, `@types/react-dom`); `memory/delphy-agent-map.md` § "Tooling".

---

## 2026-05-25 — Token estimation: char-based heuristic, per-family multipliers

**Decision.** For the context compactor's token-budget tail, use a cheap character-based estimator with per-provider-family multipliers (`chars/3.5` Anthropic, `chars/4.0` OpenAI, `chars/4.5` Gemini). Do not ship `tiktoken` or `@anthropic-ai/tokenizer`.

**Why.** Principle #8 (small bundle). Each provider tokenizer is 1–3MB; we'd carry several. `chars/4` is the industry-standard rough estimate for transformer tokenizers — good enough at zero dep cost. Per-family multipliers add accuracy at zero dep cost on top of that.

**Alternatives considered.**
- Ship `tiktoken` per provider — rejected on bundle size.
- Flat `chars/4` across all providers — usable, but Anthropic and Gemini drift meaningfully in opposite directions; per-family is a free win.
- Call each provider's `count_tokens` API — adds latency and API cost to a hot path (estimator runs every turn).

**Escape hatch.** If observed drift causes thrashing or budget overruns in practice, a per-adapter tokenizer can be swapped in without touching compaction logic — the adapter contract owns the estimator.

**Lives in.** `docs/ARCHITECTURE.md` § "Sessions: prompts and compaction" → "Token estimation".

---

## 2026-05-25 — SQLite FTS5 from v1 (defer CJK trigram)

**Decision.** The initial schema migration includes an FTS5 virtual table over `messages.content` plus triggers to keep it in sync. The CJK trigram variant (a `messages_fts_trigram` auxiliary table) is deferred until a real user need surfaces.

**Why.** Adding FTS5 now is ~20 lines of SQL in the initial migration. Adding it later requires schema migration, backfill of every existing message, and risks data drift during the transition. UI for session search ships in v1.1 at earliest, but the index is ready.

**Alternatives considered.**
- LIKE queries — fine for tiny databases, dies at scale. Most users won't have giant histories on day one, but the ones who do are the ones who'll actually use search.
- External search index (Tantivy, Meilisearch) — overkill for embedded desktop scope, more processes to manage.
- Defer FTS5 entirely — locked us into a painful migration path.

**Lives in.** `docs/ARCHITECTURE.md` § "Storage layout" → SQLite schema.

---

## 2026-05-25 — Three-tier system prompt with cache-invalidation discipline

**Decision.** The direct-API agent loop builds the system prompt in three slices — `stable`, `context`, `volatile` — joined once per session. `stable` is **never** mutated mid-session. Mutating it from settings ends the current session and a fresh one is started on the next turn. `context` is rebuilt only when compaction runs. `volatile` is reserved for v1.

**Why.** Mid-session mutation of the system prompt nukes prompt caching, which is the single biggest token-cost lever in long sessions (principle #2). Astra rebuilt the system prompt every turn for journey stages — that's the anti-pattern we're avoiding. Anthropic's prompt-caching guidance is explicit on this: any mid-session mutation of the system prompt invalidates the cache. This rule is what the three-tier design is built around.

**Alternatives considered.**
- Free-form editable system prompt with no boundaries — easiest UX, but destroys caching on every edit.
- Disallow user edits to the system prompt entirely — too restrictive; users legitimately want persona changes.
- Soft warning on mid-session edit — users will dismiss and not understand the cost. The hard session-boundary is the honest signal.

**Lives in.** `docs/ARCHITECTURE.md` § "Sessions: prompts and compaction" → "Three-tier system prompt".

---

## 2026-05-25 — `ProviderProfile` as TS modules (defer JSON variant)

**Decision.** Each direct-API provider is implemented as a TypeScript module under `src/core/providers/` exporting a `ProviderProfile` object with `headers`, `prepareMessages`, `buildExtraBody`, `fetchModels`, `fixedTemperature`, etc. The `direct-api.ts` adapter loads the right profile by ID and never switches on provider directly. A JSON-based community contribution path is reserved for after the interface stabilizes.

**Why.** Per-provider quirks (Codex `fc_` ID rewriting, Gemini GET-with-body, Anthropic `cache_control` headers, OpenAI Responses item shape) are real and best expressed in code. A JSON DSL for the same quirks would be more code than just writing TS. Type safety catches profile mistakes at build time.

**Alternatives considered.**
- One file per provider as JSON — scales for community contribution but requires inventing a quirk DSL today, before the interface is stable.
- One TS adapter per provider — too much duplication; the shared shape is what makes the adapter pattern valuable.
- Adopted the standard plugin-registration pattern (`providers.register_provider(ProviderProfile(...))` at import time), simplified for ESM static imports — no dynamic registration.

**Forward path.** The `ProviderProfile` interface is designed so a future JSON loader can construct one from a config file without breaking existing TS profiles.

**Lives in.** `docs/ARCHITECTURE.md` § "The backend adapter pattern" + `src/core/providers/` in the repo layout.

---

## 2026-05-25 — Auxiliary model tier in v1

**Decision.** The app exposes two model selections in settings: **Main** (user-visible turn) and **Auxiliary** (compaction, title generation, search helper). Auxiliary calls route through a separate `AuxiliaryClient` over Vercel AI SDK. Default Auxiliary: Claude Haiku 4.5 if Anthropic is configured, else Gemini Flash if Google is configured, else fall back to the same model as Main with a warning.

**Why.** Compaction and titles don't need the premium model. Running them on Opus / GPT-5 burns user money and slows the loop. Principle #2 (token-frugal) makes this a default, not an optimization. One extra dropdown in settings is a fair price.

**Alternatives considered.**
- Defer to v1.1 — token costs would be visibly bad in v1 demos.
- Hard-code a specific Auxiliary model — loses user choice (especially around providers they already pay for).
- Single "model tier" picker with auto-derivation of Auxiliary — magic that's hard to reason about; explicit two-field is clearer.

**Lives in.** `docs/ARCHITECTURE.md` § "Sessions: prompts and compaction" → "Auxiliary model tier"; `docs/SPEC.md` § "Settings file"; `src/core/llm/auxiliary.ts` in the repo layout.

---

## 2026-05-25 — Add a head/middle/tail context compactor in v1

**Decision.** Implement head/middle/tail compaction in `src/core/session/compactor.ts` for direct-API mode in v1. Includes: head-protected first N messages, token-budget tail (not message count), middle-summarized via auxiliary model with the "reference-only" preamble, iterative previous-summary refinement, anti-thrashing skip rule, failure cooldown, and `/compact <focus>` for topic-focused compression. Estimated ~600 LOC of TS.

**Why.** Astra's "summarize at 85%" left long direct-API sessions degrading in quality after ~20 turns. Claude Code and Codex handle their own compaction; direct-API mode is on us. The head/middle/tail compaction pattern is the highest-leverage approach for keeping token spend bounded across long sessions — the work pays back the first time a real session crosses the threshold.

**Alternatives considered.**
- Defer to v1.1 — direct-API mode without good compaction is barely usable for the long sessions that justify a desktop app.
- Naive sliding window (drop oldest) — loses irrecoverable context; users hate it.
- Astra-style single LLM summary — too coarse; doesn't survive multiple compactions without drift.

**Lives in.** `docs/ARCHITECTURE.md` § "Sessions: prompts and compaction" → "Head / middle / tail compaction"; `src/core/session/compactor.ts` in the repo layout.
