/**
 * Settle's build: the fragments waiting on the base branch folded into
 * one release commit, inside the scratch worktree `./settle-worktree.ts`
 * made, and the same reading answered without writing for a dry run.
 *
 * ```text
 * readSettle(git, tree, settings)   → the reading; writes nothing
 * buildSettle(worktree, settings)   → the reading, then write, delete, commit
 * ```
 *
 * ## The reading
 *
 * {@link readSettle} lists the fragments present in `tree` and orders
 * them by the first-parent commit that added each (`./fragment-tree.ts`),
 * reads the version `release.versionFile` declares at that same commit,
 * and splits the fragments into one batch per unit
 * (`groupSettleFragments`, `./settle-groups.ts`): the root's, the
 * fragments with no `package` line, and one per workspace package a
 * fragment names, in workspace order. The workspace is listed at that
 * commit (`readWorkspacePackagesAt`, `./workspace-packages.ts`) only
 * when some fragment names a package, so a batch of root fragments asks
 * nothing of the root manifest's `workspaces`. Each batch is then folded
 * from its own base version through `foldWithStrategy`
 * (`./strategy.ts`), the one place a fold is called: the root's from
 * `release.versionFile`, a package's from the `version` of
 * `<dir>/package.json` ({@link versionAt}), with `<dir>/CHANGELOG.md` as
 * its changelog. A package no fragment names is never folded. Everything
 * it reads is a git object — a tree listing, a log, a blob — so it
 * writes nothing: no file, no index entry, no ref. That is the dry run,
 * and it answers the same over the caller's repository at
 * `origin/<pr.base>` as over the worktree at `HEAD`, because the tree is
 * resolved to one commit first and every later read names that hash.
 *
 * It answers one of five {@link SettleReading} outcomes, each naming the
 * strategy the settle runs under:
 *
 *   - `unread`: the tree, the root's base version, the workspace or a
 *     package's base version could not be read, or — after a fold that
 *     answered — the tree could not be listed for that unit's
 *     changelog, or, under `release.moveLock` with the root folded, the
 *     lock step refused (`readSettleLock`, `./settle-lock.ts`): the
 *     manifest names a package other than rafa's, or `rafa.lock` at
 *     that commit does not read as a lock. Nothing is written.
 *   - `malformed`: a fragment on the base cannot be folded: it does not
 *     parse, or it names a package the workspace at that commit lacks or
 *     a private one. Settle REFUSES the whole batch rather than folding
 *     the rest: a fragment left out would release later, out of the
 *     order the base received it, and its level (a `major`, say) would
 *     be missing from the release it belongs to. One sentence per
 *     fragment names its path and what is wrong with it; the package
 *     check runs only over a batch that parses.
 *   - `failed`: the strategy threw on one unit; the port's one line
 *     names it and the error, opened by the package's name for a
 *     package's unit, and nothing is written.
 *   - `nothing`: every unit's fold answered null — no fragment, or only
 *     `level: none` ones. Nothing to settle: no commit, and `none`
 *     fragments stay until a release commit that ships something for
 *     their unit deletes them with the rest of its batch.
 *   - `folded`: one {@link SettleUnitFold} per unit whose fold answered
 *     ({@link SettleFolded.units}), the root's first when it folded:
 *     its version and section, its base version, its files, its
 *     fragments in fold order, and whether its changelog is missing
 *     from that commit's tree, so a dry run can say the settle will
 *     create it; with the root's base version and every fragment
 *     present; and, under `release.moveLock` with the root folded, how
 *     the release commit moves `rafa.lock` ({@link SettleFolded.lock}),
 *     read as blobs at that same commit, null otherwise.
 *
 * ## The build
 *
 * {@link buildSettle} reads at the worktree's `HEAD` and, only for
 * `folded`, builds one release commit moving every unit in the
 * worktree's directory:
 *
 *   1. for each unit in unit order — the root's first when it folded,
 *      then the packages in workspace order — writes the version into
 *      the unit's version file byte-safely (`writeManifestVersion`,
 *      `./version.ts`), refusing a file whose version on disk is not the
 *      unit's base version, then inserts the unit's section at its
 *      changelog's insert point (`insertChangelogEntry`,
 *      `./changelog.ts`), or — when that changelog does not exist —
 *      creates it holding {@link CHANGELOG_TITLE} and the section, and
 *      names it in {@link SettleBuilt.createdChangelog} (#842). Only a
 *      file that is absent is created: one that exists and cannot be
 *      read, or a directory the file cannot be written in, still answers
 *      `unbuilt`. The parent directory is not made, so a changelog under
 *      a directory the base lacks is a problem too. A package no
 *      fragment names is no unit, so its files are never touched;
 *   2. under `release.moveLock` ({@link SettleFolded.lock} set), writes
 *      `rafa.lock` at the worktree root recording the root's version
 *      (`writeSettleLock`, `./settle-lock.ts`), creating it when the
 *      base holds none; with the key off the lock is never touched;
 *   3. stages every unit's two files, and `rafa.lock` when step 2 wrote
 *      it, and `git rm`s every fragment of every unit, `none` ones
 *      included, since the units' receipts name them all
 *      ({@link SettleBuilt.deleted}, one entry per unit);
 *   4. commits `releaseCommitSubject` of {@link settleMoves}
 *      (`./release-move.ts`) — `chore: release <version>` for the root
 *      alone, `chore: release 0.46.0, @scope/plugin@0.2.0` for the root
 *      and a package — with the repository's hooks running as they
 *      would for any commit.
 *
 * Delivery — the push, a retry, the release pull request — is the
 * caller's (`./settle-push.ts`, `./settle-pr.ts`); this module never
 * touches a remote.
 *
 * A step that fails answers `unbuilt` with one sentence and leaves the
 * worktree as that step left it: a half-written version file, a staged
 * deletion. The worktree is scratch, removed with `--force` on every
 * path out, and a caller that builds again in the same worktree resets
 * it to the new base first. Every other outcome writes nothing at all,
 * so a reading that is not `folded` is passed through unchanged.
 */
import type { BranchForecastSettings } from './branch-forecast.js';
import type { ChangelogInsertPoint } from './changelog.js';
import type { ReleaseMove } from './release-move.js';
import type { SettleLockPlan } from './settle-lock.js';
import type { SettleWorktree } from './settle-worktree.js';
import type { FoldFragment, ReleaseStrategyAdapter } from './strategy.js';
import type { ReleaseStrategy } from '@open-tomato/rafa/core/config/sections';
import type { GitRunner } from '@open-tomato/rafa/core/git';

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { messageOf } from '@open-tomato/rafa/core/config/sections';
import { gitSaid } from '@open-tomato/rafa/core/git';
import { errorCode } from '@open-tomato/rafa/core/loop';

import { insertChangelogEntry } from './changelog.js';
import { readFragmentTree } from './fragment-tree.js';
import { releaseCommitSubject } from './release-move.js';
import { groupSettleFragments } from './settle-groups.js';
import { readSettleLock, writeSettleLock } from './settle-lock.js';
import { foldWithStrategy, releaseStrategyFor } from './strategy.js';
import { gitPathOf, readManifestVersion, writeManifestVersion } from './version.js';
import { readWorkspacePackagesAt } from './workspace-packages.js';

/** The settings a settle reads, named as `ResolvedConfig` names them. */
export interface SettleSettings extends BranchForecastSettings {
  /** `release.changelog`, the file the section is inserted into. */
  readonly releaseChangelog: string;
  /** `release.fragments`, the directory the waiting fragments sit in. */
  readonly releaseFragments: string;
  /** `release.moveLock`, whether the release commit moves `rafa.lock` to the version it settles. */
  readonly releaseMoveLock: boolean;
}

/** One fragment a settle folds: the fold's view of it, and where it sits. */
export interface SettleFragment extends FoldFragment {
  /** The path from the repository root, e.g. `.changes/rafa-247.md`. */
  readonly path: string;
  /** The full hash of the first-parent commit that added it to the base. */
  readonly commit: string;
}

/** What every reading that got as far as the fold carries. */
interface SettleBasis {
  /** The strategy the settle runs under, and that answered the fold. */
  readonly strategy: ReleaseStrategy;
  /** The full hash of the commit the tree was read at. */
  readonly commit: string;
  /** The version `release.versionFile` declared at that commit: the root's, whatever the units. */
  readonly baseVersion: string;
  /** The fragments present, in fold order, every unit's together. */
  readonly fragments: readonly SettleFragment[];
}

/** The tree, a base version, the workspace or a changelog listing could not be read. */
export interface SettleUnread {
  readonly outcome: 'unread';
  readonly strategy: ReleaseStrategy;
  /** One sentence naming what could not be read. */
  readonly problem: string;
}

/**
 * A fragment on the base cannot be folded — it does not parse, or it
 * names a package the workspace lacks or a private one — so no fragment
 * is folded.
 */
export interface SettleMalformed {
  readonly outcome: 'malformed';
  readonly strategy: ReleaseStrategy;
  /** The full hash of the commit the tree was read at. */
  readonly commit: string;
  /** One sentence per fragment that cannot be folded, in add order. */
  readonly problems: readonly string[];
}

/** The strategy threw while folding one unit. */
export interface SettleFailed extends SettleBasis {
  readonly outcome: 'failed';
  /** The port's one line naming the strategy and the error, opened by the unit's package for a package. */
  readonly line: string;
}

/** Every unit's fold answered null: no fragment, or only `none` ones. */
export interface SettleNothing extends SettleBasis {
  readonly outcome: 'nothing';
}

/**
 * One unit a settle moves — the root, or one workspace package — with
 * what its fold answered. Every path is from the repository root.
 */
export interface SettleUnitFold {
  /** The package's manifest `name`, or null for the root. */
  readonly package: string | null;
  /** The unit's directory: `.` for the root, `packages/plugin` for a package. */
  readonly dir: string;
  /** The file the version is written into: `release.versionFile` as configured for the root, `<dir>/package.json` for a package. */
  readonly versionFile: string;
  /** The file the section goes into: `release.changelog` as configured for the root, `<dir>/CHANGELOG.md` for a package. */
  readonly changelog: string;
  /** The version {@link versionFile} declared at {@link SettleBasis.commit}. */
  readonly baseVersion: string;
  /** The version the unit moves to. */
  readonly version: string;
  /** The changelog section, receipt included, with no trailing newline. */
  readonly section: string;
  /**
   * True when {@link changelog} is absent from the tree at
   * {@link SettleBasis.commit}, so a build will create it rather than
   * insert into it.
   */
  readonly changelogMissing: boolean;
  /** The unit's fragments, in fold order: the ones its section's receipt names. */
  readonly fragments: readonly SettleFragment[];
}

/** At least one unit's fold answered a version and a section. */
export interface SettleFolded extends SettleBasis {
  readonly outcome: 'folded';
  /** Every unit that folded: the root's first when it did, then the packages in workspace order. */
  readonly units: readonly SettleUnitFold[];
  /**
   * How the release commit moves `rafa.lock`, read at
   * {@link SettleBasis.commit}; null when `release.moveLock` is off or
   * the root folded nothing, so the build leaves the lock alone.
   */
  readonly lock: SettleLockPlan | null;
}

/** What {@link readSettle} answers; see the module note. */
export type SettleReading = SettleUnread | SettleMalformed | SettleFailed | SettleNothing | SettleFolded;

/** A folded batch whose commit could not be built. */
export interface SettleUnbuilt extends Omit<SettleFolded, 'outcome'> {
  readonly outcome: 'unbuilt';
  /** One sentence naming the step that failed and why. */
  readonly problem: string;
}

/** The fragments the release commit deleted for one unit. */
export interface SettleUnitDeleted {
  /** The unit's package, or null for the root. */
  readonly package: string | null;
  /** The fragment paths, in fold order: the ones the unit's receipt names. */
  readonly paths: readonly string[];
}

/** Where the release commit put one unit's section. */
export interface SettleUnitInsert {
  /** The unit's package, or null for the root. */
  readonly package: string | null;
  /** The unit's changelog path, from the repository root. */
  readonly changelog: string;
  /** Where the section went; `file-end` for a changelog the build created. */
  readonly point: ChangelogInsertPoint;
}

/**
 * A folded batch committed in the worktree: one commit moving every
 * unit. Its `lock`, passed through from the reading, is what the commit
 * wrote into `rafa.lock`: null when the commit left the lock alone.
 */
export interface SettleBuilt extends Omit<SettleFolded, 'outcome'> {
  readonly outcome: 'built';
  /** The full hash of the release commit; its parent is {@link SettleBasis.commit}. */
  readonly release: string;
  /** The fragments the commit deleted, one entry per unit in unit order. */
  readonly deleted: readonly SettleUnitDeleted[];
  /** Where each unit's section went, one entry per unit in unit order. */
  readonly insertPoints: readonly SettleUnitInsert[];
  /** The changelog paths the build created, one per unit whose changelog was absent, in unit order; empty when it created none. */
  readonly createdChangelog: readonly string[];
}

/** What {@link buildSettle} answers: a reading that wrote nothing, or the build. */
export type SettleBuild = Exclude<SettleReading, SettleFolded> | SettleUnbuilt | SettleBuilt;

/** The heading a changelog the build creates opens with, above the settled section. */
export const CHANGELOG_TITLE = '# Changelog';

/** The file name of a package unit's changelog, in the package's directory. */
const PACKAGE_CHANGELOG = 'CHANGELOG.md';

/**
 * The moves a folded settle makes, one per unit in unit order, each
 * from the unit's base version to its folded one.
 */
export function settleMoves(reading: Pick<SettleFolded, 'units'>): readonly ReleaseMove[] {
  return reading.units.map((unit) => ({ package: unit.package, dir: unit.dir, from: unit.baseVersion, to: unit.version }));
}

/**
 * The version `versionFile` declares at `commit`, or the sentence saying
 * why not. Reads one blob; `rafa release status` reads the base version
 * its forecast folds from through it too.
 */
export function versionAt(
  git: GitRunner,
  commit: string,
  versionFile: string,
): { readonly version: string } | { readonly problem: string } {
  const where = `${commit}:${gitPathOf(versionFile)}`;
  const shown = git(['show', where]);
  if (!shown.ok) return { problem: `${where} could not be read: ${gitSaid(shown)}` };
  const version = readManifestVersion(shown.stdout);
  return version === null
    ? { problem: `${where} declares no version` }
    : { version };
}

/** One unit before its fold: where it sits, its files and its fragments. */
interface UnitBatch {
  readonly package: string | null;
  readonly dir: string;
  readonly versionFile: string;
  readonly changelog: string;
  readonly fragments: readonly SettleFragment[];
}

/** What folding one unit answers: the unit, null for a fold of nothing, or why it stopped. */
type UnitOutcome =
  | { readonly unit: SettleUnitFold | null }
  | { readonly problem: string }
  | { readonly line: string };

/** What folding every unit answers: the units that folded, or the first stop. */
type UnitsOutcome =
  | { readonly units: readonly SettleUnitFold[] }
  | { readonly problem: string }
  | { readonly line: string };

/**
 * The settle of the fragments in `tree` (a commit-ish: `HEAD` in the
 * worktree, `origin/main` in the caller's repository), folded one unit
 * at a time by the configured strategy. Reads git objects only and
 * writes nothing; see the module note for the five outcomes.
 */
export function readSettle(git: GitRunner, tree: string, settings: SettleSettings): SettleReading {
  const strategy = releaseStrategyFor(settings.releaseStrategy, { heading: settings.releaseHeading });
  const listed = readFragmentTree(git, tree, settings.releaseFragments);
  if (!listed.ok) return { outcome: 'unread', strategy: strategy.name, problem: listed.problem };
  const { commit } = listed;

  const base = versionAt(git, commit, settings.releaseVersionFile);
  if ('problem' in base) return { outcome: 'unread', strategy: strategy.name, problem: base.problem };

  const fragments: SettleFragment[] = [];
  const problems: string[] = [];
  for (const each of listed.fragments) {
    if (each.reading.ok) {
      fragments.push({ id: each.id, path: each.path, commit: each.commit, addedOn: each.addedOn, fragment: each.reading.fragment });
    } else {
      problems.push(`${each.path} does not parse: ${each.reading.sentence}`);
    }
  }
  if (problems.length > 0) return { outcome: 'malformed', strategy: strategy.name, commit, problems };

  const batches = unitBatches(git, commit, fragments, settings);
  if ('problem' in batches) return { outcome: 'unread', strategy: strategy.name, problem: batches.problem };
  if ('problems' in batches) return { outcome: 'malformed', strategy: strategy.name, commit, problems: batches.problems };

  const basis = { strategy: strategy.name, commit, baseVersion: base.version, fragments };
  const folded = foldUnits(git, commit, strategy, batches.batches, base.version);
  if ('problem' in folded) return { outcome: 'unread', strategy: strategy.name, problem: folded.problem };
  if ('line' in folded) return { ...basis, outcome: 'failed', line: folded.line };
  if (folded.units.length === 0) return { ...basis, outcome: 'nothing' };

  const root = folded.units.find((unit) => unit.package === null);
  const lock = settings.releaseMoveLock && root !== undefined
    ? readSettleLock(git, commit, settings.releaseVersionFile, root.version)
    : null;
  if (lock !== null && 'problem' in lock) return { outcome: 'unread', strategy: strategy.name, problem: lock.problem };
  return { ...basis, outcome: 'folded', units: folded.units, lock };
}

/**
 * The fragments split into one batch per unit: the root's first, always,
 * then one per package some fragment names, in workspace order. The
 * workspace is read at `commit` only when a fragment names a package, so
 * a batch of root fragments asks nothing of the root manifest's
 * `workspaces`.
 */
function unitBatches(
  git: GitRunner,
  commit: string,
  fragments: readonly SettleFragment[],
  settings: SettleSettings,
): { readonly batches: readonly UnitBatch[] } | { readonly problem: string } | { readonly problems: readonly string[] } {
  const named = fragments.some((each) => each.fragment.package !== null);
  const workspace = named
    ? readWorkspacePackagesAt(git, commit)
    : { ok: true as const, packages: [] };
  if (!workspace.ok) return { problem: workspace.problem };
  const grouped = groupSettleFragments(fragments, workspace.packages, commit);
  if (!grouped.ok) return { problems: grouped.problems };

  const root: UnitBatch = { package: null, dir: '.', versionFile: settings.releaseVersionFile, changelog: settings.releaseChangelog, fragments: grouped.root };
  const packages = grouped.packages.map((group): UnitBatch => ({
    package: group.package.name,
    dir: group.package.dir,
    versionFile: group.package.manifestPath,
    changelog: `${group.package.dir}/${PACKAGE_CHANGELOG}`,
    fragments: group.fragments,
  }));
  return { batches: [root, ...packages] };
}

/** Every batch folded in order; the units that folded, or the first unit that stopped. */
function foldUnits(
  git: GitRunner,
  commit: string,
  strategy: ReleaseStrategyAdapter,
  batches: readonly UnitBatch[],
  rootVersion: string,
): UnitsOutcome {
  const units: SettleUnitFold[] = [];
  for (const batch of batches) {
    const outcome = foldUnit(git, commit, strategy, batch, rootVersion);
    if (!('unit' in outcome)) return outcome;
    if (outcome.unit !== null) units.push(outcome.unit);
  }
  return { units };
}

/**
 * One batch folded from its own base version — the root's read already,
 * a package's read from its manifest at `commit` — with its changelog
 * listed at `commit` when the fold answered.
 */
function foldUnit(
  git: GitRunner,
  commit: string,
  strategy: ReleaseStrategyAdapter,
  batch: UnitBatch,
  rootVersion: string,
): UnitOutcome {
  const base = batch.package === null
    ? { version: rootVersion }
    : versionAt(git, commit, batch.versionFile);
  if ('problem' in base) return base;

  const folded = foldWithStrategy(strategy, base.version, batch.fragments);
  if (!folded.ok) {
    return batch.package === null
      ? { line: folded.line }
      : { line: `${batch.package}: ${folded.line}` };
  }
  if (folded.result === null) return { unit: null };

  const missing = changelogMissingAt(git, commit, batch.changelog);
  if (typeof missing === 'object') return missing;
  return {
    unit: {
      ...batch,
      baseVersion: base.version,
      version: folded.result.version,
      section: folded.result.section,
      changelogMissing: missing,
    },
  };
}

/**
 * Whether `changelog` is absent from the tree at `commit`, read as a
 * tree listing so it writes nothing; the sentence when git could not
 * list it.
 */
function changelogMissingAt(git: GitRunner, commit: string, changelog: string): boolean | { readonly problem: string } {
  const path = gitPathOf(changelog);
  const listed = git(['ls-tree', '--name-only', commit, '--', path]);
  if (!listed.ok) return { problem: `${commit}:${path} could not be listed: ${gitSaid(listed)}` };
  return listed.stdout.trim() === '';
}

/** The reading as `unbuilt`, with `problem`. */
function unbuilt(reading: SettleFolded, problem: string): SettleUnbuilt {
  return { ...reading, outcome: 'unbuilt', problem };
}

/** Writes the unit's version file; answers the problem, or null when written. */
function writeVersion(root: string, unit: SettleUnitFold): string | null {
  const written = writeManifestVersion(join(root, gitPathOf(unit.versionFile)), unit.version);
  if (!written.written) return written.problem ?? `${unit.versionFile} was not written`;
  if (written.previous !== unit.baseVersion) {
    return `${unit.versionFile} declared ${String(written.previous)} in the worktree, where the base commit declares ${unit.baseVersion}`;
  }
  return null;
}

/** What {@link writeChangelog} answers: where the section went and whether the file was made, or the problem. */
type ChangelogWrite =
  | { readonly point: ChangelogInsertPoint; readonly created: boolean }
  | { readonly problem: string };

/**
 * Inserts the unit's section into its changelog, or creates the
 * changelog holding {@link CHANGELOG_TITLE} and the section when it does
 * not exist; answers where the section went and whether the file was
 * created, or the problem. Only `ENOENT` reads as absent: any other
 * read error is a problem, as is a write the directory refuses.
 */
function writeChangelog(root: string, unit: SettleUnitFold): ChangelogWrite {
  const path = join(root, gitPathOf(unit.changelog));
  let text: string;
  let created = false;
  try {
    text = readFileSync(path, 'utf8');
  } catch (error) {
    if (errorCode(error) !== 'ENOENT') return { problem: `${unit.changelog} could not be read: ${messageOf(error)}` };
    text = `${CHANGELOG_TITLE}\n`;
    created = true;
  }
  const inserted = insertChangelogEntry(text, unit.section);
  const verb = created
    ? 'created'
    : 'written';
  try {
    writeFileSync(path, inserted.text);
  } catch (error) {
    return { problem: `${unit.changelog} could not be ${verb}: ${messageOf(error)}` };
  }
  return { point: inserted.point, created };
}

/** What writing every unit answers: each unit's changelog write in unit order, or the first problem. */
type UnitsWrite =
  | { readonly inserts: readonly SettleUnitInsert[]; readonly created: readonly string[] }
  | { readonly problem: string };

/**
 * Writes each unit's version file, then its changelog, unit by unit in
 * unit order; answers where each section went and the changelogs
 * created, or the first problem, leaving the files written before it.
 */
function writeUnits(root: string, units: readonly SettleUnitFold[]): UnitsWrite {
  const inserts: SettleUnitInsert[] = [];
  const created: string[] = [];
  for (const unit of units) {
    const versionProblem = writeVersion(root, unit);
    if (versionProblem !== null) return { problem: versionProblem };
    const changelog = writeChangelog(root, unit);
    if ('problem' in changelog) return changelog;
    inserts.push({ package: unit.package, changelog: unit.changelog, point: changelog.point });
    if (changelog.created) created.push(unit.changelog);
  }
  return { inserts, created };
}

/** Writes `rafa.lock` at `root` as the plan says; answers the problem, or null when written. */
function writeLock(root: string, lock: SettleLockPlan): string | null {
  try {
    writeSettleLock(root, lock.to);
  } catch (error) {
    return `${lock.path} could not be written: ${messageOf(error)}`;
  }
  return null;
}

/**
 * Stages every unit's version file and changelog, and `rafa.lock` when
 * the reading moves it, deletes every unit's fragments and commits the
 * moves' subject; answers the release hash or the problem.
 */
function commitRelease(
  git: GitRunner,
  reading: SettleFolded,
): { readonly release: string } | { readonly problem: string } {
  const lockFiles = reading.lock === null
    ? []
    : [reading.lock.path];
  const unitFiles = reading.units.flatMap((unit) => [gitPathOf(unit.versionFile), gitPathOf(unit.changelog)]);
  const files = [...unitFiles, ...lockFiles];
  const added = git(['add', '--', ...files]);
  if (!added.ok) return { problem: `${files.join(', ')} could not be staged: ${gitSaid(added)}` };

  const paths = reading.units.flatMap((unit) => unit.fragments.map((each) => each.path));
  const removed = git(['rm', '-q', '--', ...paths]);
  if (!removed.ok) return { problem: `the folded fragments could not be deleted: ${gitSaid(removed)}` };

  const subject = releaseCommitSubject(settleMoves(reading));
  const made = git(['commit', '--cleanup=whitespace', '-m', subject]);
  if (!made.ok) return { problem: `${subject} could not be committed: ${gitSaid(made)}` };

  const head = git(['rev-parse', '--verify', 'HEAD']);
  const release = head.stdout.trim();
  if (!head.ok || release === '') return { problem: `the release commit could not be read back: ${gitSaid(head)}` };
  return { release };
}

/**
 * The settle of the worktree's `HEAD`, built into one release commit in
 * the worktree moving every unit the fold answered; every other reading
 * is answered as it came, having written nothing. Never pushes; see the
 * module note for the steps and what a failed one leaves.
 */
export function buildSettle(
  worktree: Pick<SettleWorktree, 'path' | 'git'>,
  settings: SettleSettings,
): SettleBuild {
  const reading = readSettle(worktree.git, 'HEAD', settings);
  if (reading.outcome !== 'folded') return reading;

  const written = writeUnits(worktree.path, reading.units);
  if ('problem' in written) return unbuilt(reading, written.problem);

  const lockProblem = reading.lock === null
    ? null
    : writeLock(worktree.path, reading.lock);
  if (lockProblem !== null) return unbuilt(reading, lockProblem);

  const committed = commitRelease(worktree.git, reading);
  if ('problem' in committed) return unbuilt(reading, committed.problem);

  return {
    ...reading,
    outcome: 'built',
    release: committed.release,
    deleted: reading.units.map((unit) => ({ package: unit.package, paths: unit.fragments.map((each) => each.path) })),
    insertPoints: written.inserts,
    createdChangelog: written.created,
  };
}
