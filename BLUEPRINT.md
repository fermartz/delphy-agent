 # How We Work

  ## Agent Workflow

  Standard loop: **plan → build → review → fix → SWEEP → verify → re-review (loop) → approve**.

  `SWEEP` is a blocking step (not optional, not end-of-slice-only) — see `## Between Review Iterations` below.

  - **Planner** writes the plan (you, or another agent driving the workflow).
  - **Builder** implements (Claude Code).
  - **Reviewer** audits the diff (Codex CLI, or another model).
  - **Builder** fixes blockers, re-verifies.
  - **User** approves.

  Plans live in `.hermes/plans/`. Reviews live in `.hermes/reviews/` (only written when verdict is REQUEST_CHANGES).

  ### File naming (MUST follow)
  - Plans: `YYYY-MM-DD_feature-name.md` (revisions: `_r1`, `_r2`, etc.)
  - Reviews: `YYYY-MM-DD_feature-name.md` (same convention as plans)

  ## Before Implementing

  1. Read the source map and task file (see Memory Artifacts).
  2. Read relevant docs/schemas/examples for the area you're touching.
  3. Identify the files likely to change.
  4. For non-trivial work, write a brief plan in `.hermes/plans/` and get user approval BEFORE coding.
  5. Make the smallest clean change that satisfies the task. No unrelated rewrites.

  ### Plan scope and size

  Plans should be **concise** — aim for **under 200 lines**. A plan is a contract for *what* to build and *why*, not a design spec for *how*. Implementation details (state machines, pseudocode, message shapes, exact type signatures) belong in the code, not the plan.

  **What belongs in a plan:** slice purpose, success criteria, scope (in/out), key design decisions (locked parameters), checkpoints, risks with mitigations.

  **What does NOT belong:** pseudocode, exact function signatures, exhaustive type definitions, step-by-step state transitions, SDK type spellings. These create a second source of truth that the reviewer audits for consistency with the code — generating review rounds that catch documentation drift, not real bugs.

  **Lesson learned (slice B, 2026-05-28):** the MCP slice B plan grew to 339 lines / 70KB across 4 revision rounds. Each round added more implementation detail to "fix" a reviewer finding, which created new surface area for the next round to catch. The reviews were accurate but the errors were self-inflicted — caused by the plan over-specifying things that should have been decided during implementation.

  ## Before Finishing

  Run the project's verification suite. Example shape:
  ```bash
  [test command]
  [lint / typecheck]
  [schema / artifact checks]
  git diff --check
  ```

  After verification passes, give the user a tailored review command. Template:
  ```
  ! codex exec "Review the uncommitted diff. Plan: .hermes/plans/<plan-file>.md. Check: spec compliance, bugs, missing
  tests, security, scope creep, overengineering. Do not modify files. Be concise — output ONLY the word APPROVED or
  REQUEST_CHANGES followed by a one-line summary. If REQUEST_CHANGES, also write the full details to
  .hermes/reviews/<task-name>.md"
  ```

  - If REQUEST_CHANGES → read the review file, fix blockers, **run the Between-Review-Iterations sweep below**, re-verify, request re-review.
  - If APPROVED → proceed.
  - Record the verdict in the task DONE entry.

  ## Between Review Iterations

  **BLOCKING STEP after every code fix, before re-issuing the review.** Skipping this is the most common cause of multi-round review loops where each round catches new artifact drift.

  Procedure:

  1. **List what the fix changed.** Concretely: new identifiers introduced, old identifiers removed, file paths created/moved/deleted, design phrases that no longer match shipped reality (e.g. "stdin writer task" → "inline write"). Write the list down explicitly — don't rely on memory.
  2. **Grep each removed/changed term** across `MEMORY.md` + `<project>-map.md` + `<project>-tasks.md` + `docs/DECISIONS.md` + `docs/ARCHITECTURE.md` + the active plan file. Example: `grep -rn 'stdin_tx\|spawn_stdin_writer\|mpsc::Sender' <files>`. Cast the net wider than you think you need.
  3. **For each hit, decide:** (a) update to the shipped wording, or (b) contextualize as historical narrative ("plan initially proposed... build-review round N caught..."). Both are valid; silence isn't.
  4. **Run the verification suite** (tests / lint / typecheck / build / cargo / `git diff --check`).
  5. **Re-grep with the same terms one more time.** If anything still surfaces outside contextualized history, fix before proceeding.
  6. **Only now issue the re-review prompt.** Include in the prompt: what the round-N code fix changed + what the sweep covered + a request to grep-verify cross-artifact consistency.

  Failure mode: patching the one stale reference Codex named, re-issuing, and discovering round N+1 catches three more. The grep in step 2 is the gate that prevents this. The cost of the extra greps is microseconds; the cost of a wasted review round is minutes plus the user's patience.

  ## End-of-Slice Sweep (before saying "done")

  STOP and do this before committing or claiming completion. This is the final pass, AFTER the loop has converged to APPROVED — the iteration-level sweep above keeps the loop short; this checklist makes sure nothing structural was missed at the end:

  - [ ] **State** (MEMORY.md "Current State") — update date, phase, capabilities, last shipped. Re-read after editing to 
  verify it matches reality.
  - [ ] **Map** (`<project>-map.md`) — if any files were created, moved, deleted, or renamed: update routing/file index. 
  Grep for stale references to old paths.
  - [ ] **Tasks** (`<project>-tasks.md`) — move from ACTIVE → DONE with a summary + reviewer verdict. Remove from BACKLOG. 
  Audit backlog for stale references.
  - [ ] **Decisions** (`decisions.md`) — if an architectural choice was made, log it with date + rationale.
  - [ ] **Plan** (`.hermes/plans/<plan>.md`) — mark checkboxes `[x]`.
  - [ ] **Constants/enums** — if enums, kind lists, or URL patterns changed: grep the map for stale values.

  FAILURE MODE: missing map updates and stale references is the most common slip. After editing each artifact, RE-READ it. 
  Not optional.

  Do not commit unless explicitly asked.

  ## Memory Artifacts

  Kept in the project's memory directory:

  - **`MEMORY.md`** — Current state, phase, what's shipped, pending work, key paths. Always-loaded index.
  - **`<project>-map.md`** — Source map: what IS in the code (files, routes, exports, state shapes).
  - **`<project>-tasks.md`** — Work items: what needs to CHANGE (ACTIVE, BACKLOG, DONE).
  - **`decisions.md`** — Architecture/product decisions with date + rationale.

  Of the four files listed above, three are *local working artifacts* — this project's public repo gitignores `MEMORY.md`, `<project>-map.md`, and `<project>-tasks.md`. Only `decisions.md` ships publicly, as `docs/DECISIONS.md`. Anyone driving the workflow regenerates the local files as they work.

  Maps reflect code reality. Tasks reflect intent. Code always wins over both.

  After structural changes (new files, changed exports, new routes, state shape changes), update the map. After completing a
   task, update the task file. After identifying new work, add to the backlog.

  ## Coding Rules

  - Prefer simple, explicit code.
  - Make the smallest clean change that satisfies the task.
  - Don't refactor surrounding code unless the task is refactoring.
  - Don't introduce abstractions for hypothetical future requirements.
  - Don't add error handling for scenarios that can't happen.
  - Default to no comments. Only add when the WHY is non-obvious.
  - Don't modify secrets or `.env` files.
  - Don't change unrelated formatting.
  - Preserve existing docs/examples unless the task is to update them.

  ## Review Expectations

  Reviewer should check for:
  - Spec compliance
  - Bugs or regressions
  - Missing tests/checks
  - Security and validation issues
  - Overengineering
  - Scope creep beyond the plan

  ## Decision Filter (optional — adapt to project values)

  For each meaningful choice, ask:
  - Does this match the project's stated principles? (Insert your project's north star here.)
  - Is there a simpler version that still satisfies the requirement?
  - What's the smallest change that proves this works?
  - Present pros/cons through the project's lens — surface the path that best aligns when one exists.

  ## Source-of-Truth Files

  Read these before major changes:
  - `docs/VISION.md` (or equivalent)
  - `docs/ARCHITECTURE.md`
  - `docs/SPEC.md`
  - `docs/ROADMAP.md` (when present)
  - [project-specific schemas, examples, design system]