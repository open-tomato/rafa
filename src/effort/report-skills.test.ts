/**
 * Tests for `buildSkillsReport` and the pure `skillsReportOf` behind
 * `rafa effort report --skills`.
 *
 * The pure cases build fact rows here and run them through the real
 * `findRecurrences` and signals, so a grouping that dropped a row or
 * searched the wrong rows changes a signal. The reading cases plant skill
 * files, instinct records and a store under fresh temporary roots,
 * filled through the store's own writers; no case reads or writes the
 * project's own `.rafa/effort/` or `.rafa/instincts/`. Where a reading
 * could hold only because nothing was found, a control beside it turns
 * once the difference is put in.
 */
import type { SkillFact, SkillFactEntry } from './skill-facts.js';
import type { TierPin } from '../config-sections.js';
import type { PlanCiRow } from './store/plan-ci.js';
import type { InventoryKind, InventorySource } from '../inventory/record.js';
import type { Resolution, TierRow, TierSettings } from '../tiers/resolve.js';

import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { ACTION_HEADING, CAUSE_HEADING } from '../schema/instinct.js';
import { resolveTiers } from '../tiers/resolve.js';

import { findRecurrences } from './recurrence.js';
import {
  buildSkillsReport,
  failureStringsOf,
  lessonArtifactsOf,
  readHeldLessons,
  skillsReportOf,
} from './report-skills.js';
import { skillSignals } from './skill-signals.js';
import { writeDispatch } from './store/dispatches.js';
import { writePlanCi } from './store/plan-ci.js';
import { writeTaskReport } from './store/reports.js';
import { UNKNOWN_SKILL_COUNT, writeSkillInvocations } from './store/skill-invocations.js';
import { sqliteStorePath } from './store/sqlite.js';
import { writeTriage } from './store/triage.js';

/** The plan most cases run under. */
const PLAN = 'rafa-24-know-which-skills-earn';

/** A second plan, for the cases that read two. */
const OTHER_PLAN = 'rafa-25-other-plan';

/** A failure string the fixtures' `typescript-patterns` declares. */
const TS_ERROR = 'TS2769';

/** A lesson's artifact, found as a failing check name. */
const CHECK_NAME = 'lint / eslint';

/** Every temporary directory made here, removed once the file has run. */
const roots: string[] = [];

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

/** A fresh directory of this file's own, its path resolved through every link. */
function freshRoot(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-report-skills-')));
  roots.push(root);
  return root;
}

/** Writes `text` at `path`, making its directory. */
function plantFile(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text, 'utf8');
}

/** A fact row for `sessionId` holding what is given, under `PLAN` and `planner`. */
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

/** A blocker naming `what`. */
function blocker(what: string): SkillFactEntry {
  return { what, artifact: null };
}

/** A row's invocations: each name invoked once. */
function invoking(...names: string[]): SkillFact['invoked'] {
  return names.map((name) => ({ name, count: 1 }));
}

/** A CI reading of `planStub` at `readAt`, failing `names`. */
function ci(readAt: string, failing: readonly string[], planStub = PLAN): PlanCiRow {
  return {
    planStub,
    pr: 7,
    headSha: `sha-${readAt}`,
    verdict: failing.length > 0
      ? 'red'
      : 'green',
    failing,
    readAt,
  };
}

/** `typescript-patterns` declares `TS_ERROR`; nothing else declares a string. */
const STRINGS: ReadonlyMap<string, readonly string[]> = new Map([['typescript-patterns', [TS_ERROR]]]);

/** No lesson artifact. */
const NO_ARTIFACTS: ReadonlyMap<string, string> = new Map();

/** The one plan of a report over `facts`. */
function onlyPlan(facts: readonly SkillFact[], artifacts = NO_ARTIFACTS) {
  const { plans } = skillsReportOf(facts, STRINGS, artifacts);
  expect(plans).toHaveLength(1);
  const [plan] = plans;
  if (plan === undefined) throw new Error('no plan');
  return plan;
}

/** Each offered skill's signal in `arm`, by name. */
function signalsOf(arm: { readonly skills: readonly { name: string; signal: string | null }[] }): Record<string, string | null> {
  return Object.fromEntries(arm.skills.map(({ name, signal }) => [name, signal]));
}

describe('skillsReportOf over one plan run under one resolver', () => {
  const facts = [
    fact('s1', {
      skillsOffered: ['tdd', 'review', 'typescript-patterns'],
      invoked: invoking('tdd', 'typescript-patterns', 'git-workflow'),
    }),
    fact('s2', { skillsOffered: ['review'], blockers: [blocker(`tsc refused it: ${TS_ERROR}`)] }),
  ];

  it('answers one arm holding the whole plan', () => {
    const plan = onlyPlan(facts);

    expect(plan.planStub).toBe(PLAN);
    expect(plan.sessions).toBe(2);
    expect(plan.resolvers.map(({ resolver, sessions }) => [resolver, sessions])).toEqual([['planner', 2]]);
  });

  it('carries the signals the signal module answers for the plan\'s rows', () => {
    const [arm] = onlyPlan(facts).resolvers;

    expect(signalsOf(arm ?? { skills: [] })).toEqual({
      'tdd': 'unmeasured',
      'review': 'ignored',
      'typescript-patterns': 'recurring',
    });
    expect(arm).toMatchObject(skillSignals(facts, findRecurrences, STRINGS));
  });

  it('lists a skill invoked and never offered with no signal', () => {
    const [arm] = onlyPlan(facts).resolvers;

    expect(arm?.neverOffered.map(({ name, invoked }) => [name, invoked])).toEqual([['git-workflow', 1]]);
  });

  it('answers no plan for no rows', () => {
    expect(skillsReportOf([], STRINGS, NO_ARTIFACTS)).toEqual({ plans: [] });
  });
});

describe('skillsReportOf over a plan run under two resolvers', () => {
  const facts = [
    fact('p1', { resolver: 'planner', skillsOffered: ['tdd'], invoked: invoking('tdd') }),
    fact('t1', { resolver: 'tag', skillsOffered: ['review'] }),
    fact('p2', { resolver: 'planner', skillsOffered: ['tdd'] }),
    fact('t2', { resolver: 'tag', skillsOffered: ['review', 'tdd'], invoked: invoking('review') }),
  ];

  it('splits the rows into one arm per resolver, in the order first seen', () => {
    const plan = onlyPlan(facts);

    expect(plan.sessions).toBe(4);
    expect(plan.resolvers.map(({ resolver, sessions }) => [resolver, sessions])).toEqual([
      ['planner', 2],
      ['tag', 2],
    ]);
  });

  it('tallies each skill over its own arm\'s rows only', () => {
    const [planner, tag] = onlyPlan(facts).resolvers;

    expect(planner?.skills.map(({ name, offered, invoked }) => [name, offered, invoked])).toEqual([['tdd', 2, 1]]);
    expect(tag?.skills.map(({ name, offered, invoked }) => [name, offered, invoked])).toEqual([
      ['review', 2, 1],
      ['tdd', 1, 0],
    ]);
    expect(signalsOf(tag ?? { skills: [] })).toEqual({ review: 'unmeasured', tdd: 'ignored' });
  });

  it('keeps a null resolver apart from a named one', () => {
    const mixed = [fact('n1', { resolver: null }), fact('t1', { resolver: 'tag' })];

    expect(onlyPlan(mixed).resolvers.map(({ resolver }) => resolver)).toEqual([null, 'tag']);
  });
});

describe('the recurrence search of a split plan', () => {
  const facts = [
    fact('p1', { resolver: 'planner', skillsOffered: ['typescript-patterns'], invoked: invoking('typescript-patterns') }),
    fact('t1', { resolver: 'tag', blockers: [blocker(`tsc refused it: ${TS_ERROR}`)] }),
  ];

  it('finds a recurrence in a later task run under the other resolver', () => {
    const [planner] = onlyPlan(facts).resolvers;
    const skill = planner?.skills.find(({ name }) => name === 'typescript-patterns');

    expect(skill?.signal).toBe('recurring');
    expect(skill?.matches.map(({ sessionId, source }) => [sessionId, source])).toEqual([['t1', 'blocker']]);
  });

  it('would miss it were the arm searched alone, which is what the plan-wide search is for', () => {
    const armOnly = facts.filter(({ resolver }) => resolver === 'planner');
    const alone = skillSignals(armOnly, findRecurrences, STRINGS).skills[0];

    expect(alone?.signal).toBe('earning');
  });

  it('never searches an earlier task under the other resolver', () => {
    const earlier = [...facts].reverse();
    const [, planner] = onlyPlan(earlier).resolvers;

    expect(planner?.resolver).toBe('planner');
    expect(planner?.skills[0]?.signal).toBe('earning');
  });
});

describe('M1 and M2', () => {
  it('counts distinct task-skill pairs over task lines, and offered pairs taken over offered pairs', () => {
    const facts = [
      fact('s1', { skillsOffered: ['a', 'b'], invoked: invoking('a', 'x') }),
      fact('s2', { skillsOffered: ['a'] }),
      fact('s3', { skillsOffered: ['b'], invoked: invoking('b') }),
    ];
    const [arm] = onlyPlan(facts).resolvers;

    expect(arm?.m1).toEqual({ numerator: 3, denominator: 3, percent: 100 });
    expect(arm?.m2).toEqual({ numerator: 2, denominator: 4, percent: 50 });
  });

  it('counts a task line retried in two sessions once for M1, and each session\'s offer for M2', () => {
    const facts = [
      fact('s1', { taskLine: 'the task', skillsOffered: ['a'], invoked: invoking('a') }),
      fact('s2', { taskLine: 'the task', skillsOffered: ['a'], invoked: invoking('a') }),
      fact('s3', { taskLine: 'another task' }),
    ];
    const [arm] = onlyPlan(facts).resolvers;

    expect(arm?.m1).toEqual({ numerator: 1, denominator: 2, percent: 50 });
    expect(arm?.m2).toEqual({ numerator: 2, denominator: 2, percent: 100 });
  });

  it('leaves a session whose invocations are unknown out of both sides of both, and counts it', () => {
    const known = [fact('s1', { skillsOffered: ['a'], invoked: invoking('a') })];
    const unknown = fact('s2', { skillsOffered: ['a', 'b'], invoked: UNKNOWN_SKILL_COUNT });
    const [withUnknown] = onlyPlan([...known, unknown]).resolvers;
    const [control] = onlyPlan(known).resolvers;

    expect(withUnknown?.unknownSessions).toBe(1);
    expect(withUnknown?.m1).toEqual(control?.m1);
    expect(withUnknown?.m2).toEqual(control?.m2);
    expect(control?.unknownSessions).toBe(0);
  });

  it('counts a session recorded as invoking nothing in the denominators', () => {
    const [arm] = onlyPlan([
      fact('s1', { skillsOffered: ['a'], invoked: invoking('a') }),
      fact('s2', { skillsOffered: ['a'], invoked: [] }),
    ]).resolvers;

    expect(arm?.m1).toEqual({ numerator: 1, denominator: 2, percent: 50 });
    expect(arm?.m2).toEqual({ numerator: 1, denominator: 2, percent: 50 });
  });

  it('answers a null percent over a zero denominator', () => {
    const [arm] = onlyPlan([fact('s1', { skillsOffered: null, invoked: UNKNOWN_SKILL_COUNT })]).resolvers;

    expect(arm?.m1).toEqual({ numerator: 0, denominator: 0, percent: null });
    expect(arm?.m2).toEqual({ numerator: 0, denominator: 0, percent: null });
  });

  it('answers each arm its own M1 and M2', () => {
    const plan = onlyPlan([
      fact('p1', { resolver: 'planner', skillsOffered: ['a', 'b'], invoked: invoking('a') }),
      fact('t1', { resolver: 'tag', skillsOffered: ['a'], invoked: invoking('a') }),
      fact('t2', { resolver: 'tag', skillsOffered: ['a'] }),
    ]);

    expect(plan.resolvers.map(({ resolver, m1, m2 }) => [resolver, m1.percent, m2.percent])).toEqual([
      ['planner', 100, 50],
      ['tag', 50, 50],
    ]);
  });
});

describe('plans and plan CI', () => {
  it('answers one entry per plan in the order the rows hold them, a report under no plan its own', () => {
    const facts = [
      fact('s1', { planStub: OTHER_PLAN }),
      fact('s2'),
      fact('s3', { planStub: null }),
    ];
    const { plans } = skillsReportOf(facts, STRINGS, NO_ARTIFACTS);

    expect(plans.map(({ planStub, sessions }) => [planStub, sessions])).toEqual([
      [OTHER_PLAN, 1],
      [PLAN, 1],
      [null, 1],
    ]);
  });

  it('takes the latest reading by readAt as the plan CI, the last written winning a tie', () => {
    const readings = [ci('2026-09-27T12:00:00.000Z', ['lint']), ci('2026-09-27T09:00:00.000Z', [])];
    const tie = [ci('2026-09-27T12:00:00.000Z', ['lint']), { ...ci('2026-09-27T12:00:00.000Z', []), pr: 8 }];

    expect(onlyPlan([fact('s1', { planCi: readings })]).planCi).toEqual(readings[0] ?? null);
    expect(onlyPlan([fact('s1', { planCi: tie })]).planCi?.pr).toBe(8);
    expect(onlyPlan([fact('s1')]).planCi).toBeNull();
  });

  it('holds a lesson whose artifact is a failing check name to injected-recurring, and one not failing to injected', () => {
    const artifacts = new Map([['lesson-lint', CHECK_NAME]]);
    const red = onlyPlan([fact('s1', { lessonsOffered: ['lesson-lint'], planCi: [ci('2026-09-27T12:00:00.000Z', [CHECK_NAME])] })], artifacts);
    const green = onlyPlan([fact('s1', { lessonsOffered: ['lesson-lint'], planCi: [ci('2026-09-27T12:00:00.000Z', ['test'])] })], artifacts);

    expect(red.resolvers[0]?.lessons.map(({ id, signal }) => [id, signal])).toEqual([['lesson-lint', 'injected-recurring']]);
    expect(green.resolvers[0]?.lessons.map(({ id, signal }) => [id, signal])).toEqual([['lesson-lint', 'injected']]);
  });
});

/** Settings that load the project and rafa tiers, pinning nothing. */
const SETTINGS: TierSettings = {
  settingSources: ['project', 'local'],
  tiersRafa: 'on',
  tiersSkills: new Map<string, TierPin>(),
  tiersAgents: new Map<string, TierPin>(),
};

/** A row of `name` in `source`, its file under `/<source>`. */
function row(source: InventorySource, name: string, kind: InventoryKind = 'skill'): TierRow {
  const path = kind === 'skill'
    ? `/${source}/skills/${name}/SKILL.md`
    : `/${source}/agents/${name}.md`;
  return { kind, name, source, path };
}

/** A skill file declaring `strings` under `failure_strings`. */
function skillText(name: string, strings: readonly string[] | null): string {
  const lines = strings === null
    ? []
    : ['failure_strings:', ...strings.map((string) => `  - ${JSON.stringify(string)}`)];
  return ['---', `name: ${name}`, 'description: a probe skill', ...lines, '---', '', 'Body.', ''].join('\n');
}

/** The resolution of `rows` over the files `files` holds. */
function resolutionOver(rows: readonly TierRow[], files: ReadonlyMap<string, string>, settings = SETTINGS): Resolution {
  return resolveTiers(rows, settings, (path) => {
    const text = files.get(path);
    return text === undefined
      ? null
      : new TextEncoder().encode(text);
  });
}

describe('failureStringsOf', () => {
  it('reads each served skill\'s failure strings by its bare name, leaving out one that declares none', () => {
    const files = new Map([
      [row('project', 'typescript-patterns').path, skillText('typescript-patterns', [TS_ERROR, 'no changes added to commit'])],
      [row('rafa', 'tdd').path, skillText('tdd', null)],
    ]);
    const resolution = resolutionOver([row('project', 'typescript-patterns'), row('rafa', 'tdd')], files);

    expect([...failureStringsOf(resolution, (path) => files.get(path) ?? null)]).toEqual([
      ['typescript-patterns', [TS_ERROR, 'no changes added to commit']],
    ]);
  });

  it('keeps only the non-empty strings of the list', () => {
    const text = ['---', 'name: odd', 'failure_strings:', '  - ""', '  - 42', `  - ${TS_ERROR}`, '---', ''].join('\n');
    const resolution = resolutionOver([row('project', 'odd')], new Map());

    expect(failureStringsOf(resolution, () => text).get('odd')).toEqual([TS_ERROR]);
  });

  it('reads nothing for a skill switched off, an agent, or a file that cannot be read', () => {
    const declared = skillText('any', [TS_ERROR]);
    const off = resolutionOver([row('project', 'off-skill')], new Map(), {
      ...SETTINGS,
      tiersSkills: new Map<string, TierPin>([['off-skill', false]]),
    });
    const agent = resolutionOver([row('project', 'an-agent', 'agent')], new Map());
    const unreadable = resolutionOver([row('project', 'gone')], new Map());

    expect(failureStringsOf(off, () => declared).size).toBe(0);
    expect(failureStringsOf(agent, () => declared).size).toBe(0);
    expect(failureStringsOf(unreadable, () => null).size).toBe(0);
    expect(failureStringsOf(unreadable, () => declared).get('gone')).toEqual([TS_ERROR]);
  });

  it('reads nothing for a name two tiers hold differently, which nobody serves', () => {
    const files = new Map([
      [row('project', 'clash').path, skillText('clash', [TS_ERROR])],
      [row('rafa', 'clash').path, skillText('clash', ['something else'])],
    ]);
    const resolution = resolutionOver([row('project', 'clash'), row('rafa', 'clash')], files);

    expect(resolution.items[0]?.state).toBe('collision');
    expect(failureStringsOf(resolution, (path) => files.get(path) ?? null).size).toBe(0);
  });
});

/** An instinct record `id` in `scope`, its artifact `artifact` when given. */
function instinctText(id: string, scope: string, artifact: string | null): string {
  return [
    '---',
    `id: ${id}`,
    'trigger: when running tests in a freshly forked worktree',
    'kind: gotcha',
    'domain: workflow',
    'confidence: 0.6',
    'usage_count: 3',
    ...(artifact === null
      ? []
      : [`artifact: ${artifact}`]),
    'signal: loud',
    `scope: ${scope}`,
    'source: task-report',
    'evidence:',
    '  - plan: my-feature',
    '    outcome: blocked',
    'created_at: 2026-09-11T10:00:00Z',
    'updated_at: 2026-09-11T10:00:00Z',
    '---',
    '',
    ACTION_HEADING,
    'Run `bun install` before the first test.',
    '',
    CAUSE_HEADING,
    'Worktree creation copies the tree and not its packages.',
    '',
  ].join('\n');
}

describe('the held lessons', () => {
  it('reads both scopes, nearest first, skipping a record that does not parse', () => {
    const base = freshRoot();
    const root = join(base, 'project');
    const home = join(base, 'home');
    plantFile(join(root, '.rafa/instincts/shared.md'), instinctText('shared', 'project', 'project artifact'));
    plantFile(join(root, '.rafa/instincts/broken.md'), '---\nid: broken\n---\n');
    plantFile(join(home, '.rafa/instincts/shared.md'), instinctText('shared', 'user', 'user artifact'));
    plantFile(join(home, '.rafa/instincts/user-only.md'), instinctText('user-only', 'user', null));

    const held = readHeldLessons({ home, projectRoot: root });

    expect(held).toEqual([
      { id: 'shared', artifact: 'project artifact' },
      { id: 'shared', artifact: 'user artifact' },
      { id: 'user-only', artifact: null },
    ]);
    expect([...lessonArtifactsOf(held)]).toEqual([['shared', 'project artifact']]);
  });

  it('lets the first holder of an id win even when it holds no artifact', () => {
    const artifacts = lessonArtifactsOf([{ id: 'a', artifact: null }, { id: 'a', artifact: 'later' }]);

    expect(artifacts.has('a')).toBe(false);
    expect(lessonArtifactsOf([{ id: 'a', artifact: 'later' }]).get('a')).toBe('later');
  });
});

/** Stores the dispatch and the report of `sessionId`. */
function storeSession(
  root: string,
  sessionId: string,
  options: {
    planStub?: string;
    resolver?: 'planner' | 'tag';
    skills?: readonly string[];
    lessons?: readonly string[];
    blockers?: readonly string[];
  } = {},
): void {
  const dispatch = { sessionId, planStub: options.planStub ?? PLAN, taskLine: `task of ${sessionId}` };
  writeDispatch(root, {
    ...dispatch,
    declaration: null,
    flags: [],
    resolver: options.resolver ?? 'planner',
    skillsOffered: options.skills ?? [],
    lessonsOffered: options.lessons ?? [],
  });
  if (options.blockers !== undefined) {
    writeTriage(root, {
      dispatch,
      outcome: 'blocked',
      blockers: options.blockers.map((what) => ({ what, artifact: null, extras: [] })),
      outOfScopeBugs: [],
    });
  }
  writeTaskReport(root, { dispatch, outcome: 'done', report: { status: 'done', skillsUsed: [] } });
}

describe('buildSkillsReport over a scratch store', () => {
  /** A root holding a store, a served project skill declaring `TS_ERROR`, and one declaring none. */
  function world(): { root: string; resolution: Resolution } {
    const root = freshRoot();
    const declaring = join(root, '.claude/skills/typescript-patterns/SKILL.md');
    const silent = join(root, '.claude/skills/tdd/SKILL.md');
    plantFile(declaring, skillText('typescript-patterns', [TS_ERROR]));
    plantFile(silent, skillText('tdd', null));
    storeSession(root, 's1', { skills: ['typescript-patterns', 'tdd'], lessons: ['lesson-lint'] });
    storeSession(root, 's2', { resolver: 'tag', blockers: [`tsc refused it: ${TS_ERROR}`] });
    storeSession(root, 'o1', { planStub: OTHER_PLAN, skills: ['tdd'] });
    writeSkillInvocations(root, [{
      sessionId: 's1',
      uses: [
        { name: 'typescript-patterns', sidechain: false, count: 1 },
        { name: 'tdd', sidechain: true, count: 2 },
      ],
    }]);
    writePlanCi(root, ci('2026-09-27T12:00:00.000Z', [CHECK_NAME]));
    const rows: TierRow[] = [
      { kind: 'skill', name: 'typescript-patterns', source: 'project', path: declaring },
      { kind: 'skill', name: 'tdd', source: 'project', path: silent },
    ];
    return { root, resolution: resolveTiers(rows, SETTINGS, () => null) };
  }

  it('reads the facts, the served skills\' strings from disk and the lessons, split by resolver', () => {
    const { root, resolution } = world();

    const report = buildSkillsReport({
      repoRoot: root,
      plans: [PLAN],
      resolution,
      lessons: [{ id: 'lesson-lint', artifact: CHECK_NAME }],
    });

    expect(report.plans).toHaveLength(1);
    const [plan] = report.plans;
    expect(plan?.planCi?.failing).toEqual([CHECK_NAME]);
    expect(plan?.resolvers.map(({ resolver, sessions }) => [resolver, sessions])).toEqual([['planner', 1], ['tag', 1]]);
    const [planner] = plan?.resolvers ?? [];
    expect(signalsOf(planner ?? { skills: [] })).toEqual({ 'typescript-patterns': 'recurring', 'tdd': 'unmeasured' });
    expect(planner?.lessons.map(({ id, signal }) => [id, signal])).toEqual([['lesson-lint', 'injected-recurring']]);
    expect(planner?.m2).toEqual({ numerator: 2, denominator: 2, percent: 100 });
  });

  it('reads the skill as unmeasured when no tier serves it, which is what the tiers\' strings decide', () => {
    const { root } = world();
    const unresolved = resolveTiers([], SETTINGS, () => null);

    const [plan] = buildSkillsReport({ repoRoot: root, plans: [PLAN], resolution: unresolved, lessons: [] }).plans;

    expect(plan?.resolvers[0]?.skills.find(({ name }) => name === 'typescript-patterns')?.signal).toBe('unmeasured');
  });

  it('reads every plan when none is named, and none for a stub the store does not hold', () => {
    const { root, resolution } = world();

    const every = buildSkillsReport({ repoRoot: root, resolution, lessons: [] });
    const unknown = buildSkillsReport({ repoRoot: root, plans: ['no-such-plan'], resolution, lessons: [] });

    expect(every.plans.map(({ planStub }) => planStub)).toEqual([PLAN, OTHER_PLAN]);
    expect(unknown).toEqual({ plans: [] });
  });

  it('answers an empty report and creates no store when there is none', () => {
    const root = freshRoot();

    const report = buildSkillsReport({ repoRoot: root, resolution: resolveTiers([], SETTINGS, () => null), lessons: [] });

    expect(report).toEqual({ plans: [] });
    expect(existsSync(sqliteStorePath(root))).toBe(false);
  });
});
