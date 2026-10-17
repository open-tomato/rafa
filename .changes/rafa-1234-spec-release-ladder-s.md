---
plan: rafa-1234-spec-release-ladder-s
title: The release ladder's workflows write the CI's rafa config
level: patch
---

- release: The four ladder workflows (publish, tag, settle and bot fragment) gain a `Write the CI config` step that writes a minimal `.rafa/config.yaml` with `release.enabled: true` when the checkout holds no rafa config, so their rafa lines no longer refuse with `not inside a rafa project` in CI; a committed config is left as it is, and `context/release.md` documents the step.
