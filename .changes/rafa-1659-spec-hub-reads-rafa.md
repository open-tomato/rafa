---
plan: rafa-1659-spec-hub-reads-rafa
title: The hub reads `rafa-hub.config.ts`
level: minor
---

- rafa-hub: The hub now reads its config from `rafa-hub.config.ts` (typed with `HubConfigFile`) as well as from YAML, falls back to a `rafa-hub.yaml` beside a missing `.ts` file, refuses unknown top-level keys, misplaced keys under `dangerous` and function values by key path, warns once on a YAML start that rafa 1.0.0 drops YAML, gains `rafa-hub health`, and its image now defaults to `/data/rafa-hub.config.ts` with a `rafa-hub health` check.
