/**
 * Tests for the composition root `src/service-registry.ts`: the services
 * core registers, read off `activeServices()` once `registerCoreServices`
 * has been called. The preload (`src/tests/preload.ts`) makes the call
 * once for the test process; importing the root registers nothing.
 *
 * The registration case starts from an empty registry and asserts a
 * function under every key of `SERVICE_REASONS`, so a key the root
 * misses fails here as well as in `tsc`. The second-call case holds a
 * set of stubs and asserts the call registers nothing over it. The
 * spawned case runs the real entry in a child, which runs no preload,
 * and reads that `--help` exits 0 with no registry refusal on either
 * stream. Each in-process case puts back the set it found in a `finally`.
 *
 * The `addStaleDocLine` cases drive `addStaleDocLineWithRelease` over a
 * `local` tracker under a temporary directory this file removes, holding
 * one marked chore of 1.3.5 an earlier run opened: a reading that hands
 * 1.3.0 retitles it to the line's 1.4.0, beside the control that hands
 * nothing and opens a second issue. The default reader's case runs in a
 * temporary repository tagged `v1.3.0`, the working directory changed for
 * the call and put back in a `finally`.
 */
import type { RafaServices } from '@open-tomato/rafa/core/services';
import type { OpenIssue, Tracker } from '@open-tomato/rafa/ports';

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { activeServices, registerServices, restoreServices, SERVICE_REASONS } from '@open-tomato/rafa/core/services';
import { gitIdentityEnv } from '@open-tomato/rafa/tests/git-identity';
import { createLocalTracker } from '@open-tomato/rafa-board/adapters/tracker/local';
import { addStaleDocLine, STALE_DOCS_MARKER, staleDocsTitle } from '@open-tomato/rafa-release/docs/release-issue';

import { addStaleDocLineWithRelease, CORE_SERVICES, registerCoreServices } from './service-registry.js';
import { expectExit } from './tests/cli-capture.js';

const REFUSAL_PREFIX = 'service registry:';
const SERVICE_KEYS = Object.keys(SERVICE_REASONS).sort();

/** Runs `body` with the active set replaced by `start` (null for none), then puts the found set back. */
function over(start: RafaServices | null, body: () => void): void {
  const found = registerServices(CORE_SERVICES);
  try {
    restoreServices(start);
    body();
  } finally {
    restoreServices(found);
  }
}

describe('registerCoreServices', () => {
  it('registers a function under every key of SERVICE_REASONS, from an empty registry', () => {
    over(null, () => {
      const facade = registerCoreServices();

      expect(Object.keys(CORE_SERVICES).sort()).toEqual(SERVICE_KEYS);
      for (const key of SERVICE_KEYS) {
        expect(typeof activeServices()[key as keyof RafaServices]).toBe('function');
        expect(typeof facade[key as keyof RafaServices]).toBe('function');
      }
    });
  });

  it('registers nothing on a second call, leaving the held set active', () => {
    const calls: string[] = [];
    const stubs = {
      addStaleDocLine: async () => { calls.push('addStaleDocLine'); return {} as never; },
      endWithNextStep: async () => { calls.push('endWithNextStep'); },
      pullRequestsIn: () => { calls.push('pullRequestsIn'); return {} as never; },
      readStaleDocsVersion: () => { calls.push('readStaleDocsVersion'); return 'stub'; },
      triageReport: async () => { calls.push('triageReport'); return {} as never; },
    } satisfies RafaServices;
    over(null, () => {
      registerCoreServices();
      const again = registerCoreServices();
      expect(again).toBe(activeServices());

      restoreServices(stubs);
      const third = registerCoreServices();

      expect(third).toBe(activeServices());
      expect(third.readStaleDocsVersion({} as never)).toBe('stub');
      expect(calls).toEqual(['readStaleDocsVersion']);
    });
  });

  it('exits 0 with no registry refusal when the real entry prints --help', () => {
    const spawned = Bun.spawnSync([process.execPath, 'src/rafa.ts', '--help'], { cwd: import.meta.dir + '/..' });
    const child = { exitCode: spawned.exitCode, stdout: spawned.stdout.toString(), stderr: spawned.stderr.toString() };

    expectExit(child, 0);
    expect(child.stdout).not.toContain(REFUSAL_PREFIX);
    expect(child.stderr).not.toContain(REFUSAL_PREFIX);
  });
});

const tempBase = mkdtempSync(join(tmpdir(), 'rafa-service-registry-'));
let rootCount = 0;

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** The version the line is added for. */
const VERSION = '1.4.0';

/** The line every case adds. */
const ENTRY = { where: 'context/cli.md:12', what: 'names the old flag' };

/** A fresh directory holding a `local` tracker with one marked chore of 1.3.5 open. */
async function plantedRoot(): Promise<{ readonly root: string; readonly tracker: Tracker }> {
  const root = join(tempBase, `root-${rootCount}`);
  rootCount += 1;
  mkdirSync(root, { recursive: true });
  const tracker = createLocalTracker({ issuesDir: join(root, '.rafa', 'issues'), fallbackReason: null });
  const planted = await addStaleDocLine({ tracker, version: '1.3.5', entry: { where: null, what: 'an earlier line' } });
  if (planted.action !== 'created') throw new Error(`the chore was not planted: ${planted.action}`);
  return { root, tracker };
}

/** The titles of the marked chores `tracker` holds open, sorted. */
async function markedTitles(tracker: Tracker): Promise<string[]> {
  const open: OpenIssue[] = await tracker.openIssues?.('chore') ?? [];
  return open
    .filter((issue) => issue.body.includes(STALE_DOCS_MARKER))
    .map((issue) => issue.title)
    .sort();
}

describe('addStaleDocLineWithRelease', () => {
  it('hands the newest release it reads when the caller read none, retitling the unreleased chore', async () => {
    const { tracker } = await plantedRoot();
    let reads = 0;
    const add = addStaleDocLineWithRelease(() => {
      reads += 1;
      return '1.3.0';
    });

    const result = await add({ tracker, version: VERSION, entry: ENTRY });

    expect(result).toMatchObject({ action: 'appended', retitledFrom: staleDocsTitle('1.3.5') });
    expect(reads).toBe(1);
    expect(await markedTitles(tracker)).toEqual([staleDocsTitle(VERSION)]);
  });

  it('opens a second issue when the reader answers no reading', async () => {
    // The control of the case above: the same chore and line, nothing read.
    const { tracker } = await plantedRoot();

    const result = await addStaleDocLineWithRelease(() => undefined)({ tracker, version: VERSION, entry: ENTRY });

    expect(result.action).toBe('created');
    expect(await markedTitles(tracker)).toEqual([staleDocsTitle('1.3.5'), staleDocsTitle(VERSION)].sort());
  });

  it('reads as no reading a reader that throws, and never rejects', async () => {
    const { tracker } = await plantedRoot();
    const add = addStaleDocLineWithRelease(() => {
      throw new Error('git could not start');
    });

    const result = await add({ tracker, version: VERSION, entry: ENTRY });

    expect(result.action).toBe('created');
  });

  it('passes on a reading the caller took itself, null included, calling no reader', async () => {
    const { tracker } = await plantedRoot();
    const add = addStaleDocLineWithRelease(() => {
      throw new Error('the reader was called over the caller\'s reading');
    });

    // null is a repository with no root tag: every version is unreleased, so 1.3.5 is retitled.
    const result = await add({ tracker, version: VERSION, entry: ENTRY, newestRelease: null });

    expect(result).toMatchObject({ action: 'appended', retitledFrom: staleDocsTitle('1.3.5') });
  });

  it('reads the root tags of the working directory\'s repository by default, as CORE_SERVICES registers it', async () => {
    const { root, tracker } = await plantedRoot();
    const home = join(root, '.home');
    mkdirSync(home);
    const env = {
      PATH: process.env['PATH'] ?? '',
      HOME: home,
      GIT_CONFIG_GLOBAL: join(home, '.gitconfig'),
      GIT_CONFIG_NOSYSTEM: '1',
      ...gitIdentityEnv(),
      LC_ALL: 'C',
    };
    writeFileSync(join(root, 'README.md'), '# demo\n');
    for (const args of [
      ['init', '-q', '--initial-branch=main', '.'],
      ['add', 'README.md'],
      ['commit', '-q', '-m', 'first'],
      ['tag', 'v1.3.0'],
    ]) {
      execFileSync('git', args, { cwd: root, env, stdio: 'ignore' });
    }
    const found = process.cwd();
    let result;
    try {
      process.chdir(root);
      result = await CORE_SERVICES.addStaleDocLine({ tracker, version: VERSION, entry: ENTRY });
    } finally {
      process.chdir(found);
    }

    expect(result).toMatchObject({ action: 'appended', retitledFrom: staleDocsTitle('1.3.5') });
  });
});
