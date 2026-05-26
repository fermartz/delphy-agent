# Lessons from Astra CLI

Reference doc capturing patterns we are deliberately carrying forward from astra-cli into Delphy Agent. Each pattern was earned the hard way in Astra — they're not theoretical. They should not be re-derived from scratch.

- For the *principles*: `VISION.md`
- For the *current design*: `ARCHITECTURE.md`
- For Astra-specific *anti-patterns* we are not repeating: `ARCHITECTURE.md` § "What we explicitly do NOT do"

The original implementation lives in the `astra-cli` repository (separately maintained). This document carries forward only the lessons; no Astra code is imported.

---

## Security & credential handling

### Atomic writes for sensitive files

**The lesson.** A crash mid-write (`fs.writeFileSync` interrupted) leaves a half-written credentials file. The next launch either fails to parse or partially-parses to a state that looks valid but isn't. We lost wallets this way during early Astra dev.

**The pattern.** Write to a temp file in the same directory, fsync, then rename atomically over the target. POSIX rename is atomic; on Windows use `MoveFileEx` with `MOVEFILE_REPLACE_EXISTING`.

**Where in Delphy.** Any file we write that the user can't easily regenerate: secret store blob, audit log rotation, user-edited theme files, exported session bundles. SQLite handles its own durability via WAL; we own the rest.

### File permissions: 600 for files, 700 for directories

**The lesson.** Default umask on macOS/Linux leaves credential files world-readable. Other local processes can read them.

**The pattern.** After creating any file containing a secret, immediately `chmod 600`. After creating any directory containing such files, `chmod 700`. Do not rely on umask.

**Where in Delphy.** Rust-side file creation for the secret store, audit log, anything under `~/.config/delphy-agent/` that may contain user data. Set the mode explicitly when opening the file (`OpenOptions::mode(0o600)`), not as a post-creation step.

### Directory traversal validation

**The lesson.** Any path that comes from user input — or worse, an LLM tool call — can contain `../../../etc/passwd`. `path.join()` does NOT prevent this; it happily traverses.

**The pattern.** `path.resolve()` to canonicalize, then verify the result starts with the expected root prefix. If it doesn't, reject. In Astra this was `agentDir()`.

**Where in Delphy.** Tauri commands that take a path argument: `read_user_theme()`, `write_user_theme()`, any future file-touching MCP bridge command. Also any tool the agent loop exposes that takes a path string.

---

## Reliability under failure

### Layered timeouts for streaming LLM calls

**The lesson.** A single overall timeout is wrong for streaming. The model may legitimately take 90 seconds for a long response. But if it goes idle for 30 seconds with no new tokens, something has broken (network stall, server hang) and the user is staring at a frozen UI.

**The pattern.** Two timeouts on every streaming call, both wired to one `AbortController`:
- **Overall** (Astra: 3 min, env-overridable) — the absolute cap
- **Idle** (Astra: 30 s) — resets on each chunk; if no chunk for this long, abort

User-visible errors should distinguish "took too long" from "went silent."

**Where in Delphy.** `direct-api.ts` streaming. Codex JSONL parser (idle = no JSONL line for N seconds). Claude Code SDK queries. The auxiliary client's compaction call (especially — a stalled compactor can wedge the whole agent loop).

### Resilient retry on empty / broken responses

**The lesson.** Sometimes a model returns an empty response, or returns tool calls without any explanatory text, or finishes with no signal at all. Bare retries are wasteful; smart retries nudge.

**The pattern (two layers from Astra).**
- **Layer 1** (provider-specific): when tools ran but no text was returned, send a follow-up "summarize what just happened" nudge before falling through to error
- **Layer 2** (universal): detect sentinel empty responses, stream a visible "Hold on..." message to the user so they don't think the app is broken, then retry once with a nudge

**Where in Delphy.** `direct-api.ts` only. The `claude-code` and `codex` adapters defer to their backends — surface failures cleanly but don't second-guess them.

### Emergency compaction without LLM

**The lesson.** If the auxiliary LLM is unreachable when compaction is triggered (network down, rate limited, auth expired), the user shouldn't be locked out of their conversation. There must be a fallback.

**The pattern.** A no-LLM `forceCompact()` that keeps the last N user messages and drops everything else, with a visible-to-user note that smart compaction failed. Better degraded than broken.

**Where in Delphy.** `core/session/compactor.ts`. Triggered automatically after the failure-cooldown rule (see ARCHITECTURE.md § "Head/middle/tail compaction") if compaction has failed N times in a row.

### Cache state before risky operations, clear on confirmed success

**The lesson.** In Astra this was the *pending claim cache*: write the claim blob to disk before signing/sending the Solana transaction, clear it only after on-chain confirmation. If the user crashed mid-flow, the next launch resumed cleanly instead of leaving them in an inconsistent half-signed state.

**The pattern.** For any operation that has external side effects and isn't idempotent: persist the intent before executing, mark complete only on confirmed success, expose a resume path on next launch.

**Where in Delphy.** Less common here — most tool calls go through MCP servers that own their own state. But applies to: any settings change that involves an external service (OAuth flow completion, MCP server config that triggers an install), or any future "agent commits to an action that takes time" feature.

---

## Observability

### Audit logging

**The lesson.** When something goes wrong with a tool call you need a forensic trail. But naive logging dumps secrets into the log file, which is worse than no log.

**The pattern.** NDJSON, one JSON object per line, with these properties:
- **Sanitized:** known secret-shaped values (Bearer tokens, `sk-...`, base64 of certain lengths) redacted before write
- **Rotated:** when the file passes 10MB, rename to `audit.log.1`, start fresh; keep the last 3
- **Permissioned:** stored at `~/.config/delphy-agent/audit.log` with chmod 600

**Where in Delphy.** Every tool call (MCP, native backend tools we see via approval flow). Backend switches. Settings changes that touch credentials. **Not** message content itself — that lives in the session DB. Log entries should be small and structured; this isn't a debug stream.

---

## Provider quirks (lift into `ProviderProfile` modules)

These belong inside each provider's profile, not in shared adapter code. Hiding them in shared code is how the Astra provider routing got tangled.

### Gemini GET-with-body

**The lesson.** Gemini sometimes calls tools with `method: "GET"` but supplies a body. HTTP `GET` should not have a body. Some HTTP clients silently drop it; some servers reject it.

**The pattern.** When the tool's HTTP method is GET, serialize the body into query string parameters before sending. Belt-and-braces: keep a defensive check in the HTTP client that warns if a GET arrives with a body anyway.

**Where in Delphy.** The `google` (Gemini) ProviderProfile under `src/core/providers/`. Document the quirk in the profile, don't bury it.

### Codex `fc_` ID requirement

**The lesson.** Codex's Responses API requires `function_call` items to have an `id` starting with `fc_`. Carrying over an ID from another provider (`call_`, `toolu_`, etc.) breaks the next turn.

**The pattern.** When converting tool calls to Codex input format, rewrite IDs to the `fc_` prefix.

**Where in Delphy.** Only relevant if we ever drop the `codex exec` subprocess in favor of the raw Responses API. We aren't planning to. But if that ever changes, this is the trap.

### Anthropic `cache_control` headers

**The lesson.** Prompt caching with Anthropic isn't automatic — you must mark the cacheable boundary with `cache_control: { type: "ephemeral" }`. Forget this and you pay full price every turn. (Astra didn't do this consistently. We are fixing that here.)

**The pattern.** The `anthropic` ProviderProfile injects `cache_control` markers at the end of the `stable` slice of the three-tier system prompt — and nowhere else, because mid-prompt cache markers can sabotage the cache.

**Where in Delphy.** The `anthropic` ProviderProfile, applied in `prepareMessages`. Combined with the immutable-system-prompt discipline (see ARCHITECTURE.md § "Three-tier system prompt"), this is the single biggest token-savings win.

---

## Test isolation

### Config-root env override

**The lesson.** Tests that touch the real `~/.config/<app>/` directory can corrupt the user's actual config and behave differently in CI than locally.

**The pattern.** A single env var overrides the config root for all paths. Tests set it to a tmpdir; the live app ignores it. Astra used `ASTRA_TEST_DIR`.

**Where in Delphy.** `DELPHY_CONFIG_ROOT`. Wire it through the Rust resolution of the user config directory (`src-tauri/src/lib.rs`). All Tauri commands that touch user paths must respect it.

---

## What we are explicitly NOT carrying forward

These were Astra-specific or anti-patterns we are correcting. Documented here so they're not re-derived:

- **Journey-stage system prompt branching** (`fresh → pending → verified → ...`). AstraNova-specific UX shape; doesn't generalize. Replaced by the three-tier prompt with cache discipline.
- **Pending claim cache for Solana transactions** *(the implementation)*. The underlying pattern — cache intent before a risky op, clear on success — generalizes (see "Cache state before risky operations" above). The specific blob shape doesn't.
- **Hand-rolled agent loop with provider-specific branches.** Replaced by the `BackendAdapter` interface + `ProviderProfile` modules.
- **Custom OpenAI Responses API SSE handler** (`runResponsesApiTurn`, `codex-provider.ts`, ~600 LOC). Replaced by Vercel AI SDK v5 (direct API) and spawned `codex exec --json` (Codex). Net deletion vs. Astra: ~600 lines.
- **Ink TUI, xterm.js, node-pty, Node sidecar bundle.** Replaced by webview + thin Rust.
- **Hard-coded plugin registry (`PLUGIN_REGISTRY`).** Replaced by the MCP-as-plugin model. No built-in plugins in Delphy.
- **Per-tool retry logic baked into `api_call`.** Replaced by retry at the adapter and HTTP layers, leaving tools simple.
