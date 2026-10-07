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
 * ## The worktrees are dated too
 *
 * The idle rule reads a worktree's age off file times, not commits:
 * the worktree directory and the {@link ADMIN_FILES} of its
 * administrative directory (`./worktrees.ts`). Git writes those at the
 * real moment the repository is built, so each of them is set to
 * {@link SCRATCH_NOW} once everything else is done. Left at the real
 * time, a reading with the {@link SCRATCH_NOW} clock would find every
 * worktree modified AFTER its own clock once the calendar passed that
 * date; a negative age is below any `cleanup.worktreeIdleDays`, zero
 * included, so each worktree read `recent`. That is why three cases of
 * `./scratch-repository.test.ts` read red from 2026-09-24 12:00 UTC on,
 * measured on 2026-09-28 in a plain clone and in a linked worktree alike.
 *
 * ## The past-head set, on request
 *
 * `createScratchRepository({ pastHead: true })` adds, to everything
 * above, the branches `readCleanup` reads for a squash-merged branch
 * past its pull request's head (#710, #149). The default build leaves
 * them out, so the readers of the five groups above keep their lists:
 *
 * - `wt-held`: pushed and merged into `main` with a merge commit, and
 *   checked out in `.claude/worktrees/wt-held`, whose file times are
 *   {@link SCRATCH_LATER}: a reading with that clock finds it `recent`,
 *   so the worktree cannot be ticked and its branch starts unticked.
 * - `fragment`: pushed, squash-merged into `main` (which also holds
 *   `.changes/{@link FRAGMENT_ID}.md`), then one local commit past the
 *   head adding that same fragment file; its remote branch is deleted,
 *   so it is `[gone]`. {@link ScratchPastHead.fragmentHead} is its head.
 * - `source`: the same, but its extra commit touches `src/extra.ts`.
 *   {@link ScratchPastHead.sourceHead} is its head.
 *
 * `gone`, above, is the gone-only branch: no pull request names it.
 *
 * Git runs with the fixed test identity of `../tests/git-identity.ts`
 * and without the user's or the system's configuration.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { gitIdentityEnv } from '../tests/git-identity.js';

import { ADMIN_FILES, GIT_DIR } from './worktrees.js';

/** The moment every commit is dated, except `stale`'s. */
export const SCRATCH_NOW = new Date('2026-09-24T12:00:00Z');

/** How many days before {@link SCRATCH_NOW} the `stale` branch was last committed. */
export const STALE_AGE_DAYS = 90;

/** The lock reason `wt-locked` carries. */
export const LOCK_REASON = 'scratch lock';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** How many days past {@link SCRATCH_NOW} {@link SCRATCH_LATER} is. */
const LATER_DAYS = 30;

/**
 * The clock a past-head reading runs with: the worktree `wt-held` is
 * dated to it, so it is no idle at all and reads `recent`.
 */
export const SCRATCH_LATER = new Date(SCRATCH_NOW.getTime() + LATER_DAYS * MS_PER_DAY);

/** The id of the release fragment `main` holds and `fragment` commits past its head. */
export const FRAGMENT_ID = 'rafa-901';

const FRAGMENT_PATH = `.changes/${FRAGMENT_ID}.md`;

/** What the past-head set adds; see the module note. */
export interface ScratchPastHead {
  /** The head commit of `fragment`'s pull request. */
  readonly fragmentHead: string;
  /** The head commit of `source`'s pull request. */
  readonly sourceHead: string;
  /** The path of the worktree holding `wt-held`. */
  readonly heldWorktree: string;
}

/** What {@link createScratchRepository} can be asked for. */
export interface ScratchOptions {
  /** Add the past-head set of the module note; false when left out. */
  readonly pastHead?: boolean;
}

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
  /** The past-head set; null unless {@link ScratchOptions.pastHead} asked for it. */
  readonly pastHead: ScratchPastHead | null;
  /** The tip of `squashed`, which a pull request's head commit would be. */
  readonly squashedTip: string;
  /** Runs git in `cwd` (the clone by default) and answers stdout, throwing on failure. */
  readonly git: (args: readonly string[], cwd?: string) => string;
  /** Removes everything. */
  readonly dispose: () => void;
}

/** Builds the repository the module note describes, in a fresh temporary directory. */
export function createScratchRepository(options: ScratchOptions = {}): ScratchRepository {
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
        ...gitIdentityEnv(),
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

  /** Commits `content` at `path` in the clone, on the branch it is on. */
  const commitFile = (path: string, content: string, message: string): void => {
    mkdirSync(dirname(join(clone, path)), { recursive: true });
    writeFileSync(join(clone, path), content);
    git(['add', '--', path]);
    commit(message);
  };
  /**
   * A branch squash-merged into `main` (which gains the fragment file with
   * it), then one local commit past the head, touching `pastPath`; pushed
   * before, so its remote branch can be deleted. Answers the head.
   */
  const squashedPastHead = (name: string, pastPath: string): string => {
    git(['switch', '--quiet', '-c', name, 'main']);
    commitFile(`${name}.txt`, `${name}\n`, `${name} 1`);
    git(['push', '--quiet', '-u', 'origin', name]);
    const head = git(['rev-parse', 'HEAD']).trim();
    git(['switch', '--quiet', 'main']);
    git(['merge', '--quiet', '--squash', name]);
    if (name === 'fragment') {
      commitFile(FRAGMENT_PATH, 'fragment\n', `squash ${name}`);
    } else {
      commit(`squash ${name}`);
    }
    git(['switch', '--quiet', name]);
    commitFile(pastPath, `${name} past the head\n`, `${name} past the head`);
    git(['switch', '--quiet', 'main']);
    return head;
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
    let pastHead: Pick<ScratchPastHead, 'fragmentHead' | 'sourceHead'> | null = null;
    if (options.pastHead === true) {
      branch('wt-held', 1, true);
      git(['merge', '--quiet', '--no-ff', '-m', 'merge wt-held', 'wt-held']);
      pastHead = {
        fragmentHead: squashedPastHead('fragment', FRAGMENT_PATH),
        sourceHead: squashedPastHead('source', 'src/extra.ts'),
      };
    }
    git(['push', '--quiet', 'origin', 'main']);
    git(['push', '--quiet', 'origin', '--delete', 'gone'], clone);
    if (pastHead !== null) {
      git(['push', '--quiet', 'origin', '--delete', 'fragment', 'source'], clone);
    }

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
    const heldWorktree = join(parent, 'wt-held');
    if (pastHead !== null) {
      git(['worktree', 'add', '--quiet', heldWorktree, 'wt-held']);
    }
    git(['worktree', 'lock', '--reason', LOCK_REASON, worktrees.locked]);
    // Last, so no git call after it moves a time again; see the module note.
    const datedAt = new Map<string, Date>(Object.values(worktrees).map((path) => [path, SCRATCH_NOW]));
    if (pastHead !== null) {
      datedAt.set(heldWorktree, SCRATCH_LATER);
    }
    for (const [path, at] of datedAt) {
      const adminDir = git(GIT_DIR, path).trim();
      for (const file of [path, ...ADMIN_FILES.map((name) => join(adminDir, name))]) {
        utimesSync(file, at, at);
      }
    }

    return {
      root,
      bare,
      clone,
      home,
      worktrees,
      pastHead: pastHead === null
        ? null
        : { ...pastHead, heldWorktree },
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
