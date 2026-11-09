/**
 * Tests that `hints.skills` reaches `rafa release tag` on its production
 * path: the command is built with no config seam, so the key is read by
 * `loadConfig` from a project `rafa.config.ts`.
 *
 *   - set to `true`, each of the branch refusal's two steps (case
 *     `tag-branch`) is followed by one `skill: rafa-release › tag-branch` line;
 *   - with the key unset, the same refusal prints no skill line.
 */
import type { RafaCommand } from '@open-tomato/rafa/core/command';

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { gitIdentityEnv } from '@open-tomato/rafa/tests/git-identity';
import { createReleaseTagCommand } from '@open-tomato/rafa-release/commands/release/tag';

import { dispatchInProject, plantProjectConfig, plantScratchRepo } from '../../../cli-capture.js';

const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-release-tag-hints-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

const SUBJECTS = [{ name: 'release', summary: 'releases' }];
const SIDE_BRANCH = 'feat/rafa-side';
const SKILL_LINE = '    skill: rafa-release › tag-branch\n';
const STEP_LINE = 'rafa release tag — main is checked out there\n';

const CONFIG_TS_HINTS_ON = 'import type { Config } from \'@open-tomato/rafa/config\';\n'
  + 'export default [{ hints: { skills: true } }] satisfies Config;\n';

let worldCount = 0;

function git(cwd: string, home: string, args: readonly string[]): void {
  execFileSync('git', [...args], {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      HOME: home,
      GIT_CONFIG_GLOBAL: join(home, '.gitconfig'),
      GIT_CONFIG_NOSYSTEM: '1',
      ...gitIdentityEnv(),
    },
  });
}

/** Plants a main checkout on `main` and a linked worktree, and answers the worktree's refusal output. */
async function refusalStderr(configTs: string | null): Promise<{ exitCode: number | null; stderr: string }> {
  worldCount += 1;
  const base = join(tempBase, `world-${String(worldCount)}`);
  mkdirSync(base, { recursive: true });
  const { repo: main, home } = plantScratchRepo(base, { project: false });
  git(main, home, ['checkout', '-q', '-B', 'main']);
  writeFileSync(join(main, 'package.json'), JSON.stringify({ name: 'x', version: '0.5.0' }), 'utf8');
  writeFileSync(join(main, 'CHANGELOG.md'), '# Changelog\n\n## 0.5.0 — 2026-09-15, rafa-1: a change\n', 'utf8');
  git(main, home, ['add', 'package.json', 'CHANGELOG.md']);
  git(main, home, ['commit', '-q', '-m', 'chore: release 0.5.0']);
  const side = join(main, '..', 'side');
  git(main, home, ['worktree', 'add', '-q', '-b', SIDE_BRANCH, side]);
  const root = realpathSync(side);
  plantProjectConfig(main);
  plantProjectConfig(root);
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'x', version: '0.5.0' }), 'utf8');
  writeFileSync(join(root, 'CHANGELOG.md'), '# Changelog\n\n## 0.5.0 — 2026-09-15, rafa-1: a change\n', 'utf8');
  if (configTs !== null) {
    writeFileSync(join(root, 'rafa.config.ts'), configTs, 'utf8');
  }
  const command: RafaCommand = createReleaseTagCommand();
  const run = await dispatchInProject(['release', 'tag'], SUBJECTS, [command], { root, home });
  return { exitCode: run.exitCode, stderr: run.stderr };
}

describe('hints.skills read from a project rafa.config.ts by rafa release tag', () => {
  it('follows the refusal step with one skill line when the key is true', async () => {
    const run = await refusalStderr(CONFIG_TS_HINTS_ON);

    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain(STEP_LINE + SKILL_LINE);
    // The refusal prints two steps, the pr.base hint and the holder's, each with a case.
    expect(run.stderr).toMatch(/set pr\.base in [^\n]*\n {4}skill: rafa-release › tag-branch\n/);
    expect(run.stderr.match(/skill:/g)).toHaveLength(2);
  });

  it('prints no skill line when the key is unset', async () => {
    const run = await refusalStderr(null);

    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain(STEP_LINE);
    expect(run.stderr).not.toContain('skill:');
  });
});
