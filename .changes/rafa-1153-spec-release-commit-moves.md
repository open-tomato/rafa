---
plan: rafa-1153-spec-release-commit-moves
title: The release commit moves rafa.lock
level: minor
---

- Config: `release.moveLock` (default `false`) joins the `release` section, read as a strict boolean and documented in the lines `rafa init` writes.
- release: with `release.moveLock` on, `rafa release settle` writes `rafa.lock` to the version it settles in the same release commit as the version file and the changelog, refuses a lock it cannot parse or a manifest that is not rafa's before writing anything, and prints a `Lock:` line in the dry run and after a delivery lands.
- docs: `release.moveLock` is documented in `context/release.md` and in the README's release key sentence.
