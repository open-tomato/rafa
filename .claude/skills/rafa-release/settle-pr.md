---
case: settle-pr
---

# settle-pr

Key: outcome `pr`, a `rafa release settle` ending.

## What it means

`release.settle: pr` is set. Settle pushed the release commit to the
`rafa/release` branch and opened or updated one pending release pull
request. The base is unchanged until that pull request merges. Closing it
undoes the release before it lands.

## The check

`rafa pr show <n>` shows the pull request and its checks, with the number
the ending names.

## The steps that clear it

1. `rafa pr wait <n>` waits until the checks of the release pull request
   settle.
2. Once it merges, `git merge --ff-only <remote>/<branch>` brings the
   release branch up to the release commit.
3. Then `rafa release tag --push` tags that commit and pushes the tags.

Steps 2 and 3 say `once #<n> merges` in their why, since they wait for the
pull request. Do not tag before it has merged: the tag would name a commit
the base never receives.
