---
name: rafa-stretch-scorecard
description: "Use at the end of every pit stop: score the merged item on five axes, each with evidence, then self-check and verdict."
provenance: first-party
source: rafa
stage: alpha
prevents: "a pit stop that reads all fine because nothing was measured, or a score with no reading behind it"
signal: silent
when_to_use: "You are rafa-stretch-engineer, an item's loop has ended and its pit-stop checks are done, and you are about to write the decision. Prevents: a pit stop that reads all fine because nothing was measured, or a score with no reading behind it"
tags:
  - rafa
  - stretch
  - review
stack:
  - shell
---

Alpha: tested on rafa's own development, may become a feature.

# Scorecard

The scorecard is the last part of every pit-stop entry. It scores the
item just merged, not the effort that went into it. Load
`rafa-stretch-readings` first: every score below reads its numbers.

## The five axes

| Axis | The question | The evidence |
|---|---|---|
| Delivered | Did the pull request merge on the integration branch, with its release fragment? | `rafa pr show <pr>`: its base and merge commit; the fragment on the branch |
| Verified | Do the fixes it claims show in the failure counts? | the run's test steps against the baseline, from `readings` |
| Contained | Did it add red, or run from a stale base? | `base-check` before the loop; failures after the merge that the baseline lacks |
| Cost | How did task work, test steps and planning compare with the estimate? | `readings`, after `data-check` passed |
| Filings | How many bugs did the loop file, and how many repeat a kept one? | `filings --since=<loop start>` |

Score each axis on its own, 1 to 5, before you look at the others:

| Score | Means |
|---|---|
| 5 | nothing to improve, and a reading shows it |
| 4 | a small gap, named |
| 3 | it holds, with one clear weakness |
| 2 | a gap that changes what the next item can rely on |
| 1 | the item did not do what it set out to |

## The evidence rule

Every score cites the reading behind it: the action that produced it
and its number. A score below 5 also names the gap. A 5 with no reading
is not a score; write the reading or lower it. "Could be better" names
nothing; "the pull request opened against `main` and was moved by hand"
names the gap.

## The self-check

Before the verdict, answer one line: would the person agree with these
scores, reading the same numbers? When the answer is no, the score that
fails it is wrong; fix it, not the line.

## The verdict

- **Go on.** No axis is 2 or below. Take the next item.
- **Fix one thing first.** One axis is 2 or below and one small plan
  fixes it: the pit stop's "a blocker a loop can fix" decision.
- **Halt.** An axis is 1, or the same axis scored 2 or below on two
  items in a row. The pit stop's halt rules apply.

## The entry

Add it under the pit-stop entry it closes:

```markdown
**Scorecard, #628 (via #648):**

| Axis | Score | Evidence |
|---|---|---|
| Delivered | 3 | merged into stretch/1 (121f083); opened against main and moved by hand; fragment pushed by hand |
| Verified | 5 | 0 new failures in its 13 test steps (readings) |
| Contained | 2 | the branch was cut before #627 merged; #649 is red on stretch/1 from it |
| Cost | 4 | 7 tasks, 32 min work, 59 min test steps (readings); 12 full suites for 7 tasks |
| Filings | 3 | 6 filed during the loop (filings since 08:50 UTC): 5 repeat kept causes, 1 new (#634) |

Self-check: yes, each score cites a reading.
Verdict: go on; the base rule now covers Contained.
```
