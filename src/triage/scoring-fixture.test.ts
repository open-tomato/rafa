/**
 * Tests for the scoring fixture's reading (`src/triage/scoring-fixture.ts`):
 * how a board's issues become labelled filings, in what order, and what
 * the leak check refuses. Issue bodies are written by `./issue-text.ts`.
 */
import type { BoardIssue, CauseJudgement } from './scoring-fixture.js';

import { describe, expect, it } from 'bun:test';

import { COMMENT_OPENING, ISSUE_OPENING, issueText } from './issue-text.js';
import { causeOf, filingsOf, firstLeakIn, leaksIn } from './scoring-fixture.js';

const NO_JUDGEMENT: CauseJudgement = { groups: {}, excluded: [], filings: {} };

const keep = (text: string): string => text;

/** The text of a report written under `opening`. */
function report(opening: string, what: string): string {
  return issueText(opening, {
    what,
    artifact: `artifact of ${what}`,
    key: null,
    refs: null,
    planStub: 'a-plan',
    taskText: 'a task',
    feedback: null,
  }, keep);
}

/** A board issue triage filed, its comments each a `Reported again` of `repeats` or a plain `note`. */
function issue(
  number: number,
  at: string,
  what: string,
  comments: readonly { body: string; at: string }[] = [],
): BoardIssue {
  return {
    number,
    createdAt: at,
    body: report(ISSUE_OPENING, what),
    comments: comments.map(({ body, at: createdAt }) => ({ body, createdAt })),
  };
}

/** A comment reporting `what` again. */
function again(what: string, at: string): { body: string; at: string } {
  return { body: report(COMMENT_OPENING, what), at };
}

/** A person's comment. */
function note(body: string, at: string): { body: string; at: string } {
  return { body, at };
}

/** The issues of `list` by number. */
function indexed(list: readonly BoardIssue[]): ReadonlyMap<number, BoardIssue> {
  return new Map(list.map((one) => [one.number, one]));
}

describe('causeOf', () => {
  it('is the issue itself when nothing says otherwise', () => {
    const only = issue(5, '2026-01-01T00:00:00Z', 'a bug');
    expect(causeOf(only, indexed([only]), NO_JUDGEMENT)).toBe(5);
  });

  it('follows a Duplicate of #N comment to N, and on through N', () => {
    const root = issue(1, '2026-01-01T00:00:00Z', 'root');
    const mid = issue(2, '2026-01-02T00:00:00Z', 'mid', [note('Duplicate of #1: same.', '2026-01-03T00:00:00Z')]);
    const leaf = issue(3, '2026-01-03T00:00:00Z', 'leaf', [note('Inherited: duplicate of #2, same.', '2026-01-04T00:00:00Z')]);
    expect(causeOf(leaf, indexed([root, mid, leaf]), NO_JUDGEMENT)).toBe(1);
  });

  it('stops at a loop of links rather than following it for ever', () => {
    const a = issue(1, '2026-01-01T00:00:00Z', 'a', [note('Duplicate of #2', '2026-01-02T00:00:00Z')]);
    const b = issue(2, '2026-01-01T00:00:00Z', 'b', [note('Duplicate of #1', '2026-01-02T00:00:00Z')]);
    expect(causeOf(a, indexed([a, b]), NO_JUDGEMENT)).toBeTypeOf('number');
  });

  it('is none for an issue folded into the many causes behind it', () => {
    const folded = issue(4, '2026-01-01T00:00:00Z', 'folded', [
      note('Duplicate, closed in the stretch 1 sweep: every cause has one kept issue', '2026-01-02T00:00:00Z'),
    ]);
    expect(causeOf(folded, indexed([folded]), NO_JUDGEMENT)).toBeNull();
  });

  it('is the judgement first: a group over a link, and none for an excluded issue', () => {
    const root = issue(1, '2026-01-01T00:00:00Z', 'root');
    const linked = issue(2, '2026-01-02T00:00:00Z', 'linked', [note('Duplicate of #1', '2026-01-03T00:00:00Z')]);
    const grouped: CauseJudgement = { groups: { 9: [1, 2, 7] }, excluded: [], filings: {} };
    expect(causeOf(linked, indexed([root, linked]), grouped)).toBe(9);
    expect(causeOf(root, indexed([root, linked]), grouped)).toBe(9);
    const excluded: CauseJudgement = { groups: {}, excluded: [2], filings: {} };
    expect(causeOf(linked, indexed([root, linked]), excluded)).toBeNull();
  });

  it('maps a link onto the group of the issue it names', () => {
    const root = issue(1, '2026-01-01T00:00:00Z', 'root');
    const linked = issue(2, '2026-01-02T00:00:00Z', 'linked', [note('Duplicate of #1', '2026-01-03T00:00:00Z')]);
    const grouped: CauseJudgement = { groups: { 9: [1] }, excluded: [], filings: {} };
    expect(causeOf(linked, indexed([root, linked]), grouped)).toBe(9);
  });
});

describe('filingsOf', () => {
  it('writes the issue and each Reported again comment, oldest first, with the issue cause', () => {
    const later = issue(2, '2026-02-01T00:00:00Z', 'second bug');
    const first = issue(1, '2026-01-01T00:00:00Z', 'first bug', [
      note('Looking into it.', '2026-01-02T00:00:00Z'),
      again('first bug again', '2026-03-01T00:00:00Z'),
    ]);
    const filings = filingsOf([later, first], keep, NO_JUDGEMENT);
    expect(filings.map(({ what, issue: number, comment, cause }) => [what, number, comment, cause])).toEqual([
      ['first bug', 1, undefined, 1],
      ['second bug', 2, undefined, 2],
      ['first bug again', 1, 2, 1],
    ]);
    expect(filings[0]!.plan).toBe('a-plan');
  });

  it('leaves out an issue a person wrote, and its comments', () => {
    const person: BoardIssue = {
      number: 3,
      createdAt: '2026-01-01T00:00:00Z',
      body: '## What happens\n\nSomething.',
      comments: [{ body: report(COMMENT_OPENING, 'again'), createdAt: '2026-01-02T00:00:00Z' }],
    };
    expect(filingsOf([person], keep, NO_JUDGEMENT)).toEqual([]);
  });

  it('gives a misplaced comment the cause the judgement reads, a bug of its own, or none', () => {
    const host = issue(1, '2026-01-01T00:00:00Z', 'host', [
      again('about another bug', '2026-01-02T00:00:00Z'),
      again('a new bug', '2026-01-03T00:00:00Z'),
      again('many bugs', '2026-01-04T00:00:00Z'),
    ]);
    const judgement: CauseJudgement = { groups: {}, excluded: [], filings: { '1.1': 77, '1.2': 'own', '1.3': null } };
    const filings = filingsOf([host], keep, judgement);
    expect(filings.map(({ what, cause }) => [what, cause])).toEqual([
      ['host', 1],
      ['about another bug', 77],
      ['a new bug', 1_001_002],
    ]);
  });

  it('takes local paths and secrets out through the redactor', () => {
    const leaky = issue(1, '2026-01-01T00:00:00Z', 'fails in /home/bob/repo');
    const [filing] = filingsOf([leaky], (text) => text.replace('/home/bob', '~'), NO_JUDGEMENT);
    expect(filing!.what).toBe('fails in ~/repo');
  });
});

describe('leaksIn and firstLeakIn', () => {
  it('names a home path and a token, and passes plain text', () => {
    expect(leaksIn('opened /Users/jo/x')).toBe('a home path');
    expect(leaksIn('key ghp_abcdefghij1234567890')).toBe('a token');
    expect(leaksIn('src/a.ts fails')).toBeNull();
  });

  it('names the filing that holds a leak', () => {
    const clean = { issue: 1, cause: 1, what: 'fine', artifact: null, plan: null };
    const dirty = { issue: 2, comment: 3, cause: 1, what: 'fine', artifact: 'at /home/jo/x', plan: null };
    expect(firstLeakIn([clean])).toBeNull();
    expect(firstLeakIn([clean, dirty])).toBe('issue 2 comment 3 holds a home path');
  });
});
