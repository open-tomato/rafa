## The bug record

Every bug has the same fields under the same headings, and a title
rendered from them (#951). Two writers build the record. `rafa issue
create --type=bug` reads its flags into one (`src/bugs/`, and
`src/commands/issue/create-bug.ts`) and refuses a record missing a
required field, naming it. Triage builds the same record for a bug the
loop files, from a session's report, in `src/triage/bug-filing.ts`
(#991), and never refuses one over its fields: a value it cannot use is
filed as `unknown` or `unknown:new-context`, and the session's own word
is kept in the body. `context/error-codes.md` is the authority for the
cause codes both carry, and `context/triage.md` for the body the loop
writes.

Triage fills what the session does not give, or cannot give, from the
dispatch and the checkout:

- **Reproduce**, when the session gives none or `unknown`: "seen while
  running task <line> of plan <stub>", or "seen while running `<the
  command>`" for a dispatch with no plan stub.
- **Cause**, by the cause rule (`src/bugs/cause-rule.ts`): a code of the
  list is kept as written; a shaped code the list lacks is
  `<family>:new-context` with the code as `proposed`, or
  `unknown:new-context` when its family is unlisted; any other text is
  `unknown:new-context` with the words as `suspected`. No cause at all
  is `unknown:new-context`.
- **Module and action**: the session's word when it is a checked name,
  else `unknown`, with the word kept in `Reported module` or
  `Reported action`.
- **Environment**: `ci` when `CI` is set, else `local`.
- **Summary, artifact, versions and rerun**: the summary from the reported
  `what`; the artifact as reported, local paths taken out and not cut to 60
  lines; versions from the artifact's file and the checkout. No error line
  is written. A rerun is written only for a test failure naming its file
  and case.

Every free text is redacted, local paths then named secrets, before it
is written. The record's sections follow the body's `Feedback`, and
`Reported module` and `Reported action` come last; the record reads no
field from them. A recurrence's comment gains the `Versions` it was
seen again on and no other field. The two bodies share their `What` and
`Artifact` sections, so either is read by the other's code.

### Three axes

- **The title**, for a person reading a list: the summary, with the
  boundary fields ahead of it.
- **The boundary**, for knowing where two pieces of work overlap:
  `project`, `module`, `action`.
- **The context**, for knowing what the error looked like and where:
  the place, the versions, the error line, the artifact and the cause.

The title never carries the matching. Two bugs with one cause in two
modules have unlike titles on purpose, and the cause code is what joins
them.

### The fields

| Field | Flag | Section | Filled by | Filled by the loop | Required |
|---|---|---|---|---|---|
| summary | `--summary` | none, the title holds it | the filer | the reported `what`, redacted, on one line, cut to `issues.titles.summaryMax` | yes, one line, at most `issues.titles.summaryMax` |
| description | `--body`, `--body-file` | `What` | the filer; the summary when left out | the reported `what`, redacted | no |
| reproduce | `--reproduce` | `Reproduce` | the filer | the session's word, else "seen while running" its task line and plan, or the command that ran | yes, never `unknown` |
| rerun | `--rerun` | `Rerun` | the filer | the test command that runs the case again, for a failure naming its file and case; none otherwise | no |
| error line | none | `Error line` | rafa, from the artifact's first line | none; the loop's record leaves it out | no |
| artifact | none | `Artifact` | the filer; rafa cuts it to 60 lines | the reported one, local paths taken out, not cut | no |
| cause | `--cause` | `Cause` | the filer, from `rafa bug codes` | the cause rule's reading: a listed code, or `<family>:new-context`, or `unknown:new-context` | yes, `<family>:new-context` allowed |
| proposed | `--proposed` | `Proposed cause` | the filer | the session's code, when shaped and no code of the list, beside a `new-context` cause | no, read only beside a `new-context` cause |
| suspected cause | none | `Suspected cause` | the filer | the session's words, when they are no code | no |
| module | `--module` | `Module` | the filer | the session's module when a checked name, else `unknown` | yes, `unknown` allowed |
| action | `--action` | `Action` | the filer | the session's action when a checked name, else `unknown` | yes, `unknown` allowed |
| reported module | none | `Reported module` | none; the command refuses instead | the session's word, when `Module` is `unknown` | no |
| reported action | none | `Reported action` | none; the command refuses instead | the session's word, when `Action` is `unknown` | no |
| project | `--project` | `Project` | the filer | none; the report names no project | no |
| place | `--env` | `Environment` | rafa suggests, the filer corrects | `ci` when `CI` is set, else `local`, not corrected | yes, `unknown` allowed |
| versions | `--path` names the file | `Versions` | rafa | the same | always written |

A flag wins over its section. A `--title` is read back through the
template: a field only the title gives is taken from it, the project
among them, and one that disagrees with a flag is refused.

Nothing a body file holds is dropped. The text ahead of its first
heading is the description when no `What` section holds one. What the
record does not read is kept as written, after the record's own
sections: that text beside a `What` section, a section that is no field
(`Expected`, `Refs`), and the second section under one heading.

A record with a problem is refused before any tracker is resolved, every
problem on a line of its own, each opening with the field it names
(`bugProblems`, `src/bugs/record.ts`).

### The body

One `## <Heading>` section per field that holds a value, in the order of
`BUG_FIELDS`. A value is written plain only when the check holds it to a
token: the cause codes, the module, the action and the place. Every free
text is fenced, so an `@name` or a `#12` inside it never pings or links
on the tracker.

`parseBugRecord` reads `##` and `###` headings, a value in a fence or as
text, and a heading inside a fence as text. A fence is three or more
backticks or tildes, indented by three spaces at most, closed by a line
of the same mark at least as long. The body is walked once, so a pasted
log of a hundred thousand lines parses in a fraction of a second.

`###` and `_No response_` are what the GitHub issue form writes
(`.github/ISSUE_TEMPLATE/bug.yml`); a test holds the form's labels to
the record's headings. The form prefills no title: GitHub files a
prefilled title as written when nobody edits it, and it would list as a
module named `module`.

### The title template

`issues.titles.bug` is one string that renders a title and reads it back
(`src/bugs/title.ts`):

- `${name}` prints a variable: `type`, `project`, `projectType`,
  `module`, `action` or `summary`.
- `?( … )` is an optional group. It prints only when every variable
  directly inside it is printable; `null`, an empty string and `unknown`
  are not. A separator goes inside its group, so a missing value takes
  its separator with it.

The default is `?(${module}?( - ${action}): )${summary}`, which renders
`loop - start: resume does not find the worktree branch`, and the summary
alone when the module is `unknown`. A monorepo adds the project:
`?([${project}] )?(${module}?( - ${action}): )${summary}`.

The issue id is never a variable. The tracker assigns it after the title
is written, and a listing prints it as a column.

A template is refused at load when it cannot be parsed, when
`${summary}` is not its last variable outside every group, and when a
title it renders does not read back as the fields it was rendered from.

One limit stays: under the default template a summary shaped
`<word>: …`, filed with no module, reads back with that word as its
module. The record check refuses such a bug, quoting the title, and asks
for the module or another wording.

### What rafa fills

- **The place** is `ci` when the `CI` variable is set to anything but
  nothing, `0` or `false`, and `local` otherwise (`src/bugs/places.ts`).
  A place names where a bug was seen; what was running belongs in the
  action and in reproduce.
- **The versions** are the rafa version, the short commit with `-dirty`
  when a tracked file has changes, and the package as `name@version`
  (`src/bugs/versions.ts`).
- **The package** is the nearest manifest above the file the error
  points at (`packageOf`, `src/project/package-of.ts`): from the file's
  directory up to the checkout's root, the first `package.json` holding a
  `name`. The `workspaces` globs are never read. The file is `--path`,
  else the first file of the checkout the artifact names
  (`src/bugs/stack-path.ts`); with none, the checkout's own package. A
  relative `--path` is read from the directory rafa runs in, and one
  outside the checkout, or naming no file, is refused.
- **The checkout** is the one the command runs in. A project's root is
  its main checkout, and a command run from a worktree resolves to it,
  so the path, the package and the commit are read from the top level
  `git` answers in the directory rafa runs in. A top level that HOLDS
  the project root is no worktree: the project is a folder of a larger
  repository, and its own root is read, never the outer repository's
  package.
- **Redaction** takes the checkout's and the project's paths, the home
  and every named secret out of each free text and so out of the title,
  after the path is read. Both roots go in one pass, the longer first
  (`localPathRedactor` takes a list): two passes leave the folders
  between the home and the project in a path under the main checkout.

### The cause on the tracker

The draft carries the cause as `IssueDraft.cause`. The `github` adapter
files it as the label `cause:<code>`, made on demand as `module:` labels
are, and refuses one whose label would pass GitHub's 50 characters. The
`local` adapter keeps it in the issue file. `rafa issue create` has no
`--label` flag. A module of `unknown` is filed under the board's
`module:unassigned`.

### Listing

`rafa issue list --type=bug` prints a header and the columns id, state,
module, action and summary, the last three read back from each title
(`renderBugList`, `src/commands/issue/list.ts`). A part a title lacks is
`-`, so a bug filed before the template lists whole under summary. Json
mode is unchanged.

### Recheck

`rafa bug recheck [<n>…] [--all] [--comment]` reruns the test a bug's
`Rerun` section names and judges whether the bug still reproduces
(`src/commands/bug/recheck.ts`). It reads `Rerun` strictly as a test
reference, `bun test <file> [-t "<case>"]`, through
`readTestReference` (`src/bugs/test-reference.ts`). Any other text is
`manual`: a `rafa` line, a shell line, a command an issue body writes,
and a bug with no `Rerun` at all. rafa prints the record's `Reproduce`
text for it and runs nothing.

The `-t` value is read as a POSIX shell reads a double-quoted string: a
backslash before a backslash, a double quote, `$` or a backtick stands
for that character, any other backslash is kept with the character
after it, and the closing quote is the first double quote not escaped
that way. So the value triage writes for a case holding a regular
expression's special character runs as the pattern a shell would hand
bun: `-t "a \\(case\\)"` runs as `a \(case\)` and matches the case
`a (case)`. A value ending in an odd backslash before its closing quote
is refused as an unterminated double quote. An unescaped `$` or backtick
inside the value is `manual`, with the reason "a shell character $
inside the -t value": a shell would expand it, so the value would not
mean what it says.

Two gates come before a run. The reference's shape and boundary: its
file is resolved against the checkout's root, by real path, so a
symlink out is outside too. Outside is `manual`; a file that is not
there is `stale`. The author's trust: read for a runnable bug only,
and never on the `local` tracker, which holds no accounts. The author
is `editable(ref)`'s, weighed once per login by `readBoardTrust`. An
untrusted author is `skipped`, with "opened by <login>, " and the
reason from `trustRefusalClause`; nothing runs for it, and the rest of
a sweep still runs.

The argv is built by rafa and given to `runSuite` with no shell: the
file as `./<path>`, the case as its own word after `-t`. The child's
environment is `suiteEnv(process.env)` with every variable
`namedSecrets` names removed, and the report lists the names it left
out. A run passing its deadline is a failed run, and the report says
it timed out.

A run is judged by its JUnit cases of the file. A failed case, or a
timed-out run, is `reproduces` when it is the first run. A first run
that passes, then `runs` further runs, gives `gone` when every one of
them passes and `flaky` when one fails: `flaky` is a judgement of its
own, never "probably fixed". `stale` is a run that left no report, ran
no test of the file, or named a case the file does not hold. The six
verdicts are `reproduces`, `gone`, `flaky`, `stale`, `manual` and
`skipped`.

Runs go in the directory rafa runs in, so a machine-dependent test can
read `gone` here and fail elsewhere. The report names where it ran, and
`--comment` names the rafa version and the short commit, with
`-dirty` when the checkout has changes.

`--comment` writes only on `gone` and `flaky`, one line through the
record's redaction, and never closes a bug. A `gone` comment reads
"gone at rafa <version>, `<commit>`: `<reference>` passed <n> runs";
a `flaky` one reads "flaky at rafa ..." with the failed count. A
degraded issue chain (`resolveIssueTracker`) exits 1 before any issue
is read.

Exit code 0 with one row per bug as the terminal result's data,
whatever the verdicts. Exit code 1 for a refused line, a config the
reader refuses, a degraded chain and a listing that failed. The
command starts no Claude session.

With no `bugs` section, the defaults hold: 5 further runs after a pass,
300 seconds a run. A set section looks like this:

```yaml
bugs:
  recheck:
    runs: 10              # 1..20, default 5: further runs after a pass
    timeoutSeconds: 600   # 1..3600, default 300: one run's deadline
```

Both keys refuse `0`, a fraction, a quoted number and a boolean, and
neither has an "off" spelling. The reader is `src/config-schema-bugs.ts`.

### `--dry-run`

`rafa issue create --dry-run`, for any type, makes the draft, prints its
title, a line with the type, module, priority and cause, then the body,
and stops: no tracker is resolved and nothing is filed.

### Config

`src/config-schema-issues.ts` reads five keys:

```yaml
issues:
  titles:
    bug: "?(${module}?( - ${action}): )${summary}"
    summaryMax: 80        # 20..120
  environments: []        # places beside local, ci and prod: [staging]
  vocabulary:
    modules: []           # empty accepts any name of the shape
    actions: []
```

A vocabulary that is set refuses a name outside it and shows the closest
ones, so one module is never filed under three spellings. `titles` holds
one template, since a bug is the only type whose title rafa renders.
