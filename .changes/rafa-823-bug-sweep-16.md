---
plan: rafa-823-bug-sweep-16
title: Bug sweep 16 — pages, notes and messages say what the code does
level: patch
---

- docs: The `context/` pages, the README, `docs/` and the stretch engineer prompt match the code again: `rafa init`'s scaffold, the non-wrapping commands, `effort fix-schema` in the registered list, the status readings that go through `gh`, the `store_meta` `store_id` column and copy detection, the task step's scope, the read-only carry decision, unblocking by removing the `[BLOCKED]` mark, the release steps after `pr merge`, `rafa issue ready --yes`, and `rafa usage` being refused as an unknown subject; the 800-line cap no longer names counts that go stale.
- agents: The bundled `qa-bug-reporter` agent files bugs with `rafa issue create --type=bug --body-file` instead of `gh issue create`.
- notes: Module notes and TSDoc in `doctor.ts`, the command index, the release status summary, `accounts.ts`, `plugins.ts` and `SuiteFailure.message` describe what the code does.
- effort: `rafa effort merge`, `import`, `migrate` and `fix-schema` describe the backup as a copy and name the new store id, instead of saying the original is kept whole or to rename it back to undo.
- loop: The wrap-up's start message says it promotes the listed lessons, and the type step's blocker no longer prints a double period after a tsc message that ends in one.
- refs: Refusing a stamp on an issue reads "an issue is not stamped".
- release: A refused release-branch or tag push during `rafa release settle` no longer ends its message on git's `Done` line, and `rafa release tag` without `--push` prints the push line with the remote the release branch tracks, falling back to `origin`.
- cleanup: `rafa cleanup` lists a Stale or Not-pushed branch checked out in a worktree it cannot remove as unticked, names that worktree, and never deletes the branch even when it is ticked.
