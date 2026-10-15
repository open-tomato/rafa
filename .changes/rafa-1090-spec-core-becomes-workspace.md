---
plan: rafa-1090-spec-core-becomes-workspace
title: Core becomes the workspace package `packages/rafa`
level: patch
---

- Packaging: core's source now lives in the private workspace package `packages/rafa`, which the root and both services declare with `workspace:*`; the published package's `files` and `exports` targets are unchanged, and it gains `types`-only `exports` entries for the core subpaths its config declarations import, so a `rafa.config.ts` still type-checks against `@open-tomato/rafa/config` from the tarball
