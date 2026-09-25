/**
 * Tests for turning a recorded task report's findings into the lessons
 * its session pushes.
 *
 * Each record is a real one: a whole session output, recorded by
 * `recordTaskReport` under a fresh temporary repo root. Two cases push
 * the payload through the `local` adapter and read the written `.md`
 * back through `parseInstinct`, so what is checked is that the lesson
 * can be held, not only that its fields look right.
 *
 * Two mutations of `lessons.ts` were driven against this file, the
 * module restored sha1-identical after each: an absent cause written as
 * empty rather than as the `what` (2 of the 18 cases red, one of them
 * the adapter refusing the push), and a blocked task given the ordinary
 * confidence (1).
 */
import type { LessonContext } from './lessons.js';
import type { TaskReportRecord } from './record.js';
import type { DescribedInstinctRecord } from '../adapters/learning/local.js';

import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { createLocalLearning } from '../adapters/learning/local.js';
import { actionHash } from '../learning/index.js';
import { parseInstinct } from '../schema/instinct.js';

import {
  BLOCKED_LESSON_CONFIDENCE,
  DEFAULT_LESSON_DOMAIN,
  LESSON_CONFIDENCE,
  lessonId,
  reportLessons,
} from './lessons.js';
import { recordTaskReport } from './record.js';

const roots: string[] = [];

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

/** A fresh temporary directory, removed after the file. */
function freshDir(): string {
  const root = mkdtempSync(join(tmpdir(), 'rafa-lessons-'));
  roots.push(root);
  return root;
}

const NOW = new Date('2026-09-25T10:00:00.000Z');

/** The dispatch and outcome a case records under. */
function context(outcome: LessonContext['outcome'] = 'done', planStub: string | null = 'rafa-25'): LessonContext {
  return {
    dispatch: { sessionId: 'session-1', planStub, taskLine: 'Add the lessons module' },
    outcome,
  };
}

/** A session output ending with a report whose findings are `findings`. */
function output(findings: string): string {
  return [
    'Done.',
    '',
    '```rafa:report',
    'status: done',
    'findings:',
    findings,
    '```',
    '',
  ].join('\n');
}

const RESOLVED = [
  '  - trigger: "when running bun test under a fresh worktree"',
  '    kind: gotcha',
  '    what: "node_modules is absent after fork"',
  '    cause: "worktree creation does not run bun install"',
  '    resolution: "run bun install before the first test"',
  '    artifact: "Cannot find package"',
  '    signal: loud',
].join('\n');

const UNRESOLVED = [
  '  - trigger: "when reading the plan"',
  '    kind: location',
  '    what: "the checklist lives under Stages"',
  '    signal: silent',
].join('\n');

/** `text` recorded under a fresh root with `ctx`. */
function recorded(text: string, ctx: LessonContext = context()): TaskReportRecord {
  return recordTaskReport(freshDir(), { ...ctx, output: text });
}

/** The payload's only lesson, as the adapter reads it. */
function onlyLesson(record: TaskReportRecord, ctx: LessonContext = context()): DescribedInstinctRecord {
  const payload = reportLessons(record, ctx, NOW);
  expect(payload?.instincts).toHaveLength(1);
  return payload?.instincts[0] as DescribedInstinctRecord;
}

describe('reportLessons', () => {
  it('turns a finding with a resolution into a task-report lesson', () => {
    const payload = reportLessons(recorded(output(RESOLVED)), context(), NOW);

    const trigger = 'when running bun test under a fresh worktree';
    const action = 'run bun install before the first test';
    const lesson: DescribedInstinctRecord = {
      id: lessonId(trigger, action),
      trigger,
      action,
      action_hash: actionHash(action),
      confidence: LESSON_CONFIDENCE,
      usage_count: 1,
      sources: ['session-1'],
      artifact: 'Cannot find package',
      signal: 'loud',
      status: 'active',
      created_at: NOW.toISOString(),
      updated_at: NOW.toISOString(),
      description: {
        kind: 'gotcha',
        domain: DEFAULT_LESSON_DOMAIN,
        scope: 'project',
        source: 'task-report',
        evidence: [{
          plan: 'rafa-25',
          task: 'Add the lessons module',
          session: 'session-1',
          outcome: 'done',
        }],
        cause: 'worktree creation does not run bun install',
        projectId: null,
      },
    };
    expect(payload).toEqual({ source_id: 'session-1', instincts: [lesson] });
    expect(LESSON_CONFIDENCE).toBe(0.5);
    expect(DEFAULT_LESSON_DOMAIN).toBe('workflow');
  });

  it('makes nothing of a finding without a resolution', () => {
    expect(reportLessons(recorded(output(UNRESOLVED)), context(), NOW)).toBeNull();
  });

  it('keeps only the resolved findings of a mixed report, in order', () => {
    const payload = reportLessons(recorded(output(`${UNRESOLVED}\n${RESOLVED}`)), context(), NOW);

    expect(payload?.instincts.map((lesson) => lesson.trigger)).toEqual([
      'when running bun test under a fresh worktree',
    ]);
  });

  it('lowers the confidence to 0.4 when the loop ended the task blocked', () => {
    const ctx = context('blocked');
    const lesson = onlyLesson(recorded(output(RESOLVED), ctx), ctx);

    expect(BLOCKED_LESSON_CONFIDENCE).toBe(0.4);
    expect(lesson.confidence).toBe(BLOCKED_LESSON_CONFIDENCE);
    expect(lesson.description?.evidence[0]?.['outcome']).toBe('blocked');
  });

  it('keeps the ordinary confidence for a failed task', () => {
    const ctx = context('failed');

    expect(onlyLesson(recorded(output(RESOLVED), ctx), ctx).confidence).toBe(LESSON_CONFIDENCE);
  });

  it('takes the finding\'s own domain over the default', () => {
    const lesson = onlyLesson(recorded(output(`${RESOLVED}\n    domain: testing`)));

    expect(lesson.description?.domain).toBe('testing');
  });

  it('leaves the plan out of the evidence when the dispatch resolved none', () => {
    const ctx = context('done', null);
    const lesson = onlyLesson(recorded(output(RESOLVED), ctx), ctx);

    expect(lesson.description?.evidence).toEqual([{
      task: 'Add the lessons module',
      session: 'session-1',
      outcome: 'done',
    }]);
  });

  it('leaves the artifact out when the finding gave none', () => {
    const text = output(RESOLVED.replace('    artifact: "Cannot find package"\n', ''));

    expect(onlyLesson(recorded(text))).not.toHaveProperty('artifact');
  });

  it('falls back to the finding\'s what when it gave no cause', () => {
    const text = output(RESOLVED.replace('    cause: "worktree creation does not run bun install"\n', ''));

    expect(onlyLesson(recorded(text)).description?.cause).toBe('node_modules is absent after fork');
  });

  it('skips a resolved finding the parser left without a signal', () => {
    const text = output(RESOLVED.replace('    signal: loud', ''));

    expect(reportLessons(recorded(text), context(), NOW)).toBeNull();
  });

  it('answers null for an output that held no report', () => {
    const record = recorded('No report here.\n');

    expect(record.present).toBe(false);
    expect(reportLessons(record, context(), NOW)).toBeNull();
  });
});

describe('lessonId', () => {
  it('is a slug of the trigger and a hash of the trigger and action', () => {
    expect(lessonId('When running bun test!', 'run bun install')).toMatch(
      /^when-running-bun-test-[0-9a-f]{8}$/,
    );
  });

  it('is the same for the same lesson written differently', () => {
    expect(lessonId('When  running bun test', ' Run bun install '))
      .toBe(lessonId('when running bun test', 'run bun install'));
  });

  it('differs for two actions on one trigger', () => {
    expect(lessonId('when running bun test', 'run bun install'))
      .not.toBe(lessonId('when running bun test', 'delete node_modules'));
  });

  it('cuts a long trigger without leaving a trailing hyphen', () => {
    const id = lessonId(`${'a'.repeat(47)} ${'b'.repeat(20)}`, 'act');

    expect(id).toMatch(/^a{47}-[0-9a-f]{8}$/);
  });

  it('falls back to a fixed slug for a trigger with no letter or digit', () => {
    expect(lessonId('!!!', 'act')).toMatch(/^lesson-[0-9a-f]{8}$/);
  });
});

describe('a lesson pushed to the local adapter', () => {
  /** Pushes `record`'s lessons into a fresh held set and parses each file written. */
  async function pushAndRead(record: TaskReportRecord): Promise<ReturnType<typeof parseInstinct>[]> {
    const payload = reportLessons(record, context(), NOW);
    if (payload === null) throw new Error('expected a payload');
    const instinctsDir = join(freshDir(), 'instincts');
    const learning = createLocalLearning({
      instinctsDir,
      home: freshDir(),
      minConfidence: 0.5,
      now: () => NOW.toISOString(),
      warn: () => {},
    });
    await learning.push(payload);
    return readdirSync(instinctsDir)
      .filter((name) => name.endsWith('.md'))
      .map((name) => parseInstinct(readFileSync(join(instinctsDir, name), 'utf8')));
  }

  it('is written as a record the schema accepts', async () => {
    const [parsed, ...rest] = await pushAndRead(recorded(output(RESOLVED)));

    expect(rest).toEqual([]);
    expect(parsed?.issues).toEqual([]);
    expect(parsed?.instinct?.source).toBe('task-report');
    expect(parsed?.instinct?.scope).toBe('project');
  });

  it('is written with the what as its cause when the finding gave no cause', async () => {
    const text = output(RESOLVED.replace('    cause: "worktree creation does not run bun install"\n', ''));
    const [parsed] = await pushAndRead(recorded(text));

    expect(parsed?.issues).toEqual([]);
    expect(parsed?.instinct?.cause).toBe('node_modules is absent after fork');
  });
});
