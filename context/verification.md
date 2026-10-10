## Verification

### Scoped first, full at merge

A change made through an agent, a loop task or a session by hand, is
tested at its scope first: `changed` (`bun test --changed=<base>`, the
`tests=affected` scope below) for an isolated change, `related` (the
touched module's test files by path, the `tests=module` scope) when it
reaches further. The full suite runs about 20 minutes a pass, so it is
the warranty before a merge, run once every scoped run is green, and
never the quick check between edits.

A change still asks for the full suite before the merge-time run when:

- it touches a file in `tests.fullSuiteTriggers` (`bunfig.toml`,
  `tsconfig*.json`, `package.json`, the lockfile, a test preload);
- it changes a module used across the codebase, the `tests=full` case;
- a scoped run is green and the failure it chases is still unexplained,
  so the full run is the capture that names it.

The runner's recorded steps below are full runs at fixed points of a
loop; a session never adds its own between them.

### Gate tiers and task declaration

**A task session runs a targeted subset of checks; the runner runs the full
suite at defined stages.** A task line declares `tests=affected` (the
default), `tests=module`, or `tests=full` to control what its session checks.

**Task session gates** (read one exit code from each):
- `bun test --changed=<base>` (affected tests), then `bun test
  <tests.alwaysRun paths>` (content sweeps) as a second run, with
  `--reporter=junit --reporter-outfile=<file>` on both to read failures
  via JUnit. The prompt names both gate names: `affected tests gate` and
  `always-run sweeps gate`
- `bunx tsc --noEmit` (only TypeScript, test files excluded via tsconfig)
- `bunx tsc` on touched test files against their base (same `tsconfig.json`
  with `typeRoots` held absolutely, read below for the scratch recipe and
  backlog); the task prompt hands the session that recipe as one line,
  the type step's own scratch tsconfig and `tsc` command, whenever the
  checkout holds a `tsconfig.json` and the step's walk finds a
  `node_modules/.bin/tsc`
- `bunx eslint <changed files>` (ESLint on changed files only; read below
  for the blocker when changed files are all ignored)

All three redirect to a file and read `$?` immediately after with
`exit=$?` on the next line — never pipe through `tail` or poll with
`until`/`while` + `sleep`. Through a pipe, `tail`'s exit code is read
instead of the gate's, and `${PIPESTATUS[0]}` prints empty on zsh. Polls
waste time when the runner will record the same gate later as a real
step anyway.

The full-suite scripts treat the workspace packages apart: `check-types` runs
`tsc` over the root, then each `packages/*/src/` with its tests
included; `bun run lint` ignores `packages/` whole, so package code is
never linted.

**Runner recorded steps** (full suite, recorded at fixed points):
- `baseline` — Full suite once at plan start (first dispatch)
- `task` — Scope from `taskStepScope` over the task's diff after
  each task's session ends and commits
- `stage` — After a stage's last task: the tests under the `Owns:`
  folders it changed, or `bun test --changed=<since>` with the
  `tests.alwaysRun` files when the plan has no `Owns:` folder
- `pre-wrap-up` — Full suite before wrap-up session starts

Each recorded step names its scope (affected, module, full, or a
file/folder list it ran on), its reason (`declared` for a task or stage
step whose session declared `tests=module` or `tests=full`; `trigger` when
changed files match `tests.fullSuiteTriggers` or `tests.integration` and
escalate the scope; `fallback` for a stage step with no `Owns:` folder
running `bun test --changed=<since>`; `no-module-tests` when a task
names `tests=module` but the module has no test files; `stage` for a
pre-wrap-up step, which is always full suite), the command, exit code,
Bun's summary line, every failing test (file + full test name pairs), and
which failures are new against the baseline (not present in `baseline`'s
captured failures).

**Declaration key `tests=` on a task line** sets what the task's session
will run:
- `tests=affected` (default): `bun test --changed=<base>` plus types and
  lint on the changed files
- `tests=module`: One full-suite module (e.g., `bun test
  src/effort/**/*.test.ts`) when the task touches files that trigger a
  module re-run
- `tests=full`: Entire suite when the task changes a config file or a
  globally-used module

**Config keys for test selection and running:**
- `tests.alwaysRun` (glob list, defaults to `src/**/*.sweep.test.ts`) —
  content sweeps that always run alongside scoped tests in every task's
  gates, since they read files at run time and `--changed` follows only
  the import graph
- `tests.fullSuiteTriggers` (glob list, defaults include `bunfig.toml`,
  `tsconfig*.json`, `package.json`, `bun.lock`, `bun.lockb`, and files
  named in `[test] preload` of `bunfig.toml`)
- `tests.integration` (glob list, defaults to `**/*-integration.test.ts`,
  `**/*.integration.test.ts`, `**/*-spawned*.test.ts`, `**/*-cli.test.ts`)

**The baseline is the `baseline` step's recorded failures.** A failure
is identified by its test file path and full test name (the pair the
JUnit reporter captures). When a step after the baseline reports failures,
the runner compares each failure's file + name pair against the baseline's
captured set: a match means the failure was already present, a mismatch
means it is new. Only new failures make a step red. A red task or stage
step inserts a `[BLOCKED]` repair task above the first open plan task,
which it leaves as it was: the repair's text names the commit the step
ran at (`Repair the red task step at commit <sha>`), its declaration is
`{agent=build-error-resolver}`, and its blocker names the new failures
and the first error line Bun printed for each file's,
which the repair session receives through `BLOCKER_PROMPT_PREFIX`. With
no open task left, the repair goes after the checklist's last task. A
red task step after a repair task writes its blocker on that repair's
line, marking it `[BLOCKED]` again, and inserts no second one
(`src/start/suite-blocker.ts`). A red pre-wrap-up step inserts a
`[BLOCKED]` repair task (kind `pre-wrap-up`) after the checklist's last
task, and `start.ts` dispatches it in the same run, running the
pre-wrap-up again after the repair completes; a second red pre-wrap-up,
finding the ticked pre-wrap-up repair on the tracker, writes its blocker
on that repair's line and halts.

**One hosted workflow repeats the gates outside a loop.**
`.github/workflows/verify.yml` runs one job, `verify`, with two triggers
and three gates. **Triggers:** pull requests into `main` and pushes to
`stretch/**`. **Gates** (each step runs unless the job was cancelled):
`bun test`, `bunx eslint .`, and `bunx tsc --noEmit`. **Two cases for
`gh pr checks <n>`:** A pull request into `main` reports the `verify`
check (merge with `rafa pr wait <n>` then `rafa pr merge <n>`); a pull
request into `stretch/**` reports no check (merge with `rafa pr merge <n>
--skip-checks`). One more gate runs at `git commit`: `.githooks/pre-commit`
runs `scripts/control-byte-gate/control-byte-gate.ts` with `--staged`,
refusing a commit whose staged blobs carry a raw control byte or an
invisible codepoint. The hook is live only where `git config core.hooksPath
.githooks` has been run.

### Baseline and known failures

**Every run starts by recording a baseline.** The first step of every plan
is a full-suite run that establishes what the tree held at that moment.
Later steps compare their failures against this baseline to separate
inherited failures from new ones. A baseline failure (one present in the
baseline step) does not block work; a new failure (one that first appears
in a later step) does.

**A failure is a test file plus a full test name.** The JUnit reporter
(run with `--reporter=junit --reporter-outfile=<file>`) identifies each
failure by its test file path and the test's full name (including any
nested `describe` blocks). Two failures are identical when both match; a
test name that changes counts as a different failure, so rewriting a test
name can hide a failure without fixing it.

**An error outside any test is counted, named from stderr, and retaken
once.** A test file that throws while it loads is no failure in the
JUnit file: Bun prints it to stderr under `# Unhandled error between
tests` and counts it on the summary's `errors` line. The baseline keeps
that count only, and a step counting more is red. Its blocker names each
block's file and first error line, as `src/boom.test.ts threw "error:
boom"` (`src/start/suite-blocker.ts`), and the blocks with the summary
lines are kept in `.rafa/runs/<session>/suite/<kind>.output.txt`,
beside the failed cases the next paragraph describes. A task,
stage or pre-wrap-up step whose only red is that excess is taken once
more over the same run (`src/start/suite-step.ts`). A retake at or under
the baseline's count prints an `Intermittent` warning naming the first
run's files and lines, and the run goes on; a retake over it again is
red, and the run halts as it does on any red step. Both runs are
recorded, and the files on disk are the retake's.

**A failed case's error is read from stderr, and the step keeps its
first lines.** Bun 1.3.14, the pinned version, writes every thrown
error and failed assertion to the JUnit file as
`<failure type="AssertionError" />` and a timeout as
`<failure type="TimeoutError" />`, with no message, so the report says
which case failed and not why. Bun prints the error above the case's
`(fail)` line on stderr, and `src/suite/failure-lines.ts` reads it from
there: the lines under the code frame, up to the stack, at most five
(`MAX_ERROR_LINES`), each cut at 300 characters. They are kept in three
places. Each of the step's `newFailures` in the run record carries them
as `errorLines`. The step's
`.rafa/runs/<session>/suite/<kind>.output.txt` lists every failed case
under its file, its lines indented under it, between the
unhandled-error blocks and the summary lines (at most 40 cases, the
rest counted). And the blocker quotes the first line of each, by file,
as `What Bun printed for them: src/a.test.ts "error: boom" (2 tests)`,
which is what the repair session reads. A case whose `(fail)` line is
not found on stderr, or that printed nothing, carries no lines, and the
blocker then names its file and count alone.

**The run record stores failures in `.rafa/runs/<run-id>.json`.** Each
step's `failures` array holds the test file + name pairs it observed.
The `newFailures` array in each step lists only the failures not present
in the baseline, each with the `errorLines` Bun printed for it when it
printed any. The runner writes these arrays as each step completes,
and the loop reads them to decide what to report to the next task.

**Known baseline failures are documented on this page.** Some tests fail
on every run because the tree itself is in that state or the test reads
machine-specific state. Read the list below before attributing a failure
to the diff: when a test's file and name appear in the list with its
reason, the failure is known and expected.

### Exit-code and no-polling rules

**Read exit codes from the tool itself, never from downstream commands.**
When a task session or the runner spawns a gate or step, capture its exit
code by redirecting output to a file and immediately reading `$?` (or
`echo "exit=$?"` on the next line) rather than piping to `tail`,
`grep`, or similar. Through a pipe, only the downstream tool's exit code
is captured:

```bash
# WRONG: tail's exit code is read, not the test runner's
bun test 2>&1 | tail -10
echo "Exit code: $?"  # This reads tail's exit code, not bun test's

# WRONG: PIPESTATUS array is empty on zsh (spelled $pipestatus, indexed from 1)
bun test 2>&1 | tail -10
echo "Exit code: ${PIPESTATUS[0]}"  # Empty on zsh

# CORRECT: capture to file, then read immediately
bun test > output.log 2>&1
exit_code=$?
echo "Exit code: $exit_code"
```

**Never use `until` or `while` + `sleep` to poll for completion.** Run the
gate or step in the background (with `&` or shell job control), redirect
its output to a file, and check completion by watching the file (with
`tail -f` in a test watcher, or by reading `test -s` for size, or by
checking the exit file you write yourself), then read the exit code from
the exit file. The runner records steps as they complete and holds their
exit codes; a background loop that waits adds no value when the runner
already provides the records. If you are writing a test that spawns a
gate, write the exit code to a marker file or read it from the process's
recorded step.

### ESLint gate and ignored-file blocker

**An ESLint run that touches only ignored files prints "File ignored"
warnings and must not read as red.** The root `eslint.config.mjs` ignores
`packages/**`, and a diff touching only files under that tree produces
warnings on stdout, but the exit code is still 0. Both the warnings and
the pass are correct: the files are ignored (no error), and the tool's
success is not blocked. When reading the exit code immediately with `$?`,
capture both stdout and stderr to a file first, so the task step captures
the warnings in the gate output without reading them as a failure.

**The runner's lint step tells "could not run ESLint" from "found ESLint
errors" by the JSON report** (`src/start/lint-step.ts`). A nonzero exit
whose stdout is ESLint's JSON report names the files with errors and
the command to run: `found ESLint errors in the task's diff`. A nonzero
exit with no report is a step that could not run ESLint, and its blocker
gives the exit code and the first stderr line under the crash banner, as
in `could not run ESLint: bunx eslint exited 2 and printed no report:
ResolveMessage {}`. Exit 2 with no report is a config ESLint could not
load (a config that throws `boom` prints `Error: boom`, measured on
ESLint 9.39.5) or no ESLint for `bunx` to resolve (`ResolveMessage {}`).
Neither is a rule the task broke, so read that blocker as a setup
problem in the checkout, not as lint errors to fix in the diff.

### The summary line is what the runner reads

**Bun writes a line like `Ran 390 tests, 385 pass, 5 fail (~175s)` after
all tests complete.** The runner parses Bun's summary to extract the
counts. Two gates run on the same tree produce identical counts unless a
case reads an input the tree does not own — which a few cases do,
documented below. When debugging, reproduce the same test run to verify:
two identical runs produce identical output, so once-only variation points
to the input, not the gate. The always-run sweeps gate produces a separate
summary from the affected tests gate, named in both its own output and the
task session record.

### Known failures by cause

The following failures appear on every run because the tree or the test
itself is in that state. Check this list before investigating a failure
you see in a run record.

**The two parity suites skip unless `RAFA_LIVE_PARITY=1`.**
Run the live parity suites with `RAFA_LIVE_PARITY=1 bun test
src/tests/parity-lineage.test.ts`. `src/tests/parity-lineage.test.ts`
compares the sibling's stored effort rows against a fresh collection
over that sibling's live session directory, and
`src/tests/parity-differential.test.ts` collects a frozen copy of that
directory into both backends — input this repository does not own.
Without the variable at exactly `1`, every case of both files skips
under `live parity off: set RAFA_LIVE_PARITY=1 to run against the
sibling's live session logs and stored rows`, before anything on disk is
read (`resolveLiveParity` in `src/tests/parity-fixture.ts`); with it on
and the fixture absent, they skip under the fixture's own reason. Only
a run with the variable set can go red, and its red is about the live
input: lineage's `parity lineage: stored session <id> has no fresh
counterpart` means a `.jsonl` the stored rows name was deleted from the
live directory, and it does not clear on a re-run. In the differential
suite both backends read one frozen copy, so a difference between them
is a real parity failure, not the sibling appending mid-run.

**One suite prints a model refusal on a clean run (baseline: passes).**
`src/tests/backfill-pipeline.test.ts` plants a fake `claude` that echoes
`Sorry, this request could not be completed.` and exits 3; the planted
binary's stdout is not captured away from the suite's own, so both land in
the run log. Read the counts and exit code, never the prose around them.

**One `copy.test.ts` case reads a filesystem-specific error string.**
`rafa effort copy over a live store`'s `copies while another connection
holds a read transaction...` expects `database is locked` but this machine's
SQLite reports `disk I/O error` for the same contention instead.

### Reading the captures

**Inside a Claude Code session, `bun test` names failures only.** The
session sets `CLAUDECODE`, and with it set the runner prints no `(pass)`
line and no name for a file without a failure; the counts and the exit
code do not change. `env -u CLAUDECODE bun test` prints every case.

**The runner now checks touched test files against their base.** The task
session's type gate runs `tsc` on files matching `**/*.test.ts` in the diff
against their base commit. `tsconfig.json` excludes `**/*.test.ts` from the
main gate, so `bun test` strips types without checking them. A test file
type error that exists on the base branch is not new and does not block;
one that first appears in the diff is red. Every task prompt carries one
line handing its session that check before it reports done; the wrap-up's
prompt does not, since `dispatchTask` alone adds it (`typeCheckLines` in
`src/start/task-gate-lines.ts`). The line holds the scratch
tsconfig as JSON, with `<test file>` where each test file's path relative
to the checkout goes (the entry already opens with the checkout's path, so
an absolute one doubles it and tsc reports TS6053), and
`<modules>/.bin/tsc -p <that tsconfig.json> --noEmit --pretty false` to run
in the checkout, both rendered by the type step's own
`scratchTsconfigFields` and `tscArgv` (`src/start/type-step.ts`), so the
line cannot drift from the step. It asks for every error in a test file
the task added, and in one it edited for the errors on the lines
`git diff <base> -- <test file>` names, so the session acts on one run
with no run at the base. A checkout with no `tsconfig.json` at its
root, where the step runs nothing, gets no line, and so does one where the
walk finds no `node_modules/.bin/tsc`; a run whose suite steps
are off (no baseline) still gets it. To check one by hand, point a
tsconfig outside the repo at it — `extends` this repo's `tsconfig.json`
by absolute path (a bare `tsconfig.json` is looked up as a package, the
repo's options are never applied, and hundreds of TS2802 errors follow),
never `tsconfig.base.json`, which leaves `module` unset and fails
`src/plan.ts` and `src/start.ts` on `import.meta` (TS1343), `files` holding
the test's absolute path, `include` empty, `compilerOptions.typeRoots`
naming `<repo>/node_modules/@types` absolutely (left out, every file
reports `Cannot find module 'bun:test'`) — and run `./node_modules/.bin/tsc
-p` on it. Test files already carry errors no gate ever reported, so
compare against the base before attributing one to the diff: TS2769 where a
`readonly` array reaches `toEqual` (`src/config-schema.test.ts`,
`src/project/scaffold.test.ts`, `src/commands/index.test.ts`), and on the
`it(name, { timeout }, fn)` form in the spawned suites. A type-level claim
that must stay checked belongs in the suite instead, as in
`src/ports/index.test.ts`, which runs `ts.createProgram` over probe files.

**Test-file type-error backlog:** A scratch tsconfig over every `*.test.ts`
with the recipe above reported 460 errors in 144 files at commit
a64ab15c2756104ae685421cbfe063efa2f845a6. The command was:
`./node_modules/.bin/tsc -p <scratch-dir>/tsconfig.json --noEmit --pretty
false`, with the scratch `tsconfig.json` holding `"extends":
"<repo>/tsconfig.json"` (absolute path), `"files"` listing every `.test.ts`
by absolute path, `"include": []`, and `"compilerOptions": { "typeRoots":
["<repo>/node_modules/@types"] }` (absolute path to the repository root's
`node_modules`; both `bun` and `tsc` resolve imports by walking up the
filesystem from the worktree, stopping at the main checkout's top level to
find the shared `node_modules` there).
A test type error that existed on the task's base commit is a held error:
backlog rather than a bug, and not reported as out-of-scope. The type
step's line in the task session output reports the held error count from
the base, allowing later sweeps to compare against this baseline and measure
progress on the backlog.

Widening an exported interface reaches every `*.test.ts` literal with no
gate saying so: grep the type name across the test files and fix each
literal by hand. Adding `blocking` to `SpecReviewGap` reddened a `toEqual`
in `src/adapters/planner/claude.test.ts`, which builds a gap as an object
literal rather than through `parseSpecReview`, and only `bun test` reported
it.

**A passing test file proves nothing about its imports.** Bun answers a
bare `'vitest'` import with its own runner, so a file never ported off
vitest passes `bun test`; only `lint`'s `import/no-unresolved` reports
it. Grep `from 'vitest'` to find one.

**A read-and-record task produces no commit, so the SHA it cites is an
older one.** A task whose whole deliverable is a reading — the gate
captures, the mergeability check, the close-out notes — changes no tracked
file, and the loop commits nothing for it. The SHA to cite beside such a
reading is the most recent commit that DID change a tracked file, carried
forward unchanged through every no-diff task after it, and `HEAD` is
exactly that.

**A clean mergeability reading needs a liveness control.**
`git merge-tree --write-tree origin/main HEAD` exits 0 and prints one tree
hash when the merge is clean — which is indistinguishable from a command
that never really looked. Prove it fires in the same session: in a scratch
`git worktree`, branch two throwaway commits off one base, each editing the
same file differently, and run the same command on them. Exit 1, a
`CONFLICT (content):` line and the three numbered index stages are the
positive control. Use a worktree so the real tree and branch are never
touched, and clean up with `git worktree remove --force` and `git branch -D`.

**Every gate's capture is a snapshot that ages.** A gate run at commit A
answers what the code held at A, which is a different reading from what
the code holds at commit B. Where a close-out or a PR body cites a gate
capture, record the commit SHA that produced it — one line showing commit,
exit code, and gate name is what lets a reader verify the capture against
the repo's history rather than taking it on trust.

**`toMatchObject` mutates the object it received.** Measured under
bun 1.3.14, this repo's pinned runtime: after one
`expect(x).toMatchObject({ message: expect.stringContaining('...') })`,
`x.message` IS the matcher, so a second assertion on the same object fails
however right it is, and prints `"message": StringContaining` as the value
it received. Never assert twice on one object with `toMatchObject`. Narrow
the variant with a helper that throws on the wrong one, then assert the
field with `toBe` or `toContain`.

**No gate can read a file that does not exist on disk.** A file deleted
from the worktree but still staged in the index passes `git ls-files`
while failing `existsSync`. Every gate that opens the file by path will
fail, so stage the deletion and re-run — a gate's refusal to open a staged
delete is not a fault.

### Spawned CLI tests

`src/tests/cli-capture.ts` (`plantScratchRepo`, `plantProjectConfig`,
`runRafa`) runs the CLI as a child; `src/commands/plan/validate.test.ts` is
the reference example. This section replaces nothing.

- `runRafa` gives the child a `PATH` of `scratch.bin`, then git's
  directory, `/usr/bin` and `/bin` (`hostToolDirs()` in
  `src/tests/stand-in-gh.ts`), and nothing else. Plant an executable
  (mode 755) in `scratch.bin` to make a program present; leave it out of
  `scratch.bin` to make one absent that those directories do not hold.
- `runRafa` also sets `RAFA_TEST=1` and the suite's own `TMPDIR` on the
  child, ahead of the case's `env`, so a case naming either overrides it.
  `RAFA_TEST=1` makes the child a test process to the effort store's test
  guard (`src/effort/store/location.ts`), and the `TMPDIR` lets that guard
  judge the scratch project by the directory the suite built it under.
  This replaces nothing.
- macOS keeps `cat`, `mkdir`, `rm` and `sleep` in `/bin` alone, and
  Linux in `/usr/bin` beside git, so a scratch `PATH` built by hand takes
  `...hostToolDirs()` after its `bin/`, never git's directory alone: a
  stand-in calling `cat` under git's directory alone prints nothing on
  macOS, and the loop holds the task with no report. A stand-in that must
  hang can still `exec "<process.execPath>" -e 'setTimeout(() => {},
  600000)'`, which no host directory changes.
- A scratch project's `origin` is a bare path, so `resolvePrProvider`
  answers `none` and no pull request read calls `gh`. Plant
  `pr.provider: gh` in `.rafa/config.yaml`, and `roadmap.issue` too when
  the test needs the board read (`rafa status`, `rafa next`); without it
  the board section warns without calling `gh`. `loop start` is the
  exception: its risk total (`src/start/risk-total.ts`) reads the
  accounts through `gh` on every run, whatever the provider, so plant a
  refusing `gh` stand-in for every `loop start` test. This replaces the
  claim that a scratch project calls no `gh` at all.
- A stand-in `claude` that writes JSON (a session log, a report) builds
  it in a small `.mjs` script it runs with `"<process.execPath>"`, since
  hand-quoted JSON in `/bin/sh` breaks and a bare `bun` is not on the
  child's `PATH`. This replaces nothing.
- A `ROUTES` case in `src/commands/index.test.ts` splits its route line on
  spaces, so a quoted multi-word argument does not group; use one word.
- `runRafa` spawns `src/rafa.ts` (`RAFA_ENTRY`), not the build. To prove
  a behaviour against `dist/cli.js`, copy the test and `cli-capture.ts`
  to temporary files with `RAFA_ENTRY`'s URL swapped to
  `../../dist/cli.js` and the import pointed at the copy, run them after
  `bun run build`, and delete them. This replaces nothing.

### Spawned failure helpers

**When a spawned case fails, `expectExit` and `expectEvent` print the
child's exit code, the last 80 lines of each stream, and the scratch
paths the case names.** A case spawned with `runRafa` that asserts the
result uses these helpers:

- `expectExit(run, code, scratch?)` — Passes silently when `run` exited
  with `code`. Otherwise throws an `Error` naming the expected and actual
  codes, with the child's full failure message below: exit code, last 80
  lines of stderr (cut if longer), last 80 lines of stdout (cut if
  longer), and each path in the `scratch` argument (a `ScratchRepo` or a
  case-named `Record<string, string>`).
- `expectEvent(run, name, scratch?)` — Answers the first named event
  (`type: 'event'`) called `name` on the run's json stdout. Throws an
  `Error` with the same failure message when no such event is there, or
  when a stdout line is not JSON.
- `describeRun(run, scratch?)` — Answers the failure message text alone,
  used by the helpers above and by a case asserting something else of a
  run's output; passes it as its own error message.

A new spawned case passes its run result to `expectExit` or `expectEvent`,
with the `scratch` argument naming the `ScratchRepo` the case built, so
all failure output lands in one place a reader can find: the test itself
names the assertion that failed, and the error message names the scratch
directory, the exit code, and the streams the child wrote.
`src/tests/spawned-exit-code.sweep.test.ts` holds the rule: it fails on
any test file under `src/` asserting a spawned rafa run's exit code with
a bare `expect(run.exitCode).toBe(n)`. It reads each asserted value back
to its declaration, so an in-process result asserted bare still passes.

### Fixture scrub, guard, and path rules

**Every committed fixture is scrubbed of machine identity before it ships.**
Fixtures are test data read as input: real text copied from the board or
the store, quoted in a test to show what it held when the test was made,
or patterns planted by a test to verify how code reads them. Real text
names the machine it came from — home directory paths, email addresses,
host names, and secrets in the environment. Before a fixture is written to
disk and committed, `src/fixtures/scrub.ts` (`fixtureScrubber`) redacts
each kind in turn: secret names (reported by name, never by value),
localhost paths, home paths (`/home/<name>`, `/Users/<name>`,
`C:\Users\<name>`), email addresses (version pins like `pkg@1.2.3` left
out), and the running host name (with word-boundary guards so `sandbox`
does not match `box`). Once redacted, `findLeaks` reads the text again; if
any leak is found, `ScrubRefusal` is thrown and the fixture is not written.

**The fixture guard (`src/fixtures/fixture-guard.sweep.test.ts`) is a
content sweep that runs on every task session and verifies no leak is left
in any committed fixture.** It reads every file `git ls-files` lists in a
fixture folder (not a directory walk, so only what a commit would ship),
and fails if any machine identity is found. The guard plants control files
(`src/fixtures/testdata/leak-controls/`) with one leak each plus a version
pin with none, and must fail on the three leaks and pass the pin, proving
the check is working. The host token `{{HOST}}` in the control files is
filled with the running host name at read time.

**Fixture paths are identified by `isFixturePath`.** A repository-relative
path is a fixture path when one of its folder segments is exactly
`testdata` at any depth, or when it starts with `src/tests/fixtures/`.
The function lives in `src/fixtures/fixture-path.ts`. A path is relative
to the repository root, with `/` between segments. A file named `testdata`
is not a fixture path by name alone; only folders segment a path. This
replaces nothing.
