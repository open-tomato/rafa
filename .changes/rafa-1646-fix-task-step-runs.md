---
plan: rafa-1646-fix-task-step-runs
title: The task step runs the facade test of each package a new deep import reaches
level: patch
---

- rafa-run: A task that adds a deep import of another package (`@open-tomato/<pkg>/<path>`) now runs that package's facade test, `packages/<pkg>/index.test.ts`, in its task step, with a 🧩 line naming each facade test added, so a facade gap fails in the loop rather than in CI after the merge.
