/**
 * A spawned `bun src/rafa.ts next --dry-run` beside a live run record
 * whose task has left uncommitted edits in the checkout (#444).
 *
 * `src/next/state-live-run.test.ts` drives the table's order over fakes
 * of git; nothing there runs the registered command over a real
 * repository. This file does: the record is planted with this test
 * process's own pid, so it reads `running`, a tracked file is edited
 * and an untracked one is added, and the command has to answer row 1,
 * `loop-running`, and never the working-tree advice (commit or set the
 * edits aside). A control with no record beside the same edits has to
 * answer `tree-modified`, so a command that never read the tree would
 * fail the pair.
 *
 * The stand-in `gh` answers an empty `pr list` and fails loudly on
 * anything else.
 */
import type { ScratchRepo } from './cli-capture.js';

import { execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { beginSession } from '../loop/sessions.js';
import { projectConfigText } from '../project/scaffold.js';

import { expectExit, plantProjectConfig, plantScratchRepo, runRafa } from './cli-capture.js';
import { gitIdentityEnv } from './git-identity.js';

const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-next-beside-loop-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

const STUB = 'rafa-444-beside-a-loop';
const SESSION = '20260929-101500-beef';

/** A scratch project on `main` with a pushed commit, a stand-in `gh`, and edits to tracked files. */
function plantEdited(): ScratchRepo {
  const scratch = plantScratchRepo(tempBase, { project: false });
  plantProjectConfig(scratch.repo, `${projectConfigText()}pr:\n  provider: gh\n  base: main\n`);
  const env = { ...process.env, HOME: scratch.home, GIT_CONFIG_GLOBAL: join(scratch.home, '.gitconfig'), GIT_CONFIG_NOSYSTEM: '1', ...gitIdentityEnv() };
  const git = (args: readonly string[]): void => {
    execFileSync('git', args, { cwd: scratch.repo, stdio: 'pipe', env });
  };
  git(['config', 'user.name', 'rafa tests']);
  git(['config', 'user.email', 'tests@example.com']);
  git(['symbolic-ref', 'HEAD', 'refs/heads/main']);
  writeFileSync(join(scratch.repo, '.gitignore'), '.rafa/\n', 'utf8');
  writeFileSync(join(scratch.repo, 'README.md'), 'a scratch repository\n', 'utf8');
  git(['add', '.gitignore', 'README.md']);
  git(['commit', '-q', '-m', 'init']);
  const bare = join(dirname(scratch.repo), 'origin.git');
  git(['init', '-q', '--bare', bare]);
  git(['remote', 'add', 'origin', bare]);
  git(['push', '-q', '-u', 'origin', 'main']);

  writeFileSync(join(scratch.repo, 'README.md'), 'edited by the loop task\n', 'utf8');
  writeFileSync(join(scratch.repo, 'new-file.ts'), 'export {};\n', 'utf8');

  const gh = join(scratch.bin, 'gh');
  writeFileSync(gh, [
    '#!/bin/sh',
    'if [ "$1" = "pr" ] && [ "$2" = "list" ]; then printf \'%s\' \'[]\'; exit 0; fi',
    'echo "the stand-in gh was asked $*" >&2',
    'exit 1',
    '',
  ].join('\n'), 'utf8');
  chmodSync(gh, 0o755);
  return scratch;
}

/** Plants a live record: this test process's pid is alive, so it reads `running`. */
function plantLiveRun(scratch: ScratchRepo): void {
  beginSession(scratch.repo, {
    sessionId: SESSION,
    planStub: STUB,
    plan: `.rafa/plans/${STUB}.md`,
    branch: `feat/${STUB}`,
    pid: process.pid,
    startedAt: new Date().toISOString(),
  });
}

describe('rafa next --dry-run beside a live run with uncommitted task edits', () => {
  it('answers the running-loop row and offers no working-tree advice', () => {
    const scratch = plantEdited();
    plantLiveRun(scratch);

    const run = runRafa(scratch, scratch.repo, ['next', '--dry-run']);

    expectExit(run, 0, scratch);
    expect(run.stdout).toContain(`session ${SESSION}`);
    expect(run.stdout).toContain('rafa loop status');
    expect(run.stdout).not.toContain('working tree');
    expect(run.stdout).not.toContain('README.md');
    expect(run.stdout).not.toContain('new-file.ts');
  });

  it('control: the same edits with no run record answer the working-tree line', () => {
    const scratch = plantEdited();

    const run = runRafa(scratch, scratch.repo, ['next', '--dry-run']);

    expectExit(run, 0, scratch);
    expect(run.stdout).toContain('the working tree at');
    expect(run.stdout).not.toContain(`session ${SESSION}`);
  });
});
