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
 * The base is its own reading, stubbed by the `base` seam and recorded
 * with the `pr.base` it was handed. The branch the run was started on is
 * read through the `checkedOutBranch` seam on both routes, which answers
 * null on a detached HEAD. Under the flag it never reaches the worktree,
 * and only the one line naming the base is built from it: each case that
 * reads that line collects the info lines itself, and the case beside
 * it, started on the base, reads none. Without the flag it is the branch
 * the offer is made on, and on a detached HEAD the offer is handed the
 * base that was read and the `no-branch` standing in its place, never
 * the word `HEAD`. The cases that drive the real `resolveRunBranch`
 * there hand it a git that answers every command with a failure and no
 * terminal, so nothing is spawned and nothing is asked.
 *
 * The `loop.worktreeSetup` block drives the same stubs, with a `setup`
 * seam that records the request it was handed: on the added route and
 * on the `reuse` route a set key reaches it once, the worktree as `cwd`.
 * The cases that must not reach it, a null key under the flag and a set
 * key without it, hand a `setup` that throws, beside the recording ones.
 * A refused setup is passed through as thrown, and no checkout answered.
 *
 * The block against a real repository runs the function under
 * the temporary directory — a bare remote and its clone — with only the
 * started directory handed in, so the worktree it answers is proven to
 * be a working tree git itself reports on the plan's branch, and the
 * main checkout is read back unchanged. Its control is the same
 * repository settled without the flag, which answers the main checkout.
 * Its two cases on a detached HEAD without the flag settle over real git
 * with no terminal to ask, so a suite run from one asks nothing.
 *
 * The active output is module state and bun runs every test file in one
 * process, so each case sets a sink and the last one sets it back.
 */
import type { BranchSeams } from '@open-tomato/rafa-run/start/branch';
import type { RunCheckoutSeams } from '@open-tomato/rafa-run/start/run-checkout';
import type { RunBranchRequest } from '@open-tomato/rafa-run/start/run-setup';
import type { WorktreeOutcome, WorktreeRequest } from '@open-tomato/rafa-run/start/worktree';
import type { WorktreeSetupRequest } from '@open-tomato/rafa-run/start/worktree-setup';

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'bun:test';

import { CommandExit } from '@open-tomato/rafa/core/command';
import { setActiveOutput } from '@open-tomato/rafa/core/output';
import { sinkOutput } from '@open-tomato/rafa/tests/output-sinks';
import { resolveRunDirs } from '@open-tomato/rafa-run/start/checkout';
import { settleRunCheckout } from '@open-tomato/rafa-run/start/run-checkout';
import { guardRunBranch, resolveRunBranch } from '@open-tomato/rafa-run/start/run-setup';
import { addRunWorktree } from '@open-tomato/rafa-run/start/worktree';

import { CONFIG_DEFAULTS } from '../../../config-registry.js';

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
  readonly startedReads: string[];
  readonly baseReads: { readonly projectRoot: string; readonly prBase: string | null }[];
  readonly offers: RunBranchRequest[];
  readonly worktrees: WorktreeRequest[];
  readonly setups: WorktreeSetupRequest[];
}

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
  const calls: Calls = { startedReads: [], baseReads: [], offers: [], worktrees: [], setups: [] };
  const seams: RunCheckoutSeams = {
    dirs: (projectRoot) => ({ projectRoot, checkout: started }),
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
    setup: (request) => {
      calls.setups.push(request);
      return Promise.resolve();
    },
  };
  return { seams, calls };
}

/** The request every stubbed case varies. */
function request(args: readonly string[]): Parameters<typeof settleRunCheckout>[0] {
  return {
    projectRoot: ROOT,
    worktreeDir: CONFIG_DEFAULTS.loopWorktreeDir,
    worktreeSetup: CONFIG_DEFAULTS.loopWorktreeSetup,
    prBase: null,
    planStub: STUB,
    args,
  };
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

  it('offers in a linked worktree the run was started in, reading its branch there', async () => {
    const started = join('/', 'nonesuch', 'beside');
    const { seams, calls } = stubbed(started, 'main');
    const settled = await settleRunCheckout(request([]), seams);

    expect(settled.checkout).toBe(started);
    expect(settled.projectRoot).toBe(ROOT);
    expect(calls.startedReads).toEqual([started]);
    expect(calls.offers[0]?.checkout).toBe(started);
  });

  it('reads no base and prints no line, started on a branch that is not the base', async () => {
    // The control of the worktree cases below, and of the detached ones:
    // the same started branch and the same base, less the flag, and the
    // branch is the one the offer is handed, on no standing of its own.
    const { infos } = collectLines();
    const { seams, calls } = stubbed(ROOT, 'feat/local-only');
    await settleRunCheckout(request(['--any-branch']), seams);

    expect(calls.offers[0]?.base).toBe('feat/local-only');
    expect(calls.offers[0]?.standing).toBeUndefined();
    expect(calls.baseReads).toEqual([]);
    expect(calls.startedReads).toEqual([ROOT]);
    expect(infos).toEqual([]);
  });
});

describe('settleRunCheckout on a detached HEAD', () => {
  /** Branch seams whose git answers every command with a failure, with no terminal and a prompter nothing may open. */
  const NOTHING_ANSWERS: BranchSeams = {
    git: () => () => ({ ok: false, stdout: '', stderr: '' }),
    isTerminal: () => false,
    openPrompter: () => {
      throw new Error('the prompter was opened');
    },
  };

  /** {@link stubbed} on a detached HEAD, the offer seam the real `resolveRunBranch` over {@link NOTHING_ANSWERS}. */
  function detached(): { readonly seams: RunCheckoutSeams; readonly calls: Calls } {
    const { seams, calls } = stubbed(ROOT, null);
    return { seams: { ...seams, offer: (offered) => resolveRunBranch(offered, NOTHING_ANSWERS) }, calls };
  }

  it('hands the offer the base that was read and the no-branch standing, never the word HEAD', async () => {
    const { seams, calls } = stubbed(ROOT, null);
    const settled = await settleRunCheckout(request(['--create-branch']), seams);

    expect(settled).toEqual({ projectRoot: ROOT, checkout: ROOT, branch: OFFERED });
    expect(calls.baseReads).toEqual([{ projectRoot: ROOT, prBase: null }]);
    expect(calls.offers).toEqual([
      { checkout: ROOT, planStub: STUB, base: 'main', standing: 'no-branch', args: ['--create-branch'] },
    ]);
    expect(calls.worktrees).toEqual([]);
  });

  it('reads the base in the project root with the pr.base it was handed, started in a linked worktree', async () => {
    const started = join('/', 'nonesuch', 'beside');
    const { seams, calls } = stubbed(started, null, 'stretch/21');
    await settleRunCheckout({ ...request([]), prBase: 'stretch/21' }, seams);

    expect(calls.startedReads).toEqual([started]);
    expect(calls.baseReads).toEqual([{ projectRoot: ROOT, prBase: 'stretch/21' }]);
    expect(calls.offers).toEqual([
      { checkout: started, planStub: STUB, base: 'stretch/21', standing: 'no-branch', args: [] },
    ]);
  });

  it('answers no branch on every line that takes no offer, which the guard refuses, adding no worktree', async () => {
    for (const args of [[], ['--any-branch']]) {
      const { seams, calls } = detached();
      const settled = await settleRunCheckout(request(args), seams);

      expect(settled).toEqual({ projectRoot: ROOT, checkout: ROOT, branch: null });
      expect(calls.worktrees).toEqual([]);
      expect(() => {
        guardRunBranch(STUB, settled.branch, args);
      }).toThrow(`--create-branch to create ${OFFERED}`);
    }
  });

  it('passes a refused offer through as it was thrown, the run still on no branch', async () => {
    // `--create-branch` answers yes, and the working tree git could not read refuses first.
    const { seams, calls } = detached();
    const settling = settleRunCheckout(request(['--create-branch']), seams);

    await expect(settling).rejects.toBeInstanceOf(CommandExit);
    await expect(settling).rejects.toThrow('The run is still on a detached HEAD.');
    expect(calls.worktrees).toEqual([]);
  });

  it('lets --as-worktree through to the worktree, the way on the refusal names second', async () => {
    const { seams, calls } = detached();
    const settled = await settleRunCheckout(request(['--as-worktree']), seams);

    expect(settled.checkout).toBe(WORKTREE);
    expect(calls.worktrees).toHaveLength(1);
  });

  it('hands the worktree the base that was read, never the word HEAD, and says so in one line', async () => {
    const { infos } = collectLines();
    const { seams, calls } = stubbed(ROOT, null);
    await settleRunCheckout(request(['--as-worktree']), seams);

    expect(calls.worktrees[0]?.base).toBe('main');
    expect(calls.offers).toEqual([]);
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

describe('settleRunCheckout and loop.worktreeSetup', () => {
  /** A setup command as a project might name it, with a quote and a redirect the shell reads. */
  const COMMAND = 'bun install --frozen-lockfile && echo "set up" >> setup-marker.txt';

  /** {@link stubbed}'s seams with a `setup` that throws when reached, for the cases that must not reach it. */
  function unreachable(): { readonly seams: RunCheckoutSeams; readonly calls: Calls } {
    const { seams, calls } = stubbed(ROOT, 'main');
    return {
      seams: {
        ...seams,
        setup: () => {
          throw new Error('the setup was reached');
        },
      },
      calls,
    };
  }

  it('reaches no setup under --as-worktree when the key is null, the default', async () => {
    const { seams, calls } = unreachable();
    const settled = await settleRunCheckout(request(['--as-worktree']), seams);

    expect(CONFIG_DEFAULTS.loopWorktreeSetup).toBeNull();
    expect(settled).toEqual({ projectRoot: ROOT, checkout: WORKTREE, branch: OFFERED });
    expect(calls.worktrees).toHaveLength(1);
  });

  it('reaches the setup once on an added worktree, with the worktree as cwd and the command as written', async () => {
    const { seams, calls } = stubbed(ROOT, 'main');
    const settled = await settleRunCheckout({ ...request(['--as-worktree']), worktreeSetup: COMMAND }, seams);

    expect(settled.checkout).toBe(WORKTREE);
    expect(calls.setups).toEqual([{ command: COMMAND, worktree: WORKTREE, env: process.env }]);
  });

  it('reaches the setup once on a reused worktree, with the worktree as cwd and the command as written', async () => {
    const reused = join(ROOT, '..', 'rafa-loops', STUB);
    const { seams, calls } = stubbed(ROOT, 'main');
    const reusing: RunCheckoutSeams = {
      ...seams,
      worktree: (asked): WorktreeOutcome => {
        calls.worktrees.push(asked);
        return { branch: OFFERED, path: reused, route: 'reuse', steps: [] };
      },
    };
    const settled = await settleRunCheckout({ ...request(['--as-worktree']), worktreeSetup: COMMAND }, reusing);

    expect(settled.checkout).toBe(reused);
    expect(calls.worktrees).toHaveLength(1);
    expect(calls.setups).toEqual([{ command: COMMAND, worktree: reused, env: process.env }]);
  });

  it('passes a refused setup through as it was thrown, answering no checkout', async () => {
    const refusal = new CommandExit(1, 'loop.worktreeSetup `false` in /nonesuch exited 1.');
    const { seams, calls } = stubbed(ROOT, 'main');
    const refusing: RunCheckoutSeams = {
      ...seams,
      setup: (asked) => {
        calls.setups.push(asked);
        return Promise.reject(refusal);
      },
    };
    let settled: unknown;
    const settling = settleRunCheckout({ ...request(['--as-worktree']), worktreeSetup: 'false' }, refusing)
      .then((answered) => {
        settled = answered;
      });

    await expect(settling).rejects.toBe(refusal);
    expect(settled).toBeUndefined();
    expect(calls.worktrees).toHaveLength(1);
    expect(calls.setups).toHaveLength(1);
  });

  it('reaches no setup without --as-worktree, whatever the key holds', async () => {
    const { seams, calls } = unreachable();
    const settled = await settleRunCheckout({ ...request(['--any-branch']), worktreeSetup: COMMAND }, seams);

    expect(settled).toEqual({ projectRoot: ROOT, checkout: ROOT, branch: OFFERED });
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
      worktreeSetup: null,
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
      worktreeSetup: null,
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

  /** The offer over real git with no terminal to ask, so a suite run from one asks nothing. */
  const offerWithNoTerminal: NonNullable<RunCheckoutSeams['offer']> = (asked) => resolveRunBranch(
    asked,
    { isTerminal: () => false },
  );

  /** Settles `stub` on the words `args` in the main checkout, without `--as-worktree`, over real git. */
  const settleDetached = (stub: string, args: readonly string[]): ReturnType<typeof settleRunCheckout> => settleRunCheckout({
    projectRoot: project,
    worktreeDir: CONFIG_DEFAULTS.loopWorktreeDir,
    worktreeSetup: null,
    prBase: null,
    planStub: stub,
    args,
  }, { ...startedInProject(), offer: offerWithNoTerminal });

  it('answers no branch on a detached HEAD without --create-branch, creating none and leaving HEAD where it was', async () => {
    git(project, ['switch', '-q', '--detach']);
    const head = git(project, ['rev-parse', 'HEAD']);
    try {
      const args = ['--any-branch'];
      const settled = await settleDetached('unasked', args);

      // The word that used to be the run's branch, taken off this repository rather than assumed.
      expect(git(project, ['rev-parse', '--abbrev-ref', 'HEAD'])).toBe('HEAD');
      expect(settled).toEqual({ projectRoot: project, checkout: project, branch: null });
      expect(git(project, ['branch', '--list', 'feat/unasked'])).toBe('');
      expect(git(project, ['rev-parse', 'HEAD'])).toBe(head);
      expect(() => {
        guardRunBranch('unasked', settled.branch, args);
      }).toThrow('--create-branch to create feat/unasked');
    } finally {
      git(project, ['switch', '-q', 'main']);
    }
  });

  it('creates feat/<stub> from the latest origin/main under --create-branch on a detached HEAD, with no upstream', async () => {
    /** The upstream git holds for a local branch, empty when it holds none. */
    const upstreamOf = (branch: string): string => git(project, ['for-each-ref', '--format=%(upstream)', `refs/heads/${branch}`]);

    git(project, ['switch', '-q', '--detach']);
    const head = git(project, ['rev-parse', 'HEAD']);
    // The remote moves on after the checkout last heard from it, so a
    // branch cut from where HEAD stood and one cut from the fetched ref differ.
    const other = join(scratch, 'other');
    git(scratch, ['clone', '-q', '-b', 'main', join(scratch, 'remote.git'), other]);
    git(other, ['commit', '-q', '--allow-empty', '-m', 'two']);
    git(other, ['push', '-q', 'origin', 'main']);
    const latest = git(other, ['rev-parse', 'HEAD']);
    try {
      const settled = await settleDetached('detached', ['--create-branch']);

      expect(settled).toEqual({ projectRoot: project, checkout: project, branch: 'feat/detached' });
      expect(git(project, ['symbolic-ref', '--short', 'HEAD'])).toBe('feat/detached');
      expect(latest).not.toBe(head);
      expect(git(project, ['rev-parse', 'HEAD'])).toBe(latest);
      // No upstream, read beside a branch given one, so the reading is shown able to answer.
      git(project, ['branch', '-q', '--track', 'control/tracked', 'origin/main']);
      expect(upstreamOf('control/tracked')).toBe('refs/remotes/origin/main');
      expect(upstreamOf('feat/detached')).toBe('');
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
        worktreeSetup: null,
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
      worktreeSetup: null,
      prBase: null,
      planStub: 'beside',
      args: ['--as-worktree'],
    }, startedInProject());

    expect(settled.checkout).toBe(join(scratch, 'rafa-loops', 'beside'));
    expect(git(settled.checkout, ['rev-parse', '--abbrev-ref', 'HEAD'])).toBe('feat/beside');
    expect(settled.projectRoot).toBe(project);
  });
});

describe('settleRunCheckout and naming.branch', () => {
  /** A template other than the default, so a dropped one reads as missing. */
  const TEMPLATE = 'work/{stub}';

  it('hands the template to the branch offer without --as-worktree', async () => {
    const { seams, calls } = stubbed(ROOT, 'main');
    await settleRunCheckout({ ...request([]), branchTemplate: TEMPLATE }, seams);

    expect(calls.offers.map((offered) => offered.branchTemplate)).toEqual([TEMPLATE]);
    expect(calls.worktrees).toEqual([]);
  });

  it('hands the template to the worktree under --as-worktree', async () => {
    const { seams, calls } = stubbed(ROOT, 'main');
    await settleRunCheckout({ ...request(['--as-worktree']), branchTemplate: TEMPLATE }, seams);

    expect(calls.worktrees.map((added) => added.branchTemplate)).toEqual([TEMPLATE]);
    expect(calls.offers).toEqual([]);
  });
});
