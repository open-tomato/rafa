/**
 * Tests for the injection renderer.
 *
 * Fixtures are lists of lines joined here, as `parse.test.ts` builds
 * them. A dispatched task is never a literal copied from the loop's
 * reader: {@link dispatchedAt} blanks every other line and asks
 * `findNextTask` itself, so each `task` and `lineNum` handed to the
 * renderer is one the loop could have handed it.
 *
 * Every rule that keeps something OUT of a rendering has a control
 * showing the fixture carries it — the `full` rendering of the same
 * plan, or a near miss differing only in what the rule is keyed on. A
 * renderer answering nothing passes each exclusion on its own and fails
 * its control. The checkbox rules are held against the loop rather than
 * against expectations: the walk ticks a real tracker with
 * `updateTrackerLine`, blocks one task on the way, and requires the
 * plan and the tracker to render the same text at every dispatch.
 */
import type { TaskInfo } from '../utils/tracker.js';

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';

import { INJECT_MODES } from '../config.js';
import { findNextTask, updateTrackerLine } from '../utils/tracker.js';

import { renderInjection } from './inject.js';

/** Joins lines into a document ending in a newline, as an editor saves one. */
function doc(...lines: string[]): string {
  return `${lines.join('\n')}\n`;
}

/**
 * The task `findNextTask` answers for the first line opening with
 * `prefix`, found with every other line blanked. Throws when no such
 * line is a task, so a fixture typo fails loudly.
 */
function dispatchedAt(lines: readonly string[], prefix: string): TaskInfo {
  const lineNum = lines.findIndex((line) => line.startsWith(prefix));
  const alone = lines.map((line, index) => (index === lineNum
    ? line
    : ''));
  const info = findNextTask(alone.join('\n'));
  if (lineNum < 0 || info === null) {
    throw new Error(`fixture holds no task line opening with ${JSON.stringify(prefix)}`);
  }
  return info;
}

/** Two stages, both contexts, a declaration, prose and an ignored block. */
const PLAN_LINES = [
  '# Plan: Example',
  '',
  '```rafa:plan',
  'stub: my-feature',
  '```',
  '',
  'Prose about the plan as a whole.',
  '',
  '```rafa:context',
  'Every task keeps the store append-only.',
  '```',
  '',
  '# Stage: schema',
  '',
  '```rafa:stage-context',
  'Schemas live in src/schema/.',
  '```',
  '',
  '- [ ] Add the schema  {agent=loop-implementer effort=high}',
  '- [ ] Add the validator',
  '- [ ] Add the fixtures  {effort=low}',
  '',
  '# Stage: api',
  '',
  'Prose under the api stage.',
  '',
  '- [ ] Add the route  {model=haiku}',
  '- [ ] Add the handler',
  '',
  '```rafa:stage-context',
  'Routes are versioned under /v1.',
  '```',
  '',
  '```rafa:review',
  'A kind this phase ignores.',
  '```',
];

const PLAN = doc(...PLAN_LINES);

/** The plan's second task, the one most cases dispatch. */
const VALIDATOR = dispatchedAt(PLAN_LINES, '- [ ] Add the validator');

describe('full', () => {
  it('answers the plan byte for byte, whatever it holds', () => {
    const tracker = PLAN.replace('- [ ] Add the schema', '- [x] Add the schema');
    const inputs = [
      PLAN,
      tracker,
      PLAN_LINES.join('\r\n'),
      PLAN_LINES.join('\n'),
      '',
    ];

    for (const plan of inputs) {
      const rendered = renderInjection({ mode: 'full', plan, task: VALIDATOR });
      expect(rendered.text).toBe(plan);
      expect(rendered.mode).toBe('full');
      expect(rendered.fallback).toBeNull();
    }
  });

  it('locates nothing, so a task the plan does not hold is no fallback', () => {
    const task = { task: 'Nothing the plan says', lineNum: 999 };
    const full = renderInjection({ mode: 'full', plan: PLAN, task });
    expect(full).toEqual({ requested: 'full', mode: 'full', text: PLAN, fallback: null });

    // Control: the same task falls back under a mode that locates it.
    const stage = renderInjection({ mode: 'stage', plan: PLAN, task });
    expect(stage.fallback?.reason).toBe('no-task-at-line');
  });
});

describe('stage', () => {
  it('renders the plan context, the stage, its checklist and the stage list', () => {
    const rendered = renderInjection({ mode: 'stage', plan: PLAN, task: VALIDATOR });

    expect(rendered).toEqual({
      requested: 'stage',
      mode: 'stage',
      fallback: null,
      text: doc(
        '## Plan context',
        '',
        'Every task keeps the store append-only.',
        '',
        '## Stage: schema',
        '',
        'Schemas live in src/schema/.',
        '',
        '- [x] Add the schema',
        '- [ ] Add the validator',
        '- [ ] Add the fixtures',
        '',
        '## Stages',
        '',
        '1. schema (current stage)',
        '2. api',
      ),
    });
  });

  it('takes the stage from the dispatched task, its context bound after its tasks', () => {
    const handler = dispatchedAt(PLAN_LINES, '- [ ] Add the handler');
    const rendered = renderInjection({ mode: 'stage', plan: PLAN, task: handler });

    expect(rendered.text).toBe(doc(
      '## Plan context',
      '',
      'Every task keeps the store append-only.',
      '',
      '## Stage: api',
      '',
      'Routes are versioned under /v1.',
      '',
      '- [x] Add the route',
      '- [ ] Add the handler',
      '',
      '## Stages',
      '',
      '1. schema',
      '2. api (current stage)',
    ));
  });

  it('shows earlier tasks done, the dispatched one open, and later ones as written', () => {
    const lines = PLAN_LINES.map((line) => line
      .replace('- [ ] Add the validator', '- [BLOCKED] Add the validator')
      .replace('- [ ] Add the fixtures', '- [x] Add the fixtures'));
    const resumed = dispatchedAt(lines, '- [BLOCKED] Add the validator');
    expect(resumed.status).toBe('blocked');

    const rendered = renderInjection({ mode: 'stage', plan: doc(...lines), task: resumed });
    expect(rendered.text).toContain(doc(
      '- [x] Add the schema',
      '- [ ] Add the validator',
      '- [x] Add the fixtures',
    ));

    // Near miss: the later task open in the document is shown open.
    const open = lines.map((line) => line.replace('- [x] Add the fixtures', '- [ ] Add the fixtures'));
    const nearMiss = renderInjection({ mode: 'stage', plan: doc(...open), task: resumed });
    expect(nearMiss.text).toContain(doc(
      '- [x] Add the schema',
      '- [ ] Add the validator',
      '- [ ] Add the fixtures',
    ));
  });
});

describe('task', () => {
  it('renders the plan context, the stage context and the task line alone', () => {
    const rendered = renderInjection({ mode: 'task', plan: PLAN, task: VALIDATOR });

    expect(rendered).toEqual({
      requested: 'task',
      mode: 'task',
      fallback: null,
      text: doc(
        '## Plan context',
        '',
        'Every task keeps the store append-only.',
        '',
        '## Stage: schema',
        '',
        'Schemas live in src/schema/.',
        '',
        '- [ ] Add the validator',
      ),
    });
  });

  it('takes the declaration off the task line', () => {
    const schema = dispatchedAt(PLAN_LINES, '- [ ] Add the schema');
    expect(schema.task).toBe('Add the schema  {agent=loop-implementer effort=high}');

    const rendered = renderInjection({ mode: 'task', plan: PLAN, task: schema });
    expect(rendered.fallback).toBeNull();
    expect(rendered.text).toEndWith('\n\n- [ ] Add the schema\n');
  });

  it('shows a task resumed from blocked as open', () => {
    const lines = PLAN_LINES.map((line) => line.replace('- [ ] Add the validator', '- [BLOCKED] Add the validator'));
    const resumed = dispatchedAt(lines, '- [BLOCKED] Add the validator');

    const rendered = renderInjection({ mode: 'task', plan: doc(...lines), task: resumed });
    expect(rendered.text).toEndWith('\n- [ ] Add the validator\n');
    expect(rendered.text).not.toContain('BLOCKED');
  });
});

describe('what stays out of stage and task', () => {
  const ABSENT = [
    '# Plan: Example',
    'stub: my-feature',
    'Prose about the plan as a whole.',
    'Prose under the api stage.',
    'A kind this phase ignores.',
    '```',
    'rafa:',
    '{agent=',
    '{effort=',
  ];

  it.each(['stage', 'task'] as const)('%s quotes no title, header, prose, fence, ignored block or declaration', (mode) => {
    const rendered = renderInjection({ mode, plan: PLAN, task: VALIDATOR });
    expect(rendered.fallback).toBeNull();
    for (const text of ABSENT) expect(rendered.text).not.toContain(text);

    // Control: the plan carries every one of them.
    for (const text of ABSENT) expect(PLAN).toContain(text);
  });

  it.each(['stage', 'task'] as const)('%s quotes no other stage', (mode) => {
    const rendered = renderInjection({ mode, plan: PLAN, task: VALIDATOR });
    for (const text of ['Routes are versioned under /v1.', 'Add the route', 'Add the handler']) {
      expect(rendered.text).not.toContain(text);
    }

    // Control: dispatched from that stage, the same plan quotes them.
    const handler = dispatchedAt(PLAN_LINES, '- [ ] Add the handler');
    const other = renderInjection({ mode, plan: PLAN, task: handler });
    expect(other.text).toContain('Routes are versioned under /v1.');
    expect(other.text).toContain('Add the handler');
  });

  it('keeps the rest of the stage out of task and in stage', () => {
    const task = renderInjection({ mode: 'task', plan: PLAN, task: VALIDATOR });
    const stage = renderInjection({ mode: 'stage', plan: PLAN, task: VALIDATOR });
    for (const text of ['Add the schema', 'Add the fixtures', '## Stages']) {
      expect(task.text).not.toContain(text);
      expect(stage.text).toContain(text);
    }
  });
});

describe('contexts', () => {
  /** A one-stage plan whose two contexts hold `plan` and `stage`. */
  function withContexts(plan: readonly string[], stage: readonly string[]): string[] {
    return [
      '```rafa:context',
      ...plan,
      '```',
      '# Stage: only',
      '```rafa:stage-context',
      ...stage,
      '```',
      '- [ ] The task',
    ];
  }

  it('gives a blank context no section', () => {
    const lines = withContexts(['', '   '], ['\t']);
    const task = dispatchedAt(lines, '- [ ] The task');

    const rendered = renderInjection({ mode: 'task', plan: doc(...lines), task });
    expect(rendered.text).toBe(doc('## Stage: only', '', '- [ ] The task'));

    // Near miss: one word in each gives each a section.
    const said = withContexts(['', 'Plan.'], ['Stage.']);
    const nearMiss = renderInjection({ mode: 'task', plan: doc(...said), task });
    expect(nearMiss.text).toBe(doc(
      '## Plan context',
      '',
      'Plan.',
      '',
      '## Stage: only',
      '',
      'Stage.',
      '',
      '- [ ] The task',
    ));
  });

  it('drops outer blank lines and keeps inner ones and indentation', () => {
    const lines = withContexts(['', '  ', '  indented first', '', 'second', ' ', ''], ['Stage.']);
    const task = dispatchedAt(lines, '- [ ] The task');

    const rendered = renderInjection({ mode: 'task', plan: doc(...lines), task });
    expect(rendered.text).toStartWith('## Plan context\n\n  indented first\n\nsecond\n\n## Stage: only\n');
  });
});

describe('tasks outside every stage', () => {
  it('renders a plan with no stage heading as one checklist and no stage list', () => {
    const lines = ['# Plan: Flat', '', '- [x] First', '- [ ] Second', '- [ ] Third'];
    const task = dispatchedAt(lines, '- [ ] Second');

    const stage = renderInjection({ mode: 'stage', plan: doc(...lines), task });
    expect(stage.text).toBe(doc('## Checklist', '', '- [x] First', '- [ ] Second', '- [ ] Third'));

    const single = renderInjection({ mode: 'task', plan: doc(...lines), task });
    expect(single.text).toBe(doc('## Checklist', '', '- [ ] Second'));
  });

  it('keeps tasks above the first heading apart and marks no stage for them', () => {
    const lines = [
      '- [ ] Before any stage',
      '# Stage: later',
      '```rafa:stage-context',
      'Later only.',
      '```',
      '- [ ] Under the stage',
    ];
    const task = dispatchedAt(lines, '- [ ] Before any stage');

    const rendered = renderInjection({ mode: 'stage', plan: doc(...lines), task });
    expect(rendered.text).toBe(doc(
      '## Checklist',
      '',
      '- [ ] Before any stage',
      '',
      '## Stages',
      '',
      '1. later',
    ));
  });
});

describe('fallback to full', () => {
  /** The plan with `inserted` placed right above the validator. */
  function editedAbove(inserted: string): string {
    return doc(...PLAN_LINES.flatMap((line) => (line === '- [ ] Add the validator'
      ? [inserted, line]
      : [line])));
  }

  it.each(['stage', 'task'] as const)('%s hands over the plan when the line holds another task', (mode) => {
    const plan = editedAbove('- [ ] Add the migration');
    const rendered = renderInjection({ mode, plan, task: VALIDATOR });

    expect(rendered.requested).toBe(mode);
    expect(rendered.mode).toBe('full');
    expect(rendered.text).toBe(plan);
    expect(rendered.fallback).toMatchObject({ reason: 'task-text-differs', line: VALIDATOR.lineNum + 1 });

    // Near miss: the unedited plan holds the task where it was dispatched.
    expect(renderInjection({ mode, plan: PLAN, task: VALIDATOR }).fallback).toBeNull();
  });

  it.each(['stage', 'task'] as const)('%s hands over the plan when the line holds no task', (mode) => {
    const plan = editedAbove('');
    const rendered = renderInjection({ mode, plan, task: VALIDATOR });

    expect(rendered.mode).toBe('full');
    expect(rendered.text).toBe(plan);
    expect(rendered.fallback).toMatchObject({ reason: 'no-task-at-line', line: VALIDATOR.lineNum + 1 });
  });

  it('hands over the plan for a task line the model reads as block body', () => {
    const lines = ['```rafa:context', '- [ ] Written inside the context', '```', '', '- [ ] Written outside'];
    const inside = dispatchedAt(lines, '- [ ] Written inside');
    expect(findNextTask(doc(...lines))).toEqual(inside);

    const rendered = renderInjection({ mode: 'stage', plan: doc(...lines), task: inside });
    expect(rendered.mode).toBe('full');
    expect(rendered.fallback).toMatchObject({ reason: 'no-task-at-line', line: 2 });

    // Near miss: the line outside the block is located.
    const outside = dispatchedAt(lines, '- [ ] Written outside');
    const located = renderInjection({ mode: 'stage', plan: doc(...lines), task: outside });
    expect(located.fallback).toBeNull();
    expect(located.text).toBe(doc(
      '## Plan context',
      '',
      '- [ ] Written inside the context',
      '',
      '## Checklist',
      '',
      '- [ ] Written outside',
    ));
  });

  it('never throws, and every mode renders itself for a located task', () => {
    for (const mode of INJECT_MODES) {
      expect(renderInjection({ mode, plan: PLAN, task: VALIDATOR })).toMatchObject({ requested: mode, mode, fallback: null });
      expect(renderInjection({ mode, plan: '', task: VALIDATOR }).text).toBe('');
    }
  });
});

describe('a tracker walked through the loop', () => {
  let dir = '';

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'rafa-inject-'));
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('renders the same stage and task text from the plan and its tracker at every dispatch', () => {
    const trackerPath = join(dir, 'PLAN_TRACKER-walk.md');
    writeFileSync(trackerPath, PLAN);
    const statuses: string[] = [];
    const stageTexts = new Set<string>();

    let info = findNextTask(readFileSync(trackerPath, 'utf8'));
    while (info !== null && statuses.length < 20) {
      const tracker = readFileSync(trackerPath, 'utf8');
      for (const mode of ['stage', 'task'] as const) {
        const fromPlan = renderInjection({ mode, plan: PLAN, task: info });
        const fromTracker = renderInjection({ mode, plan: tracker, task: info });
        expect(fromPlan.fallback).toBeNull();
        expect(fromTracker).toEqual(fromPlan);
        if (mode === 'stage') stageTexts.add(fromPlan.text);
      }

      // The second dispatch fails once, so the third resumes it blocked.
      const outcome = statuses.length === 1
        ? 'blocked'
        : 'done';
      statuses.push(info.status);
      updateTrackerLine(trackerPath, info.lineNum, outcome);
      info = findNextTask(readFileSync(trackerPath, 'utf8'));
    }

    expect(statuses).toEqual(['unchecked', 'unchecked', 'blocked', 'unchecked', 'unchecked', 'unchecked']);
    // Five tasks, five distinct views: the resumption re-renders one.
    expect(stageTexts.size).toBe(5);
    // Control: the tracker the walk compared against did change.
    expect(readFileSync(trackerPath, 'utf8')).not.toBe(PLAN);
  });
});
