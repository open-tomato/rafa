## Standing notices

Two notices exist, `alpha` and `danger`, both about consent rather than a
fault (`src/notices/notices.ts`): the package is alpha software, and
every session rafa spawns runs with `--dangerously-skip-permissions`
under the person's accounts. Before you run a plan, use `rafa plan risk`
to see what it may do on this machine and under your accounts; this is
not a sandbox, but a reading of what the plan and its skills say.

### Where they are shown

`src/notices/run.ts` wires the real process, and two commands call it,
each ahead of the first thing that costs money:

- `loop start` (`src/start.ts`): after the branch offer and the branch
  guard, so a refused run says only why it was refused, and before the
  session record. A cancel leaves the run on the branch the offer may
  have created, with nothing run on it.
- `plan create` (`src/plan.ts`): before the planner session.

`loop start` prints the risk total (`src/start/risk-total.ts`) just
before its notice step on every run, dismissed notices or not. Two
spawned suites feel it: `noTaskLines()` in `src/tests/loop-output.test.ts`
compares the whole output of a run with no open task, so a line added
ahead of the tracker goes into that list in print order; and the
reading's accounts step calls `gh repo view --json
nameWithOwner,visibility` before triage's `gh auth status`, which the
pinned `gh.calls` list of `src/tests/task-report.test.ts` spells.

On a terminal the pending notices are printed and ONE question follows:
`y` continues, `d` continues and dismisses what was shown, anything else
(an empty line and an ended input included) cancels with exit 1. Without
a terminal they are written as warnings and the run goes on, because a
loop is usually started unattended on purpose.

### Dismissal

`~/.rafa/notices.json`, `{"dismissed": ["alpha", "danger"]}`, in the
USER scope: the notices are about the machine and the account. A missing
or damaged file dismisses nothing. There is no command for it; deleting
the file brings the notices back.

### What a test's HOME must hold

A spawned `loop start` or `plan create` under an empty scratch HOME
prints the notices as warnings, which breaks any case that compares the
run's output exactly. So the planting helpers of
`src/tests/loop-output.test.ts` and `src/plan.test.ts` call
`writeDismissed(home, NOTICE_IDS)` by default, and one case in
`loop-output.test.ts` plants `notices: 'pending'` to read them. A new
suite that spawns either command does the same.

### Adding a notice

Add the id to `NOTICE_IDS` (the order is the print order), its lines to
`noticeLines`, a case to `notices.test.ts`, and the sentence to the
README. `--no-danger`, which would remove the reason for the second
notice, is not built.

## Since-last-command notice

The second automated notice rafa prints on stderr before every command that
runs inside a project, when it has something new to tell you about. Never a
question, never a wait, never in `--output=json`. The line names `rafa cleanup`
when the news is only housekeeping (idle worktrees, merged branches) and
`rafa status` as soon as a loop stopped or holds a new blocked task, whether
or not housekeeping changed.

### Where it prints

The dispatcher's command hook (`src/status/hook.ts`, `src/cli/dispatch.ts`)
runs `before` and `after` every command that routes inside a project in text
mode (not `--output=json`). The `before` half reads a fresh snapshot, compares
it with the file the last command left, and returns the one line when something
is new. The `after` half writes the fresh snapshot so the next command finds
what this one did, and nothing it comes to changes the command's exit code or
the rest of its output.

The quiet commands `status` and `cleanup` answer no line in `before`, since
one names what the line would and the other acts on it. Every other command
takes the reading.

### What it compares

The `seen.ts` reading (`takeSeenSnapshot`) runs at the project root with no
fetch and builds no `gh` runner and no pull request provider, so it stays
local: git only, the session records under `.rafa/runs/`, the plans and their
trackers, and the disk state. It reads four things: which branches have merged
since last sync, which worktrees are idle, which sessions have stopped since
they ran, and which sessions hold a blocked task.

`compareSeen` (`src/status/notice.ts`) finds four kinds of news against the
previous snapshot:

- **An idle worktree**: a path idle now that the snapshot did not hold as idle
- **A merged branch**: a name in Merged now that the snapshot did not hold
- **A stopped loop**: a session the snapshot held as `running` or `paused`
  that now reads `stopped` or `done`
- **A blocked loop**: a session holding a blocked line the snapshot did not
  hold for it, or a session absent from the snapshot that holds any blocked
  line now

Nothing that went away is news: a worktree removed, a branch deleted, a session
gone because it was cleaned up.

### The snapshot file

`<root>/.rafa/status-seen.json` holds the previous reading as a `SeenSnapshot`:
worktrees (paths and last-access times), merged branches, sessions (id, state,
blocked lines). The file is written by `writeSeenFile` after every command and
read by `readSeenFile` before the next. A missing file (first run, or
`.rafa/` just created) reads as null, and no line is printed. A file that does
not parse reads as null and no line is printed; its read is thrown as an error
and swallowed into a `debug` line, so nothing prints at the default verbosity.

### `status.notice` config key

The config key `status.notice` (`true` by default) turns off the line and the
snapshot file writes. With it false, the hook's `before` answers no line and
`after` writes nothing, so the file the last command left stays as it was.
The setting goes in `.rafa/config.yaml` or `~/.rafa/config.yaml`, and a
project's file outranks the home's.

### What a test's HOME must hold

A spawned command that reads or writes the snapshot when the HOME is empty or
missing `.rafa/notices.json` (the standing notice file) will behave normally,
since the snapshot is unrelated. To silence the since-last-command notice in a
test (so it does not print a stray line in the output), set `status.notice`
false in the project's `.rafa/config.yaml`, or leave the snapshot file absent
so no line is printed on the first run and between runs the file does not
exist.
