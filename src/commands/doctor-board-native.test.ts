/**
 * Tests for the mode `rafa doctor`'s board readings are made in
 * (`doctor-board.ts`, "The mode"): `labels`, the default, runs the
 * blocked issues and epic labels rows and carries no `relations` key;
 * `native` runs the relationships row in their place over the one
 * listing, asked for the native fields, and sends neither row's `gh`
 * command.
 *
 * Every case drives a recorded runner answering each command from a
 * literal board and failing every other, over a project root planted
 * under this file's own temporary directory, so no case reaches GitHub,
 * spawns `gh`, or reads a real repository. What the relationships row
 * says is `./doctor-relations.test.ts`'s; these cases hold only the
 * wiring.
 */
import type { GhResult, GhRunner } from '../adapters/tracker/github.js';

import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { BOARD_LIST_FIELDS, nativeBoardListFields } from '../board/roadmap-board.js';

import { BLOCKED_HEADING } from './doctor-blocked.js';
import { readDoctorBoard, relationsResultOf, renderDoctorBoard } from './doctor-board.js';
import { EPICS_HEADING } from './doctor-epics.js';
import { RELATIONS_HEADING } from './doctor-relations.js';
import { BOARD_HEADING } from './init-board.js';

/** The project root every reading is made in: an empty directory, so no config and no template. */
const ROOT = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-doctor-board-native-')));

afterAll(() => {
  rmSync(ROOT, { recursive: true, force: true });
});

/** The board's own repository. */
const REPOSITORY = 'acme/board';

/** Which reading a command is, named for the case. */
function routeOf(args: readonly string[]): string {
  if (args[0] === 'label') return 'labels';
  if (args[0] === 'repo') return 'repo';
  if (args.includes(nativeBoardListFields)) return 'native-listing';
  if (args.includes(BOARD_LIST_FIELDS)) return 'listing';
  if (args.includes('--label')) return 'blocked';
  if (args.includes('--search')) return 'roadmap';
  return 'other';
}

/** A link node naming issue `number` on the board. */
function node(number: number): object {
  return { number, title: `Issue ${String(number)}`, state: 'OPEN', url: `https://github.com/${REPOSITORY}/issues/${String(number)}` };
}

/** One issue as the native listing writes it, `blockedTotal` above its one blocker when set. */
function nativeRow(number: number, labels: readonly string[], blockedTotal?: number): Record<string, unknown> {
  const blockedBy = blockedTotal === undefined
    ? []
    : [node(2)];
  return {
    number,
    title: `issue ${String(number)}`,
    body: '',
    state: 'OPEN',
    stateReason: null,
    labels: labels.map((name) => ({ name })),
    parent: null,
    blockedBy: { nodes: blockedBy, totalCount: blockedTotal ?? 0 },
    blocking: { nodes: [], totalCount: 0 },
    subIssuesSummary: { total: 0, completed: 0, percentCompleted: 0 },
    subIssues: { nodes: [], totalCount: 0 },
  };
}

/** One issue as the labels listing writes it. */
function labelsRow(number: number, labels: readonly string[]): Record<string, unknown> {
  return { number, title: `issue ${String(number)}`, body: '', state: 'OPEN', stateReason: null, labels: labels.map((name) => ({ name })) };
}

/**
 * A runner answering every route: in both listings, #5 carries two
 * `epic:` labels, a labels-mode fault the native mode never reads, and
 * in the native one #5 has 57 blockers of which `gh` answered one.
 */
function fakeGh(failing: readonly string[] = []): { run: GhRunner; calls: () => readonly string[] } {
  const calls: string[] = [];
  const answers: Record<string, unknown> = {
    'labels': [],
    'roadmap': [{ number: 8, title: 'Roadmap' }],
    'blocked': [{ number: 12, body: 'no line\n' }],
    'repo': { nameWithOwner: REPOSITORY },
    'listing': [
      labelsRow(1, ['type:epic', 'epic:auth']),
      labelsRow(2, ['type:epic', 'epic:billing']),
      labelsRow(5, ['epic:auth', 'epic:billing']),
    ],
    'native-listing': [
      nativeRow(1, ['type:epic', 'epic:auth']),
      nativeRow(2, ['type:epic', 'epic:billing']),
      nativeRow(5, ['epic:auth', 'epic:billing'], 57),
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

describe('readDoctorBoard in labels mode', () => {
  it('leaves the relations key out, the default and an explicit labels alike', async () => {
    const byDefault = await readDoctorBoard(fakeGh().run, ROOT, null);
    const explicit = await readDoctorBoard(fakeGh().run, ROOT, null, 'labels');

    expect(Object.keys(byDefault)).toEqual(['board', 'blocked', 'epics', 'boards']);
    expect(Object.keys(explicit)).toEqual(['board', 'blocked', 'epics', 'boards']);
    expect(Object.keys(relationsResultOf(byDefault))).toEqual([]);
  });

  it('sends the blocked issues and the labels listing, never the native listing or the repository', async () => {
    const gh = fakeGh();

    const readings = await readDoctorBoard(gh.run, ROOT, null, 'labels');

    expect(gh.calls()).toEqual(['labels', 'blocked', 'listing']);
    expect(readings.blocked?.faults.length).toBe(1);
    expect(readings.epics?.faults.map((fault) => fault.kind)).toEqual(['several-epic-labels']);
  });
});

describe('readDoctorBoard in native mode', () => {
  it('runs the relationships row in place of the blocked issues and the epic labels', async () => {
    const gh = fakeGh();

    const readings = await readDoctorBoard(gh.run, ROOT, null, 'native');

    expect(gh.calls()).toEqual(['labels', 'native-listing', 'repo']);
    expect(readings.blocked).toBe(null);
    expect(readings.epics).toBe(null);
    expect(readings.relations?.truncated).toEqual([{ kind: 'blockers', issue: 5, answered: 1, total: 57 }]);
    expect(Object.keys(readings)).toEqual(['board', 'blocked', 'epics', 'relations', 'boards']);
  });

  it('sends the native listing once for the relationships and the boards, a labelled board included', async () => {
    const gh = fakeGh();

    const readings = await readDoctorBoard(gh.run, ROOT, null, 'native');

    expect(gh.calls().filter((call) => call === 'native-listing')).toHaveLength(1);
    expect(readings.boards).toEqual({ boards: 0, faults: [], problems: [], listing: null });
  });

  it('hands the relationships and the boards the one failed listing', async () => {
    const gh = fakeGh(['native-listing']);

    const readings = await readDoctorBoard(gh.run, ROOT, null, 'native');

    expect(gh.calls().filter((call) => call === 'native-listing')).toHaveLength(1);
    expect(readings.relations?.problem).not.toBe(null);
    expect(readings.boards?.listing).toBe(readings.relations?.problem ?? 'no relations problem');
  });

  it('carries the relations report in the json result', async () => {
    const readings = await readDoctorBoard(fakeGh().run, ROOT, null, 'native');

    expect(relationsResultOf(readings)).toEqual({ relations: readings.relations ?? 'missing' });
  });
});

describe('renderDoctorBoard by mode', () => {
  it('prints Relationships: where labels mode prints Blocked issues: and Epic labels:', async () => {
    const native = renderDoctorBoard(await readDoctorBoard(fakeGh().run, ROOT, null, 'native'));
    const labels = renderDoctorBoard(await readDoctorBoard(fakeGh().run, ROOT, null, 'labels'));
    const heads = (lines: readonly string[]): readonly string[] => lines.filter((line) => !line.startsWith(' ') && line.endsWith(':'));

    expect(heads(native)).toEqual([BOARD_HEADING, RELATIONS_HEADING]);
    expect(heads(labels)).toEqual([BOARD_HEADING, BLOCKED_HEADING, EPICS_HEADING]);
  });
});
