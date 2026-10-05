---
plan: rafa-768-bug-sweep-8
title: Bug sweep 8 — the run's base everywhere, claim branches that catch up, worktree sessions collected, forward references, `issue ready --yes`
level: minor
---

- loop: the wrap-up session and its CI-repair and conflict-repair sessions now sync with and restore `bun.lock` from the run's base branch (`pr.base`) instead of always `origin/main`; a text-mode run now writes its `pr` or `no-pr` event to the run's events file, so `rafa loop wait` can end on it, and a run with no pull request provider records that event without listing pull requests
- loop start: an existing claim-only branch merges the latest base before the first task, and a branch holding other work is reported as behind and left unmerged
- effort: `rafa effort collect` now reads the session logs of the project's worktrees as well as the main checkout's, stores each session once and records the worktree it ran in, in a new nullable sessions column added by the `session-worktree` migration
- issue: `rafa issue ready --yes` marks a spec ready without a question once the author, template and `epic:` checks pass; a failed check still refuses
