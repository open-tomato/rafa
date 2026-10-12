/**
 * `rafa next --dry-run` spawned for real in a scratch repository with a
 * linked worktree, over session records planted under `.rafa/runs/` with
 * a live pid (#444).
 *
 * The edits in a checkout are a loop's only when a live run works in that
 * checkout. A record with no `worktree` works in the main checkout, so a
 * modified tracked file there is row 1, `loop-running`, and is never
 * offered back to the person. A record naming the linked worktree works
 * elsewhere, so the same edit is the person's: `tree-modified`, the line
 * naming the main checkout. Run from inside the linked worktree, the
 * answer and the path named are the same, since the tree read is the
 * project root's.
 *
 * The live pid is this test process's own. Every case builds its
 * environment through `runRafa`, which starts from nothing, so no
 * `CLAUDECODE` leaks in.
 */
import type { ScratchRepo } from '../tests/cli-capture.js';

import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';

import { expectExit, plantProjectConfig, plantScratchRepo, runRafa } from '../tests/cli-capture.js';
import { gitIdentityEnv } from '../tests/git-identity.js';
import { plantStandInGh } from '../tests/stand-in-gh.js';

const SESSION = '20261012-101500-beef';
const STUB = 'rafa-444-live-run';
const TRACKED = 'tracked.txt';
const EDITS_LINE = 'commit or set aside';

const scratchBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-next-worktree-')));
afterAll(() => {
  rmSync(scratchBase, { recursive: true, force: true });
});

/** Runs git in `cwd` under the scratch HOME and a fixed identity. */
function git(scratch: ScratchRepo, cwd: string, args: readonly string[]): void {
  execFileSync('git', [...args], {
    cwd,
    stdio: 'pipe',
    env: {
      ...process.env,
      HOME: scratch.home,
      GIT_CONFIG_GLOBAL: join(scratch.home, '.gitconfig'),
      GIT_CONFIG_NOSYSTEM: '1',
      ...gitIdentityEnv(),
    },
  });
}

/** Plants the live session record; `worktree` is left out for a main-checkout run. */
function plantRun(repo: string, worktree: string | null): void {
  const dir = join(repo, '.rafa', 'runs');
  mkdirSync(dir, { recursive: true });
  const record = {
    sessionId: SESSION,
    planStub: STUB,
    plan: `.rafa/plans/PLAN-${STUB}.md`,
    branch: `feat/${STUB}`,
    pid: process.pid,
    startedAt: '2026-10-12T10:15:00Z',
    state: 'running',
    task: { line: 3, text: 'the third task' },
    ...(worktree === null
      ? {}
      : { worktree }),
  };
  writeFileSync(join(dir, `${SESSION}.json`), `${JSON.stringify(record, null, 2)}\n`, 'utf8');
}

let scratch: ScratchRepo;
let linked: string;

beforeAll(() => {
  scratch = plantScratchRepo(scratchBase);
  plantProjectConfig(scratch.repo, 'pr:\n  provider: gh\n  base: main\n');
  plantStandInGh(scratch.bin, 'signed-in');
  // `.rafa/` is gitignored in a real project, so a linked worktree holds none of its own.
  appendFileSync(join(scratch.repo, '.git', 'info', 'exclude'), '.rafa/\n', 'utf8');
  writeFileSync(join(scratch.repo, TRACKED), 'one\n', 'utf8');
  git(scratch, scratch.repo, ['checkout', '-q', '-b', 'main']);
  git(scratch, scratch.repo, ['add', '-A']);
  git(scratch, scratch.repo, ['commit', '-q', '-m', 'seed']);
  linked = join(scratch.home, '..', 'linked');
  git(scratch, scratch.repo, ['worktree', 'add', '-q', '-b', `feat/${STUB}`, linked]);
  linked = realpathSync(linked);
  // The edit under test: a tracked file in the main checkout, modified.
  writeFileSync(join(scratch.repo, TRACKED), 'two\n', 'utf8');
});

describe('rafa next --dry-run beside a loop and a modified main checkout, spawned', () => {
  it('answers loop-running (row 1), offering nothing back, for a run with no worktree', () => {
    // Arrange
    plantRun(scratch.repo, null);

    // Act
    const run = runRafa(scratch, scratch.repo, ['next', '--dry-run']);

    // Assert
    expectExit(run, 0, scratch);
    expect(run.stdout).toContain(`a loop for \`${STUB}\` is running`);
    expect(run.stdout).not.toContain(EDITS_LINE);
    expect(run.stdout).not.toContain('tracked file');
  }, { timeout: 60_000 });

  it('answers tree-modified (the tree line), naming the main checkout, for a run in the linked worktree', () => {
    // Arrange
    plantRun(scratch.repo, linked);

    // Act
    const run = runRafa(scratch, scratch.repo, ['next', '--dry-run']);

    // Assert
    expectExit(run, 0, scratch);
    expect(run.stdout).toContain(`the working tree at \`${scratch.repo}\` has changes to 1 tracked file`);
    expect(run.stdout).toContain(EDITS_LINE);
    expect(run.stdout).not.toContain('is running');
  }, { timeout: 60_000 });

  it('answers the same, naming the same path, run from inside the linked worktree', () => {
    // Arrange
    plantRun(scratch.repo, linked);

    // Act
    const run = runRafa(scratch, linked, ['next', '--dry-run']);

    // Assert
    expectExit(run, 0, scratch);
    expect(run.stdout).toContain(`the working tree at \`${scratch.repo}\` has changes to 1 tracked file`);
    expect(run.stdout).toContain(EDITS_LINE);
  }, { timeout: 60_000 });
});
