/**
 * Tests for the previous-copy reading (`doctor-previous.ts`): the count
 * of `.md` files in `previous/` under the configured `specs.dir`, and the
 * warning answered only above fifty.
 *
 * Every case writes in its own temporary project root. The fifty case is
 * the control for the fifty-one case: a reading that always warned would
 * fail there, one that never warned fails at fifty-one.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { PREVIOUS_COPY_WARN_ABOVE } from '../board/previous-copy.js';

import { previousCopiesWarning, readPreviousCopies } from './doctor-previous.js';

const SPECS_DIR = '.rafa/specs';

let root = '';

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'rafa-doctor-previous-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** Writes `count` previous copies under `specsDir`'s `previous/`. */
function plantCopies(specsDir: string, count: number): void {
  const directory = join(root, specsDir, 'previous');
  mkdirSync(directory, { recursive: true });
  for (let index = 0; index < count; index += 1) {
    writeFileSync(join(directory, `rafa-${index}-spec.20260922T101500Z.md`), 'old\n');
  }
}

describe('readPreviousCopies', () => {
  it('counts a missing previous/ as zero with no warning', () => {
    expect(readPreviousCopies(root, { specsDir: SPECS_DIR })).toEqual({ count: 0, warning: null });
  });

  it('answers no warning at fifty copies', () => {
    plantCopies(SPECS_DIR, PREVIOUS_COPY_WARN_ABOVE);
    expect(readPreviousCopies(root, { specsDir: SPECS_DIR })).toEqual({ count: 50, warning: null });
  });

  it('answers the warning at fifty-one copies', () => {
    plantCopies(SPECS_DIR, PREVIOUS_COPY_WARN_ABOVE + 1);
    expect(readPreviousCopies(root, { specsDir: SPECS_DIR })).toEqual({
      count: 51,
      warning: 'rafa doctor: .rafa/specs/previous/ holds 51 previous copies of issue specs; they are safe to delete',
    });
  });

  it('reads under the configured specs.dir, not the default', () => {
    plantCopies('docs/specs', 51);
    expect(readPreviousCopies(root, { specsDir: SPECS_DIR }).count).toBe(0);
    expect(readPreviousCopies(root, { specsDir: 'docs/specs' }).warning)
      .toBe(previousCopiesWarning('docs/specs', 51));
  });

  it('counts only .md files directly in previous/', () => {
    plantCopies(SPECS_DIR, 2);
    const directory = join(root, SPECS_DIR, 'previous');
    writeFileSync(join(directory, 'note.txt'), 'x\n');
    mkdirSync(join(directory, 'nested.md'));
    expect(readPreviousCopies(root, { specsDir: SPECS_DIR }).count).toBe(2);
  });
});
