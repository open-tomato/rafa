## Release

Versioning and changelog automation at wrap-up instead of by hand-written
task. A specs directory holds the specification for changelog and release;
this page holds the structure and the flow. Where the two differ, the spec
wins.

### Change-note path from report to table

A task's `rafa:report` block carries an optional `changes` list:

```yaml
changes:
  - level: patch | minor | major | none
    area: "loop"                 # optional, groups lines in the entry
    summary: "loop pause now waits for the running task's commit"
```

The loop writes each entry to the SQLite `changes` table with columns:
`id`, `session_id`, `plan_stub`, `task_line`, `level`, `area`, `summary`,
`collected_at` (ISO 8601 timestamp). `readPlanChanges` retrieves every note
under one plan stub, oldest first (by append order `seq`, not by timestamp),
and a release step renders the changelog entry from them. It matches
`plan_stub` with `IS`, so the null stub is a queryable group of its own —
the notes of sessions that resolved NO plan. A caller meaning "there is no
current plan" therefore skips the read rather than passing null.

An entry with no `level` or no `summary` is refused before it reaches the
table; `area` may be null. Within one session, duplicates by all stored
fields are skipped, keeping the first. The table is SQLite-only (`changes.ts`,
`sqlite.test.ts`), and both NDJSON and SQLite backends defer to it for
this purpose.

### Release level

A plan's release level comes from three sources, in order:

1. **Plan declaration** — `release: patch | minor | major | none` in
   `rafa:plan`, if present.
2. **Notes** — The highest level among the plan's stored change notes,
   ranked `none` < `patch` < `minor` < `major`.
3. **Default** — `none`, when the plan declares nothing and stored no note.

Levels are ranked in `src/release/level.ts`, `RELEASE_LEVEL_RANK`. The
plan's declaration wins outright; if it says `patch`, that is what the
release is, whatever notes claim. `readReleaseLevelReading` computes the
level and its source, and answers `notesLevel` for a caller that needs to
report both.

### Three wrap-up steps with restore

Order inside the wrap-up, step 1 running before the wrap-up session is
spawned:

**Step 1** (Loop, code): Write the plan's change fragment under
`release.fragments` (default `.changes/`) and never touch
`release.versionFile` or `release.changelog`: no branch owns a version
number, and versions and changelog sections are written on the base
branch, never by a branch's wrap-up. The fragment is `src/release/fragment.ts`'s format: `plan` is
the plan id (the plan stub), `title` the plan's title on one line, `level`
the release level below, and the notes are the plan's raw change notes as
`- <area>: <summary>` lines grouped by area. A `none` level is written, not
skipped, so a missing fragment and "no release" stay two readings. A
shipping level whose notes all came out empty carries the plan title as its
one note, reported as a problem, since the format refuses a bare `patch`,
`minor` or `major`. The file name is `<plan id>.md`, or `-2`, `-3` when a
fragment of that name still waits on `origin/main`, read after a
`git fetch` of it (`src/release/fragment-tree.ts`), so a second wrap-up of
one branch rewrites its own fragment. A failed fetch is reported and the
step goes on; a base tree that cannot be read at all writes nothing.
Implemented in `src/release/prepare.ts`, `prepareRelease`, over
`enabled.ts`, `level.ts`, `fragment.ts` and `fragment-tree.ts`.

`src/release/changelog.ts` still renders `release.heading` and finds where
a section goes; step 1 no longer calls either. The heading goes to one of
three places, which `ChangelogInsertPoint` names:
`before-next-heading` (the usual one — after the file's first heading and
its preamble), `file-end` when that first heading was the file's only one,
and `file-top` when the file held no ATX heading at all.

**Step 2** (Wrap-up session, agent): Rewrite the raw notes inside the
plan's fragment, below its front matter, into one line per area, touching
nothing else: not the fences, not the `plan`, `title` or `level` lines, and
not the trailing newline. The prompt names the fragment's path, plan id and
level, tells the session to leave the fragment unstaged for the loop's
`chore: release fragment <plan id>` commit and to keep off the version file,
the changelog and every other fragment, and asks for the fragment's level
and notes in the PR body with no version number. A skipped step 1 gets one
bullet instead, carrying its sentence verbatim. The release bullets sit below
the first line so the classifier key does not move. They are built in
`src/start/wrap-up.ts`, `buildWrapUpPrompt`, never in a prompt file.

**Step 3** (Loop, code): Verify the fragment still parses (`parseFragment`,
the reader settle folds with), still names the plan id and carries the
plan's level, and is the only file the release step changed: `git status`
over `release.versionFile`, `release.changelog` and `release.fragments`,
index and working tree against `HEAD`, untracked files listed one by one,
may name no path but the fragment's. The session's other work is not read,
and a change it committed (a merge from the base) is not a working-tree
change. On failure, restore step 1's fragment text — never the other files,
which step 1 did not write and which are named in the sentence instead —
and report the failure in the PR body.
Commit `chore: release <version>` over the two release files alone — never
`git add -A`, which would sweep the session's other leftovers under that
subject. The PR body gains the entry. The verification is
`src/release/verify.ts`, `verifyRelease`; the commit, the push and the
`editBody` that writes a failure sentence into the pull request body are
`src/start/release-stage.ts`, which `src/start.ts` calls from its wrap-up
branch.

Whether that sentence reaches a body at all is a reading, not an
assumption: `resolvePrProvider` (`src/pr/provider.ts`) is asked before any
provider is built, and `src/start.ts` passes it the run's own
`pr.provider`. A repository that resolves to `none` has no pull request to
write to, so the stage builds no provider, spawns no `gh`, and prints one
line naming the sentence that went unwritten and the reading that kept it
off the board.

Level `none` no longer skips: step 1 writes a `none` fragment. Step 1
skips when the release is off, the plan id cannot name a file, the base
branch's fragments cannot be read or the fragment cannot be written, and
reports that in the PR body — or on the terminal alone, by the line above,
when the provider resolves to `none`.

A planted edit outside the fragment — to the version file, the changelog
or another fragment — is caught by step 3's check and refused, the
fragment restored, and reported.

### Two release actions

**`rafa release status`** — Read-only. Prints four lines:
- The version `release.versionFile` declares now
- The latest release tag by semantic version precedence
- Untagged versions `release.changelog` marks as released (ones that carry a
  changelog section but no `v<version>` tag)
- Change notes pending for the current plan (the raw entries `readPlanChanges`
  would render into the next changelog)

Exits 0. Never writes.

**`rafa release tag`** — Puts `v<version>` on the commit of the release
branch that SET that version, when the version file says so and the tag is
absent. The release branch is `pr.base`, falling back to
`DEFAULT_RELEASE_BRANCH` (`main`) when the project declares none — there is
no `release.branch` setting, because `pr.base` already carries that fact.
Refuses when the tag exists, when the tree is not on that branch, when the
version file's version is not the one the changelog's newest section names,
and when no commit holds that version yet. Prints the push and publish lines
but runs neither. There is no `release.registry` setting either: the registry
comes from the version file's own `publishConfig.registry`, defaulting to
`https://registry.npmjs.org`, and the manager from `packageManager`. Exits 0
on success, 1 on refusal.

**The tag names the commit that set the version, which need not be HEAD.**
Merges can land on the base between the release and the tag: on 2026-09-28
0.24.0 was published from 7db04a2, three merges followed, and a tag on HEAD
named ffe501a, a tree the package is not.
`src/commands/release/release-commit.ts` walks
`git log --first-parent -- <versionFile>` newest first while the file still
declares the version; the oldest commit of that run set it, a merge
commit counting as the commit that brought the bump. When HEAD is past it the
run tags it anyway, warns how many first-parent commits HEAD is past, and
spells the publish line as `git switch --detach <tag> && <manager> publish &&
git switch <branch>`, because a publish from HEAD would ship the later commits
under the older version. The registry's `gitHead` is not read: that is a
network call, and it can name a branch commit the base never holds (0.22.0's
is d53c168, squash-merged as df0f61a).

**Reading a version back out of a heading is a semver scan, not a template
match.** `release.heading` is free text whose `{version}`, `{date}` and
`{title}` a project may reorder or drop, so nothing can un-render it. Both
actions instead scan every ATX heading outside a fenced code block and take
the first token that parses as a semantic version.

`versionTag` is spelled once, in `src/commands/pr/merge-followups.ts`, and
`release tag` imports it from there, so the tag `pr merge` predicts and the
tag this command writes are one string that cannot drift.

### Config

```yaml
release:
  enabled: auto            # auto, true, false
  versionFile: package.json
  changelog: CHANGELOG.md
  heading: "## {version} — {date}, {title}"
```

- **`release.enabled`** — `auto` (on when both files exist), `true`, or
  `false`. `rafa init` asks once.
- **`release.versionFile`** — Path to the version file (typically `package.json`
  or `Cargo.toml`). Byte-safe write. If absent, the changelog gets no version
  heading, only a date heading.
- **`release.changelog`** — Path to the changelog file.
- **`release.heading`** — Template for the top-level heading. Tokens:
  `{version}`, `{date}`, `{title}` (the plan title). Where the loop inserts
  it is `ChangelogInsertPoint`'s three cases, above.

Configured in `src/release/setting.ts` (the `enabled` line only, set by
`rafa init`); read by `loadConfig`. A project with no version file gets the
changelog entry under a date heading and no bump.
