/**
 * Step 2 of loop-owned triage's public lookup (`./triage.ts`): the open
 * bugs nearest a report, by the words they share. The exact key of step 1
 * (`./bug-key.ts`) misses a failure worded a new way; this step compares
 * what the report says with what each open bug said when it was filed.
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
 */
import type { OpenIssue } from '../ports/index.js';
import type { ReportBug } from '../report/parse.js';

import { basename } from 'node:path';

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
