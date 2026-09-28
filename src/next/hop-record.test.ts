/**
 * Tests for the hop record (`hop-record.ts`).
 *
 * The file cases write and read `.rafa/hop.json` in a directory of each
 * case's own under one temporary base. Each reading that answers unset
 * sits beside one that answers set, so a reader that always failed would
 * fail a case; the no-temporary-file case lists the directory after a
 * write and also plants a stray `.tmp` to show the listing can see one,
 * and each staleness case that answers false sits beside one that answers
 * true.
 */
import type { HopRecord } from './hop-record.js';
import type { Place, Position } from '../project/position.js';

import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { goHome, hop, positionAt, rehome } from '../project/position.js';

import { HOP_FILE, hopFilePath, readHopRecord, staleAgainst, writeHopRecord } from './hop-record.js';

/** A temporary directory of this file's own. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-hop-record-')));

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

/** Plants `text` as the hop record under `root`. */
function plant(root: string, text: string): void {
  const file = hopFilePath(root);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
}

const HOME: Place = { board: 10, epic: 11 };
const AWAY: Place = { board: 20, epic: 21 };
const ELSEWHERE: Place = { board: 30, epic: null };

const BLOCKER_HOP: HopRecord = {
  kind: 'blocker',
  home: HOME,
  from: HOME,
  blocked: 210,
  target: 118,
  targetEpic: 21,
  targetBoard: 20,
  state: 'away',
  pullRequest: null,
  startedAt: '2026-09-28T10:00:00.000Z',
};

const DRY_HOP: HopRecord = {
  ...BLOCKER_HOP,
  kind: 'dry',
  blocked: null,
  target: null,
  targetEpic: 12,
  targetBoard: 10,
  state: 'waiting',
  pullRequest: 301,
};

/** `BLOCKER_HOP` with `key` replaced by `value`, as JSON text. */
function withKey(key: string, value: unknown): string {
  return JSON.stringify({ ...BLOCKER_HOP, [key]: value });
}

/** `BLOCKER_HOP` without `key`, as JSON text. */
function withoutKey(key: keyof HopRecord): string {
  const copy: Record<string, unknown> = { ...BLOCKER_HOP };
  delete copy[key];
  return JSON.stringify(copy);
}

describe('hopFilePath', () => {
  it('names hop.json under the project .rafa/', () => {
    expect(HOP_FILE).toBe('hop.json');
    expect(hopFilePath('/p')).toBe(join('/p', '.rafa', 'hop.json'));
  });
});

describe('readHopRecord', () => {
  it('reads an absent file as unset, and a written one as set', () => {
    const root = freshRoot();
    const absent = readHopRecord(root);
    expect(absent.set).toBe(false);
    if (absent.set) return;
    expect(absent.reason).toBe('absent');
    expect(absent.detail).toContain(hopFilePath(root));

    writeHopRecord(root, BLOCKER_HOP);
    expect(readHopRecord(root)).toEqual({ set: true, record: BLOCKER_HOP });
  });

  it('reads a dry hop with a pull request as set', () => {
    const root = freshRoot();
    plant(root, JSON.stringify(DRY_HOP));
    expect(readHopRecord(root)).toEqual({ set: true, record: DRY_HOP });
  });

  it.each(['away', 'waiting', 'halted'])('reads the %s state as set', (state) => {
    const root = freshRoot();
    plant(root, withKey('state', state));
    const reading = readHopRecord(root);
    expect(reading.set).toBe(true);
    if (!reading.set) return;
    expect(reading.record.state).toBe(state as HopRecord['state']);
  });

  it('reads invalid JSON as a wrong shape whose detail says it holds no JSON', () => {
    const root = freshRoot();
    plant(root, '{ "kind": ');
    const reading = readHopRecord(root);
    expect(reading.set).toBe(false);
    if (reading.set) return;
    expect(reading.reason).toBe('wrong-shape');
    expect(reading.detail).toContain(hopFilePath(root));
    expect(reading.detail).toContain('holds no JSON');
  });

  it.each([
    ['an array', '[]'],
    ['a number', '3'],
    ['an unknown kind', withKey('kind', 'sideways')],
    ['an unknown state', withKey('state', 'merged')],
    ['no home', withoutKey('home')],
    ['a malformed from', withKey('from', { board: 0, epic: null })],
    ['a string blocked', withKey('blocked', '210')],
    ['a missing target', withoutKey('target')],
    ['a null target epic', withKey('targetEpic', null)],
    ['a fractional target board', withKey('targetBoard', 1.5)],
    ['a zero pull request', withKey('pullRequest', 0)],
    ['a missing pull request', withoutKey('pullRequest')],
    ['a startedAt that is no date', withKey('startedAt', 'yesterday')],
    ['a numeric startedAt', withKey('startedAt', 1_790_000_000_000)],
    ['a blocker hop with no target', withKey('target', null)],
    ['a dry hop with a blocked issue', JSON.stringify({ ...DRY_HOP, blocked: 210 })],
  ])('reads %s as a wrong shape', (_label, text) => {
    const root = freshRoot();
    plant(root, text);
    const reading = readHopRecord(root);
    expect(reading.set).toBe(false);
    if (reading.set) return;
    expect(reading.reason).toBe('wrong-shape');
    expect(reading.detail).toBe(`${hopFilePath(root)} does not hold a hop record`);
  });

  it('reads a file it cannot open as unreadable, not absent', () => {
    if (process.getuid?.() === 0) return;
    const root = freshRoot();
    plant(root, JSON.stringify(BLOCKER_HOP));
    chmodSync(hopFilePath(root), 0o000);
    try {
      const reading = readHopRecord(root);
      expect(reading.set).toBe(false);
      if (reading.set) return;
      expect(reading.reason).toBe('unreadable');
      expect(reading.detail).toContain(hopFilePath(root));
    } finally {
      chmodSync(hopFilePath(root), 0o600);
    }
  });

  it('reads a directory in the file place as unreadable without throwing', () => {
    const root = freshRoot();
    mkdirSync(hopFilePath(root), { recursive: true });
    const reading = readHopRecord(root);
    expect(reading.set).toBe(false);
    if (reading.set) return;
    expect(reading.reason).toBe('unreadable');
  });
});

describe('writeHopRecord', () => {
  it('creates .rafa/ and leaves no temporary file behind', () => {
    const root = freshRoot();
    writeHopRecord(root, BLOCKER_HOP);
    writeHopRecord(root, DRY_HOP);
    const dir = dirname(hopFilePath(root));
    expect(readdirSync(dir)).toEqual([HOP_FILE]);
    expect(readHopRecord(root)).toEqual({ set: true, record: DRY_HOP });

    // Control: the listing sees a stray temporary file when there is one.
    writeFileSync(join(dir, `${HOP_FILE}.1.x.tmp`), '');
    expect(readdirSync(dir).filter((name) => name.endsWith('.tmp'))).toHaveLength(1);
  });

  it('writes the record keys alone, as parsable JSON', () => {
    const root = freshRoot();
    const padded = { ...BLOCKER_HOP, extra: true, home: { ...HOME, stray: 1 } } as HopRecord;
    writeHopRecord(root, padded);
    const written = JSON.parse(readFileSync(hopFilePath(root), 'utf8')) as Record<string, unknown>;
    expect(written).toEqual(BLOCKER_HOP as unknown as Record<string, unknown>);
    expect(Object.keys(written)).toEqual(Object.keys(BLOCKER_HOP));
    expect(Object.keys(written.home as object)).toEqual(['board', 'epic']);
  });

  it('throws and removes its temporary file when the rename fails', () => {
    const root = freshRoot();
    mkdirSync(hopFilePath(root), { recursive: true });
    writeFileSync(join(hopFilePath(root), 'occupied'), '');
    expect(() => {
      writeHopRecord(root, BLOCKER_HOP);
    }).toThrow();
    expect(readdirSync(dirname(hopFilePath(root)))).toEqual([HOP_FILE]);
  });
});

describe('staleAgainst', () => {
  const hopped: Position = hop(positionAt(HOME), AWAY);

  it('answers false while the position keeps the record home, away or back', () => {
    expect(staleAgainst(BLOCKER_HOP, hopped)).toBe(false);
    expect(staleAgainst(BLOCKER_HOP, goHome(hopped))).toBe(false);
  });

  it('answers true once a switch by hand re-homed the position', () => {
    expect(staleAgainst(BLOCKER_HOP, rehome(hopped, ELSEWHERE))).toBe(true);
    expect(staleAgainst(BLOCKER_HOP, rehome(hopped, AWAY))).toBe(true);
  });

  it('compares the epic too: the same board with another epic is stale', () => {
    expect(staleAgainst(BLOCKER_HOP, positionAt({ board: HOME.board, epic: 99 }))).toBe(true);
    expect(staleAgainst(BLOCKER_HOP, positionAt({ board: HOME.board, epic: null }))).toBe(true);
    expect(staleAgainst(BLOCKER_HOP, positionAt({ board: HOME.board, epic: HOME.epic }))).toBe(false);
  });

  it('leaves the record and the position it is given untouched', () => {
    const before = structuredClone({ record: BLOCKER_HOP, position: hopped });
    staleAgainst(BLOCKER_HOP, hopped);
    expect({ record: BLOCKER_HOP, position: hopped }).toEqual(before);
  });
});
