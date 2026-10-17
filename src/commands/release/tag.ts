/**
 * `rafa release tag`: the TAG write of the `release` subject, whose
 * other write, the release commit, is `./settle.ts`'s. It puts one tag
 * per unit — `v<version>` for the root package, `<name>@<version>` for
 * each publishable workspace package (`./tag-units.ts`) — on the commit
 * of the release branch that SET that unit's version, which is HEAD
 * unless merges landed after it, when every reading agrees that version
 * is the one to tag, and then prints the publish lines rather than
 * publishing.
 *
 * The loop writes a change fragment with every pull request and stops
 * there (`src/start/release-stage.ts`): the merge commit is not its to
 * tag, and the version and the changelog section are written on the
 * base branch by `rafa release settle`. This action is the operator
 * step the changelog and release spec puts after the merge (its step
 * 4). `rafa pr merge` names `rafa release settle` as its follow-up,
 * not this action (`src/commands/pr/merge-followups.ts`), and the tag
 * settle does not write itself is this action's
 * (`src/release/settle-tag.ts`).
 *
 * One git command here writes — `git tag <tag> <commit>`, once per
 * ready unit, in unit order — and it is the last thing the run does,
 * save the pushes `--push` asks for after it. Everything before it is a
 * read, and every unit is decided before the first tag is written, so a
 * refused run leaves the repository exactly as it found it.
 *
 * ## Units, and the one skip
 *
 * The root is read off `release.versionFile` and `release.changelog`;
 * a package off `<dir>/package.json` and `<dir>/CHANGELOG.md`
 * (`./tag-units.ts`). The branch is read and checked once for the run,
 * before any package is read; then {@link decideTag} decides each unit
 * over its own readings, in unit order: the root first, then the
 * packages by manifest path. A unit whose version a tag already names is
 * `skipped`, not refused, so a run after a hand-tagged root still tags
 * the package; the run refuses `tagged` only when every unit is
 * skipped, which is the one refusal a one-package project had before.
 * Any other refusal of any unit stops the run with exit 1 before the
 * first write, one line per refused unit.
 *
 * ## The three refusals, and the two readings that must not pass
 *
 * The spec's definition of done asks for two of them outright:
 * "`release tag` refuses when the tag exists or the tree is not
 * `main`". The third is the agreement between the two files settle
 * wrote: the version file's version has to be the one the changelog's
 * NEWEST section names. That pairing is what makes the tag mean
 * something — a tag on a version no changelog section describes is a
 * release nobody can read the notes of, and a version file that ran
 * ahead of its changelog is a settle that half ran.
 *
 * Two more readings can fail and neither may pass silently: a version
 * file that declares no version, and a `git tag --list` that did not
 * run. Both get a refusal reason of their own
 * ({@link TagRefusalReason}) rather than being folded into one of the
 * three, because "the changelog disagrees" and "nothing could be read"
 * are different things to be told, and json mode carries the reason
 * out to a caller.
 *
 * The order the checks run in is the order an operator can act on:
 * the wrong PLACE first (the branch), then the missing reading (the
 * version), then the state that means the work is already done (the
 * tag), then the disagreement between the two files. A run that is on
 * the wrong branch is told that and nothing else, because every
 * reading after it would be about the wrong tree.
 *
 * ## Which branch a release is tagged on
 *
 * `main`, unless `pr.base` names another. The spec says `main`, and
 * that is the default here; a project whose base branch is `master`
 * has already said so once, in the setting the pull request commands
 * read, and making it say it again under a second key would be a
 * config setting this module invented. Nothing is read off the
 * REMOTE's default branch: that is a network call on the way to a
 * local tag.
 *
 * A detached HEAD and a git that could not answer are both "no branch
 * is checked out", and both refuse: neither can be told apart from
 * standing on the release branch, and the whole point of the check is
 * that the tag lands on the right commit.
 *
 * ## Which commit: the one that set the version
 *
 * The tag names the commit of the release branch that set the version,
 * read by `./release-commit.ts`, whose module note measures why HEAD is
 * the wrong answer once merges land after the release, and why the
 * registry's `gitHead` is not the right one either. When HEAD set it the
 * run reads exactly as it did when it always tagged HEAD. When HEAD is
 * past it the run still tags, says how far past in a warning, and
 * spells the publish line so it publishes the TAGGED tree:
 * `git switch --detach <tag> && <publish> && git switch <branch>`,
 * because a publish from HEAD would ship the later commits
 * under the older version. Whether the registry has that version
 * already is not read (no network here), so the line says to skip it
 * when it does.
 *
 * A version the working tree declares and no commit holds is refused
 * with the `version` reason, and a history git could not walk with the
 * `git` reason: both are readings the tag cannot be placed without.
 * They are checked last, after the changelog, since each is about WHERE
 * the tag goes once every other reading agrees it should be written.
 *
 * ## The receipt
 *
 * Once the two files agree, the version's changelog section has to
 * carry the receipt settle writes (`<!-- rafa:fragments <id> -->`), or
 * be at or below the adoption boundary, the newest version released
 * before settle; with no receipted section anywhere every version is
 * legacy. `../../release/receipt.ts` reads both and says why; a
 * refusal carries the `receipt` reason. It runs after the changelog
 * check, since a section is only worth auditing once it is the one
 * both files name, and before the release commit, which is about where
 * the tag goes.
 *
 * ## The publish line is text
 *
 * "Publishing to a registry stays an operator step; `release tag`
 * prints the publish line for the configured registry and does not run
 * it" (the spec, step 4). The configured registry is the version
 * file's own `publishConfig.registry`, and the default when it names
 * none is npm's, `DEFAULT_REGISTRY` in `./tag-follow-ups.ts`. The command is
 * `release.publishCommand`, `npm publish` by default, printed as the
 * config spells it. Nothing here adds a flag: `publishConfig` carries
 * the access and the registry, and npm reads that block itself, so a
 * `--registry` this module spelled would be a second place for the
 * same fact to be wrong. A project that wants a flag, or another tool,
 * spells it in the setting. A package publishes from its own folder, so
 * its line is `(cd <dir> && <publishCommand>)` (`./tag-follow-ups.ts`),
 * one publish line per unit, under the push line of that unit's tag.
 *
 * Under `release.publish: ci` the pushed tag starts
 * `.github/workflows/release-publish.yml`, which publishes the unit, so
 * the publish line gives way to one sentence saying so, and naming the
 * repository variable `RAFA_RELEASE_PUBLISH` the publish job waits on
 * (`ciPublishSentence` in `./tag-follow-ups.ts`), and json carries
 * `publish: "ci"` on each unit that sentence was written for.
 *
 * The command is a setting rather than a reading of the manifest. Until
 * 2026-09-30 it was `<manager> publish`, the manager read off the
 * manifest's `packageManager` field, and tagging 0.24.1 of this
 * repository printed `bun publish`, while its releases are published
 * with `npm publish`. `packageManager` names the tool a project
 * installs with, and that is not always the one it publishes with, so
 * the field answered a question nobody had asked it.
 *
 * A version file that is no manifest at all, or one that is
 * `"private": true`, gets NO publish line: the first has nothing to
 * publish and the second refuses to be published, and naming a
 * command that would refuse is what `merge-followups.ts` calls
 * sending the operator at a guaranteed refusal.
 *
 * The push line is printed beside it for the same reason: the tag this
 * action writes is local until something pushes it, and a release
 * nobody can fetch is not a release. Without `--push` it is text too,
 * and nothing here reaches a network. It names the remote `--push`
 * would reach (#857), read by `trackedRemote` off
 * `../../release/tag-push.ts`: the one the release branch tracks, or
 * `RELEASE_REMOTE` (`origin`, `../../release/version.ts`) when it
 * tracks none, so the line to copy and the push the flag makes go to
 * the same place.
 *
 * ## `--push`
 *
 * With `--push` (#736) the run pushes each tag itself once every tag is
 * written, in unit order, through `../../release/tag-push.ts`, to the
 * remote the release branch tracks, `origin` when it tracks none. A push
 * that went drops that tag's push line from the follow-ups and adds a
 * `Pushed` line under its `Tagged` one; json mode carries the push as
 * the unit's `pushed`, and the root's as the result's `pushed`, keys a
 * run without the flag leaves out, so that run reads exactly as before.
 * A push that failed exits 1 with git's words and the push to run again,
 * naming the tags pushed before it and the ones left unpushed after it,
 * and keeps every local tag: each names the right commit whether or not
 * the remote has it, and a second run skips it as tagged. The pushes are
 * the one network call, and they run only after the writes, so every
 * refusal above still leaves the repository as it found it.
 *
 * ## What is shared with `release status`
 *
 * The tag reader and the changelog's version reader are
 * `src/release/status-readings.ts`'s and the seams are `./status.ts`'s,
 * imported rather than copied: both actions ask the
 * same two questions of the same repository, and a second spelling of
 * either would be a second thing to keep right. `pr list`, `pr show`
 * and `pr view` take `SEPARATOR` off `pr current` the same way.
 *
 * ## Two borrowings from other subjects
 *
 * `versionTag` and `packageTag` come from `src/release/version-tag.ts`,
 * which settle's tag step (`src/release/settle-tag.ts`) builds its tags
 * from too. That write and this one have to be the same string or one
 * version gets two tags, and one function per spelling is what holds
 * them together; two copies of `` `v${version}` `` would drift with
 * nothing to notice.
 *
 * `expectNoArgument` comes from `../plan/plan-files.ts`, the refusal
 * eight other commands reading no argument already share.
 */
import type { ReleaseCommitReading } from './release-commit.js';
import type { ReleaseSeams } from './status.js';
import type { ReleaseFollowUp } from './tag-follow-ups.js';
import type { ChangelogReading, UnitDecision, UnitReadings, VersionReading } from './tag-units.js';
import type { GitRunner } from '../../pr/index.js';
import type { ProjectFound } from '../../project/scope.js';
import type { ReceiptVerdict } from '../../release/receipt.js';
import type { TagReading } from '../../release/status-readings.js';
import type { TagPushed } from '../../release/tag-push.js';
import type { RafaCommand, RafaContext } from '@open-tomato/rafa/core/command';
import type { ReleasePublishMode } from '@open-tomato/rafa/core/config/sections';

import { CommandExit } from '@open-tomato/rafa/core/command';
import { ConfigError } from '@open-tomato/rafa/core/config';
import { loadConfig } from '@open-tomato/rafa/core/config/load';

import { createGitRunner, gitSaid } from '../../pr/index.js';
import { readReceiptVerdict, receiptProblem } from '../../release/receipt.js';
import { readTags } from '../../release/status-readings.js';
import { pushTag, trackedRemote } from '../../release/tag-push.js';
import { packageTag, versionTag } from '../../release/version-tag.js';
import { expectNoArgument, readSwitch } from '../plan/plan-files.js';

import { RELEASE_TAG_DECLARATION, RELEASE_TAG_PUSH_FLAG } from './declarations.js';
import { readReleaseCommit } from './release-commit.js';
import { DEFAULT_RELEASE_SEAMS } from './status.js';
import { ciPublishSentence, followUpsFor, readPublishTarget } from './tag-follow-ups.js';
import {
  readNewestRelease,
  readTagPackages,
  readUnitInputs,
  readVersion,
  unitDecisionOf,
} from './tag-units.js';

/** The usage line this action's refusals name. */
export const RELEASE_TAG_USAGE = 'rafa release tag [--push]';

/** The branch a release is tagged on when `pr.base` names none. */
export const DEFAULT_RELEASE_BRANCH = 'main';

/** What every line under a heading is indented by, as `pr merge` indents its follow-ups. */
const INDENT = '  ';

/** How many characters of a commit hash a line names it by. */
const SHORT_COMMIT = 7;

/** What branch the repository has checked out, or why it has none. */
export interface BranchReading {
  /** The branch, or null for a detached HEAD and for a git that did not answer. */
  readonly branch: string | null;
  /** Why there is none, or null when there is one. */
  readonly problem: string | null;
}

/** Why a run refused; see the module note for the five, and the receipt. */
export type TagRefusalReason =
  /** The release branch is not the one checked out, or none is. */
  | 'branch'
  /** The version file could not be read, or declares no version. */
  | 'version'
  /** A tag of the unit already names that version; another unit's tag of the same version does not count. */
  | 'tagged'
  /** The changelog's newest section names another version, or none. */
  | 'changelog'
  /** A git read the decision needs did not run. */
  | 'git'
  /** The version's changelog section carries no receipt above the adoption boundary. */
  | 'receipt';

/** A run that refused, before anything was written. */
export interface TagRefused {
  /** Tells this apart from {@link TagReady}. */
  readonly kind: 'refused';
  /** Which check refused; see {@link TagRefusalReason}. */
  readonly reason: TagRefusalReason;
  /** The whole refusal, one or two sentences, with no marker on the front. */
  readonly message: string;
}

/** A run every check agreed with, and the tag it writes. */
export interface TagReady {
  /** Tells this apart from {@link TagRefused}. */
  readonly kind: 'ready';
  /** The version both files agree on. */
  readonly version: string;
  /** The tag that names it. */
  readonly tag: string;
  /** The full hash of the commit the tag is written on: the one that set the version. */
  readonly commit: string;
  /** First-parent commits HEAD is past {@link commit}; 0 when HEAD set the version. */
  readonly ahead: number;
}

/** What one call to {@link decideTag} answered. */
export type TagDecision = TagReady | TagRefused;

/** The readings a decision is made from. */
export interface TagInputs {
  /** The branch a release is tagged on. */
  readonly releaseBranch: string;
  /** What is checked out. */
  readonly branch: BranchReading;
  /** The workspace package the readings are of, or null for the root; it picks the tags and their spelling. */
  readonly package: string | null;
  /** What the version file declares. */
  readonly version: VersionReading;
  /** What the changelog's newest section names. */
  readonly changelog: ChangelogReading;
  /** The repository's release tags, as `release status` reads them; {@link decideTag} reads the unit's. */
  readonly tags: TagReading;
  /** The commit that set the version, or null when there was no version to look for. */
  readonly release: ReleaseCommitReading | null;
  /** The version's receipt, or null when there was no version or no changelog to read. */
  readonly receipt: ReceiptVerdict | null;
}

/** One unit of a run that tagged: what it read, what was decided, and what the operator does next. */
export interface ReleaseTagUnit {
  /** The workspace package, or null for the root. */
  readonly package: string | null;
  /** The package's folder relative to the root, or null for the root. */
  readonly dir: string | null;
  /** The readings its decision was made from. */
  readonly inputs: TagInputs;
  /** Its tag, written, or the skip that left it alone; a refusal never reaches a result. */
  readonly decision: UnitDecision;
  /** Its push and publish lines; none for a skipped unit. */
  readonly followUps: readonly ReleaseFollowUp[];
  /** The push `--push` made of its tag; left out of a run without the flag and of a skipped unit. */
  readonly pushed?: TagPushed;
  /**
   * `ci` when `release.publish: ci` hands its publish to the publish
   * workflow; left out where the unit has a publish line or nothing to publish.
   */
  readonly publish?: 'ci';
}

/**
 * What json mode gives as the terminal result's `data`. A refusal
 * never reaches it: every one of them is thrown as a
 * {@link CommandExit}, so a result exists only for a run that wrote at
 * least one tag. `inputs`, `written` and `pushed` are the root's, as
 * they were before units, for json readers that read those keys.
 */
export interface ReleaseTagResult {
  /** The root's readings. */
  readonly inputs: TagInputs;
  /** The root's tag, written, or null when the root was skipped. */
  readonly written: TagReady | null;
  /** Every unit's follow-ups, in unit order. */
  readonly followUps: readonly ReleaseFollowUp[];
  /** Every unit, the root first, then the publishable packages by manifest path. */
  readonly units: readonly ReleaseTagUnit[];
  /** The push `--push` made of the root's tag; left out of a run without the flag. */
  readonly pushed?: TagPushed;
}

/** The branch checked out where `git` runs; see the module note on the detached case. */
export function readBranch(git: GitRunner): BranchReading {
  const result = git(['rev-parse', '--abbrev-ref', 'HEAD']);
  if (!result.ok) {
    return { branch: null, problem: `the branch could not be read: ${gitSaid(result)}` };
  }
  const branch = result.stdout.trim();
  if (branch === '' || branch === 'HEAD') {
    return { branch: null, problem: 'no branch is checked out, so this is a detached HEAD' };
  }
  return { branch, problem: null };
}

/** A refusal, spelled once so every branch below reads the same. */
function refuse(reason: TagRefusalReason, message: string): TagRefused {
  return { kind: 'refused', reason, message };
}

/** The branch check: the release branch has to be the one checked out. */
function branchRefusal(inputs: TagInputs): TagRefused | null {
  const { branch, problem } = inputs.branch;
  if (branch === null) {
    return refuse('branch', `${problem ?? 'no branch is checked out'}, and a release is tagged`
      + ` on ${inputs.releaseBranch}`);
  }
  return branch === inputs.releaseBranch
    ? null
    : refuse('branch', `a release is tagged on ${inputs.releaseBranch}, and ${branch} is checked out`);
}

/** The changelog check: its newest section has to name `version`. */
function changelogRefusal(inputs: TagInputs, version: string): TagRefused | null {
  const { path, version: newest, problem } = inputs.changelog;
  if (problem !== null) return refuse('changelog', problem);
  if (newest === null) {
    return refuse('changelog', `${path} names no release, so nothing says ${version} is the version to tag`);
  }
  return newest === version
    ? null
    : refuse('changelog', `${inputs.version.path} says ${version} and the newest section of ${path}`
      + ` says ${newest}`);
}

/** The tag naming `version` of the unit `inputs` reads: `v<version>` for the root, `<name>@<version>` for a package. */
function unitTag(inputs: TagInputs, version: string): string {
  return inputs.package === null
    ? versionTag(version)
    : packageTag(inputs.package, version);
}

/**
 * What one unit does: the tag to write, or the one refusal that stopped
 * it. Pure and total, so every combination of the readings is
 * measurable from literals; the order the checks run in is the module
 * note's. Only the unit's own tags count for `tagged`: a package's tag
 * of the root's version does not hold the root's, nor the other way.
 */
export function decideTag(inputs: TagInputs): TagDecision {
  const onBranch = branchRefusal(inputs);
  if (onBranch !== null) return onBranch;

  const version = inputs.version.version;
  if (version === null) {
    return refuse('version', inputs.version.problem ?? `${inputs.version.path} declares no version`);
  }

  if (inputs.tags.problem !== null) return refuse('git', inputs.tags.problem);
  const held = inputs.tags.tags.find((candidate) => candidate.package === inputs.package
    && candidate.version === version);
  if (held !== undefined) {
    return refuse('tagged', `${held.tag} already names ${version}, so there is nothing to tag`);
  }

  const disagrees = changelogRefusal(inputs, version);
  if (disagrees !== null) return disagrees;

  const path = inputs.changelog.path;
  const unreceipted = inputs.receipt === null
    ? `${path} was not read for the receipt of ${version}`
    : receiptProblem(inputs.receipt, version, path);
  if (unreceipted !== null) return refuse('receipt', unreceipted);

  const release = inputs.release;
  if (release === null) return refuse('version', `${inputs.version.path} was not looked up in the history`);
  if (release.problem !== null) return refuse(release.problem.reason, release.problem.message);
  if (release.commit === null) return refuse('git', `no commit could be named for ${version}`);

  return { kind: 'ready', version, tag: unitTag(inputs, version), commit: release.commit, ahead: release.ahead };
}
/** The project the dispatcher resolved, which it resolves for every action of the subject. */
function projectOf(context: RafaContext): ProjectFound {
  if (context.project === null) throw new Error('rafa release runs inside a project, and was handed none');
  return context.project;
}

/** The five settings one run reads out of the config. */
export interface TagSettings {
  /** `release.versionFile`, relative to the repository root. */
  readonly versionFile: string;
  /** `release.changelog`, relative to the repository root. */
  readonly changelog: string;
  /** `pr.base`, or {@link DEFAULT_RELEASE_BRANCH}; see the module note. */
  readonly releaseBranch: string;
  /** `release.publishCommand`, the publish line's command; see the module note. */
  readonly publishCommand: string;
  /** `release.publish`: `ci` replaces the publish line; see the module note. */
  readonly publishMode: ReleasePublishMode;
}

/** The five settings this action reads, refusing a config `loadConfig` refuses. */
async function tagConfig(project: ProjectFound, warn: (message: string) => void): Promise<TagSettings> {
  try {
    const { config } = await loadConfig({ root: project.root, home: project.home }, {}, warn);
    return {
      versionFile: config.releaseVersionFile,
      changelog: config.releaseChangelog,
      releaseBranch: config.prBase ?? DEFAULT_RELEASE_BRANCH,
      publishCommand: config.releasePublishCommand,
      publishMode: config.releasePublish,
    };
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    throw new CommandExit(
      1,
      ['❌ The config cannot be used:', ...error.problems.map((problem) => `  ${problem}`)].join('\n'),
    );
  }
}

/**
 * The readings one run decides from, every one of them a read. The
 * release commit is looked up only once there is a version to look up
 * and the release branch is the one checked out, since the history it
 * walks is HEAD's.
 */
export function readTagInputs(root: string, git: GitRunner, config: TagSettings): TagInputs {
  const branch = readBranch(git);
  const version = readVersion(root, config.versionFile);
  const walkable = version.version !== null && branch.branch === config.releaseBranch;
  return {
    releaseBranch: config.releaseBranch,
    branch,
    package: null,
    version,
    changelog: readNewestRelease(root, config.changelog),
    tags: readTags(git),
    release: walkable && version.version !== null
      ? readReleaseCommit(git, config.versionFile, version.version)
      : null,
    receipt: version.version === null
      ? null
      : readReceiptVerdict(root, config.changelog, version.version),
  };
}

/** One unit read and decided, before anything is written. */
type DecidedUnit = Omit<ReleaseTagUnit, 'followUps' | 'pushed'>;

/** A unit whose decision is a tag to write. */
type ReadyUnit = DecidedUnit & { readonly decision: TagReady };

/** True for a unit whose decision is a tag to write. */
function isReady(unit: DecidedUnit): unit is ReadyUnit {
  return unit.decision.kind === 'ready';
}

/** The exit a run refused with: one `❌` line per sentence, without repeats, then the usage. */
function refusal(messages: readonly string[]): CommandExit {
  const lines = [...new Set(messages)].map((message) => `❌ ${message}`);
  return new CommandExit(1, `${lines.join('\n')}\nUsage: ${RELEASE_TAG_USAGE}`);
}

/**
 * Every unit, read and decided: the root from `root`'s decision, then
 * each publishable package over the run's branch reading. Called only
 * once the branch check passed; see the module note.
 */
function decideUnits(projectRoot: string, git: GitRunner, root: TagInputs): readonly DecidedUnit[] {
  const packages = readTagPackages(projectRoot);
  if (!packages.ok) throw refusal([packages.problem]);
  const run = { releaseBranch: root.releaseBranch, branch: root.branch };
  const members = packages.packages.map((member): DecidedUnit => {
    const readings: UnitReadings = readUnitInputs(projectRoot, git, member);
    const inputs: TagInputs = { ...run, ...readings };
    return { package: member.name, dir: member.dir, inputs, decision: unitDecisionOf(decideTag(inputs)) };
  });
  return [{ package: null, dir: null, inputs: root, decision: unitDecisionOf(decideTag(root)) }, ...members];
}

/**
 * The units to write, once every unit is decided: any refusal stops the
 * run, and a run whose every unit is skipped refuses `tagged`.
 */
function readyUnits(units: readonly DecidedUnit[]): readonly ReadyUnit[] {
  const refused = messagesOf(units, 'refused');
  if (refused.length > 0) throw refusal(refused);
  const ready = units.filter(isReady);
  if (ready.length === 0) throw refusal(messagesOf(units, 'skipped'));
  return ready;
}

/** The sentences of the units decided `kind`, in unit order. */
function messagesOf(units: readonly DecidedUnit[], kind: 'refused' | 'skipped'): readonly string[] {
  return units.flatMap(({ decision }) => decision.kind !== 'ready' && decision.kind === kind
    ? [decision.message]
    : []);
}

/** `tags` named in a clause: `a`, or `a, b`, with the verb that agrees. */
function named(tags: readonly string[], one: string, many: string): string {
  return `${tags.join(', ')} ${tags.length === 1
    ? one
    : many}`;
}

/** The writes: each ready unit's tag, in unit order; a write that failed names the ones written before it. */
function writeTags(git: GitRunner, ready: readonly ReadyUnit[]): void {
  const written: string[] = [];
  for (const unit of ready) {
    const { tag, commit } = unit.decision;
    const result = git(['tag', tag, commit]);
    if (!result.ok) {
      const before = written.length === 0
        ? ''
        : `; ${named(written, 'is', 'are')} written already`;
      throw new CommandExit(1, `❌ ${tag} could not be written: ${gitSaid(result)}${before}`);
    }
    written.push(tag);
  }
}

/** The pushes `--push` asks for, in unit order, stopping at the first that failed; see the module note. */
function pushTags(git: GitRunner, ready: readonly ReadyUnit[], branch: string): ReadonlyMap<string, TagPushed> {
  const pushed = new Map<string, TagPushed>();
  for (const [index, unit] of ready.entries()) {
    const outcome = pushTag(git, unit.decision.tag, branch);
    if (outcome.outcome === 'failed') {
      const before = pushed.size === 0
        ? ''
        : `; ${named([...pushed.keys()], 'is', 'are')} pushed already`;
      const left = ready.slice(index + 1).map((each) => each.decision.tag);
      const after = left.length === 0
        ? ''
        : `; ${named(left, 'is', 'are')} written and not pushed`;
      throw new CommandExit(outcome.exitCode, `❌ ${outcome.sentence}${before}${after}`);
    }
    pushed.set(unit.decision.tag, outcome);
  }
  return pushed;
}

/** `unit` as the result carries it, with its follow-ups and the push it got. */
function unitResult(
  unit: DecidedUnit,
  config: TagSettings,
  pushed: ReadonlyMap<string, TagPushed> | null,
  pushTo: string | null,
): ReleaseTagUnit {
  const base = { package: unit.package, dir: unit.dir, inputs: unit.inputs, decision: unit.decision };
  if (unit.decision.kind !== 'ready') return { ...base, followUps: [] };
  const { tag, version, ahead } = unit.decision;
  const target = readPublishTarget(unit.inputs.version.text);
  const place = { ahead, branch: config.releaseBranch, dir: unit.dir };
  const mode = config.publishMode;
  const followUps = followUpsFor(tag, version, target, config.publishCommand, place, pushTo, mode);
  const ci = mode === 'ci' && ciPublishSentence(tag, version, target) !== null
    ? { publish: 'ci' as const }
    : {};
  const push = pushed?.get(tag);
  return push === undefined
    ? { ...base, followUps, ...ci }
    : { ...base, followUps, pushed: push, ...ci };
}

/** The `Next:` lines of one unit: its follow-ups, then the CI publish sentence when it has one. */
function nextLines(unit: ReleaseTagUnit): readonly string[] {
  const lines = unit.followUps.map((followUp) => `${INDENT}${followUp.command} — ${followUp.why}`);
  if (unit.publish !== 'ci' || unit.decision.kind !== 'ready') return lines;
  const { tag, version } = unit.decision;
  const sentence = ciPublishSentence(tag, version, readPublishTarget(unit.inputs.version.text));
  return sentence === null
    ? lines
    : [...lines, `${INDENT}${sentence}`];
}

/** The warning a run prints when HEAD is past the tagged commit, or null when HEAD is the tagged commit. */
export function pastReleaseWarning(written: TagReady, branch: string): string | null {
  if (written.ahead === 0) return null;
  const commits = written.ahead === 1
    ? '1 commit'
    : `${String(written.ahead)} commits`;
  return `HEAD of ${branch} is ${commits} past ${written.commit.slice(0, SHORT_COMMIT)}, where ${written.version}`
    + ` was set; they are not in ${written.tag}.`;
}

/** The lines of one unit: its `Tagged` and `Pushed` lines, or its `Skipped` line. */
function unitLines(unit: ReleaseTagUnit, branch: string): readonly string[] {
  const decision = unit.decision;
  if (decision.kind === 'skipped') return [`Skipped: ${decision.message}.`];
  if (decision.kind === 'refused') return [];
  const where = decision.ahead === 0
    ? `the HEAD of ${branch}`
    : `${decision.commit.slice(0, SHORT_COMMIT)}, the commit of ${branch} that set ${decision.version}`;
  return [
    `✅ Tagged ${decision.tag} at ${where}.`,
    ...(unit.pushed === undefined
      ? []
      : [`✅ Pushed ${unit.pushed.tag} to ${unit.pushed.remote}.`]),
  ];
}

/**
 * The lines text mode writes for a run that tagged on `branch`: one
 * `Tagged` line per tag in unit order, each with its `Pushed` line when
 * the tag was pushed, a `Skipped` line per skipped unit, and the
 * `Next:` heading only over follow-ups there are, every unit's in unit
 * order, a unit under `release.publish: ci` giving its CI publish
 * sentence where its publish line would stand.
 */
export function renderTagged(units: readonly ReleaseTagUnit[], branch: string): readonly string[] {
  const lines = units.flatMap(nextLines);
  const next = lines.length === 0
    ? []
    : ['Next:', ...lines];
  return [...units.flatMap((unit) => unitLines(unit, branch)), ...next];
}

/**
 * One whole run: the branch check, every unit's readings and decision,
 * the writes, the pushes `--push` asks for, and the result.
 */
export async function runTag(context: RafaContext, seams: ReleaseSeams = DEFAULT_RELEASE_SEAMS): Promise<ReleaseTagResult> {
  expectNoArgument(context.args, RELEASE_TAG_USAGE);
  const push = readSwitch(RELEASE_TAG_PUSH_FLAG, context.flags[RELEASE_TAG_PUSH_FLAG], `Usage: ${RELEASE_TAG_USAGE}`);
  const project = projectOf(context);
  const config = await tagConfig(project, (message: string) => {
    context.output.warn(message);
  });
  const git = (seams.git ?? createGitRunner)(project.root);

  const inputs = readTagInputs(project.root, git, config);
  const onBranch = branchRefusal(inputs);
  if (onBranch !== null) throw refusal([onBranch.message]);
  const decided = decideUnits(project.root, git, inputs);
  const ready = readyUnits(decided);

  writeTags(git, ready);
  const pushed = push
    ? pushTags(git, ready, config.releaseBranch)
    : null;
  const pushTo = pushed === null
    ? trackedRemote(git, config.releaseBranch)
    : null;
  const units = decided.map((unit) => unitResult(unit, config, pushed, pushTo));
  const root = units[0];
  const written = root?.decision.kind === 'ready'
    ? root.decision
    : null;
  const followUps = units.flatMap((unit) => unit.followUps);
  return root?.pushed === undefined
    ? { inputs, written, followUps, units }
    : { inputs, written, followUps, units, pushed: root.pushed };
}

/** The command, reaching git through `seams`; see the module note. */
export function createReleaseTagCommand(seams: ReleaseSeams = DEFAULT_RELEASE_SEAMS): RafaCommand {
  const command: RafaCommand = {
    ...RELEASE_TAG_DECLARATION,
    run: async (context) => {
      const result = await runTag(context, seams);
      for (const unit of result.units) {
        if (unit.decision.kind !== 'ready') continue;
        const past = pastReleaseWarning(unit.decision, result.inputs.releaseBranch);
        if (past !== null) context.output.warn(past);
      }
      if (context.outputMode === 'json') {
        context.output.result(result);
        return;
      }
      // The release branch IS the branch checked out: a run that got here passed the branch check.
      for (const line of renderTagged(result.units, result.inputs.releaseBranch)) context.output.info(line);
    },
  };
  return Object.freeze(command);
}

const command: RafaCommand = createReleaseTagCommand();
export default command;
