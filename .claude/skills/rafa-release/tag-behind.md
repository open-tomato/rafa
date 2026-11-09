---
case: tag-behind
---

# tag-behind

Key: `behind`, a `rafa release tag` refusal reason.

## What it means

The release branch is behind the upstream it tracks, so the release commit
may be on the upstream and not in this checkout. Settle pushes the release
commit to the base. A checkout that has not pulled it sits behind, and a tag
written here would miss that commit.

## The check

`git status -sb` shows the branch with `behind` and a count. The refusal
names the upstream and the number of commits.

## The step that clears it

The refusal's own sentence names the command: `git merge --ff-only
<remote>/<branch>`, then `rafa release tag` again. The merge only
fast-forwards. If it refuses, the local branch has commits the upstream
lacks. That is a question for the operator, and not a reason to force
anything.

This refusal prints no `Next:` step of its own, so under `hints.skills:
true` no skill line follows it. This file is the same step read by name.
