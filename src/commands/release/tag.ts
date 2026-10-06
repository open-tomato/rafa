/**
 * `rafa release tag`: the TAG write of the `release` subject, whose
 * other write, the release commit, is `./settle.ts`'s. It puts
 * `v<version>` on the commit of the release branch that SET that
 * version, which is HEAD unless merges landed after it, when every
 * reading agrees that version is the one to tag, and then prints the
 * publish line rather than publishing.
 *
 * The loop writes a version and a changelog entry with every pull
 * request and stops there (`src/start/release-stage.ts`): the merge
 * commit is not its to tag. This action is the operator step the
 * changelog and release spec puts after the merge (its step 4), and
 * `rafa pr merge` already names it as a follow-up
 * (`src/commands/pr/merge-followups.ts`).
 *
 * One git command here writes — `git tag <tag> <commit>` — and it is
 * the last thing the run does, save the push `--push` asks for after it. Everything before it is a read, and every
 * refusal happens before it, so a refused run leaves the repository
 * exactly as it found it.
 *
 * ## The three refusals, and the two readings that must not pass
 *
 * The spec's definition of done asks for two of them outright:
 * "`release tag` refuses when the tag exists or the tree is not
 * `main`". The third is the agreement between the two files the loop
 * wrote: the version file's version has to be the one the changelog's
 * NEWEST section names. That pairing is what makes the tag mean
 * something — a tag on a version no changelog section describes is a
 * release nobody can read the notes of, and a version file that ran
 * ahead of its changelog is a wrap-up that half ran.
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
 * none is npm's, {@link DEFAULT_REGISTRY}. The command is
 * `release.publishCommand`, `npm publish` by default, printed as the
 * config spells it. Nothing here adds a flag: `publishConfig` carries
 * the access and the registry, and npm reads that block itself, so a
 * `--registry` this module spelled would be a second place for the
 * same fact to be wrong. A project that wants a flag, or another tool,
 * spells it in the setting.
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
 * and nothing here reaches a network.
 *
 * ## `--push`
 *
 * With `--push` (#736) the run pushes the tag itself once it is written,
 * through `../../release/tag-push.ts`, to the remote the release branch
 * tracks, `origin` when it tracks none. A push that went drops the push
 * line from the follow-ups and adds a `Pushed` line under the `Tagged`
 * one; json mode carries the push as the result's `pushed`, a key a run
 * without the flag leaves out, so that run reads exactly as before. A
 * push that failed exits 1 with git's words and the push to run again,
 * and keeps the local tag: it names the right commit whether or not the
 * remote has it, and a second run would refuse on it as `tagged`. The
 * push is the one network call, and it runs only after the write, so
 * every refusal above still leaves the repository as it found it.
 *
 * ## What is shared with `release status`
 *
 * The tag reader, the changelog's version reader and the seams are
 * `./status.ts`'s, imported rather than copied: both actions ask the
 * same two questions of the same repository, and a second spelling of
 * either would be a second thing to keep right. `pr list`, `pr show`
 * and `pr view` take `SEPARATOR` off `pr current` the same way.
 *
 * ## Two borrowings from other subjects
 *
 * `versionTag` comes from `../pr/merge-followups.ts`, where `pr merge`
 * PREDICTS the tag this command will write in order to decide whether
 * to name it as a follow-up. That prediction and this write have to be
 * the same string or the follow-up sends the operator at a tag nothing
 * writes, and one function is what holds them together; two copies of
 * `` `v${version}` `` would drift with nothing to notice.
 *
 * `expectNoArgument` comes from `../plan/plan-files.ts`, the refusal
 * eight other commands reading no argument already share.
 */
import type { ReleaseCommitReading } from './release-commit.js';
import type { ReleaseSeams, TagReading } from './status.js';
import type { RafaCommand, RafaContext } from '../../cli/command.js';
import type { GitRunner } from '../../pr/index.js';
import type { ProjectFound } from '../../project/scope.js';
import type { ReceiptVerdict } from '../../release/receipt.js';
import type { TagPushed } from '../../release/tag-push.js';

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { CommandExit } from '../../cli/command.js';
import { loadConfig } from '../../config-load.js';
import { ConfigError } from '../../config.js';
import { createGitRunner, gitSaid } from '../../pr/index.js';
import { readReceiptVerdict, receiptProblem } from '../../release/receipt.js';
import { pushTag } from '../../release/tag-push.js';
import { readManifestVersion } from '../../release/version.js';
import { expectNoArgument, readSwitch } from '../plan/plan-files.js';
import { versionTag } from '../pr/merge-followups.js';

import { readReleaseCommit } from './release-commit.js';
import { changelogVersions, DEFAULT_RELEASE_SEAMS, readTags } from './status.js';

/** The usage line this action's refusals name. */
export const RELEASE_TAG_USAGE = 'rafa release tag [--push]';

/** The flag that pushes the tag once it is written; see the module note. */
export const PUSH_FLAG = 'push';

/** The branch a release is tagged on when `pr.base` names none. */
export const DEFAULT_RELEASE_BRANCH = 'main';

/** The registry a publish reaches when the manifest names none. */
export const DEFAULT_REGISTRY = 'https://registry.npmjs.org';

/** The remote the push line names, as `src/pr/none.ts` names it too. */
export const RELEASE_REMOTE = 'origin';

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

/** What the version file declared, and the text it declared it in. */
export interface VersionReading {
  /** The path as `release.versionFile` spells it. */
  readonly path: string;
  /** The file's text, kept for the publish line, or null when it could not be read. */
  readonly text: string | null;
  /** The version it declares, or null when none could be read. */
  readonly version: string | null;
  /** Why there is none, or null when there is one. */
  readonly problem: string | null;
}

/** What the changelog's newest section names. */
export interface ChangelogReading {
  /** The path as `release.changelog` spells it. */
  readonly path: string;
  /** The version its newest section names, or null when no section names one. */
  readonly version: string | null;
  /** Why the file could not be read, or null when it was. */
  readonly problem: string | null;
}

/** Where a publish would go, read off the version file; see the module note. */
export interface PublishTarget {
  /** `publishConfig.registry`, or {@link DEFAULT_REGISTRY}. */
  readonly registry: string;
  /** The package name, or null when the file names none. */
  readonly name: string | null;
  /** True when the manifest declares `"private": true`. */
  readonly isPrivate: boolean;
}

/** One command the run names for the operator to type next. */
export interface ReleaseFollowUp {
  /** The whole command, as the operator types it. */
  readonly command: string;
  /** Why it applies, in a phrase, lower case and with no full stop. */
  readonly why: string;
}

/** Why a run refused; see the module note for the five, and the receipt. */
export type TagRefusalReason =
  /** The release branch is not the one checked out, or none is. */
  | 'branch'
  /** The version file could not be read, or declares no version. */
  | 'version'
  /** A tag already names that version. */
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
  /** What the version file declares. */
  readonly version: VersionReading;
  /** What the changelog's newest section names. */
  readonly changelog: ChangelogReading;
  /** The repository's release tags, as `release status` reads them. */
  readonly tags: TagReading;
  /** The commit that set the version, or null when there was no version to look for. */
  readonly release: ReleaseCommitReading | null;
  /** The version's receipt, or null when there was no version or no changelog to read. */
  readonly receipt: ReceiptVerdict | null;
}

/**
 * What json mode gives as the terminal result's `data`. A refusal
 * never reaches it: every one of them is thrown as a
 * {@link CommandExit}, so a result exists only for a run that wrote a
 * tag.
 */
export interface ReleaseTagResult {
  /** The readings the decision was made from. */
  readonly inputs: TagInputs;
  /** The tag written, and the version it names. */
  readonly written: TagReady;
  /** What the operator does next. */
  readonly followUps: readonly ReleaseFollowUp[];
  /** The push `--push` made; left out of a run without the flag. */
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

/** `path`'s text, or null when it could not be read. */
function textOf(path: string): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

/** What the version file at `configured` under `root` declares, text included. */
export function readVersion(root: string, configured: string): VersionReading {
  const resolved = join(root, configured);
  const text = textOf(resolved);
  if (text === null) {
    return {
      path: configured,
      text: null,
      version: null,
      problem: `the version file could not be read at ${resolved}`,
    };
  }
  const version = readManifestVersion(text);
  return version === null
    ? { path: configured, text, version: null, problem: `${resolved} declares no version this can read` }
    : { path: configured, text, version, problem: null };
}

/** What the newest section of the changelog at `configured` under `root` names. */
export function readNewestRelease(root: string, configured: string): ChangelogReading {
  const resolved = join(root, configured);
  const text = textOf(resolved);
  if (text === null) {
    return { path: configured, version: null, problem: `the changelog could not be read at ${resolved}` };
  }
  return { path: configured, version: changelogVersions(text)[0] ?? null, problem: null };
}

/** A string with something in it, trimmed, or null. */
function trimmedOrNull(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === ''
    ? null
    : trimmed;
}

/** `value` as a JSON object's fields, or null when it is anything else. */
function fieldsOf(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

/** What a version file that is no manifest at all reads as: nothing to publish. */
const NO_PACKAGE: PublishTarget = Object.freeze({
  registry: DEFAULT_REGISTRY,
  name: null,
  isPrivate: false,
});

/**
 * Where a publish of `text` would go. A text that is no JSON object
 * reads as {@link NO_PACKAGE}, which names no package and so gets no
 * publish line; see the module note.
 */
export function readPublishTarget(text: string | null): PublishTarget {
  if (text === null) return NO_PACKAGE;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return NO_PACKAGE;
  }
  const fields = fieldsOf(parsed);
  if (fields === null) return NO_PACKAGE;

  const publishConfig = fieldsOf(fields['publishConfig']);
  return {
    registry: trimmedOrNull(publishConfig?.['registry']) ?? DEFAULT_REGISTRY,
    name: trimmedOrNull(fields['name']),
    isPrivate: fields['private'] === true,
  };
}

/** Where the tag went relative to the checkout: how far HEAD is past it, on which branch. */
export interface TagPlace {
  /** First-parent commits HEAD is past the tagged commit. */
  readonly ahead: number;
  /** The branch checked out, which the publish line switches back to. */
  readonly branch: string;
}

/** The place of a tag written on HEAD itself. */
const ON_HEAD: TagPlace = Object.freeze({ ahead: 0, branch: DEFAULT_RELEASE_BRANCH });

/**
 * What the operator does next once `tag` is written: push it, unless
 * `pushed` says the run pushed it already, and publish `version` with
 * `publish`, `release.publishCommand`, when there is something to
 * publish — from the tag when HEAD is past it; see the module note.
 * Pure and total.
 */
export function followUpsFor(
  tag: string,
  version: string,
  target: PublishTarget,
  publish: string,
  place: TagPlace = ON_HEAD,
  pushed = false,
): readonly ReleaseFollowUp[] {
  const push: readonly ReleaseFollowUp[] = pushed
    ? []
    : [{ command: `git push ${RELEASE_REMOTE} ${tag}`, why: `the tag is local until ${RELEASE_REMOTE} has it` }];
  if (target.name === null || target.isPrivate) return push;
  const publishes = `publishes ${target.name}@${version} to ${target.registry}`;
  if (place.ahead === 0) return [...push, { command: publish, why: publishes }];
  return [
    ...push,
    {
      command: `git switch --detach ${tag} && ${publish} && git switch ${place.branch}`,
      why: `${publishes} from the tagged commit, not HEAD; skip it if ${target.registry} has that version already`,
    },
  ];
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

/**
 * What one run does: the tag to write, or the one refusal that stopped
 * it. Pure and total, so every combination of the five readings is
 * measurable from literals; the order the checks run in is the module
 * note's.
 */
export function decideTag(inputs: TagInputs): TagDecision {
  const onBranch = branchRefusal(inputs);
  if (onBranch !== null) return onBranch;

  const version = inputs.version.version;
  if (version === null) {
    return refuse('version', inputs.version.problem ?? `${inputs.version.path} declares no version`);
  }

  if (inputs.tags.problem !== null) return refuse('git', inputs.tags.problem);
  const held = inputs.tags.tags.find((candidate) => candidate.version === version);
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

  return { kind: 'ready', version, tag: versionTag(version), commit: release.commit, ahead: release.ahead };
}

/** The project the dispatcher resolved, which it resolves for every action of the subject. */
function projectOf(context: RafaContext): ProjectFound {
  if (context.project === null) throw new Error('rafa release runs inside a project, and was handed none');
  return context.project;
}

/** The four settings one run reads out of the config. */
export interface TagSettings {
  /** `release.versionFile`, relative to the repository root. */
  readonly versionFile: string;
  /** `release.changelog`, relative to the repository root. */
  readonly changelog: string;
  /** `pr.base`, or {@link DEFAULT_RELEASE_BRANCH}; see the module note. */
  readonly releaseBranch: string;
  /** `release.publishCommand`, the publish line's command; see the module note. */
  readonly publishCommand: string;
}

/** The four settings this action reads, refusing a config `loadConfig` refuses. */
function tagConfig(project: ProjectFound, warn: (message: string) => void): TagSettings {
  try {
    const { config } = loadConfig({ root: project.root, home: project.home }, {}, warn);
    return {
      versionFile: config.releaseVersionFile,
      changelog: config.releaseChangelog,
      releaseBranch: config.prBase ?? DEFAULT_RELEASE_BRANCH,
      publishCommand: config.releasePublishCommand,
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

/** The one write: `v<version>` on the commit that set it. */
function writeTag(git: GitRunner, tag: string, commit: string): void {
  const result = git(['tag', tag, commit]);
  if (result.ok) return;
  throw new CommandExit(1, `❌ ${tag} could not be written: ${gitSaid(result)}`);
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

/**
 * The lines text mode writes for a run that tagged the commit of
 * `branch` that set the version: the `Pushed` line when `pushed` is
 * given, and the `Next:` heading only over follow-ups there are.
 */
export function renderTagged(
  written: TagReady,
  branch: string,
  followUps: readonly ReleaseFollowUp[],
  pushed?: TagPushed,
): readonly string[] {
  const where = written.ahead === 0
    ? `the HEAD of ${branch}`
    : `${written.commit.slice(0, SHORT_COMMIT)}, the commit of ${branch} that set ${written.version}`;
  const next = followUps.length === 0
    ? []
    : ['Next:', ...followUps.map((followUp) => `${INDENT}${followUp.command} — ${followUp.why}`)];
  return [
    `✅ Tagged ${written.tag} at ${where}.`,
    ...(pushed === undefined
      ? []
      : [`✅ Pushed ${pushed.tag} to ${pushed.remote}.`]),
    ...next,
  ];
}

/** One whole run: the readings, the decision, the write it may make, and the lines. */
export function runTag(context: RafaContext, seams: ReleaseSeams = DEFAULT_RELEASE_SEAMS): ReleaseTagResult {
  expectNoArgument(context.args, RELEASE_TAG_USAGE);
  const push = readSwitch(PUSH_FLAG, context.flags[PUSH_FLAG], `Usage: ${RELEASE_TAG_USAGE}`);
  const project = projectOf(context);
  const config = tagConfig(project, (message: string) => {
    context.output.warn(message);
  });
  const git = (seams.git ?? createGitRunner)(project.root);

  const inputs = readTagInputs(project.root, git, config);
  const decision = decideTag(inputs);
  if (decision.kind === 'refused') {
    throw new CommandExit(1, `❌ ${decision.message}\nUsage: ${RELEASE_TAG_USAGE}`);
  }

  writeTag(git, decision.tag, decision.commit);
  const pushed = push
    ? pushTag(git, decision.tag, config.releaseBranch)
    : null;
  if (pushed?.outcome === 'failed') throw new CommandExit(pushed.exitCode, `❌ ${pushed.sentence}`);
  const place: TagPlace = { ahead: decision.ahead, branch: config.releaseBranch };
  const target = readPublishTarget(inputs.version.text);
  const followUps = followUpsFor(decision.tag, decision.version, target, config.publishCommand, place, pushed !== null);
  return pushed === null
    ? { inputs, written: decision, followUps }
    : { inputs, written: decision, followUps, pushed };
}

/** The command, reaching git through `seams`; see the module note. */
export function createReleaseTagCommand(seams: ReleaseSeams = DEFAULT_RELEASE_SEAMS): RafaCommand {
  const command: RafaCommand = {
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
        name: PUSH_FLAG,
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
    run: async (context) => {
      const result = runTag(context, seams);
      const past = pastReleaseWarning(result.written, result.inputs.releaseBranch);
      if (past !== null) context.output.warn(past);
      if (context.outputMode === 'json') {
        context.output.result(result);
        return;
      }
      // The release branch IS the branch checked out: a run that got here passed the branch check.
      const lines = renderTagged(result.written, result.inputs.releaseBranch, result.followUps, result.pushed);
      for (const line of lines) context.output.info(line);
    },
  };
  return Object.freeze(command);
}

export default createReleaseTagCommand();
