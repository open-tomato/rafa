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
every loop. Nor into `~/.claude/`: a loop reads that tier when
`loop.settingSources` holds `user`, and one link there is shared by
every stretch on the machine. `.claude-plugin/plugin.json` makes the
folder a Claude Code plugin, `rafa-operators`, which the launcher loads
per session with `--plugin-dir`, so an agent is
`rafa-operators:rafa-stretch-engineer` and a skill
`rafa-operators:rafa-stretch-sweep`. The engineer carries the `Skill`
tool to load its skills by those names. Each operator's description
says it is never a loop task executor.

Every operator's frontmatter carries `provenance: first-party`,
`source: rafa` and `stage: alpha`, and its body opens with the alpha
line. The skill checker ignores `source` and `stage`; the operators
test reads them.

### The stretch operators

| File | Role |
|---|---|
| `rafa-stretch-engineer` | runs one stretch: sweep, bucket, loops, pit stops, wrap-up |
| `rafa-stretch-watchtower` | watches it read-only and alerts the person |
| `rafa-stretch-analyst` | da²: tests the person's hunches against the stretch's data, read-only, writing only `analysis.md` |
| `rafa-stretch-sweep` | phase 1: duplicate groups, ranking, tiers, the bucket report |
| `rafa-stretch-pit-stop` | phase 3: the four checks after each item, and the decision |
| `rafa-stretch-gap-log` | files a step rafa cannot do yet as a `module:cli-gap` bug |

A stretch writes under `.rafa/stretch/<n>/`: `operators/` (the
launcher's copy, below), `agent.json` (the agent's session id, which
the watchtower finds it by), `bucket.md`, `loop-<issue>.log`,
`pit-stops.md`, `watch.md` (the watchtower's one write), `analysis.md`
(the analyst's one write) and `report.md`. Its wrap-up writes the next
stretch's opening message to `.rafa/stretch/engineer-prompt.md`.

The integration branch is `stretch/<n>`, and `pr.base` points at it
for the stretch. `release settle` folds `origin/<pr.base>`
(`src/release/settle-worktree.ts`), so the wrap-up points `pr.base`
back at `main` before it settles: one version per stretch, cut after
the integration branch reaches `main`.

### Starting them

`scripts/stretch/stretch.sh` starts the operators on the loop host,
from the main checkout of the project the stretch runs in;
`bun run stretch <command>` is the same line in rafa. Another project
has no such script, so it runs `bash <rafa>/scripts/stretch/stretch.sh`
by its path: the project is the checkout the shell stands in, and the
operators and prompts are the rafa checkout's the script sits in.
`engineer`, `watchtower` and `analyst` start one session each, and
`start` opens all three in one tmux session,
`stretch-<project>-<n>`, named after the project's folder so two
projects' stretches on one machine never meet. tmux reads a bare `-t`
as a prefix, so every target is written `=<name>`, the exact match.
The Claude sessions are named `<project> stretch <n> <role>`.

The first session of a stretch copies the operators from the rafa
checkout into `.rafa/stretch/<n>/operators/`, once, and every session
of that stretch loads that copy. A pull, a worktree switch or a
`rafa self-update` in the rafa checkout therefore never changes a
stretch that runs; the next one takes the new files. Since the copy
makes the folder, the next stretch is the highest folder while it has
no `agent.json`, and one more than it after. `start` warns about
operators still linked into `~/.claude` by the launcher before the
copies: no new stretch reads them, and one started with them may.
The watchtower and analyst windows
wait for the new stretch's `agent.json`, since both find the engineer's
stretch by it. `--remote-control` starts each session with Remote
Control, so another device drives it from claude.ai; `--dry-run` prints
what would run.

The engineer's opening message is the first of three files, with
`{{STRETCH}}` and `{{PREVIOUS}}` filled in: the project's own
`.rafa/stretch/engineer-prompt.md`, then, in the rafa checkout alone,
`scripts/stretch/engineer-prompt.md`, then
`scripts/stretch/engineer-prompt-default.md`. So no other project is
handed rafa's carried work. A first stretch drops each line naming
`{{PREVIOUS}}`, since there is no report before it. The engineer's
wrap-up writes the project's own prompt for the next stretch, and the
person reviews it and adds the proposals they said yes to.

`scripts/device/check.sh` (`bun run device:check`) is the reading from
another device, such as a Mac: it runs `bun test` and `bunx eslint .`,
writes a report with each failure's own output, and with `--issue=<n>`
posts it through `gh`, so no terminal output is copied between
machines. `--from-log=<file>` builds the report from a saved log.

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
rafa· inherited        src/parse/parse.test.ts > parse > drops the last line
rafa· error            ❌ Task failed (exit 1). Marked as blocked. Run again to retry.
```

`src/start/loop-events.ts` builds each line. An `inherited` line names
the run-start failure, by file and case, that a reported bug was read as
(`src/start/triage.ts`): nothing was filed for it. A task's tokens are input,
cache creation and output from its session log, read as
`rafa effort collect` reads it; the effort store is never opened. A
session's own stdout goes to `info`, which the events adapter drops.
