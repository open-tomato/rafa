/**
 * `rafa release tag`: the one WRITE of the `release` subject. It puts
 * `v<version>` on the HEAD of the release branch when every reading
 * agrees that version is the one to tag, and then prints the publish
 * line rather than publishing.
 *
 * The loop writes a version and a changelog entry with every pull
 * request and stops there (`src/start/release-stage.ts`): the merge
 * commit is not its to tag. This action is the operator step the
 * changelog and release spec puts after the merge (its step 4), and
 * `rafa pr merge` already names it as a follow-up
 * (`src/commands/pr/merge-followups.ts`).
 *
 * One git command here writes — `git tag <tag> HEAD` — and it is the
 * last thing the run does. Everything before it is a read, and every
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
 * ## The publish line is text
 *
 * "Publishing to a registry stays an operator step; `release tag`
 * prints the publish line for the configured registry and does not run
 * it" (the spec, step 4). The configured registry is the version
 * file's own `publishConfig.registry`, and the default when it names
 * none is npm's, {@link DEFAULT_REGISTRY}. The command is
 * `<manager> publish` with no flags on purpose: `publishConfig`
 * carries the access and the registry, and both bun and npm read that
 * block themselves, so a `--registry` this module spelled would be a
 * second place for the same fact to be wrong.
 *
 * The manager is read off the manifest's `packageManager` field, the
 * one field both tools already agree on. A version file that is no
 * manifest at all, or one that is `"private": true`, gets NO publish
 * line: the first has nothing to publish and the second refuses to be
 * published, and naming a command that would refuse is what
 * `merge-followups.ts` calls sending the operator at a guaranteed
 * refusal.
 *
 * The push line is printed beside it for the same reason: the tag this
 * action writes is local until something pushes it, and a release
 * nobody can fetch is not a release. It is text too — nothing here
 * reaches a network.
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
import type { ReleaseSeams, TagReading } from './status.js';
import type { RafaCommand, RafaContext } from '../../cli/command.js';
import type { GitRunner } from '../../pr/index.js';
import type { ProjectFound } from '../../project/scope.js';

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { CommandExit } from '../../cli/command.js';
import { loadConfig } from '../../config-load.js';
import { ConfigError } from '../../config.js';
import { createGitRunner, gitSaid } from '../../pr/index.js';
import { readManifestVersion } from '../../release/version.js';
import { expectNoArgument } from '../plan/plan-files.js';
import { versionTag } from '../pr/merge-followups.js';

import { changelogVersions, DEFAULT_RELEASE_SEAMS, readTags } from './status.js';

/** The usage line this action's refusals name. */
export const RELEASE_TAG_USAGE = 'rafa release tag';

/** The branch a release is tagged on when `pr.base` names none. */
export const DEFAULT_RELEASE_BRANCH = 'main';

/** The registry a publish reaches when the manifest names none. */
export const DEFAULT_REGISTRY = 'https://registry.npmjs.org';

/** The remote the push line names, as `src/pr/none.ts` names it too. */
export const RELEASE_REMOTE = 'origin';

/** What every line under a heading is indented by, as `pr merge` indents its follow-ups. */
const INDENT = '  ';

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

/** Which package manager the publish line is spelled for. */
export type PackageManager = 'bun' | 'npm';

/** Where a publish would go, read off the version file; see the module note. */
export interface PublishTarget {
  /** The manager the manifest's `packageManager` names, npm when it names none. */
  readonly manager: PackageManager;
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

/** Why a run refused; see the module note for why there are five. */
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
  | 'git';

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
}

/** What one call to {@link decideTag} answered. */
export type TagDecision = TagReady | TagRefused;

/** The four readings a decision is made from. */
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
  manager: 'npm',
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
  const declared = trimmedOrNull(fields['packageManager']);
  return {
    manager: declared !== null && declared.startsWith('bun@')
      ? 'bun'
      : 'npm',
    registry: trimmedOrNull(publishConfig?.['registry']) ?? DEFAULT_REGISTRY,
    name: trimmedOrNull(fields['name']),
    isPrivate: fields['private'] === true,
  };
}

/**
 * What the operator does next once `tag` is written: push it, and
 * publish `version` when there is something to publish. Pure and
 * total.
 */
export function followUpsFor(tag: string, version: string, target: PublishTarget): readonly ReleaseFollowUp[] {
  const push: ReleaseFollowUp = {
    command: `git push ${RELEASE_REMOTE} ${tag}`,
    why: `the tag is local until ${RELEASE_REMOTE} has it`,
  };
  if (target.name === null || target.isPrivate) return [push];
  return [
    push,
    {
      command: `${target.manager} publish`,
      why: `publishes ${target.name}@${version} to ${target.registry}`,
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

  return { kind: 'ready', version, tag: versionTag(version) };
}

/** The project the dispatcher resolved, which it resolves for every action of the subject. */
function projectOf(context: RafaContext): ProjectFound {
  if (context.project === null) throw new Error('rafa release runs inside a project, and was handed none');
  return context.project;
}

/** The three settings one run reads out of the config. */
export interface TagSettings {
  /** `release.versionFile`, relative to the repository root. */
  readonly versionFile: string;
  /** `release.changelog`, relative to the repository root. */
  readonly changelog: string;
  /** `pr.base`, or {@link DEFAULT_RELEASE_BRANCH}; see the module note. */
  readonly releaseBranch: string;
}

/** The three settings this action reads, refusing a config `loadConfig` refuses. */
function tagConfig(project: ProjectFound, warn: (message: string) => void): TagSettings {
  try {
    const { config } = loadConfig({ root: project.root, home: project.home }, {}, warn);
    return {
      versionFile: config.releaseVersionFile,
      changelog: config.releaseChangelog,
      releaseBranch: config.prBase ?? DEFAULT_RELEASE_BRANCH,
    };
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    throw new CommandExit(
      1,
      ['❌ The config cannot be used:', ...error.problems.map((problem) => `  ${problem}`)].join('\n'),
    );
  }
}

/** The four readings one run decides from, every one of them a read. */
export function readTagInputs(root: string, git: GitRunner, config: TagSettings): TagInputs {
  return {
    releaseBranch: config.releaseBranch,
    branch: readBranch(git),
    version: readVersion(root, config.versionFile),
    changelog: readNewestRelease(root, config.changelog),
    tags: readTags(git),
  };
}

/** The one write: `v<version>` on the HEAD of the branch the checks agreed on. */
function writeTag(git: GitRunner, tag: string): void {
  const result = git(['tag', tag, 'HEAD']);
  if (result.ok) return;
  throw new CommandExit(1, `❌ ${tag} could not be written: ${gitSaid(result)}`);
}

/** The lines text mode writes for a run that tagged `branch`'s HEAD. */
export function renderTagged(
  written: TagReady,
  branch: string,
  followUps: readonly ReleaseFollowUp[],
): readonly string[] {
  return [
    `✅ Tagged ${written.tag} at the HEAD of ${branch}.`,
    'Next:',
    ...followUps.map((followUp) => `${INDENT}${followUp.command} — ${followUp.why}`),
  ];
}

/** One whole run: the readings, the decision, the write it may make, and the lines. */
export function runTag(context: RafaContext, seams: ReleaseSeams = DEFAULT_RELEASE_SEAMS): ReleaseTagResult {
  expectNoArgument(context.args, RELEASE_TAG_USAGE);
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

  writeTag(git, decision.tag);
  const followUps = followUpsFor(decision.tag, decision.version, readPublishTarget(inputs.version.text));
  return { inputs, written: decision, followUps };
}

/** The command, reaching git through `seams`; see the module note. */
export function createReleaseTagCommand(seams: ReleaseSeams = DEFAULT_RELEASE_SEAMS): RafaCommand {
  const command: RafaCommand = {
    name: 'release tag',
    subject: 'release',
    action: 'tag',
    summary: 'tag the release branch\'s HEAD with the version both release files agree on',
    description: 'Writes `v<version>` on the HEAD of the release branch — `pr.base`, or `main` — when the'
      + ' version `release.versionFile` declares is the one the newest section of `release.changelog` names.'
      + ' It refuses, and writes nothing, when another branch is checked out, when a tag already names that'
      + ' version, when the two files disagree, and when either the version file or the tag list could not'
      + ' be read. After the tag it prints what to run next: the push that puts the tag on the remote, and'
      + ' the publish line for the registry the version file configures, which it does not run. With'
      + ' `--output=json` the readings, the decision and the follow-ups are the data of the terminal result'
      + ' event.',
    args: [],
    flags: [],
    examples: [
      {
        cmd: 'rafa release tag',
        note: 'Tags the merged release and prints the push and publish lines to run next.',
      },
      {
        cmd: 'rafa release tag --output=json',
        note: 'Writes the same tag and gives the readings, the decision and the follow-ups as a result event.',
      },
    ],
    outputs: ['text', 'json'],
    run: async (context) => {
      const result = runTag(context, seams);
      if (context.outputMode === 'json') {
        context.output.result(result);
        return;
      }
      // The release branch IS the branch checked out: a run that got here passed the branch check.
      const lines = renderTagged(result.written, result.inputs.releaseBranch, result.followUps);
      for (const line of lines) context.output.info(line);
    },
  };
  return Object.freeze(command);
}

export default createReleaseTagCommand();
