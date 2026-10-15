---
plan: rafa-1101-spec-plan-validate-names
title: `rafa plan validate` names bundled-item edits and writes the tier pin
level: minor
---

- plan: `rafa plan validate` and `rafa plan create` now notice a plan whose task edits an agent or skill rafa bundles, print one note per item naming the `tiers.agents`/`tiers.skills` pin a clone that merges the plan needs, and write that pin once as a `[human]` item of the plan's `PREREQUISITES-<stub>.md`; validate's json result lists them as `bundledEdits`.
