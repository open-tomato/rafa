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
 *  - The sync over a listing that never shows #1 and #40 (`omittingItems`)
 *    is read beside a plain refresh of those two issues over the same
 *    listing, once the sync added them: it answers both as missing, so
 *    the listing does hide them and only the items the adds answered
 *    could have filled them.
 *  - Each sync naming an added issue as not filled is read beside the
 *    sync that fills both, which answers no such line.
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
import type { FakeProjectGhOptions } from './project-fake.js';
import type { RefreshConfig, RefreshOptions } from './refresh.js';
import type { SyncFake } from './sync-fake.js';
import type { GhRunner } from '../../adapters/tracker/github.js';

import { describe, expect, it } from 'bun:test';

import { recordingFeed } from './progress-fake.js';
import { refreshProjectItems } from './refresh.js';
import {
  createSyncFake,
  SYNC_EXPECTED,
  SYNC_OWNER,
  SYNC_PROJECT_NUMBER,
  syncAddCalls,
  syncWriteCalls,
} from './sync-fake.js';
import { syncProject } from './sync.js';

const {
  addedNotFilledWarning,
  notFoundWarning,
  notRefreshedWarning,
  rateLimitWarning,
  scopeWarning,
} = await import('./refresh-warnings.js');

/** The config every case reads. */
const CONFIG: RefreshConfig = {
  boardProjectNumber: SYNC_PROJECT_NUMBER,
  boardProjectRetries: false,
  boardProjectRetryWaitSeconds: 1,
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

/** The write requests of the first pass: one per `boardProjectWriteBatchSize` values the rules fill on the five items. */
const FIRST_PASS_REQUESTS: NonNullable<FakeProjectGhOptions['rateLimitAfter']> = Math.ceil(
  Object.values(SYNC_EXPECTED).flatMap((values) => Object.keys(values)).length / CONFIG.boardProjectWriteBatchSize,
);

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
    expect(synced.filled).toEqual([]);
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
    expect(synced.filled).toEqual([1, 40]);
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
    expect(synced.filled).toEqual([1, 40]);
    expect(synced.writes).toMatchObject({ written: synced.changes.length, rateLimited: false });
    expect(await fake.heldValues()).toEqual({ ...SYNC_EXPECTED, 21: {}, ...ADDED_VALUES });
  });

  it('answers an added issue refused in the second pass as added and not filled, its line after the refusal\'s own', async () => {
    const fake = createSyncFake({ repeatsCursor: [40] });

    const synced = await syncProject(options(fake));

    expect(synced.kind).toBe('synced');
    if (synced.kind !== 'synced') return;
    expect(synced.added).toEqual([1, 40]);
    expect(synced.filled).toEqual([1]);
    expect(synced.refused.map(({ number }) => number)).toEqual([40]);
    expect(synced.warnings).toEqual([...synced.refused.map(notRefreshedWarning), ...synced.refused.map(addedNotFilledWarning)]);
    expect(synced.warnings[1]).toStartWith('#40 added but not filled: issue #40.labels answered the cursor');
    expect(await fake.heldValues()).toEqual({ ...SYNC_EXPECTED, 1: ADDED_VALUES[1], 40: {} });
  });

  it('names no added issue as not filled when the refused issue was on the project already', async () => {
    const fake = createSyncFake({ repeatsCursor: [21] });

    const synced = await syncProject(options(fake));

    expect(synced.kind === 'synced' && synced.warnings.filter((line) => line.includes('added but not filled'))).toEqual([]);
  });

  it('answers both added issues as not filled when the rate limit refuses the second pass\'s writes', async () => {
    const fake = createSyncFake({ rateLimitAfter: FIRST_PASS_REQUESTS });

    const synced = await syncProject(options(fake));

    expect(synced.kind).toBe('synced');
    if (synced.kind !== 'synced') return;
    expect(synced.added).toEqual([1, 40]);
    expect(synced.filled).toEqual([]);
    expect(synced.writes.rateLimited).toBe(true);
    expect(synced.warnings).toEqual([
      rateLimitWarning(2),
      '#1 added but not filled: GitHub\'s rate limit refused its writes',
      '#40 added but not filled: GitHub\'s rate limit refused its writes',
    ]);
    expect(await fake.heldValues()).toEqual({ ...SYNC_EXPECTED, 1: {}, 40: {} });
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

describe('syncProject: over an item listing that does not show the issues just added', () => {
  /** The items read's answer, as far as a case filters it. */
  interface ItemsAnswer {
    readonly data: { readonly node: { readonly items: { readonly nodes: readonly { readonly content: { readonly number?: number } | null }[] } } };
  }

  /** `gh`, answering every items read without the items of `omitted`, as `./refresh.test.ts` holds the lag. */
  function omittingItems(gh: GhRunner, omitted: readonly number[]): GhRunner {
    return async (args) => {
      const result = await gh(args);
      if (!result.ok || !args.some((arg) => arg.includes('node(id: $project)'))) return result;
      const { items: page } = (JSON.parse(result.stdout) as ItemsAnswer).data.node;
      const nodes = page.nodes.filter(({ content }) => !omitted.includes(content?.number ?? 0));
      return { ...result, stdout: JSON.stringify({ data: { node: { items: { ...page, nodes } } } }) };
    };
  }

  /** The options of a sync over `fake` whose listing never shows #1 or #40. */
  function lagging(fake: SyncFake): RefreshOptions {
    return { ...options(fake), gh: omittingItems(fake.gh, [1, 40]) };
  }

  it('fills both added issues through the item each add answered', async () => {
    const fake = createSyncFake();

    const synced = await syncProject(lagging(fake));

    expect(synced.kind).toBe('synced');
    if (synced.kind !== 'synced') return;
    expect(synced.added).toEqual([1, 40]);
    expect(synced.filled).toEqual([1, 40]);
    expect(issuesOf(synced.changes)).toEqual([10, 20, 21, 22, 30, 1, 40]);
    expect(synced.warnings).toEqual([]);
    expect(await fake.heldValues()).toEqual({ ...SYNC_EXPECTED, ...ADDED_VALUES });
  });

  it('hides the added issues from a refresh handed no known item, the control of the case above', async () => {
    const fake = createSyncFake();
    await syncProject(lagging(fake));

    const refresh = await refreshProjectItems(lagging(fake), [1, 40]);

    expect(refresh).toMatchObject({ kind: 'refreshed', missing: [1, 40], changes: [] });
  });

  it('names the added issue whose facts are refused, and fills the other', async () => {
    const fake = createSyncFake({ repeatsCursor: [40] });

    const synced = await syncProject(lagging(fake));

    expect(synced.kind).toBe('synced');
    if (synced.kind !== 'synced') return;
    expect(synced.filled).toEqual([1]);
    expect(synced.warnings.at(-1)).toStartWith('#40 added but not filled: ');
    expect(await fake.heldValues()).toEqual({ ...SYNC_EXPECTED, 1: ADDED_VALUES[1], 40: {} });
  });

  it('names the same added issue in the warning over the project fake\'s own lag, the control above over a hand-rolled one', async () => {
    const fake = createSyncFake({ repeatsCursor: [40] });
    fake.project.lagItems();

    const synced = await syncProject(options(fake));

    expect(synced.kind).toBe('synced');
    if (synced.kind !== 'synced') return;
    expect(synced.added).toEqual([1, 40]);
    expect(synced.filled).toEqual([1]);
    expect(synced.warnings.at(-1)).toStartWith('#40 added but not filled: ');
    fake.project.showItems();
    expect(await fake.heldValues()).toEqual({ ...SYNC_EXPECTED, 1: ADDED_VALUES[1], 40: {} });
  });
});

describe('syncProject: the phases each pass feeds', () => {
  /** The values the first pass writes: one per field the rules fill on the five items. */
  const FIRST_WRITES = Object.values(SYNC_EXPECTED).flatMap((values) => Object.keys(values)).length;

  /** The start and end lines of `steps`, the progress lines left out. */
  function bounds(steps: readonly string[]): readonly string[] {
    return steps.filter((step) => step.includes(' start ') || step.includes(' end '));
  }

  it('reads and writes the five items, adds the two missing issues one at a time, then reads and writes those two', async () => {
    const fake = createSyncFake();
    const recording = recordingFeed();

    await syncProject({ ...options(fake), progress: recording.feed });

    expect(bounds(recording.steps())).toEqual([
      'facts start 0/5',
      'facts end 5/5 0 refused',
      `writes start 0/${String(FIRST_WRITES)}`,
      `writes end ${String(FIRST_WRITES)}/${String(FIRST_WRITES)} 0 refused`,
      'adds start 0/2',
      'adds end 2/2 0 refused',
      'facts start 0/2',
      'facts end 2/2 0 refused',
      'writes start 0/2',
      'writes end 2/2 0 refused',
    ]);
    expect(recording.steps().filter((step) => step.startsWith('adds '))).toEqual([
      'adds start 0/2',
      'adds progress 1/2',
      'adds progress 2/2',
      'adds end 2/2 0 refused',
    ]);
  });

  it('ends the adds counting the one added and the one a refused add left, before the rejection goes on', async () => {
    const fake = createSyncFake();
    let adds = 0;
    const gh: GhRunner = (args) => {
      if (args.some((arg) => arg.includes('addProjectV2ItemById('))) {
        adds += 1;
        if (adds === 2) return Promise.resolve({ ok: false, stdout: '', stderr: 'gh: Something went wrong while executing your query.\n' });
      }
      return fake.gh(args);
    };
    const recording = recordingFeed();

    await expect(syncProject({ ...options(fake), gh, progress: recording.feed })).rejects.toThrow();

    expect(recording.steps().filter((step) => step.startsWith('adds '))).toEqual([
      'adds start 0/2',
      'adds progress 1/2',
      'adds end 1/2 1 refused',
    ]);
  });

  it('opens no adds phase on a dry run, the facts read still fed', async () => {
    const fake = createSyncFake();
    const recording = recordingFeed();

    await syncProject({ ...options(fake, true), progress: recording.feed });

    expect(bounds(recording.steps())).toEqual(['facts start 0/5', 'facts end 5/5 0 refused']);
  });
});
