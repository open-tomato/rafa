import type { HorizonChange, MembershipChange, ReasonAsk } from './epic-trail.js';

import { describe, expect, test } from 'bun:test';

import {
  blankReasonMessage,
  cancelMoveReason,
  codeSpan,
  normaliseReason,
  readReason,
  reasonQuestion,
  renderCancelComment,
  renderCloseComment,
  renderDependentComment,
  renderHorizonComment,
  renderMoveComment,
  unaskedReasonMessage,
} from './epic-trail.js';

const DEFER: HorizonChange = { kind: 'horizon', epic: 40, from: 'now', to: 'later' };
const MOVE: MembershipChange = { kind: 'move', issue: 12, from: 30, to: 40 };

/** An asker answering `answers` in turn and recording every question it was put. */
function scriptedAsk(answers: readonly (string | null)[]): { ask: ReasonAsk; asked: string[] } {
  const asked: string[] = [];
  const ask: ReasonAsk = async (question) => {
    asked.push(question);
    return Promise.resolve(answers[asked.length - 1] ?? null);
  };
  return { ask, asked };
}

describe('normaliseReason', () => {
  test('trims and folds every whitespace run, line breaks included, into one space', () => {
    expect(normaliseReason('  waiting on\r\n#118 \t and  #119\n')).toBe('waiting on #118 and #119');
  });
});

describe('codeSpan', () => {
  test('fences a plain branch name with one backtick', () => {
    expect(codeSpan('rafa-12-login')).toBe('`rafa-12-login`');
  });

  test('fences longer than the longest backtick run inside, padding one that opens with a backtick', () => {
    expect(codeSpan('a``b')).toBe('```a``b```');
    expect(codeSpan('`x')).toBe('`` `x ``');
  });
});

describe('renderHorizonComment', () => {
  test('spells Moved <from> → <to>: <reason>', () => {
    expect(renderHorizonComment(DEFER, 'waiting on #118')).toBe('Moved now → later: waiting on #118');
  });

  test('keeps a multi-line reason on one line', () => {
    expect(renderHorizonComment({ ...DEFER, from: 'later', to: 'next' }, 'customer\nasked')).toBe('Moved later → next: customer asked');
  });
});

describe('renderMoveComment', () => {
  test('spells Moved from epic #A to #B: <reason> alone when there is no open work', () => {
    const expected = 'Moved from epic #30 to #40: belongs with billing';
    expect(renderMoveComment(MOVE, 'belongs with billing')).toBe(expected);
    expect(renderMoveComment(MOVE, 'belongs with billing', { branches: [], pullRequests: [] })).toBe(expected);
  });

  test('names the open branch', () => {
    expect(renderMoveComment(MOVE, 'belongs with billing', { branches: ['rafa-12-login'], pullRequests: [] })).toBe(
      'Moved from epic #30 to #40: belongs with billing\n\nOpen work stays as it is: branch `rafa-12-login`.',
    );
  });

  test('names every branch, then every pull request', () => {
    const comment = renderMoveComment(MOVE, 'x', { branches: ['a', 'b'], pullRequests: [57, 58] });
    expect(comment.split('\n\n')[1]).toBe('Open work stays as it is: branch `a`, branch `b`, pull request #57, pull request #58.');
  });
});

describe('renderCloseComment', () => {
  test('ticks every passed criterion under the gate sentence', () => {
    expect(renderCloseComment({ passed: ['Login works', 'Logout works'], unchecked: [] })).toBe([
      'Closed through the closing gate: every member is closed, and 2 acceptance criteria passed against main.',
      '',
      '- [x] Login works',
      '- [x] Logout works',
    ].join('\n'));
  });

  test('names each criterion closed over with --accept-unchecked, with its reason', () => {
    const comment = renderCloseComment({
      passed: ['Login works'],
      unchecked: [{ criterion: 'Users are happier', reason: 'not observable from the code' }],
    });
    expect(comment).toBe([
      'Closed through the closing gate: every member is closed, and 1 acceptance criterion passed against main.',
      '',
      '- [x] Login works',
      '',
      'Closed over 1 acceptance criterion left unchecked, with --accept-unchecked:',
      '',
      '- [ ] Users are happier — not observable from the code',
    ].join('\n'));
  });

  test('a close with no criterion checked says 0 and lists nothing', () => {
    expect(renderCloseComment({ passed: [], unchecked: [] })).toBe(
      'Closed through the closing gate: every member is closed, and 0 acceptance criteria passed against main.',
    );
  });
});

describe('renderCancelComment', () => {
  test('lists what became of each dependent in order', () => {
    const comment = renderCancelComment('superseded by #60', [
      { issue: 12, answer: { kind: 'moved', to: 40 } },
      { issue: 13, answer: { kind: 'unblocked' } },
      { issue: 14, answer: { kind: 'cancelled' } },
    ]);
    expect(comment).toBe([
      'Cancelled: superseded by #60',
      '',
      'Issues in other epics that waited on its open members:',
      '',
      '- #12 moved to epic #40',
      '- #13 unblocked',
      '- #14 closed as not planned',
    ].join('\n'));
  });

  test('says Cancelled. for a null or blank reason, and that nothing waited', () => {
    const expected = 'Cancelled.\n\nNo issue in another epic waited on its open members.';
    expect(renderCancelComment(null, [])).toBe(expected);
    expect(renderCancelComment('  \n', [])).toBe(expected);
  });
});

describe('dependent comments', () => {
  test('an unblocked dependent names the epic and the one member it waited on', () => {
    expect(renderDependentComment('unblocked', 30, [21])).toBe('Unblocked: epic #30 was cancelled, so #21 no longer blocks this issue.');
  });

  test('an unblocked dependent lists several members', () => {
    expect(renderDependentComment('unblocked', 30, [21, 22, 23])).toBe(
      'Unblocked: epic #30 was cancelled, so #21, #22 and #23 no longer block this issue.',
    );
  });

  test('a cancelled dependent says it closed as not planned', () => {
    expect(renderDependentComment('cancelled', 30, [21, 22])).toBe(
      'Closed as not planned: epic #30 was cancelled, so #21 and #22, which this issue waited on, will not land.',
    );
  });

  test('a moved dependent gets the move comment with the cancel reason', () => {
    expect(renderMoveComment({ kind: 'move', issue: 14, from: 50, to: 40 }, cancelMoveReason(30))).toBe(
      'Moved from epic #50 to #40: epic #30, which it was blocked by, was cancelled',
    );
  });
});

describe('reasonQuestion', () => {
  test('asks about a horizon change and a membership change', () => {
    expect(reasonQuestion(DEFER)).toBe('Why move epic #40 from now to later? ');
    expect(reasonQuestion(MOVE)).toBe('Why move #12 from epic #30 to #40? ');
  });
});

describe('readReason', () => {
  test('takes --reason without asking', async () => {
    const { ask, asked } = scriptedAsk(['never']);
    expect(await readReason(DEFER, ' waiting on #118 ', ask)).toEqual({ status: 'given', reason: 'waiting on #118' });
    expect(asked).toEqual([]);
  });

  test('asks the question once when --reason is absent', async () => {
    const { ask, asked } = scriptedAsk(['customer asked']);
    expect(await readReason(MOVE, null, ask)).toEqual({ status: 'given', reason: 'customer asked' });
    expect(asked).toEqual([reasonQuestion(MOVE)]);
  });

  test('answers unasked with the question when there is no terminal', async () => {
    const reading = await readReason(DEFER, null, null);
    expect(reading).toEqual({ status: 'unasked', question: reasonQuestion(DEFER) });
    expect(unaskedReasonMessage(reasonQuestion(DEFER))).toBe(
      'No terminal to ask on, so nothing changed. It would have asked: Why move epic #40 from now to later?'
      + ' Pass --reason "<why>" to answer it.',
    );
  });

  test('answers blank for a whitespace flag, a whitespace answer and an ended input', async () => {
    expect(await readReason(DEFER, ' \n ', null)).toEqual({ status: 'blank' });
    expect(await readReason(DEFER, null, scriptedAsk(['   ']).ask)).toEqual({ status: 'blank' });
    expect(await readReason(DEFER, null, scriptedAsk([null]).ask)).toEqual({ status: 'blank' });
    expect(blankReasonMessage()).toContain('--reason');
  });
});
