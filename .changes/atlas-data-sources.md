---
plan: atlas-data-sources
title: Atlas phase 4 — the sources past the PoC
level: minor
---

- atlas: Atlas builds now read the project's git history, the board cache and the module tree offline: the replica gains commit, pull request, issue, board snapshot, module and stretch mark tables (each day's board snapshot is kept from one build to the next), served as `local.commits`, `local.marks`, `local.issues`, `local.board` and `local.modules`, with commits per day in `local.daily` and each plan's epic in `local.plans`. `rafa module exec @open-tomato/rafa-atlas build --github` (and `serve --github`) also reads pull requests and issue times from GitHub into `local.prs`; without the flag no build calls `gh`, and a failed `gh` read warns once and builds the rest. 14 new metrics cover deploys, milestones, WIP by board stage against `wipLimit`, module size and coupling, and the bug backlog, with `cli-gap` bugs left out. The demo's live page now draws deploys per week, the module treemap and import graph, WIP, resolution time by priority and two new QA cards (bug outcome by loop start, open bugs per day); a GitHub-only card with no GitHub data says "Not wired yet" and names the `build --github` line. `atlas-transport` gains `toExpressHandler`, an Express middleware over structural types with no `express` dependency, answering a throwing handler 500 without its message.
