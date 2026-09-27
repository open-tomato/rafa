/**
 * Tests for `readSkillFacts`, the one reader of disk behind `rafa effort
 * report --skills`.
 *
 * Every store sits under a fresh temporary repo root and is filled
 * through the store's own writers, so each table holds what the loop and
 * `effort collect` would write. The one row no writer can hold, a list
 * column carrying something other than names, is planted through
 * `bun:sqlite` directly. No case reads or writes the project's own
 * `.rafa/effort/`.
 */
import type { SkillResolverName } from '../config-sections.js';
import type { FindingsDispatch } from './store/findings.js';
import type { PlanCiRow } from './store/plan-ci.js';
import type { ReportBlocker, ReportBug, ReportFinding } from '../report/parse.js';

import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Database } from 'bun:sqlite';
import { afterAll, describe, expect, it } from 'bun:test';

import { readSkillFacts } from './skill-facts.js';
import { writeDispatch } from './store/dispatches.js';
import { writeFindings } from './store/findings.js';
import { writePlanCi } from './store/plan-ci.js';
import { writeTaskReport } from './store/reports.js';
import { UNKNOWN_SKILL_COUNT, writeSkillInvocations } from './store/skill-invocations.js';
import { sqliteStorePath } from './store/sqlite.js';
import { writeTrackerRef } from './store/tracker-refs.js';
import { writeTriage } from './store/triage.js';

/** The plan most cases dispatch under. */
const PLAN = 'rafa-24-know-which-skills-earn';

/** A second plan, for the cases that read two. */
const OTHER_PLAN = 'rafa-25-other-plan';

/** Every temporary root made here, removed once the file has run. */
const roots: string[] = [];

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

/** A fresh repo root holding no store. */
function freshRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'rafa-skill-facts-'));
  roots.push(root);
  return root;
}

/** One session's dispatch. */
function dispatchOf(sessionId: string, planStub: string | null = PLAN): FindingsDispatch {
  return { sessionId, planStub, taskLine: `task of ${sessionId}` };
}

/** Stores a report for `sessionId`, with the skills it says it used. */
function report(
  root: string,
  sessionId: string,
  options: { planStub?: string | null; skillsUsed?: readonly string[] | null; outcome?: 'done' | 'blocked' } = {},
): void {
  writeTaskReport(root, {
    dispatch: dispatchOf(sessionId, options.planStub),
    outcome: options.outcome ?? 'done',
    report: {
      status: options.outcome ?? 'done',
      skillsUsed: options.skillsUsed === undefined
        ? []
        : options.skillsUsed,
    },
  });
}

/** Stores the dispatch of `sessionId`, with what its prompt offered. */
function dispatch(
  root: string,
  sessionId: string,
  offer: { resolver: SkillResolverName | null; skills: readonly string[]; lessons: readonly string[] },
): void {
  writeDispatch(root, {
    ...dispatchOf(sessionId),
    declaration: null,
    flags: [],
    resolver: offer.resolver,
    skillsOffered: offer.skills,
    lessonsOffered: offer.lessons,
  });
}

/** A finding as `parseReport` answers one. */
function finding(overrides: Partial<ReportFinding> = {}): ReportFinding {
  return {
    trigger: 'when running the suite',
    kind: 'gotcha',
    what: 'a test leaks state',
    cause: 'a shared temp dir',
    resolution: 'one root per case',
    artifact: 'ENOENT: no such file',
    signal: 'loud',
    domain: null,
    extras: [],
    ...overrides,
  };
}

/** A blocker as `parseReport` answers one. */
function blocker(what: string, artifact: string | null): ReportBlocker {
  return { what, artifact, extras: [] };
}

/** An out-of-scope bug as `parseReport` answers one. */
function bug(what: string, artifact: string | null): ReportBug {
  return { what, artifact, security: false, extras: [] };
}

/** A CI reading of `planStub`. */
function ci(planStub: string, readAt: string, failing: readonly string[]): PlanCiRow {
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

/** The session ids the facts read, in order. */
function sessionsOf(root: string, plans?: readonly string[]): string[] {
  return readSkillFacts(root, plans).map(({ sessionId }) => sessionId);
}

describe('readSkillFacts on a store that is not there', () => {
  it('answers none and creates no file', () => {
    const root = freshRoot();

    expect(readSkillFacts(root)).toEqual([]);
    expect(readSkillFacts(root, [PLAN])).toEqual([]);
    expect(existsSync(sqliteStorePath(root))).toBe(false);
  });

  it('answers none for a store holding no report, though it holds a dispatch', () => {
    const root = freshRoot();
    dispatch(root, 's1', { resolver: 'planner', skills: ['tdd'], lessons: [] });

    expect(readSkillFacts(root)).toEqual([]);
  });
});

describe('readSkillFacts joining one session', () => {
  it('reads every table the session is in onto one row', () => {
    const root = freshRoot();
    dispatch(root, 's1', { resolver: 'planner', skills: ['tdd', 'lint'], lessons: ['L-1'] });
    writeSkillInvocations(root, [{
      sessionId: 's1',
      uses: [
        { name: 'tdd', sidechain: false, count: 2 },
        { name: 'review', sidechain: true, count: 1 },
        { name: 'tdd', sidechain: true, count: 3 },
      ],
    }]);
    writeFindings(root, { dispatch: dispatchOf('s1'), outcome: 'blocked', findings: [finding()] });
    writeTriage(root, {
      dispatch: dispatchOf('s1'),
      outcome: 'blocked',
      blockers: [blocker('the hook refused', 'hook exited 1')],
      outOfScopeBugs: [bug('doctor misreads HOME', null)],
    });
    report(root, 's1', { skillsUsed: ['tdd'], outcome: 'blocked' });
    writePlanCi(root, ci(PLAN, '2026-09-27T10:00:00.000Z', ['lint']));

    expect(readSkillFacts(root)).toEqual([{
      sessionId: 's1',
      planStub: PLAN,
      taskLine: 'task of s1',
      outcome: 'blocked',
      skillsUsed: ['tdd'],
      resolver: 'planner',
      skillsOffered: ['tdd', 'lint'],
      lessonsOffered: ['L-1'],
      invoked: [{ name: 'tdd', count: 5 }, { name: 'review', count: 1 }],
      findings: [{
        kind: 'gotcha',
        trigger: 'when running the suite',
        what: 'a test leaks state',
        cause: 'a shared temp dir',
        resolution: 'one root per case',
        artifact: 'ENOENT: no such file',
        signal: 'loud',
      }],
      blockers: [{ what: 'the hook refused', artifact: 'hook exited 1' }],
      outOfScopeBugs: [{ what: 'doctor misreads HOME', artifact: null }],
      planCi: [ci(PLAN, '2026-09-27T10:00:00.000Z', ['lint'])],
    }]);
  });

  it('gives each session only its own rows', () => {
    const root = freshRoot();
    writeSkillInvocations(root, [
      { sessionId: 's1', uses: [{ name: 'tdd', sidechain: false, count: 1 }] },
      { sessionId: 's2', uses: [{ name: 'lint', sidechain: false, count: 4 }] },
    ]);
    writeFindings(root, { dispatch: dispatchOf('s2'), outcome: 'done', findings: [finding()] });
    writeTriage(root, {
      dispatch: dispatchOf('s2'),
      outcome: 'done',
      blockers: [blocker('only s2', null)],
      outOfScopeBugs: [bug('only s2 too', null)],
    });
    report(root, 's1');
    report(root, 's2');

    const [first, second] = readSkillFacts(root);
    expect(first?.invoked).toEqual([{ name: 'tdd', count: 1 }]);
    expect(first?.findings).toEqual([]);
    expect(first?.blockers).toEqual([]);
    expect(first?.outOfScopeBugs).toEqual([]);
    expect(second?.invoked).toEqual([{ name: 'lint', count: 4 }]);
    expect(second?.findings).toHaveLength(1);
    expect(second?.blockers).toEqual([{ what: 'only s2', artifact: null }]);
    expect(second?.outOfScopeBugs).toEqual([{ what: 'only s2 too', artifact: null }]);
  });

  it('keeps a finding a filed issue inserted, its kind and what NULL', () => {
    const root = freshRoot();
    writeFindings(root, { dispatch: dispatchOf('s1'), outcome: 'done', findings: [finding()] });
    writeTrackerRef(root, {
      dispatch: dispatchOf('s1'),
      outcome: 'done',
      artifact: 'filed key',
      ref: { opt: 0, kind: 'local', externalId: '1', url: null },
    });
    report(root, 's1');

    const [fact] = readSkillFacts(root);
    expect(fact?.findings.map(({ artifact }) => artifact)).toEqual(['ENOENT: no such file', 'filed key']);
    expect(fact?.findings[1]).toEqual({
      kind: null,
      trigger: null,
      what: null,
      cause: null,
      resolution: null,
      artifact: 'filed key',
      signal: null,
    });
  });
});

describe('readSkillFacts keeping unknown, not recorded and none apart', () => {
  it('reads an unknown invocation row as unknown, never as none', () => {
    const root = freshRoot();
    writeSkillInvocations(root, [{ sessionId: 's1', uses: UNKNOWN_SKILL_COUNT }]);
    report(root, 's1');

    expect(readSkillFacts(root)[0]?.invoked).toBe(UNKNOWN_SKILL_COUNT);
  });

  it('reads a session holding no invocation row as having invoked none', () => {
    const root = freshRoot();
    report(root, 's1');

    expect(readSkillFacts(root)[0]?.invoked).toEqual([]);
  });

  it('reads the offers as not recorded for a session with no dispatch', () => {
    const root = freshRoot();
    report(root, 's1');

    const [fact] = readSkillFacts(root);
    expect(fact?.resolver).toBeNull();
    expect(fact?.skillsOffered).toBeNull();
    expect(fact?.lessonsOffered).toBeNull();
  });

  it('reads a dispatch handed no handout as a null resolver beside two empty offers', () => {
    const root = freshRoot();
    dispatch(root, 's1', { resolver: null, skills: [], lessons: [] });
    report(root, 's1');

    const [fact] = readSkillFacts(root);
    expect(fact?.resolver).toBeNull();
    expect(fact?.skillsOffered).toEqual([]);
    expect(fact?.lessonsOffered).toEqual([]);
  });

  it('reads a resolver of none as none', () => {
    const root = freshRoot();
    dispatch(root, 's1', { resolver: 'none', skills: [], lessons: [] });
    report(root, 's1');

    expect(readSkillFacts(root)[0]?.resolver).toBe('none');
  });

  it('reads skills used as null when not recorded and as empty when listed empty', () => {
    const root = freshRoot();
    report(root, 's1', { skillsUsed: null });
    report(root, 's2', { skillsUsed: [] });

    expect(readSkillFacts(root).map(({ skillsUsed }) => skillsUsed)).toEqual([null, []]);
  });

  it('keeps each skill used once, in the order first written, and another plugin\'s prefix', () => {
    const root = freshRoot();
    report(root, 's1', { skillsUsed: ['tdd', 'ecc:review', 'tdd', 'lint', 'ecc:review'] });

    expect(readSkillFacts(root)[0]?.skillsUsed).toEqual(['tdd', 'ecc:review', 'lint']);
  });
});

describe('readSkillFacts ordering and plans', () => {
  /** Reports interleaved across two plans and none, in this append order. */
  function interleaved(): string {
    const root = freshRoot();
    report(root, 'b1', { planStub: OTHER_PLAN });
    report(root, 'a1');
    report(root, 'n1', { planStub: null });
    report(root, 'b2', { planStub: OTHER_PLAN });
    report(root, 'a2');
    return root;
  }

  it('groups by plan in the order of first report, append order within one', () => {
    expect(sessionsOf(interleaved())).toEqual(['b1', 'b2', 'a1', 'a2', 'n1']);
  });

  it('reads only the plans named, in the order named, a stub named twice once', () => {
    const root = interleaved();

    expect(sessionsOf(root, [PLAN, OTHER_PLAN, PLAN])).toEqual(['a1', 'a2', 'b1', 'b2']);
    expect(sessionsOf(root, [OTHER_PLAN])).toEqual(['b1', 'b2']);
  });

  it('reads nothing for a plan it does not hold, or for no plan named', () => {
    const root = interleaved();

    expect(sessionsOf(root, ['rafa-99-absent'])).toEqual([]);
    expect(sessionsOf(root, [])).toEqual([]);
  });

  it('gives each row its own plan\'s CI readings only, and none to no plan', () => {
    const root = interleaved();
    writePlanCi(root, ci(PLAN, '2026-09-27T10:00:00.000Z', ['lint']));
    writePlanCi(root, ci(OTHER_PLAN, '2026-09-27T10:30:00.000Z', []));
    writePlanCi(root, ci(PLAN, '2026-09-27T11:00:00.000Z', []));

    const byPlan = new Map(readSkillFacts(root).map((fact) => [fact.sessionId, fact.planCi]));
    const ours = [ci(PLAN, '2026-09-27T10:00:00.000Z', ['lint']), ci(PLAN, '2026-09-27T11:00:00.000Z', [])];
    expect(byPlan.get('a1')).toEqual(ours);
    expect(byPlan.get('a2')).toEqual(ours);
    expect(byPlan.get('b1')).toEqual([ci(OTHER_PLAN, '2026-09-27T10:30:00.000Z', [])]);
    expect(byPlan.get('n1')).toEqual([]);
  });

  it('gives a plan with no CI reading an empty list', () => {
    const root = freshRoot();
    report(root, 's1');

    expect(readSkillFacts(root)[0]?.planCi).toEqual([]);
  });
});

describe('readSkillFacts refusing a list column no writer stores', () => {
  it('throws for offered skills that are not a list of names', () => {
    const root = freshRoot();
    dispatch(root, 's1', { resolver: 'tag', skills: ['tdd'], lessons: [] });
    report(root, 's1');
    const db = new Database(sqliteStorePath(root));
    db.run('UPDATE dispatches SET skills_offered = \'[1]\' WHERE session_id = \'s1\'');
    db.close();

    expect(() => readSkillFacts(root)).toThrow('effort store: skills_offered of session s1 holds [1], not a list of names');
  });
});
