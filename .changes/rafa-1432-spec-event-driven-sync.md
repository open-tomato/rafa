---
plan: rafa-1432-spec-event-driven-sync
title: Event-driven sync — the hub line, `rafa effort sync` and the session-start hook
level: minor
---

- sync: The service sync strategy answers the hub's contract version, project and migrations from its single status read, and can count the rows waiting to push or dry-run a push without sending anything.
- effort sync: A sync refused for a version gap, and a pull the hub cannot project, now name `rafa effort sync` as the step after `rafa self-update` or upgrading the hub.
- status: `rafa status` prints the hub line after its pull (reachable, contract, project, rows pulled and rows held back), or the offline, refusal or token line in its place.
- effort: New `rafa effort sync` command syncs the effort store with its hub, with `--status` to check where it stands and `--dry-run` to see what a sync would push, pull and record as conflicts; it exits 1 on a refusal.
- extras: `rafa-hookify` installs a Claude Code session-start hook that runs `rafa effort sync` and prints the hub's lines when a hub was contacted, with a 120-second `SessionStart` entry in `.claude/settings.json`.
- docs: The extras README and the rafa-hookify skill explain the session hook: what it runs and prints, its empty output without a hub, and how to remove it.
