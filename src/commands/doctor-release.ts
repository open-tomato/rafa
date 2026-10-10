/**
 * The release row of `rafa doctor`: the version the base branch
 * declares, the latest release tag, the version the changelog's top
 * heading names, and the change fragments waiting on the base with the
 * release settling them would make.
 *
 * ```text
 * Release: origin/main at 0.25.0, latest tag v0.25.0, CHANGELOG.md tops at 0.25.0, no fragment waits.
 * Release: origin/main at 0.25.0, latest tag v0.25.0, CHANGELOG.md tops at 0.25.0, 2 fragments wait (rafa-9, rafa-1): settles as the next minor, 0.26.0; run rafa release settle to fold them into one version.
 * ```
 *
 * ## Only where the release is on
 *
 * The row is read and printed only when `resolveReleaseEnabled`
 * (`src/release/enabled.ts`) says the release runs here: under `auto`,
 * both `release.versionFile` and `release.changelog` are files. A
 * project that never opted in gets no row and sends no git command, so
 * the other rows of `doctor` read as they did before this one.
 *
 * ## What is read, and where
 *
 * It reads what `rafa release status` reads, through that action's own
 * readers (`./release/status-fragments.ts` and the library half,
 * `src/release/status-readings.ts`), and assembles no `git` argv of its
 * own:
 *
 *   - the base version and the waiting fragments with their forecast
 *     come from `readWaiting` (`./release/status-fragments.ts`) at
 *     `origin/<pr.base>` (`main` when the project names no `pr.base`) AS
 *     LAST FETCHED: `doctor` fetches nothing, and the row names the ref
 *     so it is never taken for the remote's live state. The forecast is
 *     `forecastSettle`'s, so the version named is the one
 *     `rafa release settle --dry-run` would fold over the same tree;
 *   - the latest tag is `readTags`'s, highest by semver precedence;
 *   - the top heading is the first version `changelogVersions` finds in
 *     `release.changelog` in the working tree, as `release status` reads
 *     it.
 *
 * ## When it warns
 *
 * A fragment waiting on the base, one that does not parse included, is
 * a release not yet settled, so the row then goes out as a warning
 * naming `rafa release settle`, in text mode and as a `log` event in
 * json mode alike. Otherwise it is an `info` line in text mode. A
 * reading that could not be made leaves its part as `?` and says why on
 * an indented line under the row. Nothing here changes `doctor`'s exit
 * code, and nothing is written.
 */
import type { WaitingReading } from './release/status-fragments.js';
import type { RafaContext } from '../cli/command.js';
import type { RafaConfig } from '../config.js';
import type { GitRunner } from '../pr/index.js';

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { createGitRunner } from '../pr/index.js';
import { resolveReleaseEnabled } from '../release/enabled.js';
import { changelogVersions, readTags } from '../release/status-readings.js';

import { forecastPhrase, readWaiting, waitingSettingsOf } from './release/status-fragments.js';

/** The command the warning names. */
export const SETTLE_COMMAND = 'rafa release settle';

/** What a part of the row reads as when nothing could be read for it. */
const UNREAD = '?';

/** The settings the row reads, named as the resolved config names them. */
export type DoctorReleaseConfig = Pick<
  RafaConfig,
  | 'prBase'
  | 'releaseEnabled'
  | 'releaseVersionFile'
  | 'releaseChangelog'
  | 'releaseFragments'
  | 'releaseStrategy'
  | 'releaseHeading'
>;

/** How the row reaches git; left out, the system's own. */
export interface DoctorReleaseSeams {
  /** Makes the git runner the row's reads go through, git at `root`. `createGitRunner` when left out. */
  readonly releaseGit?: (root: string) => GitRunner;
}

/** What {@link readDoctorRelease} reads from. */
export interface DoctorReleaseInput {
  /** The project root: git runs here, and the changelog is read under it. */
  readonly root: string;
  /** The resolved config. */
  readonly config: DoctorReleaseConfig;
}

/** The version the changelog's top heading names. */
export interface TopHeadingReading {
  /** The path as `release.changelog` spells it. */
  readonly path: string;
  /** The version of its first heading naming one, or null when none does or it could not be read. */
  readonly version: string | null;
  /**
   * True when no file is there: settle creates it (#842), so the row
   * says {@link MISSING_CHANGELOG} and prints no problem line for it.
   * False when the file was read or exists and could not be read.
   */
  readonly missing: boolean;
  /** Why the file could not be read, or null when it was. */
  readonly problem: string | null;
}

/** What a missing changelog reads as: settle's release commit creates it. */
export const MISSING_CHANGELOG = 'missing; rafa release settle creates it';

/** The row's reading: nothing for a project whose release is off. */
export type DoctorReleaseReading =
  | { readonly enabled: false }
  | {
    readonly enabled: true;
    /** The fragments waiting on the base, the base version and the forecast. */
    readonly waiting: WaitingReading;
    /** The latest release tag as git spells it, or null when there is none or the list failed. */
    readonly latestTag: string | null;
    /** Why the tags could not be listed, or null when they were. */
    readonly tagProblem: string | null;
    /** The version the changelog's top heading names. */
    readonly topHeading: TopHeadingReading;
  };

/**
 * The top heading's version of the changelog at `configured` under `root`.
 * An absent file sets `missing`; every failed read, absent or not,
 * carries its "could not be read" problem for the caller to word.
 */
export function readTopHeading(root: string, configured: string): TopHeadingReading {
  const resolved = join(root, configured);
  try {
    const text = readFileSync(resolved, 'utf8');
    return { path: configured, version: changelogVersions(text)[0] ?? null, missing: false, problem: null };
  } catch {
    return {
      path: configured,
      version: null,
      missing: !existsSync(resolved),
      problem: `the changelog could not be read at ${resolved}`,
    };
  }
}

/** The row's reading for the project; see the module note. Never a throw for a failed read. */
export function readDoctorRelease(input: DoctorReleaseInput, seams: DoctorReleaseSeams = {}): DoctorReleaseReading {
  if (!resolveReleaseEnabled(input.config, input.root).enabled) return { enabled: false };
  const git = (seams.releaseGit ?? createGitRunner)(input.root);
  const tags = readTags(git);
  return {
    enabled: true,
    waiting: readWaiting(git, waitingSettingsOf(input.config)),
    latestTag: tags.latest?.tag ?? null,
    tagProblem: tags.problem,
    topHeading: readTopHeading(input.root, input.config.releaseChangelog),
  };
}

/** How many fragments wait, the ones that do not parse included. */
export function waitingCount(waiting: WaitingReading): number {
  return waiting.fragments.length + waiting.malformed;
}

/** Whether `reading` is a release with fragments waiting to settle. */
export function releaseWaits(reading: DoctorReleaseReading): boolean {
  return reading.enabled && waitingCount(reading.waiting) > 0;
}

/** The latest tag part. */
function tagPart(latestTag: string | null, tagProblem: string | null): string {
  if (tagProblem !== null) return `latest tag ${UNREAD}`;
  return latestTag === null
    ? 'no release tag'
    : `latest tag ${latestTag}`;
}

/** The top heading part. */
function headingPart(heading: TopHeadingReading): string {
  if (heading.missing) return `${heading.path} ${MISSING_CHANGELOG}`;
  if (heading.problem !== null) return `${heading.path} tops at ${UNREAD}`;
  return heading.version === null
    ? `${heading.path} names no version`
    : `${heading.path} tops at ${heading.version}`;
}

/** The waiting part, and the command to run when any wait. */
function waitingPart(waiting: WaitingReading): string {
  if (!waiting.read) return `fragments ${UNREAD}`;
  const count = waitingCount(waiting);
  if (count === 0) return 'no fragment waits';
  const ids = waiting.fragments.map((each) => each.id);
  const named = ids.length === 0
    ? ''
    : ` (${ids.join(', ')})`;
  const counted = count === 1
    ? '1 fragment waits'
    : `${String(count)} fragments wait`;
  return `${counted}${named}: ${forecastPhrase(waiting)}; run ${SETTLE_COMMAND} to fold them into one version`;
}

/** The one row for an enabled reading. */
export function releaseRow(reading: Extract<DoctorReleaseReading, { enabled: true }>): string {
  const { waiting } = reading;
  const parts = [
    `${waiting.ref} at ${waiting.baseVersion ?? UNREAD}`,
    tagPart(reading.latestTag, reading.tagProblem),
    headingPart(reading.topHeading),
    waitingPart(waiting),
  ];
  return `Release: ${parts.join(', ')}.`;
}

/** Why each part that could not be read was not, one indented line each. */
export function releaseProblemLines(reading: DoctorReleaseReading): readonly string[] {
  if (!reading.enabled) return [];
  const problems = [
    ...reading.waiting.problems,
    ...(reading.tagProblem === null
      ? []
      : [reading.tagProblem]),
    ...(reading.topHeading.problem === null || reading.topHeading.missing
      ? []
      : [reading.topHeading.problem]),
  ];
  return problems.map((problem) => `  ${problem}`);
}

/**
 * Writes the row: a warning in both modes when fragments wait, an
 * `info` line in text mode otherwise, and the problem lines at `info`
 * in text mode. Nothing for a project whose release is off.
 */
export function writeDoctorRelease(
  context: Pick<RafaContext, 'output' | 'outputMode'>,
  reading: DoctorReleaseReading,
): void {
  if (!reading.enabled) return;
  const text = context.outputMode !== 'json';
  const row = releaseRow(reading);
  if (releaseWaits(reading)) context.output.warn(row);
  else if (text) context.output.info(row);
  if (!text) return;
  for (const line of releaseProblemLines(reading)) context.output.info(line);
}
