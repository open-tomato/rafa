## Verification

### Gate tiers and task declaration

**A task session runs a targeted subset of checks; the runner runs the full
suite at defined stages.** A task line declares `tests=affected` (the
default), `tests=module`, or `tests=full` to control what its session checks.

**Task session gates** (read one exit code from each):
- `bun test --changed=<base>` (affected), `bun test --changed=<base>
  --reporter=junit --reporter-outfile=<file>` to read failures via JUnit
- `bunx tsc --noEmit` (only TypeScript, test files excluded via tsconfig)
- `bunx eslint <changed files>` (ESLint on changed files only)

All three redirect to a file and read `$?` immediately after with
`exit=$?` on the next line — never pipe through `tail` or poll with
`until`/`while` + `sleep`. Through a pipe, `tail`'s exit code is read
instead of the gate's, and `${PIPESTATUS[0]}` prints empty on zsh. Polls
waste time when the runner will record the same gate later as a real
step anyway.

**Runner recorded steps** (full suite, recorded at fixed points):
- `baseline` — Full suite once at plan start (first dispatch)
- `task` — Full suite after each task's session ends and commits
- `stage` — Full suite after a stage's last task
- `pre-wrap-up` — Full suite before wrap-up session starts

Each recorded step names its scope (affected, module, full, or a
file/folder list it ran on), the command, exit code, Bun's summary line,
every failing test (file + full test name pairs), and which failures are
new against the baseline (not present in `baseline`'s captured failures).

**Declaration key `tests=` on a task line** sets what the task's session
will run:
- `tests=affected` (default): `bun test --changed=<base>` plus types and
  lint on the changed files
- `tests=module`: One full-suite module (e.g., `bun test
  src/effort/**/*.test.ts`) when the task touches files that trigger a
  module re-run
- `tests=full`: Entire suite when the task changes a config file or a
  globally-used module

**Config keys for when a task triggers `tests=full` or `tests=module`:**
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
means it is new. Only new failures block the next task. A stage-end step
with new failures names them in the blocker text the retry session
receives through `BLOCKER_PROMPT_PREFIX`.

**These recorded steps are the WHOLE of verification; there is no hosted
workflow.** The repository carries no `.github/workflows/` on any branch,
so `gh pr checks <n>` answers `no checks reported`. That is the expected
reading. To verify a PR's state, capture the three task session gates
at the commit that is actually the PR's head, and read the runner's
recorded steps from the `.rafa/runs/<run-id>.json` file when a loop ran.
One more gate runs at `git commit`: `.githooks/pre-commit` runs
`scripts/control-byte-gate/control-byte-gate.ts` with `--staged`, refusing
a commit whose staged blobs carry a raw control byte or an invisible
codepoint. The hook is live only where `git config core.hooksPath
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

**The run record stores failures in `.rafa/runs/<run-id>.json`.** Each
step's `failures` array holds the test file + name pairs it observed.
The `newFailures` array in each step lists only the failures not present
in the baseline. The runner writes these arrays as each step completes,
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

**The summary line is what the runner reads.** Bun writes a line like
`Ran 390 tests, 385 pass, 5 fail (~175s)` after all tests complete. The
runner parses Bun's summary to extract the counts. Two gates run on the
same tree produce identical counts unless a case reads an input the tree
does not own — which a few cases do, documented below. When debugging,
reproduce the same test run to verify: two identical runs produce identical
output, so once-only variation points to the input, not the gate.

### Known failures by cause

The following failures appear on every run because the tree or the test
itself is in that state. Check this list before investigating a failure
you see in a run record.

**Two parity-lineage tests read the sibling's live store (baseline: 4
pass, 2 fail).**
`src/tests/parity-lineage.test.ts` compares the sibling's stored effort
rows against a fresh collection over that sibling's live session directory
— input this repository does not own. Two of six cases fail: `matches
every plainly-stored session row to its fresh counterpart, byte for byte`
and `accounts for every grown session log: neither size nor mtime moved
backward`. Both throw `parity lineage: stored session <id> has no fresh
counterpart` because the `.jsonl` for a session the stored rows name has
been deleted from the live directory. This does NOT clear on a re-run.
Prove it pre-existing by running the test at `origin/main` in a worktree
(do not stash, since the input is outside the tree): `git worktree add -q
--detach <tmp> origin/main`, `ln -s` the real `node_modules` into it, run
the one file there (about 5s, no `bun install` needed), and remove with
`git worktree remove --force`. Measured at both ends: `4 pass`, `2 fail`.

**One case reads a frozen snapshot of logs (baseline: passes, race
possible).**
`src/tests/parity-differential.test.ts` runs the collector twice over a
frozen snapshot from the sibling's session directory to eliminate the race
where the sibling's loop appends to `.jsonl` files while collection runs.
Both backends read identical input. The race does not survive a re-run
against a sibling that has since gone quiet. If one run passes and the
next fails, re-run the same suite: a real parity failure reproduces; a
race does not.

**One case reads a gitignored plan (baseline: red).**
`src/plan/parse.test.ts`'s `a real plan file on disk` reads
`.rafa/plans/PLAN-phase-0-package-parity-cutover.md` rather than a
fixture, and `.rafa/` is gitignored. Where the file is absent, the test
fails with an unhandled `ENOENT` between tests. Prove pre-existing in a
worktree at `origin/main`, not a stash (a stash is a no-op once a plan's
diff commits).

**Three cleanup cases are red since 2026-09-24T12:00Z (baseline: 6 pass,
3 fail).**
`src/cleanup/scratch-repository.test.ts` reads its worktrees at fixed
`SCRATCH_NOW` (2026-09-24T12:00Z), but worktrees carry their real
modification time. Once wall-clock time passes `SCRATCH_NOW`, every
worktree carries a `recent` blocker and the three `readCleanup over a
scratch repository` cases fail. It stays red until the fixture dates
worktrees relative to `SCRATCH_NOW`.

**CHANGELOG.md holds old directory tokens red since 0.9.2.**
`src/tests/default-plan-dirs.test.ts`'s `finds nothing in the live tree`
fails because `CHANGELOG.md`'s 0.9.2 section names old directories without
a slash, and the sweep catches both spellings. A plan's session may not
touch a released section, so it stays red until a change exempts
`CHANGELOG.md` or rewords those lines.

**One suite prints a model refusal on a clean run (baseline: passes).**
`src/tests/backfill-pipeline.test.ts` plants a fake `claude` that echoes
`Sorry, this request could not be completed.` and exits 3; the planted
binary's stdout is not captured away from the suite's own, so both land in
the run log. Read the counts and exit code, never the prose around them.

**About twenty spawned tests fail due to `isUnderTempDir` on macOS.**
`src/effort/store/location.test.ts`'s `answers true for a path under the
real path of a symlinked temporary directory` is red because `isUnderTempDir`
canonicalizes the temp dir but not the path, so paths through the symlink
read as outside. This cascades to every spawned test that runs a task
session through this checkout's `bun src/rafa.ts` and needs a migrated
table, halting the loop with `effort store: <path> needs migration ...;
a development build migrates only a store under the temp directory or
RAFA_EFFORT_DIR`. Affected files: `src/tests/loop-sessions.test.ts`,
`src/tests/task-report.test.ts` (six cases), `src/tests/loop-output.test.ts`
(three cases), `src/tests/effort-skills-collect-integration.test.ts`,
`src/tests/serve-spawned.test.ts`, `src/tests/command-output.test.ts`,
`src/tests/preflight-halts.test.ts` (two cases), and
`src/tests/lesson-push-e2e.test.ts`. Confirmed pre-existing at `origin/main`
(commit `e5041c5`) with a worktree.

**A worktree runs fewer skills-tier tests.** Three of the skills-tier
checker suite's cases fail inside a `git worktree` of this repository and
pass in the main checkout. The cause is not investigated. Run only the
file you are proving in the worktree, or subtract those three before
comparing a full run there against a run in the main checkout.

**Two `migrations.test.ts` cases read machine state.**
`describe('the installed 0.24.1 runtime')`'s `holds the rule the
transcription copies` and `describe('the lock at the newest release tag')`'s
`keeps every line of the lock at v0.28.0` fail when the installed binary
and the checked-out tag are older than this tree expects.

**One `copy.test.ts` case reads a filesystem-specific error string.**
`rafa effort copy over a live store`'s `copies while another connection
holds a read transaction...` expects `database is locked` but this machine's
SQLite reports `disk I/O error` for the same contention instead.

### Reading the captures

**Inside a Claude Code session, `bun test` names failures only.** The
session sets `CLAUDECODE`, and with it set the runner prints no `(pass)`
line and no name for a file without a failure; the counts and the exit
code do not change. `env -u CLAUDECODE bun test` prints every case.

**`check-types` never reads a test file.** `tsconfig.json` excludes
`**/*.test.ts`, and `bun test` strips types without checking them, so a type
error in a test is green on every gate. To check one by hand, point a
tsconfig outside the repo at it — `extends` this repo's `tsconfig.json`
by absolute path (a bare `tsconfig.json` is looked up as a package, the
repo's options are never applied, and hundreds of TS2802 errors follow),
never `tsconfig.base.json`, which leaves `module` unset and fails
`src/plan.ts` and `src/start.ts` on `import.meta` (TS1343), `files` holding
the test's absolute path, `include` empty, `typeRoots` naming
`<repo>/node_modules/@types` absolutely (left out, every file reports
`Cannot find module 'bun:test'`) — and run `./node_modules/.bin/tsc -p`
on it. Test files already carry errors no gate ever reported, so compare
against the base before attributing one to the diff: TS2769 where a
`readonly` array reaches `toEqual` (`src/config-schema.test.ts`,
`src/project/scaffold.test.ts`, `src/commands/index.test.ts`), and on the
`it(name, { timeout }, fn)` form in the spawned suites. A type-level claim
that must stay checked belongs in the suite instead, as in
`src/ports/index.test.ts`, which runs `ts.createProgram` over probe files.

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

- `runRafa` gives the child a `PATH` of `scratch.bin` then git's directory
  and nothing else. Plant an executable (mode 755) in `scratch.bin` to make
  a program present; leave it out to make it absent.
- `runRafa` also sets `RAFA_TEST=1` and the suite's own `TMPDIR` on the
  child, ahead of the case's `env`, so a case naming either overrides it.
  `RAFA_TEST=1` makes the child a test process to the effort store's test
  guard (`src/effort/store/location.ts`), and the `TMPDIR` lets that guard
  judge the scratch project by the directory the suite built it under.
  This replaces nothing.
- The same `PATH` means a stand-in `claude` script cannot rely on `cat` or
  other coreutils where git lives outside `/usr/bin`. Print a file with
  shell builtins: `while IFS= read -r l; do printf '%s\n' "$l"; done < f`.
  A stand-in that must hang cannot `sleep` either: the call fails at once
  and a deadline test passes without waiting. Have it
  `exec "<process.execPath>" -e 'setTimeout(() => {}, 600000)'` instead.
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
