/**
 * `rafa release status` spawned in a linked worktree beside its main
 * checkout, under a parent folder holding a `.rafa/config.yaml` of its
 * own. `.rafa/` is gitignored, so the worktree has none; the scope walk
 * must stop at the worktree's top level and answer the MAIN CHECKOUT's
 * project (`src/project/scope.ts`) rather than climb into the parent
 * folder's. The two projects name different version files, so the
 * version the readout prints says which project answered.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, realpathSync, rmSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { expectExit, plantProjectConfig, plantScratchRepo, runRafa } from '../../tests/cli-capture.js';
import { gitIdentityEnv } from '../../tests/git-identity.js';

const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-release-status-worktree-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** The version the main checkout's project declares, committed so the worktree holds it too. */
const PROJECT_VERSION = '1.2.3';

/** The version the parent folder's project would declare, were it wrongly answered. */
const PARENT_VERSION = '9.9.9';

/** Runs git in `cwd`, isolated from the operator's own config. */
function git(cwd: string, home: string, args: readonly string[]): void {
  execFileSync('git', args, {
    cwd,
    stdio: 'pipe',
    env: {
      PATH: process.env['PATH'] ?? '',
      HOME: home,
      GIT_CONFIG_GLOBAL: join(home, '.gitconfig'),
      GIT_CONFIG_NOSYSTEM: '1',
      ...gitIdentityEnv(),
      LC_ALL: 'C',
    },
  });
}

describe('rafa release status in a linked worktree under a parent project', () => {
  it('reads the main checkout project version, not the parent folder project', () => {
    // Arrange
    const scratch = plantScratchRepo(tempBase);
    const parent = join(scratch.repo, '..');
    plantProjectConfig(scratch.repo, 'version: 1\nrelease:\n  versionFile: package.json\n  changelog: CHANGELOG.md\n');
    plantProjectConfig(parent, 'version: 1\nrelease:\n  versionFile: parent.json\n  changelog: CHANGELOG.md\n');
    writeFileSync(join(parent, 'parent.json'), JSON.stringify({ name: 'parent', version: PARENT_VERSION }));
    writeFileSync(join(scratch.repo, 'package.json'), JSON.stringify({ name: 'demo', version: PROJECT_VERSION }));
    writeFileSync(join(scratch.repo, '.gitignore'), '.rafa/\n');
    git(scratch.repo, scratch.home, ['add', '.gitignore', 'package.json']);
    git(scratch.repo, scratch.home, ['commit', '-q', '-m', 'init']);
    const worktree = join(parent, 'linked');
    mkdirSync(parent, { recursive: true });
    git(scratch.repo, scratch.home, ['worktree', 'add', '-q', '-b', 'feature', worktree]);

    // Act
    const run = runRafa(scratch, worktree, ['release', 'status']);

    // Assert
    expectExit(run, 0, scratch);
    expect(run.stdout).toContain(`package.json: ${PROJECT_VERSION}`);
    expect(run.stdout).not.toContain(PARENT_VERSION);
  });
});
