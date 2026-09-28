/**
 * Tests for the GitHub board readings of `rafa doctor`
 * (`doctor-board.ts`): the runner opened once for a `gh` provider and
 * never for another, the four readings sent in order over it, the board
 * listing sent once for the two that read it, and their lines joined in
 * that order.
 *
 * Every case drives a recorded runner answering each listing from a
 * literal board and failing every other command, over a project root
 * planted under this file's own temporary directory, so no case reaches
 * GitHub, spawns `gh`, or reads a real repository. What each reading
 * says is its own module's suite (`./doctor-blocked.test.ts`,
 * `./doctor-epics.test.ts`, `./doctor-boards.test.ts`,
 * `../board/status.test.ts`); these cases hold
 * only what this module adds.
 */
import type { GhResult, GhRunner } from '../adapters/tracker/github.js';

import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { unlabelledRoadmapMessage } from '../board/boards.js';
import { BOARD_LIST_FIELDS } from '../board/roadmap-board.js';

import { BLOCKED_HEADING } from './doctor-blocked.js';
import { boardRunner, readDoctorBoard, renderDoctorBoard } from './doctor-board.js';
import { BOARDS_HEADING } from './doctor-boards.js';
import { EPICS_HEADING } from './doctor-epics.js';
import { BOARD_HEADING } from './init-board.js';

/** The project root every reading is made in: an empty directory, so no config and no template. */
const ROOT = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-doctor-board-')));

afterAll(() => {
  rmSync(ROOT, { recursive: true, force: true });
});

/** Which reading a command is, named for the case. */
function routeOf(args: readonly string[]): string {
  if (args[0] === 'label') return 'labels';
  if (args.includes(BOARD_LIST_FIELDS)) return 'listing';
  if (args.includes('--label')) return 'blocked';
  if (args.includes('--search')) return 'roadmap';
  return 'other';
}

/** One issue of the board listing as `gh` answers it: open, with no body, carrying `labels`. */
function listedRow(number: number, labels: readonly string[]): Record<string, unknown> {
  return { number, title: `issue ${String(number)}`, body: '', state: 'OPEN', stateReason: null, labels: labels.map((name) => ({ name })) };
}

/**
 * A runner answering each listing with a board carrying one faulted
 * blocked issue and, beside two epics, one issue with both their labels,
 * with `extra` rows added to the listing and `failing` routes failed.
 */
function fakeGh(extra: readonly Record<string, unknown>[] = [], failing: readonly string[] = []): {
  run: GhRunner;
  calls: () => readonly string[];
} {
  const calls: string[] = [];
  const answers: Record<string, unknown> = {
    labels: [],
    roadmap: [{ number: 8, title: 'Roadmap' }],
    blocked: [{ number: 12, body: 'no line\n' }],
    listing: [
      listedRow(1, ['type:epic', 'epic:auth', 'horizon:now']),
      listedRow(2, ['type:epic', 'epic:billing', 'horizon:next']),
      listedRow(5, ['epic:auth', 'epic:billing']),
      ...extra,
    ],
  };
  for (const route of failing) Reflect.deleteProperty(answers, route);
  const run: GhRunner = (args) => {
    const route = routeOf(args);
    calls.push(route);
    const answer = answers[route];
    const result: GhResult = answer === undefined
      ? { ok: false, stdout: '', stderr: `no route for ${args.join(' ')}` }
      : { ok: true, stdout: JSON.stringify(answer), stderr: '' };
    return Promise.resolve(result);
  };
  return { run, calls: () => calls };
}

describe('boardRunner', () => {
  it('opens no runner for a provider that is not gh, where gh opens one in the root', () => {
    const opened: string[] = [];
    const gh = fakeGh();
    const openGh = (root: string): GhRunner => {
      opened.push(root);
      return gh.run;
    };

    expect(boardRunner('none', ROOT, { openGh })).toBe(null);
    expect(opened).toEqual([]);
    expect(boardRunner('gh', ROOT, { openGh })).toBe(gh.run);
    expect(opened).toEqual([ROOT]);
  });
});

describe('readDoctorBoard', () => {
  it('reads nothing and answers four nulls with no runner, where a runner answers all four', async () => {
    const gh = fakeGh();

    const run = await readDoctorBoard(null, ROOT, null);
    const control = await readDoctorBoard(gh.run, ROOT, null);

    expect(run).toEqual({ board: null, blocked: null, epics: null, boards: null });
    expect(control.board).not.toBe(null);
    expect(control.blocked?.faults.length).toBe(1);
    expect(control.epics?.faults.map((fault) => fault.kind)).toEqual(['several-epic-labels']);
    expect(control.boards).toEqual({ boards: 0, faults: [], problems: [], listing: null });
  });

  it('sends the board rows, then the blocked issues, then the epic labels, each listing once', async () => {
    const gh = fakeGh();

    await readDoctorBoard(gh.run, ROOT, null);

    expect(gh.calls()).toEqual(['labels', 'blocked', 'listing']);
  });

  it('sends the board listing once for the epic labels and the boards, a labelled board included', async () => {
    const gh = fakeGh([listedRow(9, ['type:roadmap']), { ...listedRow(8, []), title: 'Roadmap' }]);

    const readings = await readDoctorBoard(gh.run, ROOT, null);

    expect(gh.calls().filter((call) => call === 'listing')).toHaveLength(1);
    expect(readings.boards?.faults.map((fault) => fault.kind)).toEqual(['unlabelled-roadmap']);
  });

  it('hands both rows the one failed listing, sending it once', async () => {
    const gh = fakeGh([], ['listing']);

    const readings = await readDoctorBoard(gh.run, ROOT, null);

    expect(gh.calls().filter((call) => call === 'listing')).toHaveLength(1);
    expect(readings.epics?.problem).not.toBe(null);
    expect(readings.boards?.listing).toBe(readings.epics?.problem ?? 'no epic labels problem');
  });
});

describe('renderDoctorBoard', () => {
  it('joins the board rows, the blocked issues, the epic labels and the boards in that order', async () => {
    const readings = await readDoctorBoard(fakeGh([{ ...listedRow(8, []), title: 'Roadmap' }, listedRow(9, ['type:roadmap'])]).run, ROOT, null);

    const lines = renderDoctorBoard(readings);
    const heads = lines.filter((line) => !line.startsWith(' ') && line.endsWith(':'));

    expect(heads).toEqual([BOARD_HEADING, BLOCKED_HEADING, EPICS_HEADING, BOARDS_HEADING]);
    expect(lines.at(-1)).toBe(`  ${unlabelledRoadmapMessage([8])}`);
  });

  it('prints nothing for a project with no board', () => {
    expect(renderDoctorBoard({ board: null, blocked: null, epics: null, boards: null })).toEqual([]);
  });
});
