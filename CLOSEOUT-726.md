# Close-out: remove the Claude usage percent (#726, #605)

## Gate captures
- Acceptance grep, from the repo root:
  `grep -rnw 'CLAUDE_USAGE_PERCENT\|checkUsage\|getClaudeUsagePercent' src docs context README.md`
  printed nothing, exit 1 (no match).
- `bun src/rafa.ts usage`: stdout empty, stderr `rafa: unknown subject or command "usage"`, exit 1.
- `git merge-tree --write-tree origin/main HEAD`: exit 0, tree `eb2ef5a492e6a4e1d9c4db9ba332a4aa78d2886e`, no conflict lines. The branch merges cleanly.

## Test plan
- [x] `bun test --changed=6d4388384d0f522a4e97291795f2be8619ab7b2d`, plus `tsc` and `eslint` on changed files.
- [x] `src/tests/cli-surface.test.ts`: `rafa usage` and `rafa usage --output=json` exit non-zero with the unknown-command refusal; a kept command (`status`) exits 0 in the same scratch project.
- [x] Acceptance grep finds nothing.
- [ ] Full suite once before merge (runner wrap-up).

## PR body lines
Closes #605
Closes #726

## Operator follow-up
Retitle #676 from "feeding the usage halt" to "feeding the quota halt", because the usage-percent halt no longer exists and only the quota halt remains.
