/**
 * Tests for the reading of `RAFA_STRETCH_RULES`
 * (`src/commands/plan/stretch-rules.ts`): an unset or blank value, a
 * value naming a file, a missing file and a directory, and the reader
 * that reads them once.
 *
 * The environment is a record handed in, never `process.env`, and every
 * file is planted under a fresh temporary root per case, so nothing here
 * reads a real stretch folder. Each refusal sits beside a control over
 * the same root that answers rules, so a reader that refused everything
 * would fail the controls.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { CommandExit } from '@open-tomato/rafa/core/command';

import {
  missingRulesMessage,
  notRulesFileMessage,
  readStretchRules,
  STRETCH_RULES_ENV,
  STRETCH_RULES_REFUSAL_EXIT,
  stretchRulesReader,
} from './stretch-rules.js';

/** Where the rules file sits under a project root, as `rafa stretch item` names it. */
const RULES = join('.rafa', 'stretch', '112', 'rules.md');

/** What the planted rules file holds. */
const RULES_TEXT = '- Close-out notes go into the main tracker.\n';

/** The project root of one case; fresh per case. */
let root = '';

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'rafa-stretch-rules-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** Plants the rules file under the root, answering its absolute path. */
function plantRules(text: string = RULES_TEXT): string {
  const file = join(root, RULES);
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(file, text, 'utf8');
  return file;
}

/** The environment holding `value` as the rules value. */
function envOf(value: string): Record<string, string> {
  return { [STRETCH_RULES_ENV]: value };
}

/** What a thrown `CommandExit` carried. */
function refusal(run: () => unknown): CommandExit {
  try {
    run();
  } catch (error) {
    if (error instanceof CommandExit) return error;
    throw error;
  }
  throw new Error('expected a CommandExit, and the call answered instead');
}

describe('readStretchRules with no value', () => {
  it('answers no rules when the value is unset, even with a rules file planted', () => {
    plantRules();

    expect(readStretchRules({}, root)).toBeNull();
  });

  it('answers no rules for a value holding nothing but whitespace', () => {
    expect(readStretchRules(envOf('  '), root)).toBeNull();
  });
});

describe('readStretchRules over a rules file', () => {
  it('reads the file an absolute value names, naming it against the project root', () => {
    const file = plantRules();

    expect(readStretchRules(envOf(file), root)).toEqual({ path: RULES, text: RULES_TEXT });
  });

  it('reads a relative value against the project root', () => {
    plantRules();

    expect(readStretchRules(envOf(RULES), root)).toEqual({ path: RULES, text: RULES_TEXT });
  });

  it('names a file outside the project root by its absolute path', () => {
    const outside = mkdtempSync(join(tmpdir(), 'rafa-stretch-rules-outside-'));
    try {
      const file = join(outside, 'rules.md');
      writeFileSync(file, RULES_TEXT, 'utf8');

      expect(readStretchRules(envOf(file), root)).toEqual({ path: file, text: RULES_TEXT });
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});

describe('readStretchRules refusing a value that names no file', () => {
  it('refuses a value naming a missing file, naming the value', () => {
    const value = join(root, RULES);

    const refused = refusal(() => readStretchRules(envOf(value), root));

    expect(refused.exitCode).toBe(STRETCH_RULES_REFUSAL_EXIT);
    expect(refused.message).toBe(missingRulesMessage(value));
  });

  it('refuses a value naming a directory, the stretch folder itself', () => {
    plantRules();
    const value = join(root, '.rafa', 'stretch', '112');

    const refused = refusal(() => readStretchRules(envOf(value), root));

    expect(refused.exitCode).toBe(STRETCH_RULES_REFUSAL_EXIT);
    expect(refused.message).toBe(notRulesFileMessage(value, 'a directory'));
  });

  it('spells both refusals with the value and what to do', () => {
    expect(missingRulesMessage('/x/rules.md')).toBe(
      'RAFA_STRETCH_RULES=/x/rules.md names no file; a stretch\'s rules are read from its rules.md,'
      + ' so write that file or unset RAFA_STRETCH_RULES',
    );
    expect(notRulesFileMessage('/x', 'a directory')).toBe(
      'RAFA_STRETCH_RULES=/x names a directory, not a file; point it at the stretch\'s rules.md',
    );
  });
});

describe('stretchRulesReader', () => {
  it('reads the file on its first call and answers that reading after it', () => {
    const file = plantRules();
    const read = stretchRulesReader(envOf(file), root);

    const first = read();
    writeFileSync(file, 'rewritten after the first read\n', 'utf8');

    expect(read()).toBe(first);
    expect(first).toEqual({ path: RULES, text: RULES_TEXT });
  });

  it('reads nothing until it is called, so a route that never calls it is never refused', () => {
    const read = stretchRulesReader(envOf(join(root, RULES)), root);
    plantRules();

    expect(read()).toEqual({ path: RULES, text: RULES_TEXT });
  });

  it('throws the same refusal on every call, without reading the file again', () => {
    const value = join(root, RULES);
    const read = stretchRulesReader(envOf(value), root);

    const first = refusal(read);
    plantRules();

    expect(refusal(read)).toBe(first);
    expect(first.message).toBe(missingRulesMessage(value));
  });
});
