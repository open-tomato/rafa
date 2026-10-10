/**
 * Tests for `rafa board sync` (`sync.ts`): the pure lines first, then the
 * command dispatched from a fresh project over the router of
 * `src/board/project/sync-fake.ts`, whose module note describes the
 * board: items for #10, #20, #21, #22 and #30 holding no value, and the
 * open #1 and #40 missing from the project. No case reaches GitHub.
 *
 * The drift case is the spec's definition of done read through the
 * dispatcher: a label edited outside rafa makes `--dry-run` print that
 * one change, a sync make it, and a second `--dry-run` print none. Its
 * control is the first dry run, over the same fake, which printed every
 * change of an empty project, so the empty one after is no printer that
 * prints nothing.
 *
 * The refused-issue cases plant a labels cursor that never moves on #21
 * (`SyncFakeOptions.repeatsCursor`). Their control is the sync over the
 * same board without it, which exits 0 with no `warn:` line and every
 * item filled, so the warning line and the unfilled #21 are the refusal's.
 * The same cursor planted on #40, an issue the sync adds, leaves it added
 * and not filled; that control's closing line counts both added issues as
 * filled, so the count apart is the refusal's too.
 *
 * The network-error cases plant one `HTTP 502` on the project fake: the
 * sync sends the call again, prints one `retrying` line (a `retry` event
 * in json mode) and syncs. Their control is the same failure under
 * `board.project.retries: false`, refused with exit code 2 and no line,
 * so the recovery is the retry's.
 *
 * The progress cases time the run by a clock that moves one second on
 * every read; every other case by one that never moves, so a phase prints
 * its start and end lines and nothing between. The throttle case's lines
 * between sit beside the same run at the default of 10 s, which prints
 * none, and beside `progressSeconds: false`, which drops them while the
 * start and end lines stay.
 *
 * The warning lines are imported once the static imports have loaded,
 * for the import cycle `src/board/project/sync.test.ts`'s module note
 * names.
 */
import type { BoardSyncResult } from './sync.js';
import type { SyncFake, SyncFakeOptions } from '../../board/project/sync-fake.js';
import type { PlantedProject } from '../../tests/cli-capture.js';

import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { createSyncFake, SYNC_OWNER, SYNC_PROJECT_NUMBER, syncAddCalls, syncWriteCalls } from '../../board/project/sync-fake.js';
import { dispatchInProject, eventsOf, plantProject } from '../../tests/cli-capture.js';

import {
  BOARD_SYNC_REFUSAL_EXIT,
  changeLine,
  closingLine,
  createBoardSyncCommand,
  syncLines,
} from './sync.js';

const { notFoundWarning, rateLimitWarning } = await import('../../board/project/refresh-warnings.js');

/** A temporary directory of this file's own. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-board-sync-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** The subject the command is dispatched under. */
const BOARD_SUBJECT = { name: 'board', summary: 'the boards' };

/** The config of a project mirrored to project 6. */
const PROJECT_CONFIG = `tracker:\n  default: local\nboard:\n  project:\n    number: ${String(SYNC_PROJECT_NUMBER)}\n`;

/** The project every result names. */
const PROJECT = { owner: SYNC_OWNER, number: SYNC_PROJECT_NUMBER };

/** A result with nothing in it, for the pure cases to spread over. */
const EMPTY: BoardSyncResult = {
  project: PROJECT,
  dryRun: false,
  changes: [],
  missing: [],
  added: [],
  filled: [],
  refused: [],
  written: 0,
  rateLimited: false,
  notUpdated: 0,
  warnings: [],
};

/** One change of #21's Stage. */
const STAGE_CHANGE = { issue: 21, field: 'stage', name: 'Stage', from: 'Ready', to: 'Claimed' } as const;

/** A fresh project, mirrored to project 6 unless `config` says otherwise. */
function plantCase(config = PROJECT_CONFIG): PlantedProject {
  return plantProject(mkdtempSync(join(tempBase, 'case-')), config);
}

/** A clock that never moves, so every phase reads `0s` and prints no line between its start and end. */
const STILL_CLOCK = (): number => 0;

/** The phase labels a progress line opens with. */
const PHASE_LABELS = ['adding issues: ', 'reading facts: ', 'writing fields: '];

/** The lines of `stdout` that are not progress lines. */
function syncOwnLines(stdout: string): readonly string[] {
  return stdout
    .trimEnd()
    .split('\n')
    .filter((line) => !PHASE_LABELS.some((label) => line.startsWith(label)));
}

/** Dispatches `board sync` and `words` from `project` over `fake`, timed by `now`. */
function run(fake: SyncFake, words: readonly string[] = [], project: PlantedProject = plantCase(), now: () => number = STILL_CLOCK) {
  const command = createBoardSyncCommand({ gh: fake.gh, sleep: () => Promise.resolve(), now });
  return dispatchInProject(['board', 'sync', ...words], [BOARD_SUBJECT], [command], project);
}

/** A fake over `options`, and the project a run of it dispatches from. */
function setUp(options: SyncFakeOptions = {}): { readonly fake: SyncFake; readonly project: PlantedProject } {
  return { fake: createSyncFake(options), project: plantCase() };
}

describe('changeLine, closingLine and syncLines', () => {
  it('prints a change as issue, field, from and to, an empty value spelled out', () => {
    expect(changeLine(STAGE_CHANGE)).toBe('#21 Stage: Ready → Claimed');
    expect(changeLine({ issue: 10, field: 'blockedBy', name: 'Blocked by', from: null, to: '#21' })).toBe('#10 Blocked by: (empty) → #21');
    expect(changeLine({ issue: 10, field: 'rank', name: 'Rank', from: '4', to: null })).toBe('#10 Rank: 4 → (empty)');
  });

  it('closes a dry run on its counts, or on in step when there is nothing to do', () => {
    expect(closingLine({ ...EMPTY, dryRun: true })).toBe('Dry run on project #6: in step, nothing to change.');
    expect(closingLine({ ...EMPTY, dryRun: true, changes: [STAGE_CHANGE], missing: [40] }))
      .toBe('Dry run on project #6: 1 change and 1 issue to add; nothing written.');
  });

  it('closes a sync on what it wrote and added, and a rate-limited one on how far it got', () => {
    expect(closingLine(EMPTY)).toBe('Synced project #6: in step, nothing to change.');
    expect(closingLine({ ...EMPTY, changes: [STAGE_CHANGE, STAGE_CHANGE], missing: [1, 40], added: [1, 40], filled: [1, 40], written: 2 }))
      .toBe('Synced project #6: 2 changes written, 2 issues added and filled.');
    expect(closingLine({ ...EMPTY, changes: [STAGE_CHANGE, STAGE_CHANGE], written: 1, rateLimited: true, notUpdated: 1 }))
      .toBe('Stopped on project #6: 1 of 2 changes written; the rate limit refused the rest.');
  });

  it('counts the issues refused, and never closes on in step while one was refused', () => {
    const refused = [{ issue: 21, reason: 'a reason' }];

    expect(closingLine({ ...EMPTY, refused })).toBe('Synced project #6: 0 changes written, 0 issues added and filled; 1 issue not refreshed.');
    expect(closingLine({ ...EMPTY, changes: [STAGE_CHANGE], added: [40], filled: [40], written: 1, refused: [...refused, { issue: 22, reason: 'b' }] }))
      .toBe('Synced project #6: 1 change written, 1 issue added and filled; 2 issues not refreshed.');
    expect(closingLine({ ...EMPTY, dryRun: true, refused }))
      .toBe('Dry run on project #6: 0 changes and 0 issues to add; 1 issue not refreshed; nothing written.');
  });

  it('prints the changes, then each issue to add or added, then the closing line', () => {
    expect(syncLines({ ...EMPTY, dryRun: true, changes: [STAGE_CHANGE], missing: [40] })).toEqual([
      '#21 Stage: Ready → Claimed',
      '#40 is not on the project: would be added',
      'Dry run on project #6: 1 change and 1 issue to add; nothing written.',
    ]);
    expect(syncLines({ ...EMPTY, changes: [STAGE_CHANGE], missing: [40], added: [40], filled: [40], written: 1 })).toEqual([
      '#21 Stage: Ready → Claimed',
      '#40 added to the project',
      'Synced project #6: 1 change written, 1 issue added and filled.',
    ]);
  });

  it('counts the issues filled apart from those added when some were not filled', () => {
    const added = { ...EMPTY, changes: [STAGE_CHANGE], missing: [1, 40], added: [1, 40], written: 1 };

    expect(closingLine({ ...added, filled: [1, 40] })).toBe('Synced project #6: 1 change written, 2 issues added and filled.');
    expect(closingLine({ ...added, filled: [1] })).toBe('Synced project #6: 1 change written, 2 issues added, 1 filled.');
    expect(closingLine({ ...added, filled: [] })).toBe('Synced project #6: 1 change written, 2 issues added, 0 filled.');
    expect(closingLine({ ...added, filled: [1], refused: [{ issue: 40, reason: 'a reason' }] }))
      .toBe('Synced project #6: 1 change written, 2 issues added, 1 filled; 1 issue not refreshed.');
  });

  it('counts the issues added on a stopped sync only when it had added any, and never the ones to add on a dry run as filled', () => {
    const stopped = { ...EMPTY, changes: [STAGE_CHANGE, STAGE_CHANGE], written: 1, rateLimited: true, notUpdated: 1 };

    expect(closingLine({ ...stopped, missing: [1, 40], added: [1, 40] }))
      .toBe('Stopped on project #6: 1 of 2 changes written, 2 issues added, 0 filled; the rate limit refused the rest.');
    expect(closingLine({ ...stopped, missing: [1, 40] }))
      .toBe('Stopped on project #6: 1 of 2 changes written; the rate limit refused the rest.');
    expect(closingLine({ ...EMPTY, dryRun: true, missing: [1, 40] })).toBe('Dry run on project #6: 0 changes and 2 issues to add; nothing written.');
  });
});

describe('rafa board sync', () => {
  it('prints every change and every issue it would add on --dry-run, and writes and adds nothing', async () => {
    const { fake, project } = setUp();

    const result = await run(fake, ['--dry-run'], project);
    const lines = syncOwnLines(result.stdout);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    expect(lines.slice(0, 3)).toEqual(['#10 Stage: (empty) → Blocked', '#10 Rank: (empty) → 1', '#10 Blocked by: (empty) → #21']);
    expect(lines.slice(-3)).toEqual([
      '#1 is not on the project: would be added',
      '#40 is not on the project: would be added',
      'Dry run on project #6: 12 changes and 2 issues to add; nothing written.',
    ]);
    expect(syncWriteCalls(fake.calls())).toEqual([]);
    expect(syncAddCalls(fake.calls())).toEqual([]);
  });

  it('prints the one change a label edited outside rafa makes, makes it, and then prints none', async () => {
    const { fake, project } = setUp();
    const first = await run(fake, ['--dry-run'], project);
    await run(fake, [], project);
    fake.setLabels(21, ['type:spec', 'epic:alpha', 'rafa:claimed']);

    const dry = await run(fake, ['--dry-run'], project);
    const synced = await run(fake, [], project);
    const again = await run(fake, ['--dry-run'], project);

    expect(first.stdout.split('\n').length).toBeGreaterThan(2);
    expect([dry.exitCode, synced.exitCode, again.exitCode]).toEqual([0, 0, 0]);
    expect(dry.stdout).toBe([
      'reading facts: 7',
      'reading facts: 7/7, 0 refused, 0s',
      '#21 Stage: Ready → Claimed',
      'Dry run on project #6: 1 change and 0 issues to add; nothing written.\n',
    ].join('\n'));
    expect(synced.stdout).toBe([
      'reading facts: 7',
      'reading facts: 7/7, 0 refused, 0s',
      'writing fields: 1',
      'writing fields: 1/1, 0 refused, 0s',
      '#21 Stage: Ready → Claimed',
      'Synced project #6: 1 change written, 0 issues added and filled.\n',
    ].join('\n'));
    expect(syncOwnLines(again.stdout)).toEqual(['Dry run on project #6: in step, nothing to change.']);
  });

  it('writes every change, adds the open issues the project lacks and fills them', async () => {
    const { fake, project } = setUp();

    const result = await run(fake, [], project);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).not.toContain('warn: ');
    expect(result.stdout).toContain('#1 added to the project\n#40 added to the project\n');
    expect(result.stdout).toEndWith('Synced project #6: 14 changes written, 2 issues added and filled.\n');
    expect((await fake.heldValues())[40]).toEqual({ Stage: 'Triage' });
    expect((await fake.heldValues())[21]).toEqual({ Stage: 'Ready', Rank: 3 });
  });

  it('exits 0 when the only failure is a refused issue, printing its warning line and syncing the rest', async () => {
    const { fake, project } = setUp({ repeatsCursor: [21] });

    const result = await run(fake, [], project);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('#1 added to the project\n#40 added to the project\n');
    expect(result.stdout).not.toContain('#21 Stage');
    expect(result.stdout).toContain('Synced project #6: 12 changes written, 2 issues added and filled; 1 issue not refreshed.\n'
      + 'warn: #21 not refreshed: issue #21.labels answered the cursor');
    const warnings = result.stdout
      .trimEnd()
      .split('\n')
      .filter((line) => line.startsWith('warn: '));
    expect(warnings).toHaveLength(1);
    expect((await fake.heldValues())[21]).toEqual({});
    expect((await fake.heldValues())[40]).toEqual({ Stage: 'Triage' });
  });

  it('gives a refused issue in the json result and its warning line, exiting 0', async () => {
    const { fake, project } = setUp({ repeatsCursor: [21] });

    const result = await run(fake, ['--output=json'], project);
    const ending = eventsOf(result.stdout).find((event) => event.type === 'result') as { data?: BoardSyncResult } | undefined;
    const refused = ending?.data?.refused ?? [];

    expect(result.exitCode).toBe(0);
    expect(refused.map(({ issue }) => issue)).toEqual([21]);
    expect(refused[0]?.reason).toContain('issue #21.labels answered the cursor');
    expect(ending?.data?.warnings).toEqual([`#21 not refreshed: ${refused[0]?.reason ?? ''}`]);
    expect(ending?.data?.added).toEqual([1, 40]);
    expect(ending?.data?.filled).toEqual([1, 40]);
  });

  it('counts an added issue whose facts were refused as added and not filled, naming it in both warning lines', async () => {
    const { fake, project } = setUp({ repeatsCursor: [40] });

    const result = await run(fake, [], project);
    const warnings = result.stdout
      .trimEnd()
      .split('\n')
      .filter((line) => line.startsWith('warn: '));

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('#1 added to the project\n#40 added to the project\n');
    expect(result.stdout).toContain('Synced project #6: 13 changes written, 2 issues added, 1 filled; 1 issue not refreshed.\n');
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toStartWith('warn: #40 not refreshed: issue #40.labels answered the cursor');
    expect(warnings[1]).toStartWith('warn: #40 added but not filled: issue #40.labels answered the cursor');
    expect((await fake.heldValues())[40]).toEqual({});
  });

  it('gives the issues added and those filled apart in the json result when one was not filled', async () => {
    const { fake, project } = setUp({ repeatsCursor: [40] });

    const result = await run(fake, ['--output=json'], project);
    const ending = eventsOf(result.stdout).find((event) => event.type === 'result') as { data?: BoardSyncResult } | undefined;

    expect(result.exitCode).toBe(0);
    expect(ending?.data?.added).toEqual([1, 40]);
    expect(ending?.data?.filled).toEqual([1]);
    expect(ending?.data?.warnings.at(-1)).toStartWith('#40 added but not filled: ');
  });

  it('gives the changes, the issues and the counts as the json result, without the write ids', async () => {
    const { fake, project } = setUp();
    await run(fake, [], project);
    fake.setLabels(21, ['type:spec', 'epic:alpha', 'rafa:claimed']);

    const result = await run(fake, ['--dry-run', '--output=json'], project);
    const ending = eventsOf(result.stdout).find((event) => event.type === 'result') as { data?: unknown } | undefined;

    expect(result.exitCode).toBe(0);
    expect(ending?.data).toEqual({ ...EMPTY, dryRun: true, changes: [STAGE_CHANGE] });
  });

  it('refuses with exit code 1, sending nothing, when board.project.number is unset', async () => {
    const { fake } = setUp();

    const result = await run(fake, [], plantCase('tracker:\n  default: local\n'));

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('board.project.number is not set');
    expect(result.stderr).toContain('rafa init --board --project');
    expect(fake.calls()).toEqual([]);
  });

  it('refuses a stray word with exit code 1, sending nothing', async () => {
    const { fake, project } = setUp();

    const result = await run(fake, ['6'], project);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Usage: rafa board sync [--dry-run]');
    expect(fake.calls()).toEqual([]);
  });

  it('refuses with exit code 2 and the not-found line when the number names no project', async () => {
    const { fake, project } = setUp({ values: null });

    const result = await run(fake, [], project);

    expect(result.exitCode).toBe(BOARD_SYNC_REFUSAL_EXIT);
    expect(result.stderr).toBe(`❌ ${notFoundWarning(PROJECT)}\n`);
    expect(result.stdout).toBe('');
  });

  it('prints what it got to, then refuses with exit code 2 and the rate-limit line, when the rate limit stopped the writes', async () => {
    const { fake, project } = setUp({ rateLimitAfter: 0 });

    const result = await run(fake, [], project);

    expect(result.exitCode).toBe(BOARD_SYNC_REFUSAL_EXIT);
    expect(result.stdout).toEndWith('Stopped on project #6: 0 of 12 changes written; the rate limit refused the rest.\n');
    expect(result.stdout).not.toContain('warn:');
    expect(result.stderr).toBe(`❌ ${rateLimitWarning(5)}\n`);
    expect(syncAddCalls(fake.calls())).toEqual([]);
  });

  it('refuses with exit code 2 naming the failure when gh cannot be read, retrying nothing GitHub refused on purpose', async () => {
    const { fake, project } = setUp();
    fake.project.failNext('gh: HTTP 401: Bad credentials\n');

    const result = await run(fake, [], project);

    expect(result.exitCode).toBe(BOARD_SYNC_REFUSAL_EXIT);
    expect(result.stderr).toStartWith('❌ Could not sync the project: ');
    expect(result.stderr).toContain('HTTP 401');
    expect(result.stdout).not.toContain('retrying ');
  });
});

describe('rafa board sync: a call failing on a network error', () => {
  /** The failure every case plants: a gateway error, in the retried class. */
  const GATEWAY = 'gh: HTTP 502: Bad gateway\n';

  /** The retry line the planted failure prints, past its subject. */
  const RETRY_LINE = /^retrying \S+ \(1 of 3\): HTTP 502$/mu;

  it('sends the call again, prints one retrying line and syncs as a run with no failure does', async () => {
    const { fake, project } = setUp();
    fake.project.failNext(GATEWAY);

    const result = await run(fake, [], project);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(RETRY_LINE);
    expect(result.stdout.match(/^retrying /gmu)).toHaveLength(1);
    expect(result.stdout).toEndWith('Synced project #6: 14 changes written, 2 issues added and filled.\n');
  });

  it('control: with board.project.retries false the same failure is refused with exit code 2 and no retrying line', async () => {
    const { fake } = setUp();
    const project = plantCase(`${PROJECT_CONFIG}    retries: false\n`);
    fake.project.failNext(GATEWAY);

    const result = await run(fake, [], project);

    expect(result.exitCode).toBe(BOARD_SYNC_REFUSAL_EXIT);
    expect(result.stderr).toContain('HTTP 502');
    expect(result.stdout).not.toContain('retrying ');
  });

  it('writes the retry as one retry event in json mode, and no retrying line', async () => {
    const { fake, project } = setUp();
    fake.project.failNext(GATEWAY);

    const result = await run(fake, ['--output=json'], project);
    const retries = eventsOf(result.stdout).filter((event) => event.type === 'event' && event.name === 'retry');

    expect(result.exitCode).toBe(0);
    expect(retries).toHaveLength(1);
    expect(retries[0]).toMatchObject({ summary: expect.stringMatching(RETRY_LINE), data: { attempt: 1, of: 3, reason: 'HTTP 502', waitMs: 2000 } });
    expect(result.stdout).not.toContain('"message":"retrying ');
  });
});

describe('rafa board sync: the progress of its phases', () => {
  /** A clock moving one second forward on every read. */
  function steppingClock(): () => number {
    let at = 0;
    return () => {
      at += 1000;
      return at;
    };
  }

  /** The start and end lines of a full sync of the fake board, every phase timed by the stepping clock. */
  const START_AND_END_LINES = [
    'reading facts: 5',
    'reading facts: 5/5, 0 refused, 2s',
    'writing fields: 12',
    'writing fields: 12/12, 0 refused, 2s',
    'adding issues: 2',
    'adding issues: 2/2, 0 refused, 3s',
    'reading facts: 2',
    'reading facts: 2/2, 0 refused, 2s',
    'writing fields: 2',
    'writing fields: 2/2, 0 refused, 2s',
  ];

  /** The lines of `stdout` that are progress lines, in order. */
  function progressLines(stdout: string): readonly string[] {
    return stdout
      .trimEnd()
      .split('\n')
      .filter((line) => PHASE_LABELS.some((label) => line.startsWith(label)));
  }

  it('prints each phase\'s start and end lines as plain lines ahead of the sync\'s own, at the default throttle', async () => {
    const { fake, project } = setUp();

    const result = await run(fake, [], project, steppingClock());

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).not.toContain('warn: ');
    expect(result.stdout).toStartWith(`${START_AND_END_LINES.join('\n')}\n#10 Stage: (empty) → Blocked\n`);
    expect(result.stdout).toEndWith('Synced project #6: 14 changes written, 2 issues added and filled.\n');
  });

  it('prints a line between start and end on each advance once board.project.progressSeconds have passed', async () => {
    const { fake } = setUp();
    const project = plantCase(`${PROJECT_CONFIG}    progressSeconds: 1\n`);

    const result = await run(fake, [], project, steppingClock());

    expect(result.exitCode).toBe(0);
    expect(progressLines(result.stdout)).toEqual([
      'reading facts: 5',
      'reading facts: 5/5, 1s',
      'reading facts: 5/5, 0 refused, 2s',
      'writing fields: 12',
      'writing fields: 12/12, 1s',
      'writing fields: 12/12, 0 refused, 2s',
      'adding issues: 2',
      'adding issues: 1/2, 1s',
      'adding issues: 2/2, 2s',
      'adding issues: 2/2, 0 refused, 3s',
      'reading facts: 2',
      'reading facts: 2/2, 1s',
      'reading facts: 2/2, 0 refused, 2s',
      'writing fields: 2',
      'writing fields: 2/2, 1s',
      'writing fields: 2/2, 0 refused, 2s',
    ]);
  });

  // With `false` an advance reads no clock, so the stepping clock moves once per phase and each end reads 1s.
  it('control: with board.project.progressSeconds false the lines between drop, and the start and end lines stay', async () => {
    const { fake } = setUp();
    const project = plantCase(`${PROJECT_CONFIG}    progressSeconds: false\n`);

    const result = await run(fake, [], project, steppingClock());

    expect(result.exitCode).toBe(0);
    expect(progressLines(result.stdout)).toEqual([
      'reading facts: 5',
      'reading facts: 5/5, 0 refused, 1s',
      'writing fields: 12',
      'writing fields: 12/12, 0 refused, 1s',
      'adding issues: 2',
      'adding issues: 2/2, 0 refused, 1s',
      'reading facts: 2',
      'reading facts: 2/2, 0 refused, 1s',
      'writing fields: 2',
      'writing fields: 2/2, 0 refused, 1s',
    ]);
  });

  it('writes each line as one progress event in json mode, ahead of the result, and prints no progress line', async () => {
    const { fake, project } = setUp();

    const result = await run(fake, ['--output=json'], project, steppingClock());
    const events = eventsOf(result.stdout);
    const progress = events.filter((event) => event.type === 'event' && event.name === 'progress');

    expect(result.exitCode).toBe(0);
    expect(progress.map((event) => (event as { summary?: string }).summary)).toEqual(START_AND_END_LINES);
    expect(progress.map((event) => (event as { data?: unknown }).data)).toEqual([
      { phase: 'facts', step: 'start', done: 0, total: 5, elapsedMs: 0 },
      { phase: 'facts', step: 'end', done: 5, total: 5, elapsedMs: 2000, refused: 0 },
      { phase: 'writes', step: 'start', done: 0, total: 12, elapsedMs: 0 },
      { phase: 'writes', step: 'end', done: 12, total: 12, elapsedMs: 2000, refused: 0 },
      { phase: 'adds', step: 'start', done: 0, total: 2, elapsedMs: 0 },
      { phase: 'adds', step: 'end', done: 2, total: 2, elapsedMs: 3000, refused: 0 },
      { phase: 'facts', step: 'start', done: 0, total: 2, elapsedMs: 0 },
      { phase: 'facts', step: 'end', done: 2, total: 2, elapsedMs: 2000, refused: 0 },
      { phase: 'writes', step: 'start', done: 0, total: 2, elapsedMs: 0 },
      { phase: 'writes', step: 'end', done: 2, total: 2, elapsedMs: 2000, refused: 0 },
    ]);
    expect(events.at(-1)?.type).toBe('result');
    expect(result.stdout).not.toContain('"message":"reading facts');
  });
});
