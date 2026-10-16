/**
 * The three `release` commands as declarations: each command less its
 * `run`, with the subject they sit under and the flags their help spells.
 *
 * ## Why the declarations sit apart from the commands
 *
 * A declaration is every field routing, help, `describe` and the spend
 * guard read (`CommandDeclaration`, `@open-tomato/rafa/core/command`).
 * `createReleaseStatusCommand`, `createReleaseSettleCommand` and
 * `createReleaseTagCommand` each spread their declaration under their
 * own `run`, so the command a module exports carries the fields declared
 * here, and `RELEASE_FEATURE` (`./index.ts`) can name, route and render
 * the three without loading any of them. None starts a session, so none
 * declares `spends`.
 *
 * ## What this file imports
 *
 * Types alone, from `@open-tomato/rafa/core/command`, and no module
 * under `src/`: a value import of a command's helper would load it with
 * the roster and undo the laziness. So the flags a declaration spells
 * and a module also reads live here, and the modules import them from
 * here: `RELEASE_STATUS_PLAN_FLAG` (`status.ts`),
 * `RELEASE_SETTLE_DRY_RUN_FLAG` (`settle.ts`) and `RELEASE_TAG_PUSH_FLAG`
 * (`tag.ts`).
 */
import type { CommandDeclaration, SubjectSpec } from '@open-tomato/rafa/core/command';

/** The `release` subject: its routing word and its roster line. */
export const RELEASE_SUBJECT: SubjectSpec = Object.freeze({
  name: 'release',
  summary: 'read the release state of the project; settle the waiting fragments into a version; tag the commit that set it',
});

/** The flag of `release status` naming the plan whose pending change notes are read. */
export const RELEASE_STATUS_PLAN_FLAG = 'plan';

/** The flag of `release settle` that reads without writing. */
export const RELEASE_SETTLE_DRY_RUN_FLAG = 'dry-run';

/** The flag of `release tag` that pushes the tag once it is written; see `tag.ts`'s module note. */
export const RELEASE_TAG_PUSH_FLAG = 'push';

/** `rafa release status [--plan=<stub>]`: see `status.ts` for what it reads. */
export const RELEASE_STATUS_DECLARATION: CommandDeclaration = Object.freeze<CommandDeclaration>({
  name: 'release status',
  subject: 'release',
  action: 'status',
  summary: 'show the version, the latest tag, the untagged releases, the pending notes, the waiting fragments'
    + ' and the open stale-docs lines',
  description: 'Reads eight things about the release state of the project and writes nothing: the version'
    + ' `release.versionFile` declares, the latest release tag of the repository by semantic version'
    + ' precedence, the versions `release.changelog` calls released that carry no tag, the change notes'
    + ' the current plan\'s sessions have stored for its next release, and the change fragments waiting on'
    + ' `origin/<pr.base>` as last fetched, with the release `rafa release settle` would fold them into,'
    + ' and an audit of the changelog\'s released history: a version two headings name, a gap between'
    + ' versions, dates out of order, and a heading newer than the releases made before settle with no tag,'
    + ' and how many lines the open stale-docs issues of the tracker the chain lands on hold unticked,'
    + ' `none` when they hold none. That count is the one reading that can reach the network, and it never'
    + ' changes the exit code.'
    + ' The current plan is the one'
    + ' `--plan=<stub>` names, and otherwise the one the checked-out branch\'s `<type>/<stub>` names,'
    + ' resolved against the plans in `plan.dir`. A reading that could not be made leaves its cell as `?`'
    + ' and says why on a line under the block rather than refusing the others. With `--output=json`'
    + ' the eight readings and the rendered block are the data of the terminal result event.',
  args: [],
  flags: [
    {
      name: RELEASE_STATUS_PLAN_FLAG,
      description: 'the plan stub the pending change notes are read for, instead of the branch\'s',
      type: 'string',
    },
  ],
  examples: [
    {
      cmd: 'rafa release status',
      note: 'Shows the version, the latest tag, the untagged releases and the notes pending for this branch\'s plan.',
    },
    {
      cmd: 'rafa release status --plan=rafa-21-changelog-and-release',
      note: 'Reads the pending change notes for that plan rather than the one the branch names.',
    },
  ],
  outputs: ['text', 'json'],
});

/** `rafa release settle [--dry-run]`: see `settle.ts` for what it folds and delivers. */
export const RELEASE_SETTLE_DECLARATION: CommandDeclaration = Object.freeze<CommandDeclaration>({
  name: 'release settle',
  subject: 'release',
  action: 'settle',
  summary: 'fold the fragments waiting on the base branch into one version and changelog section',
  description: 'Fetches `origin/<pr.base>` (or `origin/main`) and works in a scratch worktree of it, so the'
    + ' checkout it runs from is never touched. It lists the fragments under `release.fragments` in the order'
    + ' the base received them, folds them through `release.strategy` into the next version and one'
    + ' changelog section, writes both (creating `release.changelog` under `# Changelog` when the base lacks it), deletes the folded fragments and commits `chore: release <version>`.'
    + ' With `release.moveLock: true` the same commit writes `rafa.lock` at the root to the new version,'
    + ' creating it when the base holds none, and the settle is refused, writing nothing, when the lock'
    + ' does not read or the version file names a package other than rafa.'
    + ' With `release.settle: push` (the default) the commit is pushed to the base, never forced; a refused'
    + ' push fetches again and ends as settled when another run released the same fragments, or rebuilds'
    + ' and pushes once more. With `release.settle: pr` it goes to `rafa/release` and one pending release'
    + ' pull request is opened or updated. `release.tag: settle` tags a pushed release. It prints the'
    + ' strategy, the base version, the fragments in order and the new version, and exits 0 when the'
    + ' release is delivered or nothing waits, 1 otherwise. With `--dry-run` it prints the same reading'
    + ' and writes nothing. With `--output=json` a run exiting 0 gives the reading and what was delivered'
    + ' as the data of the terminal result event. Starts no session.',
  args: [],
  flags: [
    {
      name: RELEASE_SETTLE_DRY_RUN_FLAG,
      description: 'Print the fragments, their order, the strategy and the version, and write nothing:'
        + ' no commit, no push, no tag.',
      type: 'boolean',
    },
  ],
  examples: [
    {
      cmd: 'rafa release settle',
      note: 'Folds the waiting fragments into a release commit and delivers it by `release.settle`.',
    },
    {
      cmd: 'rafa release settle --dry-run',
      note: 'Prints what a settle would fold and the version it would write, writing nothing.',
    },
    {
      cmd: 'rafa release settle --output=json',
      note: 'Settles and gives the reading and the delivery as a result event.',
    },
  ],
  outputs: ['text', 'json'],
});

/** `rafa release tag [--push]`: see `tag.ts` for what it reads, tags and pushes. */
export const RELEASE_TAG_DECLARATION: CommandDeclaration = Object.freeze<CommandDeclaration>({
  name: 'release tag',
  subject: 'release',
  action: 'tag',
  summary: 'tag the commit that set the version both release files agree on',
  description: 'Writes `v<version>` on the release branch — `pr.base`, or `main` — when the'
    + ' version `release.versionFile` declares is the one the newest section of `release.changelog` names.'
    + ' The tag goes on the commit that set that version: HEAD, or, where later commits landed on the branch,'
    + ' the earlier commit, with a warning naming how many commits HEAD is past it.'
    + ' It refuses, and writes nothing, when another branch is checked out, when a tag already names that'
    + ' version, when the two files disagree, when the changelog section of that version carries no'
    + ' `<!-- rafa:fragments -->` receipt and is above the newest version released before settle,'
    + ' when no commit holds the version yet, and when the version'
    + ' file, the tag list or the history could not be read. After the tag it prints what to run next: the'
    + ' push that puts the tag on the remote, and the publish line for the registry the version file'
    + ' configures, with the command `release.publishCommand` names (`npm publish` by default),'
    + ' spelled to publish from the tag when HEAD is past it, which it does not run. With `--push` it'
    + ' pushes the tag itself to the remote the release branch tracks (`origin` when it tracks none) and'
    + ' drops the push line; a push that fails exits 1 with what git said and keeps the local tag. With'
    + ' `--output=json` the readings, the decision, the follow-ups and the push are the data of the terminal'
    + ' result event.',
  args: [],
  flags: [
    {
      name: RELEASE_TAG_PUSH_FLAG,
      description: 'Push the tag to the remote the release branch tracks once it is written; a push that'
        + ' fails exits 1 and keeps the local tag.',
      type: 'boolean',
    },
  ],
  examples: [
    {
      cmd: 'rafa release tag',
      note: 'Tags the merged release and prints the push and publish lines to run next.',
    },
    {
      cmd: 'rafa release tag --push',
      note: 'Tags the merged release, pushes the tag, and prints the publish line to run next.',
    },
    {
      cmd: 'rafa release tag --output=json',
      note: 'Writes the same tag and gives the readings, the decision and the follow-ups as a result event.',
    },
  ],
  outputs: ['text', 'json'],
});
