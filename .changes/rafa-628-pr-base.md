---
plan: rafa-628-pr-base
title: A loop's pull request opens against pr.base
level: patch
---

- loop: A loop's pull request now opens against the run's base (`pr.base`, else `origin/HEAD`, else `main`) rather than the repository's default branch; one opened against another base is retargeted before the CI wait with one line saying so, and under `loop start --as-worktree` the release step pushes the run's branch and writes its line into that branch's pull request.
- pr: Pull requests can now be retargeted to another base (`gh pr edit --base`), with a warning instead of a failure if `gh` refuses.
