/**
 * Tests for the session attribution mapping.
 *
 * Every fixture here is PLANTED. No session log is opened, and the two
 * tables that carry real-world shape — the eighteen branch names the
 * live tree holds and the twelve plan stubs `.plans/` holds — are
 * transcribed as strings, so the suite is hermetic on a machine with
 * neither a log directory nor a `.plans/` at all.
 *
 * That transcription is the point of the table case rather than a
 * shortcut around it. The branch-to-plan mapping is a claim about THIS
 * repo's naming habits, and the five branches whose stub is not their
 * plan's stub are what the queue-id fallback exists for; a suite built
 * only from invented names would pass against a module that resolved
 * nothing but exact matches. The tally case beside it pins that the
 * table still covers all four outcomes, so a later edit cannot quietly
 * turn it into eighteen exact matches.
 *
 * The task prompt is assembled the way `start.ts` assembles it, with
 * the prefix written out rather than read off the module — a test whose
 * fixtures all come from the module under test cannot report a prefix
 * that changed. One case then holds that written-out prefix against
 * `PROMPT_SHAPES`, which is what ties the two halves together without
 * duplicating the classifier's own drift guard.
 *
 * Fifteen module mutations were driven against this file and every one
 * reddened at least one case, with the restored module green either
 * side: splitting the branch on its last slash, treating a slashless
 * branch as its own stub, dropping the branch trim, accepting a nested
 * stub, loosening the plan-file pattern to admit the tracker, dropping
 * the plan-stub dedupe, matching a queue id as a bare prefix, skipping
 * the exact check, taking the first candidate on an ambiguity, reading
 * the task text from the whole prompt instead of its first line,
 * dropping the shape gate before the slice, answering an empty string
 * instead of null, taking the first histogram entry instead of the
 * modal one, breaking a tie the other way, and falling the plan stub
 * back to the branch stub.
 */
import type { PlanStubMatch } from './attribution.js';

import { describe, expect, it } from 'vitest';

import {
  attributeBranch,
  attributeSession,
  dominantBranch,
  planStubsFromFileNames,
  queueIdOf,
  resolvePlanStub,
  taskTextFromPrompt,
} from './attribution.js';
import { PROMPT_SHAPES } from './classify.js';

/** The twelve plan stubs `.plans/` held when this was written. */
const PLAN_STUBS: readonly string[] = [
  'port-phase-1-skeleton',
  'port-phase-2-schema',
  'q03-port-phase-3-build-dispatch',
  'q04-hygiene-types-and-control-plane',
  'q05-dependency-updates',
  'q06-port-phase-4-lib-wave',
  'q09-port-phase-5-ingest-capture-score',
  'q15-ui-pages',
  'q16a-compose-n8n',
  'q17-dynamic-form-provider-v1',
  'q18-runaway-control',
  'q19-loop-economics',
];

/** One row of the measured branch table. */
interface BranchRow {
  branch: string;
  stub: string | null;
  plan: string | null;
  match: PlanStubMatch;
}

/**
 * Every branch name the live tree carried, with what it resolves to.
 *
 * Eighteen values over 897 session logs. Six name their plan exactly,
 * five reach it only through the queue id, five carry a stub no plan
 * answers to, and two carry no stub at all.
 */
const MEASURED_BRANCHES: readonly BranchRow[] = [
  {
    branch: 'feat/q03-port-phase-3',
    stub: 'q03-port-phase-3',
    plan: 'q03-port-phase-3-build-dispatch',
    match: 'queue-id',
  },
  {
    branch: 'feat/port-phase-2-schema',
    stub: 'port-phase-2-schema',
    plan: 'port-phase-2-schema',
    match: 'exact',
  },
  {
    branch: 'feat/q15-ui-pages',
    stub: 'q15-ui-pages',
    plan: 'q15-ui-pages',
    match: 'exact',
  },
  {
    branch: 'feat/q09-ingest-capture-score',
    stub: 'q09-ingest-capture-score',
    plan: 'q09-port-phase-5-ingest-capture-score',
    match: 'queue-id',
  },
  {
    branch: 'feat/q06-lib-wave',
    stub: 'q06-lib-wave',
    plan: 'q06-port-phase-4-lib-wave',
    match: 'queue-id',
  },
  {
    branch: 'feat/q18-runaway-control',
    stub: 'q18-runaway-control',
    plan: 'q18-runaway-control',
    match: 'exact',
  },
  {
    branch: 'feat/q04-hygiene',
    stub: 'q04-hygiene',
    plan: 'q04-hygiene-types-and-control-plane',
    match: 'queue-id',
  },
  {
    branch: 'feat/q17-dynamic-forms',
    stub: 'q17-dynamic-forms',
    plan: 'q17-dynamic-form-provider-v1',
    match: 'queue-id',
  },
  {
    branch: 'feat/q05-dependency-updates',
    stub: 'q05-dependency-updates',
    plan: 'q05-dependency-updates',
    match: 'exact',
  },
  {
    branch: 'feat/port-phase-1-skeleton',
    stub: 'port-phase-1-skeleton',
    plan: 'port-phase-1-skeleton',
    match: 'exact',
  },
  {
    branch: 'feat/q19-loop-economics',
    stub: 'q19-loop-economics',
    plan: 'q19-loop-economics',
    match: 'exact',
  },
  {
    branch: 'feat/umbrella-integration',
    stub: 'umbrella-integration',
    plan: null,
    match: 'none',
  },
  {
    branch: 'chore/hold-blocked-majors',
    stub: 'hold-blocked-majors',
    plan: null,
    match: 'none',
  },
  {
    branch: 'chore/ralph-ci-gate',
    stub: 'ralph-ci-gate',
    plan: null,
    match: 'none',
  },
  {
    branch: 'chore/loop-implementer-agent',
    stub: 'loop-implementer-agent',
    plan: null,
    match: 'none',
  },
  {
    branch: 'docs/dedupe-lockfile-finding',
    stub: 'dedupe-lockfile-finding',
    plan: null,
    match: 'none',
  },
  { branch: 'main', stub: null, plan: null, match: 'none' },
  { branch: 'pw-align', stub: null, plan: null, match: 'none' },
];

/** The task prefix, written out as `start.ts` writes it. */
const TASK_PREFIX = 'Your scoped task is: ';

/** A task prompt, assembled as `start.ts` assembles it. */
function taskPrompt(task: string): string {
  return [
    `${TASK_PREFIX}${task}`,
    'Consider tasks listed above this one as completed.',
    '',
    '# Plan: q19',
  ].join('\n');
}

/** A wrap-up prompt, assembled as `preserveProgress` assembles it. */
const WRAPUP_PROMPT = [
  '* Read `@progress.txt` in full.',
  '* If there is anything worth keeping, promote it.',
].join('\n');

describe('attributeBranch', () => {
  it('splits a branch into its type and its stub', () => {
    expect(attributeBranch('feat/q19-loop-economics')).toEqual({
      branch: 'feat/q19-loop-economics',
      type: 'feat',
      stub: 'q19-loop-economics',
    });
  });

  it('splits on the FIRST slash, not the last', () => {
    expect(attributeBranch('chore/ralph-ci-gate').stub)
      .toBe('ralph-ci-gate');
  });

  it('answers no stub for a branch with no slash', () => {
    expect(attributeBranch('main')).toEqual({
      branch: 'main',
      type: null,
      stub: null,
    });
  });

  it('answers no stub for a slashless non-default branch', () => {
    expect(attributeBranch('pw-align')).toEqual({
      branch: 'pw-align',
      type: null,
      stub: null,
    });
  });

  it('answers no branch at all for null or undefined', () => {
    expect(attributeBranch(null).branch).toBeNull();
    expect(attributeBranch(undefined).branch).toBeNull();
    expect(attributeBranch(undefined).stub).toBeNull();
  });

  it('reads an empty or blank branch as no branch', () => {
    expect(attributeBranch('').branch).toBeNull();
    expect(attributeBranch('   ').branch).toBeNull();
  });

  it('trims the branch before splitting it', () => {
    expect(attributeBranch('  feat/q19-loop-economics\n')).toEqual({
      branch: 'feat/q19-loop-economics',
      type: 'feat',
      stub: 'q19-loop-economics',
    });
  });

  it('refuses a nested stub, which no plan file can hold', () => {
    expect(attributeBranch('feat/q19/sub')).toEqual({
      branch: 'feat/q19/sub',
      type: 'feat',
      stub: null,
    });
  });

  it('refuses a trailing slash with nothing after it', () => {
    expect(attributeBranch('feat/').stub).toBeNull();
  });

  it('reads a leading slash as no type', () => {
    expect(attributeBranch('/q19')).toEqual({
      branch: '/q19',
      type: null,
      stub: null,
    });
  });
});

describe('the measured branch table', () => {
  it('reproduces every branch the live tree carried', () => {
    const actual = MEASURED_BRANCHES.map((row) => {
      const { stub } = attributeBranch(row.branch);
      const resolved = resolvePlanStub(stub, PLAN_STUBS);
      return {
        branch: row.branch,
        stub,
        plan: resolved.stub,
        match: resolved.match,
      };
    });

    expect(actual).toEqual(MEASURED_BRANCHES);
  });

  it('still covers all four outcomes it was built to cover', () => {
    const tally: Record<string, number> = {};

    for (const row of MEASURED_BRANCHES) {
      const key = row.stub === null
        ? 'no-stub'
        : row.match;
      tally[key] = (tally[key] ?? 0) + 1;
    }

    expect(tally).toEqual({
      exact: 6,
      'queue-id': 5,
      none: 5,
      'no-stub': 2,
    });
  });
});

describe('planStubsFromFileNames', () => {
  it('reads the stub out of a plan file name', () => {
    expect(planStubsFromFileNames(['PLAN-q19-loop-economics.md']))
      .toEqual(['q19-loop-economics']);
  });

  it('ignores the tracker and the prerequisites siblings', () => {
    expect(planStubsFromFileNames([
      'PLAN-q19-loop-economics.md',
      'PLAN_TRACKER-q19-loop-economics.md',
      'PREREQUISITES-q19-loop-economics.md',
    ])).toEqual(['q19-loop-economics']);
  });

  it('ignores a plan file carrying no stub', () => {
    expect(planStubsFromFileNames(['PLAN.md'])).toEqual([]);
  });

  it('ignores anything that is not a plan file', () => {
    expect(planStubsFromFileNames(['README.md', 'PLAN-x.txt', 'x']))
      .toEqual([]);
  });

  it('collapses a stub listed twice', () => {
    expect(planStubsFromFileNames(['PLAN-a.md', 'PLAN-a.md']))
      .toEqual(['a']);
  });

  it('keeps a stub carrying its own hyphens and digits', () => {
    expect(planStubsFromFileNames(['PLAN-q16a-compose-n8n.md']))
      .toEqual(['q16a-compose-n8n']);
  });
});

describe('queueIdOf', () => {
  it('reads the leading queue id of a stub', () => {
    expect(queueIdOf('q03-port-phase-3')).toBe('q03');
  });

  it('reads a lettered queue id whole', () => {
    expect(queueIdOf('q16a-compose-n8n')).toBe('q16a');
  });

  it('reads a stub that is only a queue id', () => {
    expect(queueIdOf('q19')).toBe('q19');
  });

  it('answers null for a stub with no queue id', () => {
    expect(queueIdOf('port-phase-2-schema')).toBeNull();
    expect(queueIdOf('umbrella-integration')).toBeNull();
  });

  it('answers null for null, undefined and empty', () => {
    expect(queueIdOf(null)).toBeNull();
    expect(queueIdOf(undefined)).toBeNull();
    expect(queueIdOf('')).toBeNull();
  });

  it('keeps q16 and q16a distinct', () => {
    expect(queueIdOf('q16-something')).toBe('q16');
    expect(queueIdOf('q16a-compose-n8n')).toBe('q16a');
  });

  it('is anchored, so a mid-stub q reads as no id', () => {
    expect(queueIdOf('port-q03-phase')).toBeNull();
  });
});

describe('resolvePlanStub', () => {
  it('takes an exact match, and says so', () => {
    expect(resolvePlanStub('q15-ui-pages', PLAN_STUBS)).toEqual({
      stub: 'q15-ui-pages',
      match: 'exact',
      candidates: ['q15-ui-pages'],
    });
  });

  it('reaches a renamed plan through its queue id', () => {
    expect(resolvePlanStub('q17-dynamic-forms', PLAN_STUBS)).toEqual({
      stub: 'q17-dynamic-form-provider-v1',
      match: 'queue-id',
      candidates: ['q17-dynamic-form-provider-v1'],
    });
  });

  it('prefers an exact match over the queue id', () => {
    const stubs = ['q19-loop-economics', 'q19-something-else'];
    expect(resolvePlanStub('q19-loop-economics', stubs)).toEqual({
      stub: 'q19-loop-economics',
      match: 'exact',
      candidates: ['q19-loop-economics'],
    });
  });

  it('refuses an ambiguous queue id and names its candidates', () => {
    const stubs = ['q19-one', 'q19-two'];
    expect(resolvePlanStub('q19-loop-economics', stubs)).toEqual({
      stub: null,
      match: 'ambiguous',
      candidates: ['q19-one', 'q19-two'],
    });
  });

  it('answers none for a stub no plan carries', () => {
    expect(resolvePlanStub('ralph-ci-gate', PLAN_STUBS)).toEqual({
      stub: null,
      match: 'none',
      candidates: [],
    });
  });

  it('answers none for a queue id no plan carries', () => {
    expect(resolvePlanStub('q99-nothing', PLAN_STUBS)).toEqual({
      stub: null,
      match: 'none',
      candidates: [],
    });
  });

  it('does not fold a q16 branch onto the q16a plan', () => {
    expect(resolvePlanStub('q16-compose', PLAN_STUBS).stub).toBeNull();
  });

  it('answers none for a null, undefined or empty stub', () => {
    expect(resolvePlanStub(null, PLAN_STUBS).match).toBe('none');
    expect(resolvePlanStub(undefined, PLAN_STUBS).match).toBe('none');
    expect(resolvePlanStub('', PLAN_STUBS).match).toBe('none');
  });

  it('answers none against an empty roster, not an error', () => {
    expect(resolvePlanStub('q19-loop-economics', [])).toEqual({
      stub: null,
      match: 'none',
      candidates: [],
    });
  });
});

describe('taskTextFromPrompt', () => {
  it('reads the task sentence out of a task prompt', () => {
    const text = taskTextFromPrompt(taskPrompt('Add attribution.ts'));
    expect(text).toBe('Add attribution.ts');
  });

  it('stops at the first line, not at the whole prompt', () => {
    const text = taskTextFromPrompt(taskPrompt('Add a thing'));
    expect(text).not.toContain('Consider tasks');
    expect(text).not.toContain('\n');
  });

  it('keeps a task carrying backticks and braces intact', () => {
    const task = 'Add `x.ts` {agent=doc-updater model=haiku}';
    expect(taskTextFromPrompt(taskPrompt(task))).toBe(task);
  });

  it('handles a prompt that is only its first line', () => {
    expect(taskTextFromPrompt(`${TASK_PREFIX}Do the thing`))
      .toBe('Do the thing');
  });

  it('answers null for a wrap-up prompt', () => {
    expect(taskTextFromPrompt(WRAPUP_PROMPT)).toBeNull();
  });

  it('answers null for a plan-generation prompt', () => {
    expect(taskTextFromPrompt('# Plan-generation instructions\n'))
      .toBeNull();
  });

  it('answers null for hand-driven traffic', () => {
    expect(taskTextFromPrompt('Reply with exactly the word: ok'))
      .toBeNull();
  });

  it('answers null for null, undefined and empty content', () => {
    expect(taskTextFromPrompt(null)).toBeNull();
    expect(taskTextFromPrompt(undefined)).toBeNull();
    expect(taskTextFromPrompt('')).toBeNull();
  });

  it('answers null for a prefix followed by nothing', () => {
    expect(taskTextFromPrompt(TASK_PREFIX)).toBeNull();
    expect(taskTextFromPrompt(`${TASK_PREFIX}   `)).toBeNull();
  });

  it('will not read a task prefix from mid-content', () => {
    expect(taskTextFromPrompt(`context\n${TASK_PREFIX}Do it`))
      .toBeNull();
  });

  it('uses the prefix the shape table declares', () => {
    const shape = PROMPT_SHAPES.find((entry) => entry.kind === 'task');
    expect(shape?.prefix).toBe(TASK_PREFIX);
  });
});

describe('dominantBranch', () => {
  it('answers the only branch a session carried', () => {
    expect(dominantBranch({ 'feat/q19-loop-economics': 42 })).toEqual({
      branch: 'feat/q19-loop-economics',
      recordCount: 42,
      distinctCount: 1,
    });
  });

  it('takes the modal branch when a session outlived one', () => {
    expect(dominantBranch({ main: 3, 'feat/q19-loop-economics': 91 }))
      .toEqual({
        branch: 'feat/q19-loop-economics',
        recordCount: 91,
        distinctCount: 2,
      });
  });

  it('keeps the modal branch whatever order it was folded', () => {
    const counts = { 'feat/a': 91, main: 3, 'feat/b': 7 };
    expect(dominantBranch(counts).branch).toBe('feat/a');
  });

  it('breaks a tie on the lexically smallest name', () => {
    expect(dominantBranch({ zzz: 5, aaa: 5 }).branch).toBe('aaa');
    expect(dominantBranch({ aaa: 5, zzz: 5 }).branch).toBe('aaa');
  });

  it('answers no branch for an empty histogram', () => {
    expect(dominantBranch({})).toEqual({
      branch: null,
      recordCount: 0,
      distinctCount: 0,
    });
  });

  it('does not read a zero count as a sighting', () => {
    expect(dominantBranch({ main: 0 })).toEqual({
      branch: null,
      recordCount: 0,
      distinctCount: 1,
    });
  });
});

describe('attributeSession', () => {
  it('builds the whole row for a task on a plan branch', () => {
    const row = attributeSession(
      {
        sessionId: '006405f5',
        gitBranchCounts: { 'feat/q03-port-phase-3': 512 },
      },
      taskPrompt('Add the streaming reader'),
      PLAN_STUBS,
    );

    expect(row).toEqual({
      sessionId: '006405f5',
      branch: 'feat/q03-port-phase-3',
      branchRecordCount: 512,
      distinctBranchCount: 1,
      branchType: 'feat',
      branchStub: 'q03-port-phase-3',
      planStub: 'q03-port-phase-3-build-dispatch',
      planStubMatch: 'queue-id',
      kind: 'task',
      taskText: 'Add the streaming reader',
    });
  });

  it('answers no branch for a session that carried none', () => {
    const row = attributeSession(
      { sessionId: 'no-branch', gitBranchCounts: {} },
      null,
      PLAN_STUBS,
    );

    expect(row.branch).toBeNull();
    expect(row.branchType).toBeNull();
    expect(row.branchStub).toBeNull();
    expect(row.planStub).toBeNull();
    expect(row.planStubMatch).toBe('none');
    expect(row.branchRecordCount).toBe(0);
    expect(row.distinctBranchCount).toBe(0);
    expect(row.kind).toBe('other');
    expect(row.taskText).toBeNull();
  });

  it('answers no stub for a session on a slashless branch', () => {
    const row = attributeSession(
      { sessionId: 'on-main', gitBranchCounts: { main: 9 } },
      taskPrompt('Do a thing on main'),
      PLAN_STUBS,
    );

    expect(row.branch).toBe('main');
    expect(row.branchType).toBeNull();
    expect(row.branchStub).toBeNull();
    expect(row.planStub).toBeNull();
    expect(row.planStubMatch).toBe('none');
    expect(row.taskText).toBe('Do a thing on main');
  });

  it('keeps the branch stub when no plan answers to it', () => {
    const row = attributeSession(
      {
        sessionId: 'ci-gate',
        gitBranchCounts: { 'chore/ralph-ci-gate': 7 },
      },
      taskPrompt('Add the CI gate'),
      PLAN_STUBS,
    );

    expect(row.branchStub).toBe('ralph-ci-gate');
    expect(row.planStub).toBeNull();
  });

  it('carries no task text for a wrap-up session', () => {
    const row = attributeSession(
      {
        sessionId: 'wrap',
        gitBranchCounts: { 'feat/q19-loop-economics': 4 },
      },
      WRAPUP_PROMPT,
      PLAN_STUBS,
    );

    expect(row.kind).toBe('wrap-up');
    expect(row.taskText).toBeNull();
    expect(row.planStub).toBe('q19-loop-economics');
  });

  it('flags a session that outlived its checkout', () => {
    const row = attributeSession(
      {
        sessionId: 'desktop',
        gitBranchCounts: { main: 12, 'feat/q15-ui-pages': 40 },
      },
      null,
      PLAN_STUBS,
    );

    expect(row.branch).toBe('feat/q15-ui-pages');
    expect(row.distinctBranchCount).toBe(2);
    expect(row.planStub).toBe('q15-ui-pages');
  });
});
