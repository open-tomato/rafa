---
plan: rafa-687-bun-git-versions
title: Tests pass on the pinned Bun 1.3.14 and the runner's git, as on a Bun 1.4.2 host
level: patch
---

- triage: A test already failing when the run started is now recognised as inherited even when Bun's JUnit report gives its failure no message, as the pinned Bun 1.3.14 does, so it is no longer filed as a new issue.
- pr merge: `rafa pr merge --skip-checks --yes` now merges a pull request whose base no workflow's `pull_request` trigger names, and says why: `no workflow runs on pull requests into <base>`.
