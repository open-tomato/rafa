---
case: tag-branch
---

# tag-branch

Key: `branch`, a `rafa release tag` refusal reason.

## What it means

The release branch is not the one checked out where the command ran, or no
branch is (a detached HEAD). A release is tagged on the release branch only.
That branch is `pr.base` from the config. When `pr.base` is unset, it is the
default branch, `main`, and the refusal says so, and names the config file
it read.

## The check

`git rev-parse --abbrev-ref HEAD` prints the branch checked out here. The
refusal names it, next to the release branch. `git worktree list` shows
which checkout holds the release branch, if one does.

## The step that clears it

- When a checkout holds the release branch, the step is a `cd` into it: `cd
  <checkout> && rafa release tag`.
- When none does, the step is `git switch <branch>`, then `rafa release
  tag`.
- When `pr.base` is unset, the first step is to set it in the config file
  the refusal names. A tracked `rafa.config.ts` reaches every worktree. A
  gitignored YAML config reaches only its own checkout.
