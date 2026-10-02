---
name: rafa-stretch-readings
description: "Use before any stretch reading: check the baseline fits this machine and period, then take numbers from the stretch script."
provenance: first-party
source: rafa
stage: alpha
prevents: "a threshold or a baseline read from another machine's history, wall time counted as work, or tokens compared across units"
signal: silent
when_to_use: "You are rafa-stretch-engineer or rafa-stretch-watchtower and are about to compare a stretch's time, tokens, cost or filings against a baseline or a threshold. Prevents: a threshold or a baseline read from another machine's history, wall time counted as work, or tokens compared across units"
tags:
  - rafa
  - stretch
  - effort
stack:
  - shell
---

Alpha: tested on rafa's own development, may become a feature.

# Readings

Every number a stretch acts on goes through two steps: check that the
input can carry it, then reduce it the one way that counts each thing
once. The `stretch` script does both, so you never parse a run record, a
log or the store yourself. It ships beside this skill:

```bash
stretch="bun $(dirname "$(readlink -f "$(command -v rafa)")")/bundled/operators/scripts/stretch.ts"
$stretch --version
```

`--version` prints the commit the script came from; after a self-update
to a stretch build it is the stretch's.

## Check the input first

Run this at the start of every pit stop and before you set a threshold:

```bash
rafa effort collect
$stretch data-check --stretch=<n>
```

Read its answer before any other number. It fails in these cases, and
each one changes what you may say:

| The check finds | What it means | What you say |
|---|---|---|
| The newest row for this machine is older than the stretch | the store holds none of the stretch | the baseline is another period; no drift can be read |
| Rows from more than one home root | two machines are mixed | the split is by path, a proxy until rows carry a device |
| Suspends inside the window | wall time holds sleep | read awake minutes, never wall minutes |
| Fewer than 10 tasks in a group | the sample is small | a p90 over this many tasks is one task; say the count |

## Reduce it one way

- **Time is awake time.** `readings` subtracts each suspend from the
  task it falls in. A task's minutes in a `rafa·` line are wall time.
- **Tokens compare only in one unit.** A `rafa·` line counts input,
  cache creation and output. The dashboard's per-task tokens count
  output only. Never put the two side by side.
- **Cost comes from a cost log or not at all.** When the machine has
  ECC's cost log, `readings` takes the newest row per session and its
  `estimated_cost_usd`. Without one it says "cost unknown". Never price
  tokens from a table: prices change, and the log is the source.
- **A cause counts once.** One failure filed as several bugs is one
  cause with several filings. `filings` groups them; count causes and
  filings apart.
- **Test steps are a cost of their own.** A loop's time is task work
  plus test steps plus its fixed start and wrap-up. Report all three.

## Which action answers which question

| Question | Action |
|---|---|
| How long did each task and test step take, awake? | `$stretch readings --stretch=<n> --item=<issue>` |
| Can the store's baseline be read against this stretch? | `$stretch data-check --stretch=<n>` |
| What did this loop file, and how much of it repeats? | `$stretch filings --since=<loop start> --stretch=<n>` |
| Does the claim branch hold the integration branch? | `$stretch base-check <branch>` |
| Is this pull request safe to merge? | `$stretch merge-guard <pr> <head>` |
| What does the watchtower see right now? | `$stretch watch --stretch=<n>` |

Every action takes `--output=json`. Quote its numbers with the action
that produced them, so a reader can run it again.
