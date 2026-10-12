---
plan: rafa-1030-bug-sweep-26
title: Bug sweep 26 — sweeps get one limit, and the item wait reads its own commit's run
level: patch
---

- stretch: `rafa stretch item --wait` now waits on the CI run of the merge commit itself, so a later push to the stretch branch no longer leaves it waiting the full 90 minutes.
