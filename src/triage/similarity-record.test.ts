/**
 * The bug record's sections (`./issue-text.ts`, #991) leave the lookup alone:
 * over every filing of `./testdata/scoring.json`, the issue bodies written
 * with a full record give the same same-bug decision and the same
 * `Possible duplicates` list as the bodies written without one, and the
 * recurrence-key fixtures of `./bug-key.test.ts` key as before, read back
 * from a body with the record. `./similarity-scoring.test.ts` measures the
 * decision against the board; this file only compares the two bodies.
 */
import type { BugValues } from './issue-text.js';
import type { Filing, ScoringFixture } from './scoring-fixture.js';
import type { OpenIssue } from '@open-tomato/rafa/ports';

import { describe, expect, it } from 'bun:test';

import { EMPTY_BUG_RECORD } from '@open-tomato/rafa/bugs/record';
import { bugKeyOf } from '@open-tomato/rafa/triage/bug-key';

import { ISSUE_OPENING, issueText, possibleDuplicatesSection } from './issue-text.js';
import { nearestOpenBugs, rankedCandidates, sectionValueOf } from './similarity.js';

/** The default of `triage.similarity.threshold`. */
const THRESHOLD = 0.3;

/** The default of `triage.similarity.listed`: how many nearest bugs a section lists. */
const LISTED = 3;

const fixture = await Bun.file(new URL('./testdata/scoring.json', import.meta.url)).json() as ScoringFixture;

/** The defaults of `triage.similarity.weights.*`. */
const DEFAULT_WEIGHTS = { causeLeaf: 0.15, causeFamily: 0.05, boundary: 0.10 } as const;

const identity = (text: string): string => text;

/** The values of `filing`'s body, without a record. */
function plainValues(filing: Filing, key: string | null): BugValues {
  return {
    what: filing.what,
    artifact: filing.artifact,
    key,
    refs: null,
    planStub: filing.plan,
    taskText: 'Fix the thing in the module',
    feedback: 'The session reported this while running its task.',
  };
}

/** The same values with every record section a filing can carry. */
function recordValues(filing: Filing, key: string | null): BugValues {
  return {
    ...plainValues(filing, key),
    record: {
      ...EMPTY_BUG_RECORD,
      summary: 'a summary of the bug that shares words with nothing',
      what: filing.what,
      artifact: filing.artifact,
      reproduce: 'seen while running the task of the plan',
      rerun: 'bun test src/a.test.ts -t "adds"',
      cause: 'unknown:new-context',
      proposed: 'a-leaf',
      suspected: 'the checker reads the wrong directory',
      module: 'unknown',
      action: 'unknown',
      environment: 'local',
      versions: 'rafa: 1.2.3\ncommit: abc1234',
    },
    reported: { module: 'Loop Start', action: 'starting the loop' },
  };
}

/** The key step 1 looks `filing` up by, or null when it has no artifact. */
function keyOf(filing: Filing): string | null {
  return filing.artifact === null
    ? null
    : bugKeyOf(`PLAN_TRACKER-${filing.plan ?? 'none'}.md`, filing.artifact, filing.what);
}

/** The open issue filed for `filing`, its body built by `valuesOf`. */
function openIssueOf(filing: Filing, valuesOf: (filing: Filing, key: string | null) => BugValues): OpenIssue {
  const key = keyOf(filing);
  const values = valuesOf(filing, key);
  const body = issueText(ISSUE_OPENING, {
    ...values,
    duplicates: { threshold: THRESHOLD, nearest: [] },
  }, identity);
  return {
    ref: { opt: filing.cause, kind: 'github', externalId: String(filing.cause), url: null },
    title: filing.what,
    body,
    createdAt: null,
  };
}

/** What the lookup answered for one filing. */
interface Lookup {
  readonly reached: number | null;
  readonly duplicates: string;
}

/** Files `filings` in order as `replay` of the scoring test does, recording each lookup's answer. */
function lookupsOf(
  filings: readonly Filing[],
  valuesOf: (filing: Filing, key: string | null) => BugValues,
): Lookup[] {
  const open = new Map<number, OpenIssue>();
  const stored = new Map<string, number>();
  return filings.map((filing) => {
    const key = keyOf(filing);
    const keyed = key === null
      ? undefined
      : stored.get(key);
    const nearest = nearestOpenBugs(filing, [...open.values()]);
    const [best] = nearest;
    const byWords = keyed === undefined && best !== undefined && best.score >= THRESHOLD
      ? best.issue.ref.opt
      : null;
    const reached = keyed ?? byWords;
    if (key !== null && keyed === undefined) stored.set(key, reached ?? filing.cause);
    if (!open.has(filing.cause)) open.set(filing.cause, openIssueOf(filing, valuesOf));
    return {
      reached,
      duplicates: possibleDuplicatesSection({ threshold: THRESHOLD, nearest: nearest.slice(0, LISTED).map(({ issue, score }) => ({ issue, score, words: score, matched: ['words'] as const })) }, identity),
    };
  });
}

describe('the bodies with the bug record, over the scoring fixture', () => {
  const plain = lookupsOf(fixture.filings, plainValues);
  const withRecord = lookupsOf(fixture.filings, recordValues);

  it('holds the filings of the fixture, so the comparison is not empty', () => {
    expect(plain.length).toBe(fixture.filings.length);
    expect(plain.length).toBeGreaterThan(100);
    expect(plain.some(({ reached }) => reached !== null)).toBe(true);
  });

  it('takes every filing for the same bug as the body without the record does', () => {
    expect(withRecord.map(({ reached }) => reached)).toEqual(plain.map(({ reached }) => reached));
  });

  it('lists the same Possible duplicates, names and scores, for every filing', () => {
    expect(withRecord.map(({ duplicates }) => duplicates)).toEqual(plain.map(({ duplicates }) => duplicates));
  });

  it('control: the two bodies of a filing are not the same text', () => {
    const [first] = fixture.filings;
    expect(openIssueOf(first!, recordValues).body).not.toBe(openIssueOf(first!, plainValues).body);
  });
});

/** What both lookups answered for one filing, the record-bodied issues open. */
interface Pairing {
  readonly nearest: ReturnType<typeof nearestOpenBugs>;
  readonly ranked: ReturnType<typeof rankedCandidates>;
}

/** Files every filing as `lookupsOf` does, with record bodies, pairing the word lookup with the ranked list. */
function pairingsOf(filings: readonly Filing[]): Pairing[] {
  const open = new Map<number, OpenIssue>();
  return filings.map((filing) => {
    const issues = [...open.values()];
    const { record } = recordValues(filing, keyOf(filing));
    const pairing = {
      nearest: nearestOpenBugs(filing, issues),
      ranked: rankedCandidates(filing, record, issues, DEFAULT_WEIGHTS),
    };
    if (!open.has(filing.cause)) open.set(filing.cause, openIssueOf(filing, recordValues));
    return pairing;
  });
}

/** The issue the word scores alone put first among `ranked`, as the same-bug decision reads it. */
function bestByWords(ranked: Pairing['ranked']): number | null {
  const withWords = ranked.filter(({ words }) => words > 0);
  const best = [...withWords].sort((a, b) => b.words - a.words)[0];
  return best !== undefined && best.words >= THRESHOLD
    ? best.issue.ref.opt
    : null;
}

describe('the ranked list with the default weights, over the scoring fixture', () => {
  const pairings = pairingsOf(fixture.filings);

  it('leaves the same-bug decision of every filing as the word lookup gave it', () => {
    const decided = pairings.map(({ nearest }) => {
      const [best] = nearest;
      return best !== undefined && best.score >= THRESHOLD
        ? best.issue.ref.opt
        : null;
    });
    expect(pairings.map(({ ranked }) => bestByWords(ranked))).toEqual(decided);
    expect(decided.some((reached) => reached !== null)).toBe(true);
  });

  it('gives bodies sharing unknown:new-context and unknown no bonus', () => {
    const ranked = pairings.flatMap((pairing) => pairing.ranked);
    expect(ranked.length).toBeGreaterThan(0);
    for (const entry of ranked) {
      expect(entry.matched).toEqual(['words']);
      expect(entry.score).toBe(entry.words);
    }
  });
});

/** The recurrence-key fixtures of `./bug-key.test.ts`: tracker, artifact, what, and the key each gave. */
const KEY_FIXTURES: readonly (readonly [string, string, string | undefined, string])[] = [
  ['/repo/.rafa/plans/PLAN_TRACKER-demo.md', [
    'bun test v1.4.2 (744846f84)',
    '',
    'src/sub/a.test.ts:',
    '2 | describe(\'outer\', () => { it(\'adds\', () => { expect(1 + 1).toBe(3); }); });',
    '                                                               ^',
    'error: expect(received).toBe(expected)',
    '',
    '      at <anonymous> (/tmp/x/src/sub/a.test.ts:2:60)',
    '(fail) outer > adds [0.19ms]',
  ].join('\n'), 'a test fails', 'a.test.ts > outer > adds: expect(received).toBe(expected)'],
  ['/elsewhere/.rafa/plans/PLAN_TRACKER-other.md',
    '/tmp/x/src/sub/a.test.ts > outer > adds\nexpect(received).toBe(expected)',
    'The adds case is red on main',
    'a.test.ts > outer > adds: expect(received).toBe(expected)'],
  ['/repo/.rafa/plans/PLAN_TRACKER-demo.md',
    '/tmp/x/src/sub/a.test.ts > outer > adds\nerror: boom 42 in /tmp/x/cache/1a2b3c4d.json', undefined,
    'a.test.ts > outer > adds: boom in .json'],
  ['/repo/.rafa/plans/PLAN_TRACKER-demo.md', 'src/a.test.ts > parses 2 lines\nboom', undefined,
    'a.test.ts > parses 2 lines: boom'],
  ['/repo/.rafa/plans/PLAN_TRACKER-demo.md', 'expect(received).toBe(expected)', 'src/a.test.ts > outer > adds',
    'a.test.ts > outer > adds: expect(received).toBe(expected)'],
  ['/repo/.rafa/plans/PLAN_TRACKER-demo.md', '(fail) outer > adds [0.19ms]', undefined, 'outer > adds'],
  ['/repo/.rafa/plans/PLAN_TRACKER-demo.md', 'src/a.test.ts:\n(fail) outer > adds [0.19ms]', undefined,
    'a.test.ts > outer > adds'],
  ['/repo/.rafa/plans/PLAN_TRACKER-demo.md', 'src/triage/a.ts:12:5  error   no-unused-vars at 1a2b3c4d', undefined,
    'PLAN_TRACKER-demo.md: a.ts:: error no-unused-vars at'],
  ['/repo/.rafa/plans/PLAN_TRACKER-demo.md', 'src/a.test.ts:246 fails', undefined,
    'PLAN_TRACKER-demo.md: a.test.ts: fails'],
  ['/repo/.rafa/plans/PLAN_TRACKER-demo.md', '  4  2 ', undefined, 'PLAN_TRACKER-demo.md: 4 2'],
];

describe('the recurrence keys of bug-key.test.ts', () => {
  it.each(KEY_FIXTURES)('keys %# as before, and a body with the record carries that key', (tracker, artifact, what, expected) => {
    const key = bugKeyOf(tracker, artifact, what);
    expect(key).toBe(expected);

    const body = issueText(ISSUE_OPENING, {
      ...recordValues({ issue: 1, cause: 1, what: what ?? 'w', artifact, plan: 'demo' }, key),
    }, identity);
    expect(sectionValueOf(body, 'Recurrence key')).toBe(expected);
  });
});
