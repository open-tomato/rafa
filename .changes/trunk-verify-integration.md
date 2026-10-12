---
plan: trunk-verify-integration
title: The verify check also runs on pull requests into integration
level: none
---

- CI: `.github/workflows/verify.yml` lists `integration` beside `main` under `pull_request`, so a pull request into the trunk reports `verify` and `rafa pr merge` waits on it. Pushes to `stretch/**` are unchanged. `src/tests/verify-workflow.test.ts` and `src/pr/workflow-triggers.test.ts` pin both branches.
