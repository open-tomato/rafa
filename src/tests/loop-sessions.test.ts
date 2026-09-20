/**
 * `rafa loop start` spawned end to end over a two-task plan, with a
 * stand-in `claude` first on its PATH.
 *
 * ## What is planted
 *
 * {@link plant} makes a scratch git repository on `feat/sessions-demo`,
 * holding `.rafa/config.yaml` and, under `.plans/`, the plan text a case
 * hands it. `.plans/`, `.rafa/` and `progress.txt` are gitignored, so a
 * task's commit always finds nothing tracked to commit and no git
 * identity work is needed beyond what one seed commit takes. The stand-in
 * `claude` ({@link plantStandIn}) drains its prompt with the shell's own
 * `read`, sleeps two seconds so a case has a window to act while a task's
 * session is still running, logs the call outside the repository, and
 * then answers a session spawned with `--max-budget-usd` with the exact
 * line Claude Code 2.1.268 was measured writing on its budget
 * (`start/budget.ts`), exiting 1; every other call writes
 * {@link STAND_IN_REPORT} and exits 0.
 *
 * That report is what keeps these tasks ticked. Nothing tracked is
 * committed here, so a session writing no report either would leave
 * NEITHER behind, and `finishCleanExit` holds such a task rather than
 * ticking it (`start/commit.ts`): the run would stop on its first task
 * and no case below would see its second.
 *
 * ## The cases
 *
 *   - **Running to done, `loop status` counting alongside it**: the run
 *     is spawned in the background over the two open tasks. `loop status`
 *     is read once while the first task's session is still running and
 *     once while the second's is, each time against the tracker the run
 *     itself made, and once more after the run has ended.
 *   - **`loop pause`**: sent while the first task's session is still
 *     running. The task still finishes, is marked `[x]` and committed as
 *     it would have been, and the run then holds before its second task,
 *     naming none, so the stand-in is called once and the second task
 *     stays `[ ]`. `loop stop` ends the held run.
 *   - **A stand-in session ending on its budget**: the first task declares
 *     `{budget=0.01}`, so its session is spawned with `--max-budget-usd`
 *     and the stand-in answers accordingly. The run stops there: the task
 *     is left `[BLOCKED]` with `budget exceeded` as its blocker comment,
 *     and the second task is never dispatched.
 *   - **`--runtime`**: `--runtime=src` resolves against the working
 *     directory to the scratch checkout's own `src/`, which
 *     `start/runtime.ts` refuses before the plan is even read, whether or
 *     not that directory exists.
 *
 * Every case reads the session record through `readSessions`
 * (`loop/sessions.ts`) rather than through a known id, since a spawned
 * run picks its own.
 */
import type { SessionStatus } from '../commands/loop/status.js';
import type { StopResult } from '../commands/loop/stop.js';
import type { SessionRecord } from '../loop/sessions.js';

import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'bun:test';

import { readSessions } from '../loop/sessions.js';

import { plantProjectConfig } from './cli-capture.js';
import { resultEvent } from './loop-session-fixtures.js';

/** The CLI entry every case spawns. */
const RAFA_ENTRY = fileURLToPath(new URL('../rafa.ts', import.meta.url));

/** A temporary directory of this file's own. */
const tempRoot = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-loop-sessions-')));

afterAll(() => {
  rmSync(tempRoot, { recursive: true, force: true });
});

/** A fence, kept out of the template literals. */
const FENCE = '```';

/** The report a stand-in session ends on: `done`, holding nothing back. */
const STAND_IN_REPORT = [
  `${FENCE}rafa:report`,
  'status: done',
  'feedback: "the stand-in answered"',
  'findings: []',
  'skills_used: []',
  'blockers: []',
  'out_of_scope_bugs: []',
  FENCE,
  '',
].join('\n');

/** How long the stand-in sleeps per call, in whole seconds: a window for a case to act mid-session. */
const STAND_IN_DELAY_SECONDS = 2;

/** How long a case may wait for a condition to hold, or a blocking spawn to finish. */
const RUN_TIMEOUT = 90_000;

/** How long a blocking spawn may run before it is killed. */
const SPAWN_KILL_MS = 30_000;

/** The plan stub every case runs. */
const STUB = 'sessions-demo';

/** The branch every scratch repository is checked out on. */
const BRANCH = `feat/${STUB}`;

/** The flag naming the planted plan. */
const PLAN_FLAG = `--plan=.plans/PLAN-${STUB}.md`;

/** The tracker's file name, beside the plan under `.plans/`. */
const TRACKER_NAME = `PLAN_TRACKER-${STUB}.md`;

/** The first task's sentence, with no declaration. */
const TASK1 = 'First task for the stand-in';

/** The second task's sentence. */
const TASK2 = 'Second task for the stand-in';

/** A plan holding both tasks open, neither declaring anything. */
const PLAN_TWO_TASKS = `# Plan: ${STUB}\n\n- [ ] ${TASK1}\n- [ ] ${TASK2}\n`;

/** The first task's line once it declares a budget too small for any session to keep to. */
const BUDGET_TASK = `${TASK1}  {budget=0.01}`;

/** A plan whose first task declares a budget, the second declaring nothing. */
const PLAN_WITH_BUDGET = `# Plan: ${STUB}\n\n- [ ] ${BUDGET_TASK}\n- [ ] ${TASK2}\n`;

/** The flags every `loop start` in this file runs with, bar `--runtime`. */
const RUN_FLAGS: readonly string[] = [PLAN_FLAG, '--no-ci-wait', '--inject=full'];

/** A scratch repository, and what a spawned run reads under it. */
interface Scratch {
  /** The git repository, a project holding `.rafa/config.yaml`. */
  readonly repo: string;
  /** The HOME a spawned run gets. */
  readonly home: string;
  /** The stand-in `claude`. */
  readonly claude: string;
  /** The file the stand-in appends one line to per call, outside the repository. */
  readonly callLog: string;
  /** The PATH a spawned run gets: the stand-in's directory, then git's own. */
  readonly path: string;
}

/** What one blocking run answered. */
interface CapturedRun {
  /** Null when the run was killed. */
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

/** Runs git in a scratch repository under that scratch HOME. */
function git(cwd: string, home: string, ...args: string[]): void {
  execFileSync('git', args, {
    cwd,
    stdio: 'pipe',
    env: { ...process.env, HOME: home, GIT_CONFIG_GLOBAL: join(home, '.gitconfig'), GIT_CONFIG_NOSYSTEM: '1' },
  });
}

/**
 * Writes the stand-in `claude` into `scratch`'s `bin/`. It drains its
 * prompt, sleeps {@link STAND_IN_DELAY_SECONDS}, logs the call, and, for a
 * session spawned with `--max-budget-usd`, writes the measured budget
 * line and exits 1; every other call writes {@link STAND_IN_REPORT} and
 * exits 0. See the module note.
 */
function plantStandIn(scratch: Scratch): void {
  const reportPath = join(dirname(scratch.claude), 'report.txt');
  writeFileSync(reportPath, STAND_IN_REPORT, 'utf8');
  writeFileSync(scratch.claude, [
    '#!/bin/sh',
    'while read -r _line; do :; done',
    `/bin/sleep ${STAND_IN_DELAY_SECONDS}`,
    `echo called >> '${scratch.callLog}'`,
    'case " $* " in',
    '  *" --max-budget-usd "*)',
    '    printf \'Error: Exceeded USD budget (0.01)\'',
    '    exit 1',
    '    ;;',
    'esac',
    `/bin/cat '${reportPath}'`,
    'exit 0',
    '',
  ].join('\n'), 'utf8');
  chmodSync(scratch.claude, 0o755);
}

let planted = 0;

/**
 * A scratch git repository on {@link BRANCH}, its own HOME and `bin/`
 * beside it, holding `.rafa/config.yaml` and `planText` at
 * `.plans/PLAN-<stub>.md`. See the module note.
 */
function plant(planText: string): Scratch {
  planted += 1;
  const root = join(tempRoot, `run-${planted}`);
  const repo = join(root, 'repo');
  const bin = join(root, 'bin');
  const home = join(root, 'home');
  for (const dir of [repo, bin, home]) mkdirSync(dir, { recursive: true });

  const gitBinary = Bun.which('git');
  if (gitBinary === null) throw new Error('git is not on the PATH this suite runs under');
  const scratch: Scratch = {
    repo,
    home,
    claude: join(bin, 'claude'),
    callLog: join(root, 'calls.log'),
    path: [bin, dirname(gitBinary)].join(delimiter),
  };
  plantStandIn(scratch);

  git(repo, home, 'init', '-q', '.');
  git(repo, home, 'config', 'user.email', 'loop@example.test');
  git(repo, home, 'config', 'user.name', 'Rafa Loop');
  git(repo, home, 'config', 'commit.gpgsign', 'false');
  writeFileSync(join(repo, '.gitignore'), 'progress.txt\n.plans/\n.rafa/\n', 'utf8');
  git(repo, home, 'add', '-A');
  git(repo, home, 'commit', '-q', '--no-verify', '-m', 'seed');
  git(repo, home, 'checkout', '-q', '-B', BRANCH);

  mkdirSync(join(repo, '.plans'));
  writeFileSync(join(repo, '.plans', `PLAN-${STUB}.md`), planText, 'utf8');
  plantProjectConfig(repo);

  return scratch;
}

/** Runs `bun src/rafa.ts` with `words` in `scratch`'s repository, waiting for it to finish. */
function run(scratch: Scratch, words: readonly string[], env: Readonly<Record<string, string>> = {}): CapturedRun {
  const resolved = Bun.which('claude', { PATH: scratch.path });
  if (resolved !== scratch.claude) {
    throw new Error(`claude resolves to ${String(resolved)}, not the stand-in`);
  }
  const proc = Bun.spawnSync([process.execPath, RAFA_ENTRY, ...words], {
    cwd: scratch.repo,
    env: { ...env, PATH: scratch.path, HOME: scratch.home },
    timeout: SPAWN_KILL_MS,
  });
  return { exitCode: proc.exitCode, stdout: proc.stdout.toString(), stderr: proc.stderr.toString() };
}

/** Spawns `rafa loop start` over {@link RUN_FLAGS} in the background, its streams ignored. */
function spawnLoopStart(scratch: Scratch) {
  const resolved = Bun.which('claude', { PATH: scratch.path });
  if (resolved !== scratch.claude) {
    throw new Error(`claude resolves to ${String(resolved)}, not the stand-in`);
  }
  return Bun.spawn([process.execPath, RAFA_ENTRY, 'loop', 'start', ...RUN_FLAGS], {
    cwd: scratch.repo,
    env: { PATH: scratch.path, HOME: scratch.home },
    stdout: 'ignore',
    stderr: 'ignore',
  });
}

/** The one session record under `repo`'s `.rafa/runs/`, or null before there is exactly one. */
function soleSession(repo: string): SessionRecord | null {
  const sessions = readSessions(repo);
  return sessions.length === 1
    ? sessions[0]
    : null;
}

/** Polls `read` every `pollMs` until it answers other than null, or throws past `timeoutMs`. */
async function waitUntil<T>(read: () => T | null, timeoutMs: number, pollMs = 25): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (true) {
    const value = read();
    if (value !== null) return value;
    if (Date.now() >= deadline) throw new Error('timed out waiting for a condition to hold');
    await Bun.sleep(pollMs);
  }
}

/** Waits until `repo`'s sole session names `text` as its running task. */
function waitForTask(repo: string, text: string): Promise<SessionRecord> {
  return waitUntil(() => {
    const session = soleSession(repo);
    return session !== null && session.task?.text === text
      ? session
      : null;
  }, RUN_TIMEOUT);
}

/** Waits until `repo`'s sole session reads `paused` and names no task: the hold has taken effect. */
function waitForPausedIdle(repo: string): Promise<SessionRecord> {
  return waitUntil(() => {
    const session = soleSession(repo);
    return session !== null && session.state === 'paused' && session.task === null
      ? session
      : null;
  }, RUN_TIMEOUT);
}

/** The `data` of a json-mode terminal result, cast to `T`. Throws when the run did not succeed. */
function dataOf<T>(stdout: string): T {
  const answer = resultEvent(stdout);
  if (!answer.ok) throw new Error(`the run did not succeed: ${stdout}`);
  return answer.data as T;
}

describe('rafa loop start, spawned over a two-task plan', () => {
  it('moves its session record from running to done, as loop status counts the tasks beside it', async () => {
    const scratch = plant(PLAN_TWO_TASKS);
    const proc = spawnLoopStart(scratch);
    try {
      await waitForTask(scratch.repo, TASK1);
      const first = dataOf<SessionStatus>(run(scratch, ['loop', 'status'], { RAFA_OUTPUT: 'json' }).stdout);
      expect(first.session.state).toBe('running');
      expect(first.tasks).toEqual({ total: 2, done: 0, blocked: 0, open: 2 });

      await waitForTask(scratch.repo, TASK2);
      const second = dataOf<SessionStatus>(run(scratch, ['loop', 'status'], { RAFA_OUTPUT: 'json' }).stdout);
      expect(second.session.state).toBe('running');
      expect(second.tasks).toEqual({ total: 2, done: 1, blocked: 0, open: 1 });

      const exitCode = await proc.exited;
      expect(exitCode).toBe(0);

      const ended = soleSession(scratch.repo);
      expect(ended?.state).toBe('done');
      expect(ended?.task).toBeNull();

      const last = dataOf<SessionStatus>(run(scratch, ['loop', 'status'], { RAFA_OUTPUT: 'json' }).stdout);
      expect(last.session.state).toBe('done');
      expect(last.tasks).toEqual({ total: 2, done: 2, blocked: 0, open: 0 });
      expect(last.eta).toBeNull();
    } finally {
      proc.kill();
    }
  }, RUN_TIMEOUT);
});

describe('rafa loop pause against a run spawned over the same plan', () => {
  it('holds once the running task ends, dispatching no task after it', async () => {
    const scratch = plant(PLAN_TWO_TASKS);
    const proc = spawnLoopStart(scratch);
    try {
      await waitForTask(scratch.repo, TASK1);
      const paused = run(scratch, ['loop', 'pause']);
      expect(paused.exitCode).toBe(0);

      await waitForPausedIdle(scratch.repo);

      const tracker = readFileSync(join(scratch.repo, '.plans', TRACKER_NAME), 'utf8');
      expect(tracker).toContain(`- [x] ${TASK1}`);
      expect(tracker).toContain(`- [ ] ${TASK2}`);
      expect(readFileSync(scratch.callLog, 'utf8')).toBe('called\n');

      const stopped = dataOf<StopResult>(run(scratch, ['loop', 'stop'], { RAFA_OUTPUT: 'json' }).stdout);
      expect(stopped.ended).toBe(true);
      expect(stopped.session.state).toBe('stopped');
      expect(stopped.task).toBeNull();

      const exitCode = await proc.exited;
      expect(exitCode).toBe(0);
      expect(soleSession(scratch.repo)?.state).toBe('stopped');
    } finally {
      proc.kill();
    }
  }, RUN_TIMEOUT);
});

describe('a stand-in session ending on its budget', () => {
  it('leaves the task [BLOCKED] with budget exceeded, and dispatches no task after it', () => {
    const scratch = plant(PLAN_WITH_BUDGET);

    const started = run(scratch, ['loop', 'start', ...RUN_FLAGS]);

    expect(started.exitCode).toBe(0);
    const tracker = readFileSync(join(scratch.repo, '.plans', TRACKER_NAME), 'utf8');
    expect(tracker).toContain(`- [BLOCKED] ${BUDGET_TASK}  <!-- blocked: budget exceeded -->`);
    expect(tracker).toContain(`- [ ] ${TASK2}`);
    expect(readFileSync(scratch.callLog, 'utf8')).toBe('called\n');
    expect(soleSession(scratch.repo)?.state).toBe('stopped');
  }, RUN_TIMEOUT);
});

describe('rafa loop start --runtime, spawned over the same checkout', () => {
  it('refuses a runtime resolving inside the scratch checkout src, before the plan is read', () => {
    const scratch = plant(PLAN_TWO_TASKS);
    mkdirSync(join(scratch.repo, 'src'), { recursive: true });

    const refused = run(scratch, ['loop', 'start', '--runtime=src', ...RUN_FLAGS]);

    expect(refused.exitCode).toBe(1);
    expect(refused.stderr).toContain(`inside ${join(scratch.repo, 'src')}`);
    expect(existsSync(scratch.callLog)).toBe(false);
    expect(existsSync(join(scratch.repo, '.rafa', 'runs'))).toBe(false);
  }, RUN_TIMEOUT);
});
