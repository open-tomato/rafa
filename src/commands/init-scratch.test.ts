/**
 * `rafa init` spawned in a scratch git repository with a HOME of its own:
 * afterwards nothing exists under `.claude/` in the repository or the home,
 * `git status` names no `.claude` path, and a plan routing a task to the
 * bundled `loop-implementer` passes `rafa plan validate` with no agent
 * vendored. The control lists a planted `.claude` path the same way, so an
 * empty listing is a reading.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { plantScratchRepo, runRafa } from '../tests/cli-capture.js';

const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-init-scratch-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

const SPAWN_TIMEOUT = 60_000;

const PLAN = [
  '# Plan: routed',
  '',
  '# Stage: one',
  '',
  '- [ ] Implement the change  {agent=loop-implementer}',
  '',
].join('\n');

/** Every path under `base` with a `.claude` segment, sorted. */
const claudePaths = (base: string): readonly string[] => readdirSync(base, { recursive: true, encoding: 'utf8' })
  .filter((path) => path.split('/').includes('.claude'))
  .sort((a, b) => a.localeCompare(b));

/** `git status --porcelain --untracked-files=all` in `repo`. */
const gitStatus = (repo: string, home: string): string => execFileSync(
  'git',
  ['status', '--porcelain', '--untracked-files=all'],
  { cwd: repo, encoding: 'utf8', env: { ...process.env, HOME: home, GIT_CONFIG_NOSYSTEM: '1' } },
);

describe('rafa init in a scratch repository', () => {
  it('leaves nothing under .claude/, and a loop-implementer plan passes plan validate', () => {
    const scratch = plantScratchRepo(tempBase, { project: false });

    const init = runRafa(scratch, scratch.repo, ['init', '--yes']);
    expect(init.exitCode).toBe(0);

    expect(claudePaths(scratch.repo)).toEqual([]);
    expect(claudePaths(scratch.home)).toEqual([]);
    const status = gitStatus(scratch.repo, scratch.home);
    expect(status).not.toContain('.claude');

    const planFile = join(scratch.repo, '.rafa', 'plans', 'PLAN-routed.md');
    mkdirSync(join(scratch.repo, '.rafa', 'plans'), { recursive: true });
    writeFileSync(planFile, PLAN, 'utf8');
    const validate = runRafa(scratch, scratch.repo, ['plan', 'validate', '.rafa/plans/PLAN-routed.md']);

    expect(validate.stderr).toBe('');
    expect(validate.exitCode).toBe(0);
    expect(validate.stdout).toContain('no issues');
    expect(claudePaths(scratch.repo)).toEqual([]);
  }, SPAWN_TIMEOUT);

  it('control: the listing finds a .claude path where one is planted', () => {
    const scratch = plantScratchRepo(tempBase, { project: false });
    mkdirSync(join(scratch.repo, '.claude', 'agents'), { recursive: true });
    writeFileSync(join(scratch.repo, '.claude', 'agents', 'x.md'), 'x\n', 'utf8');

    expect(claudePaths(scratch.repo)).toEqual(['.claude', '.claude/agents', '.claude/agents/x.md']);
    expect(gitStatus(scratch.repo, scratch.home)).toContain('.claude/agents/x.md');
  });
});
