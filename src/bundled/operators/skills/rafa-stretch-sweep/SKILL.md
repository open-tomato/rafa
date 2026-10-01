---
name: rafa-stretch-sweep
description: "Use at a stretch's sweep: group duplicate bugs, rank the board, and fill a bucket of up to 10 issues by tier."
provenance: first-party
source: rafa
stage: alpha
prevents: "a bucket that refiles the same failing test, chases a feature over a blocker, or pulls in a chain of issues"
signal: silent
when_to_use: "You are rafa-stretch-engineer in phase 1 of a stretch, choosing which issues the stretch will run. Prevents: a bucket that refiles the same failing test, chases a feature over a blocker, or pulls in a chain of issues"
tags:
  - rafa
  - stretch
  - triage
stack:
  - shell
---

Alpha: tested on rafa's own development, may become a feature.

# Sweep and bucket

The sweep reads the board, groups what is filed twice, ranks what is
left, and proposes a *bucket*: the issues this stretch will run, at most
10. It ends with the bucket written and the stretch stopped for the
person's approval.

## Read the board

```bash
rafa roadmap --full
rafa issue list --type=bug --limit=200
rafa effort report --trend
```

Read the roadmap's "now" epics first: their members are where the
project already said the work is.

## The five steps

1. **Group the duplicates.** Bugs naming the same failing test, or the
   same symptom in other words, form one group. The oldest issue of a
   group stays open; the others will close as its duplicates. Most
   duplicate bugs are one failing test filed by several loops, so read
   test file names and case names first.
2. **Rank the bugs.** First by how often the group was filed, then by
   impact: what it unblocks, and whether it breaks the loop itself (a run
   with no pull request, a refused pull, a false blocker).
3. **Fill 10 slots by tier.** 6 bugs, 3 fixes, 1 preparation item, by the
   tier rules below.
4. **Apply the chain rule.** An item that would pull in a chain of other
   items is left out for a later stretch. An item whose absence would
   spread an error, or make a new one, is let in past the cap.
5. **Write the bucket report** to `.rafa/stretch/<n>/bucket.md`.

## The tiers

| Tier | What belongs | First |
|---|---|---|
| Bugs | anything filed as a bug that still happens | refiled most, then biggest impact |
| Fixes and stabilisation | work that closes a known defect, labelled as a fix or not | fixes, then stabilisation |
| Preparation | work that readies the next feature, or separates mechanics from interface | only what a target feature needs |

**Rebalancing.** When a tier has fewer items than its slots, its spare
slots split 50-50 between the other two, starting from the highest tier.
A tier that already split passes its half on to the tier below, so no
split repeats. The bug share never drops under 20% while bugs remain;
when every bug left is low impact and touches no workflow, it may drop
to 20%.

## Bugs reach a loop through one sweep spec

`rafa plan create --issue` plans from a `type:spec` issue only. So the
bucket's bugs go into one sweep spec that lists them, as the project's
bug sweeps already do, and six bug slots can run as one or two loops.
Filing that spec is a step with no rafa line yet: log it as a gap.

## The bucket report

```markdown
# Stretch <n>: bucket

| Slot | Issue | Tier | Why it is here |
|---|---|---|---|
| 1 | #485 | fix | every loop inherits its red tests |

## Duplicate groups

| Kept | Closes as duplicates | The shared test or symptom |
|---|---|---|
| #513 | #527, #555, #571, #583 | registry.test.ts HOME case |

## Left out, and why

- #28: pulls in a chain of four specs.

## Cost

<items> items: <loops> loops, <planner sessions> planner sessions.
```

Then stop: the person approves the bucket.

## After the approval

Close each duplicate with a comment naming the issue kept, so reopening
is one command:

```bash
rafa issue comment 527 --body="Duplicate of #513: the same registry.test.ts HOME case."
rafa issue move 527 done
```
