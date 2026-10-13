/**
 * Tests for the injection renderer.
 *
 * Fixtures are lists of lines joined here, as `parse.test.ts` builds
 * them. A dispatched task is never a literal copied from the loop's
 * reader: {@link dispatchedAt} blanks every other line and asks
 * `findNextTask` itself, so each `task` handed to the renderer is one
 * the loop could have handed it, and {@link positionOf} counts its
 * place over `listTrackerTasks`, the reader the loop lists a tracker's
 * tasks with. The renderer reads no `lineNum`; the cases under
 * `locating the task` hand it one that is wrong for the plan and hold
 * that nothing changes. A dispatched repair is likewise one the loop's
 * writer inserted and its reader answered ({@link repairAfter}), named
 * by the comment `insertTrackerTask` wrote on its line.
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
import { findNextTask, insertTrackerTask, listTrackerTasks, updateTrackerLine } from '../utils/tracker.js';

import { renderInjection } from './inject.js';

/** Joins lines into a document ending in a newline, as an editor saves one. */
function doc(...lines: string[]): string {
  return `${lines.join('\n')}\n`;
}

/**
 * The task `findNextTask` answers for the line at `lineNum`, found with
 * every other line blanked. Throws when the line is no task, so a
 * fixture typo fails loudly.
 */
function dispatchedOn(lines: readonly string[], lineNum: number): TaskInfo {
  const alone = lines.map((line, index) => (index === lineNum
    ? line
    : ''));
  const info = findNextTask(alone.join('\n'));
  if (lineNum < 0 || info === null) {
    throw new Error(`fixture holds no task on line ${lineNum}`);
  }
  return info;
}

/** {@link dispatchedOn} the first line opening with `prefix`. */
function dispatchedAt(lines: readonly string[], prefix: string): TaskInfo {
  return dispatchedOn(lines, lines.findIndex((line) => line.startsWith(prefix)));
}

/**
 * The place of `info` among the tasks the loop's reader lists in
 * `lines`, counting from zero. Throws when it is none of them.
 */
function positionOf(lines: readonly string[], info: Pick<TaskInfo, 'lineNum'>): number {
  const position = listTrackerTasks(lines.join('\n')).findIndex((task) => task.lineNum === info.lineNum);
  if (position < 0) throw new Error(`fixture lists no task on line ${info.lineNum}`);
  return position;
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

/** Where every case that writes a tracker keeps it. */
let dir = '';

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'rafa-inject-'));
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

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
    expect(stage.fallback?.reason).toBe('no-task-with-text');
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

describe('locating the task', () => {
  /** A repair line as `writeRepairTask` inserts one, its declaration and blocker included. */
  function repairAt(commit: string) {
    return { task: `Repair the red task step at commit ${commit}`, declaration: 'agent=build-error-resolver', blocker: 'the suite went red' };
  }

  /** The plan with the validator's sentence reworded, its line and place kept. */
  const REWORDED_LINES = PLAN_LINES.map((line) => line.replace('Add the validator', 'Add the strict validator'));

  /** Two stages that each close on a task of the same text. */
  const TWICE_LINES = [
    '# Stage: schema',
    '',
    '- [ ] Add the schema',
    '- [ ] Add the tests',
    '',
    '# Stage: api',
    '',
    '- [ ] Add the route',
    '- [ ] Add the tests',
  ];

  const TWICE = doc(...TWICE_LINES);
  const FIRST_TESTS = dispatchedOn(TWICE_LINES, TWICE_LINES.indexOf('- [ ] Add the tests'));
  const SECOND_TESTS = dispatchedOn(TWICE_LINES, TWICE_LINES.lastIndexOf('- [ ] Add the tests'));

  it.each(['stage', 'task'] as const)('%s renders a task sitting two lines below its plan line (#865)', (mode) => {
    const trackerPath = join(dir, `PLAN_TRACKER-repaired-${mode}.md`);
    writeFileSync(trackerPath, PLAN);
    const read = () => readFileSync(trackerPath, 'utf8');

    // The first task is done, then two red steps each insert a repair
    // above the next open task, and each repair is done in turn.
    updateTrackerLine(trackerPath, findNextTask(read())!.lineNum, 'done');
    for (const commit of ['1111111', '2222222']) {
      const repair = insertTrackerTask(trackerPath, repairAt(commit), findNextTask(read())!.lineNum);
      expect(findNextTask(read())?.lineNum).toBe(repair);
      updateTrackerLine(trackerPath, repair, 'done');
    }

    const dispatched = findNextTask(read());
    expect(dispatched).toEqual({ ...VALIDATOR, lineNum: VALIDATOR.lineNum + 2 });
    // Control: the plan holds no task on that line, which is what the
    // lookup by line number fell back on.
    expect(PLAN_LINES[VALIDATOR.lineNum + 2]).toBe('');

    const rendered = renderInjection({ mode, plan: PLAN, task: dispatched! });
    expect(rendered.fallback).toBeNull();
    expect(rendered.mode).toBe(mode);
    expect(rendered).toEqual(renderInjection({ mode, plan: PLAN, task: VALIDATOR }));
  });

  it.each(['stage', 'task'] as const)('%s takes a text held once, whatever the line and the position say', (mode) => {
    const handler = dispatchedAt(PLAN_LINES, '- [ ] Add the handler');
    const elsewhere = positionOf(PLAN_LINES, handler);
    const inPlace = renderInjection({ mode, plan: PLAN, task: VALIDATOR, position: positionOf(PLAN_LINES, VALIDATOR) });
    expect(inPlace.fallback).toBeNull();
    expect(inPlace.text).toContain('- [ ] Add the validator');

    const moved = { ...VALIDATOR, lineNum: handler.lineNum };
    expect(renderInjection({ mode, plan: PLAN, task: { task: VALIDATOR.task } })).toEqual(inPlace);
    expect(renderInjection({ mode, plan: PLAN, task: moved })).toEqual(inPlace);
    expect(renderInjection({ mode, plan: PLAN, task: moved, position: elsewhere })).toEqual(inPlace);

    // Control: that position names another task, and a text nobody
    // holds is located there, so it could have changed the answer.
    const byPosition = renderInjection({ mode, plan: PLAN, task: { task: 'Nothing the plan says' }, position: elsewhere });
    expect(byPosition.fallback).toBeNull();
    expect(byPosition.text).toContain('- [ ] Add the handler');
    expect(byPosition.text).not.toContain('Add the validator');
  });

  it('takes the task at the position when two hold the text', () => {
    expect(SECOND_TESTS.task).toBe(FIRST_TESTS.task);
    expect(positionOf(TWICE_LINES, FIRST_TESTS)).toBe(1);
    expect(positionOf(TWICE_LINES, SECOND_TESTS)).toBe(3);

    const first = renderInjection({ mode: 'stage', plan: TWICE, task: FIRST_TESTS, position: positionOf(TWICE_LINES, FIRST_TESTS) });
    expect(first.fallback).toBeNull();
    expect(first.text).toBe(doc(
      '## Stage: schema',
      '',
      '- [x] Add the schema',
      '- [ ] Add the tests',
      '',
      '## Stages',
      '',
      '1. schema (current stage)',
      '2. api',
    ));

    const second = renderInjection({ mode: 'stage', plan: TWICE, task: SECOND_TESTS, position: positionOf(TWICE_LINES, SECOND_TESTS) });
    expect(second.fallback).toBeNull();
    expect(second.text).toBe(doc(
      '## Stage: api',
      '',
      '- [x] Add the route',
      '- [ ] Add the tests',
      '',
      '## Stages',
      '',
      '1. schema',
      '2. api (current stage)',
    ));

    // The position decides and the line does not: the second task's
    // record with the first one's position renders the first.
    expect(renderInjection({ mode: 'stage', plan: TWICE, task: SECOND_TESTS, position: 1 })).toEqual(first);
  });

  it.each([
    ['no position', undefined, 'the dispatch gives no position among its tasks'],
    ['the position of a task with another text', 0, 'task number 1 is none of them'],
    ['a position past the last task', 4, 'task number 5 is none of them'],
  ] as const)('hands over the plan when two hold the text and it is given %s', (_name, position, said) => {
    const rendered = renderInjection({ mode: 'stage', plan: TWICE, task: SECOND_TESTS, position });

    expect(rendered).toMatchObject({ requested: 'stage', mode: 'full', text: TWICE });
    expect(rendered.fallback?.reason).toBe('several-tasks-with-text');
    expect(rendered.fallback?.text).toBe(`the plan holds 2 tasks with the dispatched text and ${said}, so the whole plan is handed over`);
  });

  it.each(['stage', 'task'] as const)('%s takes the task at the position when the plan reworded it', (mode) => {
    const reworded = doc(...REWORDED_LINES);
    const position = positionOf(PLAN_LINES, VALIDATOR);
    const rendered = renderInjection({ mode, plan: reworded, task: VALIDATOR, position });

    expect(rendered.fallback).toBeNull();
    expect(rendered.mode).toBe(mode);
    expect(rendered).toEqual(renderInjection({
      mode,
      plan: reworded,
      task: dispatchedAt(REWORDED_LINES, '- [ ] Add the strict validator'),
    }));
    expect(rendered.text).toContain('- [ ] Add the strict validator');

    // Near miss: with no position the reworded task is not found.
    const unplaced = renderInjection({ mode, plan: reworded, task: VALIDATOR });
    expect(unplaced.mode).toBe('full');
    expect(unplaced.fallback?.reason).toBe('no-task-with-text');
  });
});

describe('a repair', () => {
  /** What the stage-two repair's line says, its declaration off. */
  const REPAIR = 'Repair the red task step at commit 3333333';

  /** A repair line's sentence, as `isRepairTask` reads one. */
  const REPAIR_LINE = /^Repair the red /;

  /** A dispatched repair, with the request fields the loop reads off its tracker. */
  interface DispatchedRepair {
    readonly task: TaskInfo;
    readonly position: number;
    readonly repairs: string | null;
  }

  /**
   * The repair `findNextTask` answers once the first `done` tasks of
   * `lines` are ticked and a red step has inserted one above the next
   * open task, or after the last task when none is open. Its line
   * names `repairs` when that is a text. Its position is the place of
   * the plan task above it.
   */
  function repairAfter(name: string, lines: readonly string[], done: number, text: string, repairs: string | null): DispatchedRepair {
    const trackerPath = join(dir, `PLAN_TRACKER-repair-${name}.md`);
    writeFileSync(trackerPath, doc(...lines));
    const read = () => readFileSync(trackerPath, 'utf8');
    for (let ticked = 0; ticked < done; ticked += 1) {
      updateTrackerLine(trackerPath, findNextTask(read())!.lineNum, 'done');
    }

    const entry = { task: text, declaration: 'agent=build-error-resolver', blocker: 'the suite went red' };
    const line = insertTrackerTask(
      trackerPath,
      repairs === null
        ? entry
        : { ...entry, repairs },
      findNextTask(read())?.lineNum ?? null,
    );
    const task = findNextTask(read());
    if (task?.lineNum !== line) throw new Error('the repair is not the task the tracker answers');

    const above = listTrackerTasks(read()).filter((held) => held.lineNum < line && !REPAIR_LINE.test(held.task));
    return { task, position: above.length - 1, repairs: task.repairs ?? null };
  }

  /** The repair of `Add the route`, the first task of stage two. */
  function routeRepair(name: string): DispatchedRepair {
    return repairAfter(name, PLAN_LINES, 4, REPAIR, 'Add the route');
  }

  it('is answered by the tracker with the task it names and its declaration', () => {
    const repair = routeRepair('read');

    expect(repair.task).toMatchObject({
      task: `${REPAIR}  {agent=build-error-resolver}`,
      status: 'blocked',
      repairs: 'Add the route',
    });
    // `Add the route` is the fourth of the plan's tasks.
    expect(repair.position).toBe(3);
  });

  it('renders the stage of the task it names, its own line open below that task', () => {
    const rendered = renderInjection({ mode: 'stage', plan: PLAN, ...routeRepair('stage') });

    expect(rendered).toEqual({
      requested: 'stage',
      mode: 'stage',
      fallback: null,
      text: doc(
        '## Plan context',
        '',
        'Every task keeps the store append-only.',
        '',
        '## Stage: api',
        '',
        'Routes are versioned under /v1.',
        '',
        '- [x] Add the route',
        `- [ ] ${REPAIR}`,
        '- [ ] Add the handler',
        '',
        '## Stages',
        '',
        '1. schema',
        '2. api (current stage)',
      ),
    });
  });

  it('renders its own line alone under `task`, with the named task\'s contexts', () => {
    const rendered = renderInjection({ mode: 'task', plan: PLAN, ...routeRepair('task') });

    expect(rendered.fallback).toBeNull();
    expect(rendered.text).toBe(doc(
      '## Plan context',
      '',
      'Every task keeps the store append-only.',
      '',
      '## Stage: api',
      '',
      'Routes are versioned under /v1.',
      '',
      `- [ ] ${REPAIR}`,
    ));
  });

  it.each(['stage', 'task'] as const)('%s is not rendered for a repair located as a plan task is', (mode) => {
    // Control for the two cases above: the same dispatch with the
    // name left out is looked up by the repair's own text, which the
    // plan does not hold, so the name is what rendered the stage.
    const { task } = routeRepair(`unnamed-${mode}`);
    const rendered = renderInjection({ mode, plan: PLAN, task });

    expect(rendered.mode).toBe('full');
    expect(rendered.fallback?.reason).toBe('no-task-with-text');
  });

  it('shows the tasks of the stage below the named one as the plan wrote them', () => {
    const repair = repairAfter('mid-stage', PLAN_LINES, 2, 'Repair the red task step at commit 4444444', 'Add the validator');
    const rendered = renderInjection({ mode: 'stage', plan: PLAN, ...repair });

    expect(rendered.fallback).toBeNull();
    expect(rendered.text).toContain(doc(
      '## Stage: schema',
      '',
      'Schemas live in src/schema/.',
      '',
      '- [x] Add the schema',
      '- [x] Add the validator',
      '- [ ] Repair the red task step at commit 4444444',
      '- [ ] Add the fixtures',
    ));
  });

  it.each(['stage', 'task'] as const)('%s falls back, and says a repair was looking, when the plan no longer holds the named task', (mode) => {
    const repair = routeRepair(`lost-${mode}`);
    const lost = doc(...PLAN_LINES.filter((line) => !line.includes('Add the route')));
    const rendered = renderInjection({ mode, plan: lost, ...repair });

    expect(rendered).toEqual({
      requested: mode,
      mode: 'full',
      text: lost,
      fallback: {
        reason: 'no-task-with-text',
        text: 'the plan holds no task with the text the dispatched repair names, so the whole plan is handed over; '
          + 'the plan may have changed since the repair was written',
      },
    });

    // The position names a task of that plan and is not taken for the
    // named one: a plan task with no holder of its text is found there.
    const byPosition = renderInjection({ mode, plan: lost, task: { task: 'Nothing the plan says' }, position: repair.position });
    expect(byPosition.fallback).toBeNull();
    // Control: the plan that holds the task renders.
    expect(renderInjection({ mode, plan: PLAN, ...repair }).mode).toBe(mode);
  });

  it.each(['stage', 'task'] as const)('%s hands a repair that names nothing the whole plan with a null fallback', (mode) => {
    const repair = repairAfter(`pre-wrap-up-${mode}`, PLAN_LINES, 5, 'Repair the red pre-wrap-up step at commit 5555555', null);
    expect(repair.task.repairs).toBeUndefined();
    expect(repair.repairs).toBeNull();

    const rendered = renderInjection({ mode, plan: PLAN, ...repair });
    expect(rendered).toEqual({ requested: mode, mode: 'full', text: PLAN, fallback: null });

    // Control: looked up by its own text, the same line does fall back.
    expect(renderInjection({ mode, plan: PLAN, task: repair.task }).fallback?.reason).toBe('no-task-with-text');
  });

  it('takes the named task at the position when two hold its text', () => {
    const lines = ['# Stage: schema', '', '- [ ] Add the schema', '- [ ] Add the tests', '', '# Stage: api', '', '- [ ] Add the route', '- [ ] Add the tests'];
    const plan = doc(...lines);
    const first = repairAfter('twice-first', lines, 2, REPAIR, 'Add the tests');
    const second = repairAfter('twice-second', lines, 4, REPAIR, 'Add the tests');
    expect([first.position, second.position]).toEqual([1, 3]);

    expect(renderInjection({ mode: 'stage', plan, ...first }).text).toContain(doc(
      '## Stage: schema',
      '',
      '- [x] Add the schema',
      '- [x] Add the tests',
      `- [ ] ${REPAIR}`,
    ));
    expect(renderInjection({ mode: 'stage', plan, ...second }).text).toContain(doc(
      '## Stage: api',
      '',
      '- [x] Add the route',
      '- [x] Add the tests',
      `- [ ] ${REPAIR}`,
    ));

    const unplaced = renderInjection({ mode: 'stage', plan, task: second.task, repairs: second.repairs });
    expect(unplaced.mode).toBe('full');
    expect(unplaced.fallback).toEqual({
      reason: 'several-tasks-with-text',
      text: 'the plan holds 2 tasks with the text the dispatched repair names and the dispatch gives no position among its tasks, '
        + 'so the whole plan is handed over',
    });
  });
});

describe('fallback to full', () => {
  /** A task whose text no fixture holds. */
  const UNHELD = { task: 'Nothing the plan says' };

  /** A fallback sentence naming a line of the plan, as the lookup by line number wrote them. */
  const NAMES_A_LINE = /\bline \d/;

  it.each(['stage', 'task'] as const)('%s hands over the plan when neither the text nor the position finds a task', (mode) => {
    const pastTheEnd = listTrackerTasks(PLAN).length;
    const rendered = renderInjection({ mode, plan: PLAN, task: UNHELD, position: pastTheEnd });

    expect(rendered.requested).toBe(mode);
    expect(rendered.mode).toBe('full');
    expect(rendered.text).toBe(PLAN);
    expect(rendered.fallback).toEqual({
      reason: 'no-task-with-text',
      text: `the plan holds no task with the dispatched text and no task number ${pastTheEnd + 1}, so the whole plan is handed over; `
        + 'the plan may have changed since its tracker was copied, or the task line sits inside a rafa:* block',
    });

    // Near misses: the last position, and the text of a task, are each found.
    expect(renderInjection({ mode, plan: PLAN, task: UNHELD, position: pastTheEnd - 1 }).fallback).toBeNull();
    expect(renderInjection({ mode, plan: PLAN, task: VALIDATOR, position: pastTheEnd }).fallback).toBeNull();
  });

  it('says what was looked for with no position, and names no line of the plan', () => {
    const onALine = { ...UNHELD, lineNum: 21 };
    const rendered = renderInjection({ mode: 'stage', plan: PLAN, task: onALine });

    expect(rendered.mode).toBe('full');
    expect(rendered.fallback).toEqual({
      reason: 'no-task-with-text',
      text: 'the plan holds no task with the dispatched text, so the whole plan is handed over; '
        + 'the plan may have changed since its tracker was copied, or the task line sits inside a rafa:* block',
    });
    expect(rendered.fallback?.text).not.toMatch(NAMES_A_LINE);

    // Control: the sentence this one replaces is one the pattern reads.
    expect('line 22 of the plan holds no task the plan model reads').toMatch(NAMES_A_LINE);
  });

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])('reads the position %p as naming no task', (position) => {
    const rendered = renderInjection({ mode: 'stage', plan: PLAN, task: UNHELD, position });

    expect(rendered.mode).toBe('full');
    expect(rendered.fallback).toEqual(renderInjection({ mode: 'stage', plan: PLAN, task: UNHELD }).fallback);

    // Control: a position that names a task renders its stage.
    expect(renderInjection({ mode: 'stage', plan: PLAN, task: UNHELD, position: 1 }).mode).toBe('stage');
  });

  it('hands over the plan for a task line the model reads as block body', () => {
    // Never closed, so the loop still dispatches the line after its fence.
    const lines = ['- [ ] Written outside', '', '```rafa:context', '- [ ] Written inside the context'];
    const inside = dispatchedAt(lines, '- [ ] Written inside');
    expect(findNextTask(doc('- [x] Written outside', ...lines.slice(1)))).toEqual(inside);

    // The loop counts it among the tracker's tasks, the model does not.
    const position = positionOf(lines, inside);
    expect(position).toBe(1);
    for (const request of [{}, { position }]) {
      const rendered = renderInjection({ mode: 'stage', plan: doc(...lines), task: inside, ...request });
      expect(rendered.mode).toBe('full');
      expect(rendered.fallback?.reason).toBe('no-task-with-text');
    }

    // Near miss: the line outside the block is located.
    const outside = dispatchedAt(lines, '- [ ] Written outside');
    const located = renderInjection({ mode: 'stage', plan: doc(...lines), task: outside, position: positionOf(lines, outside) });
    expect(located.fallback).toBeNull();
    expect(located.text).toBe(doc(
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
