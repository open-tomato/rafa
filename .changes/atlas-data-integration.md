---
plan: atlas-data-integration
title: Atlas on real effort data — the data integration layer
level: minor
---

- atlas: Atlas now runs on real effort data. `atlas-data` gains the full query contract (zod schemas, `validateStandard`, `applyFormula`, `InvalidParams`), a replica that builds beside the live file and renames it in (now at version 3; rebuild any earlier replica), and a tabular query engine with windows, filters, grouping, quantiles and a previous-window comparison. `rafa-atlas` copies the effort store to a snapshot, fills the task, finding, bug, change and CI fact buckets and the plan and daily rollups, derives a work type from each session's change level, and serves the 16 PoC metrics with all 35 catalogue entries listed by feasibility. It is a rafa module with `build`, `serve` and `describe`, and reads `budget.tokensPerWeek` and `wipLimit` from `.rafa/atlas/config.json`. `atlas-transport` gains `createAtlasHandler` with `toFetchHandler`, and a typed client with `fetchTransport`, `localTransport` and four client errors.
- atlas demo: The demo's `?source=live` page draws every PoC card and tile from the replica, each card's Info view giving the row count behind it and each proxy its note; mock stays the default, and the server no longer builds the replica on start but names the `rafa-atlas` build line when none exists.
- docs: The Atlas docs describe layers 2 to 4 as built: the replica path, the run line, the serve port and API base, the config file, the live switch, and the dedupe, work-type and range-window rules.
