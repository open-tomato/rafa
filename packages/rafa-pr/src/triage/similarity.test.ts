/**
 * Tests for the nearest open bugs (`packages/rafa-pr/src/triage/similarity.ts`).
 *
 * Every open bug's body is written by `./issue-text.ts`'s own
 * {@link issueText}, so a change to the sections it writes that this
 * module stops reading turns these tests red.
 */
import type { SimilarityWeights } from './similarity.js';
import type { BugRecord } from '@open-tomato/rafa/bugs/record';
import type { OpenIssue } from '@open-tomato/rafa/ports';

import { EMPTY_BUG_RECORD, parseBugRecord } from '@open-tomato/rafa/bugs/record';
import { describe, expect, it } from 'bun:test';

import { COMMENT_OPENING, ISSUE_OPENING, issueText } from './issue-text.js';
import {
  issueWordsOf,
  jaccard,
  nearestOpenBugs,
  rankedCandidates,
  sectionValueOf,
  testFileOf,
  wordSetOf,
} from './similarity.js';

/** An open bug numbered `id`, its body filed from `what` and `artifact` as triage files one. */
function openBug(id: number, what: string, artifact: string | null, record?: BugRecord): OpenIssue {
  const body = issueText(ISSUE_OPENING, {
    what,
    artifact,
    ...(record === undefined
      ? {}
      : { record: { ...record, what, artifact } }),
    key: 'some key',
    refs: null,
    planStub: 'other-plan',
    taskText: 'Wire the loop to the tracker and report the run',
    feedback: 'The task went fine apart from the red test',
  }, (text) => text);
  return {
    ref: { opt: id, kind: 'github', externalId: String(id), url: `https://github.com/o/r/issues/${id}` },
    title: what,
    body,
    createdAt: null,
  };
}

/** The ids of `issues`, in order. */
function idsOf(scored: readonly { issue: OpenIssue }[]): string[] {
  return scored.map(({ issue }) => issue.ref.externalId);
}

describe('wordSetOf', () => {
  it('lower-cases, splits on non-word characters and strips as step 1 does', () => {
    const words = wordSetOf('Expected 42 at src/deep/A.ts, got deadbeef1 — Expected!');
    expect([...words].sort()).toEqual(['a', 'at', 'expected', 'got', 'ts']);
  });

  it('answers an empty set for text holding no word', () => {
    expect(wordSetOf('  123 -- ::  ').size).toBe(0);
    expect(wordSetOf('').size).toBe(0);
  });
});

describe('jaccard', () => {
  it('scores identical text 1', () => {
    const words = wordSetOf('the store refuses a row with no key');
    expect(jaccard(words, wordSetOf('The store refuses a row with no key.'))).toBe(1);
  });

  it('scores disjoint text 0', () => {
    expect(jaccard(wordSetOf('lint fails on imports'), wordSetOf('timeout while pushing branch'))).toBe(0);
  });

  it('scores shared words over all distinct words', () => {
    // {a, b, c} and {b, c, d}: two shared, four distinct.
    expect(jaccard(wordSetOf('a b c'), wordSetOf('b c d'))).toBe(0.5);
  });

  it('scores an empty word set 0 against itself and against any other, never NaN', () => {
    const empty = wordSetOf('42');
    expect(jaccard(empty, empty)).toBe(0);
    expect(jaccard(empty, wordSetOf('some words'))).toBe(0);
    expect(jaccard(wordSetOf('some words'), empty)).toBe(0);
  });
});

describe('reading an open bug body', () => {
  it('reads the fenced values of its What and Artifact sections, not its other sections', () => {
    const bug = openBug(1, 'the store drops a row', 'row dropped: key missing');
    expect(sectionValueOf(bug.body, 'What')).toBe('the store drops a row');
    expect(sectionValueOf(bug.body, 'Artifact')).toBe('row dropped: key missing');
    expect([...issueWordsOf(bug.body)].sort())
      .toEqual(['a', 'dropped', 'drops', 'key', 'missing', 'row', 'store', 'the']);
  });

  it('adds no word from the sentence a body holds for a missing artifact', () => {
    const bug = openBug(1, 'flaky push', null);
    expect(sectionValueOf(bug.body, 'Artifact')).toBeNull();
    expect([...issueWordsOf(bug.body)].sort()).toEqual(['flaky', 'push']);
  });

  it('reads a value holding backticks from its longer fence', () => {
    const bug = openBug(1, 'bad `code` and ```fence```', 'x');
    expect(sectionValueOf(bug.body, 'What')).toBe('bad `code` and ```fence```');
  });

  it('answers an empty word set for a body with neither section', () => {
    expect(issueWordsOf('A person wrote this bug by hand.\n\n## Steps\n\n1. run it').size).toBe(0);
    // Control: a comment body carries the same sections and is read.
    const comment = issueText(COMMENT_OPENING, {
      what: 'hand',
      artifact: null,
      key: null,
      refs: null,
      planStub: null,
      taskText: 't',
      feedback: null,
    }, (text) => text);
    expect([...issueWordsOf(comment)]).toEqual(['hand']);
  });
});

describe('testFileOf', () => {
  it('answers the base name of the file a case line names, else the first test file named', () => {
    expect(testFileOf({ what: 'red', artifact: 'src/x/a.test.ts > outer > adds\nboom' })).toBe('a.test.ts');
    expect(testFileOf({ what: 'see b.spec.tsx', artifact: 'failed at src/c.test.ts:12' })).toBe('c.test.ts');
    expect(testFileOf({ what: 'see b.spec.tsx', artifact: null })).toBe('b.spec.tsx');
    expect(testFileOf({ what: 'no test here', artifact: 'src/a.ts:3' })).toBeNull();
  });
});

describe('nearestOpenBugs', () => {
  const report = { what: 'merge test is red', artifact: 'src/effort/merge.test.ts > merge > keeps rows\nboom' };

  it('scores a bug filed from identical text 1', () => {
    const same = openBug(7, report.what, report.artifact);
    const [nearest] = nearestOpenBugs(report, [same]);
    expect(nearest?.issue).toBe(same);
    expect(nearest?.score).toBe(1);
  });

  it('answers no bug sharing no word with the report', () => {
    expect(nearestOpenBugs(report, [openBug(1, 'push times out', 'timeout after waiting')])).toEqual([]);
  });

  it('answers the bugs in score order', () => {
    const far = openBug(1, 'merge is slow', 'rows pile up');
    const near = openBug(2, 'merge test is red again', 'src/effort/merge.test.ts > merge > keeps rows\nboom');
    const nearer = openBug(3, report.what, report.artifact);
    const scored = nearestOpenBugs(report, [far, near, nearer]);
    expect(idsOf(scored)).toEqual(['3', '2', '1']);
    const scores = scored.map(({ score }) => score);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
  });

  it('keeps the order the tracker listed bugs in when their scores tie', () => {
    const first = openBug(9, report.what, report.artifact);
    const second = openBug(4, report.what, report.artifact);
    const third = openBug(6, report.what, report.artifact);
    expect(idsOf(nearestOpenBugs(report, [first, second, third]))).toEqual(['9', '4', '6']);
    expect(idsOf(nearestOpenBugs(report, [third, first, second]))).toEqual(['6', '9', '4']);
  });

  it('skips a bug naming another test file whatever its score, and keeps one naming none', () => {
    const otherFile = openBug(1, report.what, 'src/effort/split.test.ts > merge > keeps rows\nboom');
    const noFile = openBug(2, 'merge is red', 'keeps rows boom');
    const scored = nearestOpenBugs(report, [otherFile, noFile]);
    expect(idsOf(scored)).toEqual(['2']);
    // Control: without the guard the other file's bug outscores the one kept.
    expect(jaccard(wordSetOf(`${report.what}\n${report.artifact}`), issueWordsOf(otherFile.body)))
      .toBeGreaterThan(scored[0]!.score);
  });

  it('compares test files by base name, so a folder makes no difference', () => {
    const bare = openBug(1, report.what, 'merge.test.ts > merge > keeps rows\nboom');
    expect(idsOf(nearestOpenBugs(report, [bare]))).toEqual(['1']);
  });

  it('answers nothing for a report with an empty word set', () => {
    const empty = { what: '123', artifact: null };
    expect(nearestOpenBugs(empty, [openBug(1, report.what, report.artifact)])).toEqual([]);
  });

  it('answers nothing for a bug with an empty word set', () => {
    const blank: OpenIssue = { ...openBug(1, 'x', null), body: 'written by hand' };
    expect(nearestOpenBugs(report, [blank])).toEqual([]);
  });
});

describe('rankedCandidates', () => {
  /** The defaults of `triage.similarity.weights.*`. */
  const weights: SimilarityWeights = { causeLeaf: 0.15, causeFamily: 0.05, boundary: 0.1 };

  const report = { what: 'merge test is red', artifact: 'src/effort/merge.test.ts > merge > keeps rows\nboom' };

  /** A record holding `cause`, `module` and `action`. */
  function recordOf(cause: string | null, module: string | null, action: string | null): BugRecord {
    return { ...EMPTY_BUG_RECORD, summary: 'a summary', cause, module, action };
  }

  const record = recordOf('store:row-dropped', 'Effort Store', 'merging rows');

  /** An open bug sharing no word with the report, filed with `filed`. */
  function wordlessBug(id: number, filed: BugRecord): OpenIssue {
    return openBug(id, 'push times out', 'timeout after waiting', filed);
  }

  it('lists a bug sharing the cause leaf and no word, naming the cause', () => {
    const bug = wordlessBug(1, recordOf('store:row-dropped', null, null));
    // Control: the body is read back with the cause, and no word is shared.
    expect(parseBugRecord(bug.body).cause).toBe('store:row-dropped');
    expect(nearestOpenBugs(report, [bug])).toEqual([]);
    const [ranked, ...rest] = rankedCandidates(report, record, [bug], weights);
    expect(rest).toEqual([]);
    expect(ranked?.issue).toBe(bug);
    expect(ranked?.words).toBe(0);
    expect(ranked?.score).toBeCloseTo(0.15, 10);
    expect(ranked?.matched).toEqual(['cause']);
  });

  it('leaves the bug out when the cause leaf weighs 0', () => {
    const bug = wordlessBug(1, recordOf('store:row-dropped', null, null));
    expect(rankedCandidates(report, record, [bug], { ...weights, causeLeaf: 0 })).toEqual([]);
    // A bug sharing words stays listed, without the cause it no longer weighs.
    const worded = openBug(2, 'merge is slow', 'rows pile up', recordOf('store:row-dropped', null, null));
    const [ranked] = rankedCandidates(report, record, [worded], { ...weights, causeLeaf: 0 });
    expect(ranked?.matched).toEqual(['words']);
    expect(ranked?.score).toBe(ranked!.words);
  });

  it('names the cause family for the same family with another leaf, and the boundary for the same module and action', () => {
    const family = wordlessBug(1, recordOf('store:key-missing', null, null));
    const boundary = wordlessBug(2, recordOf(null, 'Effort Store', 'merging rows'));
    const ranked = rankedCandidates(report, record, [family, boundary], weights);
    expect(ranked.map(({ matched }) => matched)).toEqual([['boundary'], ['cause-family']]);
    expect(ranked.map(({ score }) => score)).toEqual([0.1, 0.05]);
  });

  it('adds the bonuses to the word score in signal order', () => {
    const bug = openBug(1, 'merge is slow', 'rows pile up', record);
    const [ranked] = rankedCandidates(report, record, [bug], weights);
    expect(ranked?.words).toBeGreaterThan(0);
    expect(ranked?.matched).toEqual(['words', 'cause', 'boundary']);
    expect(ranked?.score).toBeCloseTo(ranked!.words + 0.25, 10);
  });

  it('caps a rank at 1', () => {
    const same = openBug(7, report.what, report.artifact, record);
    const [ranked] = rankedCandidates(report, record, [same], weights);
    expect(ranked?.words).toBe(1);
    expect(ranked?.score).toBe(1);
    expect(ranked?.matched).toEqual(['words', 'cause', 'boundary']);
  });

  it('gives no bonus for unknown:new-context, another new-context or an unknown module and action', () => {
    const open = recordOf('unknown:new-context', 'unknown', 'unknown');
    const unknownBug = wordlessBug(1, open);
    // Control: the body is read back with the very values that earn nothing.
    expect(parseBugRecord(unknownBug.body)).toMatchObject({ cause: 'unknown:new-context', module: 'unknown', action: 'unknown' });
    expect(rankedCandidates(report, open, [unknownBug], weights)).toEqual([]);
    const familyNew = recordOf('store:new-context', 'unknown', 'merging rows');
    expect(rankedCandidates(report, familyNew, [wordlessBug(2, familyNew)], weights)).toEqual([]);
    expect(rankedCandidates(report, record, [wordlessBug(3, familyNew)], weights)).toEqual([]);
    // Control: the same record with a coded cause and known boundary earns both.
    expect(rankedCandidates(report, record, [wordlessBug(4, record)], weights)[0]?.matched)
      .toEqual(['cause', 'boundary']);
  });

  it('gives no bonus for a record with null fields, or for a new bug with no record', () => {
    const empty = recordOf(null, null, null);
    expect(rankedCandidates(report, empty, [wordlessBug(1, record)], weights)).toEqual([]);
    expect(rankedCandidates(report, record, [wordlessBug(2, empty)], weights)).toEqual([]);
    expect(rankedCandidates(report, undefined, [wordlessBug(3, record)], weights)).toEqual([]);
    const halfBoundary = recordOf(null, 'Effort Store', null);
    expect(rankedCandidates(report, halfBoundary, [wordlessBug(4, halfBoundary)], weights)).toEqual([]);
  });

  it('leaves out a bug naming another test file whatever its bonuses', () => {
    const otherFile = openBug(1, report.what, 'src/effort/split.test.ts > merge > keeps rows\nboom', record);
    const sameFile = openBug(2, 'merge is red', 'src/effort/merge.test.ts > merge > keeps rows', record);
    expect(idsOf(rankedCandidates(report, record, [otherFile, sameFile], weights))).toEqual(['2']);
  });

  it('ranks highest first and keeps the tracker order for equal ranks', () => {
    const first = wordlessBug(9, record);
    const second = wordlessBug(4, record);
    const words = openBug(5, report.what, report.artifact);
    expect(idsOf(rankedCandidates(report, record, [first, second, words], weights))).toEqual(['5', '9', '4']);
    expect(idsOf(rankedCandidates(report, record, [second, words, first], weights))).toEqual(['5', '4', '9']);
  });

  it('ranks on words alone like nearestOpenBugs when no bonus applies', () => {
    const bugs = [openBug(1, 'merge is slow', 'rows pile up'), openBug(2, report.what, report.artifact)];
    const ranked = rankedCandidates(report, record, bugs, weights);
    const nearest = nearestOpenBugs(report, bugs);
    expect(ranked.map(({ issue, score }) => ({ issue, score }))).toEqual(nearest);
    expect(ranked.every(({ matched, score, words }) => matched.join() === 'words' && score === words)).toBe(true);
  });
});
