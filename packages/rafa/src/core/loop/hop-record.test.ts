/**
 * Tests for the hop record's shapes (`hop-record.ts`): `isRecord`,
 * `asPlace` and `asHopRecord`, called on parsed values directly.
 *
 * The place cases came from `packages/rafa/src/project/position.test.ts` and the hop
 * record cases from `packages/rafa/src/next/hop-record.test.ts`, where they read a
 * planted file; the file readers keep the cases that show a null answer
 * here reads as a wrong shape there. Each case that answers null sits
 * beside one that answers the value, so a check that always refused
 * would fail a case.
 */
import type { HopRecord, Place } from './hop-record.js';

import { describe, expect, it } from 'bun:test';

import { asHopRecord, asPlace, isRecord } from './hop-record.js';

const HOME: Place = { board: 10, epic: 11 };

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

/** `BLOCKER_HOP` with `key` replaced by `value`, as parsed JSON. */
function withKey(key: string, value: unknown): unknown {
  return JSON.parse(JSON.stringify({ ...BLOCKER_HOP, [key]: value }));
}

/** `BLOCKER_HOP` without `key`, as parsed JSON. */
function withoutKey(key: keyof HopRecord): unknown {
  const copy: Record<string, unknown> = { ...BLOCKER_HOP };
  delete copy[key];
  return JSON.parse(JSON.stringify(copy));
}

describe('isRecord', () => {
  it('answers true for a plain object, empty or not', () => {
    expect(isRecord({})).toBe(true);
    expect(isRecord({ board: 1 })).toBe(true);
  });

  it.each([
    ['null', null],
    ['an array', []],
    ['a number', 3],
    ['a string', 'board'],
    ['undefined', undefined],
  ])('answers false for %s', (_label, value) => {
    expect(isRecord(value)).toBe(false);
  });
});

describe('asPlace', () => {
  it('reads a board with an epic, and one with a null epic', () => {
    expect(asPlace({ board: 10, epic: 11 })).toEqual({ board: 10, epic: 11 });
    expect(asPlace({ board: 30, epic: null })).toEqual({ board: 30, epic: null });
  });

  it('answers the board and epic alone', () => {
    expect(asPlace({ board: 10, epic: 11, stray: 1 })).toEqual({ board: 10, epic: 11 });
  });

  it.each([
    ['an array', []],
    ['null', null],
    ['a string board', { board: '10', epic: 11 }],
    ['a zero epic', { board: 10, epic: 0 }],
    ['a fractional board', { board: 1.5, epic: null }],
    ['a negative board', { board: -1, epic: null }],
    ['a missing epic', { board: 10 }],
  ])('answers null for %s', (_label, value) => {
    expect(asPlace(value)).toBeNull();
  });
});

describe('asHopRecord', () => {
  it('reads a blocker hop and a dry hop with a pull request', () => {
    expect(asHopRecord(JSON.parse(JSON.stringify(BLOCKER_HOP)))).toEqual(BLOCKER_HOP);
    expect(asHopRecord(JSON.parse(JSON.stringify(DRY_HOP)))).toEqual(DRY_HOP);
  });

  it.each(['away', 'waiting', 'merged', 'halted'])('reads the %s state', (state) => {
    expect(asHopRecord(withKey('state', state))?.state).toBe(state as HopRecord['state']);
  });

  it.each([
    ['an array', []],
    ['a number', 3],
    ['an unknown kind', withKey('kind', 'sideways')],
    ['an unknown state', withKey('state', 'closed')],
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
    ['a dry hop with a blocked issue', { ...DRY_HOP, blocked: 210 }],
  ])('answers null for %s', (_label, value) => {
    expect(asHopRecord(value)).toBeNull();
  });
});
