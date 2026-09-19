# Plan-generation instructions

* Before planning, review the spec as written: open your answer with a
  `rafa:spec-review` block carrying `verdict: ready` or `verdict: not-ready`,
  with empty `gaps:` for ready, or a list of `{heading, what}` gaps for
  not-ready — only continue planning after a ready verdict.
* Inspect each definition-of-done item: can it be shown by running a command
  or demonstrating a UI interaction, or is it worded too broadly for a reader
  to measure?
* Inspect each task name and the sentence that follows it: does it name what
  the task changes, and is that claim defensible from the text, or must the
  plan guess?
* Inspect the headers the spec names: are they the ones the dev-planner
  format requires, and does each hold actual content or only placeholders?
* If any inspection finds a gap, write its heading as it appears in the spec,
  the `what` explaining the gap clearly, and list them all under `gaps:`
  before the plan.

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
  it from the plan.
* Do not create or touch any tracker file — the loop derives it from the plan.

{PLAN_FORMAT}

## Spec

{SPEC_CONTENT}
