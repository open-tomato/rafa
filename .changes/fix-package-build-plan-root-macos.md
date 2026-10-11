---
plan: fix-package-build-plan-root-macos
title: The build test names the root each plan entry runs on, so it passes on macOS
level: none
---

- Tests: `src/tests/package-build.test.ts` built the expected plan prompt from the real path of the scratch repository for every case. That is the root `rafa plan` runs on, and not the root `planCommand` from `dist/index.js` is handed, which the `claude` planner resolves absolute with no symlink followed. On macOS, where the temporary directory is `/var/...` and its real path `/private/var/...`, the library case was red from rafa-824 on. Each case now names the root its entry runs on, and a new case hands `planCommand` the scratch repository through a symlink, so a Linux runner holds the same difference.
