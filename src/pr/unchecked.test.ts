/**
 * Tests for the unchecked-merge reading (`unchecked.ts`).
 *
 * The rule that matters is the split, so every case that reads one side
 * has a sibling reading the other over the same function: a module that
 * answered `workflows-exist` for everything would pass every case about
 * that side, and one that allowed `--yes` everywhere would pass every
 * case about zero. The unreadable count (null) is driven beside a count
 * of one, because it must read exactly as workflows existing, and beside
 * zero, because falling back to "no workflow" is the quiet failure an
 * outage would otherwise cause.
 *
 * The warnings and the comment's first sentence are asserted as whole
 * literals copied from the spec rather than through the exported
 * constants, so a constant edited away from the spec's spelling reddens
 * a case instead of carrying the tests along with it.
 */
import { describe, expect, test } from 'bun:test';

import {
  readUnchecked,
  skipChecksCommand,
  uncheckedCaseOf,
  uncheckedComment,
  uncheckedQuestion,
  workflowCountLine,
} from './unchecked.js';

const NO_WORKFLOW = 'nothing on GitHub has tested this branch; you are relying on the checks run locally';
const WORKFLOWS_EXIST = 'CI may not have started (a path filter, a draft, Actions disabled, or it has not registered yet); this is probably not what you want';
const SENTENCE = 'Merged with no checks reported, by rafa pr merge --skip-checks.';

describe('uncheckedCaseOf', () => {
  test('a count of zero is the no-workflow case', () => {
    expect(uncheckedCaseOf(0)).toBe('no-workflow');
  });

  test('a count of one or more is the workflows-exist case', () => {
    expect(uncheckedCaseOf(1)).toBe('workflows-exist');
    expect(uncheckedCaseOf(21)).toBe('workflows-exist');
  });

  test('a count that could not be read is the workflows-exist case, not no-workflow', () => {
    expect(uncheckedCaseOf(null)).toBe('workflows-exist');
    expect(uncheckedCaseOf(null)).not.toBe(uncheckedCaseOf(0));
  });
});

describe('workflowCountLine', () => {
  test('names the count read, singular and plural', () => {
    expect(workflowCountLine(0)).toBe('The repository defines 0 workflows.');
    expect(workflowCountLine(1)).toBe('The repository defines 1 workflow.');
    expect(workflowCountLine(21)).toBe('The repository defines 21 workflows.');
  });

  test('says an unreadable count could not be read rather than naming a number', () => {
    expect(workflowCountLine(null)).toBe('The repository\'s workflow count could not be read.');
  });
});

describe('uncheckedQuestion', () => {
  test('names the pull request number', () => {
    expect(uncheckedQuestion(86)).toBe('Merge #86 with no checks? [y/N]');
    expect(uncheckedQuestion(7)).toBe('Merge #7 with no checks? [y/N]');
  });
});

describe('skipChecksCommand', () => {
  test('names the pull request number and the flag', () => {
    expect(skipChecksCommand(86)).toBe('rafa pr merge 86 --skip-checks');
    expect(skipChecksCommand(7)).toBe('rafa pr merge 7 --skip-checks');
  });
});

describe('uncheckedComment', () => {
  test('is the spec sentence followed by the count read, as its own paragraph', () => {
    expect(uncheckedComment(0)).toBe(`${SENTENCE}\n\nThe repository defines 0 workflows.`);
    expect(uncheckedComment(3)).toBe(`${SENTENCE}\n\nThe repository defines 3 workflows.`);
  });

  test('records an unreadable count as unreadable', () => {
    expect(uncheckedComment(null)).toBe(`${SENTENCE}\n\nThe repository's workflow count could not be read.`);
  });
});

describe('readUnchecked', () => {
  test('zero workflows: the no-workflow warning, and --yes may answer', () => {
    const reading = readUnchecked(86, 0);
    expect(reading).toEqual({
      case: 'no-workflow',
      warning: ['The repository defines 0 workflows.', NO_WORKFLOW],
      yesMayAnswer: true,
      question: 'Merge #86 with no checks? [y/N]',
      comment: `${SENTENCE}\n\nThe repository defines 0 workflows.`,
    });
  });

  test('one workflow: the workflows-exist warning, and --yes may not answer', () => {
    const reading = readUnchecked(86, 1);
    expect(reading).toEqual({
      case: 'workflows-exist',
      warning: ['The repository defines 1 workflow.', WORKFLOWS_EXIST],
      yesMayAnswer: false,
      question: 'Merge #86 with no checks? [y/N]',
      comment: `${SENTENCE}\n\nThe repository defines 1 workflow.`,
    });
  });

  test('an unreadable count reads as workflows exist, and --yes may not answer', () => {
    const reading = readUnchecked(12, null);
    expect(reading).toEqual({
      case: 'workflows-exist',
      warning: ['The repository\'s workflow count could not be read.', WORKFLOWS_EXIST],
      yesMayAnswer: false,
      question: 'Merge #12 with no checks? [y/N]',
      comment: `${SENTENCE}\n\nThe repository's workflow count could not be read.`,
    });
  });

  test('each case carries its own warning and never the other one', () => {
    expect(readUnchecked(1, 0).warning).not.toContain(WORKFLOWS_EXIST);
    expect(readUnchecked(1, 5).warning).not.toContain(NO_WORKFLOW);
    expect(readUnchecked(1, null).warning).not.toContain(NO_WORKFLOW);
  });

  test('the reading and its warning lines are frozen', () => {
    const reading = readUnchecked(86, 0);
    expect(Object.isFrozen(reading)).toBe(true);
    expect(Object.isFrozen(reading.warning)).toBe(true);
  });
});
