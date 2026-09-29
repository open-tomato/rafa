/**
 * The fifth reading of `rafa release status`: the change fragments
 * waiting on the base branch, and the release settling them now would
 * make.
 *
 * ```text
 *   waiting       2 fragments on origin/main at 0.25.0, settles as the next minor, 0.26.0
 *                 rafa-354  patch  2026-09-27  Loop pause waits for the commit
 *                 rafa-356  minor  2026-09-28  Releases settle on the base branch
 * ```
 *
 * ## Where it reads, and why it does not fetch
 *
 * The base is `origin/<pr.base>` (`main` when the project names no
 * `pr.base`), the ref `rafa release settle` folds. `release status`
 * reaches no network, so this reads the remote-tracking ref AS LAST
 * FETCHED: a `git fetch` is the operator's, and the cell names the ref
 * so the reading is never mistaken for the remote's live state. A
 * repository with no such ref reads as unreadable, with the reason
 * under the block, like every other reading of the action.
 *
 * The fragments come from `readFragmentTree` (`src/release/fragment-tree.ts`)
 * in the order settle folds them, the base version from `versionAt`
 * (`src/release/settle.ts`) at the same commit, and the forecast from
 * `forecastSettle` (`src/release/forecast.ts`): this module assembles no
 * `git` argv and calls no strategy, so the release it prints is the one
 * `rafa release settle --dry-run` would fold over the same tree.
 *
 * ## A fragment that does not parse
 *
 * Settle refuses the whole batch when one fragment on the base does not
 * parse, so no forecast is made either: the cell says settle would
 * refuse, and each such fragment gets a sentence under the block. The
 * fragments that do parse are still listed.
 */
import type { RafaConfig } from '../../config.js';
import type { PlanReleaseLevel } from '../../plan/parse.js';
import type { GitRunner } from '../../pr/index.js';
import type { SettleForecast } from '../../release/forecast.js';
import type { FoldFragment } from '../../release/strategy.js';

import { forecastSettle } from '../../release/forecast.js';
import { readFragmentTree } from '../../release/fragment-tree.js';
import { versionAt } from '../../release/settle.js';
import { releaseStrategyFor } from '../../release/strategy.js';
import { RELEASE_BASE_BRANCH, RELEASE_REMOTE } from '../../release/version.js';

/** The settings the reading takes, read off the project's config. */
export interface WaitingSettings {
  /** The ref the fragments are read at: `origin/<pr.base>`. */
  readonly ref: string;
  /** `release.fragments`. */
  readonly releaseFragments: string;
  /** `release.versionFile`. */
  readonly releaseVersionFile: string;
  /** `release.strategy`. */
  readonly releaseStrategy: RafaConfig['releaseStrategy'];
  /** `release.heading`. */
  readonly releaseHeading: string;
}

/** One fragment waiting on the base, as the block lists it. */
export interface WaitingFragment {
  /** The file name without `.md`. */
  readonly id: string;
  /** The path from the repository root. */
  readonly path: string;
  /** The level its front matter declares. */
  readonly level: PlanReleaseLevel;
  /** The plan title its front matter carries. */
  readonly title: string;
  /** The UTC date of the first-parent commit that added it. */
  readonly addedOn: string;
}

/** The fragments waiting on the base, and the release settling them would make. */
export interface WaitingReading {
  /** The ref they were read at. */
  readonly ref: string;
  /** False when the tree could not be read at all; the cell is then unreadable. */
  readonly read: boolean;
  /** The version the base declares, or null when it could not be read. */
  readonly baseVersion: string | null;
  /** The fragments that parse, in fold order. */
  readonly fragments: readonly WaitingFragment[];
  /** How many fragments do not parse; settle refuses the batch while any do. */
  readonly malformed: number;
  /** The forecast, or null when none could be made. */
  readonly forecast: SettleForecast | null;
  /** One sentence per thing that could not be read or folded. */
  readonly problems: readonly string[];
}

/** The settings of a config, the base falling back as settle's does. */
export function waitingSettingsOf(
  config: Pick<RafaConfig, 'prBase' | 'releaseFragments' | 'releaseVersionFile' | 'releaseStrategy' | 'releaseHeading'>,
): WaitingSettings {
  return {
    ref: `${RELEASE_REMOTE}/${config.prBase ?? RELEASE_BASE_BRANCH}`,
    releaseFragments: config.releaseFragments,
    releaseVersionFile: config.releaseVersionFile,
    releaseStrategy: config.releaseStrategy,
    releaseHeading: config.releaseHeading,
  };
}

/** A reading that got nothing, for `problem`. */
function unreadWaiting(ref: string, problem: string): WaitingReading {
  return { ref, read: false, baseVersion: null, fragments: [], malformed: 0, forecast: null, problems: [problem] };
}

/** The forecast over `folded`, or null with no problem when there is no base version or a bad fragment. */
function forecastOf(
  settings: WaitingSettings,
  baseVersion: string | null,
  folded: readonly FoldFragment[],
  malformed: number,
): SettleForecast | null {
  if (baseVersion === null || malformed > 0) return null;
  const strategy = releaseStrategyFor(settings.releaseStrategy, { heading: settings.releaseHeading });
  return forecastSettle({ strategy, baseVersion, waiting: folded });
}

/** The waiting fragments at `settings.ref` and their forecast; reads git objects only. */
export function readWaiting(git: GitRunner, settings: WaitingSettings): WaitingReading {
  const listed = readFragmentTree(git, settings.ref, settings.releaseFragments);
  if (!listed.ok) return unreadWaiting(settings.ref, listed.problem);

  const problems: string[] = [];
  const base = versionAt(git, listed.commit, settings.releaseVersionFile);
  const baseVersion = 'version' in base
    ? base.version
    : null;
  if ('problem' in base) problems.push(`the base version could not be read: ${base.problem}`);

  const folded: FoldFragment[] = [];
  const fragments: WaitingFragment[] = [];
  for (const each of listed.fragments) {
    if (!each.reading.ok) {
      problems.push(`${each.path} does not parse, so settle would refuse: ${each.reading.sentence}`);
      continue;
    }
    const { fragment } = each.reading;
    folded.push({ id: each.id, addedOn: each.addedOn, fragment });
    fragments.push({ id: each.id, path: each.path, level: fragment.level, title: fragment.title, addedOn: each.addedOn });
  }
  const malformed = listed.fragments.length - fragments.length;

  const forecast = forecastOf(settings, baseVersion, folded, malformed);
  if (forecast?.kind === 'failed') problems.push(forecast.sentence);
  return { ref: settings.ref, read: true, baseVersion, fragments, malformed, forecast, problems };
}

/** `count` fragments, spelled for the cell. */
function fragmentCount(count: number): string {
  return count === 1
    ? '1 fragment'
    : `${count} fragments`;
}

/** What the cell says after the count: the forecast, or why there is none. */
export function forecastPhrase(reading: WaitingReading): string {
  if (reading.malformed > 0) return `${reading.malformed} does not parse, so settle would refuse`;
  if (reading.forecast === null) return 'no forecast, the base version could not be read';
  if (reading.forecast.kind === 'failed') return 'the forecast failed';
  return reading.forecast.sentence;
}

/**
 * The `waiting` cell, or null when the tree could not be read and the
 * caller renders its own unreadable mark.
 */
export function waitingCell(reading: WaitingReading): string | null {
  if (!reading.read) return null;
  const total = reading.fragments.length + reading.malformed;
  if (total === 0) return `none on ${reading.ref}`;
  const at = reading.baseVersion === null
    ? ''
    : ` at ${reading.baseVersion}`;
  return `${fragmentCount(total)} on ${reading.ref}${at}, ${forecastPhrase(reading)}`;
}

/** One line per fragment that parses, in fold order: id, level, add date and title, in columns. */
export function waitingLines(reading: WaitingReading): readonly string[] {
  const idWidth = Math.max(0, ...reading.fragments.map((each) => each.id.length));
  const levelWidth = Math.max(0, ...reading.fragments.map((each) => each.level.length));
  return reading.fragments.map((each) => [
    each.id.padEnd(idWidth),
    each.level.padEnd(levelWidth),
    each.addedOn,
    each.title,
  ].join('  '));
}
