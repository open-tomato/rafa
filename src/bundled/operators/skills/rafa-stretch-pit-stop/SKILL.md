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

Between two items the closing output of `rafa stretch item` is the whole
pit stop. Its readings are printed there, and the decision is the only
step left for you. Read them there; do not run the checks again.

## The five checks

| Check | Line | What is wrong |
|---|---|---|
| Effort | the `Effort:` line of the item's closing output | cost per task drifting up against the baseline, not explained by the item's size |
| Bugs | the `Bugs:`, `Filed since` and `Recheck` lines of the item's closing output | the open count rising, a bug filed during this loop that repeats an open one (a `Recheck` line that says `reproduces`) |
| Delivery | `rafa loop status`, `rafa pr list` | the run is done with no pull request, or its pull request did not merge |
| Conflicts | `rafa pr show <pr>` | the pull request conflicts with the integration branch |
| CI | the `CI:` line of the item's closing output (`rafa ci status --branch=stretch/<n>` gives the same verdict) | the run failed (use `gh run view <id> --log-failed` to see why), or is still running |

A CI failure already red in the local runs is inherited and noted in the pit-stop entry.
A new failure is filed as one bug after a search for an existing one. A run still in progress
is read at the next pit stop.

The readings in the closing output decide nothing; you do. The shapes:

- `Effort: <stub>: <n> tasks, p50 <m> min against <b> min, max <x> min.`
  is the item's effort against its baseline; with no baseline in the store
  it reads `against no baseline`. `Effort: <stub>: no task sessions stored.`
  is a plan with no task sessions in the store. `Effort: not read (<reason>).`
  is a reading that failed.
- `Bugs: <n> open.`, then `Filed since <time>: <n>.` with one indented line
  per bug filed after the last item, `#<n> <title>: <first line>`. `none` is
  a reading, not a failure. `Filed since the last item: not read: <reason>`
  is one that failed.
- One `Recheck #<n>: <verdict>` line per bug in that list, judged as
  `rafa bug recheck` judges it, with no comment posted. The verdict is
  `reproduces`, `gone`, `flaky` (with its failed runs), `stale` or `skipped`
  (each with its reason), or `manual`. A `manual` line is followed by the
  bug's reproduce text, indented four spaces: copy it as written, do not look
  the issue up. `Recheck: no bug filed since.` is a reading too.
  `Recheck: not read (<reason>).` is the reading that failed.

A line that says `not read` is the only time you type a command by hand:
`rafa effort dashboard` for an `Effort: not read` line, and
`rafa bug recheck <n>` for each bug in the `Filed since` list when the
`Recheck` lines say `not read`. Read the bugs with
`rafa issue list --type=bug --limit=200` when a bug reading is not read
and no recheck can be run.

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

A stale doc line you find is added to the release's stale-docs issue as one
line, and no issue is filed for it. Every other finding is filed, not fixed:
one issue, after a search for an existing one, and the stretch goes on.

## The entry

Append one entry to `.rafa/stretch/<n>/pit-stops.md`, quoting the closing
output's lines for the effort and the bugs:

```markdown
## After #485 (item 2 of 10)

- Effort: `Effort: rafa-485-plan: 14 tasks, p50 14.0 min against 12.0 min, max 22.0 min.`
- Bugs: `Bugs: 61 open.` `Filed since 2026-11-05T09:12:44.000Z: none.`
  `Recheck: no bug filed since.`
- Delivery: pull request #612 merged into stretch/3.
- Conflicts: none.
- CI: verify.yml passed.
- Decision: next item, #486.
```
