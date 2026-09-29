/**
 * The release guard: whether a branch carries its release the way the
 * base branch expects — as a fragment, never as a stamped version — read
 * before its pull request merges.
 *
 * ```text
 * judgeGuard(facts)          → clean | missing | stale | collision   (pure)
 * readGuard(input)           → the facts read off git, judged, both sides named
 * guardLines(reading)        → what `rafa pr merge` and `rafa pr triage` print
 * ```
 *
 * ## The four answers
 *
 * The judgement reads the branch against the MERGE BASE, so only what
 * the branch itself did counts, and against the base branch's tip, so
 * what has landed since counts too:
 *
 *   - `stale` — the branch stamped a version and the base does not
 *     carry it as the branch does. Its `relation` says how: the base has
 *     `passed` it (the base's version is above it), has `released` it
 *     with the same notes, or has `not-on-base` — no section and no
 *     version file names it. The last is stale as well: once no branch
 *     owns a version number, any stamp is one the base will hand out
 *     differently, so a stamp that has not collided YET is still the
 *     stamp to convert.
 *   - `collision` — the branch stamped a version the base already names,
 *     in its version file or a changelog section, with different notes.
 *     This is the 0.25.0 incident: #354 and #356 both stamped it, #354
 *     merged first.
 *   - `missing` — no stamp, no fragment, and the branch changes a path
 *     outside `release.fragments`.
 *   - `clean` — no stamp, and either a fragment is present or the branch
 *     changes nothing outside `release.fragments` (nothing to release,
 *     so nothing is missing).
 *
 * A stamp outranks a fragment: a branch carrying both still stamps a
 * version, and the stamp is what collides.
 *
 * ## What a stamp is
 *
 * The version file's version at the branch differs from the merge
 * base's, or the branch's changelog names a version heading the merge
 * base's did not. The stamped version is the version file's when it
 * moved, else the topmost new heading's. A changelog edit that adds no
 * version heading — a typo fixed in an old section — is not a stamp:
 * nothing in it claims a number, and `--resolve` restoring the base's
 * changelog would throw the fix away.
 *
 * ## Notes, and what "different" means
 *
 * A section runs from a heading naming its version to the next heading
 * naming a version, headings inside fenced code blocks not counting,
 * read line by line with `changelogVersions` as `./receipt.ts` reads
 * sections. Its notes are its non-blank lines, trimmed, with receipt
 * comments left out: a settled section carries one and a stamped one
 * never does, and the comment is not a note. Two sections differ when
 * their note lists differ, line for line. A side with no section for
 * the version has no notes, so a version file that says 0.25.0 on the
 * base with no section still collides with a branch section for it.
 *
 * ## Fragments on the branch
 *
 * The branch's fragments are the fragments present in its tree
 * (`./fragment-tree.ts`) whose path the branch changed against the
 * merge base: waiting fragments it inherited are the base's, not its
 * own. One that does not parse is not counted, and says so in
 * {@link GuardRead.problems}: settle refuses a whole batch over one
 * malformed fragment, so it must not read `clean`.
 *
 * ## The forecast is the fold, run dry
 *
 * The forecast goes through `forecastRelease` (`./forecast.ts`) and so
 * through the same strategy port settle folds with: the base version,
 * the fragments waiting on the base in their add order (one that does
 * not parse is left out and named, as `./branch-forecast.ts` does), and
 * the branch's fragments after them, dated with `now`'s UTC day, since a
 * merge now would add them today. Several branch fragments are added by
 * one merge, so settle orders them by id; the forecast keeps that order,
 * except that a shipping fragment takes the last place when the last by
 * id is `none`, because a `none` branch fragment answers "no release"
 * without folding. The version and the notes are the same either way;
 * only the receipt's order would differ. A waiting fragment the branch
 * edits is the branch's, folded once in the branch's place, as the
 * merge would leave one file at that path.
 *
 * ## Both sides, and the fix
 *
 * A `stale` or `collision` answer names the branch with its pull
 * request, and the base's entry — the section for the stamped version
 * (the base's own current section for `passed` and `not-on-base`) — with
 * the commit that brought it: the first-parent commit that added the
 * section's heading line, found by `git log -S`, or, for a version the
 * base's version file holds with no section, the oldest commit of the
 * first-parent run that holds it. Its lines end with
 * {@link guardFixCommand}, `rafa pr triage <n> --resolve`.
 *
 * Measured on git 2.50.1 (2026-09-29): over a section a `--no-ff` merge
 * brought in, the `-S` walk names the merge commit, with or without
 * `--diff-merges=first-parent` (`--first-parent` already diffs a merge
 * against its first parent; the flag is kept to say so, as
 * `./fragment-tree.ts` does). That flag also turns patch output on, so
 * the walk passes `--no-patch`: without it the last line read was a
 * line of the diff, not a hash.
 *
 * ## The local level report
 *
 * A fragment carries its level and no notes level, so the report is
 * read from THIS machine's effort store: the change notes stored under
 * the fragment's plan id. When their highest level is above the
 * fragment's, one sentence says so. It is a report, never a refusal —
 * the fragment's level is the plan's decision, as in the wrap-up — and
 * it is silent when this machine holds no note for the plan. A store
 * that throws adds a problem and no report.
 *
 * ## Git
 *
 * Every call is a read through the `GitRunner` seam. Both refs are
 * resolved to commits first, so a ref moving mid-read cannot mix two
 * trees, and nothing is fetched: the caller fetches the base when it
 * wants a fresh one. A version file or changelog a commit does not hold
 * reads as absent.
 */
import type { BranchForecast } from './branch-forecast.js';
import type { ReleaseLevelNote } from './level.js';
import type { SettleSettings } from './settle.js';
import type { FoldFragment } from './strategy.js';
import type { GitRunner } from '../pr/git.js';

import { changelogVersions, compareVersions } from '../commands/release/status.js';
import { messageOf } from '../config-sections.js';
import { readPlanChanges } from '../effort/store/changes.js';
import { gitSaid } from '../pr/git.js';

import { forecastLine } from './branch-forecast.js';
import { forecastRelease } from './forecast.js';
import { directoryPrefix, readFragmentTree } from './fragment-tree.js';
import { highestChangeLevel, RELEASE_LEVEL_RANK } from './level.js';
import { readReceipt } from './receipt.js';
import { releaseStrategyFor } from './strategy.js';
import { gitPathOf, parseSemanticVersion, readManifestVersion } from './version.js';

/** The four answers of the guard; see the module note. */
export type GuardAnswer = 'clean' | 'missing' | 'stale' | 'collision';

/** Every guard answer, in the order the module note gives them. */
export const GUARD_ANSWERS: readonly GuardAnswer[] = Object.freeze(['stale', 'collision', 'missing', 'clean']);

/** One changelog section as the guard compares it. */
export interface GuardSection {
  /** The heading line, as the file writes it. */
  readonly heading: string;
  /** The non-blank lines under it, trimmed, receipts left out. */
  readonly notes: readonly string[];
}

/** The version file and changelog as one commit holds them. */
export interface GuardSide {
  /** The version the version file declares, or null when none reads. */
  readonly version: string | null;
  /** The changelog's text, or null when the commit holds none. */
  readonly changelog: string | null;
}

/** What {@link judgeGuard} reads; every field is committed data. */
export interface GuardFacts {
  /** `release.fragments`, the directory a fragment sits in. */
  readonly fragmentsDir: string;
  /** Every path the branch changed against the merge base. */
  readonly changedPaths: readonly string[];
  /** The paths of the branch's own fragments that parse. */
  readonly fragments: readonly string[];
  /** The merge base's side, what the branch started from. */
  readonly mergeBase: GuardSide;
  /** The branch's side. */
  readonly branch: GuardSide;
  /** The base branch's side, at its tip. */
  readonly base: GuardSide;
}

/** The version a branch stamped, and its section on the branch. */
export interface GuardStamp {
  readonly version: string;
  /** The branch's section for it, or null when it stamped the version file alone. */
  readonly section: GuardSection | null;
}

/** The base's side of a stamped branch: the entry the stamp is set against. */
export interface GuardBaseEntry {
  /** The version the base's version file declares, or null when none reads. */
  readonly version: string | null;
  /** The base section named; see the module note for which. */
  readonly section: GuardSection | null;
}

/** How the base stands to a stale stamp; see the module note. */
export type GuardStaleRelation = 'passed' | 'released' | 'not-on-base';

/** What {@link judgeGuard} answers. */
export type GuardJudgement =
  | { readonly answer: 'clean'; readonly fragments: readonly string[] }
  | { readonly answer: 'missing'; readonly outside: readonly string[] }
  | {
    readonly answer: 'stale';
    readonly stamp: GuardStamp;
    readonly base: GuardBaseEntry;
    readonly relation: GuardStaleRelation;
  }
  | { readonly answer: 'collision'; readonly stamp: GuardStamp; readonly base: GuardBaseEntry };

/** The base entry with the commit that brought it. */
export interface NamedBaseEntry extends GuardBaseEntry {
  /** The full hash of that commit, or null when none could be named. */
  readonly commit: string | null;
}

/** A judgement with the base entry of a stamped answer named. */
export type GuardVerdict =
  | Extract<GuardJudgement, { readonly answer: 'clean' | 'missing' }>
  | (Omit<Extract<GuardJudgement, { readonly answer: 'stale' }>, 'base'> & { readonly base: NamedBaseEntry })
  | (Omit<Extract<GuardJudgement, { readonly answer: 'collision' }>, 'base'> & { readonly base: NamedBaseEntry });

/** The branch as the guard names it. */
export interface GuardBranch {
  /** The commit-ish git reads, e.g. `HEAD` or `origin/feat`. */
  readonly ref: string;
  /** The branch's name as a reader knows it. */
  readonly name: string;
  /** Its pull request's number, or null when it has none. */
  readonly pullRequest: number | null;
}

/** Reads the change notes this machine stores under a plan id. */
export type GuardNotesReader = (plan: string) => readonly ReleaseLevelNote[];

/** What {@link readGuard} reads. */
export interface GuardInput {
  /** Git, run at the repository root. */
  readonly git: GitRunner;
  /** The release settings, named as `ResolvedConfig` names them. */
  readonly settings: SettleSettings;
  /** The base ref, e.g. `origin/main`, already fetched by the caller. */
  readonly base: string;
  /** The branch being guarded. */
  readonly branch: GuardBranch;
  /** When the guard runs; the branch fragments' add date is its UTC day. */
  readonly now: Date;
  /** This machine's notes, for the level report; left out, no report. */
  readonly readNotes?: GuardNotesReader;
}

/** A guard that read and judged. */
export interface GuardRead {
  readonly ok: true;
  readonly verdict: GuardVerdict;
  readonly branch: GuardBranch & { readonly commit: string };
  /** The base ref and the commit it was read at. */
  readonly base: { readonly ref: string; readonly commit: string };
  /** The fold run dry, or null when the base version could not be read. */
  readonly forecast: BranchForecast | null;
  /** The local level report, or null; see the module note. */
  readonly levelReport: string | null;
  /** A sentence per reading that fell short without stopping the guard. */
  readonly problems: readonly string[];
}

/** A guard that could not read what it judges. */
export interface GuardUnread {
  readonly ok: false;
  /** One sentence naming what could not be read. */
  readonly problem: string;
}

/** What {@link readGuard} answers. */
export type GuardReading = GuardRead | GuardUnread;

/** The open or close of a fenced code block, as `release status` reads one. */
const CODE_FENCE = /^ {0,3}(?:```|~~~)/;

/** How long `YYYY-MM-DD` is at the head of an ISO timestamp. */
const ISO_DATE_LENGTH = 10;

/** How many hex digits of a hash the guard's lines print. */
const SHORT_HASH_LENGTH = 7;

/** A section being read: its heading and the notes met so far. */
interface OpenSection {
  readonly heading: string;
  readonly notes: string[];
}

/** The section `version` heads in `text`, or null when no heading names it. */
export function sectionFor(text: string | null, version: string): GuardSection | null {
  if (text === null) return null;
  let open: OpenSection | null = null;
  let fenced = false;
  for (const line of text.split('\n')) {
    if (CODE_FENCE.test(line)) fenced = !fenced;
    const named = fenced
      ? undefined
      : changelogVersions(line)[0];
    if (named !== undefined) {
      if (open !== null) return open;
      if (named === version) open = { heading: line.trim(), notes: [] };
      continue;
    }
    const note = line.trim();
    if (open !== null && note !== '' && readReceipt(line) === null) open.notes.push(note);
  }
  return open;
}

/** The versions `text`'s headings name, or none when there is no text. */
function versionsOf(text: string | null): readonly string[] {
  return text === null
    ? []
    : changelogVersions(text);
}

/** The version the branch stamped, or null when it stamped none; see the module note. */
export function stampedVersion(facts: Pick<GuardFacts, 'mergeBase' | 'branch'>): string | null {
  const { mergeBase, branch } = facts;
  if (branch.version !== null && branch.version !== mergeBase.version) return branch.version;
  const before = new Set(versionsOf(mergeBase.changelog));
  return versionsOf(branch.changelog).find((version) => !before.has(version)) ?? null;
}

/** True when the two sections carry the same notes; a missing one has none. */
function sameNotes(left: GuardSection | null, right: GuardSection | null): boolean {
  const a = left?.notes ?? [];
  const b = right?.notes ?? [];
  return a.length === b.length && a.every((line, index) => line === b[index]);
}

/** True when `left` is above `right` by semver precedence; false when either is no version. */
function isAbove(left: string | null, right: string): boolean {
  if (left === null) return false;
  const a = parseSemanticVersion(left);
  const b = parseSemanticVersion(right);
  return a !== null && b !== null && compareVersions(a, b) > 0;
}

/** The judgement of a branch that stamped `version`. */
function judgeStamp(facts: GuardFacts, version: string): GuardJudgement {
  const stamp: GuardStamp = { version, section: sectionFor(facts.branch.changelog, version) };
  const baseSection = sectionFor(facts.base.changelog, version);
  const onBase = baseSection !== null || facts.base.version === version;
  if (onBase) {
    const base: GuardBaseEntry = { version: facts.base.version, section: baseSection };
    return sameNotes(stamp.section, baseSection)
      ? { answer: 'stale', stamp, base, relation: 'released' }
      : { answer: 'collision', stamp, base };
  }

  const current = facts.base.version === null
    ? null
    : sectionFor(facts.base.changelog, facts.base.version);
  const top = versionsOf(facts.base.changelog)[0];
  const section = current ?? (top === undefined
    ? null
    : sectionFor(facts.base.changelog, top));
  const relation: GuardStaleRelation = isAbove(facts.base.version, version)
    ? 'passed'
    : 'not-on-base';
  return { answer: 'stale', stamp, base: { version: facts.base.version, section }, relation };
}

/** The guard's answer over `facts`; pure. See the module note for the rules. */
export function judgeGuard(facts: GuardFacts): GuardJudgement {
  const stamped = stampedVersion(facts);
  if (stamped !== null) return judgeStamp(facts, stamped);
  if (facts.fragments.length > 0) return { answer: 'clean', fragments: facts.fragments };
  const prefix = directoryPrefix(facts.fragmentsDir);
  const outside = facts.changedPaths.filter((path) => prefix === '' || !path.startsWith(prefix));
  return outside.length === 0
    ? { answer: 'clean', fragments: [] }
    : { answer: 'missing', outside };
}

/** The fix a stamped branch is pointed at. */
export function guardFixCommand(pullRequest: number | null): string {
  return pullRequest === null
    ? 'rafa pr triage --resolve'
    : `rafa pr triage ${pullRequest} --resolve`;
}

// --- git readings -----------------------------------------------------------

/** The full hash `ref` names as a commit, or null. */
function commitOf(git: GitRunner, ref: string): string | null {
  const resolved = git(['rev-parse', '--verify', '--quiet', '--end-of-options', `${ref}^{commit}`]);
  const commit = resolved.stdout.trim();
  return resolved.ok && commit !== ''
    ? commit
    : null;
}

/** The text of `path` at `commit`, or null when the commit holds none. */
function textAt(git: GitRunner, commit: string, path: string): string | null {
  const shown = git(['show', `${commit}:${gitPathOf(path)}`]);
  return shown.ok
    ? shown.stdout
    : null;
}

/** The version file and changelog at `commit`. */
function sideAt(git: GitRunner, commit: string, settings: SettleSettings): GuardSide {
  const manifest = textAt(git, commit, settings.releaseVersionFile);
  return {
    version: manifest === null
      ? null
      : readManifestVersion(manifest),
    changelog: textAt(git, commit, settings.releaseChangelog),
  };
}

/** The non-empty entries of a NUL-terminated listing. */
function nulList(stdout: string): readonly string[] {
  return stdout.split('\0').filter((entry) => entry !== '');
}

/** The newline-separated hashes git listed, newest first. */
function hashList(stdout: string): readonly string[] {
  return stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
}

/** The branch's fragments, as the fold reads them, and the ones that do not parse. */
function branchFragments(
  git: GitRunner,
  commit: string,
  changed: ReadonlySet<string>,
  input: GuardInput,
): { readonly folded: readonly (FoldFragment & { readonly path: string })[]; readonly problems: readonly string[] } | { readonly problem: string } {
  const listed = readFragmentTree(git, commit, input.settings.releaseFragments);
  if (!listed.ok) return { problem: listed.problem };
  const addedOn = input.now.toISOString().slice(0, ISO_DATE_LENGTH);
  const folded: (FoldFragment & { readonly path: string })[] = [];
  const problems: string[] = [];
  for (const each of listed.fragments) {
    if (!changed.has(each.path)) continue;
    if (each.reading.ok) {
      folded.push({ id: each.id, path: each.path, fragment: each.reading.fragment, addedOn });
    } else {
      problems.push(`${input.branch.name}'s ${each.path} does not count as a fragment: ${each.reading.sentence}`);
    }
  }
  return { folded: [...folded].sort((left, right) => left.id.localeCompare(right.id)), problems };
}

/** The first-parent commit of `base` that added `heading` to the changelog, or null. */
function sectionCommit(git: GitRunner, base: string, changelog: string, heading: string): string | null {
  const log = git([
    'log', '--first-parent', '--diff-merges=first-parent', '--no-patch', '--format=%H',
    `-S${heading}`, base, '--', gitPathOf(changelog),
  ]);
  if (!log.ok) return null;
  return hashList(log.stdout).at(-1) ?? null;
}

/** The oldest commit of the first-parent run of `base` whose version file declares `version`, or null. */
function versionCommit(git: GitRunner, base: string, versionFile: string, version: string): string | null {
  const log = git(['log', '--first-parent', '--format=%H', base, '--', gitPathOf(versionFile)]);
  if (!log.ok) return null;
  let found: string | null = null;
  for (const commit of hashList(log.stdout)) {
    const text = textAt(git, commit, versionFile);
    const declared = text === null
      ? null
      : readManifestVersion(text);
    if (declared === version) found = commit;
    else if (found !== null) break;
  }
  return found;
}

/** The judgement with a stamped answer's base entry named by its commit. */
function nameVerdict(git: GitRunner, base: string, settings: SettleSettings, judgement: GuardJudgement): GuardVerdict {
  if (judgement.answer === 'clean' || judgement.answer === 'missing') return judgement;
  const { section, version } = judgement.base;
  // With no section the entry is the version the base's file declares:
  // the stamp itself for a collision, the base's own for a stale stamp.
  const commit = section !== null
    ? sectionCommit(git, base, settings.releaseChangelog, section.heading)
    : versionCommit(git, base, settings.releaseVersionFile, version ?? judgement.stamp.version);
  return { ...judgement, base: { ...judgement.base, commit } };
}

/** The fold run dry over the base and the branch's fragments; see the module note. */
function dryFold(
  git: GitRunner,
  input: GuardInput,
  base: { readonly ref: string; readonly commit: string; readonly version: string | null },
  branch: readonly FoldFragment[],
): { readonly forecast: BranchForecast | null; readonly problems: readonly string[] } {
  if (base.version === null) {
    return { forecast: null, problems: [`${base.ref} declares no version in ${input.settings.releaseVersionFile}, so no forecast was folded`] };
  }
  const listed = readFragmentTree(git, base.commit, input.settings.releaseFragments);
  if (!listed.ok) return { forecast: { ok: false, ref: base.ref, problem: listed.problem, problems: [] }, problems: [] };
  const problems: string[] = [];
  const waiting: FoldFragment[] = [];
  const own = new Set(branch.map((each) => each.id));
  for (const each of listed.fragments) {
    if (own.has(each.id)) continue;
    if (each.reading.ok) waiting.push({ id: each.id, fragment: each.reading.fragment, addedOn: each.addedOn });
    else problems.push(`${base.ref}'s ${each.path} was left out of the forecast: ${each.reading.sentence}`);
  }

  const shipping = branch
    .map((each, index) => (each.fragment.level === 'none'
      ? -1
      : index))
    .filter((index) => index !== -1);
  const last = shipping.at(-1) ?? branch.length - 1;
  const slot = branch[last] ?? null;
  const before = branch.filter((_, index) => index !== last);
  const strategy = releaseStrategyFor(input.settings.releaseStrategy, { heading: input.settings.releaseHeading });
  const forecast = forecastRelease({ strategy, baseVersion: base.version, waiting: [...waiting, ...before], branch: slot });
  return {
    forecast: { ok: true, ref: base.ref, baseVersion: base.version, waiting: waiting.map((each) => each.id), forecast, problems },
    problems,
  };
}

/** The local level report over the branch's fragments; see the module note. */
function localLevelReport(
  fragments: readonly (FoldFragment & { readonly path: string })[],
  readNotes: GuardNotesReader | undefined,
): { readonly report: string | null; readonly problems: readonly string[] } {
  if (readNotes === undefined) return { report: null, problems: [] };
  const reports: string[] = [];
  const problems: string[] = [];
  for (const each of fragments) {
    const { plan, level } = each.fragment;
    let notes: readonly ReleaseLevelNote[];
    try {
      notes = readNotes(plan);
    } catch (error) {
      problems.push(`the change notes of ${plan} could not be read for the level report: ${messageOf(error)}`);
      continue;
    }
    const highest = highestChangeLevel(notes);
    if (highest === null || RELEASE_LEVEL_RANK[highest] <= RELEASE_LEVEL_RANK[level]) continue;
    reports.push(`${each.path} carries level ${level}, below the ${highest} this machine's change notes for ${plan} reach;`
      + ` the fragment stands, so it ships as ${level}`);
  }
  const report = reports.length === 0
    ? null
    : reports.join('; ');
  return { report, problems };
}

/** This machine's change notes under `root`, as the guard's level report reads them. */
export function localPlanNotes(root: string): GuardNotesReader {
  return (plan) => readPlanChanges(root, plan);
}

/**
 * The guard over `input.branch` against `input.base`: the facts read
 * off git, judged by {@link judgeGuard}, a stamped answer's base entry
 * named by its commit, the fold run dry and the local level report.
 * Reads only, fetches nothing; see the module note.
 */
export function readGuard(input: GuardInput): GuardReading {
  const { git, settings } = input;
  const baseCommit = commitOf(git, input.base);
  if (baseCommit === null) return { ok: false, problem: `the base ${input.base} names no commit` };
  const branchCommit = commitOf(git, input.branch.ref);
  if (branchCommit === null) return { ok: false, problem: `the branch ${input.branch.name} (${input.branch.ref}) names no commit` };

  const merged = git(['merge-base', baseCommit, branchCommit]);
  const mergeBase = merged.stdout.trim();
  if (!merged.ok || mergeBase === '') {
    return { ok: false, problem: `${input.branch.name} and ${input.base} share no merge base: ${gitSaid(merged) || 'git named none'}` };
  }
  const diff = git(['diff', '--name-only', '-z', '--no-renames', mergeBase, branchCommit]);
  if (!diff.ok) return { ok: false, problem: `the paths ${input.branch.name} changed could not be read: ${gitSaid(diff)}` };
  const changedPaths = nulList(diff.stdout);

  const own = branchFragments(git, branchCommit, new Set(changedPaths), input);
  if ('problem' in own) return { ok: false, problem: own.problem };

  const baseSide = sideAt(git, baseCommit, settings);
  const facts: GuardFacts = {
    fragmentsDir: settings.releaseFragments,
    changedPaths,
    fragments: own.folded.map((each) => each.path),
    mergeBase: sideAt(git, mergeBase, settings),
    branch: sideAt(git, branchCommit, settings),
    base: baseSide,
  };
  const verdict = nameVerdict(git, baseCommit, settings, judgeGuard(facts));
  const base = { ref: input.base, commit: baseCommit };
  const dry = dryFold(git, input, { ...base, version: baseSide.version }, own.folded);
  const level = localLevelReport(own.folded, input.readNotes);
  return {
    ok: true,
    verdict,
    branch: { ...input.branch, commit: branchCommit },
    base,
    forecast: dry.forecast,
    levelReport: level.report,
    problems: [...own.problems, ...dry.problems, ...level.problems],
  };
}

// --- lines ------------------------------------------------------------------

/** The first digits of `hash`, as the lines print it. */
function short(hash: string): string {
  return hash.slice(0, SHORT_HASH_LENGTH);
}

/** The branch with its pull request, as a phrase. */
function branchPhrase(branch: GuardBranch): string {
  return branch.pullRequest === null
    ? `${branch.name} (no pull request)`
    : `${branch.name} (pull request #${branch.pullRequest})`;
}

/** `path` and `version`, and the section's heading when there is one. */
function entryPhrase(path: string, version: string | null, section: GuardSection | null): string {
  const declares = `${path} ${version ?? 'declares no version'}`;
  return section === null
    ? `${declares}, no changelog section`
    : `${declares}, "${section.heading}"`;
}

/** Why a stamped branch was stopped, as the head of its lines. */
function stampHead(reading: GuardRead, verdict: Extract<GuardVerdict, { readonly stamp: GuardStamp }>): string {
  const { version } = verdict.stamp;
  const ref = reading.base.ref;
  if (verdict.answer === 'collision') {
    return `Release guard: collision — ${reading.branch.name} stamps ${version}, which ${ref} already names with different notes`;
  }
  if (verdict.relation === 'passed') {
    return `Release guard: stale — ${reading.branch.name} stamps ${version}, which ${ref} has passed at ${verdict.base.version ?? '?'}`;
  }
  if (verdict.relation === 'released') {
    return `Release guard: stale — ${reading.branch.name} stamps ${version}, which ${ref} already released with the same notes`;
  }
  return `Release guard: stale — ${reading.branch.name} stamps ${version}, which ${ref} has not released;`
    + ' versions are handed out on the base by rafa release settle';
}

/** Both sides of a stamped branch and the fix; see the module note. */
function stampLines(
  reading: GuardRead,
  verdict: Extract<GuardVerdict, { readonly stamp: GuardStamp }>,
  versionFile: string,
): readonly string[] {
  const commit = verdict.base.commit === null
    ? 'no commit named'
    : `commit ${short(verdict.base.commit)}`;
  return [
    stampHead(reading, verdict),
    `  branch: ${branchPhrase(reading.branch)}: ${entryPhrase(versionFile, verdict.stamp.version, verdict.stamp.section)}`,
    `  base:   ${reading.base.ref}: ${entryPhrase(versionFile, verdict.base.version, verdict.base.section)}, ${commit}`,
  ];
}

/** `count` paths, as a phrase. */
function pathCount(count: number): string {
  return count === 1
    ? '1 path'
    : `${count} paths`;
}

/**
 * What the guard prints: its answer (with both sides for a stamped
 * branch), the forecast, the level report and a line per problem, and
 * for `stale` and `collision` the fix command LAST, so it is the line a
 * reader acts on. `versionFile` is `release.versionFile`, named on each
 * side.
 */
export function guardLines(reading: GuardReading, versionFile: string): readonly string[] {
  if (!reading.ok) return [`Release guard: not read, because ${reading.problem}`];
  const { verdict } = reading;
  const head: readonly string[] = (() => {
    if (verdict.answer === 'clean') {
      return [verdict.fragments.length === 0
        ? `Release guard: clean — ${reading.branch.name} changes nothing that needs a release fragment`
        : `Release guard: clean — ${reading.branch.name} carries ${verdict.fragments.join(', ')}`];
    }
    if (verdict.answer === 'missing') {
      return [`Release guard: missing — ${branchPhrase(reading.branch)} changes ${pathCount(verdict.outside.length)}`
        + ' outside the release fragments and carries no fragment'];
    }
    return stampLines(reading, verdict, versionFile);
  })();
  const forecast = reading.forecast === null
    ? []
    : [forecastLine(reading.forecast)];
  const level = reading.levelReport === null
    ? []
    : [`Level report: ${reading.levelReport}`];
  const notes = reading.problems.map((problem) => `  note: ${problem}`);
  const fix = verdict.answer === 'stale' || verdict.answer === 'collision'
    ? [`  fix:    ${guardFixCommand(reading.branch.pullRequest)}`]
    : [];
  return [...head, ...forecast, ...level, ...notes, ...fix];
}
