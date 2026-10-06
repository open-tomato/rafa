## Release

Fragments on the branch carry the intent (release level and notes); the base
branch owns the version number, assigned by `rafa release settle` after merges.
A branch no longer stamps a version: instead, its wrap-up commits a small file
under `release.fragments` (default `.changes/`), and the pull request shows a
forecast of what version the branch would get if merged now.

### Fragments: the branch carries intent

A fragment is one file per plan, named `<plan id>.md` (or `-2`, `-3` if a
fragment of that name already waits on `origin/<pr.base>`). Each fragment holds
a front-matter block with three lines and notes below:

```yaml
plan: rafa-247
title: One line, the plan title
level: patch | minor | major | none
```

Below the front matter, the notes are one line per area (`- area: summary`),
the same as the wrapped changelog lines the session writes today. Level `none`
is written explicitly, not skipped, so a missing fragment and "no release" stay
two readable states. A shipping level whose notes all came out empty carries the
plan title as its one note, reported as a problem in the wrap-up.

The fragment is written by step 1 of the wrap-up (the loop), never by the
session. Verify step 3 checks that the fragment is the only file the release
step changed (git status over the version file, changelog and fragments folder),
and the commit is `chore: release fragment <plan id>`. The wrap-up never edits
the version file or the changelog. `src/release/fragment.ts` holds the format,
parser, and the name allocation logic (`src/release/fragment-tree.ts` reads
the base branch's fragments after a `git fetch` to pick the right name).

### The fold: one strategy, pure function

The fold is a single function shape, `fold(currentVersion, fragments) →
{ version, section } | null`, that turns a list of ordered fragments into one
version and one changelog section. It's called in three places: the forecast
(in the PR body), the preflight check (before merge), and settle (on the base
branch). All three get the same answer because the fold's inputs are committed
data only: the base branch's current version and the ordered fragments. It reads
no network, label, or clock.

Fragment order is first-parent commit order: the commit that ADDED each fragment
to the base branch, read from git. First add wins if a fragment name appears
twice (it should not).

The strategy is a pluggable adapter. `release.strategy` names it; the default is
`semver-by-level`: the highest level in the batch wins, so two minors make one
minor bump, not two. The fold returns null when no fragments are present or only
`level: none` fragments remain (nothing ships). A strategy that throws makes
settle write nothing and print one line naming it and the error.

Every dry run, forecast, and settle command names the strategy it used and the
version it computed (or "nothing to settle" when the fold returns null). This
makes the strategy pluggable for future additions (like `custom:<path>` or
calendar-based versioning) while keeping the default simple.

### Settle and its deliveries

`rafa release settle [--dry-run]` builds its commit in a scratch worktree of
`origin/<pr.base>`, reading the fragments from that tree, ordering them by
first-parent commit, folding them to a version and section, then delivering by
one of two methods:

**Push delivery** (default): Settle writes the version and section on the base
branch, deletes the fragments it folded, commits `chore: release <version>` and
pushes. If the push is refused, settle fetches again. If the fragments it folded
are gone (another machine settled them), it stops with exit 0. If new fragments
arrived, it recomputes and retries once, then stops with exit 1 if that retry
is refused.

A refusal no retry can change stops at once with exit 1 and the release not
delivered. A protected branch (GitHub's `GH006`) is answered `protected`, and a
repository rule (GitHub's `GH013`, a ruleset requiring a status check or a
review) is answered `rule`, in one line naming the rule GitHub gave, such as
`Required status check "verify" is expected.`, and
`set release.settle: pr in .rafa/config.yaml`. No refusal prints a success line:
`git push --porcelain` ends its output on `Done` even when it refuses, and settle
drops that line from what it quotes (#765).

**PR delivery** (`release.settle: pr`): Settle pushes the commit to the `rafa/release`
branch and opens or updates one pending release pull request. Closing that PR
undoes the release before it lands. This is the delivery method for a protected
base branch that requires review.

`--dry-run` prints the fragments, their order, the strategy, and the version
that would settle, and writes nothing to the tree or remote.

A base with no `release.changelog` doesn't stop a settle (#842): the release
commit creates the file holding `# Changelog` and the settled section
(`buildSettle`, `src/release/settle.ts`), and settle prints
`Changelog: <path> is missing, so the release commit creates it under "# Changelog".`
above its delivery line. A delivery that refused prints no such line. The dry
run reads the base's tree, not the checkout, and prints the same line. Only an
absent file is created. A changelog that exists and can't be read, or a
directory that refuses the new file, still stops the settle with exit 1. The
parent directory isn't made, so a `release.changelog` under a directory the
base lacks stops it too.

The readers follow the same line. `rafa doctor`'s release row and
`rafa release status` (its `untagged` and `audit` cells) read an absent
changelog as `missing; rafa release settle creates it`, with no problem line
and their forecasts unchanged; a changelog that exists and can't be read still
reads as "could not be read". `rafa release tag` still refuses on a missing
changelog, since a tag names a version a section already holds.

The caller is unspecified and all are equivalent: a person running the command,
a CI job after each merge, a post-merge hook, or `rafa next` (which runs settle
after its merge step). `rafa pr merge` does not call settle itself; instead, it
prints the settle command as its last line when fragments wait.

### Receipt rule and adoption boundary

The changelog section written by settle carries a comment naming the fragments
it folded:

```markdown
<!-- rafa:fragments rafa-247 rafa-234 -->
```

This comment is the release's receipt. `rafa release tag` refuses to tag a
version whose section carries no receipt, with one exception: the adoption
boundary. The boundary is the version of the newest changelog section below the
oldest receipted one. When a project adopts settle after existing releases, all
versions at or below the boundary are accepted as "released before settle
existed"; versions above it must carry a receipt. This keeps old releases from
needing retrofitted fragments and makes every pre-settle section acceptable.

`src/release/receipt.ts` computes the boundary by reading the changelog;
`src/release/audit.ts` in `rafa release status` audits the changelog and names
any heading with no tag above the adoption boundary.

The `{title}` in `release.heading` renders the batch's plan titles in fold order
joined by `; `, and `{date}` is the UTC date of the newest folded fragment's add
commit (the commit that ADDED it to the base branch), never the clock. This keeps
settle deterministic across machines and retries.

### Tag and its push

`rafa release tag [--push]` writes `v<version>` on the commit of the release
branch that set the version, then prints what to run next: the push of the tag
and the publish line. Without `--push` it reaches no network and the push is a
line to copy.

With `--push` (#736) it pushes `refs/tags/v<version>` itself once the tag is
written (`pushTag`, `src/release/tag-push.ts`), never forced, to the remote the
release branch tracks (`branch.<pr.base>.remote`), or `origin` when the branch
tracks none or tracks a local branch. A push that went prints
`✅ Pushed v<version> to <remote>.` and drops the push line from the follow-ups;
json mode carries it as the result's `pushed`, a key a run without the flag
leaves out. A push that fails, a hook or rule refusing it included, exits 1 with
git's words and the push to run again, and keeps the local tag, since it names
the right commit whether or not the remote has it.

### Guards: the preflight check

A preflight item in `rafa pr merge` (read also by `rafa pr triage`) runs the fold
as a dry run over the base branch's current version and the fragments waiting
there (the state at the time the branch was last pulled). It answers one of four
classes:

- **`clean`**: A fragment is present and the branch changes neither the version
  file nor the changelog.
- **`missing`**: The branch changes source files and carries no fragment.
- **`stale`**: The branch stamped a version the base branch has passed.
- **`collision`**: The branch's version is already on the base branch with
  different notes.

`stale` and `collision` name both sides (the branch, its pull request, the base
entry and its commit) and end with the fix command (`rafa pr triage --resolve`).
`collision` always refuses; `missing` and `stale` react according to
`pr.versionCollision` (default `report`). Overriding a `collision` takes
`dangerous.acceptVersionCollision`. Triage assigns the class `conflict-version`
to all three failures, and its existing `--resolve` owns the fix: turn a stamped
changelog section into a fragment and restore the version file to the base
branch's value, in one commit on the branch.

Settle's own release pull request is not a failure (#843). A head of
`rafa/release` (`RELEASE_PR_BRANCH`, `src/release/settle-pr.ts`) whose stamp
the base has neither released nor passed is the delivery
(`src/release/release-delivery.ts`): `rafa pr merge` prints one line,
`Release: #<n> is settle's release pull request; merging it lands <version>`,
in place of the `stale` line, the forecast's no-fragment line and the `fix:`
line, and merges whatever `pr.versionCollision` says; `rafa pr triage` gives it
no `conflict-version` class. A `rafa/release` head the base has passed, already
released or collides with reads as any branch does, fix included, and an
ordinary branch stamping a version still reads `stale`.

### Readers: status, list, and doctor

**`rafa release status`** reads the base branch (fetching nothing, reading as
last fetched) and prints:

- The version `release.versionFile` declares now
- The latest release tag by semantic version precedence
- Untagged versions marked in `release.changelog` (a changelog section with no
  matching `v<version>` tag)
- The fragments waiting on the base branch, one line each in fold order with
  level, add date and title, and the release that settle would produce from
  them (or an error if a fragment does not parse)
- An audit of released history: versions two headings name, gaps (a version not
  the next patch/minor/major bump from the one below it), dates out of order,
  and headings with no tag above the adoption boundary

Exits 0. Never writes. Implemented in `src/commands/release/status.ts`.

**`rafa pr list`** shows each open pull request's forecast (the version and
section that settle would produce if the branch merged now), marked as forecast,
and marks it `(base moved)` when the base branch has changed version or waiting
fragment IDs since the forecast in the PR body was written.

**`rafa doctor`** prints one row for the release status: the base version, the
latest tag, the top heading in the changelog, and the waiting fragments on the
base branch. It warns when fragments wait and names `rafa release settle`.

### Config keys

Seven keys control the release flow, all under the `release` section except two:

**`release.fragments`** — Path to the fragments directory (default `.changes/`).
Tracked, not gitignored. Fragment filenames are `<plan id>.md`, or `-2`, `-3`
when a name conflicts with a fragment waiting on the base branch.

**`release.strategy`** — The strategy adapter name (`semver-by-level` is the
default and the only value in this spec). Passed to the fold; read at forecast,
preflight, and settle time. One change at a time; a new strategy value takes
effect the next settle.

**`release.settle`** — Delivery method: `push` (default, push to the base
branch) or `pr` (open or update one pending release pull request on
`rafa/release`). Read by `rafa release settle` and `rafa next`.

**`release.tag`** — Who tags the version: `manual` (default, tag by hand with
`rafa release tag`, which pushes the tag with `--push`) or `settle` (settle tags the commit it pushed). Read by
`rafa release settle` and `rafa release tag`. Under `release.settle: pr`, the
tag waits for `rafa release tag` after that pull request merges.

**`release.publishCommand`** — The command `rafa release tag` prints for the
publish, default `npm publish`. Free text, printed as written and never run, so
a project that publishes with another tool or a flag (`pnpm publish --tag
next`) spells it here. When HEAD is past the tagged commit the line becomes
`git switch --detach <tag> && <publishCommand> && git switch <branch>`, so the
tagged tree is the one published. The manifest's `packageManager` field is not
read for it: that field names the tool a project installs with, and tagging
0.24.1 printed `bun publish` from it while rafa is published with `npm publish`.

**`pr.versionCollision`** — Reaction to `missing` and `stale` preflight
findings: `report` (default, warn and proceed), `ask` (ask the user), `refuse`
(error and stop). `collision` always refuses, requiring
`dangerous.acceptVersionCollision` to override.

**`dangerous.acceptVersionCollision`** — Boolean (default `false`). Set `true`
to override a `collision` finding and allow a merge. Use only when you have
merged a branch already stamped with the same version and need to unblock
another.

All keys are optional. An absent `release.fragments` defaults to `.changes/`, an
absent `release.strategy` defaults to `semver-by-level`, an absent
`release.settle` defaults to `push`, an absent `release.tag` defaults to
`manual`, and an absent `release.publishCommand` defaults to `npm publish`.
They're set by `rafa init` and read by `loadConfig`.
