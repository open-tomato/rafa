---
plan: rafa-822-bug-sweep-15
title: Bug sweep 15 — merge, cleanup, status and release do their step
level: minor
---

- Pull requests: `rafa pr merge` no longer refuses on an untracked file the merge never touches, naming it in one line and leaving it in place; it reads settle's `rafa/release` pull request as the release delivery, one line naming the version it lands with no stale warning and no `fix:` line; and `rafa pr triage` no longer classes that pull request as `conflict-version`, so `--resolve` never turns the release back into a fragment.
- Cleanup: `rafa cleanup` gains a `Run records` group that removes finished run records and their events files under `.rafa/runs/`, keeping the running ones and the newest of each plan; it starts a Merged branch unticked when a worktree that cannot be removed holds it, naming that worktree; it no longer ticks a merged branch the base does not reach, naming the pull request and the commits past its head and deleting with `-D` only when those commits are release fragments the base already holds; and branch rows pad to the widest branch name rather than the widest worktree path.
- Status: `rafa status` and the status hook count idle loop worktrees under the configured `loop.worktreeDir`.
- Release: `rafa release settle` says a push a repository rule refused was not delivered, naming the rule and `release.settle: pr`, instead of ending on git's `Done`; it creates `CHANGELOG.md` under a `# Changelog` heading when the base has none, and `--dry-run`, `rafa doctor` and `rafa release status` say a missing changelog is missing and that settle creates it; and `rafa release tag --push` pushes the new tag to the remote the base branch tracks, exiting 1 and keeping the local tag when the push is refused.
