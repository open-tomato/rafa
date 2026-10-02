## Operators

An operator is a Claude Code agent that runs rafa the way a person does.
The loop's own agents are handed tasks; an operator starts the loops.
Operators are alpha: tested on rafa's own development (#598), and they
may become a feature.

### Where they live, and why no loop sees them

`src/bundled/operators/` holds them, `agents/<name>.md` and
`skills/<name>/SKILL.md`. The build copies `src/bundled/` whole, so they
ship in the package. The rafa tier reads only `bundled/agents`
(`BUNDLED_AGENTS_DIR`, `src/inventory/trees.ts`) and `bundled/skills`
(`BUNDLED_SKILLS_DIR`, `src/schema/tiers.ts`), so no loop session is
ever served an operator and the planner never routes a task to one.
`src/tests/operators.test.ts` holds both, and runs `rafa skill check`
over the skills.

Never link an operator into this repository's `.claude/`, as the
loop's agents are: there it would be a project-tier item, served to
every loop. On a loop host they are linked into the user's
`~/.claude/agents/` and `~/.claude/skills/` instead, which a loop
reads only when `loop.settingSources` holds `user`; each operator's
description says it is never a loop task executor.

Every operator's frontmatter carries `provenance: first-party`,
`source: rafa` and `stage: alpha`, and its body opens with the alpha
line. The skill checker ignores `source` and `stage`; the operators
test reads them.

### The stretch operators

| File | Role |
|---|---|
| `rafa-stretch-engineer` | runs one stretch: sweep, bucket, loops, pit stops, wrap-up |
| `rafa-stretch-watchtower` | watches it read-only and alerts the person |
| `rafa-stretch-sweep` | phase 1: duplicate groups, ranking, tiers, the bucket report |
| `rafa-stretch-pit-stop` | phase 3: the four checks after each item, and the decision |
| `rafa-stretch-gap-log` | files a step rafa cannot do yet as a `module:cli-gap` bug |
| `rafa-stretch-readings` | both: checks a baseline fits the machine and the period, and names the `stretch` script action for each reading |
| `rafa-stretch-scorecard` | the engineer, closing each pit stop: five item axes, each with its evidence, and a verdict |
| `rafa-stretch-audit` | the watchtower, after each pit stop: each decision on evidence, limits, consistency and record |

A stretch writes under `.rafa/stretch/<n>/`: `agent.json` (the agent's
session id, which the watchtower finds it by), `bucket.md`,
`loop-<issue>.log`, `pit-stops.md`, `watch.md` (the watchtower's one
write) and `report.md`.

The integration branch is `stretch/<n>`, and `pr.base` points at it
for the stretch. `release settle` folds `origin/<pr.base>`
(`src/release/settle-worktree.ts`), so the wrap-up points `pr.base`
back at `main` before it settles: one version per stretch, cut after
the integration branch reaches `main`.

### The events output

`RAFA_OUTPUT=events` (or `--output=events`) is the output the
operators read a loop in. Only a command declaring `events` among its
outputs gets it, `loop start` today; any other command reads it as
text. The named event is a fifth `CliEvent` kind, `{ type: 'event',
name, summary, data, ts }` (`src/ports/index.ts`): text drops it, json
writes it whole, and the events adapter prints its `summary` after the
prefix. Every kind is padded to one column of 17 (`padKind`,
`src/adapters/output/events.ts`):

```text
rafa· task 3/9 start   "Group duplicate bugs"
rafa· task 3/9 done    12m  340k tokens
rafa· task 4/9 blocked session exited 1
rafa· wrap-up          session
rafa· pr #612 opened
rafa· no pr            no open pull request for feat/rafa-485
rafa· halt             checkout moved
rafa· error            ❌ Task failed (exit 1). Marked as blocked. Run again to retry.
```

`src/start/loop-events.ts` builds each line. A task's tokens are input,
cache creation and output from its session log, read as
`rafa effort collect` reads it; the effort store is never opened. A
session's own stdout goes to `info`, which the events adapter drops.
