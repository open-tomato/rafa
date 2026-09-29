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
 * and folds the two through `foldWithStrategy` (`./strategy.ts`), the
 * one place a fold is called. Everything it reads is a git object — a
 * tree listing, a log, a blob — so it writes nothing: no file, no index
 * entry, no ref. That is the dry run, and it answers the same over the
 * caller's repository at `origin/<pr.base>` as over the worktree at
 * `HEAD`, because the tree is resolved to one commit first and every
 * later read names that hash.
 *
 * It answers one of five {@link SettleReading} outcomes, each naming the
 * strategy the settle runs under:
 *
 *   - `unread`: the tree or the base version could not be read. Nothing
 *     was folded.
 *   - `malformed`: a fragment on the base does not parse. Settle REFUSES
 *     the whole batch rather than folding the rest: a fragment left out
 *     would release later, out of the order the base received it, and
 *     its level (a `major`, say) would be missing from the release it
 *     belongs to. One sentence per fragment names its path and what the
 *     parser said.
 *   - `failed`: the strategy threw; the port's one line names it and the
 *     error, and nothing is written.
 *   - `nothing`: the fold answered null — no fragment, or only
 *     `level: none` ones. Nothing to settle: no commit, and `none`
 *     fragments stay until a release commit that ships something
 *     deletes them with the rest of its batch.
 *   - `folded`: the version and the section the fold answered, with the
 *     base version and the fragments in fold order.
 *
 * ## The build
 *
 * {@link buildSettle} reads at the worktree's `HEAD` and, only for
 * `folded`, builds the commit in the worktree's directory:
 *
 *   1. writes the version into `release.versionFile` byte-safely
 *      (`writeManifestVersion`, `./version.ts`), refusing a file whose
 *      version on disk is not the one the reading folded from;
 *   2. inserts the section at the changelog's insert point
 *      (`insertChangelogEntry`, `./changelog.ts`);
 *   3. stages both files and `git rm`s every folded fragment, `none`
 *      ones included, since the receipt names them all;
 *   4. commits `chore: release <version>` ({@link releaseCommitSubject}),
 *      with the repository's hooks running as they would for any commit.
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
import type { SettleWorktree } from './settle-worktree.js';
import type { FoldFragment } from './strategy.js';
import type { ReleaseStrategy } from '../config-readers.js';
import type { BranchForecastSettings } from './branch-forecast.js';
import type { ChangelogInsertPoint } from './changelog.js';
import type { GitRunner } from '../pr/git.js';

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { messageOf } from '../config-sections.js';
import { gitSaid } from '../pr/git.js';

import { insertChangelogEntry } from './changelog.js';
import { readFragmentTree } from './fragment-tree.js';
import { foldWithStrategy, releaseStrategyFor } from './strategy.js';
import { gitPathOf, readManifestVersion, writeManifestVersion } from './version.js';

/** The settings a settle reads, named as `ResolvedConfig` names them. */
export interface SettleSettings extends BranchForecastSettings {
  /** `release.changelog`, the file the section is inserted into. */
  readonly releaseChangelog: string;
  /** `release.fragments`, the directory the waiting fragments sit in. */
  readonly releaseFragments: string;
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
  /** The version `release.versionFile` declared at that commit. */
  readonly baseVersion: string;
  /** The fragments present, in fold order. */
  readonly fragments: readonly SettleFragment[];
}

/** The tree or the base version could not be read. */
export interface SettleUnread {
  readonly outcome: 'unread';
  readonly strategy: ReleaseStrategy;
  /** One sentence naming what could not be read. */
  readonly problem: string;
}

/** A fragment on the base does not parse, so no fragment is folded. */
export interface SettleMalformed {
  readonly outcome: 'malformed';
  readonly strategy: ReleaseStrategy;
  /** The full hash of the commit the tree was read at. */
  readonly commit: string;
  /** One sentence per fragment that does not parse, in add order. */
  readonly problems: readonly string[];
}

/** The strategy threw. */
export interface SettleFailed extends SettleBasis {
  readonly outcome: 'failed';
  /** The port's one line naming the strategy and the error. */
  readonly line: string;
}

/** The fold answered null: no fragment, or only `none` ones. */
export interface SettleNothing extends SettleBasis {
  readonly outcome: 'nothing';
}

/** The fold answered a version and a section. */
export interface SettleFolded extends SettleBasis {
  readonly outcome: 'folded';
  /** The version the base moves to. */
  readonly version: string;
  /** The changelog section, receipt included, with no trailing newline. */
  readonly section: string;
}

/** What {@link readSettle} answers; see the module note. */
export type SettleReading = SettleUnread | SettleMalformed | SettleFailed | SettleNothing | SettleFolded;

/** A folded batch whose commit could not be built. */
export interface SettleUnbuilt extends Omit<SettleFolded, 'outcome'> {
  readonly outcome: 'unbuilt';
  /** One sentence naming the step that failed and why. */
  readonly problem: string;
}

/** A folded batch committed in the worktree. */
export interface SettleBuilt extends Omit<SettleFolded, 'outcome'> {
  readonly outcome: 'built';
  /** The full hash of the release commit; its parent is {@link SettleBasis.commit}. */
  readonly release: string;
  /** The fragment paths the commit deleted, in fold order. */
  readonly deleted: readonly string[];
  /** Where the section went in the changelog. */
  readonly insertPoint: ChangelogInsertPoint;
}

/** What {@link buildSettle} answers: a reading that wrote nothing, or the build. */
export type SettleBuild = Exclude<SettleReading, SettleFolded> | SettleUnbuilt | SettleBuilt;

/** The subject of the commit a settle builds. */
export function releaseCommitSubject(version: string): string {
  return `chore: release ${version}`;
}

/** The version `versionFile` declares at `commit`, or the sentence saying why not. */
function versionAt(
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

/**
 * The settle of the fragments in `tree` (a commit-ish: `HEAD` in the
 * worktree, `origin/main` in the caller's repository), folded by the
 * configured strategy. Reads git objects only and writes nothing; see
 * the module note for the five outcomes.
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

  const basis = { strategy: strategy.name, commit, baseVersion: base.version, fragments };
  const folded = foldWithStrategy(strategy, base.version, fragments);
  if (!folded.ok) return { ...basis, outcome: 'failed', line: folded.line };
  if (folded.result === null) return { ...basis, outcome: 'nothing' };
  return { ...basis, outcome: 'folded', version: folded.result.version, section: folded.result.section };
}

/** The reading as `unbuilt`, with `problem`. */
function unbuilt(reading: SettleFolded, problem: string): SettleUnbuilt {
  return { ...reading, outcome: 'unbuilt', problem };
}

/** Writes the version file; answers the problem, or null when written. */
function writeVersion(root: string, reading: SettleFolded, versionFile: string): string | null {
  const written = writeManifestVersion(join(root, gitPathOf(versionFile)), reading.version);
  if (!written.written) return written.problem ?? `${versionFile} was not written`;
  if (written.previous !== reading.baseVersion) {
    return `${versionFile} declared ${String(written.previous)} in the worktree, where the base commit declares ${reading.baseVersion}`;
  }
  return null;
}

/** Inserts the section into the changelog; answers where, or the problem. */
function writeChangelog(
  root: string,
  reading: SettleFolded,
  changelog: string,
): { readonly point: ChangelogInsertPoint } | { readonly problem: string } {
  const path = join(root, gitPathOf(changelog));
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (error) {
    return { problem: `${changelog} could not be read: ${messageOf(error)}` };
  }
  const inserted = insertChangelogEntry(text, reading.section);
  try {
    writeFileSync(path, inserted.text);
  } catch (error) {
    return { problem: `${changelog} could not be written: ${messageOf(error)}` };
  }
  return { point: inserted.point };
}

/** Stages the two files, deletes the fragments and commits; answers the release hash or the problem. */
function commitRelease(
  git: GitRunner,
  reading: SettleFolded,
  settings: SettleSettings,
): { readonly release: string } | { readonly problem: string } {
  const files = [gitPathOf(settings.releaseVersionFile), gitPathOf(settings.releaseChangelog)];
  const added = git(['add', '--', ...files]);
  if (!added.ok) return { problem: `${files.join(' and ')} could not be staged: ${gitSaid(added)}` };

  const paths = reading.fragments.map((each) => each.path);
  const removed = git(['rm', '-q', '--', ...paths]);
  if (!removed.ok) return { problem: `the folded fragments could not be deleted: ${gitSaid(removed)}` };

  const subject = releaseCommitSubject(reading.version);
  const made = git(['commit', '--cleanup=whitespace', '-m', subject]);
  if (!made.ok) return { problem: `${subject} could not be committed: ${gitSaid(made)}` };

  const head = git(['rev-parse', '--verify', 'HEAD']);
  const release = head.stdout.trim();
  if (!head.ok || release === '') return { problem: `the release commit could not be read back: ${gitSaid(head)}` };
  return { release };
}

/**
 * The settle of the worktree's `HEAD`, built into a release commit in
 * the worktree when the fold answered a version; every other reading is
 * answered as it came, having written nothing. Never pushes; see the
 * module note for the steps and what a failed one leaves.
 */
export function buildSettle(
  worktree: Pick<SettleWorktree, 'path' | 'git'>,
  settings: SettleSettings,
): SettleBuild {
  const reading = readSettle(worktree.git, 'HEAD', settings);
  if (reading.outcome !== 'folded') return reading;

  const versionProblem = writeVersion(worktree.path, reading, settings.releaseVersionFile);
  if (versionProblem !== null) return unbuilt(reading, versionProblem);

  const changelog = writeChangelog(worktree.path, reading, settings.releaseChangelog);
  if ('problem' in changelog) return unbuilt(reading, changelog.problem);

  const committed = commitRelease(worktree.git, reading, settings);
  if ('problem' in committed) return unbuilt(reading, committed.problem);

  return {
    ...reading,
    outcome: 'built',
    release: committed.release,
    deleted: reading.fragments.map((each) => each.path),
    insertPoint: changelog.point,
  };
}
