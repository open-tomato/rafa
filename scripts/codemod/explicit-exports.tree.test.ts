import type { CodemodResult } from './explicit-exports';

import { resolve } from 'node:path';

import { describe, expect, it } from 'bun:test';

import { runCodemod } from './explicit-exports';

const REPO_ROOT = resolve(import.meta.dir, '../..');
const TIMEOUT_MS = 180_000;

/** Each run: the folder holding a `tsconfig.json`, and the folders it sweeps. */
const SWEEPS: readonly (readonly [string, string, readonly string[]])[] = [
  ['src and scripts', '.', ['src', 'scripts']],
  ['packages/rafa-hub', 'packages/rafa-hub', ['src']],
  ['packages/rafa-sync-service', 'packages/rafa-sync-service', ['src']],
];

function dryRun(root: string, folders: readonly string[]): CodemodResult {
  return runCodemod({ root: resolve(REPO_ROOT, root), folders, dryRun: true });
}

describe('explicit-exports over the repository', () => {
  it.each(SWEEPS)('proposes no change and refuses nothing in %s', (_name, root, folders) => {
    // Arrange / Act
    const result = dryRun(root, folders);

    // Assert
    expect(result.dryRun).toBe(true);
    expect(result.filesRead).toBeGreaterThan(0);
    expect(result.rewrites).toEqual([]);
    expect(result.changedFiles).toEqual([]);
    expect(result.refusals).toEqual([]);
  }, TIMEOUT_MS);
});
