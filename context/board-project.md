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

Every failure in the refresh becomes a warning line, never an exception. The
caller keeps its own exit code whatever the warnings say.

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

### The warnings

Four kinds of failure are turned into warnings that name their fix:

| Failure | Warning | Fix |
| --- | --- | --- |
| No `project` scope in `gh auth` | the project was not updated | `gh auth refresh -s project` |
| A write refused by the GitHub rate limit | how many issues were not updated | `rafa board sync` |
| `board.project.number` names no project | the number and that it was not found | `rafa init --board` |
| A field or option renamed on the project | which field was skipped | `rafa doctor` |

When a field is renamed, the refresh skips that field and writes the other
four. All four warnings keep the caller's exit code and are printed after the
command's own output.

### Configuration

`board.project.template` is a URL to a GitHub project template, defaulting to
`https://github.com/orgs/open-tomato/projects/6`. A team can set it to their
own copy of the template, keeping the five field names and their options
unchanged. `board.project.number` is unset by default and is set by `rafa init
--board --project` after copying the template to the repository's owner.

Config examples, from empty up:

```yaml
# nothing set: init asks once; no project

board:
  project:
    number: 6        # written by rafa init --board --project

board:
  project:
    template: https://github.com/orgs/acme/projects/2   # the team's copy
    number: 6
```
