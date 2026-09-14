/**
 * A `rafa:*` block, proven absent from every place a task is quoted
 * back: the prompt header, the operator's log line, the commit subject
 * and the commit body.
 *
 * The strip rule lives at the SOURCE, `findNextTask`
 * (`utils/tracker.ts`): a task line inside a closed `rafa:*` block is
 * never answered as a task at all, so none of the four sites needs a
 * strip of its own — they all quote whatever `taskInfo.task` already
 * is. That also means a caller that built a `TaskInfo` some other way
 * would bypass the rule entirely, which is the gap this file guards
 * against: it drives a real `TaskInfo`, read off a plan that plants a
 * `rafa:context` and a `rafa:stage-context` block, through the real
 * `dispatchTask` and `commitFinishedTask`, with only the session spawn
 * stubbed and the commit made against a real repository — so what is
 * asserted absent is what the operator's terminal and the git history
 * would actually have shown.
 *
 * Every absence here is paired with a control proving the fixture
 * really carries the block, so a passing case is a strip and not an
 * empty plan agreeing with itself. And the commit body is the whole
 * task sentence whatever the subject kept of it, so the body is
 * asserted equal to that sentence before its absence is read —
 * otherwise an absence assertion on an empty body would pass
 * vacuously.
 */
import type { TaskSessionRunner } from '../start/dispatch.js';
import type { TaskInfo } from '../utils/tracker.js';

import { execFileSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  mock,
  spyOn,
} from 'bun:test';

import { commitFinishedTask } from '../start/commit.js';
import { dispatchTask } from '../start/dispatch.js';
import { buildCommitMessage, MAX_SUBJECT_LENGTH } from '../utils/commit.js';
import { findNextTask } from '../utils/tracker.js';

/** A fence, kept out of the template literals. */
const FENCE = '```';

/** What a `rafa:*` block carries, distinctive enough to grep for. */
const BLOCK_MARKER = 'RAFA-BLOCK-MARKER: never quoted back to a task';

/**
 * The task sentence, 165 characters normalised, with its first comma
 * at index 108: the subject quotes a part of it and only the body
 * carries the whole, which is what the body assertions below read.
 */
const TASK_TEXT = [
  'Add the strip-proof test that plants a rafa block into a plan and',
  'asserts it never reaches the prompt header, the operator log, the',
  'commit subject or the commit body',
].join(' ');

/**
 * A plan whose plan-wide context and one stage's context both write
 * the marker as a CHECKLIST LINE — `- [ ] <marker>` — rather than as
 * plain prose. That is what makes this fixture strip-proof rather than
 * merely non-overlapping with the real task: a block whose body is
 * never mistaken for a checklist line would pass every assertion below
 * whether or not the exclusion in `findNextTask` still worked, because
 * nothing inside it could ever have been dispatched in the first
 * place. Written as a checklist line, the marker is exactly what
 * `findNextTask` would answer FIRST, ahead of the real task, if that
 * exclusion ever regressed.
 */
const PLAN = [
  '# Plan: a strip-proof fixture',
  '',
  `${FENCE}rafa:context`,
  `- [ ] ${BLOCK_MARKER}`,
  FENCE,
  '',
  '# Stage: One',
  '',
  `${FENCE}rafa:stage-context`,
  `- [ ] ${BLOCK_MARKER}`,
  FENCE,
  '',
  `- [ ] ${TASK_TEXT}`,
  '',
].join('\n');

/** A stand-in for `PROMPT.md`, read once before the loop. */
const PROMPT_CONTENT = 'The loop stages and commits on your behalf.';

/** The first line of a prompt, which is the line the loop wrote. */
function headOf(prompt: string): string {
  return prompt.split('\n')[0] ?? '';
}

/**
 * The task `findNextTask` answers over `content`. Throws rather than
 * answering null, so a fixture that stopped carrying an open task is a
 * red case and not a silently skipped one.
 */
function taskOrThrow(content: string): TaskInfo {
  const info = findNextTask(content);
  if (info === null) throw new Error('fixture carries no task');
  return info;
}

/** Lines the loop reported to the operator. */
let logs: string[] = [];

/**
 * Captures what the loop printed, through a spy on `console`: bun:test
 * replaces the console object, so a `process.stdout.write` patch would
 * read nothing and every absence assertion below would pass against a
 * loop that announced the block in full.
 */
beforeEach(() => {
  logs = [];
  spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    logs.push(args.map(String).join(' '));
  });
  spyOn(console, 'warn').mockImplementation(() => {});
  spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  mock.restore();
});

describe('a task dispatched from a plan carrying rafa:* blocks', () => {
  it('finds the task text alone, both blocks excluded', () => {
    const taskInfo = taskOrThrow(PLAN);

    expect(taskInfo.task).toBe(TASK_TEXT);
    expect(taskInfo.task).not.toContain(BLOCK_MARKER);

    // The control: the plan really carries the marker, twice, so the
    // exclusion above is a strip and not an empty fixture.
    expect(PLAN.split(BLOCK_MARKER).length - 1).toBe(2);
  });

  it('keeps the block out of the prompt head and the log line', async () => {
    const taskInfo = taskOrThrow(PLAN);
    const run: TaskSessionRunner = () => Promise.resolve({ exitCode: 0, stdout: '' });

    const result = await dispatchTask({
      taskInfo,
      promptContent: PROMPT_CONTENT,
      planContent: PLAN,
      inject: 'full',
      repoRoot: tempRoot,
      home: join(tempRoot, 'home'),
      settingSources: ['project', 'local'],
      run,
    });

    const head = headOf(result.prompt);
    expect(head).toBe(`Your scoped task is: ${TASK_TEXT}`);
    expect(head).not.toContain(BLOCK_MARKER);

    // The control: `full` hands the whole plan on, marker included, so
    // the head's exclusion is a strip and not a prompt with nothing in
    // it to strip.
    expect(result.prompt).toContain(BLOCK_MARKER);

    const executed = logs.find((line) => line.includes('Executing task: '));
    expect(executed).toBeDefined();
    expect(executed?.endsWith(`Executing task: ${TASK_TEXT}`)).toBe(true);
    expect(executed).not.toContain(BLOCK_MARKER);
  });
});

const tempRoot = mkdtempSync(join(tmpdir(), 'rafa-block-strip-'));

afterAll(() => {
  rmSync(tempRoot, { recursive: true, force: true });
});

let planted = 0;

/** Runs git in a repository, reading back rather than through git.ts. */
function inRepo(dir: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();
}

/** Writes a file into a repository, creating its directory first. */
function write(dir: string, name: string, body: string): void {
  const target = join(dir, name);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, body, 'utf8');
}

/**
 * A repository ignoring what this repo's loop ignores, with one commit
 * in it. `core.hooksPath` points at a directory of its own, so nothing
 * here runs against a hook it knows nothing about.
 */
function plantRepo(): string {
  planted += 1;
  const dir = join(tempRoot, `repo-${planted}`);
  mkdirSync(join(dir, 'hooks'), { recursive: true });
  inRepo(dir, 'init', '-q', '.');
  inRepo(dir, 'config', 'user.email', 'loop@example.test');
  inRepo(dir, 'config', 'user.name', 'Ralph Loop');
  inRepo(dir, 'config', 'commit.gpgsign', 'false');
  inRepo(dir, 'config', 'core.hooksPath', 'hooks');
  write(dir, '.gitignore', 'progress.txt\n.plans/\n.specs/\n');
  write(dir, 'seed.txt', 'seed\n');
  inRepo(dir, 'add', '-A');
  inRepo(dir, 'commit', '-q', '-m', 'seed');
  return dir;
}

/** Plants a tracker where the loop keeps one, and answers its path. */
function plantTracker(dir: string): string {
  const trackerPath = join(dir, '.plans', 'PLAN_TRACKER-strip-proof.md');
  write(dir, '.plans/PLAN_TRACKER-strip-proof.md', PLAN);
  return trackerPath;
}

/** The subject of the newest commit. */
function lastSubject(dir: string): string {
  return inRepo(dir, 'log', '-1', '--format=%s');
}

/** The body of the newest commit. */
function lastBody(dir: string): string {
  return inRepo(dir, 'log', '-1', '--format=%b');
}

describe('what a finished task, dispatched from the same plan, commits', () => {
  it('keeps the block out of the commit subject and the commit body', () => {
    const dir = plantRepo();
    const trackerPath = plantTracker(dir);
    const taskInfo = taskOrThrow(PLAN);

    // A tracked change, so the attempt actually commits rather than
    // answering `nothing-to-commit` with no subject to inspect.
    write(dir, 'tracked.txt', 'work\n');

    const attempt = commitFinishedTask({ trackerPath, taskInfo, repoRoot: dir });
    const expected = buildCommitMessage(TASK_TEXT);

    expect(attempt.outcome).toBe('committed');
    expect(attempt.subject).toBe(expected.subject);
    expect(attempt.subject.length).toBeLessThanOrEqual(MAX_SUBJECT_LENGTH);
    expect(attempt.subject).not.toContain(BLOCK_MARKER);

    const subject = lastSubject(dir);
    const body = lastBody(dir);

    expect(subject).toBe(expected.subject);
    expect(subject).not.toContain(BLOCK_MARKER);

    // The vacuous-pass guard: the body is the whole task sentence and
    // never empty, so the absence below is read off a body that exists.
    expect(body).toBe(TASK_TEXT);
    expect(body).toBe(expected.body);
    expect(body.length).toBeGreaterThan(0);
    expect(body).not.toContain(BLOCK_MARKER);
  });
});
