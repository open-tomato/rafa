---
plan: rafa-807-spec-monorepo-bootstrap-turbo
title: Monorepo bootstrap: turbo, shared configs, ownership and CI ring 1
level: minor
---

- Internal: a graph check, `scripts/workspace/graph-check.ts`, refuses a workspace package that turbo, the tsc references or its own manifest leave unseen, and core now declares `@open-tomato/define-config`, which it imports, in its own manifest.
- config: the new `tests.contract` key, a glob list defaulting to `**/*.contract.test.ts`, names a package's contract tests; no step reads it yet.
