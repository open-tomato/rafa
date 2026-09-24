/**
 * A scratch repository for tests that read `rafa cleanup`'s groups over
 * real git: a bare remote, a clone of it, and in the clone one branch
 * of every kind the command lists, and one worktree of every kind it
 * marks. Not a test file, so `check-types` opens it; it is not
 * re-exported from `./index.js`, because the loop has no use for it.
 *
 * ## What it builds
 *
 * Branches, by the group `readCleanup` puts them in:
 *
 * - `merged`: pushed, and merged into `main` with a merge commit.
 * - `squashed`: pushed, and squash-merged into `main`, so `main` does
 *   not reach it. Only a provider naming its pull request reads it as
 *   merged; {@link ScratchRepository.squashedTip} is the head commit
 *   such a pull request carries.
 * - `stale`: pushed, in sync with its upstream, and last committed 90
 *   days before {@link SCRATCH_NOW}.
 * - `unpushed`: two commits and no upstream.
 * - `gone`: pushed, then deleted in the remote; `[gone]` once a fetch
 *   has pruned it.
 *
 * Worktrees, under `<clone>/.claude/worktrees/`:
 *
 * - `wt-clean` on `wt-clean`, a branch merged into `main`.
 * - `wt-dirty` on `wt-dirty`, with an untracked file.
 * - `wt-locked` on `wt-locked`, locked with a reason.
 *
 * The last two branches are pushed and recent, so they are in no
 * group and only their worktrees show. Every commit but `stale`'s is
 * dated {@link SCRATCH_NOW}, so a reading taken with that clock finds
 * `stale` 90 days idle and nothing else old.
 *
 * Git runs with a fixed identity and without the user's or the
 * system's configuration.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** The moment every commit is dated, except `stale`'s. */
export const SCRATCH_NOW = new Date('2026-09-24T12:00:00Z');

/** How many days before {@link SCRATCH_NOW} the `stale` branch was last committed. */
export const STALE_AGE_DAYS = 90;

/** The lock reason `wt-locked` carries. */
export const LOCK_REASON = 'scratch lock';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** What {@link createScratchRepository} built. */
export interface ScratchRepository {
  /** The directory everything is under, symlinks resolved. */
  readonly root: string;
  /** The bare remote. */
  readonly bare: string;
  /** The clone, on `main`. */
  readonly clone: string;
  /** An empty home directory, for `~/.rafa/worktrees/`. */
  readonly home: string;
  /** The worktree paths by name. */
  readonly worktrees: Readonly<Record<'clean' | 'dirty' | 'locked', string>>;
  /** The tip of `squashed`, which a pull request's head commit would be. */
  readonly squashedTip: string;
  /** Runs git in `cwd` (the clone by default) and answers stdout, throwing on failure. */
  readonly git: (args: readonly string[], cwd?: string) => string;
  /** Removes everything. */
  readonly dispose: () => void;
}

/** Builds the repository the module note describes, in a fresh temporary directory. */
export function createScratchRepository(): ScratchRepository {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-cleanup-')));
  const bare = join(root, 'remote.git');
  const clone = join(root, 'clone');
  const home = join(root, 'home');
  mkdirSync(home);

  const dated = (at: Date): Record<string, string> => ({
    GIT_AUTHOR_DATE: at.toISOString(),
    GIT_COMMITTER_DATE: at.toISOString(),
  });
  const run = (args: readonly string[], cwd: string, at: Date = SCRATCH_NOW): string => {
    const result = spawnSync('git', [...args], {
      cwd,
      encoding: 'utf8',
      env: {
        PATH: process.env['PATH'],
        LC_ALL: 'C',
        GIT_AUTHOR_NAME: 'Test',
        GIT_AUTHOR_EMAIL: 'test@example.com',
        GIT_COMMITTER_NAME: 'Test',
        GIT_COMMITTER_EMAIL: 'test@example.com',
        GIT_CONFIG_GLOBAL: '/dev/null',
        GIT_CONFIG_NOSYSTEM: '1',
        ...dated(at),
      },
    });
    if (result.status !== 0) {
      throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
    }
    return result.stdout;
  };
  const git = (args: readonly string[], cwd: string = clone): string => run(args, cwd);
  const commit = (message: string, at: Date = SCRATCH_NOW): void => {
    run(['commit', '--quiet', '--allow-empty', '-m', message], clone, at);
  };
  /** A branch off `main` with `commits` commits, pushed unless `push` is false. */
  const branch = (name: string, commits: number, push: boolean, at: Date = SCRATCH_NOW): void => {
    git(['switch', '--quiet', '-c', name, 'main']);
    for (let index = 1; index <= commits; index += 1) {
      commit(`${name} ${String(index)}`, at);
    }
    if (push) {
      git(['push', '--quiet', '-u', 'origin', name]);
    }
    git(['switch', '--quiet', 'main']);
  };

  try {
    run(['init', '--quiet', '--bare', '--initial-branch=main', bare], root);
    run(['clone', '--quiet', bare, clone], root);
    commit('first');
    git(['push', '--quiet', '-u', 'origin', 'main']);

    const staleAt = new Date(SCRATCH_NOW.getTime() - STALE_AGE_DAYS * MS_PER_DAY);
    branch('merged', 1, true);
    branch('squashed', 1, true);
    branch('stale', 1, true, staleAt);
    branch('unpushed', 2, false);
    branch('gone', 1, true);
    branch('wt-clean', 1, true);
    branch('wt-dirty', 1, true);
    branch('wt-locked', 1, true);

    git(['merge', '--quiet', '--no-ff', '-m', 'merge merged', 'merged']);
    git(['merge', '--quiet', '--no-ff', '-m', 'merge wt-clean', 'wt-clean']);
    git(['merge', '--quiet', '--squash', 'squashed']);
    commit('squash squashed');
    git(['push', '--quiet', 'origin', 'main']);
    git(['push', '--quiet', 'origin', '--delete', 'gone'], clone);

    const parent = join(clone, '.claude', 'worktrees');
    mkdirSync(parent, { recursive: true });
    const worktrees = {
      clean: join(parent, 'wt-clean'),
      dirty: join(parent, 'wt-dirty'),
      locked: join(parent, 'wt-locked'),
    };
    git(['worktree', 'add', '--quiet', worktrees.clean, 'wt-clean']);
    git(['worktree', 'add', '--quiet', worktrees.dirty, 'wt-dirty']);
    git(['worktree', 'add', '--quiet', worktrees.locked, 'wt-locked']);
    writeFileSync(join(worktrees.dirty, 'scratch.txt'), 'uncommitted\n');
    git(['worktree', 'lock', '--reason', LOCK_REASON, worktrees.locked]);

    return {
      root,
      bare,
      clone,
      home,
      worktrees,
      squashedTip: git(['rev-parse', 'refs/heads/squashed']).trim(),
      git,
      dispose: () => {
        rmSync(root, { recursive: true, force: true });
      },
    };
  } catch (error) {
    rmSync(root, { recursive: true, force: true });
    throw error;
  }
}
