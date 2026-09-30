---
plan: rafa-340-relationships-epics-blockers-github
title: Epics and blockers as a board mode — `labels` or GitHub's native relationships
level: minor
---

- Config: new `board.relationships` setting (`labels` or `native`, default `labels`) chooses whether a board's epics and blockers live in labels and body lines or in GitHub's sub-issue and blocked-by links; with it unset every command behaves exactly as before.
- Board: in native mode `rafa roadmap` shows each epic's state and done/total from its sub-issues, `rafa roadmap --full` lists members in sub-issue order with their blocked-by links, and `rafa next`, `rafa next --roadmap`, `rafa switch`, `rafa issue list --roadmap` and `rafa plan create --next` read blockers from blocked-by links, including blockers in other repositories and blockers closed as not planned.
- Status: `rafa status` counts blocked issues through the board's mode; in native mode the Board line reads "N issues with an open blocker".
- Issues: in native mode `rafa issue unblock` explains that GitHub clears a blocker when it closes and writes nothing, and `rafa issue ready` checks for two `epic:` labels in labels mode only.
- Epics: `rafa epic move` sets the parent epic in one edit in native mode, loads the config to pick its mode, and says so plainly when GitHub refuses the label swap; `rafa epic new` in native mode names the epic by number and title with no `--slug` or label.
- Pull requests: in native mode `rafa pr merge` prints the issues the merge freed and sends no blocker or checklist writes.
- Init: `rafa init --board` offers to move a board's epics and blockers into the configured mode, printing every write and asking once, then asking separately whether to remove the old marks; `--epic-guard` is refused in native mode.
- Doctor: `rafa doctor` names the other mode's marks left on the board and points at `rafa init --board`, reports blocker and sub-issue lists GitHub cut short in native mode, and runs the label-based blocked and epic checks in labels mode only.
- Documentation: the README, `docs/specs-and-roadmap.md` and the context pages cover the two modes, how to choose, the config, the upgrade path and the edge cases.
