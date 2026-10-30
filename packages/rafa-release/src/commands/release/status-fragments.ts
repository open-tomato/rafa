/**
 * The fifth reading of `rafa release status`: the change fragments
 * waiting on the base branch, and the release settling them now would
 * make.
 *
 * ```text
 *   waiting       3 fragments on origin/main at 0.25.0, settles as the next minor, 0.26.0; @scope/plugin 0.1.0 → 0.2.0
 *                 rafa-354  patch  2026-09-27  Loop pause waits for the commit
 *                 rafa-356  minor  2026-09-28  Releases settle on the base branch
 *                 rafa-357  minor  2026-09-29  Plugin hooks  for @scope/plugin
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
 * The fragments come from `readFragmentTree` (`packages/rafa-release/src/release/fragment-tree.ts`)
 * in the order settle folds them, the base version from `versionAt`
 * (`packages/rafa-release/src/release/settle.ts`) at the same commit, and the forecast from
 * `forecastSettle` (`packages/rafa-release/src/release/forecast.ts`): this module assembles no
 * `git` argv and calls no strategy, so the release it prints is the one
 * `rafa release settle --dry-run` would fold over the same tree.
 *
 * ## One forecast per unit
 *
 * The fragments are split the way settle splits them, through
 * `groupSettleFragments` (`packages/rafa-release/src/release/settle-groups.ts`): the root's
 * batch, the fragments with no `package` line, is forecast over the
 * version `release.versionFile` declares; each workspace package a
 * fragment names is forecast over the `version` of its own
 * `<dir>/package.json`, read at the same commit with `versionAt`. The
 * workspace is listed (`readWorkspacePackagesAt`,
 * `packages/rafa-release/src/release/workspace-packages.ts`) only when some fragment names a
 * package, as settle lists it. The cell carries the root's phrase, then
 * `; <name> <base> → <next>` per package in workspace order; the root's
 * phrase is left out when only packages have fragments waiting. A
 * fragment's line names its package after its title.
 *
 * ## A fragment that does not parse
 *
 * Settle refuses the whole batch when one fragment on the base does not
 * parse, so no forecast is made either: the cell says settle would
 * refuse, and each such fragment gets a sentence under the block. The
 * fragments that do parse are still listed. A fragment naming a package
 * the workspace at that commit lacks, or a private one, makes settle
 * refuse the same way: no forecast, and the grouping's sentence under
 * the block.
 */
import type { SettleForecast } from '../../release/forecast.js';
import type { SettleFragment } from '../../release/settle.js';
import type { RafaConfig } from '@open-tomato/rafa/core/config';
import type { GitRunner } from '@open-tomato/rafa/core/git';
import type { PlanReleaseLevel } from '@open-tomato/rafa/core/plan';

import { forecastSettle } from '../../release/forecast.js';
import { readFragmentTree } from '../../release/fragment-tree.js';
import { groupSettleFragments } from '../../release/settle-groups.js';
import { versionAt } from '../../release/settle.js';
import { releaseStrategyFor } from '../../release/strategy.js';
import { RELEASE_BASE_BRANCH, RELEASE_REMOTE } from '../../release/version.js';
import { readWorkspacePackagesAt } from '../../release/workspace-packages.js';

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
  /** The workspace package its front matter names, or null for the root. */
  readonly package: string | null;
  /** The UTC date of the first-parent commit that added it. */
  readonly addedOn: string;
}

/** One workspace package some waiting fragment names, and the release settling its batch would make. */
export interface WaitingPackage {
  /** The package's manifest `name`. */
  readonly package: string;
  /** The version its `<dir>/package.json` declares at the base, or null when it could not be read. */
  readonly baseVersion: string | null;
  /** The forecast over its batch, or null when its base version could not be read. */
  readonly forecast: SettleForecast | null;
}

/** The fragments waiting on the base, and the release settling them would make. */
export interface WaitingReading {
  /** The ref they were read at. */
  readonly ref: string;
  /** False when the tree could not be read at all; the cell is then unreadable. */
  readonly read: boolean;
  /** The version the root's version file declares at the base, or null when it could not be read. */
  readonly baseVersion: string | null;
  /** The fragments that parse, in fold order, the root's and every package's. */
  readonly fragments: readonly WaitingFragment[];
  /** How many fragments do not parse; settle refuses the batch while any do. */
  readonly malformed: number;
  /** How many fragments name a package the workspace lacks or a private one; settle refuses the batch while any do. */
  readonly refused: number;
  /** The forecast over the root's batch, or null when none could be made. */
  readonly forecast: SettleForecast | null;
  /**
   * One entry per package some fragment names, in workspace order; empty
   * when none is named or no grouping was made, null when the workspace
   * could not be read.
   */
  readonly packages: readonly WaitingPackage[] | null;
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
  return {
    ref,
    read: false,
    baseVersion: null,
    fragments: [],
    malformed: 0,
    refused: 0,
    forecast: null,
    packages: [],
    problems: [problem],
  };
}

/** The forecasts and sentences one grouping answers. */
interface GroupedForecasts {
  readonly refused: number;
  readonly forecast: SettleForecast | null;
  readonly packages: readonly WaitingPackage[] | null;
  readonly problems: readonly string[];
}

/** No forecast at all, the packages as given, with `problems`. */
function noForecasts(packages: readonly WaitingPackage[] | null, problems: readonly string[], refused = 0): GroupedForecasts {
  return { refused, forecast: null, packages, problems };
}

/**
 * The fragments grouped per unit as settle groups them, the root's batch
 * forecast over `baseVersion` and each package's over the version its
 * manifest declares at `commit`.
 */
function forecastUnits(
  git: GitRunner,
  settings: WaitingSettings,
  commit: string,
  baseVersion: string,
  folded: readonly SettleFragment[],
): GroupedForecasts {
  const named = folded.some((each) => each.fragment.package !== null);
  const workspace = named
    ? readWorkspacePackagesAt(git, commit)
    : { ok: true as const, packages: [] };
  if (!workspace.ok) return noForecasts(null, [`the workspace could not be read: ${workspace.problem}`]);
  const grouped = groupSettleFragments(folded, workspace.packages, commit);
  if (!grouped.ok) return noForecasts([], grouped.problems.map((each) => `${each}, so settle would refuse`), grouped.problems.length);

  const strategy = releaseStrategyFor(settings.releaseStrategy, { heading: settings.releaseHeading });
  const forecast = forecastSettle({ strategy, baseVersion, waiting: grouped.root });
  const problems: string[] = forecast.kind === 'failed'
    ? [forecast.sentence]
    : [];
  const packages = grouped.packages.map((group): WaitingPackage => {
    const name = group.package.name;
    const base = versionAt(git, commit, group.package.manifestPath);
    if ('problem' in base) {
      problems.push(`the base version of ${name} could not be read: ${base.problem}`);
      return { package: name, baseVersion: null, forecast: null };
    }
    const each = forecastSettle({ strategy, baseVersion: base.version, waiting: group.fragments });
    if (each.kind === 'failed') problems.push(`${name}: ${each.sentence}`);
    return { package: name, baseVersion: base.version, forecast: each };
  });
  return { refused: 0, forecast, packages, problems };
}

/** The waiting fragments at `settings.ref` and the forecast of each unit; reads git objects only. */
export function readWaiting(git: GitRunner, settings: WaitingSettings): WaitingReading {
  const listed = readFragmentTree(git, settings.ref, settings.releaseFragments);
  if (!listed.ok) return unreadWaiting(settings.ref, listed.problem);

  const problems: string[] = [];
  const base = versionAt(git, listed.commit, settings.releaseVersionFile);
  const baseVersion = 'version' in base
    ? base.version
    : null;
  if ('problem' in base) problems.push(`the base version could not be read: ${base.problem}`);

  const folded: SettleFragment[] = [];
  const fragments: WaitingFragment[] = [];
  for (const each of listed.fragments) {
    if (!each.reading.ok) {
      problems.push(`${each.path} does not parse, so settle would refuse: ${each.reading.sentence}`);
      continue;
    }
    const { fragment } = each.reading;
    folded.push({ id: each.id, path: each.path, commit: each.commit, addedOn: each.addedOn, fragment });
    fragments.push({
      id: each.id,
      path: each.path,
      level: fragment.level,
      title: fragment.title,
      package: fragment.package,
      addedOn: each.addedOn,
    });
  }
  const malformed = listed.fragments.length - fragments.length;

  const units = baseVersion === null || malformed > 0
    ? noForecasts([], [])
    : forecastUnits(git, settings, listed.commit, baseVersion, folded);
  return {
    ref: settings.ref,
    read: true,
    baseVersion,
    fragments,
    malformed,
    refused: units.refused,
    forecast: units.forecast,
    packages: units.packages,
    problems: [...problems, ...units.problems],
  };
}

/** `count` fragments, spelled for the cell. */
function fragmentCount(count: number): string {
  return count === 1
    ? '1 fragment'
    : `${count} fragments`;
}

/** One package's part of the cell: its move, or why there is none. */
function packagePhrase(each: WaitingPackage): string {
  if (each.forecast === null) return `${each.package} no forecast, its base version could not be read`;
  if (each.forecast.kind === 'settles') return `${each.package} ${String(each.baseVersion)} → ${each.forecast.version}`;
  if (each.forecast.kind === 'failed') return `${each.package} forecast failed`;
  return `${each.package} ${each.forecast.sentence}`;
}

/** The root's part of the cell. */
function rootPhrase(forecast: SettleForecast): string {
  return forecast.kind === 'failed'
    ? 'the forecast failed'
    : forecast.sentence;
}

/**
 * What the cell says after the count: the root's forecast, then
 * `; <name> <base> → <next>` per package, or why there is none.
 */
export function forecastPhrase(reading: WaitingReading): string {
  if (reading.malformed > 0) return `${reading.malformed} does not parse, so settle would refuse`;
  if (reading.baseVersion === null) return 'no forecast, the base version could not be read';
  if (reading.refused > 0) return `${reading.refused} names a package settle cannot release, so settle would refuse`;
  if (reading.packages === null) return 'no forecast, the workspace could not be read';
  if (reading.forecast === null) return 'no forecast';
  const packages = reading.packages.map(packagePhrase);
  const root = reading.forecast.kind === 'empty' && packages.length > 0
    ? []
    : [rootPhrase(reading.forecast)];
  return [...root, ...packages].join('; ');
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

/**
 * One line per fragment that parses, in fold order: id, level, add date
 * and title, in columns, then `for <name>` when it names a package.
 */
export function waitingLines(reading: WaitingReading): readonly string[] {
  const idWidth = Math.max(0, ...reading.fragments.map((each) => each.id.length));
  const levelWidth = Math.max(0, ...reading.fragments.map((each) => each.level.length));
  return reading.fragments.map((each) => [
    each.id.padEnd(idWidth),
    each.level.padEnd(levelWidth),
    each.addedOn,
    each.title,
    ...(each.package === null
      ? []
      : [`for ${each.package}`]),
  ].join('  '));
}
