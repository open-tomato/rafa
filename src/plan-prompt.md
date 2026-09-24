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

{PLAN_FORMAT}

## Spec

{SPEC_CONTENT}
