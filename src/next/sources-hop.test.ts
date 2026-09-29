/**
 * Tests for the hop readings of `rafa next --roadmap`'s board
 * (`./sources.ts`, `NextBoardOptions.roadmap`): the hop record followed
 * or dropped, the away target answered in place of the epic's first
 * line, the lines passed as waiting, the one-hop decision and the next
 * `now` epic. Kept apart from `./sources.test.ts`, which is past the
 * 800-line cap.
 *
 * The board: board #10 lists epic #20 (`home`) then epic #25 (`next`);
 * board #11 lists epic #40 (`far`). Epic #20's checklist is #100 then
 * #101, epic #25's is #150, epic #40's is #119 then #118. H is #100,
 * `spec:blocked` by C, #118. `roadmap.issue` names board #10.
 *
 * ## The controls
 *
 * Each reading is read beside a board that differs from it in the one
 * thing the reading is about:
 *
 *  - the keys: the same board built without `roadmap`, and with it
 *    `false`, answers the four keys and sends the same `gh` commands as
 *    before, while the board built with it answers a fifth, `hop`;
 *  - the waiting line: #100 is passed only when C's pull request is
 *    open, and the same board without `roadmap` stops at #100 as ever;
 *  - the away target: epic #40's first line is #119, so a walk that
 *    walked the epic would answer #119 and not C; a branch claiming C
 *    while away is the hop's own and does not take it, beside the same
 *    branch at home, which does;
 *  - the stale record: the same record beside a position whose home is
 *    the record's is followed;
 *  - the one-hop rule: a blocked line read away on a dry hop halts,
 *    beside the same line read at home, which hops.
 *
 * ## What passes while wrong
 *
 * Eight mutations of `./sources.ts` were driven on 2026-09-28 over this
 * file alone, one at a time, the module restored from a scratch copy and
 * its `shasum` checked after each, against 24 pass and 0 fail:
 *
 *  - `roadmap: false` read as on: 23 pass and 1 fail, the keys case.
 *  - the waiting pick replaced by the plain one: 17 pass and 7 fail, the
 *    waiting, dry and waiting-record cases.
 *  - the away target never answered: 19 pass and 5 fail, the away cases.
 *  - C's own branch read as taking it in the away decision: 23 pass and
 *    1 fail, the away halt, which is why that case plants the branch.
 *  - staleness ignored: 23 pass and 1 fail, the re-homed position.
 *  - a record in any state walked as away: 23 pass and 1 fail, the
 *    waiting record.
 *  - the next `now` epic never read: 22 pass and 2 fail, the two dry
 *    cases that expect a reading of it.
 *  - home always read as the place H was read at: 23 pass and 1 fail,
 *    the second move on a dry hop.
 */
import type { NextRoadmapReading } from './readings.js';
import type { GhResult, GhRunner } from '../adapters/tracker/github.js';
import type { GitRunner } from '../pr/index.js';
import type { Place, Position } from '../project/position.js';

import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { writePositionFile } from '../project/position.js';

import { hopFilePath, writeHopRecord } from './hop-record.js';
import { ghNextBoard } from './sources.js';

/** A temporary directory of this file's own. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-next-hop-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** The board `roadmap.issue` names. */
const HOME_BOARD = 10;

/** How the recorded calls name the board listing. */
const LISTING_CALL = 'issue list --state all';

/** How the recorded calls name the open pull request list. */
const PR_LIST_CALL = 'pr list';

/** One row as the listing and `gh issue view` answer it. */
interface Row {
  readonly number: number;
  readonly body?: string;
  readonly state?: 'OPEN' | 'CLOSED';
  readonly labels?: readonly string[];
}

/** An open pull request as `gh pr list` answers it. */
interface Pull {
  readonly number: number;
  readonly closes: number;
}

/** What one board is read over. */
interface Fixture {
  readonly rows: readonly Row[];
  readonly pulls?: readonly Pull[];
  readonly branches?: readonly string[];
  /** Rows `gh issue view` answers that the listing leaves out, as it leaves out an issue past its limit. */
  readonly unlisted?: readonly number[];
}

/** An answer `gh` wrote. */
function wrote(stdout: string): Promise<GhResult> {
  return Promise.resolve({ ok: true, stdout, stderr: '' });
}

/** A row as `gh` writes it, labels as objects. */
function ghRow(row: Row): Record<string, unknown> {
  return {
    number: row.number,
    title: `Issue ${String(row.number)}`,
    body: row.body ?? '',
    state: row.state ?? 'OPEN',
    stateReason: row.state === 'CLOSED'
      ? 'COMPLETED'
      : '',
    labels: (row.labels ?? []).map((name) => ({ name })),
    author: { login: 'maintainer' },
  };
}

/** A `gh` answering `fixture`, recording each call. */
function fakeGh(fixture: Fixture): { readonly gh: GhRunner; readonly calls: string[] } {
  const calls: string[] = [];
  const gh: GhRunner = (args) => {
    const route = args.slice(0, 2).join(' ');
    const listing = route === 'issue list' && args.includes('--state') && args.includes('all');
    calls.push(listing
      ? LISTING_CALL
      : args.slice(0, 3).join(' '));
    if (listing) {
      const listed = fixture.rows.filter((row) => !(fixture.unlisted ?? []).includes(row.number));
      return wrote(JSON.stringify(listed.map(ghRow)));
    }
    if (route === 'issue list') return wrote('[]');
    if (route === 'pr list') {
      return wrote(JSON.stringify((fixture.pulls ?? []).map((pull) => ({
        number: pull.number,
        headRefName: `pull-${String(pull.number)}`,
        body: `Closes #${String(pull.closes)}`,
      }))));
    }
    if (route === 'issue view') {
      const number = Number(args[2]);
      return wrote(JSON.stringify(ghRow(fixture.rows.find((row) => row.number === number) ?? { number })));
    }
    return Promise.resolve({ ok: false, stdout: '', stderr: `unexpected ${args.join(' ')}` });
  };
  return { gh, calls };
}

/** A git whose local branches are `branches`. */
function fakeGit(branches: readonly string[]): GitRunner {
  return (args) => ({
    ok: true,
    stdout: args[0] === 'for-each-ref'
      ? branches.map((branch) => `refs/heads/${branch}`).join('\n')
      : '',
    stderr: '',
  });
}

/** A board issue whose checklist names `items`, unticked. */
function checklist(items: readonly number[]): string {
  return items.map((item) => `- [ ] #${String(item)}`).join('\n');
}

/** H blocked by C, and every other row, with `overrides` replacing rows by number. */
function rowsWith(...overrides: readonly Row[]): readonly Row[] {
  const rows: readonly Row[] = [
    { number: 10, body: checklist([20, 25]), labels: ['type:roadmap'] },
    { number: 11, body: checklist([40]), labels: ['type:roadmap'] },
    { number: 20, body: checklist([100, 101]), labels: ['type:epic', 'epic:home', 'horizon:now'] },
    { number: 25, body: checklist([150]), labels: ['type:epic', 'epic:next', 'horizon:now'] },
    { number: 40, body: checklist([119, 118]), labels: ['type:epic', 'epic:far', 'horizon:now'] },
    { number: 100, body: 'Blocked by: #118\n', labels: ['epic:home', 'spec:blocked', 'spec:ready'] },
    { number: 101, labels: ['epic:home', 'spec:ready'] },
    { number: 150, labels: ['epic:next', 'spec:ready'] },
    { number: 118, labels: ['epic:far', 'spec:ready'] },
    { number: 119, labels: ['epic:far', 'spec:ready'] },
    { number: 90, labels: ['epic:far'] },
  ];
  return rows.map((row) => overrides.find((each) => each.number === row.number) ?? row);
}

/** How many project roots this file has planted. */
let planted = 0;

/** A project root of its own, holding `position` and `record` when handed. */
function plantRoot(position: Position | null, record: Parameters<typeof writeHopRecord>[1] | null): string {
  planted += 1;
  const root = join(tempBase, `project-${String(planted)}`);
  mkdirSync(join(root, '.rafa'), { recursive: true });
  if (position !== null) writePositionFile(root, position);
  if (record !== null) writeHopRecord(root, record);
  return root;
}

/** One answer over `fixture`, from `root` when handed, with `roadmap` as given. */
async function read(
  fixture: Fixture,
  roadmap: boolean | undefined,
  root?: string,
): Promise<{ readonly reading: NextRoadmapReading; readonly calls: readonly string[] }> {
  const { gh, calls } = fakeGh(fixture);
  const git = fakeGit(fixture.branches ?? []);
  const reading = await ghNextBoard({ gh, git, configured: HOME_BOARD, root, roadmap }).next();
  return { reading, calls };
}

/** The hop reading of an answer; fails the case when the key is missing. */
function hopOf(reading: NextRoadmapReading): NonNullable<NextRoadmapReading['hop']> {
  if (reading.hop === undefined) throw new Error('the answer carries no hop reading');
  return reading.hop;
}

const HOME: Place = { board: 10, epic: 20 };
const FAR: Place = { board: 11, epic: 40 };

/** The position a hop to C leaves: at C's epic, home kept. */
const AWAY: Position = { current: FAR, previous: HOME, home: HOME };

/** The record a hop to C writes. */
const AWAY_RECORD = {
  kind: 'blocker',
  home: HOME,
  from: HOME,
  blocked: 100,
  target: 118,
  targetEpic: 40,
  targetBoard: 11,
  state: 'away',
  pullRequest: null,
  startedAt: '2026-09-28T10:00:00.000Z',
} as const;

describe('the board without roadmap', () => {
  it('answers the four keys and sends the commands it always did', async () => {
    const fixture = { rows: rowsWith() };
    const without = await read(fixture, undefined);
    const off = await read(fixture, false);

    expect(Object.keys(without.reading).sort()).toEqual(['line', 'passed', 'problems', 'roadmap']);
    expect(Object.keys(off.reading).sort()).toEqual(['line', 'passed', 'problems', 'roadmap']);
    expect(off.calls).toEqual(without.calls);
    expect(without.reading.line?.issue).toBe(100);
  });

  it('answers a fifth key, hop, with it (control)', async () => {
    const { reading } = await read({ rows: rowsWith() }, true);

    expect(Object.keys(reading).sort()).toEqual(['hop', 'line', 'passed', 'problems', 'roadmap']);
  });

  it('stops at H with C\'s pull request open, passing nothing as waiting', async () => {
    const { reading } = await read({ rows: rowsWith(), pulls: [{ number: 300, closes: 118 }] }, undefined);

    expect(reading.line?.issue).toBe(100);
    expect(reading.passed).toBe(0);
  });

  it('leaves the hop record unread and the key out with a record planted', async () => {
    const root = plantRoot(AWAY, AWAY_RECORD);
    const { reading } = await read({ rows: rowsWith() }, undefined, root);

    expect(reading.line?.issue).toBe(119);
    expect(Object.keys(reading)).not.toContain('hop');
  });
});

describe('the one-hop decision for the line the walk answers', () => {
  it('hops to C\'s epic on the other board for H read at home', async () => {
    const { reading } = await read({ rows: rowsWith() }, true);
    const hop = hopOf(reading);

    expect(reading.line?.issue).toBe(100);
    expect(hop.decision).toEqual({
      kind: 'hop', blocked: 100, blocker: 118, epic: 40, slug: 'far', board: 11, from: HOME, to: FAR,
    });
    expect(hop).toMatchObject({ record: null, stale: null, position: null, target: null, waiting: [], nextEpic: null });
  });

  it('halts with the chain where C is blocked by B', async () => {
    const blockedC = { number: 118, body: 'Blocked by: #90\n', labels: ['epic:far', 'spec:blocked'] };
    const { reading } = await read({ rows: rowsWith(blockedC) }, true);

    expect(hopOf(reading).decision).toMatchObject({
      kind: 'halt', reason: 'blocked-blocker', chain: { blocked: 100, blocker: 118, next: [90], mutual: false },
    });
  });

  it('answers no decision for a line that is not blocked', async () => {
    const free = { number: 100, labels: ['epic:home', 'spec:ready'] };
    const { reading } = await read({ rows: rowsWith(free) }, true);

    expect(reading.line?.issue).toBe(100);
    expect(hopOf(reading).decision).toBeNull();
  });
});

describe('a line whose every open blocker is taken', () => {
  it('is passed and named as waiting when C\'s pull request is open', async () => {
    const { reading } = await read({ rows: rowsWith(), pulls: [{ number: 300, closes: 118 }] }, true);
    const hop = hopOf(reading);

    expect(reading.line?.issue).toBe(101);
    expect(reading.passed).toBe(1);
    expect(hop.waiting).toHaveLength(1);
    expect(hop.waiting[0]?.line.issue).toBe(100);
    expect(hop.waiting[0]?.blockers).toEqual([{ issue: 118, taken: { by: 'pull-request', pullRequest: 300 } }]);
    expect(hop.decision).toBeNull();
  });

  it('is passed when a branch claims C', async () => {
    const { reading } = await read({ rows: rowsWith(), branches: ['feat/rafa-118-far'] }, true);

    expect(reading.line?.issue).toBe(101);
    expect(hopOf(reading).waiting[0]?.blockers).toEqual([{ issue: 118, taken: { by: 'branch', branch: 'refs/heads/feat/rafa-118-far' } }]);
  });

  it('is not passed when one of two open blockers is free', async () => {
    const twice = { number: 100, body: 'Blocked by: #118 #119\n', labels: ['epic:home', 'spec:blocked'] };
    const { reading } = await read({ rows: rowsWith(twice), pulls: [{ number: 300, closes: 118 }] }, true);
    const hop = hopOf(reading);

    expect(reading.line?.issue).toBe(100);
    expect(hop.waiting).toEqual([]);
    expect(hop.decision).toMatchObject({ kind: 'hop', blocked: 100, blocker: 119 });
  });
});

describe('an epic that ran dry', () => {
  /** #101 taken by a branch and #100 waiting on C's pull request: epic #20 has nothing left. */
  const dry: Fixture = {
    rows: rowsWith(),
    pulls: [{ number: 300, closes: 118 }],
    branches: ['feat/rafa-101-x'],
  };

  it('names the next now epic on the board', async () => {
    const { reading } = await read(dry, true);

    expect(reading.line).toBeNull();
    expect(reading.dryEpic).toEqual({ number: 20, title: 'Issue 20' });
    expect(hopOf(reading).nextEpic).toMatchObject({ number: 25, slug: 'next', board: 10 });
  });

  it('names none when the next epic is not now (control)', async () => {
    const later = { number: 25, body: checklist([150]), labels: ['type:epic', 'epic:next', 'horizon:later'] };
    const { reading } = await read({ ...dry, rows: rowsWith(later) }, true);

    expect(reading.dryEpic?.number).toBe(20);
    expect(hopOf(reading).nextEpic).toBeNull();
  });

  it('carries a failed reading as a problem, not a rejection, where the listing leaves the board out', async () => {
    const { reading } = await read({ ...dry, unlisted: [HOME_BOARD] }, true);

    expect(hopOf(reading).nextEpic).toBeNull();
    expect(reading.problems).toHaveLength(1);
    expect(reading.problems[0]).toStartWith('the hop could not be read, so none is proposed: board epic walk: board #10');
  });
});

describe('the hop record', () => {
  it('answers C while a hop is away, not the epic\'s first line', async () => {
    const root = plantRoot(AWAY, AWAY_RECORD);
    const { reading } = await read({ rows: rowsWith() }, true, root);
    const hop = hopOf(reading);

    expect(reading.line?.issue).toBe(118);
    expect(reading.passed).toBe(0);
    expect(hop.record).toEqual(AWAY_RECORD);
    expect(hop.position).toEqual(AWAY);
    expect(hop.target).toEqual({ issue: 118, closed: false, pullRequest: null });
    expect(hop.decision).toBeNull();
  });

  it('reads the hop\'s own branch on C as not taking it, where at home it does (control)', async () => {
    const branches = ['feat/rafa-118-far'];
    const away = await read({ rows: rowsWith(), branches }, true, plantRoot(AWAY, AWAY_RECORD));
    const home = await read({ rows: rowsWith(), branches }, true);

    expect(away.reading.line?.issue).toBe(118);
    expect(home.reading.line?.issue).toBe(101);
  });

  it('answers no line and C\'s pull request once it is open', async () => {
    const root = plantRoot(AWAY, AWAY_RECORD);
    const { reading } = await read({ rows: rowsWith(), pulls: [{ number: 300, closes: 118 }] }, true, root);

    expect(reading.line).toBeNull();
    expect(Object.keys(reading)).not.toContain('dryEpic');
    expect(hopOf(reading).target).toEqual({ issue: 118, closed: false, pullRequest: 300 });
  });

  it('answers C closed without reading the pull requests', async () => {
    const root = plantRoot(AWAY, AWAY_RECORD);
    const closed = { number: 118, state: 'CLOSED' as const, labels: ['epic:far'] };
    const { reading, calls } = await read({ rows: rowsWith(closed) }, true, root);

    expect(reading.line).toBeNull();
    expect(hopOf(reading).target).toEqual({ issue: 118, closed: true, pullRequest: null });
    expect(calls.filter((call) => call.startsWith(PR_LIST_CALL))).toEqual([]);
  });

  it('halts with the chain read from home when C is blocked while away, its own branch there', async () => {
    const root = plantRoot(AWAY, AWAY_RECORD);
    const blockedC = { number: 118, body: 'Blocked by: #100\n', labels: ['epic:far', 'spec:blocked'] };
    const { reading } = await read({ rows: rowsWith(blockedC), branches: ['feat/rafa-118-far'] }, true, root);

    expect(reading.line?.issue).toBe(118);
    expect(hopOf(reading).decision).toMatchObject({
      kind: 'halt', reason: 'blocked-blocker', chain: { blocked: 100, blocker: 118, next: [100], mutual: true }, from: HOME, to: FAR,
    });
  });

  it('is dropped as stale when the position was re-homed by hand, and the walk follows the position', async () => {
    const rehomed: Position = { current: FAR, previous: HOME, home: FAR };
    const root = plantRoot(rehomed, AWAY_RECORD);
    const { reading } = await read({ rows: rowsWith() }, true, root);
    const hop = hopOf(reading);

    expect(hop.record).toBeNull();
    expect(hop.stale).toEqual(AWAY_RECORD);
    expect(hop.target).toBeNull();
    expect(reading.line?.issue).toBe(119);
    expect(reading.problems).toEqual([]);
  });

  it('is dropped as stale with no position file to weigh it against', async () => {
    const root = plantRoot(null, AWAY_RECORD);
    const { reading } = await read({ rows: rowsWith() }, true, root);

    expect(hopOf(reading)).toMatchObject({ record: null, stale: AWAY_RECORD, position: null });
    expect(reading.line?.issue).toBe(100);
  });

  it('carries a record that does not read as a problem, and follows none', async () => {
    const root = plantRoot(AWAY, null);
    writeFileSync(hopFilePath(root), '{"kind":"blocker"}\n', 'utf8');
    const { reading } = await read({ rows: rowsWith() }, true, root);

    expect(hopOf(reading)).toMatchObject({ record: null, stale: null });
    expect(reading.problems).toEqual([`${hopFilePath(root)} does not hold a hop record, so no hop is followed`]);
    expect(reading.line?.issue).toBe(119);
  });

  it('follows a waiting record home, passing H while C\'s pull request is open', async () => {
    const back: Position = { current: HOME, previous: FAR, home: HOME };
    const root = plantRoot(back, { ...AWAY_RECORD, state: 'waiting', pullRequest: 300 });
    const { reading } = await read({ rows: rowsWith(), pulls: [{ number: 300, closes: 118 }] }, true, root);
    const hop = hopOf(reading);

    expect(hop.record?.state).toBe('waiting');
    expect(hop.target).toBeNull();
    expect(reading.line?.issue).toBe(101);
    expect(hop.waiting.map((waiting) => waiting.line.issue)).toEqual([100]);
  });
});

describe('the one-hop rule on a dry hop', () => {
  /** Epic #25's #150 blocked by C, in epic #40 on the other board. */
  const blocked150 = { number: 150, body: 'Blocked by: #118\n', labels: ['epic:next', 'spec:blocked'] };
  const NEXT: Place = { board: 10, epic: 25 };

  it('halts a second move read away from home', async () => {
    const dryRecord = {
      ...AWAY_RECORD, kind: 'dry' as const, blocked: null, target: null, targetEpic: 25, targetBoard: 10,
    };
    const root = plantRoot({ current: NEXT, previous: HOME, home: HOME }, dryRecord);
    const { reading } = await read({ rows: rowsWith(blocked150) }, true, root);
    const hop = hopOf(reading);

    expect(hop.target).toBeNull();
    expect(reading.line?.issue).toBe(150);
    expect(hop.decision).toMatchObject({ kind: 'halt', reason: 'both-away', from: NEXT, to: FAR });
  });

  it('hops from the same place read at home (control)', async () => {
    const root = plantRoot({ current: NEXT, previous: null, home: NEXT }, null);
    const { reading } = await read({ rows: rowsWith(blocked150) }, true, root);

    expect(hopOf(reading).decision).toMatchObject({ kind: 'hop', blocked: 150, blocker: 118, from: NEXT, to: FAR });
  });
});
