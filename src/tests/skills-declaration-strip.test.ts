/**
 * `skills=` measured over a planted plan, dispatch to commit.
 *
 * `utils/declaration.test.ts` measures the grammar in isolation:
 * `{skills=a}` alone is a declaration, and a `skills=` value that parses
 * lands on {@link TaskDeclaration.skills} rather than a flag. This file
 * measures the CLAIM those unit cases cannot: that a `skills=` block
 * dispatched through the real door never reaches a session, an operator
 * or a commit, while the plan model still answers for it.
 *
 * Two tasks, planted in one fixture plan and dispatched through the real
 * `dispatchTask` and `commitFinishedTask` `declaration-dispatch.test.ts`
 * already drives its wider table through.
 *
 *   - A task naming `{skills=a}` alone. Its block carries no other
 *     recognised key, so it is the control for the grammar rule
 *     `utils/declaration.ts` states: a block holding only `skills=` is
 *     read as a declaration and not as task text, even though `skills`
 *     itself resolves to no flag. Its dispatch carries no `--agent`,
 *     `--model`, `--effort`, `--budget` or `--tools` — nothing at all
 *     past the base arguments — because nothing else was named.
 *   - A task naming `{agent=doc-updater skills=b}`. Its `agent` reaches
 *     the spawn as `--agent doc-updater`. Its `skills` reaches nowhere a
 *     session or an operator would read: not the prompt the session
 *     runs under, not the line announcing the task, not the line
 *     announcing its routing, and not the sentence the commit derives
 *     its subject from. `parsePlan`, reading the same plan text, still
 *     answers `['b']` for it — the record a later phase's planner
 *     reads is not the record a session or a commit ever sees.
 *
 * Both dispatches run under `inject: 'task'` rather than `full`, which
 * `plan/inject.ts` renders from `parsePlan`'s own model and never from
 * the document's bytes: the dispatched task's OWN line is the only task
 * line the rendering carries, and that line is built from `PlanTask.text`,
 * a declaration already off. So the captured prompt this file asserts
 * against is not merely the injected head `declaration-dispatch.test.ts`
 * checks — under `task` mode the WHOLE prompt is free of `skills=`,
 * because no share of the plan the session reads carries a block at all.
 * That is what lets `not.toContain('skills')` stand for the whole string
 * rather than for one line of it.
 */
import type { ClaudeSpawner } from '../utils/claude.js';
import type { CommitAttempt, CommitOptions } from '../utils/commit.js';
import type { TaskInfo } from '../utils/tracker.js';

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from 'bun:test';

import { setActiveOutput } from '../adapters/output/active.js';
import { parsePlan } from '../plan/parse.js';
import { commitFinishedTask } from '../start/commit.js';
import { dispatchTask } from '../start/dispatch.js';
import { setActivePlanStub } from '../start/stamp.js';
import { runClaude } from '../utils/claude.js';

import { sinkOutput } from './output-sinks.js';

/** The two spaces a tracker line puts between text and block. */
const GAP = '  ';

/** Zero-indexed line the first task sits on in the fixture plan. */
const FIRST_TASK_LINE = 4;

/** The sentence a `skills=` alone task carries. */
const SKILLS_ONLY_TEXT = 'Port the migration script to bun:test';

/** Its block, naming no key but `skills`. */
const SKILLS_ONLY_BLOCK = '{skills=a}';

/** The sentence an `agent=` plus `skills=` task carries. */
const ROUTED_TEXT = 'Add authentication middleware to the API gateway';

/** Its block, naming both keys. */
const ROUTED_BLOCK = '{agent=doc-updater skills=b}';

/** Index of `SKILLS_ONLY_TEXT` among the plan's open tasks. */
const SKILLS_ONLY_INDEX = 0;

/** Index of `ROUTED_TEXT` among the plan's open tasks. */
const ROUTED_INDEX = 1;

/** One line as the plan writes it, checkbox off. */
function lineTextOf(text: string, block: string): string {
  return `${text}${GAP}${block}`;
}

/** The whole fixture plan: one stage, two declared tasks. */
const PLAN_CONTENT = [
  '# Plan: a throwaway plan',
  '',
  '# Stage: One',
  '',
  `- [ ] ${lineTextOf(SKILLS_ONLY_TEXT, SKILLS_ONLY_BLOCK)}`,
  `- [ ] ${lineTextOf(ROUTED_TEXT, ROUTED_BLOCK)}`,
  '',
].join('\n');

/** A stand-in for `PROMPT.md`, read once before the loop. */
const PROMPT_CONTENT = 'Always read `@progress.txt` in full before starting the task.';

/** The task as `findNextTask` would hand it over, block included. */
function taskInfoFor(
  text: string,
  block: string,
  index: number,
  status: TaskInfo['status'] = 'unchecked',
): TaskInfo {
  return {
    task: lineTextOf(text, block),
    lineNum: FIRST_TASK_LINE + index,
    status,
  };
}

/** One spawn the loop asked for, recorded rather than run. */
interface SpawnCall {
  args: readonly string[];
  prompt: string;
}

const tempRoot = mkdtempSync(join(tmpdir(), 'ralph-skills-strip-'));

afterAll(() => {
  rmSync(tempRoot, { recursive: true, force: true });
});

/** Writes a tracker where the loop keeps one, and answers its path. */
function plantTracker(content: string): string {
  const dir = join(tempRoot, '.plans');
  mkdirSync(dir, { recursive: true });
  const trackerPath = join(dir, 'PLAN_TRACKER-throwaway.md');
  writeFileSync(trackerPath, content, 'utf8');
  return trackerPath;
}

/** Lines the dispatch reported to the operator. */
let logs: string[] = [];

/** Lines it reported as a problem. */
let warnings: string[] = [];

beforeEach(() => {
  logs = [];
  warnings = [];
  // No other file's stub survives into a prompt this file asserts holds
  // no brace at all.
  setActivePlanStub(null);
  setActiveOutput(sinkOutput({
    info: (message) => {
      logs.push(message);
    },
    warn: (message) => {
      warnings.push(message);
    },
  }));
});

afterEach(() => {
  setActiveOutput(null);
  setActivePlanStub(null);
});

/** The one announced line carrying `marker`, or the empty string. */
function announced(marker: string): string {
  return logs.find((line) => line.includes(marker)) ?? '';
}

/**
 * Dispatches one planted task through the real CLI door, under `task`
 * injection so the prompt carries no share of the plan but that task's
 * own declaration-stripped line. Roots hold no agent definitions, so
 * `agent=doc-updater` always resolves to a session, never to a
 * definition this file would have to plant.
 */
async function dispatchPlanted(taskInfo: TaskInfo) {
  const calls: SpawnCall[] = [];
  const spawn: ClaudeSpawner = (args, prompt) => {
    calls.push({ args: [...args], prompt });
    return Promise.resolve(0);
  };

  const result = await dispatchTask({
    taskInfo,
    promptContent: PROMPT_CONTENT,
    planContent: PLAN_CONTENT,
    inject: 'task',
    repoRoot: join(tempRoot, 'repo'),
    home: join(tempRoot, 'home'),
    settingSources: ['project', 'local'],
    serving: null,
    run: async (prompt, flags, _sessionId, settingSources) => {
      const exitCode = await runClaude(prompt, settingSources, flags, spawn);
      return { exitCode, stdout: '' };
    },
  });

  return { result, calls };
}

describe('a task naming skills= alone', () => {
  it('is dispatched as a declaration carrying no flag', async () => {
    const taskInfo = taskInfoFor(SKILLS_ONLY_TEXT, SKILLS_ONLY_BLOCK, SKILLS_ONLY_INDEX);
    const { result, calls } = await dispatchPlanted(taskInfo);

    // The block is a declaration, not task text: it comes off, and its
    // one key is retained on the record even though it maps to no flag.
    expect(result.declaration).not.toBeNull();
    expect(result.declaration?.skills).toEqual(['a']);
    expect(result.declaration?.agent).toBeNull();
    expect(result.declaration?.issues).toEqual([]);
    expect(result.taskText).toBe(SKILLS_ONLY_TEXT);

    // Nothing named a flag, so nothing but the base arguments is spawned.
    expect(result.flags).toEqual([]);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.args).toEqual([
      '-p',
      '--dangerously-skip-permissions',
      '--setting-sources',
      'project,local',
    ]);

    // A block whose one key maps to no flag still announces no routing.
    expect(announced('Routed as: ')).toBe('');
    expect(warnings).toEqual([]);
    expect(result.prompt).not.toContain('skills');
    expect(result.prompt).not.toContain('{');
  });
});

describe('a task naming agent= and skills= together', () => {
  it('keeps skills off the prompt, the log and the commit, parsePlan retaining it', async () => {
    const taskInfo = taskInfoFor(ROUTED_TEXT, ROUTED_BLOCK, ROUTED_INDEX);
    const { result, calls } = await dispatchPlanted(taskInfo);

    // The record itself carries both keys off the same block.
    expect(result.declaration?.agent).toBe('doc-updater');
    expect(result.declaration?.skills).toEqual(['b']);

    // `agent` reaches the spawn. `skills` reaches no flag at all, under
    // any block (`utils/declaration.ts`), so the argument list carries
    // no trace of it either.
    expect(result.flags).toEqual(['--agent', 'doc-updater']);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.args).toEqual([
      '-p',
      '--dangerously-skip-permissions',
      '--setting-sources',
      'project,local',
      '--agent',
      'doc-updater',
    ]);
    for (const arg of calls[0]?.args ?? []) expect(arg).not.toContain('skills');

    // The captured prompt: under `task` injection the whole string is
    // free of the block, not merely the injected head.
    expect(result.prompt).not.toContain('skills');
    expect(result.prompt).not.toContain(ROUTED_BLOCK);

    // The two lines the operator reads.
    const executing = announced('Executing task: ');
    const routed = announced('Routed as: ');
    expect(executing.endsWith(`Executing task: ${ROUTED_TEXT}`)).toBe(true);
    expect(executing).not.toContain('skills');
    expect(routed).toContain('--agent doc-updater');
    expect(routed).not.toContain('skills');
    expect(warnings).toEqual([]);

    // The commit: a subject is derived from the text the runner is
    // handed, so a `skills=` riding along would reach the git history.
    const trackerPath = plantTracker(PLAN_CONTENT);
    const seen: CommitOptions[] = [];
    const cleanAttempt: CommitAttempt = {
      outcome: 'nothing-to-commit',
      subject: 'chore: a subject the stub derived for itself',
      sha: null,
      failedStep: null,
      exitCode: 0,
      message: '',
    };
    commitFinishedTask({
      trackerPath,
      taskInfo,
      repoRoot: tempRoot,
      commit: (options) => {
        seen.push(options);
        return cleanAttempt;
      },
    });

    expect(seen).toHaveLength(1);
    expect(seen[0]?.taskText).toBe(ROUTED_TEXT);
    expect(seen[0]?.taskText).not.toContain('skills');

    // `parsePlan`, reading the same plan text, retains it all the same:
    // the record a later phase's planner reads is not the record a
    // session, an operator or a commit ever sees.
    const parsedFromPlan = parsePlan(PLAN_CONTENT).tasks[ROUTED_INDEX];
    expect(parsedFromPlan?.text).toBe(ROUTED_TEXT);
    expect(parsedFromPlan?.declaration?.skills).toEqual(['b']);
    expect(parsedFromPlan?.declaration?.agent).toBe('doc-updater');

    // The tracker the commit just ticked keeps the block on the line
    // (the tracker is copied from the plan once, so nothing would put
    // it back), and `parsePlan` retains `skills` reading it too.
    const trackerContent = await Bun.file(trackerPath).text();
    const parsedFromTracker = parsePlan(trackerContent).tasks[ROUTED_INDEX];
    expect(trackerContent.split('\n')[taskInfo.lineNum])
      .toBe(`- [x] ${lineTextOf(ROUTED_TEXT, ROUTED_BLOCK)}`);
    expect(parsedFromTracker?.declaration?.skills).toEqual(['b']);
  });
});
