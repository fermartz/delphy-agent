 # How We Work

  ## Agent Workflow

  Standard loop: **plan → build → review → fix → verify → approve**.

  - **Planner** writes the plan (you, or another agent driving the workflow).
  - **Builder** implements (Claude Code).
  - **Reviewer** audits the diff (Codex CLI, or another model).
  - **Builder** fixes blockers, re-verifies.
  - **User** approves.

  Plans live in `.hermes/plans/`. Reviews live in `.hermes/reviews/` (only written when verdict is REQUEST_CHANGES).

  ### File naming (MUST follow)
  - Plans: `YYYY-MM-DD_HHMMSS-descriptive-name.md`
  - Reviews: `YYYY-MM-DD-descriptive-name.md`

  ## Before Implementing

  1. Read the source map and task file (see Memory Artifacts).
  2. Read relevant docs/schemas/examples for the area you're touching.
  3. Identify the files likely to change.
  4. For non-trivial work, write a brief plan in `.hermes/plans/` and get user approval BEFORE coding.
  5. Make the smallest clean change that satisfies the task. No unrelated rewrites.

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

  - If REQUEST_CHANGES → read the review file, fix blockers, re-verify, request re-review.
  - If APPROVED → proceed.
  - Record the verdict in the task DONE entry.

  ## Update ALL Artifacts (before saying "done")

  STOP and do this before committing or claiming completion:

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