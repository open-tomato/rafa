/**
 * Step 3 of loop-owned triage's public lookup (`./triage.ts`): the open
 * bugs nearest a report, by the words they share. The exact key of steps
 * 1 and 2 (`./bug-key.ts`) misses a failure worded a new way; this step
 * compares what the report says with what each open bug said when it was
 * filed.
 *
 * ## Word sets
 *
 * A text's word set ({@link wordSetOf}) is the text after the step-1
 * stripping ({@link strippedText}: commit hashes, folder prefixes and
 * numbers out), lower-cased and split on non-word characters (`\W`, so a
 * letter outside ASCII splits a word too), each distinct word once. Local
 * paths are the caller's to take out first (`./local-paths.ts`), as for
 * the key: this module is given no root and no home.
 *
 * A report's word set ({@link reportWordsOf}) is that of its `what` and
 * its artifact together. An open bug's ({@link issueWordsOf}) is that of
 * the fenced values of the `What` and `Artifact` sections of its body,
 * which is its first report as `./issue-text.ts` writes it. The sentence
 * a body holds for a missing artifact is not fenced and adds no word, and
 * a body with neither section, such as one a person wrote, has an empty
 * word set.
 *
 * ## The score
 *
 * {@link jaccard} is the words two sets share over every distinct word in
 * either. Two empty sets score 0, never `NaN`, so a bug with no words is
 * never a match, and an empty set scores 0 against any other.
 *
 * ## The test-file guard
 *
 * One test file holds many different failures that share most of their
 * words, so a bug naming a different test file than the report is skipped
 * whatever its score. A text's test file ({@link testFileOf}) is the one
 * `./test-failure.ts` reads for the case it names, else the first test
 * file path in its artifact, else in its `what`; two are compared by base
 * name, so a folder or its absence makes no difference. A report or a bug
 * naming no test file is never skipped by the guard.
 *
 * ## The nearest bugs
 *
 * {@link nearestOpenBugs} answers every open bug the guard keeps and that
 * shares at least one word with the report, highest score first. Bugs
 * scoring the same keep the order the tracker listed them in. The caller
 * takes the first for a match at its threshold and the first few for a
 * `Possible duplicates` section.
 *
 * ## The ranked list
 *
 * {@link rankedCandidates} ranks the open bugs for the `Possible
 * duplicates` list a reader sees; the same-bug decision stays with
 * {@link nearestOpenBugs}. A bug's rank is its word score plus each bonus
 * that applies, capped at 1, each bonus weighed by its
 * {@link SimilarityWeights} entry, where `0` turns the signal off:
 *
 * - `cause`: both causes are the same full code.
 * - `cause-family`: the two causes are of the same family
 *   (`familyOf`) with different leaves.
 * - `boundary`: both modules are equal and both actions are equal, with
 *   none of the four `unknown` (`UNKNOWN_VALUE`).
 *
 * A bonus counts only when both records carry the field: a null field, or
 * no record for the new bug at all, earns none, and a cause whose leaf is
 * `new-context` (`NEW_CONTEXT_LEAF`), `unknown:new-context` included,
 * earns neither cause bonus. The open bug's record is its body read by
 * `parseBugRecord`. The test-file guard drops a bug as it does for the
 * nearest bugs, a rank of 0 is left out, and equal ranks keep the order
 * the tracker listed the bugs in.
 */
import type { BugRecord } from '../bugs/record.js';
import type { OpenIssue } from '@open-tomato/rafa/ports';
import type { ReportBug } from '@open-tomato/rafa/report/parse';

import { basename } from 'node:path';

import { familyOf, NEW_CONTEXT_LEAF } from '@open-tomato/rafa/errors/codes';

import { parseBugRecord } from '../bugs/record.js';
import { UNKNOWN_VALUE } from '../bugs/title.js';

import { strippedText } from './bug-key.js';
import { testFailureOf, testFilesIn } from './test-failure.js';

/** A run of non-word characters, which words are split on. */
const NON_WORD = /\W+/;

/** A line that is nothing but a fence: three or more backticks. */
const FENCE_LINE = /^`{3,}$/;

/** A Markdown level-two heading line, as `./issue-text.ts` writes each section's. */
const HEADING_LINE = /^## (.+)$/;

/** The text a report or a bug is compared by: its `what` and its artifact, local paths taken out. */
export type ComparedText = Pick<ReportBug, 'what' | 'artifact'>;

/** One open bug the guard kept, and its score against the report. */
export interface ScoredIssue {
  readonly issue: OpenIssue;
  /** Its Jaccard score against the report, above 0 and at most 1. */
  readonly score: number;
}

/** How much each bonus adds to a rank, each from 0 to 1; `0` turns its signal off. */
export interface SimilarityWeights {
  /** Both causes are the same full code. */
  readonly causeLeaf: number;
  /** Both causes are of the same family, with different leaves. */
  readonly causeFamily: number;
  /** Both modules and both actions are equal, none `unknown`. */
  readonly boundary: number;
}

/** A signal that contributed to a rank. */
export type MatchedSignal = 'words' | 'cause' | 'cause-family' | 'boundary';

/** One open bug of the ranked list; see the module note. */
export interface RankedIssue {
  readonly issue: OpenIssue;
  /** Its rank: the word score plus each bonus that applies, above 0 and capped at 1. */
  readonly score: number;
  /** Its Jaccard word score alone, from 0 to 1. */
  readonly words: number;
  /** The signals that contributed to the rank, in {@link MatchedSignal} order. */
  readonly matched: readonly MatchedSignal[];
}

/** The fields of a record the bonuses read. */
type RankedFields = Pick<BugRecord, 'cause' | 'module' | 'action'>;

/** The word set of `text`; see the module note. */
export function wordSetOf(text: string): ReadonlySet<string> {
  const words = strippedText(text).toLowerCase()
    .split(NON_WORD)
    .filter((word) => word.length > 0);
  return new Set(words);
}

/** A report's word set: that of its `what` and its artifact together. */
export function reportWordsOf(report: ComparedText): ReadonlySet<string> {
  return wordSetOf(`${report.what ?? ''}\n${report.artifact ?? ''}`);
}

/** Shared words over every distinct word in either set; 0 when both are empty. */
export function jaccard(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  const shared = [...a].filter((word) => b.has(word)).length;
  const all = a.size + b.size - shared;
  return all === 0
    ? 0
    : shared / all;
}

/** The fenced value right after `start` in `lines`, or null when none opens there. */
function fencedValueAt(lines: readonly string[], start: number): string | null {
  const open = lines.slice(start).findIndex((line) => line.trim().length > 0);
  if (open === -1) return null;
  const fence = lines[start + open]!;
  if (!FENCE_LINE.test(fence)) return null;
  const body = lines.slice(start + open + 1);
  const close = body.indexOf(fence);
  return close === -1
    ? null
    : body.slice(0, close).join('\n');
}

/**
 * The fenced value of the first section headed `heading` in `body`, or
 * null when it has no such section or the section holds no fence.
 */
export function sectionValueOf(body: string, heading: string): string | null {
  const lines = body.split(/\r?\n/);
  const at = lines.findIndex((line) => HEADING_LINE.exec(line)?.[1]?.trim() === heading);
  return at === -1
    ? null
    : fencedValueAt(lines, at + 1);
}

/** The `what` and artifact an open bug's body was filed with; see the module note. */
export function issueTextOf(body: string): ComparedText {
  return {
    what: sectionValueOf(body, 'What'),
    artifact: sectionValueOf(body, 'Artifact'),
  };
}

/** An open bug's word set, from the `What` and `Artifact` sections of its body. */
export function issueWordsOf(body: string): ReadonlySet<string> {
  return reportWordsOf(issueTextOf(body));
}

/** The base name of the test file a text names, or null; see the module note. */
export function testFileOf(text: ComparedText): string | null {
  const file = testFailureOf(text)?.file
    ?? testFilesIn(text.artifact ?? '')[0]
    ?? testFilesIn(text.what ?? '')[0]
    ?? null;
  return file === null
    ? null
    : basename(file);
}

/** True when the report and a bug each name a test file and the two differ. */
export function namesOtherTestFile(reportFile: string | null, issueFile: string | null): boolean {
  return reportFile !== null && issueFile !== null && reportFile !== issueFile;
}

/**
 * The open bugs nearest `report`, highest score first, ties in the order
 * `openBugs` lists them, skipping each the test-file guard refuses and
 * each sharing no word with it; see the module note.
 */
export function nearestOpenBugs(report: ComparedText, openBugs: readonly OpenIssue[]): ScoredIssue[] {
  const words = reportWordsOf(report);
  const reportFile = testFileOf(report);
  const scored = openBugs.flatMap((issue): ScoredIssue[] => {
    const text = issueTextOf(issue.body);
    if (namesOtherTestFile(reportFile, testFileOf(text))) return [];
    const score = jaccard(words, reportWordsOf(text));
    return score > 0
      ? [{ issue, score }]
      : [];
  });
  // Array.prototype.sort is stable, so equal scores keep the tracker's order.
  return [...scored].sort((a, b) => b.score - a.score);
}

/** The cause a cause bonus reads, or null for none or a `new-context` leaf. */
function codedCause(cause: string | null): string | null {
  return cause === null || cause.endsWith(`:${NEW_CONTEXT_LEAF}`)
    ? null
    : cause;
}

/** The cause signal two records share, or null when neither cause bonus applies. */
function causeSignalOf(a: RankedFields, b: RankedFields): 'cause' | 'cause-family' | null {
  const first = codedCause(a.cause);
  const second = codedCause(b.cause);
  if (first === null || second === null) return null;
  if (first === second) return 'cause';
  const bothCoded = first.includes(':') && second.includes(':');
  return bothCoded && familyOf(first) === familyOf(second)
    ? 'cause-family'
    : null;
}

/** True for a module or action a boundary bonus reads: present and not `unknown`. */
function isKnownBoundary(value: string | null): value is string {
  return value !== null && value !== UNKNOWN_VALUE;
}

/** True when both records name the same known module and the same known action. */
function sharesBoundary(a: RankedFields, b: RankedFields): boolean {
  const known = [a.module, a.action, b.module, b.action].every(isKnownBoundary);
  return known && a.module === b.module && a.action === b.action;
}

/** The bonus signals two records share, each with its weight above 0, in {@link MatchedSignal} order. */
function bonusesOf(
  record: RankedFields | undefined,
  other: RankedFields,
  weights: SimilarityWeights,
): { readonly signal: MatchedSignal; readonly weight: number }[] {
  if (record === undefined) return [];
  const cause = causeSignalOf(record, other);
  const causeWeight = cause === 'cause'
    ? weights.causeLeaf
    : weights.causeFamily;
  const causeBonus = cause === null
    ? []
    : [{ signal: cause, weight: causeWeight }];
  const boundaryBonus = sharesBoundary(record, other)
    ? [{ signal: 'boundary' as const, weight: weights.boundary }]
    : [];
  return [...causeBonus, ...boundaryBonus].filter(({ weight }) => weight > 0);
}

/**
 * The open bugs ranked for the `Possible duplicates` list, highest rank
 * first, ties in the order `openBugs` lists them, skipping each the
 * test-file guard refuses and each ranked 0. `record` is the new bug's,
 * or undefined when it was filed without one; see the module note.
 */
export function rankedCandidates(
  report: ComparedText,
  record: BugRecord | undefined,
  openBugs: readonly OpenIssue[],
  weights: SimilarityWeights,
): RankedIssue[] {
  const reportWords = reportWordsOf(report);
  const reportFile = testFileOf(report);
  const ranked = openBugs.flatMap((issue): RankedIssue[] => {
    const text = issueTextOf(issue.body);
    if (namesOtherTestFile(reportFile, testFileOf(text))) return [];
    const words = jaccard(reportWords, reportWordsOf(text));
    const bonuses = bonusesOf(record, parseBugRecord(issue.body), weights);
    const sum = bonuses.reduce((total, { weight }) => total + weight, words);
    const score = Math.min(1, sum);
    const wordSignal: MatchedSignal[] = words > 0
      ? ['words']
      : [];
    const matched = [...wordSignal, ...bonuses.map(({ signal }) => signal)];
    return score > 0
      ? [{ issue, score, words, matched }]
      : [];
  });
  // Array.prototype.sort is stable, so equal ranks keep the tracker's order.
  return [...ranked].sort((a, b) => b.score - a.score);
}
