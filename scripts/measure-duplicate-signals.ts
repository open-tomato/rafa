/**
 * Duplicate signal measure: reads the board's bug issues with `gh` and
 * says how often each signal of the ranked `Possible duplicates` list
 * (`rankedCandidates` of `src/triage/similarity.ts`) holds between two
 * issues that are one bug, and between two that are not.
 *
 * Each issue's cause label is `causeOf` of `src/triage/scoring-fixture.ts`
 * over `src/triage/testdata/scoring-causes.json` and the board's
 * `Duplicate of #N` comments. An issue is judged when that label is not
 * null and the judgement's `through`, when set, reaches its number. Every
 * pair of judged issues falls on one side: the pairs whose labels are
 * equal, and the pairs whose labels differ. For each side it counts the
 * pairs sharing a cause leaf (the same full code), a cause family with
 * another leaf, and a module and action, each read as the bonuses read
 * them (`causeSignalOf` and `sharesBoundary`) over the record
 * `parseBugRecord` reads from the body, and the mean word score of
 * `jaccard` over `issueWordsOf`.
 *
 * It first prints how many judged issues carry a cause, and says the
 * measure is not yet meaningful below {@link MEANINGFUL_CARRIERS}; it
 * refuses nothing on that count.
 *
 * Usage:
 *   bun scripts/measure-duplicate-signals.ts
 *
 * It needs `gh` signed in with read access to the board, and is run from
 * the repository checkout. It writes nothing.
 *
 * Exit codes: 0 printed, 2 the read could not run.
 */
import type { BoardIssue, CauseJudgement } from '../src/triage/scoring-fixture.js';
import type { RankedFields } from '../src/triage/similarity.js';

import { resolve } from 'node:path';

import { parseBugRecord } from '@open-tomato/rafa/bugs/record';
import { messageOf } from '@open-tomato/rafa/core/config/sections';

import { FIXTURE_REPO, causeOf } from '../src/triage/scoring-fixture.js';
import { causeSignalOf, issueWordsOf, jaccard, sharesBoundary } from '../src/triage/similarity.js';

/** Prefix on every line this script writes. */
export const TAG = '[duplicate-signals]';

/** The fewest issues carrying a cause below which the measure is not yet meaningful. */
export const MEANINGFUL_CARRIERS = 100;

/** The most issues one `gh issue list` answers. */
const ISSUE_LIMIT = '2000';

/** The judgement file, relative to the checkout. */
const CAUSES_FILE = 'src/triage/testdata/scoring-causes.json';

/** The digits a mean word score is printed with. */
const SCORE_DIGITS = 3;

/** One judged issue: its cause label, the record fields the bonuses read, and its word set. */
export interface MeasuredIssue {
  readonly number: number;
  /** The number of the issue owning its cause, as `causeOf` labels it. */
  readonly label: number;
  readonly fields: RankedFields;
  readonly words: ReadonlySet<string>;
}

/** Two judged issues, and whether their cause labels are equal. */
export interface IssuePair {
  readonly first: MeasuredIssue;
  readonly second: MeasuredIssue;
  readonly sameLabel: boolean;
}

/** What one side of the measure counted. */
export interface SignalCounts {
  readonly pairs: number;
  /** Pairs whose causes are the same full code. */
  readonly causeLeaf: number;
  /** Pairs whose causes are of one family with different leaves. */
  readonly causeFamily: number;
  /** Pairs sharing a known module and a known action. */
  readonly boundary: number;
  /** The mean `jaccard` word score; 0 for no pairs. */
  readonly meanWords: number;
}

/** The measure: both sides, and how many judged issues carry a cause. */
export interface SignalMeasure {
  readonly carriers: number;
  readonly same: SignalCounts;
  readonly different: SignalCounts;
}

/**
 * The issues of `issues` the judgement covers and gives a cause label,
 * in the order given; see the module note.
 */
export function judgedIssues(issues: readonly BoardIssue[], judgement: CauseJudgement): MeasuredIssue[] {
  const byNumber = new Map(issues.map((issue) => [issue.number, issue]));
  const { through } = judgement;
  return issues.flatMap((issue): MeasuredIssue[] => {
    if (through !== undefined && issue.number > through) return [];
    const label = causeOf(issue, byNumber, judgement);
    if (label === null) return [];
    const { cause, module, action } = parseBugRecord(issue.body);
    return [{ number: issue.number, label, fields: { cause, module, action }, words: issueWordsOf(issue.body) }];
  });
}

/** Every unordered pair of `issues`, each once, in the order given. */
export function pairsOf(issues: readonly MeasuredIssue[]): IssuePair[] {
  return issues.flatMap((first, at) => issues.slice(at + 1).map((second) => ({
    first,
    second,
    sameLabel: first.label === second.label,
  })));
}

/** The counts of `pairs`; see {@link SignalCounts}. */
export function countSignals(pairs: readonly IssuePair[]): SignalCounts {
  const start = { causeLeaf: 0, causeFamily: 0, boundary: 0, words: 0 };
  const sums = pairs.reduce((total, { first, second }) => {
    const cause = causeSignalOf(first.fields, second.fields);
    return {
      causeLeaf: total.causeLeaf + Number(cause === 'cause'),
      causeFamily: total.causeFamily + Number(cause === 'cause-family'),
      boundary: total.boundary + Number(sharesBoundary(first.fields, second.fields)),
      words: total.words + jaccard(first.words, second.words),
    };
  }, start);
  return {
    pairs: pairs.length,
    causeLeaf: sums.causeLeaf,
    causeFamily: sums.causeFamily,
    boundary: sums.boundary,
    meanWords: pairs.length === 0
      ? 0
      : sums.words / pairs.length,
  };
}

/** The measure over `issues`, already judged. */
export function measureOf(issues: readonly MeasuredIssue[]): SignalMeasure {
  const pairs = pairsOf(issues);
  return {
    carriers: issues.filter(({ fields }) => fields.cause !== null).length,
    same: countSignals(pairs.filter(({ sameLabel }) => sameLabel)),
    different: countSignals(pairs.filter(({ sameLabel }) => !sameLabel)),
  };
}

/** One printed side of the measure. */
function sideLine(name: string, counts: SignalCounts): string {
  return `${TAG} ${name}: ${String(counts.pairs)} pairs, cause leaf ${String(counts.causeLeaf)}, `
    + `cause family ${String(counts.causeFamily)}, module and action ${String(counts.boundary)}, `
    + `mean words ${counts.meanWords.toFixed(SCORE_DIGITS)}`;
}

/** The lines the script prints for `measure`, the cause count first. */
export function reportLines(measure: SignalMeasure): string[] {
  const note = measure.carriers < MEANINGFUL_CARRIERS
    ? `; the measure is not yet meaningful below ${String(MEANINGFUL_CARRIERS)}`
    : '';
  return [
    `${TAG} ${String(measure.carriers)} issues carry a cause${note}`,
    sideLine('same cause', measure.same),
    sideLine('different cause', measure.different),
  ];
}

/** The bug issues of the board, open and closed, with their comments. */
function readBoard(): BoardIssue[] {
  const run = Bun.spawnSync([
    'gh', 'issue', 'list', '--repo', FIXTURE_REPO, '--label', 'type:bug', '--state', 'all',
    '--limit', ISSUE_LIMIT, '--json', 'number,title,body,createdAt,comments',
  ]);
  if (run.exitCode !== 0) throw new Error(`gh issue list failed: ${run.stderr.toString().trim()}`);
  return JSON.parse(run.stdout.toString()) as BoardIssue[];
}

/** Prints the measure, answering the exit code. */
async function main(): Promise<number> {
  const judgement = await Bun.file(resolve(CAUSES_FILE)).json() as CauseJudgement;
  const measure = measureOf(judgedIssues(readBoard(), judgement));
  for (const line of reportLines(measure)) console.log(line);
  return 0;
}

if (import.meta.main) {
  let code = 2;
  try {
    code = await main();
  } catch (err) {
    console.error(`${TAG} FAIL — ${messageOf(err)}`);
  }
  process.exit(code);
}
