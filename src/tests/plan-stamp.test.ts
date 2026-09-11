/**
 * Tests for the plan stamp (tools/ralph/utils/plan-stamp.ts), the
 * attribution tier that reads it, and the branch guard.
 *
 * The load-bearing case is `keeps every prompt shape classifiable`:
 * `effort/classify.ts` buckets a session by `content.startsWith(...)`
 * over the WHOLE prompt, so a marker written above the body would
 * re-bucket all five shapes as `other` while that module's own drift
 * guard stayed green. Nothing else here would catch that.
 */

import { describe, expect, it } from 'vitest';

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
      '* Compact `@progress.txt` per `.claude/skills/progress-hygiene/SKILL.md`, and change NOTHING else.\n* body',
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
  it('refuses the default branches', () => {
    expect(guardRunBranch(STUB, 'main', [])).toBe(false);
    expect(guardRunBranch(STUB, 'master', [])).toBe(false);
  });

  it('allows a feature branch', () => {
    expect(guardRunBranch(STUB, `feat/${STUB}`, [])).toBe(true);
  });

  it('allows a branch that names the plan differently', () => {
    // Measured: five of eleven plan branches do. A refusal keyed on
    // the name would reject the project's own convention.
    expect(guardRunBranch('q17-dynamic-form-provider-v1', 'feat/q17-dynamic-forms', []))
      .toBe(true);
  });

  it('lets --any-branch through on main', () => {
    expect(guardRunBranch(STUB, 'main', ['--any-branch'])).toBe(true);
  });
});
