---
plan: rafa-804-spec-monorepo-readiness-spike
title: Measure what breaks when rafa runs in a monorepo
level: none
---

- scripts/survey: Added `monorepo-fixture.ts`, which builds a throwaway `core`/`feature`/`cli` workspace for bun, pnpm, yarn and turbo, with tests that install the bun variant and check sibling resolution; the import-graph resolver now follows symlinked temp paths.
