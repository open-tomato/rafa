# Plan-generation instructions

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
