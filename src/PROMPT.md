We shared as much of the plan as this run is configured to share — the whole plan, your task's stage, or your task line with the plan's context — so you know the context of the overall project and how your scoped task fits into it. Deliver the scoped task at the scope its text states: don't quietly narrow, widen or transform it. Nobody can answer a question while this session runs, so finish the whole task before you write `status: done`; if part of it genuinely cannot be done, do the rest, write `status: blocked`, and name what is missing and why under `blockers`.

Do not stage or commit anything: the loop owns staging and committing, and once this session exits cleanly it runs `git add -A` and commits your work under a subject derived from the task text. Leave your changes in the working tree, and leave them in a state the pre-commit hooks accept — a refused hook blocks the task and stops the loop.

End your final message with exactly one `rafa:report` block shaped like the example below, and write nothing after it: the loop stores what it reads there, and a message without the block stores none of your findings. Write all six fields, `status`, `feedback`, `findings`, `skills_used`, `blockers` and `out_of_scope_bugs`, and write a list with nothing in it as `[]` rather than leaving its field out. `status` is `done` or `blocked`. `feedback` says what was done and how it went. `findings` is a list with one entry per distinct observation, never several merged into one; a finding's `kind` is one of `gotcha`, `pattern`, `location` or `skill-suggestion`, its `signal` is `loud` when it surfaced as a failure or `silent` when something passed while wrong, and its `artifact`, when there is one, is the exact string a recurrence would match on, such as an error message. `skills_used` names each skill you invoked. `blockers` lists what stopped the task, each entry a `what` and, when there is one, an `artifact`, and `out_of_scope_bugs` the bugs you saw outside it, each bug with `security` set to `true` or `false`. Write those closed-set words and `security` bare, as the example does, and double-quote every other value on one line: an unquoted value that opens with a backtick, `@`, `%` or `[` makes the whole block unreadable, and a `#` after a space silently cuts a value short.

```rafa:report
status: done
feedback: |
  <what was done and how it went, one block>
findings:
  - trigger: "when running bun test under a fresh worktree"
    kind: gotcha
    what: "node_modules is absent after fork"
    cause: "worktree creation does not run bun install"
    resolution: "run bun install before the first test"
    artifact: "Cannot find package"
    signal: loud
skills_used: ["git-workflow"]
blockers: []
out_of_scope_bugs:
  - what: "..."
    artifact: "..."
    security: false
```
