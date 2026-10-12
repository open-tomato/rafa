/**
 * Tests for `start/run-checkout.ts`: where a run works, on the route
 * without `--as-worktree` and on the route under it.
 *
 * The first block drives `settleRunCheckout` over stubbed seams that
 * record what each was handed. The seam a route must NOT reach throws
 * when called, so a settling that took both routes, or the wrong one,
 * reddens rather than answering the first route's result. Each worktree
 * case sits beside the plain case it was varied from by one word, the
 * flag, so a settling that ignored the flag and one that always added a
 * worktree both redden.
 *
 * The base under the flag is its own reading, stubbed by the `base` seam
 * and recorded with the `pr.base` it was handed. The branch the run was
 * started on reaches the worktree on neither route: under the flag it is
 * read through the `checkedOutBranch` seam, which answers null on a
 * detached HEAD, and only the one line naming the base is built from
 * it. Each case that reads that line collects the info lines itself, and
 * the case beside it, started on the base, reads none.
 *
 * The second block runs the function against a real repository under
 * the temporary directory — a bare remote and its clone — with only the
 * started directory handed in, so the worktree it answers is proven to
 * be a working tree git itself reports on the plan's branch, and the
 * main checkout is read back unchanged. Its control is the same
 * repository settled without the flag, which answers the main checkout.
 *
 * The active output is module state and bun runs every test file in one
 * process, so each case sets a sink and the last one sets it back.
 */
import type { RunCheckoutSeams } from './run-checkout.js';
import type { RunBranchRequest } from './run-setup.js';
import type { WorktreeOutcome, WorktreeRequest } from './worktree.js';

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'bun:test';

import { setActiveOutput } from '../adapters/output/active.js';
import { CommandExit } from '../cli/command.js';
import { CONFIG_DEFAULTS } from '../config.js';
import { sinkOutput } from '../tests/output-sinks.js';

import { resolveRunDirs } from './checkout.js';
import { settleRunCheckout } from './run-checkout.js';
import { resolveRunBranch } from './run-setup.js';
import { addRunWorktree } from './worktree.js';

/** The plan every stubbed case runs. */
const STUB = 'rafa-370';

/** A project root that is not the directory the suite runs in. */
const ROOT = join('/', 'nonesuch', 'project');

/** The worktree the stubbed add answers. */
const WORKTREE = join(ROOT, '.rafa', 'worktrees', STUB);

/** The branch the stubbed offer answers when it moves the run. */
const OFFERED = `feat/${STUB}`;

/** What every seam was handed, in call order. */
interface Calls {
  readonly branchReads: string[];
  readonly startedReads: string[];
  readonly baseReads: { readonly projectRoot: string; readonly prBase: string | null }[];
  readonly offers: RunBranchRequest[];
  readonly worktrees: WorktreeRequest[];
}

/** What `getCurrentBranch` answers on a detached HEAD, the reading the route without the flag still makes. */
const DETACHED_WORD = 'HEAD';

/**
 * Seams for a run started in `started` on the branch `startedOn`, null
 * for a detached HEAD, whose base reading answers `base`, and the record
 * of what each seam was handed.
 */
function stubbed(
  started: string,
  startedOn: string | null,
  base = 'main',
): { readonly seams: RunCheckoutSeams; readonly calls: Calls } {
  const calls: Calls = { branchReads: [], startedReads: [], baseReads: [], offers: [], worktrees: [] };
  const seams: RunCheckoutSeams = {
    dirs: (projectRoot) => ({ projectRoot, checkout: started }),
    currentBranch: (dir) => {
      calls.branchReads.push(dir);
      return startedOn ?? DETACHED_WORD;
    },
    checkedOutBranch: (dir) => {
      calls.startedReads.push(dir);
      return startedOn;
    },
    base: (projectRoot, prBase) => {
      calls.baseReads.push({ projectRoot, prBase });
      return base;
    },
    offer: (request) => {
      calls.offers.push(request);
      return Promise.resolve(OFFERED);
    },
    worktree: (request): WorktreeOutcome => {
      calls.worktrees.push(request);
      return { branch: OFFERED, path: WORKTREE, route: 'create', steps: [] };
    },
  };
  return { seams, calls };
}

/** The request every stubbed case varies. */
function request(args: readonly string[]): Parameters<typeof settleRunCheckout>[0] {
  return { projectRoot: ROOT, worktreeDir: CONFIG_DEFAULTS.loopWorktreeDir, prBase: null, planStub: STUB, args };
}

/** Sets an output that keeps every info and warning line, and answers the two lists. */
function collectLines(): { readonly infos: string[]; readonly warnings: string[] } {
  const infos: string[] = [];
  const warnings: string[] = [];
  setActiveOutput(sinkOutput({
    info: (line) => {
      infos.push(line);
    },
    warn: (line) => {
      warnings.push(line);
    },
  }));
  return { infos, warnings };
}

beforeEach(() => {
  setActiveOutput(sinkOutput({}));
});

afterEach(() => {
  setActiveOutput(null);
});

describe('settleRunCheckout without --as-worktree', () => {
  it('answers the started checkout and the branch the offer answered, adding no worktree', async () => {
    const { seams, calls } = stubbed(ROOT, 'main');
    const settled = await settleRunCheckout(request(['--create-branch']), seams);

    expect(settled).toEqual({ projectRoot: ROOT, checkout: ROOT, branch: OFFERED });
    expect(calls.offers).toEqual([{ checkout: ROOT, planStub: STUB, base: 'main', args: ['--create-branch'] }]);
    expect(calls.worktrees).toEqual([]);
  });

  it('offers in a linked worktree the run was started in, reading the base there', async () => {
    const started = join('/', 'nonesuch', 'beside');
    const { seams, calls } = stubbed(started, 'main');
    const settled = await settleRunCheckout(request([]), seams);

    expect(settled.checkout).toBe(started);
    expect(settled.projectRoot).toBe(ROOT);
    expect(calls.branchReads).toEqual([started]);
    expect(calls.offers[0]?.checkout).toBe(started);
  });

  it('reads no base and prints no line, started on a branch that is not the base', async () => {
    // The control of the worktree cases below: the same started branch
    // and the same base, less the flag, and the branch is still the base
    // the offer is handed.
    const { infos } = collectLines();
    const { seams, calls } = stubbed(ROOT, 'feat/local-only');
    await settleRunCheckout(request(['--any-branch']), seams);

    expect(calls.offers[0]?.base).toBe('feat/local-only');
    expect(calls.baseReads).toEqual([]);
    expect(calls.startedReads).toEqual([]);
    expect(infos).toEqual([]);
  });
});

describe('settleRunCheckout on a detached HEAD', () => {
  /** {@link stubbed} on a detached HEAD, the offer seam the real `resolveRunBranch` so its refusal is the one read. */
  function detached(): { readonly seams: RunCheckoutSeams; readonly calls: Calls } {
    const { seams, calls } = stubbed(ROOT, null);
    return { seams: { ...seams, offer: (offered) => resolveRunBranch(offered) }, calls };
  }

  it('refuses every line on the checkout\'s own HEAD, adding no worktree', async () => {
    for (const args of [[], ['--create-branch'], ['--any-branch']]) {
      const { seams, calls } = detached();
      const settling = settleRunCheckout(request(args), seams);

      await expect(settling).rejects.toBeInstanceOf(CommandExit);
      expect(calls.worktrees).toEqual([]);
    }
  });

  it('lets --as-worktree through to the worktree, the way on the refusal names', async () => {
    const { seams, calls } = detached();
    const settled = await settleRunCheckout(request(['--as-worktree']), seams);

    expect(settled.checkout).toBe(WORKTREE);
    expect(calls.worktrees).toHaveLength(1);
  });

  it('hands the worktree the base that was read, never the word HEAD, and says so in one line', async () => {
    const { infos } = collectLines();
    const { seams, calls } = detached();
    await settleRunCheckout(request(['--as-worktree']), seams);

    expect(calls.worktrees[0]?.base).toBe('main');
    expect(calls.branchReads).toEqual([]);
    expect(infos).toEqual([
      '\n🌿 The worktree\'s base is main, read from origin/HEAD (the default when it names none), '
      + 'not a detached HEAD, which the run was started on.',
    ]);
  });
});

describe('settleRunCheckout under --as-worktree', () => {
  it('answers the added worktree as the checkout and its branch, with the project root kept', async () => {
    const { seams, calls } = stubbed(ROOT, 'main');
    const settled = await settleRunCheckout(request(['--as-worktree']), seams);

    expect(settled).toEqual({ projectRoot: ROOT, checkout: WORKTREE, branch: OFFERED });
    expect(calls.worktrees).toEqual([
      { projectRoot: ROOT, worktreeDir: '.rafa/worktrees', planStub: STUB, base: 'main' },
    ]);
  });

  it('makes no branch offer, so nothing is asked and the started checkout is never switched', async () => {
    const { seams, calls } = stubbed(ROOT, 'main');
    await settleRunCheckout(request(['--as-worktree']), seams);

    expect(calls.offers).toEqual([]);
  });

  it('reads the base in the project root and the started branch where the run was started', async () => {
    const started = join('/', 'nonesuch', 'beside');
    const { seams, calls } = stubbed(started, 'feat/stacked');
    await settleRunCheckout(request(['--as-worktree']), seams);

    expect(calls.baseReads).toEqual([{ projectRoot: ROOT, prBase: null }]);
    expect(calls.startedReads).toEqual([started]);
    expect(calls.branchReads).toEqual([]);
    expect(calls.worktrees[0]?.projectRoot).toBe(ROOT);
  });

  it('takes the base that was read, not a started branch origin has not got, and names both in one line', async () => {
    const { infos, warnings } = collectLines();
    const { seams, calls } = stubbed(ROOT, 'feat/local-only');
    await settleRunCheckout(request(['--as-worktree']), seams);

    expect(calls.worktrees[0]?.base).toBe('main');
    expect(infos).toEqual([
      '\n🌿 The worktree\'s base is main, read from origin/HEAD (the default when it names none), '
      + 'not feat/local-only, which the run was started on.',
    ]);
    expect(warnings).toEqual([]);
  });

  it('hands a set pr.base to the base reading, takes its answer and names pr.base as where it came from', async () => {
    const { infos } = collectLines();
    const { seams, calls } = stubbed(ROOT, 'main', 'stretch/21');
    await settleRunCheckout({ ...request(['--as-worktree']), prBase: 'stretch/21' }, seams);

    expect(calls.baseReads).toEqual([{ projectRoot: ROOT, prBase: 'stretch/21' }]);
    expect(calls.worktrees[0]?.base).toBe('stretch/21');
    expect(infos).toEqual([
      '\n🌿 The worktree\'s base is stretch/21, read from pr.base, not main, which the run was started on.',
    ]);
  });

  it('prints nothing when the run was started on the base, whichever way the base was named', async () => {
    const { infos, warnings } = collectLines();
    const unset = stubbed(ROOT, 'main');
    await settleRunCheckout(request(['--as-worktree']), unset.seams);
    const set = stubbed(ROOT, 'stretch/21', 'stretch/21');
    await settleRunCheckout({ ...request(['--as-worktree']), prBase: 'stretch/21' }, set.seams);

    expect(unset.calls.worktrees[0]?.base).toBe('main');
    expect(set.calls.worktrees[0]?.base).toBe('stretch/21');
    expect(infos).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it('hands the configured worktree directory on as written', async () => {
    const { seams, calls } = stubbed(ROOT, 'main');
    await settleRunCheckout({ ...request(['--as-worktree']), worktreeDir: '../rafa-loops' }, seams);

    expect(calls.worktrees[0]?.worktreeDir).toBe('../rafa-loops');
  });

  it('passes a refused worktree through as it was thrown', async () => {
    const refusal = new CommandExit(1, '❌ Refusing to add a worktree');
    const { seams } = stubbed(ROOT, 'main');
    const refusing: RunCheckoutSeams = {
      ...seams,
      worktree: () => {
        throw refusal;
      },
    };

    await expect(settleRunCheckout(request(['--as-worktree']), refusing)).rejects.toBe(refusal);
  });

  it('reads the flag as a bare word, as the refusal beside --create-branch reads it', async () => {
    const { seams, calls } = stubbed(ROOT, 'main');
    await settleRunCheckout(request(['--as-worktree=true']), seams);

    expect(calls.worktrees).toEqual([]);
    expect(calls.offers).toHaveLength(1);
  });
});

describe('settleRunCheckout against a real repository', () => {
  let scratch = '';
  let project = '';

  /** Runs git in `cwd` with a fixed identity, under `LC_ALL=C`, and answers its trimmed stdout. */
  const git = (cwd: string, args: readonly string[]): string => execFileSync(
    'git',
    ['-c', 'user.name=rafa', '-c', 'user.email=rafa@example.invalid', ...args],
    { cwd, encoding: 'utf8', stdio: 'pipe', env: { ...process.env, LC_ALL: 'C' } },
  ).trim();

  /** The seams of a run started in the main checkout, git and the rest real. */
  const startedInProject = (): RunCheckoutSeams => ({
    dirs: (root) => resolveRunDirs(root, { cwd: project }),
  });

  beforeAll(() => {
    scratch = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-run-checkout-')));
    const remote = join(scratch, 'remote.git');
    project = join(scratch, 'project');
    git(scratch, ['init', '-q', '--bare', remote]);
    git(scratch, ['init', '-q', '-b', 'main', project]);
    git(project, ['commit', '-q', '--allow-empty', '-m', 'one']);
    git(project, ['remote', 'add', 'origin', remote]);
    git(project, ['push', '-q', 'origin', 'main']);
  });

  afterAll(() => {
    rmSync(scratch, { recursive: true, force: true });
  });

  it('answers the main checkout without the flag, and adds nothing', async () => {
    const settled = await settleRunCheckout({
      projectRoot: project,
      worktreeDir: CONFIG_DEFAULTS.loopWorktreeDir,
      prBase: null,
      planStub: 'plain',
      args: ['--any-branch'],
    }, startedInProject());

    expect(settled).toEqual({ projectRoot: project, checkout: project, branch: 'main' });
    expect(existsSync(join(project, '.rafa', 'worktrees'))).toBe(false);
  });

  it('answers a working tree git reports on feat/<stub>, and leaves the main checkout as it was', async () => {
    const settled = await settleRunCheckout({
      projectRoot: project,
      worktreeDir: CONFIG_DEFAULTS.loopWorktreeDir,
      prBase: null,
      planStub: 'real',
      args: ['--as-worktree'],
    }, startedInProject());
    const path = join(project, '.rafa', 'worktrees', 'real');

    expect(settled).toEqual({ projectRoot: project, checkout: path, branch: 'feat/real' });
    expect(git(settled.checkout, ['rev-parse', '--show-toplevel'])).toBe(path);
    expect(git(settled.checkout, ['rev-parse', '--abbrev-ref', 'HEAD'])).toBe('feat/real');
    expect(git(project, ['rev-parse', '--abbrev-ref', 'HEAD'])).toBe('main');
    expect(git(project, ['status', '--porcelain', '--untracked-files=no'])).toBe('');
  });

  it('refuses a detached HEAD without the flag, creating no branch and leaving HEAD where it was', async () => {
    git(project, ['switch', '-q', '--detach']);
    const head = git(project, ['rev-parse', 'HEAD']);
    try {
      let thrown: unknown;
      try {
        await settleRunCheckout({
          projectRoot: project,
          worktreeDir: CONFIG_DEFAULTS.loopWorktreeDir,
          prBase: null,
          planStub: 'detached',
          args: ['--create-branch'],
        }, startedInProject());
      } catch (error) {
        thrown = error;
      }

      // The reading the refusal keys on, taken off this repository rather than assumed.
      expect(git(project, ['rev-parse', '--abbrev-ref', 'HEAD'])).toBe('HEAD');
      expect(thrown).toBeInstanceOf(CommandExit);
      expect((thrown as CommandExit).message).toContain('git switch <base>');
      expect(git(project, ['branch', '--list', 'feat/detached'])).toBe('');
      expect(git(project, ['rev-parse', 'HEAD'])).toBe(head);
    } finally {
      git(project, ['switch', '-q', 'main']);
    }
  });

  /**
   * Settles `stub` under `--as-worktree` with git real, keeping the base
   * the worktree was handed and whatever the settling threw, so a case
   * reads the base even where the worktree then refused.
   */
  const settleRecordingBase = async (stub: string): Promise<{ readonly handed: string[]; readonly thrown: unknown }> => {
    const handed: string[] = [];
    let thrown: unknown;
    try {
      await settleRunCheckout({
        projectRoot: project,
        worktreeDir: CONFIG_DEFAULTS.loopWorktreeDir,
        prBase: null,
        planStub: stub,
        args: ['--as-worktree'],
      }, {
        ...startedInProject(),
        worktree: (asked) => {
          handed.push(asked.base);
          return addRunWorktree(asked);
        },
      });
    } catch (error) {
      thrown = error;
    }
    return { handed, thrown };
  };

  it('cuts feat/<stub> from origin/main under the flag on a detached HEAD, handing the worktree no HEAD', async () => {
    git(project, ['switch', '-q', '--detach']);
    try {
      const { infos } = collectLines();
      const { handed, thrown } = await settleRecordingBase('headless');

      // The reading that used to be the base, taken off this repository.
      expect(git(project, ['rev-parse', '--abbrev-ref', 'HEAD'])).toBe('HEAD');
      expect(handed).toEqual(['main']);
      expect(thrown).toBeUndefined();
      expect(git(project, ['rev-parse', 'feat/headless'])).toBe(git(project, ['rev-parse', 'origin/main']));
      expect(infos.filter((line) => line.includes('detached HEAD'))).toHaveLength(1);
    } finally {
      git(project, ['switch', '-q', 'main']);
    }
  });

  it('cuts feat/<stub> from origin/main under the flag on a branch origin has not got, with no warning', async () => {
    git(project, ['switch', '-q', '-c', 'feat/local-only']);
    try {
      const { infos, warnings } = collectLines();
      const { handed, thrown } = await settleRecordingBase('unpushed');

      // The control: the branch the run stands on is one origin cannot be fetched for.
      expect(git(project, ['ls-remote', '--heads', 'origin', 'feat/local-only'])).toBe('');
      expect(handed).toEqual(['main']);
      expect(thrown).toBeUndefined();
      expect(git(project, ['rev-parse', 'feat/unpushed'])).toBe(git(project, ['rev-parse', 'origin/main']));
      expect(infos.filter((line) => line.includes('not feat/local-only'))).toHaveLength(1);
      expect(warnings).toEqual([]);
    } finally {
      git(project, ['switch', '-q', 'main']);
    }
  });

  it('puts the worktree beside the repository when the directory says so', async () => {
    const settled = await settleRunCheckout({
      projectRoot: project,
      worktreeDir: '../rafa-loops',
      prBase: null,
      planStub: 'beside',
      args: ['--as-worktree'],
    }, startedInProject());

    expect(settled.checkout).toBe(join(scratch, 'rafa-loops', 'beside'));
    expect(git(settled.checkout, ['rev-parse', '--abbrev-ref', 'HEAD'])).toBe('feat/beside');
    expect(settled.projectRoot).toBe(project);
  });
});
