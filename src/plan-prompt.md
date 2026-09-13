# Plan-generation instructions

Create a plan based on the spec provided below, following the plan document
format in `.claude/skills/dev-planner/SKILL.md` exactly. Produce the required
checklists, technical assessments, feature requirements and acceptance
criteria — **do not execute the plan**.

{PROGRESS_SECTION}

## Files to produce

* Store the plan in `{PLAN_FILE}` (the `.plans/` directory is untracked on
  purpose — plans may describe unpatched issues; never move them into a
  tracked path).
* If the plan assumes any prerequisite — a service running, a credential in an
  env var, an installed tool — create `{PREREQUISITES_FILE}` with those steps
  as a human checklist (see the PREREQUISITES.md format in the dev-planner
  skill). Only genuinely non-automatable steps; do not duplicate what
  `README.md`/`AGENTS.md` already require of every contributor. Link to it
  from the plan.
* Do not create or touch any tracker file — the loop derives it from the plan.

## Structured plan format (parser contract)

* Every task is a flat `- [ ]` checklist line. The loop's parser only reads
  lines starting with `- [ ]` / `- [BLOCKED]` — anything else (headings,
  prose, code blocks) is invisible to it, so never encode a task any other
  way, and never nest tasks.
* Group tasks under `# Stage: {name}` headings (top-level `#`). Stage
  headings are visual separators only; the checklist must read as one flat
  sequence across stages.
* One atomic action per task; no compound tasks joined by "and". Tasks must
  be independently completable in the order listed. A module-sized
  deliverable (see Task sizing below) counts as one atomic action.
* Use imperative, specific wording ("Add Zod schema for `CreateJobRequest`",
  not "Handle input validation").
* Avoid the words "current", "previous" and "next" in task text — the loop
  injects task text into agent prompts, and relative references confuse the
  agent about what is already done.
* Keep the plan focused on tasks and technical context only — no behavioral
  instructions, opinions, or questions for follow-up. Link to relevant
  `.claude/skills/` files where they clarify a task.
* Add a test task at the end of each stage at minimum; for larger stages,
  test in smaller increments. Negative tests before positive tests; unit
  tests before integration tests; test tasks live in the stage they cover.
  Stage-end test tasks cover cross-module/integration behavior — a module's
  own unit tests ride inside its module task (Task sizing below).

### Structured blocks

A plan document may contain fenced blocks of the form `` ```rafa:*``` `` that
carry metadata and context. Three kinds are read in phase 0:

* `rafa:plan` — Header fields in YAML format: `stub`, `issue` (optional),
  `spec` (optional). The stub identifies the plan and defaults to the spec's
  basename or "untitled". The loop uses the spec path to link the plan to the
  change that prompted it.
* `rafa:context` — Markdown prose injected into the prompt of EVERY task under
  this plan.
* `rafa:stage-context` — Markdown prose injected only into tasks under the
  nearest `# Stage:` heading above it, providing stage-specific background.

Unknown `rafa:*` block kinds are retained and ignored — they do not cause
parse failures. This rule mirrors the declaration extras rule: an
unrecognized key in a task line does not prevent the line from being
dispatched.

A `rafa:stage-context` block belongs to the NEAREST `# Stage:` heading above
it. Blocks before the first stage heading have no effect.

#### Block strip rule

Every `rafa:*` block is stripped from the task text before it is quoted
to the agent, the operator log, or the commit message. The fenced block
syntax is a planning annotation, never an instruction.

### Example

Every line is indented by two spaces, because the loop's checklist parser is
line-anchored and fence-blind: a bare `- [ ] ` at column 0 inside prose is
dispatched as a task. Measured on a draft plan, an unindented example line
became the dispatcher's answer for task one.

````markdown
  # Plan: Feature Title

  ```rafa:plan
  stub: my-feature
  issue: OPT-123
  spec: .specs/my-feature.md
  ```

  ```rafa:context
  Context prose injected into every task.
  ```

  # Stage: schema

  ```rafa:stage-context
  Prose specific to the schema stage.
  ```

  - [ ] Add the Zod schema  {agent=loop-implementer}
````

## Task declarations (routing)

* A task line may carry a trailing declaration naming what the loop should
  dispatch it with. Give one to every task.

```text
- [ ] Add the Zod schema for `CreateJobRequest`  {agent=loop-implementer}
- [ ] Rewrite the gates page  {agent=doc-updater}
- [ ] Sweep the changed set  {tools=Read,Grep,Glob model=haiku effort=low}
```

* The block is the LAST brace group on the line, anchored at end of line,
  holding no nested braces and at least one recognised key, and it is
  never the whole task text. Two spaces separate it from the text.
  Anything failing one of those rules stays task text — a task ending on
  a code span carrying `{ "a": 1 }` is not a declaration.
* Its tokens are space-separated `key=value` pairs. Recognised keys are
  `agent`, `model`, `effort` and `tools`; an unrecognised key is kept for
  telemetry and maps to no flag. The key `skills` reserves a comma-separated
  list of skill names for phase 1 resolution and is stored for reporting.
* `agent=<name>` outranks the other three — the loop passes only
  `--agent`, the agent definition supplying its own model and tool set.
  The three are still recorded, so the effort collector can report what
  the plan asked for against what the agent supplied.
* Otherwise `model` takes an alias (`opus`, `sonnet`, `haiku`, `fable`),
  `effort` one of `low`, `medium`, `high`, `xhigh`, `max`, and `tools` a
  comma-separated list of tool names with no spaces.
* A value the loop cannot use maps to no flag rather than failing the
  task, so a misspelled level costs the routing silently. Spell each one
  from the lists above.
* The loop strips the block before the task text reaches the agent's
  prompt, the operator log and the commit message: a declaration is a
  planning annotation, never an instruction.
* Pick the agent by the task's SHAPE — not its subject or its verb —
  from the `### Task shape to agent` table in `context/workflow.md`.
  Prefer a row whose third column names a tracked
  `.claude/agents/<name>.md` file, since a `user-level` row does not
  travel with a fresh clone. Where no row fits, declare the granular
  keys instead of an agent.

## Task sizing (session economics)

* One task = one full agent session, so task COUNT is the plan's
  wall-clock. Target **≤80 tasks**; exceed it only when the spec genuinely
  enumerates more independent deliverables, and say so in the Description.
* A module ships as ONE task: implementation + its TSDoc + its colocated
  unit tests together. Never split creation from documentation, or from
  the tests that cover only that module.
* Documentation-only updates fold into the task whose change they document
  (the same-commit doc law already requires the pairing).
* Keep as SEPARATE tasks: cross-cutting verification (fan-out gates,
  invariant sweeps), live-seam runs, migrations, and close-out — these
  preserve resumability where a halt is most likely.
* The RUNNER owns the push, the pull request, the merge with the base,
  and the wait for CI. After the last task it runs a wrap-up session
  that promotes findings, compacts `progress.txt`, merges `origin/main`,
  commits, pushes and opens (or updates) the PR — and then polls that
  PR's checks, spending repair sessions on a red or conflicting result.
  So a plan must NOT carry a task that opens a PR, resolves a merge
  conflict, waits on CI, or compacts `progress.txt`. Two openers race:
  measured, one run cut a second branch and opened a second PR for a
  single plan. A close-out task SHOULD still take the mergeability
  reading (`git merge-tree --write-tree origin/main HEAD`) and assemble
  the body material — the gate captures, the test plan, the recorded
  debt — into the plan's close-out notes for that wrap-up session to
  use.

## Spec

{SPEC_CONTENT}
