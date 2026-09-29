/**
 * `resolveRunDirs` and `announceRunDirs` (`src/start/checkout.ts`).
 *
 * The first half drives the choice over stubbed git readings, so each
 * branch of it is named by what it was handed: the toplevel that is the
 * project root, a linked worktree of the same repository, a repository
 * nested in the project that is not one of its worktrees, no repository
 * at all, and two repositories with no main checkout, which must not
 * read as one repository because both answered null.
 *
 * The second half runs the real readings, `gitToplevel` and
 * `mainCheckoutOf` as the module defaults to them, over scratch
 * repositories under the temporary root: a main checkout with one
 * worktree beside it and one under its `.rafa/worktrees`, and a
 * repository of its own planted inside the main checkout. The scratch
 * repositories are made with global and system config switched off and
 * the home in the temporary root, as `project/worktree-root.test.ts`
 * makes them; the readings under test run with the process's own
 * environment, as a loop runs them.
 *
 * Two mutations of `checkout.ts` were driven over this file on
 * 2026-09-29, one run each, the module restored sha256-identical after
 * both: the checkout always answered as the project root reddened 3
 * cases (the stubbed worktree and both real worktrees), and the
 * `main !== null` check dropped reddened 1, the two-null-main-checkouts
 * case.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, afterEach, describe, expect, it } from 'bun:test';

import { setActiveOutput } from '../adapters/output/active.js';
import { CommandExit } from '../cli/command.js';
import { sinkOutput } from '../tests/output-sinks.js';

import { announceRunDirs, resolveRunDirs } from './checkout.js';

const tempRoot = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-run-checkout-')));
const gitHome = join(tempRoot, 'git-home');
mkdirSync(gitHome);

afterAll(() => {
  rmSync(tempRoot, { recursive: true, force: true });
});

afterEach(() => {
  setActiveOutput(null);
});

/** The environment the scratch repositories are made under; see the module note. */
function gitEnv(): Record<string, string | undefined> {
  const inherited = Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'));
  return {
    ...Object.fromEntries(inherited),
    HOME: gitHome,
    XDG_CONFIG_HOME: gitHome,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null',
    LC_ALL: 'C',
  };
}

/** Runs git in `cwd`, throwing with what it said when it fails. */
function git(cwd: string, args: readonly string[]): void {
  const run = spawnSync('git', [...args], { cwd, encoding: 'utf8', env: gitEnv() });
  if (run.error !== undefined) throw run.error;
  if (run.status !== 0) throw new Error(`git ${args.join(' ')}: ${run.stderr}`);
}

let planted = 0;

/** A fresh directory under the temporary root, as a real path. */
function freshDir(): string {
  planted += 1;
  const dir = join(tempRoot, `case-${String(planted)}`);
  mkdirSync(dir);
  return realpathSync(dir);
}

/** A repository at `dir` holding one empty commit. */
function initRepository(dir: string): void {
  mkdirSync(dir, { recursive: true });
  git(dir, ['init', '-q']);
  git(dir, ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'init']);
}

/** A main checkout with a worktree beside it, one under `.rafa/worktrees` and a subdirectory. */
function plantRepository(): { main: string; beside: string; nested: string; sub: string } {
  const base = freshDir();
  const main = join(base, 'main');
  initRepository(main);
  const beside = join(base, 'beside');
  const nested = join(main, '.rafa', 'worktrees', 'task');
  git(main, ['worktree', 'add', '-q', '-b', 'beside', beside]);
  git(main, ['worktree', 'add', '-q', '-b', 'nested', nested]);
  const sub = join(main, 'src', 'deep');
  mkdirSync(sub, { recursive: true });
  return { main, beside, nested, sub };
}

const ROOT = '/work/main';

/** Main checkouts by directory, answering null for any directory not listed. */
function mainCheckouts(entries: Readonly<Record<string, string | null>>, asked: string[] = []): (dir: string) => string | null {
  return (dir) => {
    asked.push(dir);
    return entries[dir] ?? null;
  };
}

describe('resolveRunDirs over stubbed readings', () => {
  it('answers the project root as the checkout when the toplevel is the project root, asking no main checkout', () => {
    const asked: string[] = [];
    const dirs = resolveRunDirs(ROOT, {
      cwd: `${ROOT}/src`,
      toplevel: () => ROOT,
      mainCheckout: mainCheckouts({}, asked),
    });

    expect(dirs).toEqual({ projectRoot: ROOT, checkout: ROOT });
    expect(asked).toEqual([]);
  });

  it('answers a linked worktree of the same repository as the checkout', () => {
    const asked: string[] = [];
    const dirs = resolveRunDirs(ROOT, {
      cwd: '/work/beside/src',
      toplevel: () => '/work/beside',
      mainCheckout: mainCheckouts({ '/work/beside': ROOT, [ROOT]: ROOT }, asked),
    });

    expect(dirs).toEqual({ projectRoot: ROOT, checkout: '/work/beside' });
    expect(asked).toEqual(['/work/beside', ROOT]);
  });

  it('reads the toplevel of the directory it is handed', () => {
    const read: string[] = [];
    resolveRunDirs(ROOT, {
      cwd: '/work/beside/src',
      toplevel: (dir) => {
        read.push(dir);
        return ROOT;
      },
    });

    expect(read).toEqual(['/work/beside/src']);
  });

  it('answers the project root for a repository nested in the project that is not one of its worktrees', () => {
    const vendored = `${ROOT}/vendor/other`;
    const dirs = resolveRunDirs(ROOT, {
      cwd: vendored,
      toplevel: () => vendored,
      mainCheckout: mainCheckouts({ [vendored]: vendored, [ROOT]: ROOT }),
    });

    expect(dirs.checkout).toBe(ROOT);
  });

  it('answers the project root when no repository holds the working directory', () => {
    const dirs = resolveRunDirs(ROOT, { cwd: '/elsewhere', toplevel: () => null });

    expect(dirs).toEqual({ projectRoot: ROOT, checkout: ROOT });
  });

  it('does not read two repositories with no main checkout as one', () => {
    // Both answer null, as a bare repository does: equal, and still no
    // evidence the toplevel belongs to the project.
    const dirs = resolveRunDirs(ROOT, {
      cwd: '/work/bare-ish',
      toplevel: () => '/work/bare-ish',
      mainCheckout: mainCheckouts({}),
    });

    expect(dirs.checkout).toBe(ROOT);
  });

  it('refuses the run with exit code 1 when git cannot answer, naming the directory and what failed', () => {
    let thrown: unknown = null;
    try {
      resolveRunDirs(ROOT, {
        cwd: '/work/broken',
        toplevel: () => {
          throw new Error('git could not run');
        },
      });
    } catch (error) {
      thrown = error;
    }

    if (!(thrown instanceof CommandExit)) throw new Error(`expected a CommandExit, got ${String(thrown)}`);
    expect(thrown.exitCode).toBe(1);
    expect(thrown.message).toBe('❌ Refusing to start: the checkout the loop would run in could not be read from /work/broken: git could not run');
  });

  it('refuses the run when the main checkout reading throws, too', () => {
    const run = (): unknown => resolveRunDirs(ROOT, {
      cwd: '/work/beside',
      toplevel: () => '/work/beside',
      mainCheckout: () => {
        throw new Error('listing failed');
      },
    });

    expect(run).toThrow(CommandExit);
  });
});

describe('resolveRunDirs over scratch repositories', () => {
  const repository = plantRepository();

  it('answers the main checkout from a subdirectory of it', () => {
    expect(resolveRunDirs(repository.main, { cwd: repository.sub })).toEqual({
      projectRoot: repository.main,
      checkout: repository.main,
    });
  });

  it('answers a worktree beside the repository as the checkout, the project root staying the main checkout', () => {
    expect(resolveRunDirs(repository.main, { cwd: repository.beside })).toEqual({
      projectRoot: repository.main,
      checkout: repository.beside,
    });
  });

  it('answers a worktree under .rafa/worktrees as the checkout', () => {
    expect(resolveRunDirs(repository.main, { cwd: repository.nested }).checkout).toBe(repository.nested);
  });

  it('answers the project root from a repository of its own inside the main checkout', () => {
    const vendored = join(repository.main, 'vendor', 'other');
    initRepository(vendored);

    expect(resolveRunDirs(repository.main, { cwd: vendored }).checkout).toBe(repository.main);
  });

  it('answers the project root from a directory no repository holds', () => {
    const outside = freshDir();

    expect(resolveRunDirs(outside, { cwd: outside })).toEqual({ projectRoot: outside, checkout: outside });
  });
});

describe('announceRunDirs', () => {
  it('names the checkout and the project root when they differ', () => {
    const lines: string[] = [];
    setActiveOutput(sinkOutput({ info: (line) => lines.push(line) }));

    announceRunDirs({ projectRoot: ROOT, checkout: '/work/beside' });

    expect(lines).toEqual([
      '🌿 Running in the checkout /work/beside; config, plans, runs and the store are read under /work/main.',
    ]);
  });

  it('prints nothing when the checkout is the project root', () => {
    const lines: string[] = [];
    setActiveOutput(sinkOutput({ info: (line) => lines.push(line), warn: (line) => lines.push(line) }));

    announceRunDirs({ projectRoot: ROOT, checkout: ROOT });

    expect(lines).toEqual([]);
  });
});
