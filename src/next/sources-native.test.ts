/**
 * Tests for `rafa next`'s board (`./sources.ts`, `ghNextBoard`) handed the
 * board's relationships port in `native` mode, and the state table read
 * over it (`./state.ts`): the listing asked for the mode's fields, what a
 * line waits on read off its `blockedBy` nodes with no per-blocker read,
 * a blocked line passed so that no `unblock` is proposed, the line
 * proposed once its blocker closed, and the answer carrying the mode.
 * `./sources.test.ts` holds the `labels` board and is past the 800-line
 * cap.
 *
 * The board, on `acme/board`, a solo one with no epic: board #1 lists
 * #10 then #11, both `spec:ready`. #10 is blocked by #20, open, which the
 * roadmap does not list. `roadmap.issue` names board #1. The `gh` here
 * answers the listing, `gh issue view`, the board list and the pull
 * request list, and records every call.
 *
 * ## The controls
 *
 * #10 also carries `spec:blocked` and a `Blocked by: #20` line, the
 * `labels` mode's marks. The same `gh` read without the port stops at #10
 * and proposes `unblock`, reading #20 with its own `gh issue view`; so a
 * board that fell back to labels in `native` mode is seen, and so is one
 * that read a blocker one issue at a time.
 */
import type { NextBoard, NextSources } from './readings.js';
import type { GhResult, GhRunner } from '../adapters/tracker/github.js';
import type { EpicRelations } from '../board/epics.js';
import type { GitResult, GitRunner } from '../pr/index.js';

import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { createNativeRelations } from '../board/relations/native.js';
import { plansDirAt } from '../plan/plan-files.js';
import { createPullRequestsDouble } from '../pr/pull-requests-double.js';
import { writePositionFile } from '../project/position.js';

import { ghNextBoard } from './sources.js';
import { readNextState } from './state.js';

/** A temporary directory of this file's own, holding an empty plans directory. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-next-sources-native-')));
mkdirSync(join(tempBase, '.rafa', 'plans'), { recursive: true });

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** The board's own repository. */
const REPOSITORY = 'acme/board';

/** The base branch the state table is read on. */
const BASE = 'main';

/** How the recorded calls name the board listing. */
const LISTING_CALL = 'issue list --state all';

/** One issue as a case plants it. */
interface Row {
  readonly number: number;
  readonly body?: string;
  readonly state?: 'OPEN' | 'CLOSED';
  readonly labels?: readonly string[];
  /** The issues it is blocked by, each open unless closed on the board. */
  readonly blockedBy?: readonly number[];
  /** The epic it is a sub-issue of. */
  readonly parent?: number;
  /** Its sub-issues, in the epic's order. */
  readonly subIssues?: readonly number[];
}

/** An answer `gh` wrote. */
function wrote(stdout: string): Promise<GhResult> {
  return Promise.resolve({ ok: true, stdout, stderr: '' });
}

/** A linked issue as `gh issue list --json` answers it, its state read off `rows`. */
function node(number: number, rows: readonly Row[]): Record<string, unknown> {
  return {
    id: `I_node${String(number)}`,
    number,
    state: rows.find((row) => row.number === number)?.state ?? 'OPEN',
    title: `Issue ${String(number)}`,
    url: `https://github.com/${REPOSITORY}/issues/${String(number)}`,
  };
}

/** A row as `gh issue view` answers it. */
function viewed(row: Row): Record<string, unknown> {
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

/** A row as the native listing answers it: the viewed fields and the five relationship fields. */
function listed(row: Row, rows: readonly Row[]): Record<string, unknown> {
  const blockedBy = (row.blockedBy ?? []).map((number) => node(number, rows));
  const subIssues = (row.subIssues ?? []).map((number) => node(number, rows));
  return {
    ...viewed(row),
    parent: row.parent === undefined
      ? null
      : node(row.parent, rows),
    blockedBy: { nodes: blockedBy, totalCount: blockedBy.length },
    blocking: { nodes: [], totalCount: 0 },
    subIssuesSummary: { completed: 0, percentCompleted: 0, total: subIssues.length },
    subIssues: { nodes: subIssues, totalCount: subIssues.length },
  };
}

/** A `gh` answering `rows`, recording each call and the listing's `--json` fields. */
function fakeGh(rows: readonly Row[]): { readonly gh: GhRunner; readonly calls: string[]; readonly fields: string[] } {
  const calls: string[] = [];
  const fields: string[] = [];
  const gh: GhRunner = (args) => {
    const route = args.slice(0, 2).join(' ');
    const listing = route === 'issue list' && args.includes('--state') && args.includes('all');
    calls.push(listing
      ? LISTING_CALL
      : args.slice(0, 3).join(' '));
    if (listing) {
      fields.push(args[args.indexOf('--json') + 1] ?? '');
      return wrote(JSON.stringify(rows.map((row) => listed(row, rows))));
    }
    if (route === 'issue list' || route === 'pr list') return wrote('[]');
    if (route === 'issue view') {
      const number = Number(args[2]);
      return wrote(JSON.stringify(viewed(rows.find((row) => row.number === number) ?? { number })));
    }
    return Promise.resolve({ ok: false, stdout: '', stderr: `unexpected ${args.join(' ')}` });
  };
  return { gh, calls, fields };
}

/** Git on a clean base level with its remote, holding no branch. */
const GIT: GitRunner = (args): GitResult => {
  const answers: Readonly<Record<string, string>> = {
    'rev-parse --abbrev-ref HEAD': `${BASE}\n`,
    [`rev-list --left-right --count ${BASE}...origin/${BASE}`]: '0\t0\n',
  };
  return { ok: true, stdout: answers[args.join(' ')] ?? '', stderr: '' };
};

/** The board the module note describes, #20 in `twenty`'s state. */
function rowsWith(twenty: 'OPEN' | 'CLOSED'): readonly Row[] {
  return [
    { number: 1, body: '- [ ] #10\n- [ ] #11', labels: ['type:roadmap'] },
    { number: 10, body: 'Blocked by: #20\n', labels: ['spec:ready', 'spec:blocked'], blockedBy: [20] },
    { number: 11, labels: ['spec:ready'] },
    { number: 20, state: twenty },
  ];
}

/**
 * The board with epics: board #1 lists epic #5 then epic #6, both
 * `horizon:now`. Epic #5's checklist is #11, #12, #10 and its sub-issues
 * are #10, #12, #11; #10 is blocked by #20, open, epic #6's one sub-issue.
 */
const EPIC_ROWS: readonly Row[] = [
  { number: 1, body: '- [ ] #5\n- [ ] #6', labels: ['type:roadmap'] },
  { number: 5, body: '- [ ] #11\n- [ ] #12\n- [ ] #10', labels: ['type:epic', 'horizon:now'], subIssues: [10, 12, 11] },
  { number: 6, body: '- [ ] #20', labels: ['type:epic', 'horizon:now'], subIssues: [20] },
  { number: 10, labels: ['spec:ready'], parent: 5, blockedBy: [20] },
  { number: 11, labels: ['spec:ready'], parent: 5 },
  { number: 12, labels: ['spec:ready'], parent: 5 },
  { number: 20, labels: ['spec:ready'], parent: 6 },
];

/** The `native` adapter on the board's repository, over a `gh` no read reaches. */
function nativeOver(gh: GhRunner): EpicRelations {
  return createNativeRelations({ gh, repository: REPOSITORY });
}

/** What a board over rows is built with beside them. */
interface BoardShape {
  readonly mode?: 'native' | 'labels';
  readonly roadmap?: boolean;
  /** The project root whose position file names the current place. */
  readonly root?: string;
}

/** The board over `rows`, `native` unless `labels` is asked for, and the calls it sent. */
function boardOver(rows: readonly Row[], shape: BoardShape = {}): { readonly board: NextBoard; readonly calls: string[]; readonly fields: string[] } {
  const { gh, calls, fields } = fakeGh(rows);
  const board = ghNextBoard({
    gh,
    git: GIT,
    configured: 1,
    ...shape.mode === 'labels'
      ? {}
      : { relations: nativeOver(gh) },
    ...shape.roadmap === true
      ? { roadmap: true }
      : {},
    ...shape.root === undefined
      ? {}
      : { root: shape.root },
  });
  return { board, calls, fields };
}

/** The sources the state table reads over `board`. */
function sourcesOver(board: NextBoard): NextSources {
  return {
    base: BASE,
    plans: plansDirAt(tempBase, '.rafa/plans'),
    runs: () => [],
    git: GIT,
    pulls: createPullRequestsDouble({ findOpen: () => Promise.resolve(null) }).pulls,
    board,
  };
}

describe('the native board while #20 is open', () => {
  it('passes #10 and answers #11, one line passed', async () => {
    const { board } = boardOver(rowsWith('OPEN'));

    const reading = await board.next();

    expect(reading.line?.issue).toBe(11);
    expect(reading.passed).toBe(1);
    expect(reading.problems).toEqual([]);
  });

  it('reads #10\'s blocker off the one listing, asked for the native fields, and never views #20', async () => {
    const { board, calls, fields } = boardOver(rowsWith('OPEN'));

    await board.next();

    expect(calls.filter((call) => call === LISTING_CALL)).toHaveLength(1);
    expect(fields[0]?.split(',')).toContain('blockedBy');
    expect(calls).not.toContain('issue view 20');
  });

  it('stops at #10 without the port, reading #20 with its own view and no listing, the control', async () => {
    const { board, calls } = boardOver(rowsWith('OPEN'), { mode: 'labels' });

    const reading = await board.next();
    const blocked = await board.blocking(10);

    expect(reading.line?.issue).toBe(10);
    expect(blocked?.open).toEqual([20]);
    expect(calls).toContain('issue view 20');
    expect(calls).not.toContain(LISTING_CALL);
  });

  it('carries the mode on the native board and leaves the key out in labels mode', () => {
    const native = boardOver(rowsWith('OPEN')).board;
    const labels = boardOver(rowsWith('OPEN'), { mode: 'labels' }).board;

    expect(native.mode).toBe('native');
    expect(Object.keys(native).sort()).toEqual(['blocking', 'isReady', 'mode', 'next']);
    expect(Object.keys(labels).sort()).toEqual(['blocking', 'isReady', 'next']);
  });
});

describe('the native board once #20 has closed', () => {
  it('answers #10, nothing passed', async () => {
    const { board } = boardOver(rowsWith('CLOSED'));

    const reading = await board.next();

    expect(reading.line?.issue).toBe(10);
    expect(reading.passed).toBe(0);
    expect(await board.blocking(10)).toBeNull();
  });
});

describe('the state table over the native board', () => {
  it('proposes planning #11 while #20 is open, and no unblock', async () => {
    const state = await readNextState(sourcesOver(boardOver(rowsWith('OPEN')).board));

    expect([state.id, state.action, state.issue]).toEqual(['issue-ready', 'plan', 11]);
  });

  it('proposes planning #10 once #20 has closed, sending no write', async () => {
    const { board, calls } = boardOver(rowsWith('CLOSED'));

    const state = await readNextState(sourcesOver(board));

    expect([state.id, state.action, state.issue]).toEqual(['issue-ready', 'plan', 10]);
    expect(calls.filter((call) => call.startsWith('issue edit') || call.startsWith('api'))).toEqual([]);
  });

  it('proposes unblocking #10 over the same gh without the port, the control', async () => {
    const state = await readNextState(sourcesOver(boardOver(rowsWith('OPEN'), { mode: 'labels' }).board));

    expect([state.id, state.action, state.issue]).toEqual(['issue-blocked', 'unblock', 10]);
  });
});

/** A project root whose position stands in epic #5 on board #1. */
function rootInEpicFive(): string {
  const root = join(tempBase, 'in-epic-5');
  mkdirSync(join(root, '.rafa'), { recursive: true });
  const place = { board: 1, epic: 5 };
  writePositionFile(root, { current: place, previous: null, home: place });
  return root;
}

describe('the native board with epics', () => {
  it('descends into epic #5 and walks its sub-issues in order, passing #10 for #12', async () => {
    const { board } = boardOver(EPIC_ROWS);

    const reading = await board.next();

    expect(reading.line?.issue).toBe(12);
    expect(reading.passed).toBe(1);
  });

  it('walks epic #5\'s checklist without the port, the control', async () => {
    const { board } = boardOver(EPIC_ROWS, { mode: 'labels' });

    expect((await board.next()).line?.issue).toBe(11);
  });

  it('stops at #10 under roadmap and decides the hop to #20\'s epic, #6', async () => {
    const { board } = boardOver(EPIC_ROWS, { roadmap: true });

    const reading = await board.next();

    expect(reading.line?.issue).toBe(10);
    expect(reading.hop?.decision).toMatchObject({ kind: 'hop', blocked: 10, blocker: 20, epic: 6, slug: null, board: 1 });
    expect(reading.problems).toEqual([]);
  });
});

describe('the native board standing in epic #5', () => {
  it('walks the epic\'s sub-issues in order, passing #10 for #12', async () => {
    const { board } = boardOver(EPIC_ROWS, { root: rootInEpicFive() });

    const reading = await board.next();

    expect(reading.line?.issue).toBe(12);
    expect(reading.passed).toBe(1);
  });

  it('walks the epic\'s checklist without the port, the control', async () => {
    const { board } = boardOver(EPIC_ROWS, { mode: 'labels', root: rootInEpicFive() });

    expect((await board.next()).line?.issue).toBe(11);
  });
});
