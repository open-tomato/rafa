/**
 * Tests for gate 3 of `rafa issue edit` (`src/board/issue-edit-text.ts`):
 * the leak refusal over the added text, and the completeness refusal
 * over the new body of a `type:spec` issue that was complete before.
 *
 * Every refusal case sits beside a control that differs only in the
 * part the rule reads, so a gate refusing everything and a gate
 * refusing nothing both fail here: the clean added text passes, the
 * same broken body passes without the label, and passes again when the
 * body before the edit was already incomplete.
 */
import { describe, expect, test } from 'bun:test';

import { CommandExit } from '../cli/command.js';

import { appendedBody, renderUpdateBlock } from './issue-edit-body.js';
import {
  addedTextSource,
  completenessApplies,
  editedBodySource,
  requireEditText,
} from './issue-edit-text.js';
import { SPEC_LABEL } from './issue.js';
import { LEAK_REFUSAL_EXIT } from './leak.js';
import { READINESS_REFUSAL_EXIT, SPEC_READY_LABEL } from './readiness.js';

const ISSUE = 12;
const DAY = new Date(2026, 9, 6, 12, 0);

/** A complete spec body, one section per template heading. */
const COMPLETE = [
  '## What you get\n\nAn edit command.\n',
  '## Starting position\n\nNo way to change a body.\n',
  '## Design\n\nFour gates in order.\n',
  '## What can go wrong\n\nA leak reaches the board.\n',
  '## Tasks the plan must carry\n\n- add the gate\n',
  '## Definition of done\n\n- a leak is refused\n',
].join('\n');

/** The complete body with its Design section emptied, so it fails the template. */
const INCOMPLETE = COMPLETE.replace('Four gates in order.\n', '');

const CLEAN_TEXT = 'One workflow moves or seeds an environment.';
const HOME_PATH_TEXT = 'The copy sits under /Users/jdoe/projects/app/.rafa/specs.';
const LAN_HOST_TEXT = 'Run it on buildbox.lan, from /home/jdoe/src/app.';

/** The input for an append of `added` onto `before`. */
function appendOf(before: string, added: string, labels: readonly string[] = [SPEC_LABEL]) {
  return {
    issue: ISSUE,
    labels,
    before,
    added,
    after: appendedBody(before, renderUpdateBlock(DAY, 'sync design', added)),
  };
}

/** What `run` threw, failing the test when it threw nothing. */
function thrownBy(run: () => void): CommandExit {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(CommandExit);
    return error as CommandExit;
  }
  throw new Error('expected a refusal, and the gate passed');
}

describe('the added text', () => {
  test('lets clean text through', () => {
    expect(requireEditText(appendOf(COMPLETE, CLEAN_TEXT))).toBeUndefined();
  });

  test('refuses text holding a home path, exit 2, naming the added text and its line', () => {
    const refusal = thrownBy(() => requireEditText(appendOf(COMPLETE, `Intro.\n${HOME_PATH_TEXT}`)));

    expect(refusal.exitCode).toBe(LEAK_REFUSAL_EXIT);
    expect(LEAK_REFUSAL_EXIT).toBe(2);
    expect(refusal.message).toStartWith(`${addedTextSource(ISSUE)} names a machine path`);
    expect(refusal.message).toContain('line 2 holds a home path (/Users/[redacted])');
    expect(refusal.message).not.toContain('jdoe');
  });

  test('refuses text naming a LAN hostname beside a home path', () => {
    const refusal = thrownBy(() => requireEditText(appendOf(COMPLETE, LAN_HOST_TEXT, [])));

    expect(refusal.exitCode).toBe(2);
    expect(refusal.message).toContain('line 1 holds a home path (/home/[redacted])');
  });

  test('reads the added text only, not the body already on the board', () => {
    const before = `${COMPLETE}\n${HOME_PATH_TEXT}\n`;

    expect(requireEditText(appendOf(before, CLEAN_TEXT))).toBeUndefined();
  });

  test('refuses a leak before the template, when the edit does both', () => {
    const input = { ...appendOf(COMPLETE, HOME_PATH_TEXT), after: INCOMPLETE };

    expect(thrownBy(() => requireEditText(input)).message).toStartWith(addedTextSource(ISSUE));
  });
});

describe('the whole new body of a ready spec', () => {
  test('refuses a complete type:spec body the edit leaves failing its template, exit 2', () => {
    const input = { ...appendOf(COMPLETE, CLEAN_TEXT), after: INCOMPLETE };
    const refusal = thrownBy(() => requireEditText(input));

    expect(refusal.exitCode).toBe(READINESS_REFUSAL_EXIT);
    expect(READINESS_REFUSAL_EXIT).toBe(2);
    expect(refusal.message).toStartWith(`${editedBodySource(ISSUE)} is not ready to plan from`);
    expect(refusal.message).toContain('"Design"');
  });

  test('passes the same broken body on an issue without the spec label', () => {
    const input = { ...appendOf(COMPLETE, CLEAN_TEXT, [SPEC_READY_LABEL]), after: INCOMPLETE };

    expect(requireEditText(input)).toBeUndefined();
  });

  test('passes the same broken body when the body before the edit was already incomplete', () => {
    const input = { ...appendOf(INCOMPLETE, CLEAN_TEXT), after: INCOMPLETE };

    expect(requireEditText(input)).toBeUndefined();
  });

  test('passes an append that keeps a complete spec complete', () => {
    const input = appendOf(COMPLETE, CLEAN_TEXT);

    expect(input.after).toStartWith(COMPLETE);
    expect(requireEditText(input)).toBeUndefined();
  });
});

describe('completenessApplies', () => {
  test('holds for a labelled spec whose body has no gap, whatever the label\'s case', () => {
    expect(completenessApplies([SPEC_LABEL], COMPLETE)).toBe(true);
    expect(completenessApplies([' Type:Spec '], COMPLETE)).toBe(true);
  });

  test('does not hold without the label, or over a body with a gap', () => {
    expect(completenessApplies([SPEC_READY_LABEL], COMPLETE)).toBe(false);
    expect(completenessApplies([SPEC_LABEL], INCOMPLETE)).toBe(false);
  });
});
