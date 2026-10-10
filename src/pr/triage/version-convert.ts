/**
 * The `conflict-version` conversion: a branch that stamped a version
 * turned into a branch that carries a release fragment, in one commit
 * and with no Claude session.
 *
 * ```text
 * conversionLevel(from, to)        → patch | minor | major | null        (pure)
 * conversionPlanId(branch, n)      → the fragment's plan id               (pure)
 * convertStampedVersion(input)     → converted | unstamped | refused      (git + files)
 * conversionLines(conversion)      → what `rafa pr triage --resolve` prints
 * ```
 *
 * `rafa pr triage --resolve` dispatches a pull request classed
 * `conflict-version` here ahead of the loop path
 * (`src/commands/pr/triage-resolve.ts`): the fix needs nothing from what
 * the pull request was FOR, so no pinned plan and no session is spent on
 * it. The caller adds the worktree, pushes the commit and removes the
 * worktree; this module reads, writes the three files and commits.
 *
 * ## What the one commit holds
 *
 *   - **A fragment** under `release.fragments`, whose notes are the
 *     stamped section's lines as the guard reads them (`sectionFor` in
 *     `src/release/guard.ts`: non-blank, trimmed, receipts left out).
 *   - **The version file** with its version set back to the MERGE
 *     BASE's, through `replaceManifestVersion` (`src/release/version.ts`),
 *     so every other byte the branch wrote in it — a dependency it added
 *     — stays.
 *   - **The changelog** as the merge base's text, whole. The stamped
 *     section is now the fragment, and the guard reads any heading the
 *     merge base did not hold as a stamp, so nothing short of that text
 *     clears it. An edit the branch made to an older section goes with
 *     it; the commit's diff shows it.
 *
 * ## Why the merge base's values and not the base tip's
 *
 * "Back to the base's value" is read as the value the branch found when
 * it left the base: after the commit the branch no longer changes either
 * file, so a merge takes the base's side of both — whatever version and
 * sections the base holds by then — and the pull request's conflict on
 * them is gone. Writing the base TIP's values instead does not clear the
 * stamp: the guard measures a stamp against the merge base
 * (`stampedVersion`), so a branch holding the tip's newer version and
 * headings still reads `stale` (`released`), `rafa pr triage` classes it
 * `conflict-version` again, and `--resolve` would convert for ever. A
 * case in `./version-convert.test.ts` holds that reading, as the control
 * for the one that reads `clean` after the conversion. The tip's version
 * is reported beside the restored one, since it is the one the merge
 * will leave.
 *
 * The base is `origin/<base>` after a `git fetch` of it, which is where
 * the merge base and the guard's reading are taken. A fetch that fails is
 * a problem noted and not a stop, as `src/release/guard-merge.ts` treats
 * its own: the conversion then reads what this clone holds.
 *
 * The commit names its three paths, so nothing else staged in a reused
 * worktree is swept under its subject, and runs the repository's hooks.
 *
 * ## The fragment's fields
 *
 *   - `plan` — the branch name's last `/` segment, every run of
 *     characters a plan id cannot hold turned into one `-`: a rafa
 *     branch `feat/rafa-356-some-title` gives the plan stub
 *     `rafa-356-some-title`. A name that leaves nothing usable falls back
 *     to `pr-<n>`.
 *   - `title` — the pull request's title on one line; the plan id when it
 *     is blank. The stamped heading is not read for it: `release.heading`
 *     is free text nothing can un-render (`context/release.md`).
 *   - `level` — how far the stamp moved from the MERGE BASE's version:
 *     `major`, `minor` or `patch` by the first of the three numbers that
 *     differs, `patch` for a prerelease dropped on the same triple. This
 *     is the level the branch asked for when it stamped; the version it
 *     picked is what goes. A stamp that is not above the merge base's
 *     version, or a merge base with no version to measure from, reads no
 *     level and the conversion is refused rather than guessed.
 *   - notes — the stamped section's lines. A stamp of the version file
 *     alone has no section, and a shipping fragment may not be empty, so
 *     the title becomes its one note and a problem says so, as
 *     `src/release/prepare.ts` does for a plan whose notes all came out
 *     empty.
 *
 * The file name is `allocateFragmentName`'s first free name against the
 * fragments on the branch AND on the base, so the merge never lands two
 * fragments on one path.
 *
 * ## The three outcomes
 *
 *   - `converted` — the commit was made; its hash, the fragment and both
 *     versions come back.
 *   - `unstamped` — the guard, read again at the worktree's head, answers
 *     `clean` or `missing`: the stamp is already gone (a reused worktree,
 *     a second run), so nothing is written.
 *   - `refused` — one sentence naming what stopped it, and nothing
 *     written: the worktree is not at the pull request's head, the guard
 *     could not read, no level reads off the stamp, the merge base
 *     declares no version or holds no changelog (the branch created it),
 *     or the branch's version file cannot take the merge base's version.
 *     Every reading is taken before the first write, so a refusal leaves
 *     a clean worktree for the caller to remove. A write or a commit that
 *     fails after that is refused too, and its sentence says what was
 *     left behind.
 *
 * ## Git
 *
 * Every call goes through the `GitRunner` seam, run in the worktree:
 * the fetch, `rev-parse`, `merge-base`, `show`, `ls-tree`, `add` and
 * `commit`. The guard's own readings are `readGuard`'s, over `HEAD`.
 */
import type { PlanReleaseLevel } from '../../plan/parse.js';
import type { GuardAnswer, GuardStamp } from '../../release/guard.js';
import type { SettleSettings } from '../../release/settle.js';
import type { GitRunner } from '../git.js';

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, posix } from 'node:path';

import { messageOf } from '../../config-sections.js';
import { directoryPrefix } from '../../release/fragment-tree.js';
import { allocateFragmentName, FRAGMENT_PLAN_ID_PATTERN, serializeFragment } from '../../release/fragment.js';
import { readGuard } from '../../release/guard.js';
import { compareVersions } from '../../release/status-readings.js';
import { gitPathOf, parseSemanticVersion, readManifestVersion, RELEASE_REMOTE, replaceManifestVersion } from '../../release/version.js';
import { gitSaid } from '../git.js';

/** What one conversion reads. */
export interface VersionConvertInput {
  /** Git, run in the worktree that holds the pull request's branch. */
  readonly git: GitRunner;
  /** That worktree's directory; the three files are written under it. */
  readonly worktree: string;
  /** The release settings, named as `ResolvedConfig` names them. */
  readonly settings: SettleSettings;
  /** The pull request's base branch, e.g. `main`. */
  readonly base: string;
  /** The pull request's head branch, which names the fragment. */
  readonly branch: string;
  /** The pull request's number. */
  readonly pullRequest: number;
  /** The pull request's title, the fragment's `title`. */
  readonly title: string;
  /** The commit the worktree must be at, or null to take it as it is. */
  readonly head: string | null;
  /** When the conversion runs; the guard's forecast dates with it. */
  readonly now: Date;
  /** The remote the base is fetched from. `origin` when left out. */
  readonly remote?: string;
}

/** What every outcome carries. */
interface ConversionBasis {
  /** A sentence per reading that fell short without stopping the conversion. */
  readonly problems: readonly string[];
}

/** The commit was made; see the module note. */
export interface VersionConverted extends ConversionBasis {
  readonly outcome: 'converted';
  /** The full hash of the conversion's commit. */
  readonly commit: string;
  /** The fragment's path from the repository root. */
  readonly fragmentPath: string;
  /** The fragment's plan id. */
  readonly plan: string;
  /** The fragment's level. */
  readonly level: PlanReleaseLevel;
  /** The version the branch had stamped. */
  readonly stamped: string;
  /** The merge base's version, which the version file now declares. */
  readonly restoredVersion: string;
  /** The base's version at its tip, which the merge will leave; null when none reads. */
  readonly baseVersion: string | null;
  /** The base ref the branch was read against. */
  readonly baseRef: string;
}

/** The guard read no stamp at the worktree's head, so nothing was written. */
export interface VersionUnstamped extends ConversionBasis {
  readonly outcome: 'unstamped';
  /** What the guard answered instead. */
  readonly answer: Extract<GuardAnswer, 'clean' | 'missing'>;
}

/** Nothing was converted, for the one reason given. */
export interface VersionRefused extends ConversionBasis {
  readonly outcome: 'refused';
  /** One sentence naming what stopped the conversion. */
  readonly problem: string;
}

/** What {@link convertStampedVersion} answers. */
export type VersionConversion = VersionConverted | VersionUnstamped | VersionRefused;

/** The plan id a branch that names nothing usable falls back to, before its number. */
const FALLBACK_PLAN_PREFIX = 'pr-';

/** Every run of characters a plan id cannot hold. */
const UNUSABLE_PLAN_CHARACTERS = /[^A-Za-z0-9._-]+/g;

/** What a plan id may not open with. */
const UNUSABLE_PLAN_START = /^[^A-Za-z0-9]+/;

/** How many hex digits of a hash the lines print. */
const SHORT_HASH_LENGTH = 7;

/**
 * The level a stamp from `from` to `to` asked for, or null when none
 * reads; see the module note.
 */
export function conversionLevel(from: string | null, to: string): Exclude<PlanReleaseLevel, 'none'> | null {
  if (from === null) return null;
  const before = parseSemanticVersion(from);
  const after = parseSemanticVersion(to);
  if (before === null || after === null || compareVersions(after, before) <= 0) return null;
  if (after.major !== before.major) return 'major';
  if (after.minor !== before.minor) return 'minor';
  return 'patch';
}

/** The fragment's plan id for `branch`; see the module note. */
export function conversionPlanId(branch: string, pullRequest: number): string {
  const last = branch.split('/').at(-1) ?? '';
  const cleaned = last
    .replace(UNUSABLE_PLAN_CHARACTERS, '-')
    .replace(UNUSABLE_PLAN_START, '');
  return FRAGMENT_PLAN_ID_PATTERN.test(cleaned)
    ? cleaned
    : `${FALLBACK_PLAN_PREFIX}${pullRequest}`;
}

/** The subject of the conversion's commit. */
export function conversionCommitSubject(plan: string, stamped: string): string {
  return `chore: release fragment ${plan}, converted from the stamped ${stamped}`;
}

/** The text of `path` at `commit`, or null when the commit holds none. */
function textAt(git: GitRunner, commit: string, path: string): string | null {
  const shown = git(['show', `${commit}:${gitPathOf(path)}`]);
  return shown.ok
    ? shown.stdout
    : null;
}

/** The full hash `ref` names as a commit, or null. */
function commitOf(git: GitRunner, ref: string): string | null {
  const resolved = git(['rev-parse', '--verify', '--quiet', '--end-of-options', `${ref}^{commit}`]);
  const commit = resolved.stdout.trim();
  return resolved.ok && commit !== ''
    ? commit
    : null;
}

/** The file names directly under the fragments directory at `commit`. */
function fragmentNamesAt(git: GitRunner, commit: string, directory: string): readonly string[] {
  const prefix = directoryPrefix(directory);
  const pathspec = prefix === ''
    ? '.'
    : prefix;
  const listed = git(['ls-tree', '--name-only', '-z', commit, '--', pathspec]);
  if (!listed.ok) return [];
  return listed.stdout
    .split('\0')
    .filter((path) => path !== '')
    .map((path) => posix.basename(path));
}

/** A refusal carrying the problems met so far. */
function refused(problem: string, problems: readonly string[]): VersionRefused {
  return { outcome: 'refused', problem, problems };
}

/** Everything the writes need, read before the first of them. */
interface ConversionPlan {
  readonly stamp: GuardStamp;
  readonly baseRef: string;
  /** The merge base's version, which the version file is set back to. */
  readonly restoredVersion: string;
  /** The base's version at its tip, for the lines alone. */
  readonly baseVersion: string | null;
  /** The merge base's changelog text, which the changelog is set back to. */
  readonly changelogText: string;
  readonly versionText: string;
  readonly fragmentPath: string;
  readonly fragmentText: string;
  readonly plan: string;
  readonly level: PlanReleaseLevel;
}

/** The pull request's title as a fragment title: one line, the plan id when blank. */
function fragmentTitle(title: string, plan: string): string {
  const line = title.replace(/\s+/g, ' ').trim();
  return line === ''
    ? plan
    : line;
}

/** The version file's text and version, and the changelog's text, at the merge base. */
interface MergeBaseSide {
  readonly commit: string;
  readonly version: string | null;
  readonly changelog: string | null;
}

/** The merge base of `base` and `head`, with the two files as it holds them, or null. */
function mergeBaseSide(git: GitRunner, base: string, head: string, settings: SettleSettings): MergeBaseSide | null {
  const merged = git(['merge-base', base, head]);
  const commit = merged.stdout.trim();
  if (!merged.ok || commit === '') return null;
  const manifest = textAt(git, commit, settings.releaseVersionFile);
  return {
    commit,
    version: manifest === null
      ? null
      : readManifestVersion(manifest),
    changelog: textAt(git, commit, settings.releaseChangelog),
  };
}

/** The fragment's text and its path, named against the fragments on both sides. */
function fragmentFor(
  input: VersionConvertInput,
  stamp: GuardStamp,
  level: PlanReleaseLevel,
  commits: readonly string[],
  problems: string[],
): Pick<ConversionPlan, 'fragmentPath' | 'fragmentText' | 'plan'> {
  const { git, settings } = input;
  const plan = conversionPlanId(input.branch, input.pullRequest);
  const title = fragmentTitle(input.title, plan);
  const stampedNotes = stamp.section?.notes ?? [];
  if (stampedNotes.length === 0) {
    problems.push(`${input.branch} stamped ${stamp.version} with no changelog notes, so the fragment carries its title as its one note`);
  }
  const notes = stampedNotes.length === 0
    ? [title]
    : stampedNotes;
  const taken = commits.flatMap((commit) => fragmentNamesAt(git, commit, settings.releaseFragments));
  const fragmentPath = posix.join(directoryPrefix(settings.releaseFragments), allocateFragmentName(plan, taken));
  return { plan, fragmentPath, fragmentText: serializeFragment({ plan, title, level, notes }) };
}

/**
 * Reads what the conversion writes, answering the plan, the branch's
 * guard answer when it stamped nothing, or a refusal. Writes nothing.
 */
function planConversion(
  input: VersionConvertInput,
  problems: string[],
): ConversionPlan | VersionUnstamped | VersionRefused {
  const { git, settings } = input;
  const baseRef = `${input.remote ?? RELEASE_REMOTE}/${input.base}`;
  const headCommit = commitOf(git, 'HEAD');
  if (headCommit === null) return refused(`the worktree at ${input.worktree} has no HEAD commit`, problems);
  if (input.head !== null && headCommit !== input.head) {
    return refused(`the worktree's ${input.branch} is at ${headCommit.slice(0, SHORT_HASH_LENGTH)}, not at the pull request's`
      + ` head ${input.head.slice(0, SHORT_HASH_LENGTH)}; bring the branch up to its pull request's head and run it again`, problems);
  }

  const guard = readGuard({
    git,
    settings,
    base: baseRef,
    branch: { ref: headCommit, name: input.branch, pullRequest: input.pullRequest },
    now: input.now,
  });
  if (!guard.ok) return refused(`the release guard could not read ${input.branch}: ${guard.problem}`, problems);
  const { verdict } = guard;
  if (verdict.answer === 'clean' || verdict.answer === 'missing') {
    return { outcome: 'unstamped', answer: verdict.answer, problems };
  }
  const { stamp } = verdict;

  const start = mergeBaseSide(git, guard.base.commit, headCommit, settings);
  if (start === null) return refused(`${input.branch} and ${baseRef} share no merge base`, problems);
  const level = conversionLevel(start.version, stamp.version);
  if (level === null) {
    return refused(`no release level reads off the stamp: ${input.branch} stamped ${stamp.version} over`
      + ` ${start.version ?? 'no version'} at its merge base with ${baseRef}`, problems);
  }
  if (start.version === null) return refused(`the merge base declares no version in ${settings.releaseVersionFile} to restore`, problems);
  if (start.changelog === null) {
    return refused(`the merge base holds no ${settings.releaseChangelog}, so ${input.branch} created it and there is no text to restore`, problems);
  }

  let branchVersionText: string;
  try {
    branchVersionText = readFileSync(join(input.worktree, settings.releaseVersionFile), 'utf8');
  } catch (error) {
    return refused(`${settings.releaseVersionFile} could not be read in the worktree: ${messageOf(error)}`, problems);
  }
  const rewritten = replaceManifestVersion(branchVersionText, start.version);
  if (rewritten === null) {
    return refused(`${input.branch}'s ${settings.releaseVersionFile} holds no version pair ${start.version} could be written over`, problems);
  }

  return {
    stamp,
    baseRef,
    restoredVersion: start.version,
    baseVersion: verdict.base.version,
    changelogText: start.changelog,
    versionText: rewritten.text,
    level,
    ...fragmentFor(input, stamp, level, [headCommit, guard.base.commit], problems),
  };
}

/** Writes the three files; answers the sentence of the write that failed, or null. */
function writeConversion(input: VersionConvertInput, plan: ConversionPlan): string | null {
  const writes: readonly (readonly [string, string])[] = [
    [plan.fragmentPath, plan.fragmentText],
    [input.settings.releaseVersionFile, plan.versionText],
    [input.settings.releaseChangelog, plan.changelogText],
  ];
  for (const [path, text] of writes) {
    const target = join(input.worktree, path);
    try {
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, text);
    } catch (error) {
      return `${path} could not be written in the worktree, which may hold part of the conversion: ${messageOf(error)}`;
    }
  }
  return null;
}

/**
 * Converts the stamp on the worktree's branch into a fragment, restores
 * the version file and the changelog to the base's, and commits the
 * three paths as one commit. Pushes nothing; see the module note.
 */
export function convertStampedVersion(input: VersionConvertInput): VersionConversion {
  const { git, settings } = input;
  const problems: string[] = [];
  const fetched = git(['fetch', input.remote ?? RELEASE_REMOTE, input.base]);
  if (!fetched.ok) {
    problems.push(`${input.base} could not be fetched, so the conversion reads what this clone holds: ${gitSaid(fetched)}`);
  }

  const plan = planConversion(input, problems);
  if (!('fragmentText' in plan)) return plan;

  const written = writeConversion(input, plan);
  if (written !== null) return refused(written, problems);
  const paths = [plan.fragmentPath, settings.releaseVersionFile, settings.releaseChangelog].map((path) => gitPathOf(path));
  const added = git(['add', '--', ...paths]);
  if (!added.ok) return refused(`the conversion's files could not be staged, and are left in the worktree: ${gitSaid(added)}`, problems);
  const subject = conversionCommitSubject(plan.plan, plan.stamp.version);
  const made = git(['commit', '--cleanup=whitespace', '-m', subject, '--', ...paths]);
  if (!made.ok) return refused(`the conversion could not be committed, and is left staged in the worktree: ${gitSaid(made)}`, problems);
  const commit = commitOf(git, 'HEAD');
  if (commit === null) return refused('the conversion was committed, but HEAD names no commit to report', problems);

  return {
    outcome: 'converted',
    commit,
    fragmentPath: plan.fragmentPath,
    plan: plan.plan,
    level: plan.level,
    stamped: plan.stamp.version,
    restoredVersion: plan.restoredVersion,
    baseVersion: plan.baseVersion,
    baseRef: plan.baseRef,
    problems,
  };
}

/**
 * What a conversion prints: one line for its outcome, then a note per
 * problem. `settings` names the two restored files.
 */
export function conversionLines(conversion: VersionConversion, settings: SettleSettings): readonly string[] {
  const notes = conversion.problems.map((problem) => `  note: ${problem}`);
  if (conversion.outcome === 'refused') return [`The stamped version was not converted: ${conversion.problem}.`, ...notes];
  if (conversion.outcome === 'unstamped') {
    return [`The release guard reads ${conversion.answer} at the branch's head, so there is no stamped version to convert.`, ...notes];
  }
  const merged = conversion.baseVersion === null
    ? ''
    : `; a merge leaves ${conversion.baseRef}'s ${conversion.baseVersion}`;
  return [
    `Converted the stamped ${conversion.stamped} into ${conversion.fragmentPath} (level ${conversion.level}):`
      + ` ${settings.releaseVersionFile} back to ${conversion.restoredVersion} and ${settings.releaseChangelog} back to`
      + ` the merge base's text${merged}, commit ${conversion.commit.slice(0, SHORT_HASH_LENGTH)}.`,
    ...notes,
  ];
}
