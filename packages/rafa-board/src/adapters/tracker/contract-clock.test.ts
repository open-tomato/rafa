/**
 * Tests for the contract's clocks
 * (`packages/rafa-board/src/adapters/tracker/contract-clock.ts`).
 *
 * The advanceable clock is held to moving `now()` by exactly what was
 * advanced, to staying frozen between advances, and to resolving
 * `advance` without waiting, measured on the wall clock. The real
 * clock's `advance(20)` is held to waiting at least 20 ms on the wall
 * clock: the control that the wall-clock reading the advanceable cases
 * take could have seen a wait.
 *
 * The cut-off case of the contract is run against a `local` tracker over
 * a temporary directory. Negative first: an advanceable clock with the
 * tracker left on its system clock, so the case rejects, the issues
 * being dated by the wall clock the advance never moved. Then positive:
 * the tracker's `now` reads the handed clock, and the case resolves in
 * under 100 ms.
 */
import type { ContractClock } from './contract-clock.js';
import type { Tracker } from '@open-tomato/rafa/ports';

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';

import { advanceableContractClock, realContractClock } from './contract-clock.js';
import { trackerContractCases } from './contract.js';
import { createLocalTracker } from './local.js';

/** A start far from the wall clock, so a `now()` reading it is not one. */
const START_MS = Date.UTC(2026, 0, 1);

/** The most a resolved-at-once `advance` may take on the wall clock. */
const NO_WAIT_CEILING_MS = 10;

describe('advanceableContractClock', () => {
  it('answers its start before any advance', () => {
    expect(advanceableContractClock(START_MS).now()).toBe(START_MS);
  });

  it('moves now() by exactly the advanced milliseconds', async () => {
    const clock = advanceableContractClock(START_MS);

    await clock.advance(1100);
    expect(clock.now()).toBe(START_MS + 1100);
    await clock.advance(1);
    expect(clock.now()).toBe(START_MS + 1101);
  });

  it('stays frozen between advances', async () => {
    const clock = advanceableContractClock(START_MS);

    await clock.advance(5);
    const first = clock.now();
    await new Promise((resolve) => {
      setTimeout(resolve, 15);
    });

    expect(clock.now()).toBe(first);
  });

  it('resolves advance without waiting', async () => {
    const clock = advanceableContractClock(START_MS);
    const before = performance.now();

    await clock.advance(60_000);

    expect(performance.now() - before).toBeLessThan(NO_WAIT_CEILING_MS);
    expect(clock.now()).toBe(START_MS + 60_000);
  });

  it('starts at the wall clock by default', () => {
    const before = Date.now();
    const now = advanceableContractClock().now();

    expect(now).toBeGreaterThanOrEqual(before);
    expect(now).toBeLessThanOrEqual(Date.now());
  });
});

describe('realContractClock', () => {
  it('reads the wall clock', () => {
    const before = Date.now();
    const now = realContractClock().now();

    expect(now).toBeGreaterThanOrEqual(before);
    expect(now).toBeLessThanOrEqual(Date.now());
  });

  it('waits at least 20 ms for advance(20)', async () => {
    const clock = realContractClock();
    const before = performance.now();
    const nowBefore = clock.now();

    await clock.advance(20);

    expect(performance.now() - before).toBeGreaterThanOrEqual(20);
    expect(clock.now() - nowBefore).toBeGreaterThanOrEqual(20);
  });
});

const CUT_OFF_CASE_NAME = 'filedIssues answers a bug moved to done after the cut-off, leaving out a spike and an earlier bug';

/** The most the cut-off case may take on the wall clock once no wait is left in it. */
const CUT_OFF_CEILING_MS = 100;

describe('the cut-off case against a local tracker', () => {
  let tempDir = '';
  let made = 0;

  beforeAll(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'rafa-contract-clock-'));
  });

  afterAll(() => {
    if (tempDir !== '') rmSync(tempDir, { recursive: true, force: true });
  });

  /** The cut-off case, run over a tracker `make` builds from a fresh directory and the case's clock. */
  function cutOffCase(make: (issuesDir: string, clock: ContractClock) => Tracker): () => Promise<void> {
    const found = trackerContractCases({
      name: 'local',
      expectsProjects: false,
      expectedKind: 'local',
      editsIssues: true,
      editsPriority: true,
      clock: advanceableContractClock,
      // The cut-off case reads no comments.
      readComments: async () => [],
      create: async (clock) => {
        made += 1;

        return make(join(tempDir, `${made}-cut-off`), clock);
      },
    }).find((contractCase) => contractCase.name === CUT_OFF_CASE_NAME);
    if (found === undefined) throw new Error(`no contract case named ${CUT_OFF_CASE_NAME}`);

    return found.run;
  }

  it('rejects when the tracker stays on the system clock', async () => {
    const run = cutOffCase((issuesDir) => createLocalTracker({ issuesDir, fallbackReason: null }));

    await expect(run()).rejects.toBeDefined();
  });

  it('resolves in under 100 ms when the tracker reads the handed clock', async () => {
    const run = cutOffCase((issuesDir, clock) => createLocalTracker({
      issuesDir,
      fallbackReason: null,
      now: () => new Date(clock.now()).toISOString(),
    }));
    const before = performance.now();

    await run();

    expect(performance.now() - before).toBeLessThan(CUT_OFF_CEILING_MS);
  });
});
