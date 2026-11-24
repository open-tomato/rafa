---
name: rafa-hookify
description: "Install or refresh the rafa tooling pack in this project: the rafa-tooling skill, its PreToolUse hook, the SessionStart sync hook and the AGENTS.md pointer."
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

## The session hook

The installer also wires a SessionStart hook,
`.claude/hooks/rafa-session-hook.ts`, with a 120-second timeout. When a
session opens it runs `rafa effort sync --output=json` in the project,
and prints the lines the run wrote, but only when a hub was contacted.
A pull prints a line such as `hub: reachable, contract 1, project rafa;
pulled 312 rows`. A rafa one release behind its hub prints a line that
names `rafa self-update, then rafa effort sync`, and a hub that is down
prints one offline line. With no hub (`effort.sync` is `local` or
`file`), outside a rafa project, or with no `rafa` on `PATH`, it prints
nothing. It exits 0 whatever `rafa` answers.

To check a sync before it writes anything, run `rafa effort sync
--status`, which asks the hub and moves nothing, or `rafa effort sync
--dry-run`, which shows what it would push, pull and record as conflicts.

To remove the session hook, delete the `SessionStart` entry whose
command names `rafa-session-hook.ts` from `.claude/settings.json` (the
rest of the file stays), and delete `.claude/hooks/rafa-session-hook.ts`.
Running the installer again adds both back, so remove them after the last
run.
