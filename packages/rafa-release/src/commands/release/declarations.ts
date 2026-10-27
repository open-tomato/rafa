/**
 * The seven `release` commands as declarations: each command less its
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
  summary: 'read the release state of the project; settle the waiting fragments into a version; tag the commit that set it;'
    + ' publish the tagged units; list and write the ladder\'s workflows; write a fragment for a branch with no wrap-up',
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
    + ' the workspace packages that are not `private`, each with the version its manifest declares, the'
    + ' fragments waiting for it and its newest `<name>@<version>` tag,'
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
    + ' version `release.versionFile` declares is the one the newest section of `release.changelog` names,'
    + ' and `<name>@<version>` for each workspace package that is not private when the version'
    + ' `<dir>/package.json` declares is the one the newest section of `<dir>/CHANGELOG.md` names.'
    + ' Each tag goes on the commit that set its version: HEAD, or, where later commits landed on the'
    + ' branch, the earlier commit, with a warning naming how many commits HEAD is past it.'
    + ' A unit whose version a tag already names is skipped. Every unit is decided before the first tag'
    + ' is written, and the run writes nothing when another branch is checked out, when every unit is'
    + ' skipped, or when any unit\'s two files disagree, its version\'s changelog section carries no'
    + ' `<!-- rafa:fragments -->` receipt and is above the newest version released before settle,'
    + ' no commit holds its version yet, or its version file, the tag list or the history could not be'
    + ' read. After the tags it prints what to run next: per tag, the push that puts it on the remote'
    + ' and the publish line for the registry its manifest configures, with the command'
    + ' `release.publishCommand` names (`npm publish` by default), run in the package\'s folder for a'
    + ' package and spelled to publish from the tag when HEAD is past it, which it does not run. Under'
    + ' `release.publish: ci` a unit\'s publish line is replaced by one sentence saying the pushed tag'
    + ' publishes through `.github/workflows/release-publish.yml`, and json carries `publish: "ci"` on'
    + ' that unit. With'
    + ' `--push` it pushes each tag itself to the remote the release branch tracks (`origin` when it'
    + ' tracks none) and drops its push line; a push that fails exits 1 with what git said and keeps'
    + ' the local tags. With `--output=json` the readings, the decisions, the follow-ups and the pushes'
    + ' of every unit are the data of the terminal result event.',
  args: [],
  flags: [
    {
      name: RELEASE_TAG_PUSH_FLAG,
      description: 'Push each tag to the remote the release branch tracks once every tag is written; a'
        + ' push that fails exits 1 and keeps the local tags.',
      type: 'boolean',
    },
  ],
  examples: [
    {
      cmd: 'rafa release tag',
      note: 'Tags the merged release of every unit and prints the push and publish lines to run next.',
    },
    {
      cmd: 'rafa release tag --push',
      note: 'Tags the merged release of every unit, pushes the tags, and prints the publish lines to run next.',
    },
    {
      cmd: 'rafa release tag --output=json',
      note: 'Writes the same tags and gives every unit\'s readings, decision and follow-ups as a result event.',
    },
  ],
  outputs: ['text', 'json'],
});

/** `rafa release list`: see `list.ts` for what it does. */
export const RELEASE_LIST_DECLARATION: CommandDeclaration = Object.freeze<CommandDeclaration>({
  name: 'release list',
  subject: 'release',
  action: 'list',
  summary: 'list the root and each publishable workspace package with its version, waiting fragments and newest tag',
  description: 'Writes one row per unit that releases on its own and writes nothing else: the root first,'
    + ' named by the `name` of `release.versionFile`, then each workspace package that is not `private`.'
    + ' Each row holds the version its file declares, how many change fragments waiting on'
    + ' `origin/<pr.base>` as last fetched name it, and its newest release tag: `v<version>` for the root,'
    + ' `<name>@<version>` for a package, or `untagged`. A column that could not be read is `?`, with the'
    + ' reason on a line under the rows, and the command still exits 0. With `--output=json` the rows and'
    + ' the rendered lines are the data of the terminal result event.',
  args: [],
  flags: [],
  examples: [
    {
      cmd: 'rafa release list',
      note: 'Lists the root and each publishable package with its version, waiting fragments and newest tag.',
    },
  ],
  outputs: ['text', 'json'],
});

/** The flag of `release publish` naming the one release tag to publish. */
export const RELEASE_PUBLISH_TAG_FLAG = 'tag';

/** The flag of `release publish` that prints each unit's line and runs nothing. */
export const RELEASE_PUBLISH_DRY_RUN_FLAG = 'dry-run';

/** `rafa release publish`: see `publish.ts` for what it does. */
export const RELEASE_PUBLISH_DECLARATION: CommandDeclaration = Object.freeze<CommandDeclaration>({
  name: 'release publish',
  subject: 'release',
  action: 'publish',
  summary: 'publish each release unit whose tag points at HEAD, skipping a version the registry holds',
  description: 'Runs `release.publishCommand` (`npm publish` by default) through the shell for each release'
    + ' tag pointing at HEAD — `v<version>` for the root, published from the project root, and'
    + ' `<name>@<version>` for a publishable workspace package, published from its folder — or for the'
    + ' one tag `--tag` names, which is refused when it is no release tag or does not point at HEAD.'
    + ' Every unit is read before anything runs, and the run refuses with exit 1 when no release tag'
    + ' points at HEAD, when a tag names no publishable package, or when the manifest declares a version'
    + ' other than the tag\'s. Before each publish it asks `npm view <name>@<version> version'
    + ' --registry=<registry>`, the registry being `publishConfig.registry` or npm\'s, and skips the unit'
    + ' with one line when the registry holds that version already, so a retry publishes only what is'
    + ' missing; a private manifest is skipped too. The publish runs with the terminal\'s streams, and'
    + ' the first that fails stops the run with its exit code, naming the tags published before it.'
    + ' `--dry-run` prints each unit\'s line and runs nothing. With `--output=json` the units, the'
    + ' skipped, the published and the exit are the data of the terminal result event.',
  args: [],
  flags: [
    {
      name: RELEASE_PUBLISH_TAG_FLAG,
      description: 'The one release tag to publish, which has to point at HEAD.',
      type: 'string',
    },
    {
      name: RELEASE_PUBLISH_DRY_RUN_FLAG,
      description: 'Print the line of each unit and run nothing, not even the registry check.',
      type: 'boolean',
    },
  ],
  examples: [
    {
      cmd: 'rafa release publish',
      note: 'Publishes every release unit tagged at HEAD that the registry does not hold yet.',
    },
    {
      cmd: 'rafa release publish --tag=@scope/plugin@0.2.0',
      note: 'Publishes that one package, when its tag points at HEAD.',
    },
    {
      cmd: 'rafa release publish --dry-run',
      note: 'Prints what each unit would run, and runs nothing.',
    },
  ],
  outputs: ['text', 'json'],
});

/** The flag of `release workflows` that writes the needed missing workflows. */
export const RELEASE_WORKFLOWS_WRITE_FLAG = 'write';

/** `rafa release workflows`: see `workflows.ts` for what it does. */
export const RELEASE_WORKFLOWS_DECLARATION: CommandDeclaration = Object.freeze<CommandDeclaration>({
  name: 'release workflows',
  subject: 'release',
  action: 'workflows',
  summary: 'list the release ladder\'s workflow files and whether the configured level needs each; write the missing ones',
  description: 'Writes one row per workflow file of the release ladder under `.github/workflows/`: its path,'
    + ' the levels it serves, whether the level `release.settle`, `release.tag` and `release.publish`'
    + ' read as needs it, and `present` when it holds the shipped template\'s bytes, `differs` when it'
    + ' holds others, or `missing`, a path holding no regular file counting as missing. With `--write`'
    + ' each needed missing workflow is written from the shipped template, a present or differing file'
    + ' is left as it is and named, and a directory at the path is refused and named; a workflow the'
    + ' level does not need is never written. The command exits 0 in every case. With `--output=json`'
    + ' the level, the rows and the writes are the data of the terminal result event.',
  args: [],
  flags: [
    {
      name: RELEASE_WORKFLOWS_WRITE_FLAG,
      description: 'Write each workflow the level needs and the project lacks, from the shipped template.',
      type: 'boolean',
    },
  ],
  examples: [
    {
      cmd: 'rafa release workflows',
      note: 'Lists the ladder\'s workflow files, which the configured level needs, and their state.',
    },
    {
      cmd: 'rafa release workflows --write',
      note: 'Writes each needed workflow that is missing, and leaves every existing file as it is.',
    },
  ],
  outputs: ['text', 'json'],
});

/** The flag of `release fragment` naming the plan id the fragment carries. */
export const RELEASE_FRAGMENT_PLAN_FLAG = 'plan';

/** The flag of `release fragment` naming the bump. */
export const RELEASE_FRAGMENT_LEVEL_FLAG = 'level';

/** The flag of `release fragment` holding the title. */
export const RELEASE_FRAGMENT_TITLE_FLAG = 'title';

/** The flag of `release fragment` holding one note. */
export const RELEASE_FRAGMENT_NOTE_FLAG = 'note';

/** The flag of `release fragment` naming the package. */
export const RELEASE_FRAGMENT_PACKAGE_FLAG = 'package';

/** `rafa release fragment`: see `fragment.ts` for what it does. */
export const RELEASE_FRAGMENT_DECLARATION: CommandDeclaration = Object.freeze<CommandDeclaration>({
  name: 'release fragment',
  subject: 'release',
  action: 'fragment',
  summary: 'write one change fragment for a branch with no wrap-up, such as a bot\'s pull request',
  description: 'Writes one change fragment under `release.fragments` and prints the path written. The'
    + ' fragment carries `--plan`, `--title` (one line), `--level` (`patch`, `minor`, `major` or `none`),'
    + ' `--package` when given and one `- <area>: <summary>` line per `--note`; a level other than `none`'
    + ' given no note carries its title as the one note. The file is named `<plan>.md`, or `-2`, `-3` and'
    + ' on when that name waits on `origin/<pr.base>`, read after a fetch. Exits 1, writing nothing, for a'
    + ' plan id that cannot name a fragment, an unknown level, an empty title, a note that is not'
    + ' `<area>: <summary>`, a package the workspace lacks or holds as private, a base that cannot be'
    + ' read, and a fragment of that name already on the branch. With `--output=json` the path, the'
    + ' fragment and any warnings are the data of the terminal result event.',
  args: [],
  flags: [
    { name: RELEASE_FRAGMENT_PLAN_FLAG, description: 'The plan id the fragment carries and is named by.', type: 'string' },
    { name: RELEASE_FRAGMENT_LEVEL_FLAG, description: 'The bump the fragment asks for: patch, minor, major or none.', type: 'string' },
    { name: RELEASE_FRAGMENT_TITLE_FLAG, description: 'The fragment\'s title, one line.', type: 'string' },
    { name: RELEASE_FRAGMENT_NOTE_FLAG, description: 'One note as <area>: <summary>; give the flag once per note.', type: 'string' },
    { name: RELEASE_FRAGMENT_PACKAGE_FLAG, description: 'The publishable workspace package the fragment releases; the root when left out.', type: 'string' },
  ],
  examples: [
    {
      cmd: 'rafa release fragment --plan=dependabot-7 --level=patch --title=\'Bump zod from 3.22 to 3.23\'',
      note: 'Writes a patch fragment for pull request 7, its title as the one note.',
    },
    {
      cmd: 'rafa release fragment --plan=rafa-12 --level=minor --title=\'Plugin hooks\' --note=\'hooks: run before each task\' --package=@scope/plugin',
      note: 'Writes a minor fragment for a workspace package with one note.',
    },
  ],
  outputs: ['text', 'json'],
});
