/**
 * Tests for the settings a cleanup reading that never fetches runs with
 * (`cleanup/settings.ts`): what a caller outside `src/commands/` reads
 * off {@link doctorCleanupSettings}.
 *
 * No case runs git, reads the disk or spawns anything: the function
 * answers an object from the input it is handed. The reading
 * `rafa doctor` runs over these settings, and the proof on a scratch
 * repository that no fetch ran, are covered by
 * `commands/doctor-cleanup.test.ts`.
 *
 * Each reading sits beside its control: a config carrying
 * `loop.worktreeDir` beside one that lacks it (its value against the
 * default), and an input with a `gh` runner beside one without (the
 * same settings either way, so the runner reaches no setting).
 */
import type { DoctorCleanupInput } from './settings.js';
import type { GhResult, GhRunner } from '../adapters/tracker/github.js';

import { join } from 'node:path';

import { describe, expect, it } from 'bun:test';

import { CONFIG_DEFAULTS } from '../config.js';

import { doctorCleanupSettings } from './settings.js';

const ROOT = '/project';
const HOME = '/home/someone';
const NOW = new Date('2026-09-24T12:00:00Z');

const CONFIG: DoctorCleanupInput['config'] = {
  prBase: 'trunk',
  cleanupKeep: ['release/*'],
  cleanupStaleDays: 45,
  cleanupWorktreeIdleDays: 3,
  loopWorktreeDir: '../trees',
};

/** The config with no `loop.worktreeDir`, as a caller holding a narrower config hands it in. */
const WITHOUT_WORKTREE_DIR: DoctorCleanupInput['config'] = {
  prBase: CONFIG.prBase,
  cleanupKeep: CONFIG.cleanupKeep,
  cleanupStaleDays: CONFIG.cleanupStaleDays,
  cleanupWorktreeIdleDays: CONFIG.cleanupWorktreeIdleDays,
};

describe('doctorCleanupSettings', () => {
  it('answers the config\'s settings with fetch false and git in the project root', () => {
    const input: DoctorCleanupInput = { root: ROOT, home: HOME, config: CONFIG, gh: null };

    expect(doctorCleanupSettings(input, NOW)).toEqual({
      fetch: false,
      base: 'trunk',
      keep: ['release/*'],
      staleDays: 45,
      worktreeIdleDays: 3,
      now: NOW,
      home: HOME,
      cwd: ROOT,
      projectRoot: ROOT,
      worktreeDir: '../trees',
    });
  });

  it('reads the default worktree directory for a config with no loop.worktreeDir, where a config with one keeps it', () => {
    const without = doctorCleanupSettings({ root: ROOT, home: HOME, config: WITHOUT_WORKTREE_DIR, gh: null }, NOW);
    const withOne = doctorCleanupSettings({ root: ROOT, home: HOME, config: CONFIG, gh: null }, NOW);

    expect(without.worktreeDir).toBe(CONFIG_DEFAULTS.loopWorktreeDir);
    expect(without.worktreeDir).toBe(join('.rafa', 'worktrees'));
    expect(withOne.worktreeDir).toBe('../trees');
  });

  it('answers the same settings with a gh runner as without, and never calls it', () => {
    const calls: string[][] = [];
    const gh: GhRunner = (args) => {
      calls.push([...args]);
      return Promise.resolve<GhResult>({ ok: true, stdout: '[]', stderr: '' });
    };

    const withGh = doctorCleanupSettings({ root: ROOT, home: HOME, config: CONFIG, gh }, NOW);
    const without = doctorCleanupSettings({ root: ROOT, home: HOME, config: CONFIG, gh: null }, NOW);

    expect(withGh).toEqual(without);
    expect(calls).toEqual([]);
  });

  it('answers a new object each call and leaves the input as it was handed in', () => {
    const input: DoctorCleanupInput = { root: ROOT, home: HOME, config: CONFIG, gh: null };
    const before = structuredClone({ root: input.root, home: input.home, config: input.config });

    const first = doctorCleanupSettings(input, NOW);
    const second = doctorCleanupSettings(input, NOW);

    expect(first).not.toBe(second);
    expect({ root: input.root, home: input.home, config: input.config }).toEqual(before);
  });
});
