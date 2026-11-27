---
plan: atlas-remaining-cards
title: Atlas — the eight cards still not wired on the live page
level: minor
---

- modules: A module manifest can declare `provides.config`, the one top-level config key the module reads (a blank key or a core section name is refused), and the module's commands receive that key's value as `context.moduleConfig`.
- config: A module can add its own top-level key to `rafa.config.ts` by merging into `ModuleSections` from `@open-tomato/rafa/config`; the config load no longer warns about a key a mounted module declares and answers its value from the highest config file that sets it.
- atlas: The live page now draws every card: the out-of-scope tile, the task pile, work done, the balance radar, the package size rose, the composition sunburst and the import flow by layer read from the replica, and the on-time tile asks for a due date on plans. The replica moves to version 5 (rewritten on the first build), with docs, config and fixture lines per module (snapshots no longer count as tests), each module's layer stamped from the project's `atlas.layers` section, each issue's type from its first `type:` label, and change entries served as `local.changes`; build and serve run in the working directory's project and refuse a layers section that does not parse.
