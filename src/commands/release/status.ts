/**
 * `rafa release status`: the six readings an operator needs before
 * they tag anything — the version the version file declares, the
 * latest release tag the repository holds, the versions the changelog
 * calls released that carry no tag, the change notes waiting for
 * the current plan's release, the change fragments waiting on the
 * base branch with the release settling them would make (read in
 * `./status-fragments.ts`), and the audit of the changelog's released
 * history (`src/release/audit.ts`).
 *
 * The loop writes a version and a changelog entry with every pull
 * request (`src/start/release-stage.ts`), and stops there: the merge
 * commit is not its to tag, so the tag and the publish are an operator
 * step (from the changelog and release spec, its step 4). This action is
 * the readout that step is taken from, and it WRITES NOTHING: every git
 * command it sends is a read, no file is opened for writing, and no
 * network is reached.
 *
 * ## The two halves
 *
 * This file is the command half: the command, its `--plan` flag, the
 * version file and pending notes readings, and the block the six
 * render to. The readers other folders use are its library half,
 * `src/release/status-readings.ts`: `compareVersions`,
 * `changelogVersions`, `readTags`, `readUntagged` and the types they
 * answer, with the note on why a released version is one the changelog
 * names and why the tags are ordered by semver precedence. This file
 * imports them from there and re-exports none of them.
 *
 * ## Which plan the pending notes belong to
 *
 * `--plan=<stub>` names it outright. With no flag the branch checked
 * out at the project root answers, by the rule effort attribution
 * already uses (`src/effort/attribution.ts`): the part of
 * `<type>/<stub>` after the slash, resolved against the plan roster in
 * `plan.dir` exactly or by queue id.
 *
 * Where the roster answers nothing the branch's own stub is taken
 * verbatim, and the reading says `branch` rather than `roster` so the
 * difference is visible. That is the opposite of what the effort
 * collector does with an uncorroborated stub, and deliberately: the
 * collector would mint a spend group no plan file backs, where the
 * worst this action can do is read no notes and say so. The plans
 * directory is untracked by default, so a checkout that has one plan
 * running and no plan files would otherwise report nothing pending
 * while notes sit in the store.
 *
 * A branch on `main`, a detached HEAD, or a branch with no `/` names
 * no stub, and the reading is then `none`: nothing is guessed, and no
 * note is read. `readPlanChanges(root, null)` is never sent from here
 * — null is the notes of the sessions that resolved NO plan, which is
 * a different question from this one.
 *
 * ## Nothing here refuses for a reading that failed
 *
 * Each of the six is read on its own and each is allowed to fail:
 * a missing version file, a git that cannot list tags, an unreadable
 * changelog, a store this rafa cannot open. A cell nothing could be
 * read for renders {@link UNREADABLE} and the reason goes on its own
 * line under the block, which is the convention `pr list` keeps for
 * its per-row probes. Refusing the whole command for one of them
 * would hide the ones that were readable, and every one of the six
 * is worth having alone. The audit is the one exception to a reason
 * of its own: it reads the changelog the untagged reading reads, so
 * an unreadable changelog is said once, under that reading.
 *
 * The refusals left are the line's own: a stray word, and a config
 * `loadConfig` refuses. Both exit 1.
 */
import type { WaitingReading, WaitingSettings } from './status-fragments.js';
import type { RafaCommand, RafaContext } from '../../cli/command.js';
import type { PlanChange } from '../../effort/store/changes.js';
import type { PlanReleaseLevel } from '../../plan/parse.js';
import type { GitRunner } from '../../pr/index.js';
import type { ProjectFound } from '../../project/scope.js';
import type { AuditReading } from '../../release/audit.js';
import type { TagReading, UntaggedReading } from '../../release/status-readings.js';

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { CommandExit } from '../../cli/command.js';
import { loadConfig } from '../../config-load.js';
import { messageOf } from '../../config-sections.js';
import { ConfigError } from '../../config.js';
import { planStubsFromFileNames, resolvePlanStub } from '../../effort/attribution.js';
import { readPlanChanges } from '../../effort/store/changes.js';
import { createGitRunner } from '../../pr/index.js';
import { auditCell, auditLines, readAudit } from '../../release/audit.js';
import { groupChangeNotes, renderNoteLines } from '../../release/changelog.js';
import { highestChangeLevel } from '../../release/level.js';
import { readTags, readUntagged } from '../../release/status-readings.js';
import { readManifestVersion } from '../../release/version.js';

import { readWaiting, waitingCell, waitingLines, waitingSettingsOf } from './status-fragments.js';

/** The usage line this action's refusals name. */
export const RELEASE_STATUS_USAGE = 'rafa release status [--plan=<stub>]';

/** What a cell reads as when nothing could be read for it. */
export const UNREADABLE = '?';

/** What a cell reads as when the reading succeeded and found nothing. */
export const NOTHING = 'none';

/** What every line of the block is indented by. */
const INDENT = '  ';

/** What a label and its value are separated by. */
const GAP = '  ';

/**
 * How this action reaches git and the store; each left out is the
 * system's own. `release tag` takes the same shape, so one test
 * replaces both the same way.
 */
export interface ReleaseSeams {
  /** Makes the git runner every read of this action goes through. */
  readonly git?: (root: string) => GitRunner;
  /** A plan's stored change notes, oldest first. */
  readonly readNotes?: (repoRoot: string, planStub: string) => readonly PlanChange[];
}

/** The seams the registered action runs with: the system's own, both. */
export const DEFAULT_RELEASE_SEAMS: ReleaseSeams = Object.freeze({});

/** What the version file declared, or why it declared nothing. */
export interface VersionFileReading {
  /** The path as `release.versionFile` spells it. */
  readonly path: string;
  /** The version it declares, or null when none could be read. */
  readonly version: string | null;
  /** Why there is none, or null when there is one. */
  readonly problem: string | null;
}

/** What a missing changelog's cells read as: settle's release commit creates it. */
export const MISSING_CHANGELOG_CELL = 'missing; rafa release settle creates it';

/** What named the plan the pending notes were read for. */
export type ReleasePlanSource =
  /** `--plan=<stub>` named it. */
  | 'flag'
  /** The branch's stub, corroborated by a plan file in `plan.dir`. */
  | 'roster'
  /** The branch's stub, which no plan file corroborates; see the module note. */
  | 'branch'
  /** Nothing named one, and no note was read. */
  | 'none';

/** The change notes waiting for the current plan's release. */
export interface PendingNotesReading {
  /** The plan stub the notes were read under, or null when none was found. */
  readonly stub: string | null;
  /** What named it; see {@link ReleasePlanSource}. */
  readonly source: ReleasePlanSource;
  /** The branch checked out at the project root, or null when git could not say. */
  readonly branch: string | null;
  /** The notes, oldest first, as the store holds them. */
  readonly notes: readonly PlanChange[];
  /** The highest level among them, or null when there are none. */
  readonly level: PlanReleaseLevel | null;
  /** Why the stub or the notes could not be read, or null when both were. */
  readonly problem: string | null;
}

/** The six readings one run of this action answers. */
export interface ReleaseStatusReading {
  /** The version the version file declares. */
  readonly versionFile: VersionFileReading;
  /** The tags of the repository, and the latest of them. */
  readonly tags: TagReading;
  /** The released versions carrying no tag. */
  readonly untagged: UntaggedReading;
  /** The change notes pending for the current plan. */
  readonly plan: PendingNotesReading;
  /** The fragments waiting on the base branch, and their forecast. */
  readonly waiting: WaitingReading;
  /** The audit of the changelog's released history. */
  readonly audit: AuditReading;
}

/** What json mode gives as the terminal result's `data`. */
export interface ReleaseStatusResult {
  /** The six readings. */
  readonly reading: ReleaseStatusReading;
  /** The block text mode writes. */
  readonly text: string;
}

/** `path`'s text, or null when it could not be read. */
function textOf(path: string): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

/** What the version file at `configured` under `root` declares. */
export function readVersionFile(root: string, configured: string): VersionFileReading {
  const resolved = join(root, configured);
  const text = textOf(resolved);
  if (text === null) {
    return { path: configured, version: null, problem: `the version file could not be read at ${resolved}` };
  }
  const version = readManifestVersion(text);
  return version === null
    ? { path: configured, version: null, problem: `${resolved} declares no version this can read` }
    : { path: configured, version, problem: null };
}

/** The branch checked out where `git` runs, or null when git could not say. */
function readBranch(git: GitRunner): string | null {
  const result = git(['rev-parse', '--abbrev-ref', 'HEAD']);
  const branch = result.stdout.trim();
  return result.ok && branch !== '' && branch !== 'HEAD'
    ? branch
    : null;
}

/** The plan stubs `plan.dir` under `root` holds, and none when it is not there. */
function planStubsUnder(root: string, planDir: string): readonly string[] {
  const resolved = join(root, planDir);
  if (!existsSync(resolved)) return [];
  try {
    return planStubsFromFileNames(readdirSync(resolved));
  } catch {
    return [];
  }
}

/** The part of `<type>/<stub>` after the slash, or null when there is none. */
function branchStubOf(branch: string): string | null {
  const slashAt = branch.indexOf('/');
  if (slashAt <= 0) return null;
  const stub = branch.slice(slashAt + 1);
  return stub === '' || stub.includes('/')
    ? null
    : stub;
}

/** The stub a plan reading names, and what named it. */
interface PlanPick {
  readonly stub: string | null;
  readonly source: ReleasePlanSource;
  readonly problem: string | null;
}

/**
 * Which plan the notes are read for: the flag, else the branch's stub
 * resolved against the roster, else that stub verbatim. See the module
 * note for why an uncorroborated stub is taken here.
 */
function pickPlan(
  asked: string | null,
  branch: string | null,
  stubs: readonly string[],
): PlanPick {
  if (asked !== null) return { stub: asked, source: 'flag', problem: null };
  if (branch === null) {
    return { stub: null, source: 'none', problem: 'the branch could not be read, so no plan was resolved' };
  }
  const branchStub = branchStubOf(branch);
  if (branchStub === null) {
    return { stub: null, source: 'none', problem: `the branch "${branch}" names no plan stub` };
  }
  const resolution = resolvePlanStub(branchStub, stubs);
  if (resolution.stub !== null) return { stub: resolution.stub, source: 'roster', problem: null };
  if (resolution.match === 'ambiguous') {
    return {
      stub: null,
      source: 'none',
      problem: `the branch stub "${branchStub}" reaches ${resolution.candidates.length} plans:`
        + ` ${resolution.candidates.join(', ')}`,
    };
  }
  return { stub: branchStub, source: 'branch', problem: null };
}

/** What the store holds for the picked plan, the read's own failure kept rather than thrown. */
export function readPending(
  root: string,
  asked: string | null,
  branch: string | null,
  stubs: readonly string[],
  readNotes: (repoRoot: string, planStub: string) => readonly PlanChange[],
): PendingNotesReading {
  const pick = pickPlan(asked, branch, stubs);
  const empty = { stub: pick.stub, source: pick.source, branch, notes: [], level: null };
  if (pick.stub === null) return { ...empty, problem: pick.problem };
  try {
    const notes = readNotes(root, pick.stub);
    return { ...empty, notes, level: highestChangeLevel(notes), problem: pick.problem };
  } catch (error) {
    return { ...empty, problem: `the change notes could not be read: ${messageOf(error)}` };
  }
}

/** The version file's cell: the path, then what it declares. */
function versionFileCell(reading: VersionFileReading): string {
  return `${reading.path}: ${reading.version ?? UNREADABLE}`;
}

/** The latest tag's cell: the tag, and how many release tags there are. */
function tagCell(reading: TagReading): string {
  if (reading.problem !== null) return UNREADABLE;
  const held = `of ${reading.tags.length} release tags`;
  return reading.latest === null
    ? `${NOTHING}, ${held}`
    : `${reading.latest.tag}, ${held}`;
}

/** The untagged cell: the versions, or what there was none of. */
function untaggedCell(reading: UntaggedReading): string {
  if (reading.missing) return MISSING_CHANGELOG_CELL;
  if (reading.problem !== null) return UNREADABLE;
  if (reading.released.length === 0) return `${NOTHING}, and the changelog names no release`;
  return reading.versions.length === 0
    ? NOTHING
    : reading.versions.join(', ');
}

/** How much of a release a level is worth, as the pending line says it. */
function levelPhrase(level: PlanReleaseLevel): string {
  return level === 'none'
    ? 'worth no release'
    : `worth a ${level} release`;
}

/** The pending cell: how many notes there are, for which plan, and what they are worth. */
function pendingCell(reading: PendingNotesReading): string {
  if (reading.stub === null) return `${NOTHING}: no current plan`;
  const count = reading.notes.length === 1
    ? '1 note'
    : `${reading.notes.length} notes`;
  if (reading.notes.length === 0) return `${NOTHING} for ${reading.stub}`;
  return `${count} for ${reading.stub}, ${levelPhrase(reading.level ?? 'none')}`;
}

/** One line per pending note, as the changelog would group and word them. */
function pendingLines(reading: PendingNotesReading): readonly string[] {
  return renderNoteLines(groupChangeNotes(reading.notes));
}

/** Every reading that could not be made, one sentence each, in the block's order. */
function problemsOf(reading: ReleaseStatusReading): readonly string[] {
  return [
    reading.versionFile.problem,
    reading.tags.problem,
    reading.untagged.missing
      ? null
      : reading.untagged.problem,
    reading.plan.problem,
    ...reading.waiting.problems,
  ].filter((problem): problem is string => problem !== null);
}

/** The label of each of the six lines, in the order the block writes them. */
const LABELS = ['version file', 'latest tag', 'untagged', 'pending', 'waiting', 'audit'] as const;

/**
 * The whole block for one reading: a line per reading, the pending
 * notes under theirs, the waiting fragments under theirs, the audit's
 * findings under its line, and a line for every reading that failed.
 * Pure and total.
 */
export function renderStatus(reading: ReleaseStatusReading): string {
  const width = Math.max(...LABELS.map((label) => label.length));
  const cells = [
    versionFileCell(reading.versionFile),
    tagCell(reading.tags),
    untaggedCell(reading.untagged),
    pendingCell(reading.plan),
    waitingCell(reading.waiting) ?? UNREADABLE,
    auditCell(reading.audit) ?? (reading.untagged.missing
      ? MISSING_CHANGELOG_CELL
      : UNREADABLE),
  ];
  const [versionLine, tagLine, untaggedLine, pendingLine, waitingLine, auditLine] = LABELS
    .map((label, index) => `${INDENT}${label.padEnd(width)}${GAP}${cells[index] ?? ''}`);
  const under = (line: string): string => `${INDENT}${' '.repeat(width)}${GAP}${line}`;
  const problems = problemsOf(reading).map((problem) => `${INDENT}${problem}`);
  const block = [
    versionLine, tagLine, untaggedLine, pendingLine, ...pendingLines(reading.plan).map(under),
    waitingLine, ...waitingLines(reading.waiting).map(under),
    auditLine, ...auditLines(reading.audit).map(under),
  ].join('\n');
  return problems.length === 0
    ? block
    : [block, problems.join('\n')].join('\n\n');
}

/** The project the dispatcher resolved, which it resolves for every action of the subject. */
function projectOf(context: RafaContext): ProjectFound {
  if (context.project === null) throw new Error('rafa release runs inside a project, and was handed none');
  return context.project;
}

/** The `release` and `plan` settings this action reads, refusing a config `loadConfig` refuses. */
function statusConfig(
  project: ProjectFound,
  warn: (message: string) => void,
): { versionFile: string; changelog: string; planDir: string; waiting: WaitingSettings } {
  try {
    const { config } = loadConfig({ root: project.root, home: project.home }, {}, warn);
    return {
      versionFile: config.releaseVersionFile,
      changelog: config.releaseChangelog,
      planDir: config.planDir,
      waiting: waitingSettingsOf(config),
    };
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    throw new CommandExit(
      1,
      ['❌ The config cannot be used:', ...error.problems.map((problem) => `  ${problem}`)].join('\n'),
    );
  }
}

/** The stub `--plan` names, or null when the line names none. */
function readPlanFlag(context: RafaContext): string | null {
  const value = context.flags['plan'];
  if (value === undefined) return null;
  const stub = typeof value === 'string'
    ? value.trim()
    : '';
  if (stub === '') {
    throw new CommandExit(
      1,
      `❌ --plan takes a plan stub, as --plan=rafa-21-changelog-and-release\nUsage: ${RELEASE_STATUS_USAGE}`,
    );
  }
  return stub;
}

/** Refuses a line handing this action any word. */
function expectNoArguments(args: readonly string[]): void {
  if (args.length === 0) return;
  throw new CommandExit(
    1,
    `❌ Expected no arguments, got ${args.length}: ${args.join(' ')}\nUsage: ${RELEASE_STATUS_USAGE}`,
  );
}

/** The six readings for one invocation, and the block they render to. */
export function readStatus(
  context: RafaContext,
  seams: ReleaseSeams = DEFAULT_RELEASE_SEAMS,
): ReleaseStatusResult {
  expectNoArguments(context.args);
  const asked = readPlanFlag(context);
  const project = projectOf(context);
  const config = statusConfig(project, (message: string) => {
    context.output.warn(message);
  });
  const git = (seams.git ?? createGitRunner)(project.root);
  const readNotes = seams.readNotes ?? readPlanChanges;

  const tags = readTags(git);
  const reading: ReleaseStatusReading = {
    versionFile: readVersionFile(project.root, config.versionFile),
    tags,
    untagged: readUntagged(project.root, config.changelog, tags.tags),
    plan: readPending(
      project.root,
      asked,
      readBranch(git),
      planStubsUnder(project.root, config.planDir),
      readNotes,
    ),
    waiting: readWaiting(git, config.waiting),
    audit: readAudit(project.root, config.changelog, tags.tags.map((tag) => tag.version)),
  };
  return { reading, text: renderStatus(reading) };
}

/** The command, reaching git and the store through `seams`; see the module note. */
export function createReleaseStatusCommand(seams: ReleaseSeams = DEFAULT_RELEASE_SEAMS): RafaCommand {
  const command: RafaCommand = {
    name: 'release status',
    subject: 'release',
    action: 'status',
    summary: 'show the version, the latest tag, the untagged releases, the pending notes and the waiting fragments',
    description: 'Reads six things about the release state of the project and writes nothing: the version'
      + ' `release.versionFile` declares, the latest release tag of the repository by semantic version'
      + ' precedence, the versions `release.changelog` calls released that carry no tag, the change notes'
      + ' the current plan\'s sessions have stored for its next release, and the change fragments waiting on'
      + ' `origin/<pr.base>` as last fetched, with the release `rafa release settle` would fold them into,'
      + ' and an audit of the changelog\'s released history: a version two headings name, a gap between'
      + ' versions, dates out of order, and a heading newer than the releases made before settle with no tag.'
      + ' The current plan is the one'
      + ' `--plan=<stub>` names, and otherwise the one the checked-out branch\'s `<type>/<stub>` names,'
      + ' resolved against the plans in `plan.dir`. A reading that could not be made leaves its cell as `?`'
      + ' and says why on a line under the block rather than refusing the others. With `--output=json`'
      + ' the six readings and the rendered block are the data of the terminal result event.',
    args: [],
    flags: [
      {
        name: 'plan',
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
    run: async (context) => {
      const status = readStatus(context, seams);
      if (context.outputMode === 'json') {
        context.output.result(status);
        return;
      }
      context.output.info(status.text);
    },
  };
  return Object.freeze(command);
}

export default createReleaseStatusCommand();
