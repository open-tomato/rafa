/**
 * Integration proof that one run record in phase `wrap-up`, with every
 * task of its tracker ticked, reads as `wrap-up` on both surfaces: the
 * tomato header of the zsh plugin, in a spawned `zsh -f`, and
 * `rafa loop status`, in a spawned `bun src/rafa.ts`. Both read the same
 * planted record and tracker in one scratch project, so a count of
 * `5/5` on either would show the phase was lost.
 */
import type { ScratchRepo } from './cli-capture.js';

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { plantScratchRepo, runRafa } from './cli-capture.js';

const RUN_TIMEOUT = { timeout: 60_000 };

const EXTRAS = join(import.meta.dir, '..', '..', 'extras', 'zsh');
const THEME = join(EXTRAS, 'tomato', 'tomato.zsh-theme');

const STUB = 'rafa-579-loop-run-ends-delivered';
const BRANCH = `feat/${STUB}`;
const PLAN_FILE = `.rafa/plans/PLAN-${STUB}.md`;
const TRACKER_FILE = `.rafa/plans/PLAN_TRACKER-${STUB}.md`;
const TASK_COUNT = 5;

const scratchBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-wrap-up-phase-')));

afterAll(() => {
  rmSync(scratchBase, { recursive: true, force: true });
});

/** Writes `text` at `path`, making its directory. */
function plant(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text, 'utf8');
}

/** A scratch project on `BRANCH` holding a fully ticked tracker and a live wrap-up record. */
function plantWrapUpProject(): { readonly scratch: ScratchRepo } {
  const scratch = plantScratchRepo(scratchBase);
  const { repo } = scratch;
  const gitEnv = {
    PATH: scratch.path,
    HOME: scratch.home,
    GIT_CONFIG_GLOBAL: join(scratch.home, '.gitconfig'),
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 'Probe',
    GIT_AUTHOR_EMAIL: 'probe@example.com',
    GIT_COMMITTER_NAME: 'Probe',
    GIT_COMMITTER_EMAIL: 'probe@example.com',
  };
  // `git rev-parse --abbrev-ref HEAD` needs a commit to name the branch.
  execFileSync('git', ['checkout', '-q', '-b', BRANCH], { cwd: repo, stdio: 'pipe', env: gitEnv });
  execFileSync('git', ['commit', '-q', '--allow-empty', '-m', 'initial'], { cwd: repo, stdio: 'pipe', env: gitEnv });
  const tracker = [
    '# Plan: Loop run ends delivered',
    '',
    ...Array.from({ length: TASK_COUNT }, (_, index) => `- [x] Task ${index + 1}`),
    '',
  ].join('\n');
  plant(join(repo, PLAN_FILE), tracker);
  plant(join(repo, TRACKER_FILE), tracker);
  const record = {
    sessionId: 'wrap-up-session',
    pid: process.pid,
    branch: BRANCH,
    planStub: STUB,
    plan: PLAN_FILE,
    startedAt: '2026-09-20T10:00:00.000Z',
    state: 'running',
    task: null,
    phase: 'wrap-up',
  };
  plant(join(repo, '.rafa', 'runs', 'wrap-up-session.json'), `${JSON.stringify(record, null, 2)}\n`);
  return { scratch };
}

const zshMissing = Bun.which('zsh') === null;

describe('a run record in phase wrap-up with every task ticked', () => {
  it.skipIf(zshMissing)('reads 🍅 #579 wrap-up in the zsh header', RUN_TIMEOUT, async () => {
    const { scratch } = plantWrapUpProject();
    const { repo, home, path } = { repo: scratch.repo, home: scratch.home, path: scratch.path };
    const script = [
      `source ${JSON.stringify(THEME)}`,
      `typeset -gA rafa_git; rafa_git=(top $ROOT main $ROOT branch ${BRANCH})`,
      '_rafa_prompt_live_runs $ROOT',
      'local right=\'\'',
      '_tomato_right',
      'local zero=\'%([BSUbfksu]|([FK]|){*})\'',
      'print -r -- "${(S)right//$~zero/}"',
    ].join('\n');

    const child = Bun.spawn(['zsh', '-f', '-c', script], {
      env: { PATH: path, HOME: home, ROOT: repo },
      stdout: 'pipe',
      stderr: 'pipe',
      stdin: 'ignore',
    });
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);

    expect({ code, stderr }).toEqual({ code: 0, stderr: '' });
    expect(stdout.trim()).toBe('│ 🍅 #579 wrap-up');
  });

  it('prints wrap-up beside the tasks done in rafa loop status', RUN_TIMEOUT, () => {
    const { scratch } = plantWrapUpProject();

    const run = runRafa(scratch, scratch.repo, ['loop', 'status']);

    expect(run.exitCode).toBe(0);
    expect(run.stdout.toString()).toContain(`Tasks: ${TASK_COUNT}/${TASK_COUNT} done (phase wrap-up)`);
  });
});
