# Learning

The learning library settles lessons task reports generate, applies written
rules when lessons conflict, and names the ones ready to promote to prose.
The local adapter holds lessons in `.rafa/instincts/`, logs every merge
decision, and the wrap-up writes those lessons into the pages that own their
subjects.

## The library: `src/learning/`

Pure, self-contained, and published as `@open-tomato/rafa/learning`. No
filesystem, no clock, no randomness. Imported by the port and by the
adapter, so types are declared once.

### Core functions

- `merge(held, payload, now) → MergeResult` — Settles what one source
  pushes against the instincts already held, trigger by trigger.
- `bless(held, { minConfidence }) → BlessedBundle` — The active records
  not flagged and above the confidence floor, ordered by trust.
- `promotable(held, { after, minConfidence }) → InstinctRecord[]` — The
  blessed records recurred enough to promote, by trust order.
- `actionHash(action)` — `sha256(trim(lower(action)))`, the key two
  records are merged by.
- `triggerKey(trigger)` — Text trimmed, lower-cased, and each whitespace
  run collapsed to one space.

### Fixed constants, never settings

| Constant | Value | Meaning |
|----------|-------|---------|
| `GAP` | 0.10 | How far below the leader another action may sit before it is discarded rather than flagged. |
| `SOURCE_STEP` | 0.05 | Confidence gained per distinct source beyond the first in a same-action merge. |
| `CONFIDENCE_MIN` | 0.3 | The lowest confidence a lesson may carry. |
| `CONFIDENCE_MAX` | 0.9 | The highest confidence; merge caps at it. |

All comparisons work in whole hundredths (0.55 − 0.45 = 0.10, not 0.10000000000000003).

### The merge rules: four cases for one trigger

1. **`same-action`** — Records sharing one `action_hash`:
   - Collapse to one record.
   - `sources` is the union, `usage_count` its length.
   - Confidence is the usage-weighted mean of the member confidences
     plus `SOURCE_STEP` per new source, capped at `CONFIDENCE_MAX`.
   - All sources, all `confidence` computation at two decimals.

2. **`higher-confidence`** — Among a trigger's distinct actions:
   - The highest confidence leads.
   - Every action more than `GAP` below the leader is discarded: reported
     in the merge result and left out of what the trigger is held as.
   - A discarded action stays in the push log, never deleted from it.

3. **`flagged`** — Actions within `GAP` of the leader, an exact tie
   included:
   - Both are kept and flagged.
   - A flagged record is excluded from every blessed bundle.
   - `rafa instinct flag <id> <reason>` removes a record from blessing;
     the flag survives every later merge.

4. **`new-trigger`** — A trigger nothing held before:
   - Kept as it is.
   - The payload's `source_id` is joined to its `sources`.

The merge never depends on push order: all triggers are settled over
their whole set of actions at once, not pair by pair.

## Findings become lessons

A task report finding carrying a `resolution` converts to an instinct with
these mappings:

| Finding field | Instinct field | Note |
|---------------|----------------|------|
| `trigger` | `trigger` | Copied as is |
| `cause` | `cause` | Copied as is |
| `kind` | `kind` | Copied as is |
| `signal` | `signal` | Copied as is |
| `artifact` | `artifact` | Copied as is |
| `resolution` | `action` | The lesson to apply to this trigger |
| `domain` | `domain` | Optional finding field, defaults to `workflow` |
| — | `confidence` | 0.5, or 0.4 when the task ended blocked |
| — | `evidence` | `{ plan, task, session, outcome }` |
| — | `scope` | `project` |
| — | `source` | `task-report` |

A finding with no `resolution` remains a finding only. Once a task's
report is recorded, the loop pushes that session's lessons to the adapter
with `source_id` set to the session id.

## The local adapter

Located at `src/adapters/learning/local.ts`. Runs the library on every push and pull.

### Held set and logs

Three files under `.rafa/instincts/`:

1. **`<id>.md` files** — One per held instinct, the held set. The
   reviewable form. Carries YAML frontmatter plus `## Action` and
   `## Cause` sections. Read by `rafa instinct check|list|show`.

2. **`instincts.ndjson`** — The push log. One `PushLogLine` per merge
   decision, in the payload's order, holding:
   - `source_id` — The pushing session.
   - `rule` — Which merge rule applied.
   - `incoming` — The record as it was pushed, with its `description` if
     any.
   - `produced` — The ids the trigger is now held as after this decision.
   - `discarded` — The ids a higher-confidence action displaced.
   - Nothing reads it back; it is the record of what each push did.

3. **`flags.ndjson`** — One line per `flag`, holding `id`, `reason`, and
   `flagged_at` (read off `now`).

### User scope is read-only

`~/.rafa/instincts/` is read by a pull and never written. A pull gives
the project's blessed records, then the user scope's for triggers the
project does not hold.

### How a push works

1. Payload is checked, held set read.
2. `merge` runs, settling each trigger the payload touches.
3. Every trigger's records are written as `<id>.md` files, old ones on that trigger removed.
4. Push log is appended.
5. Flags are read to exclude flagged records from every later pull.

A push is refused, with nothing written, when:
- Payload or any record fails checks.
- A record's `action_hash` is not `actionHash(action)` of its action.
- A produced record has neither a held member nor a description.
- Two produced records would write to one `<id>.md`.
- A file would overwrite an unreadable one or one holding another
  trigger.

## The wrap-up's promotion check

The wrap-up is handed the list of promotable lessons by code instead of
being asked to read `progress.txt` and decide.

### How it works

1. Code computes `promotable(held, { after, minConfidence })` — lessons
   that recurred `learning.promote.after` distinct times and meet
   `learning.promote.minConfidence`.

2. The prompt gets a `## Lessons to promote` list: id, trigger, action,
   artifact.

3. For each lesson, the session writes it into the page that owns its
   subject, or says why not, in a `rafa:promoted` block:
   - `id → path/to/context/page.md` — lesson promoted.
   - `id → skipped: <reason>` — lesson not promoted.

4. Code checks the answer:
   - Every listed id must be answered.
   - Every named path must have changed in the working tree.
   - A promoted lesson gets `promoted_to: <path>`, a new optional field.
   - A promoted lesson leaves every blessed bundle, because the page now
     carries it.

5. A missing answer is reported in the PR body, but does not block the PR.

6. With nothing promotable, the `## Lessons to promote` section is
   absent, and neither is `rafa:promoted`.

## Config keys

All four are local policy, allowed at every layer, merged by key in a
`learning` map.

| Key | Default | Meaning |
|-----|---------|---------|
| `learning.adapter` | `local` | The adapter type (`local` is the only one today). |
| `learning.bless.minConfidence` | `0.5` | The lowest confidence a lesson can have and still be blessed for injection. |
| `learning.promote.after` | `3` | How many distinct sources must confirm a lesson before it can be promoted. |
| `learning.promote.minConfidence` | `0.7` | The lowest confidence a lesson can have and still be promoted; meant to sit above the blessing floor. |

## Trigger identity: two wordings never meet

A trigger's identity is its text: trimmed, lower-cased, and whitespace
runs collapsed to one space.

- `if the test fails` and `if the test fails` are the same trigger.
- `if the test fails` and `If The Test Fails` are the same trigger.
- `if  the  test  fails` (two spaces) and `if the test fails` (one
  space) are the same trigger.
- `if the test fails` and `if the test fails ` (trailing space) are the
  same trigger.
- `if the test fails` and `when the test fails` are **different
  triggers**.

Fuzzy matching is rejected because its answer is not stable: two machines
might disagree.

## What can go wrong

| Problem | Prevention | Fix |
|---------|-----------|-----|
| A wrong lesson gets blessed. | `rafa instinct flag` removes it. | `rafa instinct flag <id>` |
| Two wordings never meet. | Accepted; #57's assess can pair them. | Pair them in assess. |
| One task inflates its lesson. | `usage_count` counts distinct sources. | No action needed. |
| Wrap-up ignores the list. | `rafa:promoted` check reports in PR body. | Sessions must answer every id. |
| Invalid lesson file. | `rafa instinct check` names it; warning. | Fix the file or remove it. |
| Library and port drift. | Library owns types; port re-exports them. | Never re-declare them. |
| Merge depends on order. | Property test runs in every order. | Any failure is a library bug. |

## Ordered by confidence, then usage, then id

Every list the library answers — blessed records, promotable lessons,
discarded actions — is ordered by these three fields in this priority:

1. Highest confidence first.
2. When confidence is tied (at two decimals), highest `usage_count` first.
3. When both are tied, `id` in code-unit order (the order every machine
   agrees on).
