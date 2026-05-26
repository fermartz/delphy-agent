# Decisions

Architectural and product decisions, newest first. Each entry: date, decision, why, alternatives considered, where it lives.

When a decision is later reversed, do not delete the entry — add a new dated entry that supersedes it and link back. The history matters.

> **A note on path references in this file.** Some entries below reference paths under `.hermes/plans/`, `.hermes/reviews/`, `memory/MEMORY.md`, and `memory/<project>-tasks.md`. These are local working artifacts of the project's plan → build → review workflow (see [BLUEPRINT.md](../BLUEPRINT.md)). They're gitignored from this repository and live only on the maintainer's filesystem. The references stay here as historical context for why each decision was made; treat them as pointers into a private working trail, not links you can follow from this repo.

---

## 2026-05-27 — Chrome ported from astra-cli; shadcn/ui + lucide-react installed

**Decision.** Ported astra-cli's visual chrome into Delphy Agent and installed `shadcn/ui` as the prebuilt-components library. New components: `src/components/brand-logo.tsx` (inline SVG copy of Astra's BrandLogo, viewBox 120×120, 4 corner radial gradients + dark base + black inner face + 20s blink loop on white-circle eyes); `src/components/theme-switcher.tsx` (shadcn `Button` + `DropdownMenu` with Lucide `Palette` + `Check` icons, picks current theme from `themes` state); `src/components/color-mode-toggle.tsx` (shadcn `Button` icon + Lucide `Sun` / `Moon` / `Monitor`, cycles light → dark → system); `src/components/status-bar.tsx` (`bg-muted` strip between chat scroll and chat input, two rows — row 1: `delphy-agent` (green-400) `|` current model (orange-400) on the left, activity text `Ready` / `Streaming…` / `Connecting…` on the right; row 2: `/help · /clear · /model · /compact` hints at `text-[11px] text-muted-foreground/50`); `src/components/settings-modal.tsx` (the existing SettingsModal extracted from `App.tsx` and migrated to shadcn `<Dialog>` + `<Select>` + `<RadioGroup>`).

Chat input migrated to the `bg-muted border-none rounded-lg` panel-style with a Lucide `Send` / `Loader2` button via shadcn `<Button variant="ghost" size="icon">`. All standalone action buttons (BootBanner Save / Try again, approval Approve / Deny, runtime-error Change API key, settings-error Retry) migrated to `<Button>` variants. The gear-icon → modal → dropdowns + radios UX is preserved unchanged; only the primitives changed.

Installed via `pnpm dlx shadcn@latest init --template vite --preset nova --css-variables` then `pnpm dlx shadcn@latest add button dialog select radio-group dropdown-menu`. The Nova preset bundles `lucide-react` (icons) + `@fontsource-variable/geist` (default sans). Added `@testing-library/react` + `@testing-library/user-event` + `@testing-library/jest-dom` as dev deps for a SettingsModal smoke test (`src/components/settings-modal.test.tsx`) — proves the theme `<Select>` change still calls `onThemeChange` post-migration, that Escape closes the dialog, and that the rendered surface has the expected accessible labels. Vitest globals enabled so testing-library's auto-cleanup runs between tests; setup file at `src/test-setup.ts` imports `@testing-library/jest-dom/vitest`.

shadcn init wrote its own `:root` + `.dark` color blocks into `src/index.css` that would have overridden the theme system's first-paint fallback; those blocks were manually removed and the perpetuity-light `:root` fallback restored. shadcn's `@theme inline` additions (`--radius-sm`/`md`/`lg`/`xl`/`2xl`/`3xl`/`4xl` derived from `--radius`) were kept since shadcn primitives reference them.

Path alias `@/*` → `src/*` added to `tsconfig.json` (`compilerOptions.paths`) and `vite.config.ts` (`resolve.alias`); vitest inherits the alias from the shared `vite.config.ts` (its `test:` block lives in the same file). Typography continues to be 100 % driven by `--font-sans` / `--font-mono` from the active theme JSON — the @theme inline maps `--font-sans` to `var(--font-sans)` so themes override correctly.

**Why.** The previous chrome looked like a developer prototype next to astra-cli; the user shared screenshots and asked for a verbatim port. shadcn install was deferred specifically until "a real shadcn-only component" arrived — the theme-picker DropdownMenu + the Dialog + Select + RadioGroup primitives all landed together, closing the deferral with one slice. The status-bar strip reserves a visible slot for future telemetry (model state, backend health, plugin status) without committing to its shape today.

**Alternatives considered.**
- **Hand-roll a small `<Button>` + inline Palette / Sun / Moon / Send SVGs.** Avoids the dep but loses radix's a11y + future-proofing for additional shadcn primitives. Rejected — the deferral was tied to a real need; this slice is that need.
- **Migrate to shadcn but leave the existing SettingsModal hand-rolled.** Inconsistent surface (new chrome shadcn-styled, old chrome hand-rolled). Rejected — the migration cost was small and the consistency win is real.
- **Add `AgentAvatar` (theme-tinted 2-tone logo) next to assistant messages in this slice.** Visually closer to Astra, but a separate optional polish step. Deferred — flagged in plan follow-ups.
- **Use a 2-state Sun/Moon toggle and drop "system" from the toggle (only in the modal).** Simpler icon, but loses the keyboard-fast way to flip to/from system mode. Rejected — 3-state cycle is fine; `Monitor` icon + tooltip carries the meaning.
- **Default theme → Cyberpunk to match the screenshots.** Cosmetic; Perpetuity stays default per existing settings.

**Lives in.** `components.json`; `src/lib/utils.ts`; `src/components/ui/{button,dialog,select,radio-group,dropdown-menu}.tsx` (shadcn-installed); `src/components/{brand-logo,theme-switcher,color-mode-toggle,status-bar,settings-modal}.tsx`; `src/components/settings-modal.test.tsx`; `src/test-setup.ts`; `src/App.tsx` (refactored header + input + extracted modal); `src/index.css` (perpetuity-light `:root` fallback restored after shadcn init; `@theme inline` extended with shadcn's radius scale); `tsconfig.json` + `vite.config.ts` (`@/*` alias; vitest globals); `package.json` + `pnpm-lock.yaml` (new deps).

**Supersedes.** Closes the "shadcn install" parameter from the 2026-05-26 theme-system plan (Parameter 6) — shadcn lands here with a real need.

---

## 2026-05-26 — Theme system shipped: JSON format + 6 built-ins + Tailwind v4 @theme inline + live watcher (closes BACKLOG #3)

**Decision.** Built the runtime theme system documented in `docs/THEMES.md`. Themes are JSON files validated by a Zod schema (`src/themes/schema.ts`). Six built-in themes ship statically imported from `src/themes/builtin/*.json` — mechanically ported from the predecessor astra-cli's CSS files (the earned color choices, re-shipped as JSON). User themes live in `app_data_dir()/themes/*.json` — the platform-native data dir resolved by Tauri (macOS `~/Library/Application Support/app.delphy.agent/themes/`, Linux `~/.local/share/app.delphy.agent/themes/`, Windows `%APPDATA%\app.delphy.agent\themes\`). A Tauri command `list_user_themes` scans the dir at startup; a `notify`-crate watcher spawned in `lib.rs::run`'s `.setup(|app| ...)` hook emits a `themes-changed` Tauri event on any FS change to a `*.json` file in that dir. The TS-side watcher subscriber (`src/themes/watcher.ts`) debounces 200 ms, then re-loads + re-injects + re-applies the current theme. **Drop a JSON file in the user-themes dir, see it in the picker live** — no app restart needed.

Tailwind v4's `@theme inline` directive in `src/index.css` maps Tailwind utility tokens (`bg-background`, `text-foreground`, `border-border`, etc.) onto CSS variables. Per-theme `<style>` rules are JS-injected with selectors `[data-theme="<id>"]` (light) and `[data-theme="<id>"].dark` (dark) — `applyTheme(themeId, mode)` sets `data-theme` on `<html>` and toggles the `.dark` class. Color-mode "system" reads `matchMedia("(prefers-color-scheme: dark)")` and reacts to OS theme changes via a `change` listener (returned cleanup removes it on mode change / unmount). The settings modal in `App.tsx` exposes a Theme dropdown + a Light / Dark / System radio row; both persist via the existing `selected_theme` and `color_mode` settings fields (introduced by the slice #2 settings file but unused until now). The core chat surface — header, chat input, chat items (user-text / assistant-text / system / tool-call / tool-result), the settings modal body, toast — uses theme-token classes. Semantic colors that don't map cleanly to the standard token set (BootBanner amber, runtime-error red, approval-card amber) stay explicit by design — see plan Parameter 8.

Invalid user themes are dropped with `console.warn` naming the file + parse / validation error; the rest continue to load. A visible-toast variant is a future polish slice. shadcn is NOT installed — the theme system works without it; shadcn lands when a real shadcn-only component is needed.

**Why.** Visual polish for the public OSS project — the current chat surface uses raw Tailwind neutrals and looks like a developer prototype. Themes make screenshots inviting + give external contributors a clear surface to play with. Also activates the `selected_theme` + `color_mode` settings fields that have been dead since slice #2. The live watcher is in scope (not a follow-up) because theme authoring is the project's most accessible extensibility surface, and restart-to-see-changes is the kind of friction that silently kills theme contributors before they ever complain.

**Alternatives considered.**
- **Install shadcn first; build theme picker as shadcn `Select` + `RadioGroup`.** Adds a dep + ~200 lines of shadcn boilerplate for a slice whose primary goal is theme infrastructure. Rejected — shadcn lands when a real shadcn-only component is needed.
- **Hardcode 6 themes into TS modules; skip the JSON file format.** Loses extensibility — users can't drop a JSON file to add a theme. Rejected per Goal #1 in `docs/THEMES.md`.
- **Defer the file watcher to a follow-up slice.** Initial rev-1 default; reversed in rev 2 of the plan. The drop-restart-look workflow is enough friction to silently kill theme contributors; restoring the live-watch UX matches `docs/THEMES.md`'s stated promise and costs only ~40 LOC Rust + ~10 LOC TS.
- **Honor `docs/THEMES.md`'s literal `~/.config/` path on macOS / Linux.** Inconsistent with the slice #2 settings-file supersession. Rejected — match `app_data_dir()` for consistency.
- **Full App.tsx Tailwind migration.** Doubles the slice. Rejected per plan Parameter 8 — core chat surface migration is enough for the visible win.
- **Visible toast on theme load failure.** Defer to a future polish slice; `console.warn` is enough for v1.

**Lives in.** `src/themes/*` (`types.ts`, `schema.ts`, `registry.ts`, `loader.ts`, `inject.ts`, `apply.ts`, `watcher.ts` + matching `*.test.ts`); `src/themes/builtin/*.json` (6 themes — perpetuity, cosmic-night, vercel, ocean-breeze, cyberpunk, cyber-wave); `src/index.css` (`@theme inline { ... }` block + `:root` fallback values for pre-load first paint); `src/App.tsx` (theme loader effect + apply effect + watcher subscription + picker UI in SettingsModal + Tailwind class migration on core chat surface); `src-tauri/src/themes.rs` (`list_user_themes` Tauri command + `setup_user_themes_watcher` setup-hook helper); `src-tauri/src/lib.rs` (`themes` module + invoke-handler entry + `.setup(...)` call); `src-tauri/Cargo.toml` (`notify = "8.2"`); `src-tauri/permissions/themes.toml` + `src-tauri/capabilities/default.json` (`allow-list-user-themes` permission); `docs/THEMES.md` (path → `app_data_dir()`; invalid-theme UX → `console.warn`); `biome.json` (`css.parser.tailwindDirectives = true` so Biome accepts `@theme inline`).

**Supersedes.** The path portion of the 2026-05-25 `docs/THEMES.md` § "Where themes live" — `~/.config/delphy-agent/themes/` → `app_data_dir()/themes/` — for the same rationale as the slice #2 settings-file path supersession.

---

## 2026-05-26 — Compactor B.2 shipped: automatic threshold-triggered compaction (closes BACKLOG #8 + v1 direct-API)

**Decision.** Direct-API mode now auto-triggers head/middle/tail compaction before the next chat turn when `tokensUsed > CONTEXT_LIMIT_TOKENS * AUTO_COMPACT_THRESHOLD` (default 0.85). The trigger lives in `DirectApiSession.sendMessage`, AFTER appending the user message + computing `tokensUsed`, BEFORE `streamText`. Anti-thrashing (constant `ANTI_THRASHING_MIN_SAVED_RATIO`, default 0.10) skips the trigger if the most recent compaction saved less than 10% of tokens — prevents churn. Manual `/compact` is exempt from anti-thrashing. On auxiliary failure, `runAutoCompaction` catches the error, emits a `system_message` describing the failure, and lets the chat turn proceed with the un-compacted messages array (no dedicated cooldown state — see "alternatives considered"). Auxiliary calls during auto-compaction route through the same `currentAbort` AbortController that `streamText` uses (hoisted to be created at the top of `sendMessage` so the controller exists when `runAutoCompaction` reads its signal); `interrupt()` cancels both via one `abort()` call.

The user-visible feedback surface is a new `AgentEvent` variant `{ type: "system_message"; text: string }`, routed by `App.tsx` to the existing `system` ChatItem renderer (the same neutral-gray-italic item kind shipped by the slash-command slice). Three banners per auto-trigger fire: pre ("Compacting older turns to free context budget…"), post-success ("Auto-compacted: N → M messages, ~X tokens saved."), or post-failure ("Auto-compaction failed (<reason>); continuing with un-compacted history."). Manual `/compact` continues to surface its result via the slash-command dispatcher's existing `system` ChatItem path (one banner with the same metrics format).

**Why.** Closes BACKLOG #8 + v1 direct-API. B.1 shipped the algorithm + manual `/compact`; B.2 adds the trigger logic so long conversations stay bounded without the user noticing the threshold themselves. Anti-thrashing prevents pathological repeated-compaction loops. The new `system_message` variant (rather than reusing the existing `text` event channel) is required because `text` events flow through `appendTextToInFlight` and would concatenate the auto-compaction banner into the streaming assistant reply bubble.

**Alternatives considered.**
- **Skip auto-trigger; ship v1 with only manual `/compact`.** Leaves the UX gap of users hitting context limits silently. Rejected.
- **Reuse the existing `text` AgentEvent for auto-compaction banners.** Initially proposed in rev 1 of the B.2 plan; rejected after the round-1 review caught that text events merge into the streaming assistant bubble. New `system_message` event added instead.
- **Add a separate `compactionAbort` AbortController.** Equivalent functionally to hoisting `currentAbort`; rejected as more complexity for no benefit.
- **Any form of dedicated failure-cooldown state** (turn-based, time-based, or attempt-counted). Considered in rev 1 of the B.2 plan; rejected after round-1 review: with single-check-per-`sendMessage` design, no flag suppresses anything (cleared at top before the check fires, and there's no in-turn retry to suppress anyway). Swallow-and-proceed already prevents retry loops without needing state.
- **Configurable threshold (user-facing setting).** Premature — most users don't know what tokens are. Revisit when a real reason surfaces.
- **Parallelize auxiliary compaction with the user's next stream.** Substantial complexity (partial state, cache invalidation, interruption) for marginal benefit. Rejected — sequential is fine; Haiku is fast.

**Lives in.** `src/core/adapters/direct-api.ts` (constants `AUTO_COMPACT_THRESHOLD` + `ANTI_THRASHING_MIN_SAVED_RATIO`; two private fields `lastCompactionSavedRatio` + `compactionInFlight`; hoisted `currentAbort` creation; trigger check + `runAutoCompaction()` method; minor update to manual `compact()` to set `lastCompactionSavedRatio`); `src/core/types.ts` (`system_message` AgentEvent variant); `src/core/session/compactor.ts` (`compactMessages` extended with optional `signal?: AbortSignal` parameter, threaded to `aux.complete`); `src/App.tsx` (new `case "system_message":` in the event-loop switch, finalizing any in-flight streaming assistant message then appending a `system` ChatItem); `direct-api.test.ts` (4 new tests: below-threshold no-trigger; above-threshold trigger emits pre + post banners; auxiliary failure emits failure banner + chat continues; anti-thrashing skips after low-ratio prior compaction).

**Supersedes.** Closes the pending-in-B.2 portion of the 2026-05-26 "Compactor slice split: B → B.1 + B.2" decision. **v1 direct-API mode is now feature-complete.**

---

## 2026-05-26 — Compactor slice split: B → B.1 + B.2; compaction mutates `messages` array (not three-tier `context` slot)

**Decision.** This decision has two coupled parts.

*Part 1 — slice split.* The 2026-05-26 "v1 direct-API ships in two slices" decision committed to ONE slice for the compactor (Slice B). This decision splits that slice into **B.1** (manual `/compact` + AuxiliaryClient + compactor algorithm; ships now) and **B.2** (automatic threshold-based triggering + anti-thrashing + cooldown; future slice). The architectural choices established in prior decisions — head/middle/tail compaction (2026-05-25); AuxiliaryClient with Claude Haiku 4.5 default (2026-05-25 "Auxiliary model tier in v1"); ProviderProfile pattern (2026-05-25) — are unchanged and re-applied here.

*Part 2 — compaction lives in messages array, not three-tier `context` slot.* The prior two-slice decision said "the direct-API adapter compacts the `context` slot when usage crosses the threshold." That framing was imprecise. The three-tier system prompt (including its `context` slot) must not mutate mid-session per the 2026-05-25 cache-discipline decision — any change to the system block invalidates Anthropic prompt caching, which is the biggest token-cost lever in long sessions. Compaction in B.1 lives entirely in the `messages: ModelMessage[]` array within `DirectApiSession`: head + summary + tail. The three-tier prompt's `context` slot stays empty in v1; it's reserved for cross-session content (a summary of the prior session, loaded at session-resume time — BACKLOG #4 SQLite persistence).

**Why split.** The original single-slice scope was ~600 LOC of compactor + AuxiliaryClient + adapter integration + threshold-trigger wiring + tests + docs in one PR. Splitting yields two tractable slices, each independently reviewable. B.1 alone delivers user-visible value (manual `/compact` via the slash-command dispatcher from the prior slice) without waiting on the threshold-detection logic. Net cost: one extra commit boundary; net benefit: each half is reviewable and the algorithm half ships first.

**Why messages-array, not context slot.** Cache discipline. The system prompt must not mutate; the messages array is allowed to mutate freely (only the system block contributes to the cache key beyond the user/assistant turns). Compaction in the messages array preserves the cache on the system block; the rest of the cache is naturally invalidated when messages change (which happens every turn anyway). The "context slot" framing in the prior decision conflated cross-session content (load-time, immutable) with in-session compaction (turn-time, mutable). This decision separates them.

**Alternatives considered.**
- **Single-slice compactor (per original decision).** Larger scope, longer review cycle, less incremental value. Rejected on tractability.
- **Compact the context slot anyway, ignore cache discipline.** Would invalidate prompt caching on every compaction — the single biggest token-cost lever evaporates. Rejected.
- **Defer compactor entirely until SQLite persistence ships (so context-slot population has a real home).** Locks the long-session UX gap open indefinitely. Rejected.
- **Use the messages array for auto-compaction but pretend that's still "context slot."** Sloppy. Rejected — the decision should be precise about where mutation happens.

**What B.1 ships (concretely).**
- `src/core/llm/auxiliary.ts` — `AuxiliaryClient` (non-streaming, Anthropic via Vercel AI SDK `generateText`, defaults to `claude-haiku-4-5`).
- `src/core/session/compactor.ts` — pure `compactMessages` function. Head + token-budget tail walk-backward + middle summarization + iterative-recompaction via sentinel detection.
- `Session.compact(focus?)` interface extension. Echo: no-op error. DirectApiSession: instantiates aux + runs compactor + mutates `this.messages`.
- `/compact [<focus>]` slash command, registered alongside `/help`, `/clear`, `/model` in the existing dispatcher.
- `SessionOptions.auxiliaryModelId` extension, threaded via `boot.ts` from `settings.auxiliary_model`. New test pins the pass-through contract.
- 17 new tests (3 auxiliary + 7 compactor + 4 compact-handler + 1 dispatch-`/compact` + 1 boot auxiliary pass-through + 1 boot adjusted to assert both modelId + auxiliaryModelId).

**B.2 still to ship.** Automatic threshold-based compaction (fires when usage crosses ~85% of context window before the next turn) + anti-thrashing rule (skip if recent compaction yielded <10% savings) + failure cooldown (wait until next user turn after a failed auxiliary call).

**Lives in.** `src/core/llm/auxiliary.ts` + `auxiliary.test.ts`; `src/core/session/compactor.ts` + `compactor.test.ts`; `src/core/types.ts` (Session.compact signature, SessionOptions.auxiliaryModelId, CompactResult type); `src/core/adapters/{echo,direct-api}.ts` (no-op + real impl); `src/core/boot.ts` + `boot.test.ts`; `src/core/commands/compact.ts` + tests; `src/core/commands/index.ts` (registry); `src/core/commands/types.ts` (CommandContext.compactSession); `src/App.tsx` (ctx wiring); `docs/SPEC.md` § "Built-in slash commands" (`/compact` row + error shapes); `docs/ARCHITECTURE.md` § "Head / middle / tail compaction" (refined prose); this entry.

**Supersedes.** The slicing portion of the 2026-05-26 "v1 direct-API ships in two slices" decision (now three slices: A + B.1 + B.2). The "context slot" implementation-detail wording in that same decision is also refined here — replaced with "the messages array within the active session." All other architectural choices in that decision and its predecessors stand.

---

## 2026-05-26 — Slash-command dispatcher in the chat input

**Decision.** Chat input lines starting with `/<name>` (where `<name>` is one-or-more `[a-zA-Z0-9_-]` characters) are parsed as **built-in commands** and dispatched to local handlers instead of being sent to the LLM. Three commands ship with this slice: `/help` lists registered commands; `/clear` wipes chat history and restarts the session; `/model [<id>]` with no arg opens the settings model picker, with an `<id>` validates against `fetchModels()` then saves + restarts the session. Output renders as `system` chat items (neutral gray italic). Everything that doesn't match the strict `/<alnum>` shape (e.g., `//`, `/ `, `///`, mid-line `/`) falls through to the existing send-to-LLM path. External v1 contract for the three commands + error shapes lives in `docs/SPEC.md` § "Built-in slash commands."

**Why.** Keyboard-driven UX for power users; closes the model-stickiness UX gap from the 2026-05-26 settings slice (typed model change takes effect immediately, no UI clicks, no close+reopen). Establishes the dispatch surface for future commands the compactor decision already names (`/compact <focus>`), MCP-tool commands when those arrive (BACKLOG #6), and user-defined custom commands later. Slash is the established convention across agent CLIs (claude code, codex) and chat tools (slack, discord) — deviating buys nothing.

**Alternatives considered.**
- **No slash commands; require UI clicks for every action.** Simpler but locks the keyboard-flow UX gap open; future `/compact <focus>` is canonically a slash command.
- **Custom syntax (e.g., `!model claude-opus-4-7`).** Slash is the established convention; deviating fragments user mental model.
- **Defer commands until MCP lands** so the surface is unified with MCP tools (BACKLOG #6). Leaves the immediate UX gap open too long; built-ins are local-only and don't conflict with future MCP tools (the collision-handling decision lives with the MCP slice).
- **Single combined `/restart` + `/clear` command.** Their semantic difference (one wipes history, one preserves it) is meaningful; collapsing them costs more than it saves. We DID defer a separate `/restart` to follow-up, since `/clear` covers the common case and `/model <id>` covers the other.

**Adding a new command.** Each command is a single file under `src/core/commands/` exporting a default `Command` object: `{ name, description, argHelp?, handler(args, ctx) }`. Register the command in `src/core/commands/index.ts` via `registerCommand(cmd)` at module load. The handler receives the parsed args string and a `CommandContext` providing `settings`, `triggerReboot`, `restartSession`, `openSettings`, `saveSettings`, and `fetchModels`. The dispatch seam is `dispatchInput(text, ctx)` in `src/core/commands/dispatch.ts` — App.tsx::handleSubmit is a thin wrapper around it. `parseInput` is the shared parser. `system` chat-item rendering lives in `App.tsx::renderItem`.

**Lives in.** `src/core/commands/*` (types, parser, registry, dispatch, three command files, barrel index, tests); `src/App.tsx` (parseInput-via-dispatchInput integration + `restartSession()` helper + `system` chat-item rendering); `docs/SPEC.md` § "Built-in slash commands" (external contract); this entry (internal implementation guidance).

**Supersession.** None — first slash-command decision. Foundational.

---

## 2026-05-26 — Settings persistence via `tauri-plugin-store`; supersede settings-file path to `app_data_dir()`

**Decision.** This decision has two coupled parts.

*Part 1 — persistence primitive.* Use `tauri-plugin-store` (Tauri-native, JSON-backed, atomic write) for app-level user preferences (`tauri-plugin-store` 2.4.3 Rust + `@tauri-apps/plugin-store` 2.4.3 JS). Settings file format matches the existing `docs/SPEC.md` § "Settings file" schema: snake_case field names, `$schema: "https://delphy.app/schemas/settings/v1.json"`, six documented fields (`selected_theme`, `color_mode`, `default_backend`, `main_model`, `auxiliary_model`, `window_state`) plus the schema URL, **unknown keys preserved on write** for forward compatibility. Load semantics: read JSON → merge known keys over `DEFAULT_SETTINGS` → log + default-fall-back for invalid known-field values (including explicit `null` for fields whose validator rejects it) → pass unknown keys through unchanged on the next save. Save semantics: partial merge over current → write atomically through the plugin (`autoSave: false`; explicit `store.save()` after each `set` for clean save+toast timing).

*Part 2 — path supersession.* Use `app_data_dir()/settings.json` per Tauri's platform-native path convention, **not** the `~/.config/delphy-agent/...` path documented in earlier versions of `docs/SPEC.md`. The spec's path was XDG style applied uniformly; on macOS this was incorrect (native convention is `~/Library/Application Support/...`). With bundle identifier `app.delphy.agent`, the actual paths are: macOS `~/Library/Application Support/app.delphy.agent/settings.json`, Linux `~/.local/share/app.delphy.agent/settings.json`, Windows `%APPDATA%\app.delphy.agent\settings.json`. `docs/SPEC.md` § "Settings file" was updated in this slice to reflect the new path. The example JSON's `default_backend` value was also corrected from a stale `"claude-api"` to the actual registered adapter `id` `"anthropic-api"`. Only the path portion of the spec is superseded; field shape and semantics are unchanged from spec.

**Why.**

*Persistence primitive.*
- `tauri-plugin-store` gives atomic-write semantics for free (the plugin handles tmp-write + rename internally), without us touching Rust file-system code beyond plugin registration.
- JSON is human-debuggable — power users can edit the file directly per the spec's stated intent.
- No bespoke Tauri commands to write, no new capabilities pattern to invent. The plugin's `store:default` permission identifier is the same shape as our `allow-get-secret` etc. permissions from slice A.

*Path.* The plugin's default resolves relative paths to `app_data_dir()`, which is platform-native. Fighting it (to honor the spec's literal XDG-style path) would add code without value: macOS users land in the convention they expect, Linux users still get `~/.local/share/` (close enough to `~/.config/` to feel right), Windows users get `%APPDATA%` (matching the spec). Net win without the macOS-correctness compromise.

**Alternatives considered (persistence primitive).**
- Custom Tauri commands wrapping raw `fs` writes — extra Rust code for a problem the plugin already solves; loses atomic-write guarantees.
- SQLite key-value table — over-engineering for ~6 small fields; SQLite lands with BACKLOG #4 for session/message persistence.
- `localStorage` in the webview — survives reload but not app restart in Tauri; wrong primitive for "user preferences across sessions."

**Alternatives considered (path).**
- Honor the spec exactly (`~/.config/delphy-agent/...` everywhere) — requires fighting `tauri-plugin-store`'s defaults; gets macOS conventions wrong.
- Use a different XDG-compliant base only on Linux + native elsewhere — adds platform-branched logic for no real win.

**What this slice ships.**
- All six spec-documented fields exist in defaults; only `main_model` is wired to a UI control in this slice. UI controls for `selected_theme` + `color_mode` land with BACKLOG #3 (theme system); `auxiliary_model` picker lands with BACKLOG #8 (compactor). `default_backend` picker lands when there are 2+ backends to choose from. `window_state` is defaulted-and-preserved (no UI yet; written by a future window-state slice).
- A gear-icon button in the chat header opens a Tailwind-only modal with the current model + a dropdown populated by `anthropicProfile.fetchModels()`. Changes save via `saveSettings({ main_model })`, close the modal, and surface a toast: "Model updated — applies on next session." The dropdown sublabel reminds users: "Changes apply when you start a new chat — your current conversation keeps its model." The in-flight `Session` keeps its bound model — Anthropic prompt-cache discipline requires immutable model+messages within a session.
- `boot.ts` reads settings + passes `main_model` through to `directApiAdapter.start({ modelId })`. `SessionOptions` extended with optional `modelId?: string`.
- `fetchModels` now correctly includes the `anthropic-dangerous-direct-browser-access: true` header (bug fix discovered during this slice's manual verification; the chat path had it via `streamText`, but the separate `/v1/models` fetch was missing it).

**Lives in.** `src/core/settings/{types.ts, defaults.ts, settings.ts}` + tests; `src-tauri/src/lib.rs` (plugin registration); `src-tauri/capabilities/default.json` (`store:default` permission); `package.json` + `src-tauri/Cargo.toml` (deps); `docs/SPEC.md` § "Settings file" (path + example value update).

**Supersedes.** The path portion of the 2026-05-25 settings-file specification in `docs/SPEC.md`. Field shape, $schema URL, and load/save semantics unchanged. The 2026-05-25 "Auxiliary model tier in v1" decision is honored — the `auxiliary_model` field is present in the file with default `claude-haiku-4-5`; UI control deferral to BACKLOG #8 is consistent with that decision's "exposes two model selections in settings" requirement (file-level exposure now, UI exposure when the auxiliary client itself ships).

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
