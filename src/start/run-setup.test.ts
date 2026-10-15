/**
 * Tests for `start/run-setup.ts`: the flags `start()` reads itself, and
 * the branch step — the offer's wiring and the guard.
 *
 * The branch guard writes its warnings through the active output and
 * throws its refusal as a `CommandExit`, so its cases read both: the
 * warnings through a `sinkOutput` set for each case, and the refusal off
 * what was thrown.
 *
 * `resolveRunBranch` is the wiring ahead of that guard, and its cases
 * here are the wiring alone: which branch it answers, and that the guard
 * then reads THAT branch rather than the one the run started on. What
 * the offer does inside — the questions, the routes and every refusal —
 * is `start/branch.test.ts`'s, and is not asserted twice. So the git
 * seam these cases hand it is a table keyed by the argv after `git`
 * that throws on a command no case planned for, and the prompter seam
 * throws when it is opened: a case that reached the terminal reddens
 * instead of hanging.
 *
 * A run with no branch checked out, a detached HEAD, is the same wiring
 * on the `no-branch` standing: the cases hand in the base its caller
 * read and assert the argv that ran, so the branch is shown cut from
 * `origin/<base>` and not from a local base, and the answer where the
 * offer was not taken is null, which the guard refuses with or without
 * `--any-branch`. Each sits beside the case on a branch it was varied
 * from.
 *
 * `refuseWorktreeBesideCreateBranch` reads the words alone, so its
 * cases hand it lines and read what it throws; each refusing case is
 * paired with the same line less one flag, which returns, so the
 * refusal is shown to be keyed on the pair and not on either flag.
 *
 * `refuseWorktreeWhileTracking` reads the words and three config
 * flags; every refusing case is paired with a returning one (all
 * settings off, or the flag absent with the settings on), so the
 * refusal is shown to be keyed on both.
 *
 * `--retry` is the one flag `readRunArgs` refuses: each refused value is
 * read off the `CommandExit` it throws, beside the accepted counts 1 and
 * 3 as its controls, so a reader refusing every value fails here.
 *
 * The guard and wiring cases moved here from `tests/plan-stamp.test.ts`
 * with the two functions, unchanged. The guard's `naming.branch` cases
 * hand it `work/{stub}` and read `work/<stub>`, and no `feat/`, in the
 * refusal on `main`, in the refusal of a detached HEAD, in the `git`
 * line and in the convention warning; the refusals are each paired with
 * the same call under no template, which names `feat/`.
 */

import type { BranchSeams } from './branch.js';
import type { GitResult } from '../pr/index.js';

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { CommandExit } from '@open-tomato/rafa/core/command';
import { setActiveOutput } from '@open-tomato/rafa/core/output';

import { sinkOutput } from '../tests/output-sinks.js';

import { CONTINUE_OFF, DIRECTIVE_REASON } from './continue-args.js';
import { DEFAULT_CI_ATTEMPTS, DEFAULT_CI_TIMEOUT_MIN } from './pr-lifecycle.js';
import {
  guardRunBranch,
  readRunArgs,
  refuseWorktreeBesideCreateBranch,
  refuseWorktreeWhileTracking,
  resolveRunBranch,
} from './run-setup.js';
import { NOTHING_DISPATCHED } from './session.js';

const STUB = 'q16a-compose-n8n';

describe('readRunArgs', () => {
  it('reads the defaults off a line that names none of its flags', () => {
    expect(readRunArgs([])).toEqual({
      startAt: undefined,
      plan: undefined,
      ciWait: true,
      ciTimeoutMin: DEFAULT_CI_TIMEOUT_MIN,
      ciAttempts: DEFAULT_CI_ATTEMPTS,
      roadmap: false,
      retry: undefined,
      continueRun: CONTINUE_OFF,
    });
  });

  it('reads every flag it owns off a line that names each', () => {
    const args = [
      '--start-at=23:00',
      '--plan=.rafa/plans/PLAN-x.md',
      '--no-ci-wait',
      '--ci-timeout=5',
      '--ci-attempts=0',
      '--roadmap',
      '--retry=2',
      '--continue',
      '--decide=jump',
      '--force-wrap-up',
    ];

    expect(readRunArgs(args)).toEqual({
      startAt: '23:00',
      plan: '.rafa/plans/PLAN-x.md',
      ciWait: false,
      ciTimeoutMin: 5,
      ciAttempts: 0,
      roadmap: true,
      retry: 2,
      continueRun: { on: true, directive: { strategy: 'jump', reason: DIRECTIVE_REASON }, forceWrapUp: true },
    });
  });

  it('reads a bare value flag as unset, and leaves a number it cannot read to the CI stage', () => {
    // `argValue` reads `flag=value` only, so a bare `--plan` names nothing.
    const read = readRunArgs(['--plan', '--start-at', '--ci-timeout=soon']);

    expect(read.plan).toBeUndefined();
    expect(read.startAt).toBeUndefined();
    expect(read.ciTimeoutMin).toBeNaN();
  });

  it('reads nothing off a flag it does not own', () => {
    // `--inject` and `--skills-resolver` are `start/run-config.ts`'s; the
    // two branch flags are read by the branch step, not into these args.
    const read = readRunArgs(['--inject=task', '--skills-resolver=none', '--any-branch', '--create-branch']);

    expect(read).toEqual(readRunArgs([]));
  });
});

/** The `CommandExit` reading `args` threw. Fails when it threw none. */
function retryRefusal(args: readonly string[]): CommandExit {
  try {
    readRunArgs(args);
  } catch (error) {
    if (error instanceof CommandExit) return error;
    throw error;
  }
  throw new Error(`expected ${args.join(' ')} to be refused, and nothing was thrown`);
}

describe('readRunArgs --retry', () => {
  it.each([[1], [2], [3]])('reads --retry=%p as that count', (count) => {
    expect(readRunArgs([`--retry=${String(count)}`]).retry).toBe(count);
  });

  it('takes the last --retry of two, as the parser takes the later flag', () => {
    expect(readRunArgs(['--retry=1', '--retry=3']).retry).toBe(3);
  });

  it('reads nothing past a --, where a word is no flag of the run', () => {
    expect(readRunArgs(['--', '--retry=9']).retry).toBeUndefined();
  });

  it.each([['0'], ['-1'], ['4'], ['1.5'], ['two'], [''], ['02'], ['false'], ['true']])(
    'refuses --retry=%p before the run starts, naming the value and the range',
    (value) => {
      const refusal = retryRefusal([`--retry=${value}`]);

      expect(refusal.exitCode).toBe(1);
      expect(refusal.message).toContain(`--retry=${value}`);
      expect(refusal.message).toContain('a whole number from 1 to 3');
      expect(refusal.message).toContain(NOTHING_DISPATCHED);
    },
  );

  it('refuses a bare --retry, and one whose count is the next word, naming the = spelling', () => {
    for (const args of [['--retry'], ['--retry', '2']]) {
      const refusal = retryRefusal(args);

      expect(refusal.message).toContain('--retry=<n>');
      expect(refusal.exitCode).toBe(1);
    }
  });

  it('refuses --no-retry, naming false in loop.retries as how retries are off', () => {
    const refusal = retryRefusal(['--no-retry']);

    expect(refusal.message).toContain('loop.retries: false');
    expect(refusal.exitCode).toBe(1);
  });
});

/** The `CommandExit` the guard threw, or null when it let the run through. */
function refusalOf(planStub: string | null, branch: string | null, args: readonly string[]): CommandExit | null {
  try {
    guardRunBranch(planStub, branch, args);
    return null;
  } catch (error) {
    if (error instanceof CommandExit) return error;
    throw error;
  }
}

/** Runs the refusal over `args` and answers what it threw, or undefined. */
function worktreeRefusalOf(args: readonly string[]): unknown {
  try {
    refuseWorktreeBesideCreateBranch(args);
  } catch (error) {
    return error;
  }
  return undefined;
}

describe('refuseWorktreeBesideCreateBranch', () => {
  it('throws exit code 1 naming both flags when the line carries both', () => {
    const thrown = worktreeRefusalOf(['--plan=.rafa/plans/PLAN-x.md', '--as-worktree', '--create-branch']);

    expect(thrown).toBeInstanceOf(CommandExit);
    const exit = thrown as CommandExit;
    expect(exit.exitCode).toBe(1);
    expect(exit.message.startsWith('❌ Refusing --as-worktree beside --create-branch:')).toBe(true);
    expect(exit.message).toContain('--as-worktree alone');
    expect(exit.message).toContain('--create-branch alone');
    expect(exit.message.endsWith(NOTHING_DISPATCHED)).toBe(true);
  });

  it('refuses the pair in either order', () => {
    expect(worktreeRefusalOf(['--create-branch', '--as-worktree'])).toBeInstanceOf(CommandExit);
  });

  it.each([
    [['--plan=.rafa/plans/PLAN-x.md', '--as-worktree']],
    [['--plan=.rafa/plans/PLAN-x.md', '--create-branch']],
    [['--plan=.rafa/plans/PLAN-x.md']],
  ])('returns for %j, which carries at most one of the two', (args) => {
    expect(worktreeRefusalOf(args)).toBeUndefined();
  });

  it('reads the flags as bare words, as the branch offer reads --create-branch', () => {
    // `resolveRunBranch` acts on the bare `--create-branch` only, so a
    // valued spelling makes no branch and there is no pair to refuse.
    expect(worktreeRefusalOf(['--as-worktree', '--create-branch=false'])).toBeUndefined();
  });
});

const TRACKING_OFF = { trackingSpecs: false, trackingPlans: false, trackingAll: false };

/** Runs the tracking refusal and answers what it threw, or undefined. */
function trackingRefusalOf(args: readonly string[], on: Partial<typeof TRACKING_OFF>): unknown {
  try {
    refuseWorktreeWhileTracking(args, { ...TRACKING_OFF, ...on });
  } catch (error) {
    return error;
  }
  return undefined;
}

describe('refuseWorktreeWhileTracking', () => {
  it.each([
    ['trackingSpecs', 'tracking.specs'],
    ['trackingPlans', 'tracking.plans'],
    ['trackingAll', 'tracking.all'],
  ])('throws exit code 1 naming %s as `%s` when it alone is on', (field, key) => {
    const thrown = trackingRefusalOf(['--as-worktree'], { [field]: true });

    expect(thrown).toBeInstanceOf(CommandExit);
    const exit = thrown as CommandExit;
    expect(exit.exitCode).toBe(1);
    expect(exit.message.startsWith(`❌ Refusing --as-worktree while \`${key}\` is on:`)).toBe(true);
    for (const other of ['tracking.specs', 'tracking.plans', 'tracking.all'].filter((name) => name !== key)) {
      expect(exit.message).not.toContain(`\`${other}\``);
    }
    expect(exit.message.endsWith(NOTHING_DISPATCHED)).toBe(true);
  });

  it('names every setting that is on', () => {
    const thrown = trackingRefusalOf(['--as-worktree'], { trackingSpecs: true, trackingAll: true });

    expect((thrown as CommandExit).message).toContain('`tracking.specs`, `tracking.all` are on:');
  });

  it('returns under --as-worktree when every tracking setting is off', () => {
    expect(trackingRefusalOf(['--as-worktree'], {})).toBeUndefined();
  });

  it('returns without --as-worktree even with every tracking setting on', () => {
    const allOn = { trackingSpecs: true, trackingPlans: true, trackingAll: true };

    expect(trackingRefusalOf(['--plan=.rafa/plans/PLAN-x.md'], allOn)).toBeUndefined();
  });
});

describe('guardRunBranch', () => {
  /** Lines the guard wrote through the active output at warn level. */
  let warnings: string[] = [];

  /** Lines it wrote at any other level. */
  let others: string[] = [];

  beforeEach(() => {
    warnings = [];
    others = [];
    const other = (message: string): void => {
      others.push(message);
    };
    setActiveOutput(sinkOutput({
      warn: (message) => {
        warnings.push(message);
      },
      info: other,
      error: other,
      debug: other,
    }));
  });

  afterEach(() => {
    setActiveOutput(null);
  });

  /** The four lines every refusal opens with, whichever branch it is on. */
  function refusalHead(branch: string): readonly string[] {
    return [
      `\n❌ Refusing to run a plan on \`${branch}\`.`,
      '   A plan run needs its own branch: that is what gives it a PR to',
      '   review, and what lets the wrap-up\'s CI stage have something to',
      '   wait on. Run on main and both are silently skipped.',
    ];
  }

  /** The line every refusal ends with. */
  const ANY_BRANCH_LINE = '\n   Pass --any-branch to run here anyway.';

  /** The refusal a plan whose file names a stub gets: the flag, and the branch it would make. */
  function refusalNamingFlag(branch: string, stub: string): string {
    return [
      ...refusalHead(branch),
      `\n   Pass --create-branch to create feat/${stub} from the latest`,
      `   origin/${branch} and run there.`,
      '   On a terminal the run asks that as a question instead of refusing.',
      ANY_BRANCH_LINE,
    ].join('\n');
  }

  /** The refusal a plan naming no stub gets: the `git` line, and why the flag is no help. */
  function refusalNamingNoFlag(branch: string): string {
    return [
      ...refusalHead(branch),
      '\n   git checkout -b feat/this-plan',
      '   --create-branch names the branch after the plan\'s stub, as',
      '   `PLAN-<stub>.md` spells it, and this plan file spells none.',
      ANY_BRANCH_LINE,
    ].join('\n');
  }

  it('refuses the default branches with exit code 1 and the whole refusal as its message', () => {
    for (const branch of ['main', 'master']) {
      const refusal = refusalOf(STUB, branch, []);

      expect(refusal?.exitCode).toBe(1);
      expect(refusal?.message).toBe(refusalNamingFlag(branch, STUB));
    }

    // The refusal is the dispatcher's to write, so the guard wrote none of it.
    expect([...warnings, ...others]).toEqual([]);
  });

  it('names --create-branch and the branch it would make, and never a `git checkout` line', () => {
    const message = refusalOf(STUB, 'main', [])?.message ?? '';

    expect(message).toContain(`--create-branch to create feat/${STUB}`);
    expect(message).toContain('origin/main');
    expect(message).not.toContain('git checkout -b');
  });

  it('offers the `git` line, not the flag, for a plan whose file names no stub', () => {
    // `--create-branch` builds the name out of the stub, so a plain
    // `PLAN.md` would get a flag that stands aside on the next run too.
    const message = refusalOf(null, 'main', [])?.message ?? '';

    expect(message).toBe(refusalNamingNoFlag('main'));
    expect(message).not.toContain('Pass --create-branch');
  });

  /** The two lines every refusal of a run with no branch checked out opens with. */
  const DETACHED_HEAD_LINES: readonly string[] = [
    '❌ Refusing to run on a detached HEAD: no branch is checked out, and a run',
    '   commits to, pushes and opens its pull request from a branch of its own.',
  ];

  /** The refusal a run with no branch checked out gets for a plan whose file names a stub. */
  function detachedRefusal(stub: string): string {
    return [
      ...DETACHED_HEAD_LINES,
      `\n   Pass --create-branch to create feat/${stub} from the latest`,
      '   origin/<base> and run there.',
      '   On a terminal the run asks that as a question instead of refusing.',
      '\n   Or pass --as-worktree to run the plan in a worktree of its own, leaving',
      '   this checkout where it is.',
      NOTHING_DISPATCHED,
    ].join('\n');
  }

  it('refuses no branch with exit code 1, naming --create-branch and its branch first and --as-worktree second', () => {
    const refusal = refusalOf(STUB, null, []);
    const message = refusal?.message ?? '';

    expect(refusal?.exitCode).toBe(1);
    expect(message).toBe(detachedRefusal(STUB));
    expect(message.indexOf(`--create-branch to create feat/${STUB}`)).toBeGreaterThan(-1);
    expect(message.indexOf('--create-branch')).toBeLessThan(message.indexOf('--as-worktree'));
    expect([...warnings, ...others]).toEqual([]);
  });

  it('refuses no branch under --any-branch too, with the same refusal and no warning', () => {
    for (const args of [['--any-branch'], ['--any-branch', '--create-branch']]) {
      const refusal = refusalOf(STUB, null, args);

      expect(refusal?.exitCode).toBe(1);
      expect(refusal?.message).toBe(detachedRefusal(STUB));
    }
    expect(warnings).toEqual([]);

    // The control: the flag still lets a branch through, the default one included.
    expect(refusalOf(STUB, 'main', ['--any-branch'])).toBeNull();
    expect(warnings).toHaveLength(1);
  });

  it('offers the `git` line for no branch and a plan with no stub, naming no flag that could not help', () => {
    const message = refusalOf(null, null, [])?.message ?? '';

    expect(message).toBe([
      ...DETACHED_HEAD_LINES,
      '\n   git checkout -b feat/this-plan',
      '   --create-branch names the branch after the plan\'s stub, as',
      '   `PLAN-<stub>.md` spells it, and this plan file spells none.',
      NOTHING_DISPATCHED,
    ].join('\n'));
    expect(message).not.toContain('Pass --create-branch');
    // `--as-worktree` names its worktree after the stub and refuses a plan with none.
    expect(message).not.toContain('--as-worktree');
  });

  /** A `naming.branch` other than the default, which every name the guard writes is rendered from. */
  const WORK_TEMPLATE = 'work/{stub}';

  it('names the branch of naming.branch in the refusal on main, and never feat/', () => {
    let caught: CommandExit | null = null;
    try {
      guardRunBranch(STUB, 'main', [], WORK_TEMPLATE);
    } catch (error) {
      if (!(error instanceof CommandExit)) throw error;
      caught = error;
    }

    expect(caught?.exitCode).toBe(1);
    expect(caught?.message).toBe(refusalNamingFlag('main', STUB).replace(`feat/${STUB}`, `work/${STUB}`));
    expect(caught?.message).toContain(`--create-branch to create work/${STUB}`);
    expect(caught?.message).not.toContain('feat/');
    // The control: with no template handed in, the same refusal names feat/.
    expect(refusalOf(STUB, 'main', [])?.message).toContain(`--create-branch to create feat/${STUB}`);
  });

  it('names the branch of naming.branch in the refusal of a detached HEAD, and never feat/', () => {
    let caught: CommandExit | null = null;
    try {
      guardRunBranch(STUB, null, [], WORK_TEMPLATE);
    } catch (error) {
      if (!(error instanceof CommandExit)) throw error;
      caught = error;
    }

    expect(caught?.exitCode).toBe(1);
    expect(caught?.message).toBe(detachedRefusal(STUB).replace(`feat/${STUB}`, `work/${STUB}`));
    expect(caught?.message).toContain(`--create-branch to create work/${STUB}`);
    expect(caught?.message).not.toContain('feat/');
    expect(refusalOf(STUB, null, [])?.message).toContain(`--create-branch to create feat/${STUB}`);
  });

  it('renders the `git` line of a plan with no stub through naming.branch', () => {
    let message = '';
    try {
      guardRunBranch(null, 'main', [], WORK_TEMPLATE);
    } catch (error) {
      if (!(error instanceof CommandExit)) throw error;
      message = error.message;
    }

    expect(message).toContain('git checkout -b work/this-plan');
    expect(message).not.toContain('feat/');
  });

  it('spells the convention of the warning through naming.branch', () => {
    guardRunBranch(STUB, 'probe', [], WORK_TEMPLATE);

    expect(warnings).toEqual([
      '\n⚠️  Branch `probe` carries no `<type>/` prefix.',
      '   The run proceeds; the convention is `work/<plan-stub>`.',
    ]);
  });

  it('allows a feature branch, writing nothing', () => {
    expect(refusalOf(STUB, `feat/${STUB}`, [])).toBeNull();
    expect([...warnings, ...others]).toEqual([]);
  });

  it('allows a branch that names the plan differently', () => {
    // Measured: five of eleven plan branches do. A refusal keyed on
    // the name would reject the project's own convention.
    expect(refusalOf('q17-dynamic-form-provider-v1', 'feat/q17-dynamic-forms', []))
      .toBeNull();
  });

  it('lets --any-branch through on main, warning once', () => {
    expect(refusalOf(STUB, 'main', ['--any-branch'])).toBeNull();
    expect(warnings).toEqual(['\n⚠️  --any-branch: running on `main` without the branch check.']);
    expect(others).toEqual([]);
  });

  it('warns twice on a plan branch with no type prefix, and lets it through', () => {
    expect(refusalOf(STUB, 'probe', [])).toBeNull();
    expect(warnings).toEqual([
      '\n⚠️  Branch `probe` carries no `<type>/` prefix.',
      '   The run proceeds; the convention is `feat/<plan-stub>`.',
    ]);

    // The control: the same branch with no plan stub warns about nothing.
    warnings = [];
    expect(refusalOf(null, 'probe', [])).toBeNull();
    expect(warnings).toEqual([]);
  });
});

describe('resolveRunBranch', () => {
  /** The root the stubbed git is asked for; nothing is spawned in it. */
  const REPO = '/nowhere';

  /** The branch the plan's stub names. */
  const BRANCH = `feat/${STUB}`;

  /** git exited 0, having written `stdout`. */
  function ok(stdout = ''): GitResult {
    return { ok: true, stdout, stderr: '' };
  }

  /** git exited nonzero, having written nothing. */
  const failed: GitResult = { ok: false, stdout: '', stderr: '' };

  /** A run on `main` with no `feat/<stub>` anywhere, a clean tree and every step exiting 0. */
  const CLEAN: Readonly<Record<string, GitResult>> = {
    [`show-ref --verify --quiet refs/heads/${BRANCH}`]: failed,
    [`show-ref --verify --quiet refs/remotes/origin/${BRANCH}`]: failed,
    'status --porcelain': ok(),
    'fetch origin main': ok(),
    'rev-list --left-right --count main...origin/main': ok('0\t0\n'),
    'merge --ff-only origin/main': ok('Already up to date.\n'),
    [`switch -c ${BRANCH}`]: ok(),
    [`switch --no-track -c ${BRANCH} origin/main`]: ok(),
    [`switch ${BRANCH}`]: ok(),
  };

  /** What the offer reads before any answer: whether git has `feat/<stub>`, locally then on `origin`. */
  const REF_READS: readonly string[] = [
    `show-ref --verify --quiet refs/heads/${BRANCH}`,
    `show-ref --verify --quiet refs/remotes/origin/${BRANCH}`,
  ];

  /**
   * {@link CLEAN} with `over` laid over it, a terminal when `canAsk`, and
   * a prompter nothing may open. Every argv git was asked for lands in
   * `ran`, in order.
   */
  function seams(
    over: Readonly<Record<string, GitResult>> = {},
    canAsk = false,
    ran: string[] = [],
  ): BranchSeams {
    const replies: Readonly<Record<string, GitResult>> = { ...CLEAN, ...over };
    return {
      git: () => (args) => {
        const key = args.join(' ');
        const reply = replies[key];
        if (reply === undefined) throw new Error(`the stub has no reply for git ${key}`);
        ran.push(key);
        return reply;
      },
      isTerminal: () => canAsk,
      openPrompter: () => {
        throw new Error('the prompter was opened');
      },
    };
  }

  /** Seams whose git throws on any command at all, so a case that read git reddens. */
  const NO_GIT: BranchSeams = {
    git: () => (args) => {
      throw new Error(`git ${args.join(' ')} ran`);
    },
    isTerminal: () => true,
    openPrompter: () => {
      throw new Error('the prompter was opened');
    },
  };

  /** The branch the run goes on, for a plan stub, the branch it was started on and a run's words. */
  function resolved(
    planStub: string | null,
    base: string,
    args: readonly string[],
    over: BranchSeams,
  ): Promise<string | null> {
    return resolveRunBranch({ checkout: REPO, planStub, base, args }, over);
  }

  /**
   * The same for a run with no branch checked out, `base` being the base
   * its caller read for it: the branch it goes on, or null when it is
   * still on none.
   */
  function resolvedDetached(
    planStub: string | null,
    args: readonly string[],
    over: BranchSeams,
    base = 'main',
  ): Promise<string | null> {
    return resolveRunBranch({ checkout: REPO, planStub, base, standing: 'no-branch', args }, over);
  }

  beforeEach(() => {
    setActiveOutput(sinkOutput({}));
  });

  afterEach(() => {
    setActiveOutput(null);
  });

  it('answers a branch of its own without reading git at all', async () => {
    // The offer is only made on a default branch, so a run already on
    // its own branch costs no process and asks nothing.
    expect(await resolved(STUB, BRANCH, [], NO_GIT)).toBe(BRANCH);
    expect(await resolved(STUB, 'feat/something-else', [], NO_GIT)).toBe('feat/something-else');
  });

  it('carries the branch --create-branch created, which the guard then allows', async () => {
    const args = ['--create-branch'];
    const branch = await resolved(STUB, 'main', args, seams());

    expect(branch).toBe(BRANCH);
    // The whole point of the wiring: the guard reads the new branch, not `main`.
    expect(refusalOf(STUB, branch, args)).toBeNull();
  });

  it('carries an existing local feat/<stub> a switch moved to', async () => {
    const local = { [`show-ref --verify --quiet refs/heads/${BRANCH}`]: ok() };

    expect(await resolved(STUB, 'main', ['--create-branch'], seams(local))).toBe(BRANCH);
  });

  it('leaves the run on the base with no terminal and no flag, for the guard to refuse', async () => {
    const branch = await resolved(STUB, 'main', [], seams());

    expect(branch).toBe('main');
    expect(refusalOf(STUB, branch, [])?.exitCode).toBe(1);
  });

  it('leaves the run on the base under --any-branch, reading no git', async () => {
    expect(await resolved(STUB, 'main', ['--any-branch', '--create-branch'], NO_GIT)).toBe('main');
  });

  it('leaves the run on the base for a plan whose file names no stub', async () => {
    expect(await resolved(null, 'main', ['--create-branch'], NO_GIT)).toBe('main');
  });

  // The two lines that answer the question yes before it is asked.
  const CREATING_LINES: readonly (readonly string[])[] = [
    ['--create-branch'],
    ['--any-branch', '--create-branch'],
  ];

  for (const args of CREATING_LINES) {
    it(`creates feat/<stub> from origin/<base> with no branch checked out under [${args.join(' ')}]`, async () => {
      const ran: string[] = [];
      const branch = await resolvedDetached(STUB, args, seams({}, false, ran));

      expect(branch).toBe(BRANCH);
      // The fetch, then the branch cut from the fetched ref: no local base is read or fast-forwarded.
      expect(ran).toEqual([
        ...REF_READS,
        'status --porcelain',
        'fetch origin main',
        `switch --no-track -c ${BRANCH} origin/main`,
      ]);
      expect(refusalOf(STUB, branch, args)).toBeNull();
    });
  }

  it('walks the four steps of the base for the same line on main, the control for the two above', async () => {
    const ran: string[] = [];

    expect(await resolved(STUB, 'main', ['--create-branch'], seams({}, false, ran))).toBe(BRANCH);
    expect(ran).toEqual([
      ...REF_READS,
      'status --porcelain',
      'fetch origin main',
      'rev-list --left-right --count main...origin/main',
      'merge --ff-only origin/main',
      `switch -c ${BRANCH}`,
    ]);
  });

  it('cuts the branch from the base it was handed, with no branch checked out', async () => {
    const ran: string[] = [];
    const onStretch = {
      'fetch origin stretch/21': ok(),
      [`switch --no-track -c ${BRANCH} origin/stretch/21`]: ok(),
    };
    const branch = await resolvedDetached(STUB, ['--create-branch'], seams(onStretch, false, ran), 'stretch/21');

    expect(branch).toBe(BRANCH);
    expect(ran.slice(-2)).toEqual(['fetch origin stretch/21', `switch --no-track -c ${BRANCH} origin/stretch/21`]);
  });

  it('switches to a feat/<stub> git already has with no branch checked out, fetching nothing', async () => {
    const ran: string[] = [];
    const local = { [`show-ref --verify --quiet refs/heads/${BRANCH}`]: ok() };

    expect(await resolvedDetached(STUB, ['--create-branch'], seams(local, false, ran))).toBe(BRANCH);
    expect(ran).toEqual([...REF_READS, 'status --porcelain', `switch ${BRANCH}`]);
  });

  // The two lines that answer nothing: no terminal is there to ask either.
  const UNANSWERED_LINES: readonly (readonly string[])[] = [[], ['--any-branch']];

  for (const args of UNANSWERED_LINES) {
    it(`answers no branch under [${args.join(' ')}] with no terminal, which the guard refuses`, async () => {
      const ran: string[] = [];
      const branch = await resolvedDetached(STUB, args, seams({}, false, ran));
      const refusal = refusalOf(STUB, branch, args);

      expect(branch).toBeNull();
      // `--any-branch` stood nothing aside: the refs were read with it as without it.
      expect(ran).toEqual([...REF_READS]);
      expect(refusal?.exitCode).toBe(1);
      expect(refusal?.message).toStartWith('❌ Refusing to run on a detached HEAD');
      expect(refusal?.message).toContain(`--create-branch to create ${BRANCH}`);
      expect(refusal?.message).toEndWith(NOTHING_DISPATCHED);
    });
  }

  it('answers no branch for a plan whose file names no stub, reading no git, and the guard prints the git line', async () => {
    const args = ['--create-branch'];
    const branch = await resolvedDetached(null, args, NO_GIT);

    expect(branch).toBeNull();
    expect(refusalOf(null, branch, args)?.message).toContain('git checkout -b feat/this-plan');
  });

  it('answers no branch once the question is declined on a terminal, and the branch on a yes', async () => {
    const asked: string[] = [];
    const answering = (answer: string): BranchSeams => ({
      ...seams({}, true),
      openPrompter: () => ({
        say: () => undefined,
        ask: (question) => {
          asked.push(question);
          return Promise.resolve(answer);
        },
        close: () => undefined,
      }),
    });
    const question = `Create ${BRANCH} from the latest origin/main and run there? [y/N] `;

    expect(await resolvedDetached(STUB, [], answering('n'))).toBeNull();
    expect(await resolvedDetached(STUB, ['--any-branch'], answering('y'))).toBe(BRANCH);
    expect(asked).toEqual([question, question]);
  });

  it('answers the branch a run is on wherever one is checked out, the control for the cases on none', async () => {
    // Same lines, a named branch instead of none: each answers that branch, reading no git.
    for (const args of [...CREATING_LINES, ...UNANSWERED_LINES]) {
      expect(await resolved(STUB, 'feat/other', args, NO_GIT)).toBe('feat/other');
    }
    // And on the base an offer not taken answers the base, never null.
    expect(await resolved(STUB, 'main', [], seams())).toBe('main');
  });
});
