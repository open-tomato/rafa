/**
 * Tests for the `home` step `rafa next --roadmap` puts once a loop has
 * run while a hop is away: {@link homeAfterLoop} (`./hop-rows.ts`) over
 * a planted walk, and {@link readHomeAfterLoop} (`./state.ts`) over
 * sources whose board answers it.
 *
 * `./hop-rows.test.ts` holds the rows the table reads; these two are
 * read by the chain instead, off the base branch, so they sit apart.
 * Nothing here spawns `git` or `gh`: the board answers a planted walk,
 * and the git runner and the provider throw when asked, which is what
 * proves the reading takes neither.
 *
 * ## The controls
 *
 *  - Each closing is read beside the walk that differs from it in the
 *    one fact it keys on: C closed, C's pull request open, neither.
 *  - A record that is not away, a record dropped as stale (carried as
 *    `stale`, not `record`), and a walk with no `hop` key all answer
 *    null, so a reading that went home for any record at all fails.
 *  - Sources with no `roadmap` answer null without walking the board,
 *    counted.
 */
import type { HopRecord } from './hop-record.js';
import type { HopTarget, NextHopReading, NextRoadmapReading, NextSources } from './readings.js';
import type { PullRequests } from '../pr/index.js';

import { describe, expect, it } from 'bun:test';

import { plansDirAt } from '../commands/plan/plan-files.js';

import { homeAfterLoop } from './hop-rows.js';
import { readHomeAfterLoop } from './state.js';

/** Home: board #10 with no epic chosen. */
const HOME = Object.freeze({ board: 10, epic: null });

/** H, C, C's epic and board, and C's pull request. */
const H = 210;
const C = 118;
const AWAY_EPIC = 40;
const AWAY_BOARD = 11;
const PR = 57;

/** A blocker hop's record, away unless `over` says otherwise. */
function record(over: Partial<HopRecord> = {}): HopRecord {
  return {
    kind: 'blocker',
    home: HOME,
    from: { board: 10, epic: 20 },
    blocked: H,
    target: C,
    targetEpic: AWAY_EPIC,
    targetBoard: AWAY_BOARD,
    state: 'away',
    pullRequest: null,
    startedAt: '2026-09-28T10:00:00Z',
    ...over,
  };
}

/** A hop reading following `followed`, with C read as `target`. */
function hopReading(followed: HopRecord | null, target: HopTarget | null, over: Partial<NextHopReading> = {}): NextHopReading {
  return {
    record: followed,
    stale: null,
    position: { current: { board: AWAY_BOARD, epic: AWAY_EPIC }, previous: HOME, home: HOME },
    target,
    waiting: [],
    decision: null,
    nextEpic: null,
    ...over,
  };
}

/** A walk carrying `hop`, with one problem to carry through. */
function walk(hop: NextHopReading | undefined): NextRoadmapReading {
  return {
    roadmap: 10,
    line: null,
    passed: 0,
    problems: ['the branch scan said something'],
    ...hop === undefined
      ? {}
      : { hop },
  };
}

/** C open with no pull request. */
const C_OPEN: HopTarget = Object.freeze({ issue: C, closed: false, pullRequest: null });

describe('homeAfterLoop', () => {
  it('closes a blocker hop waiting, with C pull request, when the loop opened one', () => {
    const answer = homeAfterLoop(walk(hopReading(record(), { issue: C, closed: false, pullRequest: PR })));

    expect(answer).toEqual({
      id: 'away-ended',
      action: 'home',
      reading: `#${String(C)}, the hop's target in epic #${String(AWAY_EPIC)}, has pull request #${String(PR)} open`,
      proposal: 'go back home to board #10',
      issue: C,
      pullRequest: PR,
      hop: { action: 'home', home: HOME, closing: 'waiting', pullRequest: PR },
    });
  });

  it('closes it merged when C is closed, and halted when the loop left C open with no pull request', () => {
    const closed = homeAfterLoop(walk(hopReading(record(), { issue: C, closed: true, pullRequest: null })));
    const open = homeAfterLoop(walk(hopReading(record(), C_OPEN)));
    const unread = homeAfterLoop(walk(hopReading(record(), null)));

    expect(closed?.hop).toEqual({ action: 'home', home: HOME, closing: 'merged', pullRequest: null });
    expect(closed?.reading).toBe(`#${String(C)}, the hop's target in epic #${String(AWAY_EPIC)}, is closed`);
    expect(open?.hop).toEqual({ action: 'home', home: HOME, closing: 'halted', pullRequest: null });
    expect(open?.reading).toBe(`#${String(C)}, the hop's target in epic #${String(AWAY_EPIC)}, has no pull request open after the loop`);
    expect(unread?.hop).toEqual(open?.hop);
    expect(Object.keys(open ?? {})).not.toContain('pullRequest');
  });

  it('closes a dry hop halted, naming the epic it went to', () => {
    const dry = record({ kind: 'dry', blocked: null, target: null, targetEpic: 30, targetBoard: 10 });
    const answer = homeAfterLoop(walk(hopReading(dry, null)));

    expect(answer?.reading).toBe('the loop has run in epic #30, where the dry hop went');
    expect(answer?.hop).toEqual({ action: 'home', home: HOME, closing: 'halted', pullRequest: null });
    expect(Object.keys(answer ?? {})).not.toContain('issue');
  });

  it('answers null for a record that is not away, a stale one, none, and a walk with no hop key', () => {
    const answers = [
      homeAfterLoop(walk(hopReading(record({ state: 'waiting', pullRequest: PR }), null))),
      homeAfterLoop(walk(hopReading(null, null, { stale: record() }))),
      homeAfterLoop(walk(hopReading(null, null))),
      homeAfterLoop(walk(undefined)),
    ];

    expect(answers).toEqual([null, null, null, null]);
  });
});

/** Sources whose board answers `reading`, counting its walks; git and the provider throw when asked. */
function sourcesOver(reading: NextRoadmapReading, roadmap: boolean): { readonly sources: NextSources; readonly walks: () => number } {
  let walks = 0;
  const refuse = (what: string) => (): never => {
    throw new Error(`${what} was asked`);
  };
  const sources: NextSources = {
    base: 'main',
    plans: plansDirAt('/nowhere', '.rafa/plans'),
    runs: () => [],
    git: refuse('git'),
    pulls: new Proxy({}, { get: (_target, key) => refuse(`the provider's ${String(key)}`) }) as PullRequests,
    board: {
      next: () => {
        walks += 1;
        return Promise.resolve(reading);
      },
      blocking: refuse('blocking'),
      isReady: refuse('isReady'),
    },
    ...roadmap
      ? { roadmap: { ownerApproval: refuse('the owner gate') } }
      : {},
  };
  return { sources, walks: () => walks };
}

describe('readHomeAfterLoop', () => {
  it('answers the home state with the walk problems, reading neither git nor the provider', async () => {
    const { sources, walks } = sourcesOver(walk(hopReading(record(), { issue: C, closed: false, pullRequest: PR })), true);

    const state = await readHomeAfterLoop(sources);

    expect(state).toEqual({
      id: 'away-ended',
      action: 'home',
      reading: `#${String(C)}, the hop's target in epic #${String(AWAY_EPIC)}, has pull request #${String(PR)} open`,
      proposal: 'go back home to board #10',
      pullRequest: PR,
      issue: C,
      planStub: null,
      planPath: null,
      problems: ['the branch scan said something'],
      hop: { action: 'home', home: HOME, closing: 'waiting', pullRequest: PR },
    });
    expect(walks()).toBe(1);
  });

  it('answers null while no hop is away', async () => {
    const { sources } = sourcesOver(walk(hopReading(null, null)), true);

    expect(await readHomeAfterLoop(sources)).toBeNull();
  });

  it('answers null without roadmap, walking no board', async () => {
    const { sources, walks } = sourcesOver(walk(hopReading(record(), C_OPEN)), false);

    expect(await readHomeAfterLoop(sources)).toBeNull();
    expect(walks()).toBe(0);
  });
});
