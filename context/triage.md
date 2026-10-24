## Triage

`src/triage/` routes each out-of-scope entry of a task report by its kind, and
each `stale_docs` entry to the `docs` channel. The six kinds are `bug`,
`own-fallout`, `own-gap`, `convention`, `docs` and `machine`; of them only a
`bug` reaches a tracker as an issue of its own. The loop calls `triageReport`
from `src/start/triage.ts` and `rafa epic close` from
`src/commands/epic/close-triage.ts`. The triage writer stores every bug and its
action in the effort store, keyed by the bug's recurrence key, not the
artifact the report's findings use, and each routed entry leaves one row in
the `bug_routes` table (`packages/rafa/src/effort/store/bug-routes.ts`) naming
the kind the
session said, the kind the loop routed it under and the route it took.

### The kinds and their routes

`src/triage/kind-route.ts` routes an entry after the security rule and the
kind check. Read top to bottom:

| Kind | Route |
| --- | --- |
| `bug` | the check may read it as `own-fallout`, `own-gap` or inherited; otherwise the public, private or machine channel, as before kinds |
| `own-fallout` | after the check: a `repair` task while the plan holds fewer than its cap, else a `follow-up` row |
| `own-gap` | as `own-fallout` |
| `convention` | a `pr-body` row: one line of the pull request's `## Conventions` section; no tracker call |
| `docs` | a `docs` row: a `sighting` row of `stale_docs`; no tracker call |
| `machine` | a `machine` row: skipped on the machine channel, as a machine-fault bug is; no tracker call |

A session that wrote no `kind` key reads its entry as `bug`, with no parser
issue, so a session on an older prompt changes nothing. A value outside the
six is reported as an `unusable-field` issue and also reads as `bug`.
`bug_routes.said` holds the kind the session wrote, null when it wrote no
usable one; the effort report counts the routed kind, never the said one.

**The security rule comes first.** An entry whose `security` flag is `true`
or missing takes the private channel whatever its kind. No test is run for
it, and no repair task, follow-up line, pull request line or `stale_docs` row
is written for it, so no security entry leaves the private channel.

### The check on the base and the head

The session that reports a red test is not the one that turned it red, and it
cannot see the plan's base, so the loop checks every `own-` claim and every
`bug` that names a test or a path. `checkKind` (`src/triage/own-check.ts`)
reads the entry down a decision table, the first row that holds answering.
An entry the session said is `convention`, `docs` or `machine` is taken as
said and nothing is read.

| The entry | Answer |
| --- | --- |
| names a test case, not red on the head | `bug` |
| names a test case, not runnable on the plan's base | `bug` |
| names a test case, red on the base and on the head | inherited: unfiled, as a run-start failure is |
| names a test case, green on the base, red on the head | `own-fallout` |
| names no test case, the plan's files not read | `bug` |
| names no test case, a path outside the plan's files | `bug` |
| names no test case, every path one of the plan's files | `own-gap` |
| names neither a test case nor a path | the kind as said |

An `own-` claim the check does not confirm reads as `bug`. For `own-gap`
every path the entry names must be one of the plan's files, so one neighbour's
file makes the entry a `bug`. A named path is a plan file when it equals one,
with any leading `./` taken off; when it is absolute and ends in one; or when
it is a bare file name and a plan file has that base name.

**What it costs.** The head is read first: the named test file runs once at
`HEAD` of the run checkout, and only when the case is red there does it run
once at the plan's base. Each run is one test file, never the suite. It runs
in a detached temporary worktree of that commit with the run checkout's
`node_modules` linked in, removed afterwards, and is cached per commit and
file for the whole run, so two bugs naming two cases of one file cost one
run (`src/triage/base-run.ts`). A file missing at the commit, under
`node_modules` or outside the checkout is not run, and reads as
`unrunnable`, so its entry is a `bug`. The plan's base is the merge base of
`HEAD` and `refs/remotes/origin/<pr.base>`, and the plan's files are the
paths `git diff --name-only -z` names between that base and `HEAD`
(`src/triage/plan-commits.ts`). A report with no test named costs those git
reads, made again for each report. A failed read reads as a base or a file
list the loop cannot use, so the entry is a `bug`: the cost falls on filing,
never on hiding.

### The channels

A bug is routed to one of three channels before it reaches the tracker, and
a `stale_docs` entry to a fourth:

**Public.** A `bug` whose `security` flag is `false`, which the machine-fault
reading does not match and the check leaves a `bug`. It is looked up by its
key, and a recurrence is read for state: open issues are commented on; closed
as completed (done or released), it is superseded by a new issue; closed as
not planned or duplicate, it is commented on only. Security bugs stay off this
channel entirely; a stored reference is never read or written for one.

**Private.** A bug whose `security` flag is `true` or missing. It goes to a
second local tracker rooted at `PRIVATE_TRIAGE_DIR` (`.rafa/triage/private`),
kept ignored by `.gitignore` under every tracking flag; the parser never
defaults a missing flag. Searching a public tracker for a vulnerability's
terms is disclosure, so a private bug never reaches the public one: no find,
no create, no comment, no reference stored. A recurrence is found by the
private tracker's own find, which reads files locally, and is commented on
there. Its body holds the same record a public bug's does (see the body
below). The GitHub advisory channel stays one a human opens.

**Machine.** A bug whose `what` and `artifact` name a system toolchain, an SDK
path, or a package-manager build failure: a fault of the MACHINE the session ran
on and not of rafa. `packages/rafa/src/effort/store/machine-fault.ts`, which
`./machine-fault.ts` re-exports, reads the families and is the whole of that
reading. Such a bug goes to a channel with no tracker at all: neither tracker is
asked anything, no reference is stored, and its action is `skipped`. Its problem
says the family and the text that matched, redacted as every problem here is, so
a run says why nothing was filed. The bug is not lost — `writeTriage` stores
every out-of-scope bug and its scope column, so the row says `machine`. An entry
of kind `machine` takes the same channel with the same action, its problem
saying it is machine-scoped as its kind says.

**Docs.** A `stale_docs` entry, which is no bug. It is the `machine`
channel's twin: no find, no create, no comment on either tracker, no
reference stored or read, and its action is `skipped`. `./stale-docs.ts`
(`triageStaleDocs`) is handed no tracker at all, so there is none it could
call. Its problem is one line, `stale_docs[<index>] is stale documentation at
<where>: <what>`, redacted first. The index is the entry's place in the list
the parser answered, which can differ from where the entry was written when
the parser dropped an earlier entry with no `what`. No entry is read for a
machine fault or a `security` flag, and none is compared with anything: a
page naming a toolchain is still a page. A report whose only content is
`stale_docs` entries resolves no public tracker (`src/start/triage.ts`),
since resolving runs `gh auth status` and `gh repo view`.

The entries are kept, but not by this channel. The loop stores the report before
it is triaged, and `storeTaskReport` (`packages/rafa/src/report/record.ts`)
writes each entry to the store's `stale_docs` table as a `sighting` row
(`packages/rafa/src/effort/store/stale-docs.ts`). The docs row says the entry
reached no tracker; it says nothing of whether its store row was written. A
`docs` kind entry of `out_of_scope_bugs` is the other route to that table: it is
stored as a `sighting` row whose `where` is the first path its `what`, then its
`artifact`, names, or null, and its `bug_routes` row says `docs`.

### The body the loop files

A bug the loop files carries the bug record (`context/bug-record.md`), built
by `bugFilingOf` (`src/triage/bug-filing.ts`) from the session's report, the
dispatch it ran under and the checkout. Its body opens with the sentence
saying where it came from, then a `Supersedes` section when the bug came
back, then `What`, `Artifact`, `Refs` when the artifact names a path or a
symbol, `Recurrence key`, `Plan`, `Task` and `Feedback`.
The sections above `Feedback` are the ones `./bug-key.ts` and
`./similarity.ts` read, and the record adds nothing to them. After `Feedback`
come the record's sections, one per field holding a value, in `BUG_FIELDS`
order: `Reproduce`, `Rerun`, `Cause`, `Proposed cause`, `Suspected cause`,
`Module`, `Action`, `Project`, `Environment` and `Versions`. Last are
`Reported module` and `Reported action`, the session's word for a `Module` or
`Action` the record holds as `unknown`. A new issue's `Possible duplicates`
section, when the similarity step filed one, comes after those two.

`Reproduce` is the session's word, else `seen while running task <line> of
plan <stub>`, or ``seen while running `<command>` `` for a dispatch with no
plan stub. The record never holds `unknown` there.

`Cause` follows the cause rule (`src/bugs/cause-rule.ts`), which never refuses
a session's words. A code of the list is kept as written. A shaped code the
list lacks is `<family>:new-context`, with the code kept as `Proposed cause`,
or `unknown:new-context` when its family is unlisted. Any other text is
`unknown:new-context`, with the text kept as `Suspected cause`. No cause at
all is `unknown:new-context` with nothing beside it.

`Rerun` is ``bun test <file> -t "<case>"`` for a test failure naming its file
and case (`rerunOf`). The case's describe names and its own are joined by a
space, as `bun test -t` matches them, and the pattern is matched literally.
No other bug has a `Rerun`.

Every free text of the record is redacted when it is answered: local paths
over both roots in one pass, the checkout the task ran in and the project
root, the longer first, then named secrets. Two passes would leave the
folders between the home and a worktree in its path.

A recurrence's comment carries no record field but `Versions`, the versions
the bug was seen again on, written after `Feedback`. It has none of the
other record sections.

### The repair task and its cap

`src/triage/leftover-repair.ts` writes the repair of an `own-fallout` or
`own-gap` entry through `insertTrackerTask` (`packages/rafa/src/utils/tracker.ts`),
directly above the plan's first open task, `[ ]` or `[BLOCKED]`, or after the
last task when none is open:

```text
- [BLOCKED] Repair the own-fallout leftover: <what> <!-- leftover -->  {agent=build-error-resolver}  <!-- blocked: ... -->
```

The `what` is redacted, then escaped as a blocker is, so a line break or a
`- [ ]` in it opens no task and a `<!--` in it opens no comment. The blocker
names the kind, the `what` and the artifact that showed it. An `own-fallout`
repair is declared `build-error-resolver`, the agent of the suite step's
repair; an `own-gap` repair `loop-implementer`, since it finishes what the
plan built. Being blocked, the line is the one the next dispatch answers
first. `isRepairTask` in `src/start/suite-blocker.ts` reads the same sentence
as the suite step's repair.

The cap is per plan, and it is counted from the tracker alone: the file's
`<!-- leftover -->` lines, ticked ones included, are the plan's repairs. No
repair is added once that count reaches the run's resolved retry count
(`resolveRunRetries`: `--retry` over `loop.retries`), with `false` as zero.
Under the default `false` no leftover becomes a repair, and every one goes to
the follow-up issue. A leftover past the cap, a line the tracker refuses and a
tracker that cannot be read each become a `follow-up` row, the problem naming
the failure, so an entry is never lost. Each repair the run adds is one
`Triage:` line naming its tracker line.

### The follow-up issue

`src/start/follow-ups.ts` (`fileFollowUps`) writes the plan's follow-up
issue once, after the last task, from `src/start/wrap-up-run.ts`. Its lines
are the plan's `bug_routes` rows routed `follow-up`, in append order, one
`- <kind>: <what>` line each, redacted and escaped; a plan with none has no
issue, and nothing is resolved, called or printed for it.

The issue is of type `bug`, titled `Follow-ups of <stub>`, and its body opens
with `<!-- rafa:follow-ups <stub> -->`, so it is told from a person's issue
of the same title. It is found by `openIssues('bug')`, kept to bodies holding
that marker, then the exact title. A found issue has the lines its body does
not already hold appended through `edit`, and a body holding every line is
left alone, so a resumed run or a second wrap-up adds no duplicate. No issue
found is `create`d with every line. A tracker chain that lands nowhere, or a
tracker with no `edit` or no `openIssues`, creates nothing: its lines are
printed once under a heading naming the issue they would have gone to. A
failure is one warning line, the rows stay in the store, and the next
wrap-up files them again.

### The conventions section

`src/start/convention-body.ts` (`writeConventionLines`) writes the plan's
`convention` lines into a `## Conventions` section of the open pull request's
body, from `src/start/wrap-up-run.ts` once the pull request is delivered. Each
line is `- <what>`, redacted and escaped as a follow-up line is. A section
that is not there goes below the body's last paragraph; one that is there
gets the lines it lacks before the next heading of level one or two.

The body is written through the same read-modify-write as the release body
(`src/start/release-body.ts`), so a body the section would not change is left
alone, and a re-run writes nothing. A `none` provider spawns no `gh`: the
lines are printed instead. A plan with no `pr-body` row has no section. A
failure is one warning line, and never stops the run.

### Stale-doc rows: two kinds

The `stale_docs` table holds one row per entry per session and kind. Its
`kind` is one of two values:

- `sighting`: an entry a task reported as a stale line, written by
  `storeTaskReport` for every task, the doc task included. It is the reading
  a plan's doc task is handed.
- `unsettled`: an entry the doc task could not settle, which is what the
  doc task's own `stale_docs` field names. `src/start/stale-docs.ts` writes
  these only for a task declared `docs=repair` that ended `done`, and adds
  each as one line to the release's stale-docs issue (see
  `src/docs/release-issue.ts`). A blocked, failed or interrupted doc task
  stores nothing: its next attempt reports again.

The unique index covers the session, the kind, the place and the text, so a
report written twice writes its rows once. `kind` is in the index, so an
unsettled row is not dropped as a sighting's duplicate. Rows with no plan
stub are the epic-close kind below. The rows are append-only in merges, by
their `id`.

### Documentation-only failures in `rafa epic close`

A failed acceptance check of `rafa epic close` whose criterion's text names
only documentation is no bug. `namesOnlyDocs` (`packages/rafa/src/triage/doc-only.ts`)
decides it: at least one path named, and every named path a `.md` or `.mdx`
file, a path under `docs/` or `context/`, or a `README` or `CHANGELOG`. A
criterion naming a source file beside a page, or no path at all, is filed as
a bug as before. The reading of `namesOnlyDocs` is the same as the
effort-report count below, so the two cannot disagree on one text.

For such a failure `./close-docs.ts` (`routeDocsOnlyFailure`) does, in place
of the bug report, two things. It stores one `unsettled` row under the check
session's id with no plan stub, since an epic close runs under no plan. It
adds one line to the release's stale-docs issue, on the tracker the close
resolved for its bugs. The entry names no `where`: a criterion is no file and
line, so its `what` is the epic, the criterion's number and its text. A
tracker that cannot list and edit answers `kept`, and the line is printed,
since the close has no "after the last task" to hold it for. The close is
refused all the same, since the criterion does not hold.

### What `rafa effort report` reads

`rafa effort report` prints two readings of the triage.

The first is one line, `filed bugs naming only documentation: N of M`, from
`packages/rafa-effort/src/effort/report-doc-bugs.ts`. M counts the `out_of_scope_bugs` rows of
scope `rafa`, the bugs a tracker could be handed, and N counts those whose
`what` and `artifact` read as ONE text name only documentation, by
`namesOnlyDocs`. The two fields are joined by a line break because the
reading is split across the pair both ways: a `what` naming a page beside an
`artifact` naming a source file is a bug about code, and a `what` naming a
page beside an artifact quoting the page's sentence is a bug about the page.
A `machine` row is in neither figure. This count is the control for a session
filing a stale page as a bug instead of a `stale_docs` entry. It reads zero
while the sessions keep the two fields apart; a figure that rises says they
have stopped.

The second is the section `out-of-scope entries by routed kind`
(`packages/rafa-effort/src/effort/report-kinds.ts`, rendered by `packages/rafa-effort/src/effort/report-format.ts`): one
row per plan, under its stub with the rows of no plan last, giving its
entries, those routed `filed`, the share of them filed, and the count under
each kind in the order of `BUG_KINDS`. It counts the kind the loop routed each
entry under, so a sweep whose entries are its own fallout reads a low share
and one that files everything reads a high one. A store with no `bug_routes`
row prints no section; a store that cannot be read prints the heading with
the problem in place of the rows.

### The key and the two-step match

A bug's recurrence key is built from its artifact and `what`, with local
paths taken out and the artifact stripped of numbers, commit hashes and
folder prefixes (`./bug-key.ts`). The test file, case and evidence line of a
bug naming a test case; else the tracker file it was reported against WITH
its artifact. A bug with no artifact has no key and is filed every time.
The `Recurrence key` section of a filed body holds this key, and the record
adds no field the key reads (see the body above).

On the public channel, a bug is looked up in two steps:

1. **Stored reference.** The reference stored under the key, then under each
   legacy key from before #486. The first one of the tracker's own kind is
   the issue. An issue found by step 1 is answered without a `find` call, so
   an issue filed for this bug from a checkout whose store this run does not
   have is not found — only issues filed from a previous run that stored its
   reference are. Once commented on, the reference is stored under the key,
   so a later recurrence is answered by step 1.

2. **Finder.** No stored reference found: `tracker.find` for a `bug` whose
   text holds the key's text, redacted. Every issue filed carries that text
   in its `Recurrence key` section, so an issue filed before #486 under a
   legacy key is found by step 1 only, while a new one is found by step 2.
   The first ref find answers is the issue; once commented on it is stored
   under the key. A find that fails answers failed, as a stored-reference read
   does. On the private channel, find is the only step.

### Similarity and duplicates

When `triage.similarity` configures a threshold and the public tracker has
openIssues, a third step runs after a find miss: the nearest open bug by
Jaccard similarity over the words in the bug's `what` and artifact with
local paths taken out. `./similarity.ts` holds the word sets, the score, and
a test-file guard so a bug naming one test file is never compared against a
bug naming another. The nearest at or above the threshold is commented on
naming its score; its reference is stored under the key. Below the threshold,
the bug is filed, and its body ends with a `Possible duplicates` section
listing the open bugs ranked for it, up to `triage.similarity.candidates`.
When the option is left out or its threshold is `false`, step 3 is off.

The threshold decides alone. `nearestOpenBugs` and its first element stay the
same-bug decision, on the word score, and no bonus below reaches it: a bonus
never comments a bug away on its cause. The ranked list is `rankedCandidates`'s.
A bug's rank is its word score plus each bonus that applies, capped at 1:

- **same cause**: both records carry the same full code, weighed by
  `triage.similarity.weights.causeLeaf`.
- **same cause family**: both carry a code of one family with different
  leaves, weighed by `causeFamily`.
- **same boundary**: both carry the same module and the same action, neither
  `unknown`, weighed by `boundary`.

A bonus counts only when both bugs carry the field. A cause whose leaf is
`new-context` earns no cause bonus, `unknown:new-context` included, so two
bugs sharing only that code are not ranked together for it. A bonus alone
lists a bug that shares no word with the report, and a rank of 0 is left out.
The test-file guard still drops a bug naming another test file.

The edge cases follow from those rules. An old open bug with no fields is
ranked by its words alone, as before. Two bugs with the same cause leaf and
few shared words are both filed, and only the later one's list names the
earlier: a body is written once, when its bug is filed, so the list is one
way. A bug with no artifact has no key and never reaches step 3, and a
private bug is never compared with anything, so neither gets a list, as
before.

A bonus is a second witness. Shared words say two reports sound alike; a
shared cause code says the same gate triggered, which is not yet "the same
thing is failing". The witness is heard when the list is ranked, and it does
not decide the case alone.

Rejected, each with its reason: bonuses inside `nearestOpenBugs`, which would
comment a bug away on its cause; one weighted sum in place of the word score,
which would move every score of the 1,013-filing fixture; and a list for the
bugs that have none today, which would add a tracker read to private bugs.

### Inherited failures

When `TriageOptions.inherited` provides the run-start baseline's failures, a
public bug that `./inherited.ts` reads as one of those is a red test the run
started with, not one its task made: its action is `inherited`. The bug
matches a failure when it names a test file and case whose base name and
case name equal the failure's, and, when the failure has a message, its
evidence line holds that message. A failure with no message, or a blank one,
is matched on test file and case alone: Bun 1.3.14 writes a failing `toBe`'s
`<failure>` with no `message` attribute where 1.4.2 writes one, so under the
pinned Bun a baseline failure often carries none. Nothing is
filed for it. Its key is looked up as steps 1 and 2 above look one up, and
the issue they find has its state read; an open one is commented on unless
it already was this run. The key goes into the option's `commented` set once
the comment is made, so one red test reported by every task of a run comments
once. A closed issue, or none, is left alone, and create is never called.
Closed as completed, the run still files nothing, since it inherited the
failure before its own work. Security and machine-scoped bugs are never read
against the failures. The check's red-on-both answer
(`src/triage/own-check.ts`) is unfiled in the same way, with its route row
`inherited`.

### State read on a repeat

Before anything is written for an issue steps 1 or 2 found on the public
channel, its state is read with `tracker.get`. Open: the bug is commented on.
Closed as completed (done or released): the fix did not hold, so a new issue
is filed whose body opens with a `Supersedes` section naming the closed one,
and the new reference is stored under the key with `supersedes` naming the
closed one. Closed as not planned or a duplicate: it is commented on and
nothing is filed. A read that fails answers failed, so a second issue for a
bug whose first may still be open is not filed without knowing its state. The
private tracker keeps no reference, so its find, which answers the oldest
issue first, would find the closed one again on every recurrence and file in
its place: a security bug is commented on as found without a state read.

### Configuration: `triage.similarity`

Five keys in `.rafa/config.yaml` tune the nearest-open-bug step:

- `triage.similarity.threshold`: `false` to turn the step off, or a number
  from 0 to 1 naming the minimum score. Default is `0.3`, which on the
  1,013 filings of `src/triage/testdata/scoring.json` gave 84% of repeats
  right (696 of 827) and 3% of new causes wrong (6 of 186); `0.2` gave 86%
  and 20%. `src/triage/similarity-scoring.test.ts` holds the default to at
  least 84% and at most 4%. Lower matches more repeats and puts more new
  causes on the wrong issue.

- `triage.similarity.candidates`: the count of open bugs, highest rank first,
  that the `Possible duplicates` section lists when the step files a bug with
  no match at the threshold. Default is `3`.

- `triage.similarity.weights.causeLeaf`, `.causeFamily` and `.boundary`:
  the bonuses `rankedCandidates` (`src/triage/similarity.ts`) adds to an
  open bug's word score for the same cause code, the same cause family with
  another leaf, and the same module and action, capped at 1 (see "Similarity
  and duplicates"). Each is a number from 0 to 1, and `0` turns its signal
  off. Defaults are `0.15`, `0.05` and `0.10`. They order the list of
  `Possible duplicates` only; the same-bug decision stays on the word score
  and the threshold. A number outside 0 to 1, `true` and `false` are refused.

With an empty config the three weights take their defaults. Setting one to
`0` turns its signal off and leaves the other two as they are:

```yaml
triage:
  similarity:
    weights:
      causeFamily: 0
```

A file that sets the threshold and all three weights:

```yaml
triage:
  similarity:
    threshold: 0.3
    weights:
      causeLeaf: 0.2
      causeFamily: 0.05
      boundary: 0.15
```

### Configuration: the record's rules

Triage builds the record under the `issues` and `errors` keys the run
resolves from `.rafa/config.yaml`. `bugRulesOf`
(`packages/rafa/src/config-schema-issues.ts`) turns them into the rules,
read once per run in `src/start/triage.ts` and handed to every filing. It
reads:

- `issues.titles.bug` and `issues.titles.summaryMax`: the template and the cap
  the summary is cut under, so a title reads back as its fields.
- `issues.vocabulary.modules` and `issues.vocabulary.actions`: a name outside
  a set vocabulary is filed as `unknown`, with the word kept as
  `Reported module` or `Reported action`. An empty list accepts any name of
  the shape.
- `errors.codes`: the project's codes, beside rafa's own, which the cause rule
  reads.

The place is `ci` or `local`, from the `CI` variable (`suggestedEnvironment`),
so `issues.environments` does not reach a loop-filed bug. With no rules
handed, rafa's defaults apply (`DEFAULT_BUG_RULES`).

### Three cases, lightest first

The problem these kinds answer, in the design session's words: "its bug
sweeps are creating more bugs than closing in some iterations", and "I want
to be done leaving breadcrumbs (as analogy of microscopic repetitive issues)
every time we chomp on an issue of the board."

**A plan of two tasks.** The second task meets a test the first turned red,
and its report names that test as `own-fallout`. The check runs the test at
the plan's base, where it is green, and at `HEAD`, where it is red, and the
triage adds a repair task above the second task's line, which the next
dispatch takes, so the fix lands in the same pull request. This needs the
run's retry count at one or more. Under the default `false` the same entry is
a `follow-up` row, a line of the plan's follow-up issue.

**A bug sweep of several fixes.** One fix leaves a gap in a file its own
commits touched, and its report says `own-gap`. Every path it names is one of
the plan's files, so the check confirms it, and the repair is finished in the
same sweep rather than filed for the next one. The cap is the same as above.

**A long plan that runs out of retries.** Once the plan holds as many repair
tasks as its cap allows, each further leftover becomes a `follow-up` row. At
wrap-up those rows are one `bug` issue, `Follow-ups of <stub>`, with a line
per leftover, and a later wrap-up of the same plan appends to that issue
without a duplicate.

Rejected, each with its reason: the session decides the kind alone, since it
cannot see the plan's base; and filing every leftover now and closing it at
the next pit stop, since the issue would still exist first.
