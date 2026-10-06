---
plan: update-current-0x-minors
title: rafa update current crosses minors below 1.0.0
level: patch
---

- CLI: `rafa update current` now moves a project's `rafa.lock` across newer minor versions while both versions are below 1.0.0, so a lock at 0.34.1 moves to 0.36.0. From 1.0.0 on, a newer minor is still refused and left to `rafa update next`.
