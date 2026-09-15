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
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { setActiveOutput } from '../adapters/output/active.js';
import { CommandExit } from '../cli/command.js';
import { resolveSessionPlan } from '../effort/attribution.js';
import { classifyPromptContent } from '../effort/classify.js';
import { guardRunBranch } from '../start.js';
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

  /** The refusal the guard prints for a branch, one element per line it printed before. */
  function refusalText(branch: string, name: string): string {
    return [
      `\n❌ Refusing to run a plan on \`${branch}\`.`,
      '   A plan run needs its own branch: that is what gives it a PR to',
      '   review, and what lets the wrap-up\'s CI stage have something to',
      '   wait on. Run on main and both are silently skipped.',
      `\n   git checkout -b feat/${name}`,
      '\n   Pass --any-branch to run here anyway.',
    ].join('\n');
  }

  it('refuses the default branches with exit code 1 and the whole refusal as its message', () => {
    for (const branch of ['main', 'master']) {
      const refusal = refusalOf(STUB, branch, []);

      expect(refusal?.exitCode).toBe(1);
      expect(refusal?.message).toBe(refusalText(branch, STUB));
    }
    expect(refusalOf(null, 'main', [])?.message).toBe(refusalText('main', 'this-plan'));

    // The refusal is the dispatcher's to write, so the guard wrote none of it.
    expect([...warnings, ...others]).toEqual([]);
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
