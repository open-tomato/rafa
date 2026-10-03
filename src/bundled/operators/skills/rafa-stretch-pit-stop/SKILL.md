---
name: rafa-stretch-pit-stop
description: "Use after each stretch item: check effort, bugs, delivery, conflicts and CI, then go on, insert one fix, or halt."
provenance: first-party
source: rafa
stage: alpha
prevents: "a stretch that misses a run with no pull request, piles up refiled bugs, or wanders off after one issue"
signal: silent
when_to_use: "You are rafa-stretch-engineer and one bucket item's loop has just ended, merged or not. Prevents: a stretch that misses a run with no pull request, piles up refiled bugs, or wanders off after one issue"
tags:
  - rafa
  - stretch
  - effort
stack:
  - shell
---

Alpha: tested on rafa's own development, may become a feature.

# Pit stop

A pit stop is the check between two items. It fixes the one thing that
would stop the next item, then rejoins the bucket: it is never a change
of course, and never a reason to chase one issue down a rabbit hole.

## The five checks

| Check | Line | What is wrong |
|---|---|---|
| Effort | `rafa effort dashboard` | cost per task drifting up against the baseline, not explained by the item's size |
| Bugs | `rafa issue list --type=bug --limit=200` | the open count rising, or bugs filed during this loop that repeat an open one |
| Delivery | `rafa loop status`, `rafa pr list` | the run is done with no pull request, or its pull request did not merge |
| Conflicts | `rafa pr show <pr>` | the pull request conflicts with the integration branch |
| CI | `gh run list --branch stretch/<n> --workflow verify.yml --limit 1` | the run failed (use `gh run view <id> --log-failed` to see why), or is still running |

A CI failure already red in the local runs is inherited and noted in the pit-stop entry.
A new failure is filed as one bug after a search for an existing one. A run still in progress
is read at the next pit stop.

A conflict goes to the resolve plans first:

```bash
rafa pr triage <pr> --resolve
```

A run that ended with no pull request is a known defect of the loop: say
so in the pit-stop entry, and open the pull request from the run's branch
only after reading the run's last `rafa·` lines.

## Deciding

1. **All fine.** Write the entry and take the next item.
2. **A blocker a loop can fix.** It stops the next item, and one small
   plan can fix it. It becomes the next item and takes a bucket slot.
   When the bucket is full, the lowest-ranked preparation item leaves it.
   Add a line to `bucket.md` saying so.
3. **A halt.** Stop the stretch and alert the person when one failure
   happens twice, when the hook rule fires, or when the fix would touch
   anything outside the integration branch.

Anything else you find is filed, not fixed: one issue, after a search for
an existing one, and the stretch goes on.

## The entry

Append one entry to `.rafa/stretch/<n>/pit-stops.md`:

```markdown
## After #485 (item 2 of 10)

- Effort: 14 min per task against a 12 min baseline; the plan was large.
- Bugs: 61 open, 64 at the start; none filed during the loop.
- Delivery: pull request #612 merged into stretch/3.
- Conflicts: none.
- CI: verify.yml passed.
- Decision: next item, #486.
```
