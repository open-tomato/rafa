## Verification

### Gate order

Run these checks in this order before any PR. Each gate opens a specific set
of files — understand which files your change touches, and which gates can
actually reach them.

**These gates are the WHOLE of verification: there is no hosted one.** The
repository carries no `.github/` directory on any branch, so no workflow
runs against a PR and `gh pr checks <n>` answers `no checks reported`
forever rather than for a moment. That is the expected reading here and
never a symptom — in a repository that DOES have workflows it would be
ambiguous between a run not yet scheduled and a conflicting PR that will
never get one, which is why the reading to take is the ref check
(`git ls-remote origin 'refs/pull/<n>/*'`, where a mergeable PR exposes
`merge` beside `head`) and not the checks list. Nothing catches a red
gate after the push, so capture the three exit codes at the commit that
is actually the PR's head.

| Gate | Runs | Files it can open |
|---|---|---|
| `bun run check-types` | TypeScript compiler | `src/`, `scripts/` and root `*.ts`/`*.mjs`, with every `**/*.test.ts` excluded |
| `bun run lint` | ESLint | `.js`, `.mjs`, `.ts`, `.md` and `.json` across the tree, except `dist/`, `.claude/`, `.rafa/`, `.tmp/` and `.docs/` |
| `bun run test` | Bun's native test runner | Every `*.test.ts` outside `node_modules/` and dot-directories, `scripts/` included |

One more gate runs at `git commit` rather than before the PR.
`.githooks/pre-commit` runs `scripts/control-byte-gate/control-byte-gate.ts`
with `--staged`, refusing a commit whose staged blobs carry a raw control
byte or an invisible codepoint. The hook is live only in a clone where
`git config core.hooksPath .githooks` has been run. By hand, the script
with no flag reads every tracked file, and `--include-untracked` adds the
files not yet added.

### Reading the captures

A gate's output is what it wrote to stdout and stderr. The first line after
any banner carries the verdict: TypeScript exits nonzero on type errors,
ESLint exits nonzero on lint violations, and the test runner exits nonzero
when any test fails.

**A green gate is a zero exit code.** Capture the exit code beside the
gate name, not a word from the output. The test runner writes pass/fail
counts after all tests complete, and its order is deterministic, so two
runs of the same tree move only where a case reads an input the tree
does not own — which one case does, below.

**One case reads a frozen copy of session logs.**
`src/tests/parity-differential.test.ts` runs the collector twice, once
per backend, over a frozen snapshot of logs from the sibling's session
directory `~/.claude/projects/-Users-marcos-projects-agentic-research`.
The snapshot eliminates the race condition where the live directory would
change between collection passes: the sibling's loop would append to its
`.jsonl` files while the test collects, altering the rows the test reads.
Both backends now read identical input and are compared for parity, with
the test validating that `holds every session row byte-identical between
backends, keyed by session id`.

The fields the race moves are NOT confined to `sizeBytes` and
`modifiedAt`, as this paragraph read until 2026-09-20: one run during
rafa-21 differed in `lineCount`, `recordCount`, `recordTypeCounts`,
`usage` and `lastTimestamp` with those two EQUAL, which a two-field rule
would have misread as a real parity failure. Separate race from failure
by re-running the file instead: the race does not survive a re-run
against a sibling that has since gone quiet, while a real parity failure
reproduces every time. Do NOT reach for a stash-and-re-run to prove it
pre-existing: that is a second full suite against a moving input.

**Inside a Claude Code session, `bun test` names failures only.** The
session sets `CLAUDECODE`, and with it set the runner prints no `(pass)`
line and no name for a file without a failure; the counts and the exit
code do not change. `env -u CLAUDECODE bun test` prints every case.

**`check-types` never reads a test file.** `tsconfig.json` excludes
`**/*.test.ts`, and `bun test` strips types without checking them, so a type
error in a test is green on every gate. To check one by hand, point a
tsconfig outside the repo at it — `extends` this repo's `tsconfig.json`,
never `tsconfig.base.json`, which leaves `module` unset and fails
`src/plan.ts` and `src/start.ts` on `import.meta` (TS1343), `files` holding
the test's absolute path, `include` empty, `typeRoots` naming
`<repo>/node_modules/@types` absolutely — and run
`./node_modules/.bin/tsc -p` on it. A type-level claim that must stay
checked belongs in the suite instead, as in `src/ports/index.test.ts`,
which runs `ts.createProgram` over probe files.

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
