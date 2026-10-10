## GitHub project per repository

A GitHub project mirrors the state of the repository's issues: their labels,
pull requests, close state, fragments and roadmap checklist. The mirror
serves the team's board view in one column-based kanban per repository.

### The template

The template is at `https://github.com/orgs/open-tomato/projects/6` (the
"rafa board template"), public, with five fields, three saved views, and all
six automations turned off. The template URL is the default of
`board.project.template`, and `board.project.number` is the number of the
project copied to the repository's owner. Both are read from `.rafa/config.yaml`.

Every GitHub project that mirrors rafa's board carries the same five fields
with the same names and options; rafa finds them by exact match and skips any
field it does not find. A project copied from the template starts private;
make it public in the project's settings if wanted. The project is never a
source of truth: the issues stay the source, and the project is the mirror.

### The five fields

**Stage** (single select, required): Backlog, Triage, Needs work, Ready,
Blocked, Claimed, In development, Waiting for approval, In review, Done,
Cancelled. Shown as columns left to right. Only issues get a Stage; epics do
not. The Stage is computed from the issue's close state, labels, linked pull
requests and release fragments.

**Horizon** (single select, optional): Later, Next, Now, Done, Cancelled.
Only epics get a Horizon; issues do not. The Horizon is computed from the
epic's own label (`epic:`) on the open `type:roadmap` board and the board's
horizontal place (`src/board/roadmap-rows.ts` and `src/board/epics.ts` read
the order).

**Rank** (number, optional): A zero-based position on the list where the issue
or epic appears when sorted by the reader's algorithm. Epics and their members
both carry a Rank. The Rank is computed from the order the roadmap and epics
readers return, so every item on a roadmap line or an epic's checklist has a
position relative to every other item on the same row or checklist.

**Blocked by** (text, optional): One or more issue numbers separated by `", "`
(e.g., `#119, #120`). The Blocked by field holds the issue numbers of the
blockers read from the relations port's `blockersOf` function in both
`board.relationships` modes (labels mode reads them from `Blocked by:` lines,
native mode reads them from `blockedBy` nodes). An issue with no blockers
leaves the field empty.

**Progress** (text, optional): A count like `6 / 11` when the item is an epic
(the done and total counts from `src/board/epics.ts`). Only epics carry a
Progress. Issues leave the field empty. An epic with no members shows `0 / 0`.

### The Stage outline

The Stage is assigned by the first matching rule in this order (rightmost
match wins):

| Condition | Stage |
| --- | --- |
| Closed, not planned or duplicate | Cancelled |
| Closed, completed | In review if its PR's shipping fragment is on the base, else Done |
| Open with a merged PR (base branch) | In review if the PR added a shipping fragment, else Done |
| Open with a linked PR (any state) | Waiting for approval |
| Label `rafa:in-development` | In development |
| Label `rafa:claimed` | Claimed |
| Label `spec:blocked` | Blocked |
| Label `spec:ready` | Ready |
| Label `spec:needs-work` | Needs work |
| Label `needs-triage` | Triage |
| No rule matched | Backlog |

A fragment with `level: none` is not a shipping fragment. An issue closed by
hand with no pull request and no fragment is Done. A pull request merged into
an integration branch leaves the issue open (GitHub's `Closes #n` fires only
on the default branch), so the issue stays in one of the open stages and shows
In review if the PR added a fragment. A repository without rafa's release flow
never reaches In review through the fragment path.

### The refresh

`refreshProjectItems(issues)` computes the five values over a list of issues,
compares each with the project's current item values, and writes only those
that differ. It does nothing and sends no call when `board.project.number` is
unset.

The refresh reads the issues' facts through `src/board/project/facts.ts`: each
issue's close state, close reason, labels, and the pull requests that close
or link it (with their base branch and added release fragment, and whether that
fragment is still on the base branch). It runs each value through its rule
function and calls the project port's write functions to set only the values
that are different from what the project holds.

A caller that has just added issues can hand the refresh the item each add
answered, as known items (`knownItem`, the fourth argument of
`refreshProjectItems`). The refresh reads them beside the project's item
listing, so an issue is filled whether or not the listing shows its item
yet. A known item is matched to its issue by number and repository; where
the listing and a known item both name an issue, the listing's item is used,
since it holds the values already written. Each known item the refresh did
not fill is answered in `notFilled` with its reason: its item is of another
repository (never written to), its issue was not among those refreshed, its
facts were refused, or a rate-limit refusal left one of its writes unsent.

### Added, and filled

An issue `rafa board sync` adds is filled in the same run: the sync keeps
the item each add answered and hands those items to its second refresh as
known items. An added issue is filled when that refresh wrote its fields,
and not filled when the refresh answered it in `notFilled`. Two reasons
reach a sync: the issue's facts were refused, or a rate-limit refusal left
one of its writes unsent.

The closing line counts the two apart. Where every issue added was filled
it reads `Synced project #7: 46 changes written, 2 issues added and
filled.`, and a sync that added none reads `0 issues added and filled`.
Where some were not it reads `2 issues added, 1 filled`. A sync the rate
limit stopped counts them when it had added any: `Stopped on project #7:
12 of 14 changes written, 2 issues added, 0 filled; the rate limit refused
the rest.` A dry run adds nothing and counts only the issues to add.

The json result holds both lists, `added` and `filled`, the second always
a part of the first.

Each issue added and not filled gets one warning line after every other,
`#<n> added but not filled: <reason>`, and the exit code stays 0. One whose
facts were refused is named twice with the same reason, by `#<n> not
refreshed: <reason>` and by this line: the first says nothing was written
for it, the second that it sits on the project with no value. The next
sync finds its item on the project and fills it in its first pass.

### Lists read to their end

The facts reader reads an issue's labels, closing references and
cross-references by following each list's `after:` cursor when a list has a
next page, the way it reads a pull request's files. Only issues with a next
page cost extra requests. An issue with many cross-references (like rafa's
issue #485, with 116) is read in full with the cursor. A cursor that
repeats names the issue and the list and refuses that issue alone.

### The callers

Commands that change an issue's labels, linked pull requests, close state,
release fragments or epic membership call the refresh on the affected issues
once their writes land. They pass the issues the refresh needs and print the
refresh's warning lines after their own output.

The `IssueBoard` wrapper at `src/board/project/issue-board-refresh.ts`
wraps the GitHub issue board's label writes (`swapLabels`, `addLabel`,
`removeLabel`), so every label write through the board is followed by a
refresh. This covers the claim stages, the readiness gate, `issue move` and
labels-mode `issue unblock` without editing each caller.

Native-mode blocker writes do not go through `IssueBoard`, so
`src/commands/issue/unblock-native.ts` calls the refresh itself.

### Network errors and retry

The project's `GhRunner` seam retries a call that failed on a network error
before it counts as failed. Retried errors are a timeout (`operation timed
out`, `i/o timeout`, `TLS handshake timeout`), a reset or closed connection
(`connection reset`, `EOF`), and an HTTP 502, 503 or 504 from GitHub.

Never retried are answers GitHub gave on purpose: a GraphQL error (`NOT_FOUND`,
a bad id), a missing scope, or a rate-limit refusal, which keeps its own
warning from the project spec. An unknown error counts as permanent.

The wait before each retry is `board.project.retryWaitSeconds`, then twice
that, and so on; each call stops after `board.project.retries`. With the
defaults one call waits 2 + 4 + 8 = 14 s at most. `retries: false` sends
every call once.

A retried call prints one line in text mode, `retrying #725 (1 of 3):
operation timed out`, and one event in json mode. The line names the issue
when the call carries one, otherwise what the call reads.

The adds, the facts reads, the field writes and `rafa board sync` all go
through the seam, so all of them retry.

### Progress lines and events

Three phases print progress: adding the issues, reading their facts, and
writing their fields. Each prints a start line with its total, `adding
issues: 283`, then a line at most every `board.project.progressSeconds`
with the count and the time so far, `adding issues: 146/283, 6m 40s`, and
an end line with the count, the refused count and the time.

A pause between two write requests (`board.project.writePauseMs`) prints
nothing while it is shorter than `board.project.progressSeconds`, so the
defaults (a 1 s pause, a line every 10 s) print none. A pause at least
that long prints
`pausing <n> s between writes (board.project.writePauseMs)`,
and in json mode a `progress` event whose step is `wait`, with the
milliseconds as `waitMs`.

`progressSeconds: false` drops the lines between, the pause lines
included; the start and end lines stay. In json mode each line is a
`progress` event with the phase, done, total and elapsed milliseconds.
The same lines come from `rafa board sync`.

Commands that call the refresh outside the label wrapper:
- `rafa issue create` — refresh the new issue
- `rafa issue unblock` (native mode) — refresh the unblocked issue
- `rafa pr merge` — refresh the issues the pull request closes and the
  issues they were blocking
- `rafa start` (runner PR step) — refresh the issues the pull request closes
- `rafa release settle` — refresh the issues closed by the pull requests
  whose fragments were folded (a push delivery only; PR delivery sends no
  call since fragments are still on the base)
- `rafa epic new`, `promote`, `defer`, `move`, `cancel`, `close` — refresh
  the epic, its members and every item whose Rank shifted

### Per-issue refusal and its line

When an issue's facts cannot be read (a call that still failed after its
retries, or an answer that is not the recorded shape), `refreshProjectItems`
writes the fields of every issue it has facts for and reports each refused
issue one line each: `#485 not refreshed: operation timed out`. The init part
`project fields` reads `created` when at least one item was filled, with the
refused issues listed under it, and `refused` only when none could be. `rafa
board sync` exits 0 with the same warning lines, so its next run picks the
refused issues up.

### The warnings

Six kinds of failure are turned into warnings, each naming its fix where it
has one:

| Failure | Warning | Fix |
| --- | --- | --- |
| No `project` scope in `gh auth` | the project was not updated | `gh auth refresh -s project` |
| A write refused by the GitHub rate limit | how many issues were not updated | `rafa board sync` |
| `board.project.number` names no project | the number and that it was not found | `rafa init --board` |
| A field or option renamed on the project | which field was skipped | `rafa doctor` |
| An issue whose facts could not be read | `#<n> not refreshed: <reason>` | none: the next refresh or `rafa board sync` reads it again |
| An issue added and not filled | `#<n> added but not filled: <reason>` | none: the next `rafa board sync` fills it |

When a field is renamed, the refresh skips that field and writes the other
four. When one issue's facts cannot be read, that issue alone is left as it
was and the others are written. All six warnings keep the caller's exit code
and are printed after the command's own output.

### Configuration

`board.project.template` is a URL to a GitHub project template, defaulting to
`https://github.com/orgs/open-tomato/projects/6`. A team can set it to their
own copy of the template, keeping the five field names and their options
unchanged. `board.project.number` is unset by default and is set by `rafa init
--board --project` after copying the template to the repository's owner.

The five `board.project.*` keys for retry and progress, all optional, are under
`board.project.`:

| Key | Counts | Default | Schema |
|---|---|---|---|
| `retries` | tries after a failure, per call | 3 | 1 to 10; `false` turns retrying off; 0 and negatives refused |
| `retryWaitSeconds` | the first wait; each later one doubles | 2 | 1 to 60 |
| `progressSeconds` | the most time between two progress lines | 10 | 1 to 300; `false` turns the lines off, the start and end lines stay |
| `writeBatchSize` | field writes per request | 20 | 1 to 100 |
| `writePauseMs` | the pause between two write requests | 1000 | 0 to 60000 |

`writeBatchSize` and `writePauseMs` replace the two constants in
`src/board/project/port.ts`, with the same defaults.

Config examples, from empty up:

```yaml
# nothing set: 3 retries from a 2 s wait, a progress line at most every
# 10 s, 20 writes a request, 1 s between requests
```

```yaml
board:
  project:
    number: 6        # written by rafa init --board --project
```

```yaml
board:
  project:
    template: https://github.com/orgs/acme/projects/2   # the team's copy
    number: 6
    progressSeconds: 30     # a quieter log for a loop host
```

```yaml
board:
  project:
    retries: 5
    retryWaitSeconds: 5     # a slow or flaky network
    writePauseMs: 2000      # a longer pause between write requests
```
