---
name: rafa-tooling
description: "Use before running or suggesting `gh issue`, `gh pr`, `gh release`, branch cleanup or any `rafa` command in a rafa project."
prevents: "gh chains where one rafa line does the step, and rafa lines handed over as chat prompts, with bad flags, or run in the wrong checkout"
signal: silent
when_to_use: "You are about to list, show, create, comment on or move an issue; show, wait on, merge or triage a pull request; read or cut a release; clean up branches; start a loop or update rafa; or hand the user any `rafa` line — in a project with `.rafa/config.yaml`. Prevents: gh chains where one rafa line does the step, and rafa lines handed over as chat prompts, with bad flags, or run in the wrong checkout"
tags:
  - rafa
  - gh
  - github
  - workflow
  - shell
stack:
  - shell
---

# Prefer the rafa line

This project has rafa installed, and rafa already wraps the tracker, pull
request and release steps. Its line is shorter, it reads the project's
config (board, labels, base branch), and it does the follow-up steps a raw
`gh` call leaves to you, such as deleting both branches after a merge.
So when a row below covers the step, run or suggest the rafa line.

## rafa is a shell command

`rafa` is a CLI on the user's PATH, so a rafa line is something a shell
runs. It never goes into a suggested chat prompt: accepting that prompt
sends the text back to you as a message, and nothing runs. Each rafa line
goes one of three ways, and the first that matches wins.

1. **The user runs it.** Merging, tagging, pushing a tag, publishing,
   `rafa self-update`, `rafa loop start`, `rafa issue ready`, and
   `rafa cleanup` without `--dry-run`. `rafa next` too, unless it has
   `--dry-run` or a `--yes` list of only `sync`, `wait`, `unblock`, `home`
   and `resume`. This holds even when the user asks you to do it ("merge
   it"), so do not try it first. Hand it over in a fenced `bash` block,
   one command per block, so the app shows a Run button, and say what it
   will do in one line.
2. **You run it.** Reads (`show`, `list`, `status`, `current`, any
   `--dry-run`) and other writes the user asked for in this conversation.
   Your Bash tool has no terminal, so a command that asks a question
   refuses there: pass `--yes` where the command has it, `--no-hint` to
   skip the closing question, and `--output=json` when you parse the
   result. A command with no `--yes` that still asks refuses without a
   terminal: it goes to case 1, and `</dev/null` never stands in for an
   answer.
3. **You ask first.** A write nobody asked for, such as moving an issue or
   posting a comment: ask once, then run it as in 2.

A user message that is only a rafa line (`rafa next --roadmap`) means "run
this". Run it when it fits case 2. When it needs a terminal, run its
`--dry-run` form if it has one, show what it would do, and hand the line
back as a `bash` block. Do not answer it with an explanation of what the
command is.

A command the permission prompt stopped did not run, so report it as not
run, never as done.

A command meant for another machine (a loop host over ssh) goes in a plain
fenced block with no `bash` tag, under a line naming the machine: the Run
button on a `bash` block runs it here.

## Flag syntax

Write a flag that takes a value as `--name=value`, the form help and its
examples use: `--plan=.rafa/plans/PLAN-<stub>.md`. The space form parses
too, but mixing the two in one reply reads as two different flags. A
boolean is `--name`, and a boolean that defaults on is turned off with
`--no-name` (`--no-hint`, `--no-comment`). Every command takes
`--output=json`, which prints one JSON event per line: a `start` line,
then a `result` line whose `data` holds the answer. Read the `result`
line; the whole output is not one JSON document.

Some inputs are positional arguments, not flags: `rafa plan validate
<file>`, not `--plan=<file>`. Before using an action or flag for the first
time in a session, read `rafa <subject> <action> --help`; do not guess an
action (`loop show` does not exist, `loop status` does). Pass the subject
and the action as two words, never quoted together as one.

## 🪙 commands start a Claude session

`rafa --help` and the README mark with 🪙 the commands that start a Claude
Code session. They need the `claude` CLI installed and signed in, they
spend the user's usage, and they cannot run where there is no Claude, such
as another model's agent or a CI job without it.

| Always 🪙 | 🪙 only in some cases |
|---|---|
| `plan create`, `loop start`, `epic close` | `pr triage`, `agent search`, `skill search`, `skill backfill`, `next` (when the step it runs is one of these) |

A free `gh` read is never swapped for one of these without saying it will
spend a session.

## Before a command that needs an account

Board, issue, pull request and epic commands go through `gh`, so they need
`gh auth status` to pass. Publishing needs `npm whoami` to pass. When a
command fails on auth, report which login is missing and hand over
`gh auth login` or `npm login` as a `bash` block: the user signs in, you
never do. `rafa doctor` checks the rest of what a loop needs.

## Which checkout

Run and suggest rafa commands from the checkout that holds `.rafa/`,
usually the main one. A session worktree often has no `.rafa/`, so a plan
created there lands in the wrong root; say which directory a handed-over
command is for. `loop start --create-branch` in a worktree on a detached
`HEAD` names the branch `HEAD`.

`loop start` and `self-update` act on the checkout and the global install
that a running loop may be using, so run `rafa loop list` and
`git worktree list` first.

- **`loop start`** on a checkout that holds another loop's branch or
  uncommitted work: use `--as-worktree`, which runs the plan in its own
  worktree on `feat/<stub>` and leaves this checkout as it is.
- **`self-update`** replaces the global `rafa` that live loops run. From
  0.31.0 it refuses while a loop of the project is live; on older versions
  (`rafa --version`) check `rafa loop list` yourself and wait.

## Before handing over `pr merge`

`rafa pr merge` refuses in three cases a suggestion can check first:

- **Pull request into `main`.** A pull request into the base branch reports
  the `verify` check. Merge by handing over `rafa pr wait <n>`, waiting for
  the checks to pass or fail, then `rafa pr merge <n>`. Never use
  `--skip-checks` on a PR into `main`.
- **Pull request into `stretch/**`.** A pull request into a `stretch/` branch
  reports no check. Merge by handing over `rafa pr merge <n>
  --skip-checks`.
- **A dirty tree.** It refuses on uncommitted changes, which a loop running
  in the same checkout leaves. Check `git status` in the checkout the
  command is for.
- **The branch is checked out elsewhere.** It refuses while the head branch
  is checked out in another worktree, your own session worktree included.

## Pasted terminal output

The user's prompt theme draws a status line above and below each command,
for example:

```text
rafa HEAD +1 -0 │ rafa:0.31.0 │ roadmap: #252 [5/10] │ 🍅 #367 18/47
Milanesa > rafa next --dry-run
```

A line with `│` separators or `🍅` is that header: it shows the branch, the
installed version and the live loops with tasks done over total. It is not
command output, and the version in it can be stale by one command. The
command the user ran is the text after the prompt's `>`. Read the output
as the user's run, and do not run the same command again from your own
worktree to check it.

## Shell traps

`$?` after `rafa … | tail` is the exit code of `tail`: run rafa without the
pipe, or read `${pipestatus[1]}` in zsh. In zsh, `echo ====` fails with
`==== not found`, so quote separators: `echo '----'`.

## The mappings

Each row pairs the verbose command with the rafa line that replaces it.

| Instead of | Use |
|---|---|
| `gh issue list --label …` | `rafa issue list --type=bug --search=…` |
| `gh issue view 12` | `rafa issue show 12` |
| `gh issue create --title … --label …` | `rafa issue create --title=… --type=… --priority=…` |
| `gh issue comment 12 --body …` | `rafa issue comment 12 --body=…` |
| `gh issue close 12`, label edits for state | `rafa issue move 12 done` |
| `gh pr view --json … \| jq …` for the current branch | `rafa pr current` |
| `gh pr view 41`, `gh pr checks 41` | `rafa pr show 41` |
| `gh pr view 41 --web` | `rafa pr view 41` |
| `gh pr list` | `rafa pr list` |
| `gh pr checks 41 --watch` | `rafa pr wait 41` |
| `gh pr merge 41 --squash --delete-branch` + local branch cleanup | `rafa pr merge 41` |
| `git branch --merged`, `git worktree list` + removals | `rafa cleanup` |
| reading the tag, version files and changelog by hand | `rafa release status` |
| `git tag v…` from the version files | `rafa release tag` |

Board and roadmap reads have no short `gh` form at all: use `rafa status`,
`rafa next --dry-run`, `rafa roadmap` and `rafa epic show`.

## When to keep gh or git

Some steps have no rafa action, so use the plain command for them:
`gh pr create` outside a loop, `gh pr checkout`, `gh run view --log`, and
`gh api` reads. Plain `git` stays for commits, pushes and rebases.

## Finding a command not listed here

`rafa <subject> <action> --help` gives one command's flags and examples.
For the whole tree in one page (about 2,600 tokens), run
`rafa describe | bun .claude/skills/rafa-tooling/help-tree.ts`; add
`--flag-notes` for one line per flag (about 7,400 tokens). `rafa describe`
alone is the full JSON roster (about 54,000 tokens), so read it only for a
single command's entry.
