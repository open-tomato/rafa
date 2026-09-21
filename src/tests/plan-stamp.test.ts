/**
 * Tests for the plan stamp (src/utils/plan-stamp.ts), the
 * attribution tier that reads it, and the branch guard.
 *
 * The load-bearing case is `keeps every prompt shape classifiable`:
 * `effort/classify.ts` buckets a session by `content.startsWith(...)`
 * over the WHOLE prompt, so a marker written above the body would
 * re-bucket all four shapes as `other` while that module's own drift
 * guard stayed green. Nothing else here would catch that.
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
 */

import type { GitResult } from '../pr/index.js';
import type { BranchSeams } from '../start/branch.js';

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { setActiveOutput } from '../adapters/output/active.js';
import { CommandExit } from '../cli/command.js';
import { resolveSessionPlan } from '../effort/attribution.js';
import { classifyPromptContent } from '../effort/classify.js';
import { guardRunBranch, resolveRunBranch } from '../start.js';
import {
  isStampableStub,
  planStampLine,
  planStubFromPath,
  planStubFromPrompt,
  stampPrompt,
} from '../utils/plan-stamp.js';

import { sinkOutput } from './output-sinks.js';

const STUB = 'q16a-compose-n8n';

describe('planStampLine and planStubFromPrompt', () => {
  it('round-trips a stub through the marker', () => {
    expect(planStubFromPrompt(planStampLine(STUB))).toBe(STUB);
  });

  it('finds the marker anywhere, not only at the start', () => {
    const prompt = `* Do the thing.\nmore body\n${planStampLine(STUB)}`;
    expect(planStubFromPrompt(prompt)).toBe(STUB);
  });

  it('answers null for a prompt carrying no marker', () => {
    expect(planStubFromPrompt('* Do the thing.')).toBeNull();
  });

  it('answers null for absent or empty content', () => {
    expect(planStubFromPrompt(null)).toBeNull();
    expect(planStubFromPrompt(undefined)).toBeNull();
    expect(planStubFromPrompt('')).toBeNull();
  });

  it('refuses to write a stub it could not read back', () => {
    expect(isStampableStub('has space')).toBe(false);
    expect(() => planStampLine('has space')).toThrow(/unusable stub/);
  });
});

describe('stampPrompt', () => {
  it('appends the marker and never prepends it', () => {
    const stamped = stampPrompt(STUB, '* First line.\n* Second line.');
    expect(stamped.startsWith('* First line.')).toBe(true);
    expect(stamped.endsWith(planStampLine(STUB))).toBe(true);
  });

  it('keeps every prompt shape classifiable', () => {
    // The regression this whole placement decision exists for.
    const shapes = [
      'Your scoped task is: Add `src/effort/classify.ts`\n* body',
      '* Read `@progress.txt` in full.\n* body',
    ];
    for (const prompt of shapes) {
      const before = classifyPromptContent(prompt);
      expect(before).not.toBe('other');
      expect(classifyPromptContent(stampPrompt(STUB, prompt))).toBe(before);
    }
  });
});

describe('planStubFromPath', () => {
  it('reads the stub off a plan and off its tracker alike', () => {
    expect(planStubFromPath(`.plans/PLAN-${STUB}.md`)).toBe(STUB);
    expect(planStubFromPath(`.plans/PLAN_TRACKER-${STUB}.md`)).toBe(STUB);
  });

  it('answers null for an unstubbed plan', () => {
    expect(planStubFromPath('.plans/PLAN.md')).toBeNull();
    expect(planStubFromPath('PLAN.md')).toBeNull();
  });
});

describe('resolveSessionPlan', () => {
  const stubs = [STUB, 'q18-runaway-control'];

  it('takes the stamp over the branch', () => {
    const prompt = stampPrompt(STUB, '* Do the thing.');
    // The branch says a DIFFERENT plan; the stamp must win.
    const got = resolveSessionPlan(prompt, 'q18-runaway-control', stubs);
    expect(got).toMatchObject({ stub: STUB, match: 'stamped' });
  });

  it('attributes a run on main, which no branch could', () => {
    // `main` yields no branch stub at all — the case that lost 74
    // sessions before stamping existed.
    const prompt = stampPrompt(STUB, '* Do the thing.');
    expect(resolveSessionPlan(prompt, null, stubs)).toMatchObject({
      stub: STUB,
      match: 'stamped',
    });
  });

  it('ignores a stamp naming a plan the store does not know', () => {
    const prompt = stampPrompt('q99-invented', '* Do the thing.');
    expect(resolveSessionPlan(prompt, 'q18-runaway-control', stubs))
      .toMatchObject({ stub: 'q18-runaway-control', match: 'exact' });
  });

  it('falls back to the branch when nothing is stamped', () => {
    expect(resolveSessionPlan('* Do the thing.', STUB, stubs))
      .toMatchObject({ stub: STUB, match: 'exact' });
  });
});

/** The `CommandExit` the guard threw, or null when it let the run through. */
function refusalOf(planStub: string | null, branch: string, args: readonly string[]): CommandExit | null {
  try {
    guardRunBranch(planStub, branch, args);
    return null;
  } catch (error) {
    if (error instanceof CommandExit) return error;
    throw error;
  }
}

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
    [`switch ${BRANCH}`]: ok(),
  };

  /** {@link CLEAN} with `over` laid over it, a terminal when `canAsk`, and a prompter nothing may open. */
  function seams(over: Readonly<Record<string, GitResult>> = {}, canAsk = false): BranchSeams {
    const replies: Readonly<Record<string, GitResult>> = { ...CLEAN, ...over };
    return {
      git: () => (args) => {
        const key = args.join(' ');
        const reply = replies[key];
        if (reply === undefined) throw new Error(`the stub has no reply for git ${key}`);
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

  /** The branch the run goes on, for a plan stub, a base and a run's words. */
  function resolved(
    planStub: string | null,
    base: string,
    args: readonly string[],
    over: BranchSeams,
  ): Promise<string> {
    return resolveRunBranch({ repoRoot: REPO, planStub, base, args }, over);
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
});
