## Triage

`src/triage/` routes each out-of-scope bug in a task report to a channel and
decides whether to file a new issue, comment on an existing one, or skip it.
The loop calls `triageReport` from `src/start/triage.ts` and `rafa epic close`
from `src/commands/epic/close.ts`; the triage writer stores every bug and its
action in the effort store, keyed by the bug's recurrence key, not the artifact
the report's findings use.

### The three channels

A bug is routed to one of three channels before it reaches the tracker:

**Public.** A bug the machine-fault reading does not match and whose
`security` flag is `false`. It is looked up by its key, and a recurrence is
read for state: open issues are commented on; closed as completed (done or
released), it is superseded by a new issue; closed as not planned or
duplicate, it is commented on only. Security bugs stay off this channel
entirely; a stored reference is never read or written for one.

**Private.** A bug whose `security` flag is `true` or missing. It goes to a
second local tracker rooted at `PRIVATE_TRIAGE_DIR` (`.rafa/triage/private`),
kept ignored by `.gitignore` under every tracking flag; the parser never
defaults a missing flag. Searching a public tracker for a vulnerability's
terms is disclosure, so a private bug never reaches the public one: no find,
no create, no comment, no reference stored. A recurrence is found by the
private tracker's own find, which reads files locally, and is commented on
there. The GitHub advisory channel stays one a human opens.

**Machine.** A bug whose `what` and `artifact` name a system toolchain, an
SDK path, or a package-manager build failure: a fault of the MACHINE the
session ran on and not of rafa. `./machine-fault.ts` reads the families and
is the whole of that reading. Such a bug goes to a channel with no tracker
at all: neither tracker is asked anything, no reference is stored, and its
action is `skipped`. Its problem says the family and the text that matched,
redacted as every problem here is, so a run says why nothing was filed. The
bug is not lost — `writeTriage` stores every out-of-scope bug and its scope
column, so the row says `machine`.

### The key and the two-step match

A bug's recurrence key is built from its artifact and `what`, with local
paths taken out and the artifact stripped of numbers, commit hashes and
folder prefixes (`./bug-key.ts`). The test file, case and evidence line of a
bug naming a test case; else the tracker file it was reported against WITH
its artifact. A bug with no artifact has no key and is filed every time.

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
listing the nearest bugs it scored, up to `triage.similarity.candidates`.
When the option is left out or its threshold is `false`, step 3 is off.

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
against the failures.

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

Two keys in `.rafa/config.yaml` tune the nearest-open-bug step:

- `triage.similarity.threshold`: `false` to turn the step off, or a number
  from 0 to 1 naming the minimum score. Default is `0.3`, which on 667
  filings gave 81% of repeats right and 6% of new causes wrong; `0.2` gave
  87% and 9%. Lower matches more repeats and puts more new causes on the
  wrong issue.

- `triage.similarity.candidates`: the count of nearest bugs listed in the
  `Possible duplicates` section when the step files a bug with no match at
  the threshold. Default is `3`.

