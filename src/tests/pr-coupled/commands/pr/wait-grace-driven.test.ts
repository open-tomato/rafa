/**
 * `rafa pr wait` driven over the `gh` fake (`packages/rafa-pr/src/pr/gh-fake.ts`) through
 * the registered command, for the grace a young head gets before its first
 * check registers (`FIRST_CHECK_GRACE_MS` in `packages/rafa-pr/src/pr/checks.ts`).
 *
 * `wait.test.ts` proves the wording over a stub provider; this file proves
 * the real provider, reading the fake's `gh pr view --json commits` and
 * `gh pr checks` JSON, reaches the same endings. The clock and the sleep
 * are injected, so no case spends a real second: the sleep advances the
 * clock by the interval it was asked for and, in the first case, plants the
 * checks the way GitHub registers them some seconds after a push.
 *
 * Three endings: checks that appear on the third poll of a head committed
 * one second before the clock (exit 0, three polls); the same head with no
 * check ever (exit 1, `no check registered yet`, no `merge cleanly` line);
 * and a conflicting pull request with no check (exit 1, the line present).
 */
import type { PlantedProject } from '../../../cli-capture.js';
import type { PrWaitSeams } from '@open-tomato/rafa-pr/commands/pr/wait';
import type { FakePullRequestSeed } from '@open-tomato/rafa-pr/pr/gh-fake';

import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { createPrWaitCommand } from '@open-tomato/rafa-pr/commands/pr/wait';
import { createFakePrGh } from '@open-tomato/rafa-pr/pr/gh-fake';
import { createGhPullRequests } from '@open-tomato/rafa-pr/pr/index';

import { dispatchInProject, plantProject } from '../../../cli-capture.js';

/** A temporary directory of this file's own. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-pr-wait-grace-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** The subject the command routes under. */
const SUBJECTS = [{ name: 'pr', summary: 'pull requests' }];

/** A config naming the GitHub CLI. */
const GH_CONFIG = 'pr:\n  provider: gh\n';

/** The pull request every case waits on. */
const NUMBER = 41;

/** The instant the injected clock starts at. */
const CLOCK_START = Date.parse('2026-10-12T12:00:00Z');

/** One second, the age of the young head. */
const ONE_SECOND_MS = 1000;

/** The poll on which the checks appear. */
const REGISTERING_POLL = 3;

/** A project of this file's own. */
function freshProject(): PlantedProject {
  return plantProject(mkdtempSync(join(tempBase, 'case-')), GH_CONFIG);
}

/** A pull request whose head was committed one second before {@link CLOCK_START}. */
function youngHead(extra: Partial<FakePullRequestSeed> = {}): FakePullRequestSeed {
  return {
    number: NUMBER,
    headRefName: 'feat/grace',
    headCommittedAt: new Date(CLOCK_START - ONE_SECOND_MS).toISOString(),
    checks: [],
    ...extra,
  };
}

/** What one driven wait left behind. */
interface DrivenWait {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  /** How many times the checks were read. */
  readonly polls: number;
  /** The sleeps the wait took, in milliseconds. */
  readonly sleeps: readonly number[];
}

/**
 * Drives `rafa pr wait 41 --no-hint` over a fake holding `seed`. After
 * `registerOn - 1` sleeps, `onRegister` runs, so the checks a case plants
 * there are what the `registerOn`-th poll reads.
 */
async function driveWait(
  seed: FakePullRequestSeed,
  registerOn: number | null,
  onRegister: (fake: ReturnType<typeof createFakePrGh>) => void,
): Promise<DrivenWait> {
  const fake = createFakePrGh({ now: () => new Date(CLOCK_START).toISOString() });
  fake.plant(seed);
  let clock = CLOCK_START;
  let sleeps: readonly number[] = [];
  const seams: PrWaitSeams = {
    pullRequests: () => createGhPullRequests({ gh: fake.run }),
    readBranch: () => 'main',
    readRemote: () => 'git@github.com:open-tomato/rafa.git',
    clock: () => clock,
    sleep: (ms) => {
      clock += ms;
      sleeps = [...sleeps, ms];
      if (sleeps.length === (registerOn ?? 0) - 1) onRegister(fake);
      return Promise.resolve();
    },
  };
  const run = await dispatchInProject(
    ['pr', 'wait', String(NUMBER), '--no-hint'],
    SUBJECTS,
    [createPrWaitCommand(seams)],
    freshProject(),
  );
  const polls = fake.calls().filter((call) => call[0] === 'pr' && call[1] === 'checks').length;
  return { ...run, polls, sleeps };
}

describe('rafa pr wait over the gh fake, on a head committed one second ago', () => {
  it('polls through the gap until the checks register on the third poll and exits 0', async () => {
    const waited = await driveWait(youngHead(), REGISTERING_POLL, (fake) => {
      fake.update(NUMBER, (pull) => ({
        ...pull,
        checks: [{ name: 'gates', state: 'SUCCESS', link: 'https://github.com/open-tomato/rafa/actions/runs/1' }],
      }));
    });

    expect(waited.exitCode).toBe(0);
    expect(waited.polls).toBe(REGISTERING_POLL);
    expect(waited.stdout).toContain('checks green on #41');
  });

  it('ends none with no check ever, saying no check registered yet and nothing about merging', async () => {
    const waited = await driveWait(youngHead(), null, () => undefined);

    expect(waited.exitCode).toBe(1);
    expect(waited.stderr).toContain('no check registered yet');
    expect(waited.stderr).not.toContain('merge cleanly');
    expect(waited.polls).toBeGreaterThan(1);
  });

  it('prints the merge-cleanly line when the pull request with no check conflicts', async () => {
    const waited = await driveWait(
      youngHead({ mergeable: 'CONFLICTING', mergeStateStatus: 'DIRTY' }),
      null,
      () => undefined,
    );

    expect(waited.exitCode).toBe(1);
    expect(waited.stderr).toContain('no check registered yet');
    expect(waited.stderr).toContain('merge cleanly');
  });
});
