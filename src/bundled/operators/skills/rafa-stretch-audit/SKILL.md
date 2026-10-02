---
name: rafa-stretch-audit
description: "Use after each pit stop: score every decision on evidence, limits, consistency and record; alert on a broken limit."
provenance: first-party
source: rafa
stage: alpha
prevents: "a stretch decision that reverses an earlier rule, or steps outside the person's approvals, with nobody reading it back"
signal: silent
when_to_use: "You are rafa-stretch-watchtower and pit-stops.md has a new entry. Prevents: a stretch decision that reverses an earlier rule, or steps outside the person's approvals, with nobody reading it back"
tags:
  - rafa
  - stretch
  - review
stack:
  - shell
---

Alpha: tested on rafa's own development, may become a feature.

# Audit

The engineer decides; you read each decision back. The audit is
read-only like the rest of the watch: it writes only to `watch.md`, and
it alerts the person, never the engineer. Load `rafa-stretch-readings`
first, because a decision that rests on a number rests on that number's
input.

## What counts as a decision

Each line of a pit-stop entry that starts with "Decision", each change
to `bucket.md` (an item in, out or moved), each rule the engineer adds
to `report.md`, and each step it takes that the person approved in its
session (a self-update, a permission rule, a merge).

## The four axes

| Axis | The question | It fails when |
|---|---|---|
| Backed | Is a measurement cited, and does it hold when you run it again? | the decision cites no reading, or the reading changes when you run the same action |
| Inside the limits | Do the engineer's definition and the person's approvals allow it? | it touches something outside the integration branch, or goes past what the person approved |
| Consistent | Does it agree with the stretch's earlier rules and decisions? | it makes an exception to a rule it set, or reverses an earlier decision without saying so |
| Recorded | Is it in the stretch folder with its reason? | the reason lives only in the engineer's thread, or the record contradicts the data |

Score each axis pass or fail, and cite the line or reading that
decides it. Recheck one number per decision yourself with the action
the decision names; a decision whose number you cannot reproduce fails
Backed.

## When a failure is an alert

| Failed axis | Alert? |
|---|---|
| Inside the limits | at once: `stretch decision outside limits: <decision>` |
| Consistent, on a rule the person gave | at once: `stretch reversed your rule: <rule>` |
| Consistent, on the engineer's own rule | in the next watch line, not an alert |
| Backed or Recorded | in `watch.md` only |

Stretch 1 has an example of the third row. The engineer held one loop
so it would not inherit old red, then let the next one start on a stale
base because it was small. The base rule came afterwards, from the
person.

## The watch line

One line per audited entry in `watch.md`, after the entry's time:

```markdown
- 14:16 audit of "#486 stopped at task 11": 3 decisions; Backed 3/3, Limits 3/3, Consistent 3/3, Recorded 2/3 (report.md line 43 names a base the branch lacks).
```
