/**
 * Tests for the shared merge-conflict sentence (`conflict-sentence.ts`).
 *
 * What this module is FOR is that its two readers — the wrap-up prompt
 * and the pinned resolve plans — say the same thing, so the cases run
 * over both readers rather than over the constant alone. A case
 * asserting only that the constant holds the expected text would pass
 * on a tree where each reader had quietly kept its own copy, which is
 * the exact failure the extraction exists to prevent.
 *
 * So the drift guard reads the READER SOURCES: the sentence must appear
 * in `conflict-sentence.ts` and nowhere else under `src/`. Its control
 * is the same scan finding the one copy, so a scan that matched nothing
 * anywhere cannot pass it. The scan UNESCAPES each file first: the
 * sentence holds apostrophes, and the lint config's single quotes with
 * no `avoidEscape` mean a copy of it in TypeScript is written
 * `base\'s`, which a raw substring search would miss — that miss is
 * precisely how a second copy would slip past this guard.
 *
 * The other quiet failure is the fill DEFAULT. `pinnedPlanValues` takes
 * an optional override, and a case that passed no override and asserted
 * the shipped text would also pass on a module that inlined a second
 * copy of that text; so the override case drives a sentence that is not
 * the shipped one and asserts it wins, and the default case asserts the
 * filled plan and the constant hold the same string identity-wise.
 *
 * `buildWrapUpPrompt` is called here for its first line as well: that
 * line is the `wrap-up` classifier key (`effort/classify.ts`), and the
 * extraction moved a bullet out of the middle of that list, so the key
 * is asserted unchanged with the sentence asserted absent from it.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, test } from 'bun:test';

import { PROMPT_SHAPES } from '../effort/classify.js';
import { buildWrapUpPrompt } from '../start/wrap-up.js';

import { MECHANICAL_CONFLICT_SENTENCE, mechanicalConflictBullet } from './conflict-sentence.js';
import { loadPinnedPlan, pinnedPlanValues } from './plans/load.js';

/** A triage block with every field null, as an unrecorded assessment reads. */
const EMPTY_BLOCK = Object.freeze({
  head: null,
  at: null,
  class: null,
  simple: null,
  attempts: null,
  files: null,
});

/** `src/`, which the drift guard walks. */
const SRC_DIR = join(import.meta.dir, '..');

/** Where the one copy of the sentence is allowed to be. */
const SOURCE_FILE = join(import.meta.dir, 'conflict-sentence.ts');

/** A file's text with its escaped apostrophes read back; see the note. */
function unescaped(path: string): string {
  return readFileSync(path, 'utf8').replaceAll('\\\'', '\'');
}

/** Every file under `src/`, this test file excluded. */
function sourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...sourceFiles(path));
      continue;
    }
    if (path !== import.meta.path) found.push(path);
  }
  return found;
}

describe('the sentence itself', () => {
  test('carries no list marker, so a plan can use it as prose', () => {
    expect(MECHANICAL_CONFLICT_SENTENCE.startsWith('* ')).toBe(false);
    expect(MECHANICAL_CONFLICT_SENTENCE.startsWith('-')).toBe(false);
  });

  test('names both branches of the decision it is there to make', () => {
    expect(MECHANICAL_CONFLICT_SENTENCE).toContain('MECHANICAL');
    expect(MECHANICAL_CONFLICT_SENTENCE).toContain('lockfiles');
    expect(MECHANICAL_CONFLICT_SENTENCE).toContain('keep BOTH');
    expect(MECHANICAL_CONFLICT_SENTENCE).toContain('semantic conflict');
  });

  test('the bullet is the sentence with exactly one marker added', () => {
    expect(mechanicalConflictBullet()).toBe(`* ${MECHANICAL_CONFLICT_SENTENCE}`);
    expect(mechanicalConflictBullet().slice(2)).toBe(MECHANICAL_CONFLICT_SENTENCE);
  });
});

describe('the wrap-up prompt as a reader', () => {
  const prompt = buildWrapUpPrompt('feat/20-pr-commands', '# Plan: p', null);

  test('carries the shared bullet verbatim', () => {
    expect(prompt).toContain(mechanicalConflictBullet());
  });

  test('still opens with the wrap-up classifier key', () => {
    const shape = PROMPT_SHAPES.find((candidate) => candidate.kind === 'wrap-up');
    const firstLine = prompt.split('\n')[0] ?? '';

    expect(shape?.prefix).toBeTruthy();
    expect(firstLine).toBe(shape?.prefix);
    expect(firstLine).not.toContain('MECHANICAL');
  });
});

describe('the pinned plans as readers', () => {
  test('a fill with no override carries the shipped sentence', () => {
    const values = pinnedPlanValues({ block: EMPTY_BLOCK });

    expect(values.CONFLICT_SENTENCE).toBe(MECHANICAL_CONFLICT_SENTENCE);
    expect(loadPinnedPlan('conflict-lockfile', { block: EMPTY_BLOCK }))
      .toContain(MECHANICAL_CONFLICT_SENTENCE);
  });

  test('an override wins, which is the control on that default', () => {
    const override = 'Stop for every conflict, whatever it is.';
    const filled = loadPinnedPlan('conflict-manifest', {
      block: EMPTY_BLOCK,
      conflictSentence: override,
    });

    expect(filled).toContain(override);
    expect(filled).not.toContain(MECHANICAL_CONFLICT_SENTENCE);
  });
});

describe('the drift guard over src/', () => {
  const holders = sourceFiles(SRC_DIR)
    .filter((path) => unescaped(path).includes(MECHANICAL_CONFLICT_SENTENCE));

  test('exactly one file under src/ holds the sentence', () => {
    expect(holders).toEqual([SOURCE_FILE]);
  });

  test('that file is found by the same scan, which is the control', () => {
    expect(holders).toHaveLength(1);
    expect(unescaped(SOURCE_FILE)).toContain(MECHANICAL_CONFLICT_SENTENCE);
  });
});
