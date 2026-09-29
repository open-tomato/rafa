/**
 * Tests for the position file (`position.ts`).
 *
 * The file cases write and read `.rafa/position.json` in a directory of
 * each case's own under one temporary base. Each reading that answers
 * unset sits beside one that answers set, so a reader that always failed
 * would fail a case; the no-temporary-file case lists the directory after
 * a write and also plants a stray `.tmp` to show the listing can see one.
 */
import type { Place, Position } from './position.js';

import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import {
  goHome,
  hop,
  POSITION_FILE,
  positionAt,
  positionFilePath,
  readPositionFile,
  rehome,
  swap,
  writePositionFile,
} from './position.js';

/** A temporary directory of this file's own. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-position-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

let caseCount = 0;

/** A fresh project root for one case. */
function freshRoot(): string {
  caseCount += 1;
  const root = join(tempBase, `case-${String(caseCount)}`);
  mkdirSync(root, { recursive: true });
  return root;
}

/** Plants `text` as the position file under `root`. */
function plant(root: string, text: string): void {
  const file = positionFilePath(root);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
}

const BOARD_A: Place = { board: 10, epic: 11 };
const BOARD_B: Place = { board: 20, epic: 21 };
const BOARD_C: Place = { board: 30, epic: null };

const POSITION: Position = { current: BOARD_B, previous: BOARD_A, home: BOARD_A };

describe('positionFilePath', () => {
  it('names position.json under the project .rafa/', () => {
    expect(POSITION_FILE).toBe('position.json');
    expect(positionFilePath('/p')).toBe(join('/p', '.rafa', 'position.json'));
  });
});

describe('readPositionFile', () => {
  it('reads an absent file as unset, and a written one as set', () => {
    const root = freshRoot();
    const absent = readPositionFile(root);
    expect(absent.set).toBe(false);
    if (absent.set) return;
    expect(absent.reason).toBe('absent');
    expect(absent.detail).toContain(positionFilePath(root));

    writePositionFile(root, POSITION);
    expect(readPositionFile(root)).toEqual({ set: true, position: POSITION });
  });

  it('reads invalid JSON as unset with its reason', () => {
    const root = freshRoot();
    plant(root, '{ "current": ');
    const reading = readPositionFile(root);
    expect(reading.set).toBe(false);
    if (reading.set) return;
    expect(reading.reason).toBe('invalid-json');
    expect(reading.detail).toContain(positionFilePath(root));
  });

  it.each([
    ['an array', '[]'],
    ['a number', '3'],
    ['no home', JSON.stringify({ current: BOARD_A, previous: null })],
    ['a string board', JSON.stringify({ current: { board: '10', epic: 11 }, previous: null, home: BOARD_A })],
    ['a zero epic', JSON.stringify({ current: { board: 10, epic: 0 }, previous: null, home: BOARD_A })],
    ['a fractional board', JSON.stringify({ current: BOARD_A, previous: null, home: { board: 1.5, epic: null } })],
    ['a missing epic', JSON.stringify({ current: { board: 10 }, previous: null, home: BOARD_A })],
    ['a missing previous', JSON.stringify({ current: BOARD_A, home: BOARD_A })],
    ['a malformed previous', JSON.stringify({ current: BOARD_A, previous: { board: -1, epic: null }, home: BOARD_A })],
  ])('reads %s as a wrong shape', (_label, text) => {
    const root = freshRoot();
    plant(root, text);
    const reading = readPositionFile(root);
    expect(reading.set).toBe(false);
    if (reading.set) return;
    expect(reading.reason).toBe('wrong-shape');
  });

  it('reads a well-shaped file with a null previous and a null epic as set', () => {
    const root = freshRoot();
    const position = positionAt(BOARD_C);
    plant(root, JSON.stringify(position));
    expect(readPositionFile(root)).toEqual({ set: true, position });
  });

  it('reads a file it cannot open as unreadable, not absent', () => {
    if (process.getuid?.() === 0) return;
    const root = freshRoot();
    plant(root, JSON.stringify(POSITION));
    chmodSync(positionFilePath(root), 0o000);
    try {
      const reading = readPositionFile(root);
      expect(reading.set).toBe(false);
      if (reading.set) return;
      expect(reading.reason).toBe('unreadable');
    } finally {
      chmodSync(positionFilePath(root), 0o600);
    }
  });
});

describe('writePositionFile', () => {
  it('creates .rafa/ and leaves no temporary file behind', () => {
    const root = freshRoot();
    writePositionFile(root, POSITION);
    writePositionFile(root, rehome(POSITION, BOARD_C));
    const dir = dirname(positionFilePath(root));
    expect(readdirSync(dir)).toEqual([POSITION_FILE]);

    // Control: the listing sees a stray temporary file when there is one.
    writeFileSync(join(dir, `${POSITION_FILE}.1.x.tmp`), '');
    expect(readdirSync(dir).filter((name) => name.endsWith('.tmp'))).toHaveLength(1);
  });

  it('writes the three places alone, as parsable JSON', () => {
    const root = freshRoot();
    writePositionFile(root, { ...POSITION, extra: true } as Position);
    expect(JSON.parse(readFileSync(positionFilePath(root), 'utf8'))).toEqual(POSITION);
  });

  it('throws and removes its temporary file when the rename fails', () => {
    const root = freshRoot();
    mkdirSync(positionFilePath(root), { recursive: true });
    writeFileSync(join(positionFilePath(root), 'occupied'), '');
    expect(() => {
      writePositionFile(root, POSITION);
    }).toThrow();
    expect(readdirSync(dirname(positionFilePath(root)))).toEqual([POSITION_FILE]);
  });
});

describe('transitions', () => {
  it('positionAt starts at one place, current and home', () => {
    expect(positionAt(BOARD_A)).toEqual({ current: BOARD_A, previous: null, home: BOARD_A });
  });

  it('rehome makes the place current and home, the old current previous', () => {
    expect(rehome(POSITION, BOARD_C)).toEqual({ current: BOARD_C, previous: BOARD_B, home: BOARD_C });
  });

  it('hop makes the place current and keeps home', () => {
    expect(hop(POSITION, BOARD_C)).toEqual({ current: BOARD_C, previous: BOARD_B, home: BOARD_A });
  });

  it('swap trades current and previous and keeps home', () => {
    const hopped = hop(POSITION, BOARD_C);
    expect(swap(hopped)).toEqual({ current: BOARD_B, previous: BOARD_C, home: BOARD_A });
    expect(swap(swap(hopped) as Position)).toEqual(hopped);
  });

  it('swap answers null with no previous place', () => {
    expect(swap(positionAt(BOARD_A))).toBeNull();
  });

  it('goHome stands at home and remembers the place left as previous', () => {
    const hopped = hop(POSITION, BOARD_C);
    expect(goHome(hopped)).toEqual({ current: BOARD_A, previous: BOARD_C, home: BOARD_A });
    expect(swap(goHome(hopped))).toEqual({ current: BOARD_C, previous: BOARD_A, home: BOARD_A });
  });

  it('goHome at home keeps home current and previous', () => {
    expect(goHome(positionAt(BOARD_A))).toEqual({ current: BOARD_A, previous: BOARD_A, home: BOARD_A });
  });

  it('leaves the position it is given untouched', () => {
    const before = structuredClone(POSITION);
    rehome(POSITION, BOARD_C);
    hop(POSITION, BOARD_C);
    swap(POSITION);
    goHome(POSITION);
    expect(POSITION).toEqual(before);
  });
});
