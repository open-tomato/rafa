---
name: rafa-hookify
description: "Install or refresh the rafa tooling pack in this project: the rafa-tooling skill, its PreToolUse hook and the AGENTS.md pointer."
disable-model-invocation: true
prevents: "a project where agents run gh chains and user-run rafa commands because the tooling skill or its hook is missing or stale"
signal: silent
tags:
  - rafa
  - claude-code
  - hooks
  - setup
stack:
  - shell
---

# rafa-hookify

Puts the rafa tooling pack in place in the current rafa project, or
refreshes it after this folder was updated. The pack makes agents prefer
rafa lines over `gh` chains and hand the user the commands that are the
user's to run. The installer is `install.ts` in this skill's base
directory, and it checks every step first, so running it twice changes
nothing.

## Steps

1. From the project's main checkout, the one that holds `.rafa/`, run the
   installer with `--dry-run`, and show the user its list:

   ```bash
   bun "<this skill's base directory>/install.ts" --dry-run
   ```

   Exit code 2 means it refused, for example in a worktree with no
   `.rafa/`. Report its message and stop.
2. When the list has an `added` or `updated` row, run the same line
   without `--dry-run`.
3. Check the hook answers. This prints a JSON line with
   `"permissionDecision":"deny"`:

   ```bash
   echo '{"tool_name":"Bash","tool_input":{"command":"gh pr checks 1"}}' | bun .claude/hooks/rafa-tooling-hook.ts
   ```

4. Run `rafa skill check .claude/skills --project=.` and report a failure
   in `rafa-tooling` if there is one.
5. Tell the user what changed, row by row, and that the pack takes effect
   in the next Claude Code session. Leave the changes uncommitted.
