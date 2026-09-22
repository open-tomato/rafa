/**
 * Tests for where a rebuilt saved copy goes (`src/board/previous-copy.ts`):
 * the `previous/` path, the mtime timestamp, the suffix a taken name
 * gets, the move, and the count `rafa doctor` reads.
 *
 * Every file this file writes sits under a temporary directory made in
 * `tmpdir` and removed afterwards, and `specs.dir` is a RELATIVE setting
 * as a project configures it, so a resolution that reached the real
 * `.rafa/specs` would find nothing there and redden.
 *
 * ## What passes while wrong
 *
 * A move that renamed over a taken name satisfies every case that only
 * looks for the new file, so the never-overwrite case plants a file
 * under the name the move would pick, with text of its own, and asserts
 * that text is still there beside the suffixed copy. Mtimes are set with
 * `utimesSync` rather than left to the clock, so two copies read the same
 * second on purpose and the timestamp asserted is the file's, not the
 * run's. The count is asserted over a directory holding things it must
 * NOT count — a `.txt` file and a `.md` in a subdirectory — beside the
 * ones it must.
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import {
  countPreviousCopies,
  movePreviousCopy,
  PREVIOUS_COPY_WARN_ABOVE,
  PREVIOUS_DIR_NAME,
  previousCopyName,
  previousDir,
  previousTimestamp,
} from './previous-copy.js';

const SPECS_DIR = join('.rafa', 'specs');
const SAVED = join(SPECS_DIR, 'rafa-20-pr-commands.md');
const MTIME = new Date('2026-09-22T10:15:00.750Z');
const STAMP = '20260922T101500Z';

let root = '';

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'rafa-previous-copy-'));
  mkdirSync(join(root, SPECS_DIR), { recursive: true });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** Writes the saved copy with `text` and sets its mtime to `mtime`. */
function writeSaved(text: string, mtime: Date = MTIME): void {
  writeFileSync(join(root, SAVED), text);
  utimesSync(join(root, SAVED), mtime, mtime);
}

describe('previousDir', () => {
  it('names previous/ under specs.dir as configured', () => {
    expect(PREVIOUS_DIR_NAME).toBe('previous');
    expect(previousDir(SPECS_DIR)).toBe(join('.rafa', 'specs', 'previous'));
  });
});

describe('previousTimestamp', () => {
  it('answers the time in UTC to the second, dropping milliseconds', () => {
    expect(previousTimestamp(MTIME)).toBe(STAMP);
  });

  it('pads every field to its width', () => {
    expect(previousTimestamp(new Date('2027-01-02T03:04:05.000Z'))).toBe('20270102T030405Z');
  });

  it('reads the UTC day, not the local one, across midnight', () => {
    expect(previousTimestamp(new Date('2026-12-31T23:59:59.999Z'))).toBe('20261231T235959Z');
  });
});

describe('previousCopyName', () => {
  it('puts the timestamp before .md on the first attempt', () => {
    expect(previousCopyName('rafa-20-pr-commands.md', STAMP, 1)).toBe(`rafa-20-pr-commands.${STAMP}.md`);
  });

  it('suffixes -2, -3 before .md from the second attempt on', () => {
    expect(previousCopyName('rafa-20-pr-commands.md', STAMP, 2)).toBe(`rafa-20-pr-commands.${STAMP}-2.md`);
    expect(previousCopyName('rafa-20-pr-commands.md', STAMP, 3)).toBe(`rafa-20-pr-commands.${STAMP}-3.md`);
  });
});

describe('movePreviousCopy', () => {
  it('moves the saved copy under previous/ named by its mtime', () => {
    writeSaved('old body\n');

    const moved = movePreviousCopy({ repoRoot: root, specsDir: SPECS_DIR, path: SAVED });

    expect(moved.path).toBe(join(SPECS_DIR, 'previous', `rafa-20-pr-commands.${STAMP}.md`));
    expect(moved.absolute).toBe(join(root, moved.path));
    expect(readFileSync(moved.absolute, 'utf8')).toBe('old body\n');
    expect(existsSync(join(root, SAVED))).toBe(false);
  });

  it('never overwrites a copy already under the name, suffixing -2 instead', () => {
    const taken = join(root, SPECS_DIR, 'previous', `rafa-20-pr-commands.${STAMP}.md`);
    mkdirSync(join(root, SPECS_DIR, 'previous'));
    writeFileSync(taken, 'kept text\n');
    writeSaved('newer text\n');

    const moved = movePreviousCopy({ repoRoot: root, specsDir: SPECS_DIR, path: SAVED });

    expect(moved.path).toBe(join(SPECS_DIR, 'previous', `rafa-20-pr-commands.${STAMP}-2.md`));
    expect(readFileSync(taken, 'utf8')).toBe('kept text\n');
    expect(readFileSync(moved.absolute, 'utf8')).toBe('newer text\n');
  });

  it('keeps three copies with one mtime under three names', () => {
    const texts = ['first\n', 'second\n', 'third\n'];

    const paths = texts.map((text) => {
      writeSaved(text);
      return movePreviousCopy({ repoRoot: root, specsDir: SPECS_DIR, path: SAVED }).absolute;
    });

    expect(paths.map((path) => readFileSync(path, 'utf8'))).toEqual(texts);
    expect(readdirSync(join(root, SPECS_DIR, 'previous')).sort((a, b) => a.localeCompare(b))).toEqual([
      `rafa-20-pr-commands.${STAMP}-2.md`,
      `rafa-20-pr-commands.${STAMP}-3.md`,
      `rafa-20-pr-commands.${STAMP}.md`,
    ]);
  });

  it('refuses a saved copy that is not there, naming it, and makes no previous copy', () => {
    const move = (): unknown => movePreviousCopy({ repoRoot: root, specsDir: SPECS_DIR, path: SAVED });

    expect(move).toThrow(`board previous copy: ${SAVED} could not be moved to ${join(SPECS_DIR, 'previous')}`);
    expect(countPreviousCopies(root, SPECS_DIR)).toBe(0);
  });
});

describe('countPreviousCopies', () => {
  it('counts zero when previous/ is missing', () => {
    expect(countPreviousCopies(root, SPECS_DIR)).toBe(0);
  });

  it('counts only the .md files directly under previous/', () => {
    const directory = join(root, SPECS_DIR, 'previous');
    mkdirSync(join(directory, 'nested'), { recursive: true });
    writeFileSync(join(directory, `rafa-20-pr-commands.${STAMP}.md`), 'a\n');
    writeFileSync(join(directory, `rafa-21-other.${STAMP}.md`), 'b\n');
    writeFileSync(join(directory, 'stray.txt'), 'c\n');
    writeFileSync(join(directory, 'nested', 'deeper.md'), 'd\n');

    expect(countPreviousCopies(root, SPECS_DIR)).toBe(2);
  });

  it('counts the copies the move leaves', () => {
    writeSaved('one\n');
    movePreviousCopy({ repoRoot: root, specsDir: SPECS_DIR, path: SAVED });
    writeSaved('two\n', new Date('2026-09-23T00:00:00.000Z'));
    movePreviousCopy({ repoRoot: root, specsDir: SPECS_DIR, path: SAVED });

    expect(countPreviousCopies(root, SPECS_DIR)).toBe(2);
  });

  it('throws naming previous/ when it is a file and not a directory', () => {
    writeFileSync(join(root, SPECS_DIR, 'previous'), 'not a directory\n');

    expect(() => countPreviousCopies(root, SPECS_DIR)).toThrow(`board previous copy: ${join(SPECS_DIR, 'previous')} could not be read`);
  });
});

describe('PREVIOUS_COPY_WARN_ABOVE', () => {
  it('is fifty', () => {
    expect(PREVIOUS_COPY_WARN_ABOVE).toBe(50);
  });
});
