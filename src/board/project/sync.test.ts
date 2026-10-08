/**
 * Tests for the sync (`sync.ts`, `syncProject`), each sent through the
 * router of `sync-fake.ts`, whose module note describes the board: items
 * for #10, #20, #21, #22 and #30, and the open #1 and #40 missing from
 * the project. No case reaches GitHub.
 *
 * ## The controls
 *
 *  - The dry run's empty write and add logs are read beside the same
 *    sync without `dryRun`, which writes and adds over the same fake.
 *  - The second dry run that finds nothing follows a first that found
 *    every change, over the one fake the sync between them wrote.
 *  - The rate-limited sync that adds nothing is read beside the sync
 *    that adds both missing issues.
 *  - Each sync refusing one issue is read beside the sync over the same
 *    board with no cursor that repeats, which refuses none and fills
 *    every item, so a sync answering no refusal at all would fail it.
 *
 * ## Why the warning lines are imported late
 *
 * `./refresh-warnings.ts` is imported once the static imports have
 * loaded, never first. When this file was written, a file that loaded
 * `./port.ts` before `./gh.ts` met the import cycle `./port.ts` →
 * `./rules.ts` → `../epic-context.ts` → … → `./refresh.ts` → `./gh.ts`
 * → `./port.ts`, and `./gh.ts` read `PROJECT_PAGE_SIZE` before
 * `./port.ts` set it (`ReferenceError: Cannot access 'PROJECT_PAGE_SIZE'
 * before initialization`), so six test files of this directory failed
 * run alone. The Stage and Horizon option lists have since moved to the
 * leaf `./options.ts`, which closes the port's edge of that cycle;
 * `./options.test.ts` loads `./rules.ts` and `./port.ts` each first and
 * alone. The late import is kept, as it costs nothing.
 */
import type { RefreshConfig, RefreshOptions } from './refresh.js';
import type { SyncFake } from './sync-fake.js';

import { describe, expect, it } from 'bun:test';

import {
  createSyncFake,
  SYNC_EXPECTED,
  SYNC_OWNER,
  SYNC_PROJECT_NUMBER,
  syncAddCalls,
  syncWriteCalls,
} from './sync-fake.js';
import { syncProject } from './sync.js';

const { notFoundWarning, notRefreshedWarning, rateLimitWarning, scopeWarning } = await import('./refresh-warnings.js');

/** The config every case reads. */
const CONFIG: RefreshConfig = {
  boardProjectNumber: SYNC_PROJECT_NUMBER,
  boardProjectWriteBatchSize: 5,
  boardProjectWritePauseMs: 0,
  boardRelationships: 'labels',
  roadmapIssue: null,
  releaseFragments: '.changes',
};

/** The project every case names. */
const PROJECT = { owner: SYNC_OWNER, number: SYNC_PROJECT_NUMBER };

/** What the board #1 and #40 hold once added and filled: #1 is on no line, #40 asks for triage. */
const ADDED_VALUES = { 1: { Stage: 'Backlog' }, 40: { Stage: 'Triage' } };

/** The options of a sync over `fake`, pausing for no time. */
function options(fake: SyncFake, dryRun = false): RefreshOptions {
  return { config: CONFIG, gh: fake.gh, sleep: () => Promise.resolve(), dryRun };
}

/** The issues `changes` name, each once, in order. */
function issuesOf(changes: readonly { readonly issue: number }[]): readonly number[] {
  return [...new Set(changes.map(({ issue }) => issue))];
}

describe('syncProject', () => {
  it('answers every change and every missing open issue on a dry run, and writes and adds nothing', async () => {
    const fake = createSyncFake();

    const synced = await syncProject(options(fake, true));

    expect(synced.kind).toBe('synced');
    if (synced.kind !== 'synced') return;
    expect(synced.dryRun).toBe(true);
    expect(issuesOf(synced.changes)).toEqual([10, 20, 21, 22, 30]);
    expect(synced.changes).toHaveLength(Object.values(SYNC_EXPECTED).flatMap((values) => Object.keys(values)).length);
    expect(synced.missing).toEqual([1, 40]);
    expect(synced.added).toEqual([]);
    expect(synced.writes.written).toBe(0);
    expect(syncWriteCalls(fake.calls())).toEqual([]);
    expect(syncAddCalls(fake.calls())).toEqual([]);
    expect(await fake.heldValues()).toEqual({ 10: {}, 20: {}, 21: {}, 22: {}, 30: {} });
  });

  it('writes every change, then adds the missing open issues and fills them, the control of the case above', async () => {
    const fake = createSyncFake();

    const synced = await syncProject(options(fake));

    expect(synced.kind).toBe('synced');
    if (synced.kind !== 'synced') return;
    expect(synced.dryRun).toBe(false);
    expect(synced.missing).toEqual([1, 40]);
    expect(synced.added).toEqual([1, 40]);
    expect(issuesOf(synced.changes)).toEqual([10, 20, 21, 22, 30, 1, 40]);
    expect(synced.writes.written).toBe(synced.changes.length);
    expect(syncAddCalls(fake.calls())).toHaveLength(2);
    expect(synced.refused).toEqual([]);
    expect(synced.warnings).toEqual([]);
    expect(await fake.heldValues()).toEqual({ ...SYNC_EXPECTED, ...ADDED_VALUES });
  });

  it('refuses alone an issue on the project whose facts cannot be read, writing the others and adding the missing ones', async () => {
    const fake = createSyncFake({ repeatsCursor: [21] });

    const synced = await syncProject(options(fake));

    expect(synced.kind).toBe('synced');
    if (synced.kind !== 'synced') return;
    expect(synced.refused.map(({ number }) => number)).toEqual([21]);
    expect(synced.refused[0]?.reason).toContain('issue #21.labels answered the cursor');
    expect(synced.warnings).toEqual(synced.refused.map(notRefreshedWarning));
    expect(synced.warnings[0]).toStartWith('#21 not refreshed: ');
    expect(issuesOf(synced.changes)).toEqual([10, 20, 22, 30, 1, 40]);
    expect(synced.added).toEqual([1, 40]);
    expect(synced.writes).toMatchObject({ written: synced.changes.length, rateLimited: false });
    expect(await fake.heldValues()).toEqual({ ...SYNC_EXPECTED, 21: {}, ...ADDED_VALUES });
  });

  it('answers an added issue refused in the second pass, on the project with no value filled', async () => {
    const fake = createSyncFake({ repeatsCursor: [40] });

    const synced = await syncProject(options(fake));

    expect(synced.kind).toBe('synced');
    if (synced.kind !== 'synced') return;
    expect(synced.added).toEqual([1, 40]);
    expect(synced.refused.map(({ number }) => number)).toEqual([40]);
    expect(synced.warnings).toEqual(synced.refused.map(notRefreshedWarning));
    expect(await fake.heldValues()).toEqual({ ...SYNC_EXPECTED, 1: ADDED_VALUES[1], 40: {} });
  });

  it('finds nothing on a dry run after a sync, the first dry run having found every change', async () => {
    const fake = createSyncFake();
    const before = await syncProject(options(fake, true));
    await syncProject(options(fake));

    const after = await syncProject(options(fake, true));

    expect(before.kind === 'synced' && before.changes.length > 0).toBe(true);
    expect(after).toMatchObject({ kind: 'synced', changes: [], missing: [], added: [] });
  });

  it('finds the one change a label edited outside rafa makes, makes it, and then finds none', async () => {
    const fake = createSyncFake();
    await syncProject(options(fake));
    fake.setLabels(21, ['type:spec', 'epic:alpha', 'rafa:claimed']);

    const dry = await syncProject(options(fake, true));
    const synced = await syncProject(options(fake));
    const again = await syncProject(options(fake, true));

    expect(dry).toMatchObject({ kind: 'synced', changes: [{ issue: 21, field: 'stage', name: 'Stage', from: 'Ready', to: 'Claimed' }], missing: [] });
    expect(dry.kind === 'synced' && dry.changes).toHaveLength(1);
    expect(synced).toMatchObject({ kind: 'synced', writes: { written: 1 } });
    expect(again).toMatchObject({ kind: 'synced', changes: [] });
    expect((await fake.heldValues())[21]).toEqual({ Stage: 'Claimed', Rank: 3 });
  });

  it('adds nothing when the rate limit stopped the writes, answering the line counting the issues not updated', async () => {
    const fake = createSyncFake({ rateLimitAfter: 0 });

    const synced = await syncProject(options(fake));

    expect(synced.kind).toBe('synced');
    if (synced.kind !== 'synced') return;
    expect(synced.writes.rateLimited).toBe(true);
    expect(synced.writes.notUpdated).toBe(5);
    expect(synced.missing).toEqual([1, 40]);
    expect(synced.added).toEqual([]);
    expect(syncAddCalls(fake.calls())).toEqual([]);
    expect(synced.warnings).toEqual([rateLimitWarning(5)]);
  });

  it('answers not-found, adding nothing, when the owner holds no project of the number', async () => {
    const fake = createSyncFake({ values: null });

    expect(await syncProject(options(fake))).toEqual({ kind: 'not-found', project: PROJECT, warnings: [notFoundWarning(PROJECT)] });
    expect(syncAddCalls(fake.calls())).toEqual([]);
  });

  it('answers refused with the scope line when the find is refused for the project scope', async () => {
    const fake = createSyncFake();
    // GitHub's documented refusal, NOT a reading, as refresh.test.ts records.
    fake.project.failNext('gh: Your token has not been granted the required scopes to execute this query.'
      + ' The \'projectV2\' field requires one of the following scopes: [\'read:project\'], but your token has only'
      + ' been granted the: [\'repo\'] scopes.\n');

    expect(await syncProject(options(fake))).toEqual({ kind: 'refused', reason: 'scope', project: PROJECT, warnings: [scopeWarning()] });
  });

  it('answers skipped, sending no call, with board.project.number unset', async () => {
    const fake = createSyncFake();

    expect(await syncProject({ ...options(fake), config: { ...CONFIG, boardProjectNumber: null } }))
      .toEqual({ kind: 'skipped', reason: 'no-project', warnings: [] });
    expect(fake.calls()).toEqual([]);
  });
});
