/**
 * Tests for the current place resolver (`place.ts`).
 *
 * Every case plants its position file in a project root of its own under
 * one temporary base, with `writePositionFile` or raw text, and hands the
 * resolver a literal listing built by {@link issue}, which reads each
 * row's type with the tracker's own `typeOfLabels`, as `parseBoardListing`
 * does. The default board is a counting stand-in, so a case can say how
 * often it was asked. No `gh` is spawned.
 *
 * ## The controls
 *
 * Each lost reading sits beside the same place standing, so a resolver
 * that always fell back, or never did, fails one of the two: a closed
 * board beside it open, an unlabelled board beside the unlabelled default
 * board, a closed epic beside an open epic that is done. The fallback's
 * epic is read off a checklist whose earlier lines name a `next` epic, a
 * done one and a closed one, so a pick of the first line fails.
 */
import type { PlaceLoss, PlaceOptions } from './place.js';
import type { BoardIssue } from './roadmap-board.js';
import type { Place, Position } from '../project/position.js';

import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { typeOfLabels } from '../adapters/tracker/github.js';
import { positionAt, positionFilePath, writePositionFile } from '../project/position.js';

import { fallbackPhrase, resolvePlace, samePlace } from './place.js';

/** A temporary directory of this file's own. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-place-')));

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

/** A root holding `position`. */
function rootAt(position: Position): string {
  const root = freshRoot();
  writePositionFile(root, position);
  return root;
}

/** The fields a case may set on an issue. */
interface IssueFields {
  readonly labels?: readonly string[];
  readonly state?: 'OPEN' | 'CLOSED';
  readonly body?: string;
}

/** One listing row, its type read from its labels. */
function issue(number: number, fields: IssueFields = {}): BoardIssue {
  const labels = fields.labels ?? [];
  return {
    number,
    title: `issue ${String(number)}`,
    body: fields.body ?? '',
    state: fields.state ?? 'OPEN',
    stateReason: null,
    labels,
    type: typeOfLabels(labels),
    module: 'unassigned',
  };
}

/** A board's labels. */
const BOARD = ['type:roadmap'];

/** An epic's labels. */
function epicLabels(slug: string, horizon = 'now'): readonly string[] {
  return ['type:epic', `epic:${slug}`, `horizon:${horizon}`];
}

/** A checklist naming `issues`, unticked. */
function checklist(...issues: readonly number[]): string {
  return issues.map((number) => `- [ ] #${String(number)}`).join('\n');
}

/**
 * The default board #31 lists, in order: #60 a next epic, #70 a now epic
 * whose one member is closed (done), #90 a closed now epic, and #50 an
 * open now epic with an open member, the fallback's pick. #40 is a second
 * labelled board, #41 a closed one, #42 an open issue with no label, #33
 * a labelled board whose checklist names no now epic.
 */
function listing(overrides: readonly BoardIssue[] = []): readonly BoardIssue[] {
  const rows = [
    issue(31, { labels: BOARD, body: checklist(60, 70, 90, 50) }),
    issue(33, { labels: BOARD, body: checklist(60) }),
    issue(40, { labels: BOARD, body: checklist(80) }),
    issue(41, { labels: BOARD, state: 'CLOSED' }),
    issue(42, { body: checklist(80) }),
    issue(50, { labels: epicLabels('alpha') }),
    issue(51, { labels: ['epic:alpha'] }),
    issue(60, { labels: epicLabels('beta', 'next') }),
    issue(61, { labels: ['epic:beta'] }),
    issue(70, { labels: epicLabels('gamma') }),
    issue(71, { labels: ['epic:gamma'], state: 'CLOSED' }),
    issue(80, { labels: epicLabels('delta') }),
    issue(81, { labels: ['epic:delta'] }),
    issue(90, { labels: epicLabels('eps'), state: 'CLOSED' }),
    issue(91, { labels: ['type:bug'] }),
  ];
  const replaced = new Map(overrides.map((row) => [row.number, row]));
  return rows.map((row) => replaced.get(row.number) ?? row);
}

/** A default board stand-in answering `board`, counting each ask. */
function defaultAt(board = 31): { readonly seam: PlaceOptions['defaultBoard']; readonly asked: () => number } {
  let asked = 0;
  return {
    seam: () => {
      asked += 1;
      return Promise.resolve(board);
    },
    asked: () => asked,
  };
}

const FALLBACK = { board: 31, epic: 50 };

describe('samePlace', () => {
  it('compares the board and the epic', () => {
    expect(samePlace({ board: 1, epic: 2 }, { board: 1, epic: 2 })).toBe(true);
    expect(samePlace({ board: 1, epic: 2 }, { board: 1, epic: null })).toBe(false);
    expect(samePlace({ board: 1, epic: null }, { board: 3, epic: null })).toBe(false);
  });
});

describe('resolvePlace with the file unset', () => {
  it('reads an absent file as the default board\'s first now epic not done, naming the file', async () => {
    const root = freshRoot();
    const place = await resolvePlace({ root, listing: listing(), defaultBoard: defaultAt().seam });
    expect(place.current).toEqual(FALLBACK);
    expect(place.home).toEqual(FALLBACK);
    expect(place.position).toBeNull();
    expect(place.fallback).toEqual({ place: FALLBACK, boardListed: true });
    expect(place.notices).toEqual([{
      kind: 'unset',
      reason: 'absent',
      message: `No position file at ${positionFilePath(root)}; the current place is the default board #31 at epic #50`,
    }]);
  });

  it('reads a file it cannot read as unset, naming the file and the failure', async () => {
    const root = freshRoot();
    mkdirSync(positionFilePath(root), { recursive: true });
    const place = await resolvePlace({ root, listing: listing(), defaultBoard: defaultAt().seam });
    expect(place.current).toEqual(FALLBACK);
    expect(place.notices).toHaveLength(1);
    const [notice] = place.notices;
    expect(notice?.kind).toBe('unset');
    if (notice?.kind !== 'unset') return;
    expect(notice.reason).toBe('unreadable');
    expect(notice.message).toStartWith(`Cannot read ${positionFilePath(root)}: `);
    expect(notice.message).toEndWith('; the current place is the default board #31 at epic #50');
  });

  it.each([
    ['invalid-json', '{ not json'],
    ['wrong-shape', JSON.stringify({ current: { board: 40, epic: null } })],
  ])('reads a file holding %s as unset with that reason', async (reason, text) => {
    const root = freshRoot();
    const file = positionFilePath(root);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, text);
    const place = await resolvePlace({ root, listing: listing(), defaultBoard: defaultAt().seam });
    expect(place.current).toEqual(FALLBACK);
    expect(place.notices.map((notice) => notice.kind === 'unset' && notice.reason)).toEqual([reason]);
    expect(place.notices[0]?.message).toContain(file);
  });

  it('propagates a default board that cannot be found', async () => {
    const refusal = new Error('no issue titled Roadmap');
    const run = resolvePlace({ root: freshRoot(), listing: listing(), defaultBoard: () => Promise.reject(refusal) });
    await expect(run).rejects.toBe(refusal);
  });
});

describe('resolvePlace with places that stand', () => {
  it('answers the file\'s current and home without asking for the default board', async () => {
    const position: Position = { current: { board: 40, epic: 80 }, previous: null, home: { board: 31, epic: 50 } };
    const stand = defaultAt();
    const place = await resolvePlace({ root: rootAt(position), listing: listing(), defaultBoard: stand.seam });
    expect(place).toEqual({ current: position.current, home: position.home, position, fallback: null, notices: [] });
    expect(stand.asked()).toBe(0);
  });

  it('keeps a board with no epic, and an open epic that is done', async () => {
    const board = await resolvePlace({ root: rootAt(positionAt({ board: 40, epic: null })), listing: listing(), defaultBoard: defaultAt().seam });
    expect(board.current).toEqual({ board: 40, epic: null });
    const done = await resolvePlace({ root: rootAt(positionAt({ board: 31, epic: 70 })), listing: listing(), defaultBoard: defaultAt().seam });
    expect(done.current).toEqual({ board: 31, epic: 70 });
    expect(done.notices).toEqual([]);
  });

  it('keeps the default board when it carries no label, as the title rule finds it', async () => {
    const stand = defaultAt(42);
    const place = await resolvePlace({ root: rootAt(positionAt({ board: 42, epic: 80 })), listing: listing(), defaultBoard: stand.seam });
    expect(place.current).toEqual({ board: 42, epic: 80 });
    expect(place.notices).toEqual([]);
    expect(stand.asked()).toBe(1);
  });

  it('keeps a configured default board the listing does not hold', async () => {
    const place = await resolvePlace({ root: rootAt(positionAt({ board: 500, epic: null })), listing: listing(), defaultBoard: defaultAt(500).seam });
    expect(place.current).toEqual({ board: 500, epic: null });
    expect(place.notices).toEqual([]);
  });
});

describe('resolvePlace with a lost place', () => {
  it.each<[string, Place, PlaceLoss, string]>([
    ['a closed board', { board: 41, epic: 80 }, { what: 'board', number: 41, why: 'closed' }, 'board #41, which is closed'],
    ['an unlabelled board', { board: 42, epic: 80 }, { what: 'board', number: 42, why: 'unlabelled' }, 'board #42, which does not carry type:roadmap'],
    ['a board not on the listing', { board: 999, epic: null }, { what: 'board', number: 999, why: 'missing' }, 'board #999, which is not on the board listing'],
    ['a closed epic', { board: 40, epic: 90 }, { what: 'epic', number: 90, why: 'closed' }, 'epic #90, which is closed'],
    ['an epic that is no epic', { board: 40, epic: 91 }, { what: 'epic', number: 91, why: 'unlabelled' }, 'epic #91, which does not carry type:epic'],
    ['an epic not on the listing', { board: 40, epic: 998 }, { what: 'epic', number: 998, why: 'missing' }, 'epic #998, which is not on the board listing'],
  ])('falls back from %s to the default board, naming what was lost', async (_label, lost, loss, named) => {
    const root = rootAt(positionAt(lost));
    const before = readFileSync(positionFilePath(root), 'utf8');
    const place = await resolvePlace({ root, listing: listing(), defaultBoard: defaultAt().seam });
    expect(place.current).toEqual(FALLBACK);
    expect(place.home).toEqual(FALLBACK);
    expect(place.notices).toEqual([{
      kind: 'lost',
      slots: ['current', 'home'],
      place: lost,
      losses: [loss],
      message: `The current place and home lost ${named}; falling back to the default board #31 at epic #50`,
    }]);
    expect(readFileSync(positionFilePath(root), 'utf8')).toBe(before);
  });

  it('names both the board and the epic when both were lost', async () => {
    const place = await resolvePlace({ root: rootAt(positionAt({ board: 41, epic: 90 })), listing: listing(), defaultBoard: defaultAt().seam });
    expect(place.notices.map((notice) => notice.kind === 'lost' && notice.losses)).toEqual([[
      { what: 'board', number: 41, why: 'closed' },
      { what: 'epic', number: 90, why: 'closed' },
    ]]);
    expect(place.notices[0]?.message).toBe('The current place and home lost board #41, which is closed, and epic #90, which is closed;'
      + ' falling back to the default board #31 at epic #50');
  });

  it('falls back from a lost current place and keeps a home that stands', async () => {
    const position: Position = { current: { board: 41, epic: 80 }, previous: { board: 40, epic: 80 }, home: { board: 40, epic: 80 } };
    const place = await resolvePlace({ root: rootAt(position), listing: listing(), defaultBoard: defaultAt().seam });
    expect(place.current).toEqual(FALLBACK);
    expect(place.home).toEqual({ board: 40, epic: 80 });
    expect(place.position).toEqual(position);
    expect(place.notices.map((notice) => notice.kind === 'lost' && notice.slots)).toEqual([['current']]);
    expect(place.notices[0]?.message).toStartWith('The current place lost board #41');
  });

  it('falls back from a lost home and keeps a current place that stands', async () => {
    const position: Position = { current: { board: 40, epic: 80 }, previous: null, home: { board: 40, epic: 90 } };
    const place = await resolvePlace({ root: rootAt(position), listing: listing(), defaultBoard: defaultAt().seam });
    expect(place.current).toEqual({ board: 40, epic: 80 });
    expect(place.home).toEqual(FALLBACK);
    expect(place.notices.map((notice) => notice.message)).toEqual([
      'Home lost epic #90, which is closed; falling back to the default board #31 at epic #50',
    ]);
  });

  it('writes one notice per lost place and asks for the default board once', async () => {
    const position: Position = { current: { board: 41, epic: null }, previous: null, home: { board: 42, epic: null } };
    const stand = defaultAt();
    const place = await resolvePlace({ root: rootAt(position), listing: listing(), defaultBoard: stand.seam });
    expect(place.current).toEqual(FALLBACK);
    expect(place.home).toEqual(FALLBACK);
    expect(place.notices.map((notice) => notice.kind === 'lost' && notice.slots)).toEqual([['current'], ['home']]);
    expect(stand.asked()).toBe(1);
  });
});

describe('the fallback place', () => {
  it('answers no epic when the default board names no now epic that is not done', async () => {
    const place = await resolvePlace({ root: freshRoot(), listing: listing(), defaultBoard: defaultAt(33).seam });
    expect(place.current).toEqual({ board: 33, epic: null });
    expect(place.notices[0]?.message).toEndWith('the default board #33, with no epic: it names no now epic that is not done');
  });

  it('answers no epic, saying why, when the listing does not hold the default board', async () => {
    const place = await resolvePlace({ root: freshRoot(), listing: listing(), defaultBoard: defaultAt(500).seam });
    expect(place.current).toEqual({ board: 500, epic: null });
    expect(place.fallback?.boardListed).toBe(false);
    expect(place.notices[0]?.message).toEndWith('the default board #500, with no epic: the board listing does not hold #500, so its checklist was not read');
  });

  it('answers no epic once every now epic the checklist names is closed or done', async () => {
    const closed = listing([issue(50, { labels: epicLabels('alpha'), state: 'CLOSED' })]);
    const place = await resolvePlace({ root: freshRoot(), listing: closed, defaultBoard: defaultAt().seam });
    expect(place.current).toEqual({ board: 31, epic: null });
  });

  it('names a listed default board and its epic', () => {
    expect(fallbackPhrase({ place: { board: 31, epic: 50 }, boardListed: true })).toBe('the default board #31 at epic #50');
  });
});
