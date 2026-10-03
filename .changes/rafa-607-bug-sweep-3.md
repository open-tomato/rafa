---
plan: rafa-607-bug-sweep-3
title: Bug sweep 3 — a clean main passes `bun test` and `bunx eslint .`
level: patch
---

- skills: The bundled dev-planner and git-workflow skills no longer name gitignored `.rafa/` files as project paths, so the project skills check passes on a clean checkout.
- rafa next: Offers a plan whose branch holds only its claim commits, instead of passing it over as already started.
- docs: Removed the "A worktree runs fewer skills-tier tests" known-failure note from `context/verification.md`, now that the cause is fixed.
