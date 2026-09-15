/**
 * Tests for the `PATH` check (`bin-path.ts`): the three states, the first
 * entry of each directory deciding, entries that match neither directory,
 * spellings of one directory compared as one, and the warning each state
 * prints.
 *
 * Every home is a directory under this file's own temporary root, created
 * only by the cases that need the real-path comparison. The rest name
 * directories that do not exist, which the module compares as `resolve`
 * spells them. No case reads the real home or the `PATH` this suite runs
 * under: each hands the check a `PATH` value of its own.
 *
 * The linked-home case has a control: with the same link and the same
 * `PATH`, the directories absent, the spellings differ and the check
 * answers `missing`. So the match it finds with the directories present
 * is the real-path comparison, and not two spellings that were equal.
 */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, relative, resolve } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { binPathWarning, BUN_BIN_DIR, RAFA_BIN_DIR, readBinPath } from './bin-path.js';

/** A temporary directory of this file's own, its real path. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-bin-path-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** A home that does not exist, under the temporary root. */
const HOME = join(tempBase, 'absent-home');

/** `~/.rafa/bin` under {@link HOME}. */
const RAFA_BIN = join(HOME, '.rafa', 'bin');

/** `~/.bun/bin` under {@link HOME}. */
const BUN_BIN = join(HOME, '.bun', 'bin');

/** A PATH of `entries`. */
function pathOf(...entries: string[]): string {
  return entries.join(delimiter);
}

describe('the directories', () => {
  it('names .rafa/bin and .bun/bin under the home', () => {
    const reading = readBinPath(undefined, HOME);

    expect([RAFA_BIN_DIR, BUN_BIN_DIR]).toEqual([join('.rafa', 'bin'), join('.bun', 'bin')]);
    expect([reading.rafaBin, reading.bunBin]).toEqual([RAFA_BIN, BUN_BIN]);
    expect(reading.rafaBin.startsWith(`${tempBase}/`)).toBe(true);
  });
});

describe('the three states', () => {
  it('answers ahead with no warning when .rafa/bin comes before .bun/bin', () => {
    const reading = readBinPath(pathOf('/usr/bin', RAFA_BIN, BUN_BIN), HOME);

    expect([reading.rafaIndex, reading.bunIndex, reading.state, reading.warning]).toEqual([1, 2, 'ahead', null]);
  });

  it('answers ahead when .rafa/bin is on PATH and .bun/bin is not', () => {
    const reading = readBinPath(pathOf(RAFA_BIN, '/usr/bin'), HOME);

    expect([reading.rafaIndex, reading.bunIndex, reading.state, reading.warning]).toEqual([0, null, 'ahead', null]);
  });

  it('answers behind, warning, when .bun/bin comes first', () => {
    const reading = readBinPath(pathOf(BUN_BIN, '/usr/bin', RAFA_BIN), HOME);

    expect([reading.rafaIndex, reading.bunIndex, reading.state]).toEqual([2, 0, 'behind']);
    expect(reading.warning).toBe(
      `${RAFA_BIN} is on PATH after ${BUN_BIN}, so a rafa in ${BUN_BIN} runs first; put it ahead:`
      + ` export PATH="${RAFA_BIN}:$PATH"`,
    );
  });

  it('answers missing, warning, when .rafa/bin is not on PATH beside .bun/bin', () => {
    const reading = readBinPath(pathOf('/usr/bin', BUN_BIN), HOME);

    expect([reading.rafaIndex, reading.bunIndex, reading.state]).toEqual([null, 1, 'missing']);
    expect(reading.warning).toBe(
      `${RAFA_BIN} is not on PATH; put it ahead of ${BUN_BIN}, so a rafa there runs before one`
      + ` in ${BUN_BIN}: export PATH="${RAFA_BIN}:$PATH"`,
    );
  });

  it('answers missing for a PATH naming neither, an empty PATH and no PATH at all', () => {
    const states = [pathOf('/usr/bin', '/bin'), '', undefined].map((value) => readBinPath(value, HOME).state);

    expect(states).toEqual(['missing', 'missing', 'missing']);
  });

  it('answers the same warning through binPathWarning for each state', () => {
    expect(binPathWarning('ahead', RAFA_BIN, BUN_BIN)).toBeNull();
    expect(binPathWarning('missing', RAFA_BIN, BUN_BIN)).toBe(readBinPath(pathOf(BUN_BIN), HOME).warning);
    expect(binPathWarning('behind', RAFA_BIN, BUN_BIN)).toBe(readBinPath(pathOf(BUN_BIN, RAFA_BIN), HOME).warning);
  });
});

describe('which entry decides', () => {
  it('reads the first entry of each directory, a later repeat changing nothing', () => {
    expect(readBinPath(pathOf(BUN_BIN, RAFA_BIN, BUN_BIN), HOME).state).toBe('behind');
    expect(readBinPath(pathOf(RAFA_BIN, BUN_BIN, RAFA_BIN), HOME).state).toBe('ahead');
  });

  it('counts empty entries in an index, so the index names the entry as PATH spells it', () => {
    const reading = readBinPath(`${delimiter}${RAFA_BIN}${delimiter}${delimiter}${BUN_BIN}`, HOME);

    expect([reading.rafaIndex, reading.bunIndex]).toEqual([1, 3]);
  });

  it('matches no relative entry and no entry spelled with a tilde', () => {
    const relative = readBinPath(pathOf('.rafa/bin', '~/.rafa/bin', BUN_BIN), HOME);

    expect([relative.rafaIndex, relative.state]).toEqual([null, 'missing']);
  });

  it('matches no relative entry even when it names the directory from the working directory', () => {
    const fromCwd = relative(process.cwd(), RAFA_BIN);

    const reading = readBinPath(pathOf(fromCwd, BUN_BIN), HOME);

    expect(resolve(fromCwd)).toBe(RAFA_BIN);
    expect([reading.rafaIndex, reading.state]).toEqual([null, 'missing']);
  });
});

describe('spellings of one directory', () => {
  it('matches an entry with a trailing slash or a dot-dot segment, compared as resolved', () => {
    const trailing = readBinPath(pathOf(`${RAFA_BIN}/`, BUN_BIN), HOME);
    const dotted = readBinPath(pathOf(join(HOME, '.bun', 'bin', '..', '..', '.rafa', 'bin'), BUN_BIN), HOME);

    expect([trailing.rafaIndex, trailing.state]).toEqual([0, 'ahead']);
    expect([dotted.rafaIndex, dotted.state]).toEqual([0, 'ahead']);
  });

  it('matches an entry spelled through the real home when the home is given through a link, and not before the directories exist', () => {
    const base = mkdtempSync(join(tempBase, 'linked-'));
    const realHome = join(base, 'real-home');
    const linkHome = join(base, 'link-home');
    mkdirSync(realHome);
    symlinkSync(realHome, linkHome);
    const value = pathOf(join(realHome, '.rafa', 'bin'), join(realHome, '.bun', 'bin'));

    const before = readBinPath(value, linkHome);
    mkdirSync(join(realHome, '.rafa', 'bin'), { recursive: true });
    mkdirSync(join(realHome, '.bun', 'bin'), { recursive: true });
    const after = readBinPath(value, linkHome);

    expect([before.rafaIndex, before.bunIndex, before.state]).toEqual([null, null, 'missing']);
    expect([after.rafaIndex, after.bunIndex, after.state]).toEqual([0, 1, 'ahead']);
    expect(after.rafaBin).toBe(join(linkHome, '.rafa', 'bin'));
  });

  it('reads real paths through the filesystem it is handed', () => {
    const aliased = '/elsewhere/rafa-bin';
    const fs = {
      realpath: (path: string) => {
        if (path === aliased || path === RAFA_BIN) return join(tempBase, 'one-directory');
        throw new Error(`ENOENT: ${path}`);
      },
    };

    expect(readBinPath(pathOf(aliased), HOME, fs).state).toBe('ahead');
    expect(readBinPath(pathOf(aliased), HOME).state).toBe('missing');
  });
});
