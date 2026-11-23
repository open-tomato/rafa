---
plan: atlas-gh-diff-stats
title: Atlas reads pull request diff stats in pages of 25
level: patch
---

- atlas: `build --github` and `serve --github` no longer fail their GitHub read on a repository with a few hundred pull requests. `gh pr list` no longer asks for `additions`, `deletions` and `changedFiles`, whose pages of 100 GitHub answered 502; a third call, `gh api graphql --paginate` in pages of 25, reads them and merges them in by number. When that call fails, the pull requests keep NULL diff stats and `local.prs` is stamped partial with the reason, and the rest of the read is kept.
