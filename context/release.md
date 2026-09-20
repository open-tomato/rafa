## Release

Versioning and changelog automation at wrap-up instead of by hand-written
task. Spec is `.specs/rafa-21-changelog-and-release.md`; this page holds the
structure and the flow. Where the two differ, the spec wins.

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

Order inside the wrap-up, after merging with `origin/main` so the base
version is the one on `main` at that moment:

**Step 1** (Loop, code): Read the base version from `release.versionFile`
on `origin/main`, compute the next version by the release level
(semver bump), write the new version to the version file **byte-safely**
(critical: `package.json` ends without a newline, `src/release/version.ts`),
and insert a changelog heading `release.heading` (default `## {version} — {date}, {title}`)
at the top of `release.changelog`, with the plan's raw change notes grouped by area beneath it.
Implemented in `src/release/prepare.ts`, `prepareRelease`, over the four
readings beside it (`enabled.ts`, `level.ts`, `version.ts`, `changelog.ts`).
The heading goes to one of three places, which `ChangelogInsertPoint` names:
`before-next-heading` (the usual one — after the file's first heading and
its preamble), `file-end` when that first heading was the file's only one,
and `file-top` when the file held no ATX heading at all.

**Step 2** (Wrap-up session, agent): Rewrite the raw lines under that heading
into one line per area, touching nothing else in the file. The wrap-up prompt
receives the raw notes as bullets below the first line so the classifier key
does not move. The bullets are built in `src/start/wrap-up.ts`,
`buildWrapUpPrompt`, never in a prompt file.

**Step 3** (Loop, code): Verify the heading and version are still there and
match, that no other section changed, and that the version file still parses.
On failure, restore step 1's text and report the failure in the PR body.
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

Level `none` skips all three steps and reports it in the PR body — or on
the terminal alone, by the line above, when the provider resolves to
`none`.

A planted edit outside the new section is caught by step 3's check and
refused, restored, and reported.

### Two release actions

**`rafa release status`** — Read-only. Prints four lines:
- The version `release.versionFile` declares now
- The latest release tag by semantic version precedence
- Untagged versions `release.changelog` marks as released (ones that carry a
  changelog section but no `v<version>` tag)
- Change notes pending for the current plan (the raw entries `readPlanChanges`
  would render into the next changelog)

Exits 0. Never writes.

**`rafa release tag`** — Puts `v<version>` on the release branch's HEAD when
the version file says so and the tag is absent. The release branch is
`pr.base`, falling back to `DEFAULT_RELEASE_BRANCH` (`main`) when the project
declares none — there is no `release.branch` setting, because `pr.base`
already carries that fact. Refuses when the tag exists, when the tree is not
on that branch, or when the version file's version is not the one the
changelog's newest section names. Prints the push and publish lines but runs
neither. There is no `release.registry` setting either: the registry comes
from the version file's own `publishConfig.registry`, defaulting to
`https://registry.npmjs.org`, and the manager from `packageManager`. Exits 0
on success, 2 on refusal.

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
