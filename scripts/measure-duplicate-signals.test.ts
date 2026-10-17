import type { BugRecord } from '../src/bugs/record.js';
import type { BoardIssue, CauseJudgement } from '../src/triage/scoring-fixture.js';

import { describe, expect, it } from 'bun:test';

import { EMPTY_BUG_RECORD, renderBugBody } from '../src/bugs/record.js';

import {
  MEANINGFUL_CARRIERS,
  countSignals,
  judgedIssues,
  measureOf,
  pairsOf,
  reportLines,
} from './measure-duplicate-signals.js';

/**
 * The pieces of `scripts/measure-duplicate-signals.ts` that run without
 * the board: the judged issues and their cause labels, the pairing, the
 * counting of each signal and the printed lines. No case runs `gh`.
 */

const NO_JUDGEMENT: CauseJudgement = { groups: {}, excluded: [], filings: {} };

/** A board issue whose body is the record `fields` fill, closed by `comments`. */
function issue(number: number, fields: Partial<BugRecord>, comments: readonly string[] = []): BoardIssue {
  return {
    number,
    body: renderBugBody({ ...EMPTY_BUG_RECORD, ...fields }),
    createdAt: '2026-01-01T00:00:00Z',
    comments: comments.map((body) => ({ body, createdAt: '2026-01-02T00:00:00Z' })),
  };
}

describe('judgedIssues', () => {
  it('labels a duplicate with the cause it links to, and every other issue with its own', () => {
    const issues = [issue(1, {}), issue(2, {}, ['Duplicate of #1']), issue(3, {})];
    const labels = judgedIssues(issues, NO_JUDGEMENT).map(({ number, label }) => [number, label]);
    expect(labels).toEqual([[1, 1], [2, 1], [3, 3]]);
  });

  it('leaves out an excluded issue and one numbered after the judgement\'s through', () => {
    const issues = [issue(1, {}), issue(2, {}), issue(3, {})];
    const judged = judgedIssues(issues, { ...NO_JUDGEMENT, excluded: [2], through: 2 });
    expect(judged.map(({ number }) => number)).toEqual([1]);
  });

  it('reads the cause, module and action from the body\'s record', () => {
    const body = { cause: 'git:branch-not-found', module: 'triage', action: 'file' };
    const [judged] = judgedIssues([issue(1, body)], NO_JUDGEMENT);
    expect(judged?.fields).toEqual(body);
  });
});

describe('pairsOf', () => {
  it('pairs every two issues once and marks the pairs sharing a label', () => {
    const issues = judgedIssues([issue(1, {}), issue(2, {}, ['Duplicate of #1']), issue(3, {})], NO_JUDGEMENT);
    const pairs = pairsOf(issues).map(({ first, second, sameLabel }) => [first.number, second.number, sameLabel]);
    expect(pairs).toEqual([[1, 2, true], [1, 3, false], [2, 3, false]]);
  });

  it('answers no pair for fewer than two issues', () => {
    expect(pairsOf(judgedIssues([issue(1, {})], NO_JUDGEMENT))).toEqual([]);
  });
});

describe('countSignals', () => {
  /** The counts over the one pair of `a` and `b`. */
  function countsOf(a: Partial<BugRecord>, b: Partial<BugRecord>) {
    return countSignals(pairsOf(judgedIssues([issue(1, a), issue(2, b)], NO_JUDGEMENT)));
  }

  it('counts a shared full code as a cause leaf and not as a family', () => {
    const counts = countsOf({ cause: 'git:branch-not-found' }, { cause: 'git:branch-not-found' });
    expect([counts.causeLeaf, counts.causeFamily]).toEqual([1, 0]);
  });

  it('counts one family with different leaves as a cause family', () => {
    const counts = countsOf({ cause: 'git:branch-not-found' }, { cause: 'git:dirty-tree' });
    expect([counts.causeLeaf, counts.causeFamily]).toEqual([0, 1]);
  });

  it('counts no cause signal for a shared new-context leaf, nor for a cause only one bug carries', () => {
    const context = countsOf({ cause: 'unknown:new-context' }, { cause: 'unknown:new-context' });
    const oneSided = countsOf({ cause: 'git:branch-not-found' }, {});
    expect([context.causeLeaf, context.causeFamily, oneSided.causeLeaf]).toEqual([0, 0, 0]);
  });

  it('counts a shared module and action, and never one of them unknown', () => {
    const known = countsOf({ module: 'triage', action: 'file' }, { module: 'triage', action: 'file' });
    const unknown = countsOf({ module: 'unknown', action: 'file' }, { module: 'unknown', action: 'file' });
    expect([known.boundary, unknown.boundary]).toEqual([1, 0]);
  });

  it('takes the mean word score over every pair, and 0 for no pairs', () => {
    const issues = judgedIssues([
      issue(1, { what: 'alpha beta' }),
      issue(2, { what: 'alpha beta' }),
      issue(3, { what: 'gamma' }),
    ], NO_JUDGEMENT);
    // The pairs score 1, 0 and 0.
    expect(countSignals(pairsOf(issues)).meanWords).toBeCloseTo(1 / 3);
    expect(countSignals([])).toEqual({ pairs: 0, causeLeaf: 0, causeFamily: 0, boundary: 0, meanWords: 0 });
  });
});

describe('measureOf and reportLines', () => {
  const issues = judgedIssues([
    issue(1, { cause: 'git:branch-not-found' }),
    issue(2, { cause: 'git:branch-not-found' }, ['Duplicate of #1']),
    issue(3, { cause: 'git:branch-not-found' }),
    issue(4, {}),
  ], NO_JUDGEMENT);

  it('splits the pairs by label and counts the issues carrying a cause', () => {
    const measure = measureOf(issues);
    expect(measure.carriers).toBe(3);
    expect([measure.same.pairs, measure.same.causeLeaf]).toEqual([1, 1]);
    expect([measure.different.pairs, measure.different.causeLeaf]).toEqual([5, 2]);
  });

  it('prints the cause count first, saying the measure is not yet meaningful below the floor', () => {
    const [first] = reportLines(measureOf(issues));
    expect(first).toBe(`[duplicate-signals] 3 issues carry a cause; the measure is not yet meaningful below ${String(MEANINGFUL_CARRIERS)}`);
  });

  it('drops the note at the floor', () => {
    const measure = { ...measureOf(issues), carriers: MEANINGFUL_CARRIERS };
    const lines = reportLines(measure);
    expect(lines[0]).toBe(`[duplicate-signals] ${String(MEANINGFUL_CARRIERS)} issues carry a cause`);
    expect(lines.slice(1).map((line) => line.split(':')[0])).toEqual([
      '[duplicate-signals] same cause',
      '[duplicate-signals] different cause',
    ]);
  });
});
