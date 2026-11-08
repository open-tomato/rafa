/**
 * Tests for joining a filed bug and the loop that fixed it into one
 * lesson.
 *
 * The rows are built inline in the shapes `bug-fix-pairs.ts` declares;
 * no store is opened. The negative cases come first: each is a bug the
 * join must leave unpaired, with the reason it names. One case pushes a
 * pair's lesson through the `local` adapter into a temporary library and
 * reads it back through `parseInstinct`, so the lesson is shown to be one
 * the library holds, not only one whose fields look right.
 */
import type {
  BugFindingRow,
  BugFixRows,
  DoneReportRow,
  OutOfScopeBugRow,
  PlanStageLink,
  ResolvedFindingRow,
} from './bug-fix-pairs.js';

import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { createLocalLearning } from '../adapters/learning/local.js';
import { actionHash } from '../learning/index.js';
import { parseInstinct } from '../schema/instinct.js';

import { pairBugFixes } from './bug-fix-pairs.js';
import { DEFAULT_LESSON_DOMAIN, LESSON_CONFIDENCE, lessonId } from './lessons.js';

const NOW = new Date('2026-11-07T12:00:00.000Z');

const FILED_AT = '2026-11-01T10:00:00.000Z';

const FIXED_AT = '2026-11-03T10:00:00.000Z';

const ARTIFACT = 'expected 3 to be 2';

const KEY = `PLAN_TRACKER-rafa-900-filer.md: ${ARTIFACT}`;

const WORDS = 'the doctor test reads env words from the machine';

const roots: string[] = [];

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

/** A fresh temporary directory, removed after the file. */
function freshDir(): string {
  const root = mkdtempSync(join(tmpdir(), 'rafa-bug-fix-pairs-'));
  roots.push(root);
  return root;
}

/** A bug finding filed by `filer-1` against issue `issue` on GitHub. */
function bug(overrides: Partial<BugFindingRow> = {}, issue = '42'): BugFindingRow {
  return {
    id: 'bug-1',
    sessionId: 'filer-1',
    planStub: 'rafa-900-filer',
    taskLine: 'Add the filer',
    artifact: KEY,
    trackerRef: { kind: 'github', externalId: issue, url: `https://github.com/o/r/issues/${issue}` },
    outcome: 'done',
    collectedAt: FILED_AT,
    ...overrides,
  };
}

/** The out-of-scope bug row of the filing session that holds the bug's words. */
function filedWords(overrides: Partial<OutOfScopeBugRow> = {}): OutOfScopeBugRow {
  return { sessionId: 'filer-1', what: WORDS, artifact: ARTIFACT, ...overrides };
}

/** A `done` report of `taskLine` in plan `planStub`. */
function done(planStub: string, taskLine: string, overrides: Partial<DoneReportRow> = {}): DoneReportRow {
  return { sessionId: 'fixer-1', planStub, taskLine, outcome: 'done', collectedAt: FIXED_AT, ...overrides };
}

/** A resolved finding of `taskLine` in plan `planStub`. */
function resolved(
  planStub: string,
  taskLine: string,
  overrides: Partial<ResolvedFindingRow> = {},
): ResolvedFindingRow {
  return {
    sessionId: 'fixer-1',
    planStub,
    taskLine,
    artifact: ARTIFACT,
    resolution: 'read env through the seam',
    ...overrides,
  };
}

/** One stage of plan `stub`. */
function stage(stub: string, context: string | null, tasks: readonly string[], name = 'Fix'): PlanStageLink {
  return { stub, stage: name, context, tasks };
}

/** The rows of one bug, its words, and the given fixes. */
function rows(overrides: Partial<BugFixRows> = {}): BugFixRows {
  return { bugs: [bug()], outOfScope: [filedWords()], resolved: [], reports: [], ...overrides };
}

describe('pairBugFixes leaves a bug unpaired', () => {
  it('as no-link when a sweep stage names no issue', () => {
    const sweep = stage('rafa-1214-bug-sweep-33', 'Fix the bugs filed this week.', ['Fix the doctor test']);
    const answer = pairBugFixes(
      rows({ reports: [done('rafa-1214-bug-sweep-33', 'Fix the doctor test')] }),
      [sweep],
      NOW,
    );

    expect(answer.pairs).toEqual([]);
    expect(answer.unpaired.map(({ issue, reason }) => ({ issue, reason }))).toEqual([
      { issue: '42', reason: 'no-link' },
    ]);
  });

  it('as no-link when the stage names only a longer issue number or a prefixed one', () => {
    const near = stage('rafa-1300-sweep', 'Fixes #420, o/r#42 and #42a.', ['Fix it']);
    const answer = pairBugFixes(rows({ reports: [done('rafa-1300-sweep', 'Fix it')] }), [near], NOW);

    expect(answer.unpaired.map(({ reason }) => reason)).toEqual(['no-link']);
  });

  it('as ambiguous-stage when a multi-task stage names no task and no task holds the artifact', () => {
    const linked = stage('rafa-1300-sweep', 'This stage fixes #42.', ['Fix the doctor', 'Fix the board']);
    const answer = pairBugFixes(
      rows({
        resolved: [resolved('rafa-1300-sweep', 'Fix the doctor', { artifact: 'another error' })],
        reports: [done('rafa-1300-sweep', 'Fix the doctor'), done('rafa-1300-sweep', 'Fix the board')],
      }),
      [linked],
      NOW,
    );

    expect(answer.pairs).toEqual([]);
    expect(answer.unpaired.map(({ reason }) => reason)).toEqual(['ambiguous-stage']);
  });

  it('as local-ref when its reference is a local one', () => {
    const localBug = bug({ trackerRef: { kind: 'local', externalId: '42', url: null } });
    const linked = stage('rafa-1300-sweep', 'Fixes #42.', ['Fix the doctor']);
    const answer = pairBugFixes(
      rows({ bugs: [localBug], reports: [done('rafa-1300-sweep', 'Fix the doctor')] }),
      [linked],
      NOW,
    );

    expect(answer.pairs).toEqual([]);
    expect(answer.unpaired.map(({ issue, reason }) => ({ issue, reason }))).toEqual([
      { issue: '42', reason: 'local-ref' },
    ]);
  });

  it('as fixed-before-filed when the fixing task\'s only report predates the filing', () => {
    const linked = stage('rafa-1300-sweep', 'Fixes #42.', ['Fix the doctor']);
    const answer = pairBugFixes(
      rows({ reports: [done('rafa-1300-sweep', 'Fix the doctor', { collectedAt: '2026-10-30T10:00:00.000Z' })] }),
      [linked],
      NOW,
    );

    expect(answer.pairs).toEqual([]);
    expect(answer.unpaired.map(({ reason }) => reason)).toEqual(['fixed-before-filed']);
  });

  it('as no-done-report when the fixing task has no done report, the filing session\'s own not counting', () => {
    const linked = stage('rafa-1300-sweep', 'Fixes #42.', ['Fix the doctor']);
    const answer = pairBugFixes(
      rows({ reports: [done('rafa-1300-sweep', 'Fix the doctor', { sessionId: 'filer-1' })] }),
      [linked],
      NOW,
    );

    expect(answer.unpaired.map(({ reason }) => reason)).toEqual(['no-done-report']);
  });

  it('as no-plan-file when the store shows a rafa-<n> plan that has no file here', () => {
    const answer = pairBugFixes(rows({ reports: [done('rafa-42-fix', 'Fix the doctor')] }), [], NOW);

    expect(answer.unpaired.map(({ reason }) => reason)).toEqual(['no-plan-file']);
  });

  it('as no-plan-file when a stored task line names the issue in a plan that has no file here', () => {
    const answer = pairBugFixes(rows({ reports: [done('rafa-1300-sweep', 'Fix #42 in the doctor')] }), [], NOW);

    expect(answer.unpaired.map(({ reason }) => reason)).toEqual(['no-plan-file']);
  });
});

describe('pairBugFixes pairs a bug', () => {
  it('with a rafa-<n> plan for its issue', () => {
    const plan = [stage('rafa-42-doctor-env', null, ['Read env through the seam  {agent=loop-implementer}'])];
    const answer = pairBugFixes(
      rows({ reports: [done('rafa-42-doctor-env', 'Read env through the seam  {agent=loop-implementer}')] }),
      plan,
      NOW,
    );

    expect(answer.unpaired).toEqual([]);
    expect(answer.pairs.map(({ issue, link, plan: stub, fix }) => ({ issue, link, stub, session: fix.sessionId })))
      .toEqual([{ issue: '42', link: 'stub', stub: 'rafa-42-doctor-env', session: 'fixer-1' }]);
  });

  it('with a rafa-<n> plan whose fixing task is the one line of several naming the issue', () => {
    const plan = [
      stage('rafa-42', null, ['Write the spec'], 'Spec'),
      stage('rafa-42', null, ['Fix #42 in the doctor', 'Update the docs'], 'Build'),
    ];
    const answer = pairBugFixes(rows({ reports: [done('rafa-42', 'Fix #42 in the doctor')] }), plan, NOW);

    expect(answer.pairs.map(({ stage: name, fix }) => ({ name, task: fix.taskLine }))).toEqual([
      { name: 'Build', task: 'Fix #42 in the doctor' },
    ]);
  });

  it('through a stage context naming #<n>, by the one task whose line names it', () => {
    const linked = stage('rafa-1300-sweep', 'This stage fixes #42 and #43.', [
      'Fix the board',
      'Fix the doctor test (#42)',
      'Fix the release fold (#43)',
    ]);
    const answer = pairBugFixes(
      rows({
        reports: [
          done('rafa-1300-sweep', 'Fix the board', { sessionId: 'fixer-0' }),
          done('rafa-1300-sweep', 'Fix the doctor test (#42)'),
          done('rafa-1300-sweep', 'Fix the release fold (#43)', { sessionId: 'fixer-2' }),
        ],
      }),
      [linked],
      NOW,
    );

    expect(answer.unpaired).toEqual([]);
    expect(answer.pairs.map(({ link, fix }) => ({ link, task: fix.taskLine, session: fix.sessionId }))).toEqual([
      { link: 'stage-context', task: 'Fix the doctor test (#42)', session: 'fixer-1' },
    ]);
  });

  it('through a one-task stage whose line names no issue', () => {
    const linked = stage('rafa-1300-sweep', 'Fixes #42.', ['Fix the doctor test']);
    const answer = pairBugFixes(rows({ reports: [done('rafa-1300-sweep', 'Fix the doctor test')] }), [linked], NOW);

    expect(answer.pairs.map(({ fix }) => fix.taskLine)).toEqual(['Fix the doctor test']);
  });

  it('through the one task of a multi-task stage holding a resolved finding with the bug\'s artifact', () => {
    const linked = stage('rafa-1300-sweep', 'Fixes #42.', ['Fix the board', 'Fix the doctor']);
    const answer = pairBugFixes(
      rows({
        resolved: [resolved('rafa-1300-sweep', 'Fix the doctor')],
        reports: [done('rafa-1300-sweep', 'Fix the board', { sessionId: 'fixer-0' }), done('rafa-1300-sweep', 'Fix the doctor')],
      }),
      [linked],
      NOW,
    );

    expect(answer.pairs.map(({ fix }) => fix.taskLine)).toEqual(['Fix the doctor']);
  });

  it('with the action of the fixing task\'s resolved finding whose artifact is the bug\'s', () => {
    const linked = stage('rafa-1300-sweep', 'Fixes #42.', ['Fix the doctor  {agent=loop-implementer}']);
    const answer = pairBugFixes(
      rows({
        resolved: [
          resolved('rafa-1300-sweep', 'Fix the doctor  {agent=loop-implementer}', {
            artifact: 'another error',
            resolution: 'not this one',
          }),
          resolved('rafa-1300-sweep', 'Fix the doctor  {agent=loop-implementer}', {
            artifact: 'expected  3\nto be 2',
          }),
        ],
        reports: [done('rafa-1300-sweep', 'Fix the doctor  {agent=loop-implementer}')],
      }),
      [linked],
      NOW,
    );

    expect(answer.pairs.map(({ lesson }) => lesson.action)).toEqual(['read env through the seam']);
  });

  it('with the fixing task\'s line, its declaration stripped, as the action when no finding matches', () => {
    const line = 'Read env through the doctor\'s seam  {agent=loop-implementer effort=high}';
    const linked = stage('rafa-1300-sweep', 'Fixes #42.', [line]);
    const answer = pairBugFixes(
      rows({
        resolved: [resolved('rafa-1300-sweep', line, { artifact: 'another error', resolution: 'not this one' })],
        reports: [done('rafa-1300-sweep', line)],
      }),
      [linked],
      NOW,
    );

    const [pair] = answer.pairs;
    expect(pair?.lesson.action).toBe('Read env through the doctor\'s seam');
    expect(pair?.lesson.action_hash).toBe(actionHash('Read env through the doctor\'s seam'));
  });

  it('with the out-of-scope words as trigger, matched by key suffix after whitespace collapse', () => {
    const linked = stage('rafa-1300-sweep', 'Fixes #42.', ['Fix the doctor']);
    const answer = pairBugFixes(
      rows({
        outOfScope: [
          filedWords({ sessionId: 'other-session', what: 'another session\'s words' }),
          filedWords({ what: 'a bug whose artifact the key does not end with', artifact: 'expected 4' }),
          filedWords({ artifact: 'expected  3\n  to be 2\n' }),
        ],
        reports: [done('rafa-1300-sweep', 'Fix the doctor')],
      }),
      [linked],
      NOW,
    );

    const [pair] = answer.pairs;
    expect(pair?.lesson.trigger).toBe(WORDS);
    expect(pair?.lesson.description?.cause).toBe(WORDS);
    expect(pair?.lesson.artifact).toBe('expected  3\n  to be 2\n');
  });

  it('with the key itself as its words and artifact when no out-of-scope row matches', () => {
    const linked = stage('rafa-1300-sweep', 'Fixes #42.', ['Fix the doctor']);
    const answer = pairBugFixes(
      rows({ outOfScope: [filedWords({ artifact: 'unrelated' })], reports: [done('rafa-1300-sweep', 'Fix the doctor')] }),
      [linked],
      NOW,
    );

    const [pair] = answer.pairs;
    expect(pair?.lesson.trigger).toBe(KEY);
    expect(pair?.lesson.artifact).toBe(KEY);
  });

  it('once per fixing loop when two loops fixed one issue', () => {
    const links = [
      stage('rafa-1300-sweep', 'Fixes #42.', ['Fix the doctor']),
      stage('rafa-1400-sweep', 'Fixes #42 again.', ['Fix the doctor for good']),
    ];
    const answer = pairBugFixes(
      rows({
        reports: [
          done('rafa-1300-sweep', 'Fix the doctor'),
          done('rafa-1400-sweep', 'Fix the doctor for good', { sessionId: 'fixer-2', collectedAt: '2026-11-05T10:00:00.000Z' }),
        ],
      }),
      links,
      NOW,
    );

    expect(answer.unpaired).toEqual([]);
    expect(answer.pairs.map(({ plan, lesson }) => ({ plan, sources: lesson.sources, action: lesson.action }))).toEqual([
      { plan: 'rafa-1300-sweep', sources: ['filer-1', 'fixer-1'], action: 'Fix the doctor' },
      { plan: 'rafa-1400-sweep', sources: ['filer-1', 'fixer-2'], action: 'Fix the doctor for good' },
    ]);
  });

  it('with the earliest done report after the filing when the fixing task ran twice', () => {
    const linked = stage('rafa-1300-sweep', 'Fixes #42.', ['Fix the doctor']);
    const answer = pairBugFixes(
      rows({
        reports: [
          done('rafa-1300-sweep', 'Fix the doctor', { sessionId: 'fixer-late', collectedAt: '2026-11-06T10:00:00.000Z' }),
          done('rafa-1300-sweep', 'Fix the doctor', { sessionId: 'fixer-early', collectedAt: '2026-11-02T10:00:00.000Z' }),
          done('rafa-1300-sweep', 'Fix the doctor', { sessionId: 'fixer-before', collectedAt: '2026-10-02T10:00:00.000Z' }),
        ],
      }),
      [linked],
      NOW,
    );

    expect(answer.pairs.map(({ fix }) => fix.sessionId)).toEqual(['fixer-early']);
  });

  it('when the plan line carries its declaration block and the stored report line does not', () => {
    const planLine = 'Fix the doctor  {agent=loop-implementer effort=high tests=module}';
    const linked = stage('rafa-1300-sweep', 'Fixes #42.', [planLine]);
    const answer = pairBugFixes(rows({ reports: [done('rafa-1300-sweep', 'Fix the doctor')] }), [linked], NOW);

    expect(answer.unpaired).toEqual([]);
    expect(answer.pairs.map(({ fix }) => fix.sessionId)).toEqual(['fixer-1']);
    expect(answer.pairs.map(({ lesson }) => lesson.action)).toEqual(['Fix the doctor']);
  });

  it('with the resolution of a stored finding whose line has no declaration block', () => {
    const planLine = 'Fix the doctor  {agent=loop-implementer}';
    const other = 'Fix the reader  {agent=loop-implementer}';
    const linked = stage('rafa-1300-sweep', 'Fixes #42.', [planLine, other]);
    const answer = pairBugFixes(
      rows({
        resolved: [resolved('rafa-1300-sweep', 'Fix the doctor')],
        reports: [done('rafa-1300-sweep', 'Fix the doctor')],
      }),
      [linked],
      NOW,
    );

    expect(answer.pairs.map(({ lesson }) => lesson.action)).toEqual(['read env through the seam']);
  });

  it('never when the stored line differs from the plan line beyond the declaration block', () => {
    const linked = stage('rafa-1300-sweep', 'Fixes #42.', ['Fix the doctor  {agent=loop-implementer}']);
    const answer = pairBugFixes(rows({ reports: [done('rafa-1300-sweep', 'Fix the doctor again')] }), [linked], NOW);

    expect(answer.pairs).toEqual([]);
    expect(answer.unpaired.map(({ reason }) => reason)).toEqual(['no-done-report']);
  });
});

describe('the lesson of a pair', () => {
  /** The one pair of a bug fixed by a one-task stage. */
  function onePair(): ReturnType<typeof pairBugFixes> {
    const linked = stage('rafa-1300-sweep', 'Fixes #42.', ['Fix the doctor']);
    return pairBugFixes(
      rows({ resolved: [resolved('rafa-1300-sweep', 'Fix the doctor')], reports: [done('rafa-1300-sweep', 'Fix the doctor')] }),
      [linked],
      NOW,
    );
  }

  it('holds two sources and the evidence of both sessions, the filing one first', () => {
    const [pair] = onePair().pairs;
    const action = 'read env through the seam';

    expect(pair?.lesson).toEqual({
      id: lessonId(WORDS, action),
      trigger: WORDS,
      action,
      action_hash: actionHash(action),
      confidence: LESSON_CONFIDENCE,
      usage_count: 2,
      sources: ['filer-1', 'fixer-1'],
      artifact: ARTIFACT,
      signal: 'loud',
      status: 'active',
      created_at: NOW.toISOString(),
      updated_at: NOW.toISOString(),
      description: {
        kind: 'gotcha',
        domain: DEFAULT_LESSON_DOMAIN,
        scope: 'project',
        source: 'task-report',
        evidence: [
          { plan: 'rafa-900-filer', task: 'Add the filer', session: 'filer-1', outcome: 'done' },
          { plan: 'rafa-1300-sweep', task: 'Fix the doctor', session: 'fixer-1', outcome: 'done' },
        ],
        cause: WORDS,
        projectId: null,
      },
    });
  });

  it('is held by the local adapter as a record the schema accepts', async () => {
    const [pair] = onePair().pairs;
    if (pair === undefined) throw new Error('expected a pair');
    const instinctsDir = join(freshDir(), 'instincts');
    const learning = createLocalLearning({
      instinctsDir,
      home: freshDir(),
      minConfidence: 0.5,
      now: () => NOW.toISOString(),
      warn: () => {},
    });
    await learning.push({ source_id: pair.fix.sessionId, instincts: [pair.lesson] });

    const parsed = readdirSync(instinctsDir)
      .filter((name) => name.endsWith('.md'))
      .map((name) => parseInstinct(readFileSync(join(instinctsDir, name), 'utf8')));
    expect(parsed.map(({ issues, instinct }) => ({
      issues,
      kind: instinct?.kind,
      sources: instinct?.sources,
      usageCount: instinct?.usageCount,
    }))).toEqual([{ issues: [], kind: 'gotcha', sources: ['filer-1', 'fixer-1'], usageCount: 2 }]);
  });
});

describe('pairBugFixes', () => {
  it('changes no row or link passed in', () => {
    const input = rows({
      resolved: [resolved('rafa-1300-sweep', 'Fix the doctor')],
      reports: [done('rafa-1300-sweep', 'Fix the doctor')],
    });
    const links = [stage('rafa-1300-sweep', 'Fixes #42.', ['Fix the doctor'])];
    const before = JSON.stringify({ input, links });

    const answer = pairBugFixes(input, links, NOW);

    expect(answer.pairs).toHaveLength(1);
    expect(JSON.stringify({ input, links })).toBe(before);
  });
});
