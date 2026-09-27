/**
 * Tests for `skillSignals` and `lessonSignals`, the signals behind
 * `rafa effort report --skills`.
 *
 * Both readers are pure, so every fixture is a list of fact rows built
 * here, run through the real `findRecurrences`, and no store is opened.
 * There is one fixture per skill signal, one for the invoked-never-offered
 * listing, one for a session whose invocations are unknown, and one per
 * lesson signal. A reading that could hold only because nothing was
 * found is paired with a control that turns it once the difference is
 * put in.
 */
import type { SkillFact, SkillFactEntry } from './skill-facts.js';
import type { RecurrenceMatcher } from './skill-signals.js';
import type { PlanCiRow } from './store/plan-ci.js';

import { describe, expect, it } from 'bun:test';

import { findRecurrences } from './recurrence.js';
import { lessonSignals, SKILL_SIGNALS, skillSignals } from './skill-signals.js';

/** The plan every row runs under. */
const PLAN = 'rafa-24-know-which-skills-earn';

/** A failure string most fixtures declare. */
const TS_ERROR = 'TS2769';

/** A skill's failure strings, by name. */
const STRINGS = new Map([['typescript-patterns', [TS_ERROR]]]);

/** A blocker naming `what`. */
function blocker(what: string): SkillFactEntry {
  return { what, artifact: null };
}

/** A fact row for `sessionId` holding what is given, under `PLAN`. */
function fact(sessionId: string, rows: Partial<SkillFact> = {}): SkillFact {
  return {
    sessionId,
    planStub: PLAN,
    taskLine: `task of ${sessionId}`,
    outcome: 'done',
    skillsUsed: [],
    resolver: 'planner',
    skillsOffered: [],
    lessonsOffered: [],
    invoked: [],
    findings: [],
    blockers: [],
    outOfScopeBugs: [],
    planCi: [],
    ...rows,
  };
}

/** A red CI reading of `PLAN` failing `names`. */
function redCi(...names: string[]): PlanCiRow {
  return {
    planStub: PLAN,
    pr: 7,
    headSha: 'abc123',
    verdict: 'red',
    failing: names,
    readAt: '2026-09-27T10:00:00.000Z',
  };
}

/** A row's invocations: each name invoked once. */
function invoking(...names: string[]): SkillFact['invoked'] {
  return names.map((name) => ({ name, count: 1 }));
}

/** The one offered skill named `name` in `facts`' signals. */
function skillRow(facts: readonly SkillFact[], name: string, strings = STRINGS) {
  const row = skillSignals(facts, findRecurrences, strings).skills.find((skill) => skill.name === name);
  if (row === undefined) throw new Error(`no offered skill ${name}`);
  return row;
}

describe('the skill signal order', () => {
  it('checks recurring, unmeasured, earning and ignored, in that order', () => {
    expect(SKILL_SIGNALS).toEqual(['recurring', 'unmeasured', 'earning', 'ignored']);
  });
});

describe('recurring', () => {
  const offered = { skillsOffered: ['typescript-patterns'] };
  const facts = [
    fact('s1', { ...offered, invoked: invoking('typescript-patterns') }),
    fact('s2', { blockers: [blocker(`tsc refused it: ${TS_ERROR}`)] }),
  ];

  it('is a skill invoked in a task whose failure string recurs in a later task\'s blocker', () => {
    const row = skillRow(facts, 'typescript-patterns');

    expect(row.signal).toBe('recurring');
    expect(row.recurred).toBe(1);
    expect(row.matches).toEqual([{
      string: TS_ERROR,
      source: 'blocker',
      sessionId: 's2',
      taskLine: 'task of s2',
      field: 'what',
      text: `tsc refused it: ${TS_ERROR}`,
    }]);
  });

  it('outranks earning when another invocation saw no recurrence', () => {
    const later = [...facts, fact('s3', { ...offered, invoked: invoking('typescript-patterns') })];
    const row = skillRow(later, 'typescript-patterns');

    expect(row.signal).toBe('recurring');
    expect(row.invoked).toBe(2);
    expect(row.recurred).toBe(1);
  });

  it('keeps a match found from two invoking tasks once', () => {
    const twice = [fact('s0', { ...offered, invoked: invoking('typescript-patterns') }), ...facts];
    const row = skillRow(twice, 'typescript-patterns');

    expect(row.recurred).toBe(2);
    expect(row.matches).toHaveLength(1);
  });

  it('searches from the invoking task with that task\'s plan CI', () => {
    const calls: [number, readonly PlanCiRow[]][] = [];
    const spy: RecurrenceMatcher = (strings, rows, fromIndex, planCi) => {
      calls.push([fromIndex, planCi]);
      return findRecurrences(strings, rows, fromIndex, planCi);
    };
    const ci = [redCi(TS_ERROR)];
    const withCi = [fact('s0', { planCi: ci }), fact('s1', { ...offered, planCi: ci, invoked: invoking('typescript-patterns') })];

    expect(skillSignals(withCi, spy, STRINGS).skills[0]?.signal).toBe('recurring');
    expect(calls).toEqual([[1, ci]]);
  });
});

describe('unmeasured', () => {
  const facts = [fact('s1', { skillsOffered: ['git-workflow'], invoked: invoking('git-workflow') })];

  it('is a skill invoked while declaring no failure strings', () => {
    const row = skillRow(facts, 'git-workflow');

    expect(row.signal).toBe('unmeasured');
    expect(row.uptake).toBe(1);
    expect(row.offered).toBe(1);
  });

  it('holds for a skill mapped to no strings as for one missing from the map', () => {
    expect(skillRow(facts, 'git-workflow', new Map([['git-workflow', []]])).signal).toBe('unmeasured');
  });

  it('outranks earning, which the same skill reads once it declares a string', () => {
    expect(skillRow(facts, 'git-workflow', new Map([['git-workflow', [TS_ERROR]]])).signal).toBe('earning');
  });
});

describe('earning', () => {
  const offered = { skillsOffered: ['typescript-patterns'] };
  const facts = [
    fact('s1', { ...offered, invoked: invoking('typescript-patterns') }),
    fact('s2', { blockers: [blocker('the build ran out of disk')] }),
  ];

  it('is a skill offered and invoked with no recurrence after any invocation', () => {
    const row = skillRow(facts, 'typescript-patterns');

    expect(row.signal).toBe('earning');
    expect(row.recurred).toBe(0);
    expect(row.matches).toEqual([]);
  });

  it('turns recurring once its string is in the later blocker', () => {
    const recurred = [facts[0] ?? fact('s1'), fact('s2', { blockers: [blocker(`out of disk, ${TS_ERROR}`)] })];

    expect(skillRow(recurred, 'typescript-patterns').signal).toBe('recurring');
  });
});

describe('ignored', () => {
  const facts = [
    fact('s1', { skillsOffered: ['security-review'], invoked: invoking('git-workflow') }),
    fact('s2', { skillsOffered: ['security-review'] }),
  ];

  it('is a skill offered in some task and invoked in none', () => {
    const row = skillRow(facts, 'security-review');

    expect(row.signal).toBe('ignored');
    expect(row.offered).toBe(2);
    expect(row.invoked).toBe(0);
  });

  it('turns unmeasured, or earning with a string declared, once one task invokes it', () => {
    const invoked = [...facts, fact('s3', { skillsOffered: ['security-review'], invoked: invoking('security-review') })];

    expect(skillRow(invoked, 'security-review').signal).toBe('unmeasured');
    expect(skillRow(invoked, 'security-review', new Map([['security-review', [TS_ERROR]]])).signal).toBe('earning');
  });

  it('reads invocations and never the report\'s claim', () => {
    const claimed = [fact('s1', { skillsOffered: ['security-review'], skillsUsed: ['security-review'] })];
    const row = skillRow(claimed, 'security-review');

    expect(row.signal).toBe('ignored');
    expect(row.reported).toBe(1);
  });
});

describe('the invoked-never-offered listing', () => {
  const facts = [
    fact('s1', { skillsOffered: ['git-workflow'], invoked: invoking('git-workflow', 'typescript-patterns') }),
    fact('s2', { blockers: [blocker(`again ${TS_ERROR}`)] }),
  ];

  it('lists a skill invoked and never offered, with no signal and its recurrences counted', () => {
    const { skills, neverOffered } = skillSignals(facts, findRecurrences, STRINGS);

    expect(skills.map(({ name }) => name)).toEqual(['git-workflow']);
    expect(neverOffered).toHaveLength(1);
    expect(neverOffered[0]).toMatchObject({ name: 'typescript-patterns', offered: 0, invoked: 1, recurred: 1 });
    expect(neverOffered[0]).not.toHaveProperty('signal');
  });

  it('lists every invoked skill for a plan run under resolver none', () => {
    const baseline = facts.map((row) => ({ ...row, resolver: 'none' as const, skillsOffered: [] }));
    const { skills, neverOffered } = skillSignals(baseline, findRecurrences, STRINGS);

    expect(skills).toEqual([]);
    expect(neverOffered.map(({ name }) => name)).toEqual(['git-workflow', 'typescript-patterns']);
  });

  it('reads an offer not recorded as offering nothing', () => {
    const unrecorded = [fact('s1', { skillsOffered: null, invoked: invoking('git-workflow') })];

    expect(skillSignals(unrecorded, findRecurrences, STRINGS).neverOffered.map(({ name }) => name)).toEqual(['git-workflow']);
  });

  it('leaves out a skill only a report names', () => {
    const claimed = [fact('s1', { skillsUsed: ['git-workflow'] })];

    expect(skillSignals(claimed, findRecurrences, STRINGS)).toEqual({ skills: [], neverOffered: [] });
  });
});

describe('a session whose invocations are unknown', () => {
  const unknown = fact('s1', { skillsOffered: ['security-review'], invoked: 'unknown' });

  it('is never read as a session that invoked nothing, so ignored is not claimed', () => {
    const row = skillRow([unknown], 'security-review');

    expect(row.signal).toBeNull();
    expect(row.unknown).toBe(1);
    expect(row.invoked).toBe(0);
  });

  it('reads ignored once the same session is known to invoke nothing', () => {
    expect(skillRow([{ ...unknown, invoked: [] }], 'security-review').signal).toBe('ignored');
  });

  it('leaves a signal read from a known session as it is', () => {
    const known = fact('s2', { skillsOffered: ['security-review'], invoked: invoking('security-review') });
    const row = skillRow([unknown, known], 'security-review');

    expect(row.signal).toBe('unmeasured');
    expect(row).toMatchObject({ offered: 2, invoked: 1, uptake: 1, unknown: 1 });
  });
});

describe('lesson signals', () => {
  const ARTIFACT = 'no changes added to commit';
  const ARTIFACTS = new Map([['lesson-commit', ARTIFACT]]);

  it('reads injected-recurring when the artifact is a failing check name after the injection', () => {
    const facts = [fact('s1', { lessonsOffered: ['lesson-commit'], planCi: [redCi(ARTIFACT)] })];
    const [row] = lessonSignals(facts, findRecurrences, ARTIFACTS);

    expect(row).toMatchObject({ id: 'lesson-commit', artifact: ARTIFACT, injected: 1, recurred: 1 });
    expect(row?.signal).toBe('injected-recurring');
    expect(row?.matches[0]).toMatchObject({ source: 'plan-ci', field: 'failing', sessionId: null });
  });

  it('reads injected when the artifact does not recur', () => {
    const facts = [fact('s1', { lessonsOffered: ['lesson-commit'], planCi: [redCi('lint')] })];

    expect(lessonSignals(facts, findRecurrences, ARTIFACTS)).toEqual([{
      id: 'lesson-commit',
      artifact: ARTIFACT,
      injected: 1,
      recurred: 0,
      matches: [],
      signal: 'injected',
    }]);
  });

  it('reads injected, with its artifact unknown, for a lesson no longer held', () => {
    const facts = [fact('s1', { lessonsOffered: ['lesson-gone'], planCi: [redCi(ARTIFACT)] })];
    const [row] = lessonSignals(facts, findRecurrences, ARTIFACTS);

    expect(row).toMatchObject({ id: 'lesson-gone', artifact: null, signal: 'injected' });
  });

  it('never claims ignored and never counts a skill as a lesson', () => {
    const facts = [fact('s1', { lessonsOffered: ['lesson-commit'], skillsOffered: ['git-workflow'] })];
    const rows = lessonSignals(facts, findRecurrences, ARTIFACTS);

    expect(rows.map(({ id, signal }) => [id, signal])).toEqual([['lesson-commit', 'injected']]);
  });
});
