/**
 * Tests for the nearest open bugs (`src/triage/similarity.ts`).
 *
 * Every open bug's body is written by `./issue-text.ts`'s own
 * {@link issueText}, so a change to the sections it writes that this
 * module stops reading turns these tests red.
 */
import type { OpenIssue } from '../ports/index.js';

import { describe, expect, it } from 'bun:test';

import { COMMENT_OPENING, ISSUE_OPENING, issueText } from './issue-text.js';
import {
  issueWordsOf,
  jaccard,
  nearestOpenBugs,
  sectionValueOf,
  testFileOf,
  wordSetOf,
} from './similarity.js';

/** An open bug numbered `id`, its body filed from `what` and `artifact` as triage files one. */
function openBug(id: number, what: string, artifact: string | null): OpenIssue {
  const body = issueText(ISSUE_OPENING, {
    what,
    artifact,
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
