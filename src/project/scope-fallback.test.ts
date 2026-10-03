/**
 * Tests for the fallback of scope resolution to the main checkout: a
 * walk from a linked worktree that finds no `.rafa/config.yaml` answers
 * the main checkout's `.rafa/` when it holds one.
 *
 * Cases on DISK run the real git in scratch repositories under this
 * file's temporary root: a main checkout with one worktree beside it and
 * one under its `.rafa/worktrees`, as `worktree-root.test.ts` plants
 * them. Every git here runs with its global and system config switched
 * off and its home in the temporary root, the `mainCheckout` seam
 * included, so no case reads the operator's repository or config. One
 * case leaves the seam out, to read that the default reaches git at all.
 * Cases whose answer turns on a path the walk passed, the home, or a
 * git that fails use an in-memory tree and a `mainCheckout` of their own.
 *
 * Each rule is paired with the reading that makes it one: the worktree
 * beside the main checkout found through the fallback beside the same
 * start with a seam answering no repository, which finds nothing; the
 * main checkout the hint names beside the same start once the checkout
 * holds the file; the home refused as a fallback beside a home pointed
 * elsewhere taking the same checkout; the main checkout answered from a
 * worktree beside it under a parent folder holding its own
 * `.rafa/config.yaml` beside the same start with no fallback, which
 * answers the parent folder.
 *
 * The stop at the working tree's top level was driven the same way:
 * the stop dropped, the climb above the top level dropped, the user
 * file passed above the top level left out of the hint, and the main
 * checkout probed although it sits above the start each reddened at
 * least one case here. The worktree beside the main checkout under a
 * parent folder holding a config was read against the `scope.ts` of
 * the base commit, where it answered the parent folder and failed.
 *
 * Eight mutations of `scope.ts` were driven against this file and
 * `scope.test.ts` one at a time, each an exact string found once, with
 * `scope.ts` restored byte-identical after each, and every one reddened
 * at least one case: the fallback dropped; the check for a checkout the
 * walk passed dropped; the home taken as the checkout; the checkout left
 * out of the hint; a git refusal left unwrapped; every seam error
 * wrapped; the start asked about as spelled rather than by real path;
 * and a checkout holding the file answered as none.
 */
import type { ScopeFileSystem, ScopeResolution } from './scope.js';
import type { GitRunner } from '../pr/git.js';

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { gitIdentityEnv } from '../tests/git-identity.js';

import { initHint, resolveScope, ScopeError } from './scope.js';
import { mainCheckoutOf, WorktreeRootError } from './worktree-root.js';

const tempRoot = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-scope-fallback-')));
const gitHome = join(tempRoot, 'git-home');
mkdirSync(gitHome);
/** A home no case plants a config under, beside every repository. */
const home = join(tempRoot, 'home');

afterAll(() => {
  rmSync(tempRoot, { recursive: true, force: true });
});

/** The environment every git here runs with; see the module note. */
function gitEnv(): Record<string, string | undefined> {
  const inherited = Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'));
  return {
    ...Object.fromEntries(inherited),
    HOME: gitHome,
    XDG_CONFIG_HOME: gitHome,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null',
    ...gitIdentityEnv(),
    LC_ALL: 'C',
  };
}

/** A runner spawning the real git in `cwd` under {@link gitEnv}. */
function isolatedGit(cwd: string): GitRunner {
  return (args) => {
    const run = spawnSync('git', [...args], { cwd, encoding: 'utf8', env: gitEnv() });
    if (run.error !== undefined) throw run.error;
    return { ok: run.status === 0, stdout: run.stdout, stderr: run.stderr };
  };
}

/** The `mainCheckout` seam over the isolated git. */
function isolatedMainCheckout(dir: string): string | null {
  return mainCheckoutOf(dir, { openGit: isolatedGit });
}

/** Runs git in `cwd`, throwing with what it said when it fails. */
function git(cwd: string, args: readonly string[]): void {
  const result = isolatedGit(cwd)(args);
  if (!result.ok) throw new Error(`git ${args.join(' ')}: ${result.stderr}`);
}

let planted = 0;

/** A fresh directory under the temporary root, as a real path. */
function freshDir(): string {
  planted += 1;
  const dir = join(tempRoot, `case-${String(planted)}`);
  mkdirSync(dir);
  return dir;
}

/** Plants a config file at the literal `.rafa/config.yaml` under `dir`. */
function plantConfig(dir: string): void {
  const file = join(dir, '.rafa', 'config.yaml');
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, 'version: 1\n');
}

/** A main checkout with one commit, a worktree beside it and one under `.rafa/worktrees`. */
function plantRepository(): { base: string; main: string; beside: string; nested: string } {
  const base = freshDir();
  const main = join(base, 'main');
  mkdirSync(main);
  git(main, ['init', '-q']);
  git(main, ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'init']);
  const beside = join(base, 'beside');
  const nested = join(main, '.rafa', 'worktrees', 'task');
  git(main, ['worktree', 'add', '-q', '-b', 'beside', beside]);
  git(main, ['worktree', 'add', '-q', '-b', 'nested', nested]);
  return { base, main, beside, nested };
}

/** The root a resolution found, failing the case when it found none. */
function rootOf(resolution: ScopeResolution): string {
  if (!resolution.found) throw new Error(`expected a project, got the hint: ${resolution.hint}`);
  return resolution.root;
}

/** The hint a resolution answered, failing the case when it found a project. */
function hintOf(resolution: ScopeResolution): string {
  if (resolution.found) throw new Error(`expected the hint, got the project at ${resolution.root}`);
  return resolution.hint;
}

/** A `mainCheckout` seam answering `main` and recording each directory it is asked about. */
function recordingMainCheckout(main: string | null): { calls: string[]; seam: (dir: string) => string | null } {
  const calls: string[] = [];
  return {
    calls,
    seam: (dir) => {
      calls.push(dir);
      return main;
    },
  };
}

/** An in-memory filesystem over `dirs` and `files`, recording each path `exists` is asked about. */
function memoryFs(dirs: readonly string[], files: readonly string[]): ScopeFileSystem & { probes: string[] } {
  const present = new Set([...dirs, ...files]);
  const probes: string[] = [];
  return {
    probes,
    exists: (path) => {
      probes.push(path);
      return present.has(path);
    },
    realpath: (path) => {
      if (!present.has(path)) throw new Error(`ENOENT: no such file or directory, realpath '${path}'`);
      return path;
    },
  };
}

describe('resolveScope from a linked worktree on disk', () => {
  it('answers the main checkout from a worktree beside it, and nothing without the fallback', () => {
    const { main, beside } = plantRepository();
    plantConfig(main);

    const resolution = resolveScope(beside, { home, mainCheckout: isolatedMainCheckout });
    const withoutFallback = resolveScope(beside, { home, mainCheckout: () => null });

    expect(resolution).toEqual({
      found: true,
      root: main,
      home,
      project: { dir: join(main, '.rafa'), configFile: join(main, '.rafa', 'config.yaml') },
      user: { dir: join(home, '.rafa'), configFile: join(home, '.rafa', 'config.yaml') },
    });
    expect(hintOf(withoutFallback)).toBe(initHint(beside));
  });

  it('answers the main checkout from a directory nested in the worktree beside it', () => {
    const { main, beside } = plantRepository();
    plantConfig(main);
    const start = join(beside, 'src', 'deep');
    mkdirSync(start, { recursive: true });

    expect(rootOf(resolveScope(start, { home, mainCheckout: isolatedMainCheckout }))).toBe(main);
  });

  it('reaches git through the default seam when none is handed in', () => {
    const { main, beside } = plantRepository();
    plantConfig(main);

    expect(rootOf(resolveScope(beside, { home }))).toBe(main);
  });

  it('answers the main checkout from a worktree under its .rafa/worktrees through the fallback, stopping at its top level', () => {
    const { main, nested } = plantRepository();
    plantConfig(main);
    const { calls, seam } = recordingMainCheckout(main);

    expect(rootOf(resolveScope(nested, { home, mainCheckout: isolatedMainCheckout }))).toBe(main);
    expect(rootOf(resolveScope(nested, { home, mainCheckout: seam }))).toBe(main);
    expect(calls).toEqual([nested]);
  });

  it('runs no git from a main checkout holding the config', () => {
    const { main } = plantRepository();
    plantConfig(main);
    const { calls, seam } = recordingMainCheckout(null);

    expect(rootOf(resolveScope(join(main, '.rafa'), { home, mainCheckout: seam }))).toBe(main);
    expect(rootOf(resolveScope(main, { home, mainCheckout: seam }))).toBe(main);
    expect(calls).toEqual([]);
  });

  it('answers a worktree holding its own config as the root, not the main checkout', () => {
    const { main, beside } = plantRepository();
    plantConfig(main);
    plantConfig(beside);
    const { calls, seam } = recordingMainCheckout(main);

    expect(rootOf(resolveScope(beside, { home, mainCheckout: seam }))).toBe(beside);
    expect(calls).toEqual([]);
  });

  it('names the main checkout in the hint when it holds no config either, and finds it once it does', () => {
    const { main, beside } = plantRepository();

    const before = hintOf(resolveScope(beside, { home, mainCheckout: isolatedMainCheckout }));
    plantConfig(main);
    const after = resolveScope(beside, { home, mainCheckout: isolatedMainCheckout });

    expect(before).toBe(initHint(beside, null, main));
    expect(before).toContain(`nor in ${main}, the main checkout of the repository holding it`);
    expect(rootOf(after)).toBe(main);
  });

  it('leaves the main checkout out of the hint from the main checkout itself, which the walk passed', () => {
    const { main } = plantRepository();

    expect(hintOf(resolveScope(main, { home, mainCheckout: isolatedMainCheckout }))).toBe(initHint(main));
  });

  it('answers the plain hint in a directory no repository holds', () => {
    const start = freshDir();

    expect(hintOf(resolveScope(start, { home, mainCheckout: isolatedMainCheckout }))).toBe(initHint(start));
  });
});

describe('resolveScope from a linked worktree under a parent folder holding .rafa/config.yaml', () => {
  it('answers the main checkout, not the parent folder, from the worktree beside it', () => {
    const { base, main, beside } = plantRepository();
    plantConfig(base);
    plantConfig(main);
    const start = join(beside, 'src');
    mkdirSync(start);

    const fromBeside = resolveScope(beside, { home, mainCheckout: isolatedMainCheckout });
    const fromNested = resolveScope(start, { home, mainCheckout: isolatedMainCheckout });
    const withoutFallback = resolveScope(beside, { home, mainCheckout: () => null });

    expect(rootOf(fromBeside)).toBe(main);
    expect(rootOf(fromNested)).toBe(main);
    expect(rootOf(withoutFallback)).toBe(base);
  });

  it('answers the main checkout from the main checkout itself, running no git', () => {
    const { base, main } = plantRepository();
    plantConfig(base);
    plantConfig(main);
    const { calls, seam } = recordingMainCheckout(null);

    expect(rootOf(resolveScope(main, { home, mainCheckout: seam }))).toBe(main);
    expect(calls).toEqual([]);
  });

  it('goes on above the top level to the parent folder when the main checkout holds no config', () => {
    const { base, main, beside } = plantRepository();
    plantConfig(base);

    expect(rootOf(resolveScope(beside, { home, mainCheckout: isolatedMainCheckout }))).toBe(base);
    expect(rootOf(resolveScope(main, { home, mainCheckout: isolatedMainCheckout }))).toBe(base);
  });
});

describe('resolveScope stopping at the working tree\'s top level', () => {
  const dirs = ['/', '/p', '/p/main', '/p/wt', '/p/wt/src', '/home', '/home/op'];
  const markers = ['/p/main/.git', '/p/wt/.git'];

  it('probes up to the top level, then the main checkout, and nothing above', () => {
    const fs = memoryFs(dirs, [...markers, '/p/.rafa/config.yaml', '/p/main/.rafa/config.yaml']);

    const resolution = resolveScope('/p/wt/src', { home: '/home/op', fs, mainCheckout: () => '/p/main' });

    expect(rootOf(resolution)).toBe('/p/main');
    expect(fs.probes).toEqual([
      '/p/wt/src/.rafa/config.yaml',
      '/p/wt/src/.git',
      '/p/wt/.rafa/config.yaml',
      '/p/wt/.git',
      '/p/main/.rafa/config.yaml',
    ]);
  });

  it('climbs above the top level after a main checkout holding no config, naming nothing once it finds one', () => {
    const fs = memoryFs(dirs, [...markers, '/p/.rafa/config.yaml']);

    const resolution = resolveScope('/p/wt/src', { home: '/home/op', fs, mainCheckout: () => '/p/main' });

    expect(rootOf(resolution)).toBe('/p');
    expect(fs.probes).toEqual([
      '/p/wt/src/.rafa/config.yaml',
      '/p/wt/src/.git',
      '/p/wt/.rafa/config.yaml',
      '/p/wt/.git',
      '/p/main/.rafa/config.yaml',
      '/p/.rafa/config.yaml',
    ]);
  });

  it('names a home above the top level holding the user file, and the main checkout probed, in the hint', () => {
    const fs = memoryFs(dirs, [...markers, '/p/.rafa/config.yaml']);

    const asHome = resolveScope('/p/wt', { home: '/p', fs, mainCheckout: () => '/p/main' });
    const homeElsewhere = resolveScope('/p/wt', { home: '/home/op', fs, mainCheckout: () => '/p/main' });

    expect(hintOf(asHome)).toBe(initHint('/p/wt', '/p/.rafa/config.yaml', '/p/main'));
    expect(rootOf(homeElsewhere)).toBe('/p');
  });

  it('leaves a main checkout above the top level to the walk above it, probing it once and naming it nowhere', () => {
    const fs = memoryFs(['/', '/p', '/p/main', '/p/main/trees', '/p/main/trees/x'], ['/p/main/.git', '/p/main/trees/x/.git']);

    const resolution = resolveScope('/p/main/trees/x', { home: '/home/op', fs, mainCheckout: () => '/p/main' });

    expect(hintOf(resolution)).toBe(initHint('/p/main/trees/x'));
    expect(fs.probes).toEqual([
      '/p/main/trees/x/.rafa/config.yaml',
      '/p/main/trees/x/.git',
      '/p/main/trees/.rafa/config.yaml',
      '/p/main/.rafa/config.yaml',
      '/p/.rafa/config.yaml',
      '/.rafa/config.yaml',
    ]);
  });

  it('names a home at the top level holding the user file in the hint', () => {
    const fs = memoryFs(dirs, ['/p/.git', '/p/.rafa/config.yaml']);

    const resolution = resolveScope('/p/wt', { home: '/p', fs, mainCheckout: () => '/p' });

    expect(hintOf(resolution)).toBe(initHint('/p/wt', '/p/.rafa/config.yaml'));
  });
});

describe('resolveScope fallback rules', () => {
  const dirs = ['/', '/a', '/a/main', '/b', '/b/wt', '/b/wt/src', '/home', '/home/op'];

  it('asks for the main checkout of the start\'s real path', () => {
    const fs = memoryFs(dirs, ['/a/main/.rafa/config.yaml']);
    const { calls, seam } = recordingMainCheckout('/a/main');

    resolveScope('/b/wt/src', { home: '/home/op', fs, mainCheckout: seam });

    expect(calls).toEqual(['/b/wt/src']);
  });

  it('probes the main checkout alone after the walk, without climbing above it', () => {
    const fs = memoryFs(dirs, ['/a/.rafa/config.yaml']);

    const resolution = resolveScope('/b/wt', { home: '/home/op', fs, mainCheckout: () => '/a/main' });

    expect(hintOf(resolution)).toBe(initHint('/b/wt', null, '/a/main'));
    expect(fs.probes).toEqual([
      '/b/wt/.rafa/config.yaml',
      '/b/wt/.git',
      '/b/.rafa/config.yaml',
      '/b/.git',
      '/.rafa/config.yaml',
      '/.git',
      '/a/main/.rafa/config.yaml',
    ]);
  });

  it('does not probe again a main checkout the walk already passed', () => {
    const fs = memoryFs(dirs, []);

    const resolution = resolveScope('/b/wt/src', { home: '/home/op', fs, mainCheckout: () => '/b/wt' });

    expect(hintOf(resolution)).toBe(initHint('/b/wt/src'));
    expect(fs.probes).toEqual([
      '/b/wt/src/.rafa/config.yaml',
      '/b/wt/src/.git',
      '/b/wt/.rafa/config.yaml',
      '/b/wt/.git',
      '/b/.rafa/config.yaml',
      '/b/.git',
      '/.rafa/config.yaml',
      '/.git',
    ]);
  });

  it('does not take the home as the main checkout, and takes the same checkout with the home elsewhere', () => {
    const fs = memoryFs([...dirs, '/home/other'], ['/a/main/.rafa/config.yaml']);

    const asHome = resolveScope('/b/wt', { home: '/a/main', fs, mainCheckout: () => '/a/main' });
    const elsewhere = resolveScope('/b/wt', { home: '/home/other', fs, mainCheckout: () => '/a/main' });

    expect(hintOf(asHome)).toBe(initHint('/b/wt'));
    expect(rootOf(elsewhere)).toBe('/a/main');
  });

  it('refuses a git that cannot answer as a ScopeError carrying its error', () => {
    const fs = memoryFs(dirs, []);
    const failure = new WorktreeRootError('git worktree list failed in /b/wt: boom');

    let refusal: unknown = null;
    try {
      resolveScope('/b/wt', {
        home: '/home/op',
        fs,
        mainCheckout: () => {
          throw failure;
        },
      });
    } catch (error) {
      refusal = error;
    }

    expect(refusal).toBeInstanceOf(ScopeError);
    const { message, cause } = refusal as ScopeError;
    expect(message).toBe(`rafa scope: cannot read the main checkout of /b/wt (${failure.message})`);
    expect(cause).toBe(failure);
  });

  it('lets any other error of the seam through unwrapped', () => {
    const fs = memoryFs(dirs, []);
    const fault = new TypeError('not a git error');

    expect(() => resolveScope('/b/wt', {
      home: '/home/op',
      fs,
      mainCheckout: () => {
        throw fault;
      },
    })).toThrow(fault);
  });
});
