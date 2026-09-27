/**
 * Tests for `findRecurrences`, the recurrence matcher behind `rafa effort
 * report --skills`.
 *
 * The matcher is pure, so every fact row and CI reading is built here and
 * no store is opened. Each refusal is paired with a control that holds the
 * same fixture to a match once the refused difference is taken away, so a
 * case that answers none is known to be able to answer one.
 */
import type { SkillFact, SkillFactEntry, SkillFactFinding } from './skill-facts.js';
import type { PlanCiRow } from './store/plan-ci.js';

import { describe, expect, it } from 'bun:test';

import { findRecurrences } from './recurrence.js';

/** The plan most rows run under. */
const PLAN = 'rafa-24-know-which-skills-earn';

/** Another plan, whose rows are never searched for `PLAN`'s tasks. */
const OTHER_PLAN = 'rafa-25-other-plan';

/** A failure string most cases search for. */
const TS_ERROR = 'TS2769';

/** A finding with every field NULL but those given. */
function finding(fields: Partial<SkillFactFinding>): SkillFactFinding {
  return {
    kind: 'gotcha',
    trigger: null,
    what: null,
    cause: null,
    resolution: null,
    artifact: null,
    signal: 'loud',
    ...fields,
  };
}

/** A blocker or out-of-scope bug. */
function entry(what: string, artifact: string | null = null): SkillFactEntry {
  return { what, artifact };
}

/** A fact row for `sessionId` holding what is given, under `PLAN` unless named. */
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

/** One CI reading of `planStub`. */
function reading(planStub: string, failing: readonly string[], readAt = '2026-09-27T10:00:00.000Z'): PlanCiRow {
  return {
    planStub,
    pr: 7,
    headSha: 'abc123',
    verdict: failing.length > 0
      ? 'red'
      : 'green',
    failing,
    readAt,
  };
}

describe('findRecurrences over one task', () => {
  it('finds a string in each searched field of a finding', () => {
    const task = fact('s1', {
      findings: [finding({
        trigger: `trigger ${TS_ERROR}`,
        what: `what ${TS_ERROR}`,
        cause: `cause ${TS_ERROR}`,
        artifact: `error ${TS_ERROR}: no overload`,
      })],
    });

    const matches = findRecurrences([TS_ERROR], [task], 0, []);

    expect(matches.map(({ field }) => field)).toEqual(['trigger', 'what', 'cause', 'artifact']);
    expect(matches[3]).toEqual({
      string: TS_ERROR,
      source: 'finding',
      sessionId: 's1',
      taskLine: 'task of s1',
      field: 'artifact',
      text: `error ${TS_ERROR}: no overload`,
    });
  });

  it('never searches a finding\'s resolution or signal', () => {
    const task = fact('s1', { findings: [finding({ resolution: `fix ${TS_ERROR}`, signal: TS_ERROR })] });
    const control = fact('s1', { findings: [finding({ cause: `fix ${TS_ERROR}` })] });

    expect(findRecurrences([TS_ERROR], [task], 0, [])).toEqual([]);
    expect(findRecurrences([TS_ERROR], [control], 0, [])).toHaveLength(1);
  });

  it('reads NULL fields, as on a filed issue\'s row, as matching nothing', () => {
    const filed = finding({ kind: null, signal: null, artifact: 'rafa#88' });

    expect(findRecurrences([TS_ERROR], [fact('s1', { findings: [filed] })], 0, [])).toEqual([]);
    expect(findRecurrences(['rafa#88'], [fact('s1', { findings: [filed] })], 0, []))
      .toEqual([expect.objectContaining({ source: 'finding', field: 'artifact', text: 'rafa#88' })]);
  });

  it('finds a string in a blocker and an out-of-scope bug, in `what` and `artifact`', () => {
    const task = fact('s1', {
      blockers: [entry(`blocked on ${TS_ERROR}`, TS_ERROR)],
      outOfScopeBugs: [entry('unrelated', `bug ${TS_ERROR}`)],
    });

    const matches = findRecurrences([TS_ERROR], [task], 0, []);

    expect(matches.map(({ source, field, text }) => [source, field, text])).toEqual([
      ['blocker', 'what', `blocked on ${TS_ERROR}`],
      ['blocker', 'artifact', TS_ERROR],
      ['out-of-scope-bug', 'artifact', `bug ${TS_ERROR}`],
    ]);
  });

  it('matches case-sensitively, refusing a string that differs only in case', () => {
    const lower = 'no changes added to commit';
    const task = fact('s1', { blockers: [entry('No Changes Added To Commit (use "git add")')] });
    const control = fact('s1', { blockers: [entry(`${lower} (use "git add")`)] });

    expect(findRecurrences([lower], [task], 0, [])).toEqual([]);
    expect(findRecurrences([lower], [control], 0, [])).toHaveLength(1);
  });

  it('matches a literal, never a pattern', () => {
    const task = fact('s1', { blockers: [entry('TS2769 and TS2345')] });

    expect(findRecurrences(['TS27.9', 'TS\\d+'], [task], 0, [])).toEqual([]);
    expect(findRecurrences(['TS2769 and'], [task], 0, [])).toHaveLength(1);
  });

  it('searches an empty string nowhere and a repeated string once', () => {
    const task = fact('s1', { blockers: [entry(TS_ERROR)] });

    expect(findRecurrences([''], [task], 0, [])).toEqual([]);
    expect(findRecurrences([TS_ERROR, '', TS_ERROR], [task], 0, [])).toHaveLength(1);
  });

  it('answers every string a text holds, in the order the strings were given', () => {
    const task = fact('s1', { blockers: [entry(`${TS_ERROR} then TS2345`)] });

    const matches = findRecurrences(['TS2345', TS_ERROR, 'TS9999'], [task], 0, []);

    expect(matches.map(({ string }) => string)).toEqual(['TS2345', TS_ERROR]);
  });
});

describe('findRecurrences across the tasks of a plan', () => {
  it('finds a string in a later task and never in an earlier one', () => {
    const facts = [
      fact('s1', { blockers: [entry(`earlier ${TS_ERROR}`)] }),
      fact('s2'),
      fact('s3', { outOfScopeBugs: [entry(`later ${TS_ERROR}`)] }),
    ];

    const matches = findRecurrences([TS_ERROR], facts, 1, []);

    expect(matches.map(({ sessionId, text }) => [sessionId, text])).toEqual([['s3', `later ${TS_ERROR}`]]);
    expect(findRecurrences([TS_ERROR], facts, 0, []).map(({ sessionId }) => sessionId)).toEqual(['s1', 's3']);
  });

  it('answers the tasks in the order of the rows, each in findings, blockers, bugs order', () => {
    const facts = [
      fact('s1', {
        outOfScopeBugs: [entry(`bug ${TS_ERROR}`)],
        blockers: [entry(`blocker ${TS_ERROR}`)],
        findings: [finding({ what: `finding ${TS_ERROR}` })],
      }),
      fact('s2', { findings: [finding({ what: `second ${TS_ERROR}` })] }),
    ];

    const matches = findRecurrences([TS_ERROR], facts, 0, []);

    expect(matches.map(({ sessionId, source }) => [sessionId, source])).toEqual([
      ['s1', 'finding'],
      ['s1', 'blocker'],
      ['s1', 'out-of-scope-bug'],
      ['s2', 'finding'],
    ]);
  });

  it('skips a later row of another plan', () => {
    const facts = [
      fact('s1'),
      fact('o1', { planStub: OTHER_PLAN, blockers: [entry(TS_ERROR)] }),
      fact('s2', { blockers: [entry(TS_ERROR)] }),
    ];

    expect(findRecurrences([TS_ERROR], facts, 0, []).map(({ sessionId }) => sessionId)).toEqual(['s2']);
  });

  it('searches only its own rows for a task under no plan', () => {
    const facts = [
      fact('n1', { planStub: null, blockers: [entry(`own ${TS_ERROR}`)] }),
      fact('n2', { planStub: null, blockers: [entry(`next ${TS_ERROR}`)] }),
    ];

    expect(findRecurrences([TS_ERROR], facts, 0, []).map(({ sessionId }) => sessionId)).toEqual(['n1']);
  });

  it('refuses an index that is not a row', () => {
    const facts = [fact('s1')];

    for (const index of [-1, 1, 0.5, Number.NaN]) {
      expect(() => findRecurrences([TS_ERROR], facts, index, [])).toThrow(RangeError);
    }
    expect(() => findRecurrences([TS_ERROR], [], 0, [])).toThrow('fromIndex 0 is not a row of 0 fact rows');
  });
});

describe('findRecurrences over plan CI', () => {
  it('finds a string in a failing check name, with no task named', () => {
    const planCi = [reading(PLAN, ['lint', `check-types ${TS_ERROR}`])];

    expect(findRecurrences([TS_ERROR], [fact('s1')], 0, planCi)).toEqual([{
      string: TS_ERROR,
      source: 'plan-ci',
      sessionId: null,
      taskLine: null,
      field: 'failing',
      text: `check-types ${TS_ERROR}`,
    }]);
  });

  it('reads the union of every reading\'s failing names, each name once, after the tasks', () => {
    const planCi = [
      reading(PLAN, ['unit tests'], '2026-09-27T10:00:00.000Z'),
      reading(PLAN, [], '2026-09-27T11:00:00.000Z'),
      reading(PLAN, ['unit tests', 'e2e tests'], '2026-09-27T12:00:00.000Z'),
    ];
    const facts = [fact('s1', { blockers: [entry('unit tests fail')] })];

    const matches = findRecurrences(['tests'], facts, 0, planCi);

    expect(matches.map(({ source, text }) => [source, text])).toEqual([
      ['blocker', 'unit tests fail'],
      ['plan-ci', 'unit tests'],
      ['plan-ci', 'e2e tests'],
    ]);
  });

  it('skips another plan\'s readings and reads none for a task under no plan', () => {
    const planCi = [reading(OTHER_PLAN, [TS_ERROR])];

    expect(findRecurrences([TS_ERROR], [fact('s1')], 0, planCi)).toEqual([]);
    expect(findRecurrences([TS_ERROR], [fact('o1', { planStub: OTHER_PLAN })], 0, planCi)).toHaveLength(1);
    expect(findRecurrences([TS_ERROR], [fact('n1', { planStub: null })], 0, planCi)).toEqual([]);
  });

  it('matches a check name case-sensitively', () => {
    const planCi = [reading(PLAN, ['Check-Types'])];

    expect(findRecurrences(['check-types'], [fact('s1')], 0, planCi)).toEqual([]);
    expect(findRecurrences(['Check-Types'], [fact('s1')], 0, planCi)).toHaveLength(1);
  });
});
