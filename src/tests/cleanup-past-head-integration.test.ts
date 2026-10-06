/**
 * `rafa cleanup --dry-run`, dispatched, over the past-head set of
 * `src/cleanup/scratch-repository.ts` and real git (#710, #149):
 *
 *  - `wt-held`, held by a recent worktree, and `gone`, which no pull
 *    request names, and `source`, whose commit past its head touches a
 *    source file, start unticked with their reasons (the screen the rows are drawn on is captured);
 *  - `fragment`, one commit past its head that adds a fragment `main`
 *    holds, starts unticked too; ticked, it prints `git branch -D`;
 *  - accepting the defaults (Enter) exits 0 and removes nothing.
 *
 * The pull request provider is a double naming the pull requests of
 * `squashed`, `fragment` and `source`.
 */
import type { ScratchRepository } from '../cleanup/scratch-repository.js';
import type { Prompter } from '../cli/prompt/confirm.js';
import type { Key, Terminal } from '../cli/prompt/terminal.js';
import type { CleanupCommandSeams } from '../commands/cleanup.js';

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';

import { createScratchRepository, SCRATCH_LATER, SCRATCH_NOW } from '../cleanup/scratch-repository.js';
import { createCleanupCommand } from '../commands/cleanup.js';
import { createPullRequestsDouble } from '../pr/pull-requests-double.js';

import { dispatchInProject, plantProjectConfig } from './cli-capture.js';

const ENTER: Key = { name: 'enter' };
const SPACE: Key = { name: 'char', char: ' ' };

let repo: ScratchRepository;
let stdout: string;
let stderr: string;
let exitCode: number;
let before: string;
let screen = '';

/** The local branches and their tips, one per line. */
function heads(): string {
  return repo.git(['for-each-ref', '--format=%(refname:short) %(objectname)', 'refs/heads']);
}

/** The lines of the printout naming `branch`. */
function linesOf(branch: string): string[] {
  return `${screen}\n${stdout}`.split('\n').filter((line) => line.includes(branch));
}

beforeAll(async () => {
  repo = createScratchRepository({ pastHead: true });
  plantProjectConfig(repo.clone);
  before = heads();
  const past = repo.pastHead;
  if (past === null) throw new Error('the past-head set was not built');
  const merged = (number: number, name: string, oid: string): {
    number: number; headRefName: string; headRefOid: string; mergedAt: string;
  } => ({ number, headRefName: name, headRefOid: oid, mergedAt: SCRATCH_NOW.toISOString() });
  const double = createPullRequestsDouble({
    listMerged: () => Promise.resolve([
      merged(7, 'squashed', repo.squashedTip),
      merged(8, 'fragment', past.fragmentHead),
      merged(9, 'source', past.sourceHead),
    ]),
  });
  const terminal: Terminal = {
    isTTY: true,
    setRawMode: () => undefined,
    write: (text) => {
      screen += text;
    },
    onInterrupt: () => () => undefined,
    exit: () => undefined,
  };
  const seams: CleanupCommandSeams = {
    now: () => SCRATCH_LATER,
    readRemote: () => 'git@github.com:open-tomato/scratch.git',
    pullRequests: () => double.pulls,
    terminal: () => terminal,
    keys: async function* (): AsyncGenerator<Key> {
      // The cursor starts on `fragment`, the first Merged row: tick it.
      yield SPACE;
      yield ENTER;
    },
    openPrompter: (): Prompter => ({
      say: () => undefined,
      ask: () => Promise.reject(new Error('--dry-run asks nothing')),
      close: () => undefined,
    }),
  };
  const run = await dispatchInProject(
    ['cleanup', '--dry-run'],
    [],
    [createCleanupCommand({ ...seams, cwd: () => repo.clone })],
    { root: repo.clone, home: repo.home },
  );
  ({ stdout, stderr, exitCode } = run);
});

afterAll(() => {
  repo.dispose();
});

describe('rafa cleanup --dry-run over the past-head set', () => {
  it('starts the held, gone-only and source-commit rows unticked, and the held-fragment row too', () => {
    for (const name of ['wt-held', 'gone', 'source', 'fragment']) {
      expect(screen).toMatch(new RegExp(`◯ ${name} `));
    }
  });

  it('accepts the defaults, exits 0 and removes nothing', () => {
    expect(stderr).toBe('');
    expect(exitCode).toBe(0);
    expect(heads()).toBe(before);
  });

  it('prints git branch -D for the branch one held fragment past its head, and no other', () => {
    expect(stdout).toContain('git branch -D fragment');
    expect(stdout).not.toContain('git branch -D source');
    expect(stdout).not.toContain('git branch -D gone');
    expect(stdout).not.toContain('git branch -d wt-held');
    expect(stdout).not.toContain('git branch -D wt-held');
  });

  it('names the commit past the head of the held-fragment branch', () => {
    expect(linesOf('fragment').join('\n')).toContain('1 commit past #8\'s head: fragment past the head');
  });

  it('leaves the source-commit branch unticked, naming its commit', () => {
    expect(linesOf('source').join('\n')).toContain('1 commit past #9\'s head: source past the head');
  });

  it('leaves the gone-only branch unticked, saying main does not reach its tip', () => {
    expect(linesOf('gone').join('\n')).toContain('main does not reach its tip');
  });

  it('leaves the branch a recent worktree holds unticked, naming the worktree', () => {
    expect(linesOf('wt-held').join('\n')).toContain('checked out in wt-held (recent)');
  });
});
