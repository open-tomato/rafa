---
case: settle-push
---

# settle-push

Key: outcome `push`, a `rafa release settle` ending.

## What it means

Settle pushed the release commit to the base branch. Or another settle beat
it to the same fragments, so the base already holds a release this checkout
is behind. Either way the base holds the release, and the release branch
here has to catch up with it before it can be tagged.

## The check

The release commit is on the upstream. `git log -1 <remote>/<branch>` shows
its subject, `chore: release <version>`.

## The steps that clear it

1. `git merge --ff-only <remote>/<branch>` brings the release branch up to
   the release commit.
2. `rafa release tag --push` tags that commit and pushes the tags.

Under `release.tag: settle` settle has tagged and pushed already, so only
the first step is printed. The merge runs in the checkout holding the
release branch. When no checkout holds it, `git switch <branch>` comes
first.
