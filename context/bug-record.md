## The bug record

Every bug filed through `rafa issue create --type=bug` has the same
fields under the same headings, and a title rendered from them (#951).
`src/bugs/` holds the record, `src/commands/issue/create-bug.ts` reads a
line into it, and `context/error-codes.md` is the authority for the cause
codes it carries.

The loop's own filing (`context/triage.md`) does not build the record
yet: triage titles a bug with its `what` and files it under module
`unassigned`, until the loop-side spec (#991) lands. The two bodies
already share their `What` and `Artifact` sections, so either is read by
the other's code.

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

| Field | Flag | Section | Filled by | Required |
|---|---|---|---|---|
| summary | `--summary` | none, the title holds it | the filer | yes, one line, at most `issues.titles.summaryMax` |
| description | `--body`, `--body-file` | `What` | the filer; the summary when left out | no |
| reproduce | `--reproduce` | `Reproduce` | the filer | yes, never `unknown` |
| rerun | `--rerun` | `Rerun` | the filer | no |
| error line | none | `Error line` | rafa, from the artifact's first line | no |
| artifact | none | `Artifact` | the filer; rafa cuts it to 60 lines | no |
| cause | `--cause` | `Cause` | the filer, from `rafa bug codes` | yes, `<family>:new-context` allowed |
| proposed | `--proposed` | `Proposed cause` | the filer | no, read only beside a `new-context` cause |
| suspected cause | none | `Suspected cause` | the filer | no |
| module | `--module` | `Module` | the filer | yes, `unknown` allowed |
| action | `--action` | `Action` | the filer | yes, `unknown` allowed |
| project | `--project` | `Project` | the filer | no |
| place | `--env` | `Environment` | rafa suggests, the filer corrects | yes, `unknown` allowed |
| versions | `--path` names the file | `Versions` | rafa | always written |

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
