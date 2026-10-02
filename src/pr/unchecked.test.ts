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
 * The third case, `no-pull-request-workflow`, relaxes the rule on what
 * the base's workflow files said, so each case reading it sits beside
 * the same count with the files naming the base, and beside an
 * unreadable count with the files naming nothing: both must stay
 * `workflows-exist`, or an outage or a file this reader got wrong would
 * let `--yes` through.
 *
 * The warnings and the comment's first sentence are asserted as whole
 * literals copied from the spec rather than through the exported
 * constants, so a constant edited away from the spec's spelling reddens
 * a case instead of carrying the tests along with it.
 */
import { describe, expect, test } from 'bun:test';

import {
  noPullRequestWorkflowLine,
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

/** The base files of a pull request into `stretch/1` that no workflow tests. */
const UNTESTED = { base: 'stretch/1', runsOnPullRequests: false } as const;

/** The base files of a pull request into `main`, which a workflow tests. */
const TESTED = { base: 'main', runsOnPullRequests: true } as const;

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

  test('one or more workflows with base files naming no pull request into the base is no-pull-request-workflow', () => {
    expect(uncheckedCaseOf(1, UNTESTED)).toBe('no-pull-request-workflow');
    expect(uncheckedCaseOf(4, UNTESTED)).toBe('no-pull-request-workflow');
  });

  test('base files naming the base, or none read, leave one or more workflows as workflows-exist', () => {
    expect(uncheckedCaseOf(1, TESTED)).toBe('workflows-exist');
    expect(uncheckedCaseOf(1, null)).toBe('workflows-exist');
  });

  test('an unreadable count stays workflows-exist whatever the base files said', () => {
    expect(uncheckedCaseOf(null, UNTESTED)).toBe('workflows-exist');
  });

  test('a count of zero is no-workflow whatever the base files said', () => {
    expect(uncheckedCaseOf(0, TESTED)).toBe('no-workflow');
  });
});

describe('noPullRequestWorkflowLine', () => {
  test('names the base', () => {
    expect(noPullRequestWorkflowLine('stretch/1')).toBe('no workflow runs on pull requests into stretch/1');
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

  test('carries a base line as its own paragraph after the count', () => {
    expect(uncheckedComment(1, 'no workflow runs on pull requests into stretch/1')).toBe(
      `${SENTENCE}\n\nThe repository defines 1 workflow.\n\nno workflow runs on pull requests into stretch/1`,
    );
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

  test('one workflow none of whose triggers names the base: the base line, and --yes may answer', () => {
    const reading = readUnchecked(86, 1, UNTESTED);
    expect(reading).toEqual({
      case: 'no-pull-request-workflow',
      warning: ['The repository defines 1 workflow.', 'no workflow runs on pull requests into stretch/1'],
      yesMayAnswer: true,
      question: 'Merge #86 with no checks? [y/N]',
      comment: `${SENTENCE}\n\nThe repository defines 1 workflow.\n\nno workflow runs on pull requests into stretch/1`,
    });
  });

  test('the same workflow naming the base: the workflows-exist reading, the control on the case above', () => {
    const reading = readUnchecked(86, 1, TESTED);
    expect(reading.case).toBe('workflows-exist');
    expect(reading.yesMayAnswer).toBe(false);
    expect(reading.warning).toEqual(['The repository defines 1 workflow.', WORKFLOWS_EXIST]);
    expect(reading.comment).toBe(`${SENTENCE}\n\nThe repository defines 1 workflow.`);
  });

  test('an unreadable count with base files naming nothing still refuses --yes', () => {
    const reading = readUnchecked(86, null, UNTESTED);
    expect(reading.case).toBe('workflows-exist');
    expect(reading.yesMayAnswer).toBe(false);
    expect(reading.comment).not.toContain('no workflow runs on pull requests');
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
