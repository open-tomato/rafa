/**
 * Tests for the `gh` preflight items (`src/pr/preflight-items.ts`).
 *
 * The readings that matter here are not the item shapes but what the
 * probes DO, so most cases run the items through the real
 * `runPreflight` and the real `/bin/sh`, against a scratch `PATH`
 * holding a stand-in `gh` script. No case spawns the real `gh`, reads
 * the real home or reaches a network: the child's `PATH` is one
 * `mkdtemp` directory and nothing else, which the first case asserts by
 * halting on a `gh` that is absent from it.
 *
 * Each failure case is paired with the pass that proves the probe could
 * have gone the other way: the same item passes when the stand-in
 * answers 0, so a probe that always failed would not read as a working
 * check here.
 */
import type { PrProviderReading } from './provider.js';
import type { PreflightCheck } from '../preflight/run.js';

import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { runPreflight } from '../preflight/run.js';

import {
  DEFAULT_GH_HOST,
  ghAuthItem,
  ghAuthLine,
  ghHostOf,
  GH_INSTALL_LINE,
  ghOnPathItem,
  ghPreflightItems,
  shellQuote,
} from './preflight-items.js';

/** Every scratch directory made here, removed when the file is done. */
const scratchDirs: string[] = [];

/** A directory of this file's own, under the system temporary directory. */
function scratchDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'rafa-gh-preflight-'));
  scratchDirs.push(dir);
  return dir;
}

/** What the stand-in `gh` writes to stderr when it refuses; never the remedy. */
const STAND_IN_REFUSAL = 'stand-in gh: you are not logged into any GitHub hosts';

/**
 * A directory holding a stand-in `gh`, and nothing else, for the child's
 * `PATH`. `authExit` is what it answers for `gh auth status ...`; every
 * other call exits 0.
 */
function standInGhDir(authExit: number): string {
  const dir = scratchDir();
  const script = [
    '#!/bin/sh',
    'if [ "$1" = auth ]; then',
    `  [ ${authExit} -eq 0 ] || echo '${STAND_IN_REFUSAL}' >&2`,
    `  exit ${authExit}`,
    'fi',
    'exit 0',
    '',
  ].join('\n');
  const path = join(dir, 'gh');
  writeFileSync(path, script);
  chmodSync(path, 0o755);
  return dir;
}

/** A `gh` reading naming `host`, as `resolvePrProvider` answers one. */
function ghReading(host: string | null): PrProviderReading {
  return {
    provider: 'gh',
    source: 'config',
    remote: host === null
      ? null
      : `https://${host}/o/r.git`,
    host,
  };
}

/** Runs `items` through the real preflight with `dir` as the whole `PATH`. */
async function check(
  reading: PrProviderReading,
  dir: string,
): Promise<{ checks: readonly PreflightCheck[]; halt: string | null }> {
  const items = { required: ghPreflightItems(reading), optional: [] };
  const report = await runPreflight(items, { cwd: dir, env: { PATH: dir }, warn: () => undefined });
  return { checks: report.checks, halt: report.halt };
}

/** The failure of the check at `index`, or the empty string for a pass. */
function failureAt(checks: readonly PreflightCheck[], index: number): string {
  return checks[index]?.failure ?? '';
}

afterAll(() => {
  for (const dir of scratchDirs) rmSync(dir, { recursive: true, force: true });
});

describe('the items a gh provider contributes', () => {
  it('contributes no item when the provider is none', () => {
    const reading: PrProviderReading = {
      provider: 'none',
      source: 'remote',
      remote: 'git@gitlab.com:o/r.git',
      host: 'gitlab.com',
    };
    expect(ghPreflightItems(reading)).toEqual([]);
  });

  it('contributes the PATH item and the auth item, in that order', () => {
    const items = ghPreflightItems(ghReading('github.com'));
    expect(items.map((item) => [item.kind, item.name]))
      .toEqual([['tool', 'gh'], ['service', 'https://github.com']]);
  });

  it('answers a frozen list of frozen items', () => {
    const items = ghPreflightItems(ghReading('github.com'));
    expect(Object.isFrozen(items)).toBe(true);
    expect(items.every((item) => Object.isFrozen(item))).toBe(true);
  });

  it('asks about the remote host rather than about github.com', () => {
    const items = ghPreflightItems(ghReading('github.example.com'));
    expect(items[1]?.name).toBe('https://github.example.com');
    expect(items[1]?.probe).toContain('gh auth status --hostname github.example.com');
    expect(items[0]?.probe).toContain('gh auth login --hostname github.example.com');
  });

  it('falls back to github.com when the reading names no host', () => {
    expect(ghHostOf(ghReading(null))).toBe(DEFAULT_GH_HOST);
    expect(ghPreflightItems(ghReading(null))[1]?.name).toBe('https://github.com');
  });
});

describe('the gh preflight probes', () => {
  it('passes both items when gh is on PATH and authenticated', async () => {
    const report = await check(ghReading('github.com'), standInGhDir(0));
    expect(report.checks.map((one) => one.outcome)).toEqual(['pass', 'pass']);
    expect(report.halt).toBeNull();
  });

  it('halts naming the install line and gh auth login when gh is absent', async () => {
    const report = await check(ghReading('github.com'), scratchDir());
    expect(report.checks.map((one) => one.outcome)).toEqual(['fail', 'fail']);
    const halt = report.halt ?? '';
    expect(halt).toContain('preflight halted: 2 required items failed');
    expect(halt).toContain('gh is not on PATH');
    expect(halt).toContain(GH_INSTALL_LINE);
    expect(halt).toContain(ghAuthLine('github.com'));
  });

  it('fails the auth item alone when gh is there but not logged in', async () => {
    const report = await check(ghReading('github.com'), standInGhDir(1));
    expect(report.checks.map((one) => one.outcome)).toEqual(['pass', 'fail']);
    const failure = failureAt(report.checks, 1);
    expect(failure).toContain('gh is not authenticated for github.com');
    expect(failure).toContain(ghAuthLine('github.com'));
    expect(failure).toContain(GH_INSTALL_LINE);
  });

  it('drops the CLI own refusal so the remedy is what the failure carries', async () => {
    const report = await check(ghReading('github.com'), standInGhDir(1));
    expect(failureAt(report.checks, 1)).not.toContain(STAND_IN_REFUSAL);
  });

  it('asks the stand-in about the host the reading named', async () => {
    const dir = scratchDir();
    const path = join(dir, 'gh');
    const log = join(dir, 'asked.txt');
    writeFileSync(path, `#!/bin/sh\necho "$@" >> ${log}\nexit 0\n`);
    chmodSync(path, 0o755);
    const report = await check(ghReading('github.example.com'), dir);
    expect(report.halt).toBeNull();
    expect(await Bun.file(log).text()).toBe('auth status --hostname github.example.com\n');
  });
});

describe('quoting a host that reaches the shell', () => {
  it('leaves a plain host as it stands and quotes one that is not', () => {
    expect(shellQuote('github.com')).toBe('github.com');
    expect(shellQuote('git hub.com')).toBe('\'git hub.com\'');
    expect(shellQuote('o\'hara.com')).toBe('\'o\'\\\'\'hara.com\'');
  });

  it('runs the auth probe as one command when the host carries a quote', async () => {
    const host = 'o\'hara; touch pwned.txt; x.com';
    const dir = scratchDir();
    const report = await check(ghReading(host), dir);
    const failure = failureAt(report.checks, 1);
    expect(failure).toContain(`gh is not authenticated for ${host}`);
    expect(failure).not.toContain('syntax error');
    expect(existsSync(join(dir, 'pwned.txt'))).toBe(false);
  });

  it('keeps the remedy intact when the message reaches the shell', () => {
    const probe = ghAuthItem('github.com').probe ?? '';
    expect(probe).toContain('>/dev/null 2>&1');
    expect(ghOnPathItem('github.com').probe).toContain('command -v gh');
  });
});
