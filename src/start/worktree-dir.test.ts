/**
 * Tests for `worktree-dir.ts`: `loop.worktreeDir` resolved against the
 * project root. Each project root is a made-up absolute path that is not
 * the process's working directory, so a resolution against the working
 * directory would answer a different path and fail the case.
 */
import { join } from 'node:path';

import { describe, expect, it } from 'bun:test';

import { CONFIG_DEFAULTS } from '../config.js';

import { worktreeDirAt } from './worktree-dir.js';

/** A project root that is not the working directory the suite runs in. */
const ROOT = join('/', 'nonesuch', 'project');

describe('worktreeDirAt', () => {
  it('puts the default under the project root .rafa/worktrees', () => {
    expect(worktreeDirAt(ROOT, CONFIG_DEFAULTS.loopWorktreeDir)).toBe(join(ROOT, '.rafa', 'worktrees'));
  });

  it('reads a relative value from the project root, not from the working directory', () => {
    expect(process.cwd()).not.toBe(ROOT);
    expect(worktreeDirAt(ROOT, join('..', 'trees'))).toBe(join('/', 'nonesuch', 'trees'));
  });

  it('takes an absolute value as written', () => {
    const elsewhere = join('/', 'var', 'trees');

    expect(worktreeDirAt(ROOT, elsewhere)).toBe(elsewhere);
  });
});
