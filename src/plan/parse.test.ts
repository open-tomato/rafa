/**
 * Tests for the plan model.
 *
 * Every fixture is a list of lines joined here, as `blocks.test.ts`
 * builds them, so a `lineNum` is read off a fixture by counting its
 * entries from zero and an issue's `line` by counting them from one.
 *
 * Two kinds of control keep the cases honest. Each rule that reads
 * something as NOT there — a line that is no task, a block that is not
 * read, a field left null — carries a near miss that reads it: the same
 * lines with only the thing the rule is keyed on changed. A parser
 * answering nothing passes each refusal on its own and fails its near
 * miss. And the checklist is held against `findNextTask` itself rather
 * than against expectations copied from it: the lockstep walk ticks
 * every task the dispatcher picks with `updateTrackerLine`, the loop's
 * own writer, on a real file, and the `task-in-block` cases ask the
 * dispatcher to show what the issue reports: a line it skips inside a
 * closed block, and one it still picks after an unclosed fence.
 */
import type { PlanModel } from './parse.js';
import type { AgentEffortLookup } from '../utils/declaration.js';
import type { TaskInfo } from '../utils/tracker.js';

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';

import { resolveDeclarationFlags } from '../utils/declaration.js';
import { findNextTask, updateTrackerLine } from '../utils/tracker.js';

import { isRafaBlockKind, readRafaBlocks } from './blocks.js';
import { parsePlan, PLAN_BLOCK_KINDS, PLAN_HEADER_FIELDS, PLAN_RELEASE_LEVELS } from './parse.js';

/** No agent definition here declares an effort of its own. */
const NO_OWN_EFFORT: AgentEffortLookup = () => false;

/** Joins lines into a document ending in a newline, as an editor saves one. */
function doc(...lines: string[]): string {
  return `${lines.join('\n')}\n`;
}

/** A `rafa:plan` block holding `lines`, alone in its document. */
function header(...lines: string[]): PlanModel {
  return parsePlan(doc('```rafa:plan', ...lines, '```'));
}

/** Each issue's reason and line, for cases about which were raised. */
function reasonsOf(model: PlanModel): [string, number][] {
  return model.issues.map((issue) => [issue.reason, issue.line]);
}

/** The task sentences alone, for cases about which lines are tasks. */
function textsOf(model: PlanModel): string[] {
  return model.tasks.map((task) => task.text);
}

/** The stage names alone, for cases about which lines are headings. */
function stageNamesOf(model: PlanModel): string[] {
  return model.stages.map((stage) => stage.name);
}

/**
 * The task `findNextTask` would pick from a model: the first blocked
 * task, else the first open one. The model is the thing under test, so
 * the preference is spelled here, from `findNextTask`'s own TSDoc.
 */
function nextOf(model: PlanModel): TaskInfo | null {
  for (const status of ['blocked', 'unchecked'] as const) {
    const pick = model.tasks.find((task) => task.status === status);
    if (pick !== undefined) return { task: pick.task, lineNum: pick.lineNum, status };
  }
  return null;
}

/**
 * Every task's resolved CLI flags, bucketed by the exact `args` array
 * `resolveDeclarationFlags` answers for it, sorted by that array's JSON
 * so the order does not depend on which task happens first.
 */
function declarationHistogram(model: PlanModel): [readonly string[], number][] {
  const buckets = new Map<string, { args: readonly string[]; count: number }>();
  for (const task of model.tasks) {
    const { args } = resolveDeclarationFlags(task.declaration, NO_OWN_EFFORT);
    const key = JSON.stringify(args);
    const bucket = buckets.get(key);
    if (bucket === undefined) buckets.set(key, { args, count: 1 });
    else bucket.count += 1;
  }
  return [...buckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, bucket]) => [bucket.args, bucket.count]);
}

/** The format's own example, with two stages and every checkbox. */
const PLAN_LINES = [
  '# Plan: Example',
  '',
  '```rafa:plan',
  'stub: my-feature',
  'issue: OPT-123          # optional',
  'spec: .specs/my-feature.md',
  '```',
  '',
  '```rafa:context',
  'Prose the loop injects into EVERY task.',
  '```',
  '',
  '# Stage: schema',
  '',
  '```rafa:stage-context',
  'Prose the loop injects only into tasks under THIS stage heading.',
  '```',
  '',
  '- [x] Add the Zod schema for CreateJobRequest  {agent=loop-implementer effort=high skills=zod-schemas}',
  '- [ ] Add the route handler',
  '',
  '# Stage: tests',
  '- [BLOCKED] Add the route tests  {agent=tdd-guide}',
  '- [ ] Add the negative cases  {model=haiku effort=low tools=Read,Bash}',
];

const PLAN = doc(...PLAN_LINES);

describe('the kinds and fields read', () => {
  it('are three kinds the block reader knows, and four header fields', () => {
    expect(PLAN_BLOCK_KINDS).toEqual(['plan', 'context', 'stage-context']);
    for (const kind of PLAN_BLOCK_KINDS) expect(isRafaBlockKind(kind)).toBe(true);
    expect(PLAN_HEADER_FIELDS).toEqual(['stub', 'issue', 'spec', 'release']);
  });

  it('hold the release field to four levels, none among them', () => {
    expect(PLAN_RELEASE_LEVELS).toEqual(['patch', 'minor', 'major', 'none']);
  });
});

describe('a plan', () => {
  const model = parsePlan(PLAN);

  it('reads its header, its context and its stages, and reports nothing', () => {
    expect(model.header).toEqual({
      stub: 'my-feature',
      issue: 'OPT-123',
      spec: '.specs/my-feature.md',
      release: null,
      extras: [],
    });
    expect(model.context).toBe('Prose the loop injects into EVERY task.');
    expect(model.stages).toEqual([
      {
        name: 'schema',
        lineNum: 12,
        context: 'Prose the loop injects only into tasks under THIS stage heading.',
      },
      { name: 'tests', lineNum: 21, context: null },
    ]);
    expect(model.issues).toEqual([]);
  });

  it('reads every task line in source order, with its checkbox, sentence and stage', () => {
    const tasks = model.tasks.map((task) => ({
      task: task.task,
      lineNum: task.lineNum,
      status: task.status,
      text: task.text,
      stage: task.stage,
    }));
    expect(tasks).toEqual([
      {
        task: 'Add the Zod schema for CreateJobRequest  {agent=loop-implementer effort=high skills=zod-schemas}',
        lineNum: 18,
        status: 'done',
        text: 'Add the Zod schema for CreateJobRequest',
        stage: 0,
      },
      {
        task: 'Add the route handler',
        lineNum: 19,
        status: 'unchecked',
        text: 'Add the route handler',
        stage: 0,
      },
      {
        task: 'Add the route tests  {agent=tdd-guide}',
        lineNum: 22,
        status: 'blocked',
        text: 'Add the route tests',
        stage: 1,
      },
      {
        task: 'Add the negative cases  {model=haiku effort=low tools=Read,Bash}',
        lineNum: 23,
        status: 'unchecked',
        text: 'Add the negative cases',
        stage: 1,
      },
    ]);
  });

  it('carries each task declaration, a skills= key beside a known one on its record', () => {
    const flags = model.tasks.map((task) => resolveDeclarationFlags(task.declaration, NO_OWN_EFFORT).args);
    expect(flags).toEqual([
      ['--agent', 'loop-implementer', '--effort', 'high'],
      [],
      ['--agent', 'tdd-guide'],
      ['--model', 'haiku', '--effort', 'low', '--tools', 'Read,Bash'],
    ]);
    expect(model.tasks[0]?.declaration?.skills).toEqual(['zod-schemas']);
    expect(model.tasks[0]?.declaration?.extras).toEqual([]);
    expect(model.tasks[1]?.declaration).toBeNull();
  });

  it('answers its blocks exactly as the block reader does', () => {
    expect(model.blocks).toHaveLength(3);
    expect(model.blocks).toEqual(readRafaBlocks(PLAN));
  });

  it('reads the same in CRLF as in LF, and reads something', () => {
    const crlf = PLAN.replaceAll('\n', '\r\n');
    expect(crlf).toContain('# Stage: schema\r\n');
    const read = parsePlan(crlf);
    expect(read).toEqual(model);
    expect(read.header.stub).toBe('my-feature');
    expect(stageNamesOf(read)).toEqual(['schema', 'tests']);
    expect(textsOf(read)).toHaveLength(4);
  });
});

describe('a plan with no block', () => {
  it('reads a bare checklist with a null header and context, and reports nothing', () => {
    const model = parsePlan(doc('# Plan: Old', '', '# Stage: one', '- [ ] Task A', '- [x] Task B'));
    expect(model.header).toEqual({ stub: null, issue: null, spec: null, release: null, extras: [] });
    expect(model.context).toBeNull();
    expect(model.blocks).toEqual([]);
    expect(model.issues).toEqual([]);
    expect(model.stages).toEqual([{ name: 'one', lineNum: 2, context: null }]);
    expect(model.tasks.map((task) => [task.text, task.status])).toEqual([
      ['Task A', 'unchecked'],
      ['Task B', 'done'],
    ]);
  });

  it('reads an empty document as an empty plan', () => {
    expect(parsePlan('')).toEqual({
      header: { stub: null, issue: null, spec: null, release: null, extras: [] },
      context: null,
      stages: [],
      tasks: [],
      hiddenTasks: [],
      blocks: [],
      issues: [],
    });
  });
});

describe('a rafa: fence opened mid-paragraph', () => {
  it('reads no block, so the plan holds only what surrounds it, and reports nothing', () => {
    const midParagraph = doc(
      'A block opens with ```rafa:context',
      'c',
      '```',
      '# Stage: one',
      '- [ ] A',
    );
    const model = parsePlan(midParagraph);
    expect(model.blocks).toEqual([]);
    expect(model.context).toBeNull();
    expect(model.header).toEqual({ stub: null, issue: null, spec: null, release: null, extras: [] });
    expect(stageNamesOf(model)).toEqual(['one']);
    expect(textsOf(model)).toEqual(['A']);
    expect(model.issues).toEqual([]);
  });

  it('reads the block once the fence opens its own line, the near miss', () => {
    const opened = doc(
      'A block opens with',
      '```rafa:context',
      'c',
      '```',
      '# Stage: one',
      '- [ ] A',
    );
    const model = parsePlan(opened);
    expect(model.blocks).toHaveLength(1);
    expect(model.context).toBe('c');
    expect(stageNamesOf(model)).toEqual(['one']);
    expect(textsOf(model)).toEqual(['A']);
    expect(model.issues).toEqual([]);
  });
});

describe('the checklist, held against findNextTask', () => {
  let dir = '';
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'rafa-plan-parse-'));
  });
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  /** Lines one grammar or the other might read, and the ones both do. */
  const ODD_LINES = [
    '# Stage: one',
    '-  [ ] two spaces after the dash',
    '* [ ] a star',
    '  - [ ] indented',
    '- [X] an upper-case tick',
    '- [blocked] a lower-case block',
    '- [ ]',
    '- [ ]   ',
    '- [ ] Trailing spaces  ',
    '```text',
    '- [ ] Inside an illustration fence',
    '```',
    '- [BLOCKED] Resumed first',
  ];

  it.each([
    ['the example plan', PLAN, 3],
    ['the example plan in CRLF', PLAN.replaceAll('\n', '\r\n'), 3],
    ['lines one grammar or the other might read', doc(...ODD_LINES), 4],
    ['a plan with no stage heading', doc('- [ ] A', '- [BLOCKED] B', '- [x] C', '- [ ] D'), 3],
    ['a plan quoting task lines inside rafa blocks', doc(
      '```rafa:context',
      '- [BLOCKED] Quoted blocked',
      '- [ ] Quoted open',
      '```',
      '# Stage: one',
      '- [ ] A',
      '```rafa:stage-context',
      '- [ ] Quoted in the stage',
      '```',
      '- [ ] B',
    ), 2],
  ])('picks what it picks from %s, through every tick', (_label, text, picks) => {
    const path = join(dir, 'PLAN_TRACKER-walk.md');
    writeFileSync(path, text);

    const dispatched: string[] = [];
    for (let step = 0; step <= picks; step += 1) {
      const content = readFileSync(path, 'utf8');
      const next = findNextTask(content);
      expect(nextOf(parsePlan(content))).toEqual(next);
      if (next === null) break;

      dispatched.push(next.task);
      updateTrackerLine(path, next.lineNum, 'done');
      const ticked = parsePlan(readFileSync(path, 'utf8')).tasks;
      expect(ticked.find((task) => task.lineNum === next.lineNum)?.status).toBe('done');
    }

    expect(dispatched).toHaveLength(picks);
    expect(findNextTask(readFileSync(path, 'utf8'))).toBeNull();
  });

  it('reads a task inside a non-rafa fence, as the dispatcher does', () => {
    const model = parsePlan(doc(...ODD_LINES));
    expect(textsOf(model)).toEqual(['', 'Trailing spaces', 'Inside an illustration fence', 'Resumed first']);
    expect(model.issues).toEqual([]);
  });
});

describe('a task line inside a rafa block', () => {
  const quoted = doc(
    '```rafa:context',
    '- [ ] Quoted, not planned',
    '```',
    '# Stage: one',
    '- [ ] Planned',
  );

  it('is block body and no task, is reported, and is skipped by the dispatcher', () => {
    const model = parsePlan(quoted);
    expect(textsOf(model)).toEqual(['Planned']);
    expect(model.context).toBe('- [ ] Quoted, not planned');
    expect(reasonsOf(model)).toEqual([['task-in-block', 2]]);
    expect(model.issues[0]?.text).toContain('rafa:context block at lines 1-3: findNextTask skips it');
    expect(findNextTask(quoted)).toMatchObject({ task: 'Planned', lineNum: 4 });
  });

  it('is a task once outside the block, the near miss', () => {
    const outside = doc(
      '```rafa:context',
      'c',
      '```',
      '- [ ] Quoted, not planned',
      '# Stage: one',
      '- [ ] Planned',
    );
    const model = parsePlan(outside);
    expect(textsOf(model)).toEqual(['Quoted, not planned', 'Planned']);
    expect(model.issues).toEqual([]);
  });

  it('is reported when blocked, and not when ticked, which the dispatcher never picks', () => {
    const model = parsePlan(doc('```rafa:context', '- [BLOCKED] b', '- [x] x', '```'));
    expect(model.tasks).toEqual([]);
    expect(reasonsOf(model)).toEqual([['task-in-block', 2]]);
  });
});

describe('the header', () => {
  it('reads each field through a trailing comment', () => {
    const model = header('stub: a   # the plan', 'issue: OPT-1   # optional', 'spec: s.md');
    expect(model.header).toEqual({ stub: 'a', issue: 'OPT-1', spec: 's.md', release: null, extras: [] });
    expect(model.issues).toEqual([]);
  });

  it('retains a key it does not answer to, with its value, and acts on nothing', () => {
    const model = header('stub: a', 'tracker: linear', 'depth: 2');
    expect(model.header).toEqual({
      stub: 'a',
      issue: null,
      spec: null,
      release: null,
      extras: [
        { key: 'tracker', value: 'linear' },
        { key: 'depth', value: 2 },
      ],
    });
    expect(model.issues).toEqual([]);
  });

  it.each([
    ['an issue opening with # after a space, a YAML comment', 'issue', 'issue: #42', 'issue: "#42"', '#42'],
    ['an issue written as a number', 'issue', 'issue: 42', 'issue: "42"', '42'],
    ['an issue with a leading zero, the same number', 'issue', 'issue: 042', 'issue: "042"', '042'],
    ['a stub written as a boolean', 'stub', 'stub: true', 'stub: "true"', 'true'],
    ['a spec written as a list', 'spec', 'spec: [a, b]', 'spec: a', 'a'],
    ['a spec written as a mapping', 'spec', 'spec:\n  path: a', 'spec: a', 'a'],
    ['a blank spec', 'spec', 'spec: "  "', 'spec: " a "', ' a '],
    ['a stub no plan stamp can carry', 'stub', 'stub: my feature', 'stub: my-feature', 'my-feature'],
    ['a release level capitalised', 'release', 'release: Patch', 'release: patch', 'patch'],
    ['a release level that is no level', 'release', 'release: weekly', 'release: major', 'major'],
    ['a release level written as a number', 'release', 'release: 2', 'release: minor', 'minor'],
    ['a release level padded inside quotes', 'release', 'release: "  patch  "', 'release: patch', 'patch'],
  ] as const)('leaves the field null for %s, and reads the near miss', (_label, field, bad, good, value) => {
    const refused = header(bad);
    expect(refused.header[field]).toBeNull();
    expect(reasonsOf(refused)).toEqual([['unusable-field', 1]]);

    const read = header(good);
    expect(read.header[field]).toBe(value);
    expect(read.issues).toEqual([]);
  });

  it('says why an empty field is empty', () => {
    expect(header('issue: #42').issues[0]?.text).toContain('YAML comment unless quoted');
  });

  it('reads the other fields beside an unusable one', () => {
    const model = header('stub: my-feature', 'issue: 42', 'spec: s.md');
    expect(model.header).toEqual({ stub: 'my-feature', issue: null, spec: 's.md', release: null, extras: [] });
    expect(reasonsOf(model)).toEqual([['unusable-field', 1]]);
  });

  it.each([...PLAN_RELEASE_LEVELS])('reads release: %s as the level it spells, and nothing else', (level) => {
    const model = header(`release: ${level}`);
    expect(model.header.release).toBe(level);
    expect(model.header.extras).toEqual([]);
    expect(model.issues).toEqual([]);
  });

  it('tells a declared none from a plan that declares no release at all', () => {
    expect(header('release: none').header.release).toBe('none');
    expect(header('stub: a').header.release).toBeNull();
    expect(header('stub: a').issues).toEqual([]);
  });

  it('names the four levels when the release is not one of them', () => {
    expect(header('release: weekly').issues[0]?.text)
      .toBe('rafa:plan release is "weekly", not one of patch, minor, major, none');
    expect(header('release: 2').issues[0]?.text)
      .toBe('rafa:plan release is 2, not one of patch, minor, major, none');
  });

  it('reads the other fields beside an unusable release', () => {
    const model = header('stub: my-feature', 'release: weekly', 'spec: s.md');
    expect(model.header).toEqual({
      stub: 'my-feature',
      issue: null,
      spec: 's.md',
      release: null,
      extras: [],
    });
    expect(reasonsOf(model)).toEqual([['unusable-field', 1]]);
  });

  it('reports a body that is not YAML against the opening fence, and reads the near miss', () => {
    const model = parsePlan(doc('# Plan: x', '```rafa:plan', 'stub: [a', '```'));
    expect(model.header).toEqual({ stub: null, issue: null, spec: null, release: null, extras: [] });
    expect(reasonsOf(model)).toEqual([['malformed-header', 2]]);
    expect(model.issues[0]?.text).toContain('not valid YAML');
    expect(header('stub: a').header.stub).toBe('a');
  });

  it.each([
    ['a list', ['- stub', '- a']],
    ['a scalar', ['just words']],
    ['two documents', ['stub: a', '---', 'stub: b']],
  ])('reports a body holding %s, which is no mapping of fields', (_label, lines) => {
    const model = header(...lines);
    expect(model.header).toEqual({ stub: null, issue: null, spec: null, release: null, extras: [] });
    expect(reasonsOf(model)).toEqual([['malformed-header', 1]]);
  });

  it.each([
    ['no line', []],
    ['a comment alone', ['# nothing yet']],
    ['a blank line', ['']],
  ])('reads a body holding %s as a header that says nothing', (_label, lines) => {
    const model = header(...lines);
    expect(model.header).toEqual({ stub: null, issue: null, spec: null, release: null, extras: [] });
    expect(model.issues).toEqual([]);
    expect(model.blocks).toHaveLength(1);
  });

  it('reads the first of two rafa:plan blocks, and reports the second', () => {
    const model = parsePlan(doc('```rafa:plan', 'stub: first', '```', '```rafa:plan', 'stub: second', '```'));
    expect(model.header.stub).toBe('first');
    expect(reasonsOf(model)).toEqual([['duplicate-block', 4]]);
    expect(model.issues[0]?.text).toContain('repeats the one at line 1');
  });

  it('reads the first even when it is the malformed one', () => {
    const model = parsePlan(doc('```rafa:plan', 'stub: [a', '```', '```rafa:plan', 'stub: b', '```'));
    expect(model.header.stub).toBeNull();
    expect(reasonsOf(model)).toEqual([['malformed-header', 1], ['duplicate-block', 4]]);
  });

  it('reads no header from a kind spelled otherwise, and one from the near miss', () => {
    const shouted = parsePlan(doc('```rafa:Plan', 'stub: a', '```'));
    expect(shouted.header.stub).toBeNull();
    expect(shouted.issues).toEqual([]);
    expect(header('stub: a').header.stub).toBe('a');
  });

  it('characterization: lists integer-like extra keys first, as Object.entries does', () => {
    const model = header('zeta: z', '2: two', 'stub: a');
    expect(model.header.extras).toEqual([
      { key: '2', value: 'two' },
      { key: 'zeta', value: 'z' },
    ]);
  });
});

describe('the plan-wide context', () => {
  it('is the body of the rafa:context block, and null without one', () => {
    expect(parsePlan(doc('```rafa:context', 'c', '```')).context).toBe('c');
    expect(parsePlan(doc('# Stage: one', '- [ ] A')).context).toBeNull();
  });

  it('is plan-wide under a stage heading too, and binds to no stage', () => {
    const model = parsePlan(doc('# Stage: one', '```rafa:context', 'c', '```', '- [ ] A'));
    expect(model.context).toBe('c');
    expect(model.stages).toEqual([{ name: 'one', lineNum: 0, context: null }]);
    expect(model.issues).toEqual([]);
  });

  it('is empty for a block with no line in it, told apart from none', () => {
    expect(parsePlan(doc('```rafa:context', '```')).context).toBe('');
  });

  it('is the first of two blocks, and the second is reported', () => {
    const model = parsePlan(doc('```rafa:context', 'first', '```', '```rafa:context', 'second', '```'));
    expect(model.context).toBe('first');
    expect(reasonsOf(model)).toEqual([['duplicate-block', 4]]);
  });
});

describe('stages', () => {
  it('are read from # Stage: headings, each name trimmed', () => {
    const model = parsePlan(doc('# Plan: x', '# Stage:   spaced   ', '- [ ] A', '# Stage: two'));
    expect(model.stages).toEqual([
      { name: 'spaced', lineNum: 1, context: null },
      { name: 'two', lineNum: 3, context: null },
    ]);
  });

  it.each([
    ['a second-level heading', '## Stage: two'],
    ['no space after the colon', '# Stage:three'],
    ['an indented heading', ' # Stage: four'],
    ['a lower-case label', '# stage: five'],
  ])('are not read from %s, and are from the near miss', (_label, line) => {
    expect(parsePlan(doc(line, '- [ ] A')).stages).toEqual([]);
    expect(stageNamesOf(parsePlan(doc('# Stage: one', '- [ ] A')))).toEqual(['one']);
  });

  it('own each task below them, and none owns a task above the first', () => {
    const model = parsePlan(doc('- [ ] Early', '# Stage: one', '- [ ] A', '# Stage: two', '- [ ] B'));
    expect(model.tasks.map((task) => [task.text, task.stage])).toEqual([
      ['Early', null],
      ['A', 0],
      ['B', 1],
    ]);
  });

  it('own the stage context below them, before their tasks or after them', () => {
    const model = parsePlan(doc(
      '# Stage: one',
      '```rafa:stage-context',
      'before',
      '```',
      '- [ ] A',
      '# Stage: two',
      '- [ ] B',
      '```rafa:stage-context',
      'after',
      '```',
      '# Stage: three',
      '- [ ] C',
    ));
    expect(model.stages.map((stage) => stage.context)).toEqual(['before', 'after', null]);
    expect(model.context).toBeNull();
    expect(model.issues).toEqual([]);
  });

  it('read the first stage context of two, and report the second by stage', () => {
    const model = parsePlan(doc(
      '# Stage: one',
      '```rafa:stage-context',
      'first',
      '```',
      '```rafa:stage-context',
      'second',
      '```',
      '# Stage: two',
      '```rafa:stage-context',
      'own',
      '```',
    ));
    expect(model.stages.map((stage) => stage.context)).toEqual(['first', 'own']);
    expect(reasonsOf(model)).toEqual([['duplicate-block', 5]]);
    expect(model.issues[0]?.text).toContain('under # Stage: one');
  });

  it('are not read from a heading inside a rafa block, and are from one outside it', () => {
    const model = parsePlan(doc('```rafa:context', '# Stage: quoted', '```', '# Stage: real'));
    expect(stageNamesOf(model)).toEqual(['real']);
    expect(model.context).toBe('# Stage: quoted');
  });

  it('are read fence-blind from inside any other fence', () => {
    expect(stageNamesOf(parsePlan(doc('```markdown', '# Stage: illustrated', '```')))).toEqual([
      'illustrated',
    ]);
  });
});

describe('a stage context above every stage heading', () => {
  it('belongs to no stage and is reported, and binds once a heading precedes it', () => {
    const orphan = parsePlan(doc('```rafa:stage-context', 'early', '```', '# Stage: one', '- [ ] A'));
    expect(orphan.stages).toEqual([{ name: 'one', lineNum: 3, context: null }]);
    expect(orphan.context).toBeNull();
    expect(reasonsOf(orphan)).toEqual([['orphan-stage-context', 1]]);

    const bound = parsePlan(doc('# Stage: one', '```rafa:stage-context', 'early', '```', '- [ ] A'));
    expect(bound.stages).toEqual([{ name: 'one', lineNum: 0, context: 'early' }]);
    expect(bound.issues).toEqual([]);
  });
});

describe('a block never closed', () => {
  it('is reported, is not read, and takes every line after its fence from the model alone', () => {
    const unclosed = doc('```rafa:context', 'c', '# Stage: one', '- [ ] Swallowed');
    const model = parsePlan(unclosed);
    expect(model.context).toBeNull();
    expect(model.stages).toEqual([]);
    expect(model.tasks).toEqual([]);
    expect(reasonsOf(model)).toEqual([['unclosed-block', 1], ['task-in-block', 4]]);
    expect(model.issues[1]?.text).toContain('findNextTask still dispatches it');
    expect(findNextTask(unclosed)).toMatchObject({ task: 'Swallowed', lineNum: 3 });
  });

  it('answers the still-to-run lines it hides, read as a line outside every block is read', () => {
    const unclosed = doc(
      '# Stage: one',
      '- [ ] Open, and read',
      '```rafa:context',
      'c',
      '# Stage: swallowed',
      '- [ ] Hidden  {agent=tdd-guide}',
      '- [BLOCKED] Hidden and blocked  <!-- blocked: the gate -->',
      '- [x] Hidden and ticked',
    );
    const model = parsePlan(unclosed);

    expect(textsOf(model)).toEqual(['Open, and read']);
    expect(model.hiddenTasks.map((task) => [task.text, task.lineNum, task.status, task.stage])).toEqual([
      ['Hidden', 5, 'unchecked', 0],
      ['Hidden and blocked', 6, 'blocked', 0],
    ]);
    expect(model.hiddenTasks[0]?.declaration?.agent).toBe('tdd-guide');
    // The dispatcher over the same document: the blocked hidden line, at the same number.
    expect(findNextTask(unclosed)).toMatchObject({ task: 'Hidden and blocked', lineNum: 6, status: 'blocked' });
  });

  it('hides nothing once closed, where the same line is a task of the model, the near miss', () => {
    const closed = doc('# Stage: one', '```rafa:context', 'c', '```', '- [ ] Hidden  {agent=tdd-guide}');
    const model = parsePlan(closed);

    expect(model.hiddenTasks).toEqual([]);
    expect(textsOf(model)).toEqual(['Hidden']);
  });

  it('hides nothing a CLOSED block holds, which the dispatcher skips rather than runs', () => {
    const quoted = doc('```rafa:context', '- [ ] Quoted  {agent=tdd-guide}', '```', '- [ ] Planned');
    const model = parsePlan(quoted);

    expect(reasonsOf(model)).toEqual([['task-in-block', 2]]);
    expect(model.hiddenTasks).toEqual([]);
    expect(findNextTask(quoted)).toMatchObject({ task: 'Planned', lineNum: 3 });
  });

  it('reads everything once closed, the near miss', () => {
    const model = parsePlan(doc('```rafa:context', 'c', '```', '# Stage: one', '- [ ] Swallowed'));
    expect(model.context).toBe('c');
    expect(stageNamesOf(model)).toEqual(['one']);
    expect(textsOf(model)).toEqual(['Swallowed']);
    expect(model.issues).toEqual([]);
  });

  it('is reported whatever its kind', () => {
    const model = parsePlan(doc('- [ ] A', '```rafa:future-thing', 'x'));
    expect(reasonsOf(model)).toEqual([['unclosed-block', 2]]);
    expect(textsOf(model)).toEqual(['A']);
  });

  it('reads no header from an unclosed rafa:plan', () => {
    const model = parsePlan(doc('```rafa:plan', 'stub: a'));
    expect(model.header.stub).toBeNull();
    expect(reasonsOf(model)).toEqual([['unclosed-block', 1]]);
  });
});

describe('a block of a kind a plan does not read', () => {
  const text = doc(
    '```rafa:future-thing',
    'anything: [not yaml',
    '```',
    '```rafa:report',
    'status: done',
    '```',
    '```rafa:future-thing',
    'again',
    '```',
    '```rafa:Plan',
    'stub: shouted',
    '```',
  );

  it('is retained in place and ignored, twice over with no duplicate reported', () => {
    const model = parsePlan(text);
    expect(model.blocks.map((block) => block.kind)).toEqual([
      'future-thing',
      'report',
      'future-thing',
      'Plan',
    ]);
    expect(model.header.stub).toBeNull();
    expect(model.context).toBeNull();
    expect(model.issues).toEqual([]);
  });

  it('is read once it is a plan kind, the near miss', () => {
    const model = parsePlan(text.replace('rafa:Plan', 'rafa:plan'));
    expect(model.header.stub).toBe('shouted');
  });
});

describe('issues', () => {
  it('are ordered by line, whichever pass found them', () => {
    const model = parsePlan(doc(
      '```rafa:stage-context',
      'orphan',
      '```',
      '```rafa:plan',
      'issue: 42',
      '```',
      '# Stage: one',
      '```rafa:context',
      '- [ ] quoted',
      '```',
      '```rafa:context',
      'second',
      '```',
    ));
    expect(reasonsOf(model)).toEqual([
      ['orphan-stage-context', 1],
      ['unusable-field', 4],
      ['task-in-block', 9],
      ['duplicate-block', 11],
    ]);
  });
});

describe('a real plan file on disk', () => {
  /**
   * This phase's own plan, read from `.plans/`, not a fixture. It is
   * the frozen template the loop dispatches from — `PLAN_TRACKER-*.md`
   * is the copy its ticks land on — so its stage set, task count and
   * declarations hold still for the run and are pinned here as
   * measured, the same way `PLAN_LINES` above is written by hand. Per
   * the module note, none of this repo's plans carry a `rafa:*` block
   * yet, so this exercises the checklist grammar only; `blocks.test.ts`
   * and the cases above cover the block reader itself.
   */
  const PATH = join(fileURLToPath(new URL('../../', import.meta.url)), '.plans/PLAN-phase-0-package-parity-cutover.md');
  const model = parsePlan(readFileSync(PATH, 'utf8'));

  it('reads no rafa:* block and reports nothing, so the checklist alone is under test', () => {
    expect(model.header).toEqual({ stub: null, issue: null, spec: null, release: null, extras: [] });
    expect(model.context).toBeNull();
    expect(model.blocks).toEqual([]);
    expect(model.issues).toEqual([]);
  });

  it('reads every stage heading, in source order', () => {
    expect(stageNamesOf(model)).toEqual([
      'Bootstrap the routing surface',
      'Import the sibling loop',
      'Store port',
      'Reconciled schema',
      'Parity',
      'Structured plan format',
      'Structured task report',
      'Package and cutover',
    ]);
  });

  it('counts the tasks under each stage, totalling the 62 tasks the plan states', () => {
    const counts = model.stages.map(
      (_, index) => model.tasks.filter((task) => task.stage === index).length,
    );
    expect(counts).toEqual([1, 12, 9, 3, 4, 12, 13, 8]);
    expect(model.tasks).toHaveLength(62);
    expect(counts.reduce((sum, count) => sum + count, 0)).toBe(model.tasks.length);
  });

  it('resolves every task declaration to a flag combination, histogrammed', () => {
    expect(declarationHistogram(model)).toEqual([
      [['--agent', 'build-error-resolver'], 4],
      [['--agent', 'code-reviewer'], 1],
      [['--agent', 'doc-updater'], 6],
      [['--agent', 'loop-implementer'], 24],
      [['--agent', 'refactor-cleaner'], 2],
      [['--agent', 'tdd-guide'], 13],
      [['--agent', 'typescript-reviewer'], 1],
      [['--model', 'haiku', '--effort', 'low', '--tools', 'Read,Edit,Bash,Grep,Glob'], 3],
      [['--model', 'haiku', '--effort', 'low', '--tools', 'Read,Write,Bash,Grep,Glob'], 1],
      [['--model', 'sonnet', '--effort', 'medium', '--tools', 'Read,Edit,Bash,Grep,Glob'], 2],
      [['--model', 'sonnet', '--effort', 'medium', '--tools', 'Read,Write,Bash,Grep,Glob'], 3],
      [['--model', 'sonnet', '--effort', 'medium', '--tools', 'Read,Write,Edit,Bash,Grep,Glob'], 2],
    ]);

    // Every task on this plan declares something, and no agent task's
    // other keys are suppressed, because none pairs `agent=` with
    // `model=`, `effort=` or `tools=`.
    expect(model.tasks.every((task) => task.declaration !== null)).toBe(true);
    expect(model.tasks.every((task) => resolveDeclarationFlags(task.declaration, NO_OWN_EFFORT).suppressed.length === 0)).toBe(true);
  });
});
