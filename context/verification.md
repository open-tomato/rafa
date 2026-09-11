## Verification

### Gate order

Run these checks in this order before any PR. Each gate opens a specific set
of files — understand which files your change touches, and which gates can
actually reach them.

| Gate | Runs | Files it can open |
|---|---|---|
| `bun run check-types` | TypeScript compiler | `.ts`, `.tsx`, `.ets` source files and type declarations |
| `bun run lint` | ESLint | JavaScript, TypeScript, and Markdown under `src/`, `scripts/`, root-level prose |
| `bun run test` | Bun's native test runner | Test files under `src/**/*.test.ts` |

### Reading the captures

A gate's output is what it wrote to stdout and stderr. The first line after
any banner carries the verdict: TypeScript exits nonzero on type errors,
ESLint exits nonzero on lint violations, and the test runner exits nonzero
when any test fails.

**A green gate is a zero exit code.** Capture the exit code beside the
gate name, not a word from the output. The test runner writes pass/fail
counts after all tests complete, and its order is deterministic — measure
the same gate twice and the counts move only when a test's result changed.

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
