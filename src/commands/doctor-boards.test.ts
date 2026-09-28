/**
 * Tests for the boards row of `rafa doctor` (`doctor-boards.ts`): an
 * owner that resolves to nobody, an unlabelled "Roadmap" beside labelled
 * boards and a position on a board or epic that no longer stands, each
 * named once under `Boards:`, and nothing at all for a project with none
 * of them.
 *
 * Every case drives a recorded runner answering from a literal board and
 * failing every other command, with the position planted under this
 * file's own temporary directory, so no case reaches GitHub or spawns
 * `gh`. Each case that says a fault is NOT named is paired with a control
 * where the same fixture, changed in the one fact, names it.
 */
import type { GhResult, GhRunner } from '../adapters/tracker/github.js';
import type { Position } from '../project/position.js';

import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'bun:test';

import { unlabelledRoadmapMessage } from '../board/boards.js';
import { BOARD_LIST_FIELDS, createGhBoardListing } from '../board/roadmap-board.js';
import { writePositionFile } from '../project/position.js';

import { BOARDS_HEADING, readDoctorBoards, renderDoctorBoards, unresolvedOwnerMessage } from './doctor-boards.js';

/** Every root a case planted, removed after it. */
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** A fresh project root, with `position` planted when given. */
function plantRoot(position?: Position): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-doctor-boards-')));
  roots.push(root);
  if (position !== undefined) writePositionFile(root, position);
  return root;
}

/** One issue of the board listing, as the case writes it. */
interface Row {
  readonly number: number;
  readonly title?: string;
  readonly body?: string;
  readonly state?: 'OPEN' | 'CLOSED';
  readonly labels?: readonly string[];
}

/** What the fake answers: the listing, the title search, and which handles GitHub knows. */
interface FakeBoard {
  readonly listed: readonly Row[];
  /** The issues the title search finds. */
  readonly titled?: readonly { number: number; title: string }[];
  /** API paths answered 404. */
  readonly missing?: readonly string[];
  /** API paths answered with a failure that is not a 404. */
  readonly failing?: readonly string[];
  /** Fail the listing itself. */
  readonly listingFails?: boolean;
  /** Fail the title search. */
  readonly searchFails?: boolean;
}

/** Which reading a command is, told apart by its flags, never by its first two words alone. */
function routeOf(args: readonly string[]): string {
  if (args[0] === 'api') return `api ${args[1] ?? ''}`;
  if (args.includes(BOARD_LIST_FIELDS) && !args.includes('--label')) return 'listing';
  if (args.includes('--search')) return 'search';
  return 'other';
}

/** One listing row as `gh` answers it. */
function rowOf(row: Row): Record<string, unknown> {
  return {
    number: row.number,
    title: row.title ?? `issue ${String(row.number)}`,
    body: row.body ?? '',
    state: row.state ?? 'OPEN',
    stateReason: null,
    labels: (row.labels ?? []).map((name) => ({ name })),
  };
}

/** A recorded runner over `board`, answering the listing, the search and the owner lookups. */
function fakeGh(board: FakeBoard): { run: GhRunner; calls: () => readonly string[] } {
  const calls: string[] = [];
  const ok = (answer: unknown): GhResult => ({ ok: true, stdout: JSON.stringify(answer), stderr: '' });
  const fail = (stderr: string): GhResult => ({ ok: false, stdout: '', stderr });
  const answer = (route: string): GhResult => {
    if (route === 'listing') {
      return board.listingFails === true
        ? fail('HTTP 502: bad gateway')
        : ok(board.listed.map(rowOf));
    }
    if (route === 'search') {
      return board.searchFails === true
        ? fail('HTTP 503: unavailable')
        : ok(board.titled ?? []);
    }
    if (!route.startsWith('api ')) return fail(`no route for ${route}`);
    const path = route.slice(4);
    if (board.missing?.includes(path) === true) return fail('gh: Not Found (HTTP 404)');
    if (board.failing?.includes(path) === true) return fail('gh: API rate limit exceeded (HTTP 403)');
    return ok({});
  };
  const run: GhRunner = (args) => {
    const route = routeOf(args);
    calls.push(route);
    return Promise.resolve(answer(route));
  };
  return { run, calls: () => calls };
}

/** Reads the row over `board` in `root`, the listing made over the same runner. */
async function readOver(board: FakeBoard, root: string, configured: number | null = null) {
  const gh = fakeGh(board);
  const report = await readDoctorBoards({ gh: gh.run, root, configured, listing: createGhBoardListing({ gh: gh.run }) });
  return { report, calls: gh.calls() };
}

/** An open `type:roadmap` board. */
function board(number: number, body = ''): Row {
  return { number, title: `Board ${String(number)}`, body, labels: ['type:roadmap'] };
}

/** An open `type:epic` issue on the `now` horizon. */
function epic(number: number, state: 'OPEN' | 'CLOSED' = 'OPEN'): Row {
  return { number, title: `Epic ${String(number)}`, state, labels: ['type:epic', 'horizon:now'] };
}

describe('readDoctorBoards: a project with none of them', () => {
  it('sends nothing past the listing and prints nothing with no labelled board and no position', async () => {
    const root = plantRoot();
    const listed = [{ number: 1, title: 'Roadmap', body: 'Owner: @ghost\n' }];

    const { report, calls } = await readOver({ listed, missing: ['users/ghost'] }, root);
    const control = await readOver({ listed: [board(1, 'Owner: @ghost\n')], missing: ['users/ghost'] }, root);

    expect(calls).toEqual(['listing']);
    expect(renderDoctorBoards(report)).toEqual([]);
    expect(control.report.faults.map((fault) => fault.kind)).toEqual(['unresolved-owner']);
  });

  it('prints nothing for labelled boards whose owners resolve, beside no unlabelled Roadmap', async () => {
    const root = plantRoot();
    const listed = [board(1, 'Owner: @acme/web\n'), board(2)];

    const { report, calls } = await readOver({ listed, titled: [] }, root);

    expect(calls).toEqual(['listing', 'api orgs/acme/teams/web', 'search']);
    expect(report).toEqual({ boards: 2, faults: [], problems: [], listing: null });
    expect(renderDoctorBoards(report)).toEqual([]);
  });

  it('prints nothing for null, a project with no GitHub board', () => {
    expect(renderDoctorBoards(null)).toEqual([]);
  });
});

describe('readDoctorBoards: owners', () => {
  it('names a board whose owner resolves to nobody once, asking a handle two boards share once', async () => {
    const root = plantRoot();
    const listed = [board(3, 'Owner: @acme/ghosts\n'), board(4, 'Owner: @ACME/ghosts\n'), board(5, 'Owner: @acme/web\n')];

    const { report, calls } = await readOver({ listed, missing: ['orgs/acme/teams/ghosts'] }, root);

    expect(calls.filter((call) => call.startsWith('api '))).toEqual(['api orgs/acme/teams/ghosts', 'api orgs/acme/teams/web']);
    expect(renderDoctorBoards(report)).toEqual([
      BOARDS_HEADING,
      `  ${unresolvedOwnerMessage(3, '@acme/ghosts')}`,
      `  ${unresolvedOwnerMessage(4, '@ACME/ghosts')}`,
    ]);
  });

  it('says an owner could not be checked, never that it is unresolved, when GitHub answered no 404', async () => {
    const root = plantRoot();

    const { report } = await readOver({ listed: [board(6, 'Owner: @flaky\n')], failing: ['users/flaky'] }, root);

    expect(report.faults).toEqual([]);
    expect(report.problems).toHaveLength(1);
    expect(report.problems[0]).toStartWith('owner @flaky of board #6 could not be checked: gh api users/flaky failed:');
  });

  it('asks nothing for a board with no Owner: line', async () => {
    const root = plantRoot();

    const { calls } = await readOver({ listed: [board(7)] }, root);

    expect(calls.some((call) => call.startsWith('api '))).toBe(false);
  });
});

describe('readDoctorBoards: an unlabelled Roadmap', () => {
  it('names an open issue titled Roadmap without the label beside a labelled board, once', async () => {
    const root = plantRoot();
    const listed = [board(10), { number: 2, title: 'Roadmap' }];
    const titled = [{ number: 2, title: 'Roadmap' }, { number: 10, title: 'Board 10' }, { number: 9, title: 'Roadmap ideas' }];

    const { report } = await readOver({ listed, titled }, root);

    expect(report.faults).toEqual([{ kind: 'unlabelled-roadmap', issues: [2], message: unlabelledRoadmapMessage([2]) }]);
    expect(renderDoctorBoards(report)).toEqual([BOARDS_HEADING, `  ${unlabelledRoadmapMessage([2])}`]);
  });

  it('names nothing and searches nothing while no board is labelled, the title rule still in force', async () => {
    const root = plantRoot();
    const titled = [{ number: 2, title: 'Roadmap' }];

    const { report, calls } = await readOver({ listed: [{ number: 2, title: 'Roadmap' }], titled }, root);
    const control = await readOver({ listed: [board(10), { number: 2, title: 'Roadmap' }], titled }, root);

    expect(calls).toEqual(['listing']);
    expect(report.faults).toEqual([]);
    expect(control.report.faults.map((fault) => fault.kind)).toEqual(['unlabelled-roadmap']);
  });

  it('says the Roadmap issues could not be read when the title search fails', async () => {
    const root = plantRoot();

    const { report } = await readOver({ listed: [board(10)], searchFails: true }, root);

    expect(report.faults).toEqual([]);
    expect(report.problems).toHaveLength(1);
    expect(report.problems[0]).toStartWith('the issues titled Roadmap could not be read:');
  });
});

describe('readDoctorBoards: the position', () => {
  /** A default board 10 listing epic 11, beside the rows a case adds. */
  const around = (rows: readonly Row[]): readonly Row[] => [board(10, '- [ ] #11\n'), epic(11), ...rows];

  it('names a position on a closed board once, both slots in one sentence, with the fallback', async () => {
    const root = plantRoot({ current: { board: 20, epic: null }, previous: null, home: { board: 20, epic: null } });
    const listed = around([{ ...board(20), state: 'CLOSED' }]);

    const { report } = await readOver({ listed, titled: [] }, root);

    expect(report.faults.map((fault) => fault.kind)).toEqual(['lost-position']);
    expect(report.faults[0]?.message).toBe(
      'The current place and home lost board #20, which is closed; falling back to the default board #10 at epic #11',
    );
  });

  it('names a position on a board that lost its label', async () => {
    const root = plantRoot({ current: { board: 21, epic: null }, previous: null, home: { board: 10, epic: 11 } });
    const listed = around([{ number: 21, title: 'Old board' }]);

    const { report } = await readOver({ listed, titled: [] }, root);

    expect(report.faults.map((fault) => fault.message)).toEqual([
      'The current place lost board #21, which does not carry type:roadmap; falling back to the default board #10 at epic #11',
    ]);
  });

  it('names a position on a closed epic, and nothing for a position that stands', async () => {
    const standing: Position = { current: { board: 10, epic: 11 }, previous: null, home: { board: 10, epic: 11 } };
    const closed: Position = { current: { board: 10, epic: 12 }, previous: null, home: { board: 10, epic: 11 } };
    const listed = around([epic(12, 'CLOSED')]);

    const run = await readOver({ listed, titled: [] }, plantRoot(standing));
    const control = await readOver({ listed, titled: [] }, plantRoot(closed));

    expect(run.report.faults).toEqual([]);
    expect(control.report.faults.map((fault) => fault.message)).toEqual([
      'The current place lost epic #12, which is closed; falling back to the default board #10 at epic #11',
    ]);
  });

  it('checks a position with no labelled board against the title rule, spending one search', async () => {
    const root = plantRoot({ current: { board: 2, epic: null }, previous: null, home: { board: 2, epic: null } });
    const listed = [{ number: 2, title: 'Roadmap', state: 'CLOSED' as const }];

    const { report, calls } = await readOver({ listed, titled: [{ number: 3, title: 'Roadmap' }] }, root);

    expect(calls).toEqual(['listing', 'search']);
    expect(report.faults.map((fault) => fault.kind)).toEqual(['lost-position']);
    expect(report.faults[0]?.message).toStartWith('The current place and home lost board #2, which is closed;');
  });

  it('says the position could not be checked when the default board cannot be found', async () => {
    const root = plantRoot({ current: { board: 2, epic: null }, previous: null, home: { board: 2, epic: null } });

    const { report } = await readOver({ listed: [{ number: 2, title: 'Roadmap', state: 'CLOSED' }], titled: [] }, root);

    expect(report.faults).toEqual([]);
    expect(report.problems).toHaveLength(1);
    expect(report.problems[0]).toStartWith('the position could not be checked:');
  });
});

describe('readDoctorBoards: a listing that failed', () => {
  it('carries why and prints nothing, sending nothing else, since the epic labels row names that failure', async () => {
    const root = plantRoot({ current: { board: 2, epic: null }, previous: null, home: { board: 2, epic: null } });

    const { report, calls } = await readOver({ listed: [], listingFails: true }, root);

    expect(calls).toEqual(['listing']);
    expect(report.listing).toStartWith('board listing: gh issue list --state all');
    expect(report.faults).toEqual([]);
    expect(renderDoctorBoards(report)).toEqual([]);
  });
});

describe('renderDoctorBoards', () => {
  it('prints the faults, then the readings that failed, each under one heading', async () => {
    const root = plantRoot();
    const listed = [board(3, 'Owner: @ghost\n'), board(4, 'Owner: @flaky\n'), { number: 8, title: 'Roadmap' }];
    const titled = [{ number: 8, title: 'Roadmap' }];

    const { report } = await readOver({ listed, titled, missing: ['users/ghost'], failing: ['users/flaky'] }, root);
    const lines = renderDoctorBoards(report);

    expect(lines.filter((line) => line === BOARDS_HEADING)).toHaveLength(1);
    expect(lines.slice(1, 3)).toEqual([`  ${unresolvedOwnerMessage(3, '@ghost')}`, `  ${unlabelledRoadmapMessage([8])}`]);
    expect(lines[3]).toStartWith('  owner @flaky of board #4 could not be checked:');
  });
});
