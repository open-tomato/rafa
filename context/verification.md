## Verification

### Gate order

Run these checks in this order before any PR. Each gate opens a specific set
of files — understand which files your change touches, and which gates can
actually reach them.

| Gate | Runs | Files it can open |
|---|---|---|
| `bun run check-types` | TypeScript compiler | `src/`, `scripts/` and root `*.ts`/`*.mjs`, with every `**/*.test.ts` excluded |
| `bun run lint` | ESLint | `.js`, `.mjs`, `.ts`, `.md` and `.json` across the tree, except `dist/`, `.claude/`, `.plans/`, `.specs/`, `.tmp/` and `.docs/` |
| `bun run test` | Bun's native test runner | Every `*.test.ts` outside `node_modules/` and dot-directories, `scripts/` included |

One more gate runs at `git commit` rather than before the PR.
`.githooks/pre-commit` runs `scripts/control-byte-gate/control-byte-gate.ts`
with `--staged`, refusing a commit whose staged blobs carry a raw control
byte or an invisible codepoint, loop-written text in a tracked file such
as `progress.txt` included. The hook is live only in a clone where
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
counts after all tests complete, and its order is deterministic — measure
the same gate twice and the counts move only when a test's result changed.

**Inside a Claude Code session, `bun test` names failures only.** The
session sets `CLAUDECODE`, and with it set the runner prints no `(pass)`
line and no name for a file without a failure; the counts and the exit
code do not change. `env -u CLAUDECODE bun test` prints every case.

**`check-types` never reads a test file.** `tsconfig.json` excludes
`**/*.test.ts` (the `.specs/test-type-checking.md` its comment cites does
not exist), and `bun test` strips types without checking them, so a type
error in a test is green on every gate. To check one by hand, point a
tsconfig outside the repo at it — `extends` this repo's, `files` holding
the test's absolute path, `include` empty, `typeRoots` naming
`<repo>/node_modules/@types` absolutely — and run
`./node_modules/.bin/tsc -p` on it. A type-level claim that must stay
checked belongs in the suite instead, as in `src/ports/index.test.ts`,
which runs `ts.createProgram` over probe files.

**A passing test file proves nothing about its imports.** Bun answers a
bare `'vitest'` import with its own runner, so a file never ported off
vitest passes `bun test`; only `lint`'s `import/no-unresolved` reports
it. Grep `from 'vitest'` to find one.

**Every gate's capture is a snapshot that ages.** A gate run at commit A
answers what the code held at A, which is a different reading from what
the code holds at commit B. Where a close-out or a PR body cites a gate
capture, record the commit SHA that produced it — one line showing commit,
exit code, and gate name is what lets a reader verify the capture against
the repo's history rather than taking it on trust.

**No gate can read a file that does not exist on disk.** A file deleted
from the worktree but still staged in the index passes `git ls-files`
while failing `existsSync`. Every gate that opens the file by path will
fail, so stage the deletion and re-run — a gate's refusal to open a staged
delete is not a fault.
