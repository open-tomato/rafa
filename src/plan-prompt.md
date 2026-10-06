# Plan-generation instructions

## Naming conventions

All rafa work follows a consistent naming scheme across specifications,
plans, branches, and pull requests. The board is GitHub Issues on
`open-tomato/rafa`; every spec has one issue labelled `type:spec`, whose
ID appears as `rafa-<n>`.

| Artifact | Pattern | Example |
| --- | --- | --- |
| Specification file | `.rafa/specs/rafa-<n>-<slug>.md` | `.rafa/specs/rafa-20-pr-commands.md` |
| Plan stub and directory | `rafa-<n>-<slug>` | `rafa-20-pr-commands` |
| `issue:` field in `rafa:plan` | `<n>` (number only) | `issue: 20` |
| Git branch | `feat/rafa-<n>-<slug>` | `feat/rafa-20-pr-commands` |
| Pull request title | `rafa-<n>: <title>` | `rafa-20: Add pull-request commands` |
| Pull request body | `Closes #<n>` | `Closes #20` |

The slug summarizes what the user gets, using two to four words joined by
hyphens. The order of work lives in ONE place: the pinned "Roadmap" issue
on the `open-tomato/rafa` board.

* Commands that start Claude sessions must declare `spends` on their
  `RafaCommand` — see the dev-planner skill's "Command-development rule" for
  guidance.

* Size each task's suite run with the `tests=` declaration key (the
  dev-planner skill's `tests=` section). Leave it off where the task's
  own diff reaches the tests that could break, which the `affected`
  default covers. Write `tests=module` on a task whose change other
  modules consume through their own tests: an integration or spawned
  test task, a change to a shared type, a reader or a module many
  callers import. Write `tests=full` on a task whose change can break a
  test that imports none of its files: test preloads, `bunfig.toml`,
  `tsconfig*.json`, `package.json` or the lockfile, global state or
  environment every test inherits, and a stage's closing cross-module
  test task.

* Before planning, review the spec as written, and report that review at the
  END of your final message as a `rafa:spec-review` block carrying
  `verdict: ready` or `verdict: not-ready`, with empty `gaps:` for ready, or a
  list of gaps for not-ready. Every gap carries `heading`, `what` and
  `blocking: true` or `blocking: false`, and a gap that is NOT blocking also
  carries the `assumption:` you would plan under — one sentence naming the
  guess, not a restatement of the gap. A gap is blocking when guessing wrong
  changes what ships or what is safe; write no plan while one gap is blocking,
  and plan under your stated assumptions when every gap is non-blocking.
  The block is the LAST thing you write: end the final message with it, after
  the summary, and write nothing after it.
* Inspect each definition-of-done item: can it be shown by running a command
  or demonstrating a UI interaction, or is it worded too broadly for a reader
  to measure?
* Inspect each task name and the sentence that follows it: does it name what
  the task changes, and is that claim defensible from the text, or must the
  plan guess?
* Inspect the headers the spec names: are they the ones the dev-planner
  format requires, and does each hold actual content or only placeholders?
* Inspect whether the spec adds a user-facing command or config key: when it
  does and carries no `## For the documentation writer` section, report a
  gap under that heading naming the command or key, always `blocking: false`,
  with the assumption that the documentation tasks draw their examples from
  the Design section alone. The section is optional in every other spec, and
  its absence there is no gap.
* If any inspection finds a gap, write its heading as it appears in the spec,
  the `what` explaining the gap clearly, `blocking:` for whether it must be
  answered before anything is planned, the `assumption:` you would plan under
  when it is not blocking, and list them all under `gaps:` in that closing
  block.

Create a plan based on the spec at the end of this prompt, following the
dev-planner format specification that precedes it. Produce the required
checklists, technical assessments, feature requirements and acceptance
criteria — **do not execute the plan**.

{PROGRESS_SECTION}

## Files to produce

* Store the plan in `{PLAN_FILE}` (the plans directory is untracked unless
  the project opts into tracking it — plans may describe unpatched issues;
  never move them into a tracked path).
* If the plan assumes any prerequisite — a service running, a credential in an
  env var, an installed tool — create `{PREREQUISITES_FILE}` with those steps
  as a checklist in the PREREQUISITES.md format of the dev-planner
  specification below. Only genuinely non-automatable steps; do not duplicate
  what `README.md`/`AGENTS.md` already require of every contributor. Link to
  it from the plan. An `[auto]` item holds exactly one backticked span, and
  that span is its command, ending the item after `: ` and run as written:
  prove a tool with `<tool> --version`, `<tool> --help` or `which <tool>`.
* Do not create or touch any tracker file — the loop derives it from the plan.

## The effort-store rule for plans that carry migrations

A plan task that names a migration by its id (``migration `<id>` `` in the task line)
is one the loop's installed runtime must be able to read before the task runs. If the
task changes the store's schema, the loop's own open would fail once the branch code
runs.

**In a plan that carries an effort-store migration:**

* Every `bun src/rafa.ts` command on a still-to-run task line must carry
  `RAFA_EFFORT_DIR=<absolute path of the scratch copy>` as the first assignment on
  the same line. That names the copy made by the command the plan should declare
  under Prerequisites, `bun src/rafa.ts effort copy --to=.rafa/scratch/<stub>-effort`
  (spelled unprefixed, as that step makes the copy). Once made, every branch
  subcommand runs over the copy, and the loop's own store stays unaffected until the
  installed runtime has brought it forward.

* The PREREQUISITES file (`PREREQUISITES-<stub>.md`) must carry an `[auto]` item
  probing exactly `rafa effort schema --check`, the probe that holds the plan back
  until the installed rafa can read the store that branch code will migrate. Write
  it as: `- [ ] The installed rafa can read and write the live store: \`rafa effort
  schema --check\`` under an `[auto]` section.

`rafa plan create` checks both rules when a plan carries a migration and refuses the
plan if either breaks, moving it into `rejected/` so the loop does not pick it up.
The same checks run in the loop's preflight before any task starts.

{PLAN_FORMAT}

{ROUTING}

{SKILL_INDEX}{EPIC_CONTEXT}

## Spec

{SPEC_CONTENT}
