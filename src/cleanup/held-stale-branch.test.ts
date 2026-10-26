/**
 * `rafa cleanup` end to end over a scratch repository from
 * `./scratch-repository.ts` in which the Stale branch `stale` is checked
 * out in a dirty worktree (#852): the listing shows the branch unticked
 * with the worktree named, and a run with the branch ticked leaves it in
 * place and prints it as withheld.
 *
 * Real git throughout: the reading, the worktree marks and the delete
 * steps. Only the terminal and its keys are scripted. The control is the
 * `git branch --list` after the run: `stale` is still there, while the
 * Merged branches the same keys leave ticked are gone, so a run that
 * deleted nothing at all would not pass.
 */
import type { ScratchRepository } from './scratch-repository.js';
import type { Key, Terminal } from '../cli/prompt/terminal.js';

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';

import { cleanupGroups, createCleanupCommand } from '../commands/cleanup.js';
import { createPullRequestsDouble } from '../pr/pull-requests-double.js';
import { dispatchInProject, plantProjectConfig } from '../tests/cli-capture.js';

import { createScratchRepository, SCRATCH_NOW } from './scratch-repository.js';

import { readCleanup, defaultCleanupSeams } from './index.js';

const HOLDER = 'wt-stale';

const DOWN: Key = { name: 'down' };
const ENTER: Key = { name: 'enter' };
const SPACE: Key = { name: 'char', char: ' ' };

function terminal(isTTY: boolean): Terminal {
  return {
    isTTY,
    setRawMode: () => undefined,
    write: () => undefined,
    onInterrupt: () => () => undefined,
    exit: () => undefined,
  };
}

describe('rafa cleanup over a Stale branch checked out in a dirty worktree', () => {
  let repo: ScratchRepository;
  let project: { readonly root: string; readonly home: string };
  let holderPath: string;

  beforeAll(() => {
    repo = createScratchRepository();
    holderPath = join(repo.clone, '.claude', 'worktrees', HOLDER);
    repo.git(['worktree', 'add', '--quiet', holderPath, 'stale']);
    writeFileSync(join(holderPath, 'scratch.txt'), 'uncommitted\n');
    plantProjectConfig(repo.clone);
    project = { root: repo.clone, home: repo.home };
  });

  afterAll(() => {
    repo.dispose();
  });

  const command = (isTTY: boolean, keys: readonly Key[], answers: string[]): ReturnType<typeof createCleanupCommand> => createCleanupCommand({
    cwd: () => repo.clone,
    now: () => SCRATCH_NOW,
    readRemote: () => null,
    pullRequests: () => createPullRequestsDouble().pulls,
    terminal: () => terminal(isTTY),
    keys: () => (async function* script(): AsyncGenerator<Key, void, undefined> {
      yield* keys;
    })(),
    openPrompter: () => ({
      say: () => undefined,
      ask: () => Promise.resolve(answers.shift() ?? null),
      close: () => undefined,
    }),
  });

  /** The keys that tick the Stale row, a toggle on the row, then Enter. */
  async function staleKeys(): Promise<readonly Key[]> {
    const reading = await readCleanup(defaultCleanupSeams(repo.clone, null), {
      fetch: true,
      base: null,
      keep: [],
      staleDays: 30,
      worktreeIdleDays: 0,
      now: SCRATCH_NOW,
      home: repo.home,
      cwd: repo.clone,
      projectRoot: repo.clone,
      worktreeDir: '.rafa/worktrees',
    });
    if (!reading.ok) throw new Error(reading.detail);
    const rows = cleanupGroups(reading).flatMap((group) => group.choices.map((choice) => choice.value));
    const index = rows.findIndex((row) => 'branch' in row && row.branch.name === 'stale');
    expect(index).toBeGreaterThanOrEqual(0);
    return [...Array.from({ length: index }, () => DOWN), SPACE, ENTER];
  }

  it('lists the branch unticked with the worktree named', async () => {
    const run = await dispatchInProject(['cleanup'], [], [command(false, [], [])], project);

    expect(run.exitCode).toBe(0);
    const line = run.stdout.split('\n').find((text) => text.includes('no commit in 90 days'));
    expect(line).toBeDefined();
    expect(line).toContain('stale');
    expect(line).toContain(`checked out in ${HOLDER} (dirty`);
  });

  it('leaves the branch in place when ticked, and prints it as withheld', async () => {
    const keys = await staleKeys();

    const run = await dispatchInProject(['cleanup'], [], [command(true, keys, ['y'])], project);

    const branches = repo.git(['branch', '--list', '--format=%(refname:short)']).split('\n');
    expect(run.exitCode).toBe(0);
    expect(run.stdout).toContain('not removed: stale: checked out in ' + HOLDER);
    expect(run.stdout).not.toContain('branch -D stale');
    expect(branches).toContain('stale');
    expect(branches).not.toContain('merged');
  });
});
