# Specs, issues and the roadmap

How rafa uses a GitHub issue board: what a spec is, how to write one, how
the roadmap picks the next one, which labels mean what, and what stands
between a stranger's text and an agent's prompt.

None of this is required. `rafa plan create --spec=<file>` plans from a
local file and never touches a board. The board is for when you want the
work queue, the specs and their history in one shared place.

## Set the board up

```bash
rafa init --board
```

On a repository whose remote is GitHub, this creates what is missing and
leaves the rest alone: the labels below, the issue template
`.github/ISSUE_TEMPLATE/spec.md`, and a pinned issue titled "Roadmap",
whose number is written to `.rafa/config.yaml` as `roadmap.issue`.
`rafa doctor` reports any of them that is missing. It needs the GitHub
CLI, `gh`, installed and logged in.

## What a spec is

One issue, one plan, one pull request. A spec is an issue opened from the
"Spec" template, with six headings the planner reads and one optional
heading after them:

| Heading | What goes there |
| --- | --- |
| What you get | The change from the outside, in one paragraph. |
| Starting position | What exists today that this builds on. Name the files and commands. |
| Design | The pieces, where each lives, and the alternative you rejected. |
| What can go wrong | The failure modes, and the check that would catch each. |
| Tasks the plan must carry | One list item per piece of work, each naming what it changes. |
| Definition of done | One list item per thing a command can show. "Works well" is not one. |
| For the documentation writer | Optional. The examples from the design session, grouped by situation. |

The optional section keeps what a design session produces and a later
writer would otherwise have to dig out of old sessions: the use cases,
grouped by situation from a solo project up to many teams, lightest
first; the edge cases worth an example; config examples in the same
order, from the empty config up; the analogies used; and the
alternatives rejected, each with its reason. A spec without it is still
complete, so delete the heading when you skip it. The planner hands it
to the plan's documentation tasks only, to shape their examples, and
never turns it into tasks. When a spec adds a command or a config key
and has no such section, the planner's review names that as a gap which
does not block the plan.

The template's first line reminds you that an issue on a public
repository is public: no local paths, no internal host names, no
credentials. Machine-specific notes go in a local file,
`.rafa/specs/rafa-<n>-notes.md`, which rafa appends to its own copy of
the spec and never sends anywhere.

### Blocking other specs

A spec may depend on work in another spec. Add a line to the issue body:

```text
Blocked by: #42, #57
```

The `rafa plan create --next` command reads this line and skips the spec,
offering instead the first unblocked spec under it. Once the blockers
close, `rafa issue unblock #<n>` removes the `spec:blocked` label and the
spec is ready for planning. `rafa pr merge` runs that same unblock logic
when a merged PR closes one or more blockers. The line names one or more
issue numbers separated by commas or spaces; missing, malformed or invalid
lines are reported by `rafa doctor`.

### A prompt for drafting one

Paste this into a Claude Code session opened in your repository, with
your idea in place of the last line. It produces a draft in the
template's shape; you still read it, correct it and open the issue
yourself.

```text
Draft a spec for this repository in the shape of
.github/ISSUE_TEMPLATE/spec.md, as markdown I can paste into a new issue.

Before writing, read the code the change touches and name real files,
commands and tests under "Starting position". Do not invent any.

Rules:
- "What you get" is one paragraph about what somebody can do afterwards
  that they cannot do now. No implementation words.
- "Design" names each piece, where it lives, and one alternative you
  rejected with the reason.
- "What can go wrong" lists failure modes, each with the check that
  would catch it.
- "Tasks the plan must carry" is a list. Each item names what it
  changes and how it is tested. No item is a paragraph.
- "Definition of done" is a list of things a command can show, each
  with the command or the observable result.
- End with "For the documentation writer", taken from our conversation:
  the use cases grouped by situation, lightest first (a solo project,
  then a team, then many teams); the edge cases worth an example; config
  examples in the same order, starting from the empty config; the
  analogies we used; and the alternatives we rejected, each with its
  reason. Keep my wording for the analogies. Leave it out only when the
  change adds no command, config key or behaviour a user would read
  about.
- Nothing may be left as TBD or TODO. If you cannot decide something
  from the code, stop and ask me instead of guessing.
- This will be public: no absolute paths from this machine, no internal
  host names, no tokens.

The change I want: <describe it in a few sentences>
```

## From an issue to a plan

```bash
rafa plan create --issue=42     # plan from issue #42
rafa plan create --next         # plan from the first undone line of the Roadmap issue
rafa plan create --next --dry-run
rafa plan create --issue=42 --accept-refs   # plan even though a reference changed
```

`--issue` copies the issue's body to `.rafa/specs/rafa-42-<slug>.md` and
plans from that copy, so the plan keeps the text it was made from even
if the issue is edited later. If the issue body has changed since the copy
was saved, `rafa` prints the difference lines and refuses to plan, naming
the reason and the `--refresh` flag that would overwrite the saved copy
without asking. If only the local notes file `rafa-42-notes.md` changed,
the copy is rebuilt and the old one moved to `.rafa/specs/previous/` first.
With a terminal, a changed body offers a question: update the saved copy
and plan from the new version? No terminal, no offer — the refusal stands.
The `--refresh` flag rebuilds the copy and plans without asking. When more
than fifty previous copies accumulate under `previous/`, `rafa doctor`
warns that they are safe to delete. The plan, its branch and its pull
request carry the same name: `rafa-42-<slug>`, `feat/rafa-42-<slug>`,
`rafa-42: <title>`, with `Closes #42` in the pull request.

Before any planning session starts, rafa also checks the references the
spec makes: the other issues it names, and the files, exported symbols,
`rafa` commands, flags and config keys it writes in backticks. The first
time it reads one it records what the target held then, in a comment at
the top of the saved copy. On every later run it compares again, and it
refuses to plan (exit code 2) when a reference is **dangling** — the
file, symbol or issue does not exist — or **suspect** — it changed
since the spec was read. Each one is listed with where it sits in the
issue:

```text
❌ issue #42 names references that are missing or changed since the spec was read:
   • dangling src/a.ts (line 12)
   • suspect #7: heading "Design" changed (line 3)
   Pass --accept-refs to re-stamp them as reviewed and plan on this run, or edit the issue so the spec names what is there now.
```

For an issue it names which `##` sections changed, so you know what to
reread. A reference to a file that does not exist yet is dangling too,
even the first time: a spec that plans to create `src/a.ts` says so, and
you accept it once.

There are two ways past the refusal. Edit the issue so the spec names
what is there now, or, once you have looked and the spec still holds,
run again with `--accept-refs`: rafa records every reference as reviewed
and plans. A file you accepted as missing then reads as fine until it
appears, and reads as changed from then on. A blocker named under
`Blocked by:` that has closed does not refuse; rafa prints
`resolved #7 — rafa issue unblock 42` so you can take the spec off its
blocked line. An issue in another repository that rafa cannot read is
listed and never refuses. `--dry-run` writes no saved copy, so it skips
this check.

To skip the refusal on every run, set this in `.rafa/config.yaml`:

```yaml
dangerous:
  acceptStaleRefs: true
```

It does what `--accept-refs` does, on every run from the board, and a
run with it on starts with a warning saying so. It is meant for a
project whose specs are too out of date to be blocked on, and it sits
under `dangerous` because with it on, no spec is ever refused for
naming something that has gone or changed.

`rafa issue check 42` prints every reference of the saved copy of #42
with its state, and plans nothing. `rafa doctor` counts the suspect and
dangling references across every saved copy under `.rafa/specs/` and
names `rafa issue check <n>` for each copy that holds one. It changes
no file, and when the board cannot be read it counts those issues as
unknown rather than failing:

```text
References: 1 suspect, 1 dangling across 3 saved copies; run rafa issue check <n> to see each:
  #42 .rafa/specs/rafa-42-export-reports-csv.md: 1 suspect, 1 dangling — rafa issue check 42
```

## The roadmap

The pinned "Roadmap" issue is an ordered task list, one spec per line:

```markdown
- [ ] #42 Export reports as CSV — finance asked first
- [ ] #57 Bulk import — needs #42's column mapping
```

`rafa plan create --next` reads it in order and takes the first line
that is neither done nor taken. A line is **done** when it is ticked or
its issue is closed. A line is **taken** when a branch `feat/rafa-<n>-…`
exists or an open pull request closes that issue. It prints what it
skipped and why, and it **stops** at a next line that is not marked
ready rather than skipping ahead, because skipping would reorder your
roadmap without telling you. `rafa pr merge` ticks the line of the issue
its pull request closes.

To change the order, edit the issue. There is nothing else to keep in
sync.

### See the roadmap as a table

```bash
rafa roadmap      # all undone items
rafa issue list --roadmap --all    # including done items
```

`rafa roadmap` reads the roadmap issue once and prints each line as a table
row. After `rafa switch`, the roadmap it reads is the board you switched to. The table has four columns beyond the item itself: **spec** (readiness,
whether the issue carries `spec:ready`), **blocked by** (each blocker and
whether it is open, `-` when there is none), **has** (what already exists: a plan, a branch, or an
open pull request), and **refs** (how many references in the issue's saved
copy under `specs.dir` read suspect or dangling: `0` for a clean copy, `-`
when the issue has no saved copy, `?` when the copy could not be read). A
non-zero `refs` is the same count `rafa doctor` reports; run
`rafa issue check <n>` to see which references they are. Reading the column
writes nothing to the copy. With `--output=json`, each row's `refs` holds the
counts behind the cell (`copies`, `suspect`, `dangling`, `unknown` and the
`errors` of copies that could not be read), or `null` with no saved copy. This view helps you see at a glance what is
ready for planning, what is waiting, and what is already in motion. `--all` includes
done items, and `rafa issue list --roadmap` offers more output formats and
filters than `rafa roadmap` does.

## Labels

| Label | Meaning | Who sets it |
| --- | --- | --- |
| `type:spec` | This issue is a spec. | The template. |
| `spec:ready` | A person has read it and says a plan may be made from it. | A maintainer. |
| `spec:needs-work` | Agreed in outline, details pending; or the planner's review found gaps and listed them in a comment. | A maintainer, or rafa after a review. |
| `spec:blocked` | One or more issues named in the `Blocked by:` line must be closed first. Removed when all blockers close. | rafa or a person. |
| `type:bug` | A defect. rafa files these itself for out-of-scope bugs a run meets. | rafa or a person. |
| `needs-triage` | Filed by a run and not looked at yet. | rafa. |
| `module:unassigned` | No part of the project owns this yet. | rafa. |

## Safety: what stands between an issue and an agent

Text from an issue ends up in an agent's prompt, and that agent can
change your repository. So planning from the board is gated, cheapest
check first, and any failure writes no plan:

1. **Who wrote it.** The issue's author must have write access to the
   repository (`admin`, `maintain` or `write`), or be listed under
   `board.trustedAuthors` in your config. GitHub lets only the author and
   write-holders edit an issue body, so a trusted author means a trusted
   body. Comments are never read into a plan. A permission lookup that
   fails is a refusal, not a pass. This applies to public and private
   repositories alike, and to the Roadmap issue and to rafa's own marker
   comments too, so nobody can plant a "triage result" for an agent to
   follow.
2. **A person said so.** The issue carries `spec:ready`. Only people with
   triage rights can label, and rafa never adds this label by itself.
3. **It is complete.** Every heading is present and filled, the task list
   and the definition of done hold at least one item each, and no `TBD`
   or `TODO` survives.
4. **It does not leak.** A body holding a home-directory path or a
   token-shaped string is refused, naming the line.
5. **The planner's own review.** The planning session judges whether each
   definition-of-done item can be shown by a command and whether anything
   would have to be guessed, and says of each gap whether it blocks
   planning. "Not ready" over a blocking gap removes the plan, lists the
   gaps in one comment on the issue and swaps the label to
   `spec:needs-work`. "Not ready" over gaps it can all plan under keeps
   the plan, opens it with the assumptions it planned under, lists the
   same gaps in the comment and leaves the label alone.

Related, and worth knowing: bugs a run meets that are about one machine
(a broken toolchain, a failed package build) are kept local and not
filed on your public tracker. And the run itself is unsandboxed; see
"Before you run it" in the [README](../README.md).

## Boards: multiple roadmaps per project

A **board** is a GitHub issue labelled `type:roadmap`, holding an ordered
checklist of epics. The `.rafa/config.yaml` setting `roadmap.issue` names
the DEFAULT board (for example, `roadmap.issue: 31`). Most projects need
only one; for the rest, this section shows how boards work.

### Solo or one team: you stay on one board

If your project has no `type:roadmap` label and no `.rafa/position.json`
file, rafa behaves exactly as before. The pinned "Roadmap" issue is your
board. `rafa roadmap`, `rafa next`, `rafa epics`, `plan create --next`
and `rafa status` print and read it without change. You never see boards
or switching: they are optional and invisible when you have one.

### Later work is not a second board

Current versus later work is **not** a second board. Instead, every epic
carries a `horizon` label — `horizon:now`, `horizon:next` or
`horizon:later` — to control when it is walked. `rafa roadmap` shows the
`now` epics by default, and `--all` shows all three horizons. A switch does
not change which horizon you see; `--all` is a flag, not a board choice.

### Several teams, one repository: one board per team

When several teams work in the same repository, each gets its own board:

```bash
rafa board list          # all boards with their owners and folders
```

Each board is an open `type:roadmap` issue. Beyond the checklist it holds
the same as the default board, it may have two optional lines:

```text
Owner: @org/backend-team
Owns: src/api/, src/database/
```

The **`Owner:` line** names the team or person responsible. It appears in
`rafa board list` and `rafa status` to tell you who the board belongs to.
It is free text: `@org/team`, `@person`, or any other label is fine.

The **`Owns:` line** names the folders that team owns, and links to the
repository's `CODEOWNERS` file. When a run finds a bug in one of those
folders, rafa files it under the owning epic, keeping bugs with the code
that owns them. The line is a comma- or space-separated list of paths, with
backticks stripped: `src/api/, src/database/` or `src/api/ src/database/`
both work.

#### Switching between boards

```bash
rafa switch 254          # move to board #254
rafa switch 252          # move to board #252
rafa switch -            # go back to the previous board
```

A switch moves you to that board's **current place**: the first open epic
in its `horizon:now` checklist that is not done, or the default board's
first such epic if the board has no epics. After you switch, `rafa next`,
`rafa epics`, `rafa roadmap` and `plan create --next` all work inside that
board.

By default, a switch **re-homes** your position. Your home (the board you
came from) becomes your anchor, so `rafa switch -` takes you back. Pass
`--no-rehome` to keep your home and just move:

```bash
rafa switch 254 --no-rehome   # move to #254, home stays where it is
```

#### Where rafa keeps your position

The file `.rafa/position.json` holds three places:

```json
{
  "current": { "board": 254, "epic": 246 },
  "previous": { "board": 31, "epic": 245 },
  "home": { "board": 31, "epic": 245 }
}
```

**`current`** is where you are now. **`previous`** is where you were before
the last switch (so `rafa switch -` goes back to it). **`home`** is where
you came from, an anchor you can return to at any time. It moves when you
switch by hand; `--no-rehome` keeps it still.

If the file is missing or unreadable, rafa reads your place as the default
board's first open `now` epic that is not done, and prints:

```text
position file missing: starting at board #31, epic #245
```

This is not an error; it just tells you where rafa put you.

### A monorepo package with its own rafa

A monorepo with nested packages can have its own `.rafa/config.yaml` and
its own rafa setup. A nested rafa project is independent: it keeps its own
`.rafa/position.json`, its own default board, and its own boards and
switches. Boards are per-repository, not global.

### Seeing where you stand

```bash
rafa status              # everything in one snapshot
```

With boards, `rafa status` adds lines for the current place:

```text
Current: board #254 Infrastructure (owner: @org/backend-team)
Epic: #246 the epic model
Position file: .rafa/position.json ✓
```

If you have switched around, you also see:

```text
Home: board #31 Roadmap, epic #245 (can return with rafa switch -)
```

### The board listing

`rafa board list` shows all open `type:roadmap` issues once per command:

```text
#31   Roadmap
#254  Infrastructure (owner: @org/backend-team)
#257  Frontend (owner: @org/frontend-team)
```

Each board shows its number, title, owner if present, and owned folders if
present. The list is used to read the board field of a position when
switching or reporting; narrower queries are refused so rafa always reads
the same answer from the same board state.

### The analogy: position like `cd` and `git checkout`

rafa's position pattern mirrors what Unix shells do with `cd` and git does
with `git checkout`. In a shell:

- `pwd` shows where you are
- `cd <dir>` moves you, and saves where you were in `OLDPWD`
- `cd -` goes back to where you were

With `git checkout`:

- `git status` shows your branch
- `git checkout <branch>` moves you, and saves the previous branch internally
- `git checkout -` goes back

rafa adds a home slot, turning two slots into three:

- `rafa status` shows where you are (current) and where you came from (home)
- `rafa switch <n>` moves to a board, saves your old place in previous, and marks
  the new place as home (so you can come back)
- `rafa switch -` goes back to where you were
- `rafa switch <n> --no-rehome` moves without changing home (you hold your anchor)

A longer trail you want to walk back, like a stack with `pushd`/`popd`, is
not part of this. That belongs to the hyperloop (#28), planned for a future
version.

### Example: a workflow with boards

You are on board #31 (Roadmap). A bug comes in for the backend team:

```bash
rafa switch 254          # move to board #254 Infrastructure
# ... work on the bug under the backend team's epic and board ...
rafa switch -            # back to board #31 Roadmap when done
```

Or you are working across both:

```bash
rafa switch 254 --no-rehome   # move to #254, home stays #31
# ... work on something under #254 ...
rafa switch -                 # back to #254's previous place
# ... keep working under #254 ...
rafa switch 31                # move to home (#31)
```

## Other trackers

GitHub Issues is what works today, through `gh`. The tracker sits behind
a port with a `local` fallback (issues as files under `.rafa/`), so
other boards are adapters, not rewrites.

**Linear is coming.** The project rafa grew out of ran on Linear, and
that adapter is being ported as an optional add-on for a later version.

Want Jira, GitLab, Notion, Obsidian or something else? Look for an
existing request and add a 👍 to it, or open a new one, at
[github.com/open-tomato/rafa/issues](https://github.com/open-tomato/rafa/issues?q=is%3Aissue+tracker+support).
Votes decide the order. As requests appear, this page will link each
one directly.

## Epics: grouping specs into features

An **epic** is a GitHub issue that groups related specs into a feature,
with an ordered checklist, a date and an estimate. It is what you plan
when a spec is too big to finish in one run, or when several specs
belong together.

### For projects with no epics yet

If your roadmap has no epics, everything works as before. `rafa next`,
`plan create --next` and `rafa roadmap` print and read the roadmap
lines exactly as they did before, and every command stays on one issue.
No label or line changes are needed. An epic is purely optional.

### What an epic looks like

An epic is an issue opened from the board using the same template as a
spec (if you want to use `rafa init --board` to generate one, open an
issue manually and apply the three labels yourself). It carries three
labels:

- `type:epic` — marks it as an epic
- `epic:<slug>` — groups its members and defines its first `epic:` label
- `horizon:now` or `horizon:next` or `horizon:later` — its time horizon

An example epic body:

```markdown
## Acceptance criteria

- `rafa roadmap` lists epics grouped by horizon.
- Every spec under an epic closes when the epic closes.
- `rafa next` descends into the first now epic that is not done.

Estimate: two weeks
Date: 2026-10-31
Owns: src/board/, src/commands/epics.ts

- [ ] #245 the board listing
- [x] #246 the epic model
- [ ] #247 walking into an epic
```

Every line after `Owns:` is the epic's **ordered checklist**, using the
same format as the roadmap: `- [ ] #<n> <title>`. Ticked items are
considered done. The order is the walk's order inside the epic.

### Membership: the label

An issue is a **member** of an epic when it carries the epic's
`epic:<slug>` label. Change the label and the issue changes epics. An
issue may carry two `epic:` labels (a fault `rafa doctor` warns about),
which makes it a member of both.

`rafa issue ready` refuses to mark a spec ready if it carries two
`epic:` labels, so a second label must be removed before the spec can be
planned.

### Order: the checklist versus the board

The epic's order is **two parts**:

1. The ticked and unticked lines of its body's checklist, in the order
   written — this is the epic's **stated order**.
2. Every open member carrying its `epic:<slug>` label and missing from
   the checklist, by ascending issue number — these are the **label-only
   members**.

When `rafa next` or `plan create --next` walks into an epic, it reads
the checklist first (passing ticked lines as the roadmap walk passes
them), then the open label-only members. A closed member missing from
the checklist is never read: it is already done, and asking it again
would spend a `gh issue view`.

`rafa epics` prints the same order: the checklist, then the label-only
members.

### State: computed on every read

An epic's state is COMPUTED from one board listing on every read, never
stored. The `src/board/epics.ts` module's notes hold the exact rules,
but briefly:

- **`empty`** — the epic has no members.
- **`backlog`** — no member is closed and none is claimed (has a plan,
  branch or open pull request).
- **`in-progress`** — some members are closed or claimed, others are
  open.
- **`done`** — every counted member is closed. Members closed as
  `NOT_PLANNED` (not planned, a close reason rafa files) are not counted,
  so an epic with no counted members reads as `backlog`, not `done`.
- **`unknown`** — the board listing failed and the epic could not be read.

### Blocked by

An epic can wait on other epics when its open members name blockers. If
member #42 has `Blocked by: #50`, and #50 is owned by another epic,
that epic is in the first epic's `blockedBy` list.

### Late: when the date has passed

An epic has an optional `Date:` field in free-text format `YYYY-MM-DD`.
An epic is **late** when its date is before today and it is not `done`.
Dates that do not parse as a real calendar day (e.g., `2026-02-30` or
`next week`) are reported as problems; the epic is read as having no
date until the body is fixed.

### Disagreement: when stored and computed states differ

An epic issue's own state (open/closed) and close reason are set by
whoever closed it. When the computed state and the stored one say
different things, the epic carries a printed line:

- `done` but issue is `open` — the work is done but the epic is still
  open.
- anything else but issue is `closed` — work has not started, or is
  in-progress, but the epic is closed.

Closing an epic as `NOT_PLANNED` is never a disagreement (it means the
feature was dropped), so it agrees with every computed state. A
disagreement is printed as a warning when the epic is read, never
automatically fixed.

### The body's optional fields

Every epic body has three optional fields besides the checklist:

- **`Estimate:`** — free text (e.g., "two weeks", "50 hours"). Rafa
  does not parse this; the planner reads it and hands it to the plan.
- **`Date:`** — the target date as `YYYY-MM-DD`, or left out if there
  is none. The date is checked for being a real calendar day; malformed
  dates are warnings but do not block the epic.
- **`Owns:`** — a comma- or space-separated list of folder paths the
  epic owns (e.g., `src/board/, src/commands/epics.ts`). Backticks are
  stripped. The borders spec defines what "owns" means; rafa does not
  validate that paths exist.

Every epic must have:

- **`## Acceptance criteria`** section with at least one bullet, holding
  what "done" means.
- **`Estimate:`** line with at least one character after the colon.

### Labels: why `epic:<slug>` and `type:epic`

The `type:epic` label identifies the issue as an epic. The `epic:<slug>`
label is membership: every issue carrying it is a member of that epic.
Why two labels?

1. **Queries work.** `gh issue list type:epic` finds every epic. `gh
   issue list epic:infrastructure` finds every issue the infrastructure
   epic owns. In rafa code, the two are read independently.
2. **Membership is clear.** An issue's labels list its owners at a glance.
   An issue with `epic:auth epic:billing` belongs to two epics. An issue
   with no `epic:` label belongs to no epic.
3. **Renames are safe.** Changing an epic's `epic:<slug>` label changes
   its members, but the epic's own `type:epic` label stays. Only rafa's
   first read of the epic (`epicSlugsOf`) extracts the slug.

### Edge cases and warnings

The board listing warns about several issues:

#### Orphan label: `epic:xyz` with no epic

An issue carries `epic:xyz`, but there is no `type:epic` issue with
`epic:xyz`. The issue is a member of a ghost epic. Relabel it to add it
to a real epic, or remove the `epic:` label to un-member it.

`rafa roadmap` prints this warning; `rafa epics <n>` does not (the epic
might not be on the board, but the issue is).

#### Several epic labels: one issue, two `epic:` labels

An issue carries both `epic:auth` and `epic:billing`. It belongs to two
epics. `rafa issue ready` refuses to mark it ready unless one label is
removed. The planner reads the first `epic:` label it sees, but the
board always warns about this: every epic the issue belongs to, and
every command, should agree.

#### Unlabelled checklist line: `- [ ] #99` on an epic with no `epic:` label

An epic's checklist names issue #99, but the epic carries no `epic:`
label (only `type:epic`). The epic has no members to read. Fill in an
`epic:<slug>` label first.

#### Unlisted member: issue carries the epic's label but is not in its checklist

An open issue with `epic:infrastructure` is missing from the
infrastructure epic's checklist. `rafa next` walks it after the
checklist, by issue number, and `rafa epics` prints it as a **label-only
member** row, indented. This is not a fault: the checklist is the
stated order, and an issue added later might not be listed yet.

### Example: the board view

```bash
rafa roadmap
```

With no epics, the output is the same as before: the spec lines and
their columns. With epics on the board:

```text
## Roadmap

- [ ] epic #254 Infrastructure (horizon:now, 0/2 done)
  - [ ] #245 the board listing
  - [ ] #246 the epic model
  - [x] #247 walking into an epic (label-only)

- [ ] #248 Spec without an epic
```

Epic lines show: number, title, horizon, and `done/total`. Specs under
an epic are indented. Specs outside any epic appear alone.

### Example: walking into an epic

```bash
rafa next
```

When `rafa next` reaches an epic line that is open, `horizon:now`, and
not done, it descends into it:

```text
walking into epic #254 Infrastructure (0/2 done): its checklist,
then its labelled members missing from it

- [ ] #245 the board listing
- [ ] #246 the epic model
- [x] #247 walking into an epic (label-only)

Plan? [y] yes [N] cancel
```

Then the walk continues inside the epic. A member closed as `NOT_PLANNED`
is not walked.

After `rafa switch`, `rafa next` and `rafa plan create --next` start
from the place you switched to: the board's checklist for a board, or
that epic's lines alone, whatever its horizon, for an epic.
`rafa plan create --next=<n>` still reads the roadmap issue you name.

### Example: using `rafa epics`

```bash
rafa epics         # the epic you switched to, else the first now epic not done on the roadmap
rafa epics 254     # the epic #254, whatever its horizon
```

The output is the same table as `rafa roadmap` prints for spec lines,
but only the epic's lines: its checklist, then label-only members.

## Epic lifecycle: every change to an epic is a command with a trail

An epic goes through four states: backlog (no work started), in-progress
(some members closed or claimed), done (every member closed), and empty
(no members). Every change to an epic is a command that leaves a comment
on the epic issue, so the board's history is readable. Epics are optional:
a project with no epics works exactly as before.

### Creating an epic

```bash
rafa epic new "Feature name" --slug feature-name [--horizon now|next|later]
```

`rafa epic new` creates:

1. A GitHub issue from the epic template, with:
   - The epic's title
   - An `## Acceptance criteria` section (edit this to list what "done" means)
   - `Estimate:` (free text, e.g., "two weeks")
   - `Date:` (optional target date as YYYY-MM-DD)
   - `Owns:` (optional list of folders the epic owns)
   - An empty `- [ ] ` checklist for its members
2. Three labels: `type:epic`, `epic:<slug>`, and `horizon:now` (or
   `next`/`later` if you pass `--horizon`)
3. A line on the current board's checklist

The epic's slug becomes its member-joining label, so `epic:feature-name`
joins all its specs. Later, when a spec is ready, you mark it with
`spec:ready` and use `rafa epic move <issue> --to feature-name` to add it
to the epic.

### Changing an epic's priority: defer and promote

When priorities change, move an epic between horizons without recreating
it. Each move leaves a comment on the epic issue:

```bash
rafa epic defer 254 --to later --reason "waiting on #118"
rafa epic promote 254 --to now --reason "now critical"
```

Both `defer` and `promote`:

1. Swap the horizon label (`horizon:now` ⟷ `horizon:next` ⟷ `horizon:later`)
2. Comment on the epic: `Moved now → later: waiting on #118`
3. Ask if you want to keep open branches and pull requests

When you defer an epic that is in-progress, the command names its open
branches and pull requests and asks whether to keep them. They stay on
disk and stay listed in `rafa status` but the epic's checklist does not
wait for them.

**Scenario: A team at standup.** The team meets every morning and
priorities change every day. `promote` and `defer` are how the board
changes. Each move leaves a comment, so the history answers "why is this
later now?". Since `rafa next` reads the board fresh on every turn, a
change made at nine is there for the loop's next pick at ten.

### Moving an issue between epics

When an issue is filed in the wrong epic, move it without recreating it,
so its comments, branches and pull requests stay attached:

```bash
rafa epic move 42 --to infrastructure --reason "belongs in the backend"
```

`rafa epic move`:

1. Swaps the issue's `epic:` label
2. Moves its checklist line from the old epic's body to the new one's
3. Leaves a breadcrumb comment on the issue: `Moved from epic #254 to
   #255: belongs in the backend`

The issue's title and body never change. Its branches and pull requests
stay linked to it and to their original epic at the time of the move, so
the cost summary at close time reflects where the work was done.

### Closing an epic: the verification gate

An epic closes only when every member is closed AND a verification pass
of its acceptance criteria runs against main:

```bash
rafa epic close 254   # 🪙
```

`rafa epic close` (the only epic command that spends Claude usage):

1. Refuses if any member is still open
2. Plans a verification-only run from the epic's acceptance criteria —
   each criterion becomes a check a Claude session reads and verifies
   against `origin/main`
3. If a criterion cannot be checked (prose that cannot be turned into a
   runnable check), the close refuses unless you pass `--accept-unchecked`
4. If a check fails, the failure is filed as a bug (routed by the owning
   epic once the border rules spec #249 is done), and the close refuses
5. On success, closes the epic as completed and prints what it cost:
   - Total sessions and tokens across all its members' runs
   - Wall time from the first member's start to the last member's close
   - The estimate from the epic's body (free text, no ratio)

**Scenario: Solo.** The closing gate is the part worth showing. "Every
issue closed" is not the same as "the feature works". A solo developer
can run this once and move on; for a team, it is the proof before the
epic leaves the board.

### Cancelling an epic

An epic can be cancelled by hand on GitHub (closed as "Not Planned") or
with a command:

```bash
rafa epic cancel 254
```

`rafa epic cancel`:

1. Lists every issue in another epic that this epic's open members block
2. For each blocked issue, asks: move it, unblock it, or cancel it
3. With no terminal, nothing changes and the list is printed

Why ask? Because cancelling an epic leaves its members closed and unlisted,
but blocks a parallel epic's work. The cancel makes sure somebody looks at
those blocks instead of leaving them forever.

**Scenario: Several teams.** When the backend team cancels an epic, it can
strand work in the frontend team's epic if the frontend was waiting on it.
The cancel asks about each such issue instead of leaving it blocked
forever. If you move those issues, they stay open in their epic's scope.

### When an epic runs dry: the end-of-epic lines

When `rafa next` finds the current epic is done (every member closed), it
ends with three lines:

```text
The epic #254 is done.
rafa epic close 254    # 🪙 verify and close it
rafa roadmap           # to see the board's epics
rafa release tag       # if the version is untagged
```

The first line says the epic is done. The second is the next step (close
the epic, which spends one Claude session). The third is how to see the
board. The fourth appears only if `rafa release status` says there is an
untagged version.

### The epic tick: when `rafa pr merge` closes a member

When you merge a pull request that closes an issue, `rafa pr merge`:

1. Ticks the issue's line on the roadmap (as it did before)
2. Also ticks the issue's line in its epic's checklist (if it belongs to
   one)

So when you merge a member of an epic, both the board and the epic's own
checklist update, keeping them in sync. The roadmap shows `done/total` on
each epic line, which stays accurate as members close.

## Hopping between epics with `rafa next --roadmap`

When work on your current epic is blocked by an issue in another epic, you
can reach for that blocker, work it, and return home with a single command:
`rafa next --roadmap`. The command works one issue in the blocking epic and
comes back.

### The two-hands pattern

Imagine climbing with two hands. One hand holds your **home** — the anchor
place you came from. The other hand reaches for the next **handle** — the
blocker you are about to work. Reaching for a third handle would mean
letting go of home, and that is exactly where rafa halts. This two-slot
pattern keeps work safe:

- **Home**: where you started (a board and an epic)
- **Current**: where you are working now (the blocker you reached for)
- **One blocker ahead**: if that blocker is itself blocked (a third slot),
  rafa refuses and prints `H ← C ← B` showing the chain, naming the halt

### The worked example

Your epic E on board X has an issue H blocked by issue C, which lives in
epic F on a different board Y:

```text
H (board X, epic E) ← C (board Y, epic F)
```

You run `rafa next --roadmap`. rafa:

1. Sees H is blocked by C
2. Reads C's epic F and board Y
3. Moves to board Y, epic F
4. Runs a task to work C
5. When done, moves home to board X, epic E
6. Reports what changed and what blocked it

If C were itself blocked by B:

```text
H ← C ← B
```

rafa halts at C with a message naming B, and you fix B first.

### Solo projects: the dry hop

When you work alone, a hop is just a reach into another epic on the same
board. No permission is needed. `rafa next --roadmap` hands the blocker to
an agent and comes home. Solo developers use this to follow work wherever
it leads without getting lost.

### One team: hops within your own board

Your team's epic H on board #31 (Roadmap) is blocked by an issue C in
another team epic F on the same board:

```text
H (board #31, epic E) ← C (board #31, epic F)
```

A hop between your own epics asks no permission. rafa works C and comes
home, keeping your team focused on one board.

### Several teams: hops across boards with review

The backend team's epic H on board #254 is blocked by an issue C in the
frontend team's epic F on board #257:

```text
H (board #254, backend) ← C (board #257, frontend)
```

When the hop crosses to another board with a different owner, rafa:

1. Reads the `CODEOWNERS` file to find who owns the target epic's code
2. Opens a pull request with the work on C
3. Halts and tells you it is waiting for the owner's review:
   `waiting on #C (owner review)`
4. Once the team approves and merges the pull request, the loop resumes
   and comes home

This keeps a loop from changing another team's code without review. The
same safeguard (the **owner gate**) applies when `rafa plan create` or
`rafa loop start` is told to work on an issue owned by another team.

### The hop record

While a hop is in progress, rafa writes `.rafa/hop.json` to track:

- The issue being worked (C)
- Where home is (board X, epic E)

When the work finishes, rafa deletes the record and returns home. If a
person switches boards by hand, their position changes but the hop record
stays: rafa detects the mismatch, drops the record, and follows the new
position.
