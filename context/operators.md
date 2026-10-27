## Operators

An operator is a Claude Code agent that runs rafa the way a person does.
The loop's own agents are handed tasks; an operator starts the loops.
Operators are alpha: tested on rafa's own development (#598), and they
may become a feature.

### Where they live, and why no loop sees them

`src/bundled/operators/` holds them, `agents/<name>.md` and
`skills/<name>/SKILL.md`. The build copies `src/bundled/` whole, so they ship in
the package. The rafa tier reads only `bundled/agents` (`BUNDLED_AGENTS_DIR`,
`packages/rafa-inventory/src/inventory/trees.ts`) and `bundled/skills` (`BUNDLED_SKILLS_DIR`,
`packages/rafa/src/schema/tiers.ts`), so no loop session is ever served an
operator and the planner never routes a task to one.
`src/tests/operators.test.ts` holds both, and runs `rafa skill check` over the
skills.

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
| `rafa-stretch-sweep` | phase 1: recheck, duplicate groups, ranking, tiers, the bucket report |
| `rafa-stretch-pit-stop` | phase 3: the four checks after each item, and the decision |
| `rafa-stretch-gap-log` | files a step rafa cannot do yet as a `module:cli-gap` bug |

Every operator agent carries the single-command rule: run every `rafa` line as
one command, no `cd … &&`, `;`, pipe or redirect. The allow rules match a
single command, and a compound one goes to the auto-mode classifier, which
reads `--skip-checks` as a CI bypass. For example, `rafa pr merge <pr> &&
rafa cleanup` is denied; run them as two separate commands instead. The
exception is the engineer's detached loop start, which needs its redirect.

A stretch writes under `.rafa/stretch/<n>/`: `operators/` (the
launcher's copy, below), `agent.json` (the agent's session id, which
the watchtower finds it by), `bucket.md`, `loop-<issue>.log`,
`pit-stops.md`, `watch.md` (the watchtower's one write), `analysis.md`
(the analyst's one write) and `report.md`. Its wrap-up writes the next
stretch's opening message to `.rafa/stretch/engineer-prompt.md`.

The integration branch is `stretch/<n>`, and `pr.base` points at it
for the stretch. `release settle` folds `origin/<pr.base>`
(`packages/rafa-release/src/release/settle-worktree.ts`), so the wrap-up points `pr.base`
back at `main` before it settles: one version per stretch, cut after
the integration branch reaches `main`.

### Starting them

`rafa stretch start` launches the operators on the loop host from the
main checkout of the project the stretch runs in, with the operators of
the installed package, so no project needs a rafa checkout.
`rafa stretch start [--n=<n>] [--remote-control] [--dry-run]` picks the
next stretch number from `.rafa/stretch/`, makes the folder, pushes
`stretch/<n>` from `origin/<default>`, copies the operators once into
`.rafa/stretch/<n>/operators/`, records the old `pr.base` in
`stretch.json`, and sets `pr.base` to `stretch/<n>` in the local config.
It refuses when another stretch of this project is live (an `agent.json`
whose pid or tmux session is running) or a loop of the project runs.
`--role` starts one session in this terminal; without it, `start` opens
all three in one tmux session, `stretch-<project>-<n>`, named after the
project's folder so two projects' stretches on one machine never meet.
The Claude sessions are named `<project> stretch <n> <role>`.
`--remote-control` starts each session with Remote Control, so another
device drives it from claude.ai; `--dry-run` prints what would run. `start`
warns about operators still linked into `~/.claude` by the launcher before
the copies, since no new stretch reads them and one started with them may.
Whether the tmux session stays is open: #598 rejected a tmux session on
the host, read with capture-pane.

`rafa stretch item <issue> [--wait] [--dry-run]` handles one item from
loop start to its pit-stop readings. It takes the integration branch from
`pr.base` (which must name a `stretch/<n>` branch), runs
`rafa plan create --issue`, and starts the loop detached with
`RAFA_OUTPUT=events`, logging to `.rafa/stretch/<n>/loop-<issue>.log`.
With `--wait`, it waits on the loop through `rafa loop wait`. Once the loop
has a pull request, `item` merges it with `--skip-checks` into the
integration branch, frees the worktree, and waits for the run on the merge
commit. It asks for that run by commit (`--commit`), so a newer push to the
branch that has a run of its own does not make the wait read that run. The
wait ends on the merge commit's run, red or green. If no run is found on the
commit, or the run found has not ended, within 90 minutes, it warns `no run
on <branch> at <sha> was found within 90 minutes` or `run <id> (<workflow>)
on <branch> at <sha> had not ended within 90 minutes`. Then it appends the
ledger line and prints the pit-stop readings: the failed cases by file and
case, the open-bug count, and the bugs filed since the last item. It decides
nothing; the pit stop does.

The filed-since line reads `Filed since <time>: <n>.`, where the time is the
last ledger line's, or the stretch's start when the ledger holds none. Then one
indented line per bug, `#<n> <title>: <first line>`, oldest first, the first
line being the body's first non-blank line, trimmed, cut to 100 characters; a
body with none prints `#<n> <title>` alone. The bugs come from a listing of
their own, the tracker's `filedIssues('bug', since)`
(`packages/rafa/src/ports/index.ts`), in any state: a bug filed and closed
between two items is listed, while the open-bug count still reads
`openIssues('bug')` alone. Each bug's filed time is the `createdAt` that listing
carries, so no `gh issue view` runs per bug. GitHub answers it from `gh issue
list --state all --search created:>=<since>`
(`packages/rafa-board/src/adapters/tracker/github-filed-issues.ts`), whose search index can lag a
filing by seconds, so a bug filed in the moments before the reading may be
missing from the line; the local tracker answers the record's `capturedAt`, the
time the issue was created, not a file's time on disk. A bug whose time does not
parse turns the line into `Filed since the last item: not read: no filing time
for #<n>`, since a bug left out would read as not filed. A tracker with no
filed-issue listing reads the same way, with its own reason, and so does one
whose listing threw; the count still prints beside it.

`rafa stretch end [--dry-run]` opens the integration branch into the
default branch with `report.md` as its body and every merged item's `Closes`
lines appended, and once that pull request has merged, puts back the
`pr.base` recorded in `stretch.json`.

The item ledger, `.rafa/stretch/<n>/items.ndjson`, is one line per item:
issue, plan, pull request, merge commit, its `Closes` lines, and a
timestamp. `rafa stretch item` appends one line after merging, and
`rafa stretch end` reads all lines to build the integration pull request's
`Closes` block.

`stretch.json` records the `pr.base` `start` found, so `end` can restore it
when the integration branch has merged into the default branch.

`scripts/stretch/stretch.sh` (`bun run stretch <command>` in rafa) is a
wrapper over `rafa stretch start` for one release: it prints a deprecation
line and runs `rafa stretch start`, passing `--role=<role>` for
`engineer`, `watchtower` and `analyst`, and every other flag as it is.

The first session of a stretch copies the operators from the installed
package into `.rafa/stretch/<n>/operators/`, once, and every session of
that stretch loads that copy. A `rafa self-update` therefore never changes
a stretch that runs; the next one takes the new files. Since the copy makes
the folder, the next stretch is the highest folder while it has no
`agent.json`, and one more than it after. The watchtower and analyst
windows wait for the new stretch's `agent.json`, which the engineer writes
when its session opens, since both find the engineer's stretch by it.

`rafa self-update` installs this checkout as the global rafa. While a loop of
the project is live it refuses at exit code 1, before the build, naming each
loop, and `--force` does not override that wait; only
`dangerous.selfUpdateDuringLoop: true` lets the install go on. A plan parked
halfway is the edge case: its tracker holds an open or blocked task that no
loop will pick up. With no loop live, that tracker does not hold the update
back. The install warns once, naming the tracker and the line its task is on,
and goes on, so `rafa self-update` names it and updates. With that key true
and a loop live, the same tracker still refuses at exit code 1 unless
`--force` is on the line. Counting only trackers whose task is not
`[BLOCKED]` was rejected: the open task nobody runs would still stand as a
wall.

The engineer's opening message is the first of three files, with
`{{STRETCH}}` and `{{PREVIOUS}}` filled in: the project's own
`.rafa/stretch/engineer-prompt.md`, then, in the rafa checkout alone,
`scripts/stretch/engineer-prompt.md`, then
`src/bundled/stretch/engineer-prompt-default.md`, which the build ships
as `bundled/stretch/engineer-prompt-default.md`. So no other project is
handed rafa's carried work. `src/stretch/prompt.ts` makes the same
choice for the commands that replace the script, taking the default
from the installed package and reading a project as the rafa checkout
when its `package.json` is named `@open-tomato/rafa` and it holds
`src/rafa.ts`. A first stretch drops each line naming
`{{PREVIOUS}}`, since there is no report before it. The engineer's
wrap-up writes the project's own prompt for the next stretch, and the
person reviews it and adds the proposals they said yes to.

`scripts/device/check.sh` (`bun run device:check`) is the reading from
another device, such as a Mac: it runs `bun test` and `bunx eslint .`,
writes a report with each failure's own output, and with `--issue=<n>`
posts it through `gh`, so no terminal output is copied between
machines. `--from-log=<file>` builds the report from a saved log.

Every operator agent carries the single-command rule: run every `rafa` line
as one command, no `cd … &&`, `;`, pipe or redirect. The allow rules match
a single command, and a compound one goes to the auto-mode classifier. For
example, `rafa pr merge <pr> && rafa cleanup` is denied; run them as two
separate commands instead. The detached loop start that once needed a
redirect is now `rafa stretch item`.

### A `dangerous.*` key is refused

A `dangerous.*` key is a person's consent to step off a check, so an
operator session cannot set one. Claude Code sets `CLAUDECODE` in the shell
of every command a session runs, and `rafa config set` reads that variable
as "an agent runs this". Under it, `rafa config set
dangerous.acceptVersionCollision=true` exits 1 before the project's config
file is read, so the file is left byte for byte as it was. The refusal
prints the variable it read, that nothing was written, and the exact line
for the person to run in their own terminal:
`rafa config set dangerous.acceptVersionCollision=true`. It covers
`dangerous` itself and every key under `dangerous.`, known to the reader or
not, and with `--output=json` it is the same refusal as the command's other
refusals. Every other key is written from an operator's shell as it is
anywhere.

A `dangerous.*` key is a signature. An assistant can prepare the form and
hand over the pen, and cannot sign. So when an operator is asked to get past
a version collision, the step is to tell the person the line; they run it if
they agree.

Two limits. The check is the one variable, so a person who exports
`CLAUDECODE` by hand in their own shell is refused too, and anything wider
belongs to #914. A shell without the variable is not gated at all, so the
refusal reads the shell and not who is typing.

### The events output

`RAFA_OUTPUT=events` (or `--output=events`) is the output the operators read a
loop in. Only a command declaring `events` among its outputs gets it, `loop
start` today; any other command reads it as text. The named event is a fifth
`CliEvent` kind, `{ type: 'event', name, summary, data, ts }`
(`packages/rafa/src/ports/index.ts`): text drops it, json writes it whole, and
the events adapter prints its `summary` after the prefix. Every kind is padded
to one column of 17 (`padKind`, `packages/rafa/src/adapters/output/events.ts`):

```text
rafa· task 3/9 start   "Group duplicate bugs"
rafa· task 3/9 done    12m  340k tokens
rafa· task 4/9 blocked session exited 1
rafa· wrap-up          session
rafa· pr #612 opened
rafa· no pr            no open pull request for feat/rafa-485
rafa· halt             checkout moved
rafa· retry 1/2        suite step red
rafa· decision jump    line 12: A person writes the env file this gate checks.
rafa· decision needed  line 12 "Check the env file"
rafa· passed over      2 tasks: line 12 (jump), line 15 (defer)
rafa· inherited        src/parse/parse.test.ts > parse > drops the last line
rafa· error            ❌ Task failed (exit 1). Marked as blocked. Run again to retry.
```

`src/start/loop-events.ts` builds each line. A `retry` line says the run
went back into its loop after a stop instead of halting, which retry in
a row of how many, under `--retry` or `loop.retries`
(`src/start/retry-budget.ts`), the count starting over once a later task
is done, neither the stopped one nor a repair;
it ends nothing, so `rafa loop wait` and `rafa stretch item` read on past
it. A stop it retries writes no `task-blocked` line: a task stop writes
one only once no retry is granted, so a `task-blocked` line still means
the run stopped.

The three `--continue` lines (`context/cli.md`) count tracker lines
from 1, as the decision prompt does. A `decision` line names the
strategy a stop was decided as and its reason. A `retry`, `jump` or
`defer` ends nothing and the run goes on; a `stop` is followed by the
stop's own `task-blocked` or `halt` line, and the run ends with exit
code 20. A `decision needed` line is json mode's: no session was
spawned, the event's data holds the task, its line, why it stopped,
the open tasks, the retries in a row left and the rendered prompt, and after
the stop's own line the run ends with exit code 21, for the caller to
start again with `--continue --decide=<strategy>`. A `passed over` line
lists the tasks a run ends with passed over; a `halt` follows it and the
run ends with exit code 22, unless `--force-wrap-up` goes on to a draft
pull request. A refused forced wrap-up is a `halt` naming its count,
with exit code 20, and so is a forced wrap-up whose pull request `gh`
would not make a draft, its `halt` naming the pull request in place of
the `pr` line. None of these ends on an `error` line.

An `inherited` line names
the run-start failure, by file and case, that a reported bug was read as
(`src/start/triage.ts`): nothing was filed for it. A task's tokens are input,
cache creation and output from its session log, read as
`rafa effort collect` reads it; the effort store is never opened. A
session's own stdout goes to `info`, which the events adapter drops.

An `error` event says the run ended on an uncaught error, and its line
is the first non-blank line of the error's message.

### The events file

Every event `src/start/loop-events.ts` emits is also appended to the
run's events file, `.rafa/runs/<session-id>.events.ndjson`, beside its
record: one JSON line, `{ name, summary, data, ts }`, the object the
output's `emit` receives minus `type`, in every output mode, text
included. `bindEventsFile` names the file (making the runs folder if it
is missing) and `unbindEventsFile` ends the append; with none bound,
nothing is written. The append is best-effort: a failed write prints one
stderr line naming the path and the error, once per binding, and never
throws into the loop. `loop start` binds it right after opening the
session record and unbinds it in the run's `finally` (`src/start.ts`);
anything the run throws is first written as an `error` event, then
rethrown, but for the `LoopEnd` a `--continue` run ends with, exit code
20, 21 or 22, which has emitted its own events before it is thrown
(`src/start/continue-exits.ts`). A test binds its own temp root and
unbinds after.
The record, `<session-id>.json`, stays the only `.json` file a run
writes, so `loop list`, `status` and `stop` read it alone.
