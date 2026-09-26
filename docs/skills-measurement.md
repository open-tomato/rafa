# Skills measurement protocol

Measures whether the three skill resolvers — `planner`, `tag`, and `none` — deliver skills that tasks actually use, and whether tasks prefer one resolver's offerings over another's.

## Unit

One task session (a task dispatched to a Claude Code agent with a populated prompt).

## Metrics

### M1: Skill references per plan

The ratio of distinct (task, skill) pairs where a skill was invoked to the plan's task count. Measured in percentages.

- Numerator: Count distinct pairs of (task_line, skill_name) where task_line was dispatched in the plan and skill_name was invoked in that session.
- Denominator: The plan's total task count (from the spec's "Tasks the plan must carry" list).
- Example: If a plan has 30 tasks and 22 distinct (task, skill) pairs invoked skills, M1 = 22÷30 = 73%.

### M2: Uptake per arm

The ratio of offered skills that were invoked to all offered skills, grouped by resolver. Measured in percentages.

- Numerator: For each resolver arm, count invoked skills that appear in that session's `dispatches.skills_offered`.
- Denominator: For each resolver arm, count all skills in `dispatches.skills_offered` across all sessions in the plan.
- Example: If `planner` arm offered 150 skills and 45 were invoked, M2 = 45÷150 = 30%.

## Before: backfilled baseline (arm `none`)

Measured from the last three merged `rafa-<n>` spec plans on `main` before this protocol launched, using `rafa effort collect --skills` on the main checkout.

| Plan | Tasks | Date Read | M1 | Notes |
|------|-------|-----------|-----|-------|
| rafa-25 | 32 | 2026-09-26 | unknown | Claude Code version mismatch; sessions cannot be parsed |
| rafa-26 | 50 | 2026-09-26 | unknown | Claude Code version mismatch; sessions cannot be parsed |
| rafa-101 | 14 | 2026-09-26 | unknown | Claude Code version mismatch; sessions cannot be parsed |

**Note**: The "before" data is unavailable because:
1. Skill collection was not implemented when these plans ran.
2. Claude Code session logs from before the current `SKILL_USE_CLI_VERSION` cannot be parsed, storing `unknown` in the count column.
3. Baseline M1 for "arm none" cannot be established until the loop runs plans with skill collection enabled, using matching Claude Code versions.

## After: measured runs with resolver arms

Starts after this plan merges. Measures at least 3 plans per arm (`planner` and `tag`), each from a `type:spec` issue of this repository with 8 to 30 tasks. Arms alternate plan by plan in the Roadmap order.

### Data collection

Run: `rafa effort collect --skills`

Query per plan:

```sql
-- M1: distinct (task_line, skill_name) pairs where skill was invoked
SELECT
  COUNT(DISTINCT (d.task_line, si.name)) as m1_numerator,
  (SELECT COUNT(DISTINCT task_line) FROM dispatches WHERE plan_stub = ?) as m1_denominator
FROM skill_invocations si
JOIN dispatches d ON si.session_id = d.session_id
WHERE d.plan_stub = ? AND si.name IS NOT NULL;

-- M2 by arm: invoked skills from offered set ÷ all offered
SELECT
  d.resolver,
  COUNT(DISTINCT si.name) as m2_numerator,
  (SELECT COUNT(DISTINCT json_each.value) 
   FROM dispatches, json_each(skills_offered) 
   WHERE plan_stub = ? AND resolver = d.resolver) as m2_denominator
FROM skill_invocations si
JOIN dispatches d ON si.session_id = d.session_id
WHERE d.plan_stub = ? AND si.name IS NOT NULL 
  AND json_extract('["' || replace(d.skills_offered, '","', '","') || '"]', '$[*]') LIKE '%' || si.name || '%'
GROUP BY d.resolver;
```

### After table (to be populated)

| Plan | Arm | Tasks | M1 | M2 | Date Run |
|------|-----|-------|-----|-----|----------|
| TBD | planner | — | — | — | — |
| TBD | tag | — | — | — | — |
| TBD | planner | — | — | — | — |
| TBD | tag | — | — | — | — |
| TBD | planner | — | — | — | — |
| TBD | tag | — | — | — | — |

## Reading decided in advance

The measurement answers one question: *Does the added skill delivery mechanism help, or does it hurt?*

The result (recorded here with its date) determines the next step:

**Decision 1: Planner vs. Tag uptake (M2)**

- **If** planner's M2 is at least 10 percentage points above tag's M2, over at least 30 combined tasks per arm: Keep `planner` as default and keep `{SKILL_INDEX}` in the planner prompt.
- **If** neither arm beats the other by 10 points, **or** planner does not clear 10 points above tag over 30 tasks: Change default to `tag` and remove `{SKILL_INDEX}` from the planner prompt. The planner will no longer see the skill index, and tasks will be resolved by `tag` unless explicitly overridden.
- **Date decided**: [to be filled]
- **Result**: [to be filled: `planner wins`, `tag wins`, or `inconclusive`]

**Decision 2: Does skill delivery beat baseline (M1)**

- **If** both `planner` and `tag` arms have M1 at least 10 percentage points above the "before" baseline over at least 30 combined tasks per arm: Skill delivery mechanism is working; continue.
- **If** neither arm beats the baseline by 10 points: Read #24's `ignored` list before building more on skill delivery. Consider why lessons and skills are not being invoked; revisit the inventory and ranker floor.
- **Date decided**: [to be filled]
- **Result**: [to be filled: `improvement found`, `no improvement`, or `cannot measure`]

## What it does not measure

This protocol measures **engagement**: whether tasks invoke offered skills. It does NOT measure:

1. **Outcomes** — Whether invoked skills were *useful*, reduced effort, or improved quality.
2. **Causes** — Why a skill was or was not invoked; whether it was ignored, misunderstood, or not relevant.
3. **Reasons for skips** — If a skill was offered but not invoked, why.
4. **Task success** — The measurement is independent of whether the task completed, succeeded, or changed the repository.
5. **Efficiency trade-offs** — A higher M2 might come at the cost of longer task run time or more Claude API usage (see #24's report for outcomes analysis).

These are covered by #24's report (`docs/lessons-and-leverage.md`), which reads the linked findings and measures **impact**, not just engagement.
