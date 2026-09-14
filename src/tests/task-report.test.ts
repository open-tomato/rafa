/**
 * A task session's report, from the spawn to the store, driven through
 * `start/dispatch.ts` and through the real `rafa start` command.
 *
 * `report/record.ts` stores a report and `utils/progress.ts` renders the
 * stored findings, and each is tested beside its own module. What this
 * file holds is the loop's side of the join: a task session runs under an
 * id the loop picked, its report is stored under that same id with the
 * loop's outcome for its task, and `progress.txt` is rendered before every
 * dispatch.
 *
 * ## The seam cases
 *
 * `runTaskSession` is driven with only the process spawn stubbed, so the
 * argument list asserted is the one that would be run, and `dispatchTask`
 * with only the runner stubbed.
 *
 * ## The command cases
 *
 * `start()` has no seam: it finds its root through git and spawns
 * `claude` off PATH. So it is run as a command, `bun src/rafa.ts start`,
 * in a scratch repository with a HOME of its own, under a PATH holding a
 * stand-in `claude` and git's own directory. Each run first asserts that
 * `claude` resolves to the stand-in on that PATH, so no case can reach a
 * real session. The stand-in keeps each call's arguments, prompt and the
 * `progress.txt` it found, outside the repository, and answers by the
 * marker in the task sentence. A reporting call's finding names the call,
 * so one render can be told from the render before it.
 *
 * Every absence is paired with the inclusion that makes it a reading. The
 * wrap-up's `progress.txt` holding the last task's finding is a render
 * only because the last task's own copy did not hold it. A run that
 * dispatches nothing is a refusal only because the run before it, on the
 * same stand-in, dispatched. And a run that stops after one unstored
 * report stops for that reason only because its store rendered: that
 * store is readable, and refuses writes alone.
 *
 * ## Mutations
 *
 * Fifteen mutations of `start.ts` were driven against this file alone,
 * while `start.ts` still held what `start/dispatch.ts` holds now, with
 * the unmutated file green before and after and `start.ts` restored
 * byte-identical, and every one reddened at least one of its 10 cases:
 * no render before a dispatch (3 red), none before the wrap-up (1), no
 * `--session-id` on the spawn (6), the id after the flags (1), the report
 * stored under another id (4), a failed session stored as blocked (1), a
 * refused commit stored as done (1), no stop after an unstored report
 * (1), an interrupted session stored as failed (1) or not stored (1), the
 * id seam ignored (1), the output dropped (5), the task line replaced
 * (3), the plan stub dropped (1), and a failed render that does not stop
 * the run (1).
 *
 * The routed-effort case came after those fifteen, and it is the only
 * reading of `start.ts` handing the dispatch its repository root and
 * `homedir()`, which reads the HOME each run is given. Two legs were
 * driven against it, each twice: handing the repository root as the
 * home, and the home as the repository root, each redden that case
 * alone.
 */
import type { TaskSessionRunner } from '../start/dispatch.js';
import type { CapturingSpawner } from '../utils/claude.js';
import type { TaskInfo } from '../utils/tracker.js';

import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Database } from 'bun:sqlite';
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

import { sqliteStorePath, withSqliteStore } from '../effort/store/sqlite.js';
import { dispatchTask, runTaskSession, SESSION_ID_FLAG } from '../start/dispatch.js';
import { CLAUDE_BASE_ARGS } from '../utils/claude.js';

/** A version-4 UUID, as `randomUUID` writes one. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** A fence, kept out of the template literals. */
const FENCE = '```';

/** Whether the suite runs as root, which a read-only file does not stop. */
const IS_ROOT = process.getuid?.() === 0;

describe('the task session runner', () => {
  /** Runs one session through a recording spawner. */
  async function spawnedArgs(flags: readonly string[]): Promise<readonly string[][]> {
    const calls: string[][] = [];
    const spawn: CapturingSpawner = (args) => {
      calls.push([...args]);
      return Promise.resolve({ exitCode: 3, stdout: 'the final message' });
    };
    const session = await runTaskSession('do the task', flags, 'aaaa-1111', spawn);

    expect(session).toEqual({ exitCode: 3, stdout: 'the final message' });
    return calls;
  }

  it('puts the session id between the base arguments and the flags', async () => {
    const calls = await spawnedArgs(['--model', 'haiku', '--tools', 'Read,Write']);

    expect(calls).toEqual([[
      '-p',
      '--dangerously-skip-permissions',
      '--session-id',
      'aaaa-1111',
      '--model',
      'haiku',
      '--tools',
      'Read,Write',
    ]]);
  });

  it('spawns an undeclared task with its id and nothing else', async () => {
    const calls = await spawnedArgs([]);

    expect(calls).toEqual([['-p', '--dangerously-skip-permissions', '--session-id', 'aaaa-1111']]);
    expect(SESSION_ID_FLAG).toBe('--session-id');
  });
});

describe('a dispatched task session', () => {
  const plan = ['# Plan: a session id fixture', '', '- [ ] Record the report', ''].join('\n');
  const taskInfo: TaskInfo = { task: 'Record the report', lineNum: 2, status: 'unchecked' };

  beforeEach(() => {
    spyOn(console, 'log').mockImplementation(() => {});
    spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    mock.restore();
  });

  /** Dispatches the fixture task, the runner recording every id it is handed. */
  function dispatchWith(seen: string[], newSessionId?: () => string): ReturnType<typeof dispatchTask> {
    const run: TaskSessionRunner = (_prompt, _flags, sessionId) => {
      seen.push(sessionId);
      return Promise.resolve({ exitCode: 0, stdout: `output of ${sessionId}` });
    };
    return dispatchTask({
      taskInfo,
      promptContent: 'The loop stages and commits on your behalf.',
      planContent: plan,
      inject: 'full',
      repoRoot: tempRoot,
      home: join(tempRoot, 'home'),
      run,
      newSessionId,
    });
  }

  it('hands the runner the id it picked and records it beside the output', async () => {
    const seen: string[] = [];
    const result = await dispatchWith(seen, () => 'aaaa-1111');

    expect(seen).toEqual(['aaaa-1111']);
    expect(result.sessionId).toBe('aaaa-1111');
    expect(result.output).toBe('output of aaaa-1111');
    expect(result.exitCode).toBe(0);
  });

  it('picks a fresh UUID for every dispatch when no seam is given', async () => {
    const seen: string[] = [];
    const first = await dispatchWith(seen);
    const second = await dispatchWith(seen);

    expect(seen).toEqual([first.sessionId, second.sessionId]);
    expect(first.sessionId).toMatch(UUID);
    expect(second.sessionId).toMatch(UUID);
    expect(first.sessionId).not.toBe(second.sessionId);
  });
});

/** The command every run executes. */
const RAFA_ENTRY = fileURLToPath(new URL('../rafa.ts', import.meta.url));

/** The stub of the plan every scratch repository carries. */
const STUB = 'report-loop';

/** Task sentences, each carrying the marker the stand-in answers by. */
const REPORTING_TASK = 'Add the first module MARK-REPORT';
const SILENT_TASK = 'Add the second module MARK-SILENT';
const LATE_TASK = 'Add the third module MARK-REPORT';
const FAILING_TASK = 'Add a module whose session fails MARK-FAIL';
const BREAKING_TASK = 'Add a module whose session breaks the store MARK-BREAK';
const INTERRUPTED_TASK = 'Add a module whose session is interrupted MARK-HANG';

/** What the stand-in replaces with its call number. */
const CALL_PLACEHOLDER = 'CALL-NUMBER';

/** The finding a reporting call reports, as it reaches `progress.txt`. */
function findingOf(call: number | string): string {
  return `finding of call ${call}`;
}

/** The output a reporting session ends with, its call number still a placeholder. */
const REPORT = [
  'Done: the module is in.',
  '',
  `${FENCE}rafa:report`,
  'status: done',
  'findings:',
  '  - trigger: "when the stand-in reports"',
  '    kind: gotcha',
  `    what: "${findingOf(CALL_PLACEHOLDER)}"`,
  '    artifact: "stand-in artifact"',
  '    signal: loud',
  'blockers:',
  '  - what: "a stand-in blocker"',
  'out_of_scope_bugs:',
  '  - what: "a stand-in bug"',
  '    security: false',
  FENCE,
  '',
].join('\n');

/** Everything one scratch run lives in. */
interface Scratch {
  /** The repository `rafa start` runs in. */
  readonly repo: string;
  /** Where the stand-in keeps each call, outside the repository. */
  readonly calls: string;
  /** The HOME the command runs under. */
  readonly home: string;
  /** The PATH the command runs under: the stand-in, then git. */
  readonly path: string;
  /** The stand-in itself. */
  readonly claude: string;
}

const tempRoot = mkdtempSync(join(tmpdir(), 'rafa-task-report-'));
let planted = 0;

afterAll(() => {
  rmSync(tempRoot, { recursive: true, force: true });
});

/**
 * The stand-in `claude`: keeps each call, then answers by its task's
 * marker. An interrupted call prints its report, says it is waiting, and
 * exits 130 once the case releases it, at most 30s later.
 */
function standInScript(calls: string, reportPath: string): string {
  const report = `/usr/bin/sed "s/${CALL_PLACEHOLDER}/$n/" '${reportPath}'`;
  const release = [
    ': > "$calls/$n.waiting"',
    'i=0',
    'while [ ! -e "$calls/release" ] && [ "$i" -lt 600 ]; do /bin/sleep 0.05; i=$((i + 1)); done',
    'exit 130',
  ].join('; ');
  return [
    '#!/bin/sh',
    `calls='${calls}'`,
    'n=$(/bin/cat "$calls/count" 2>/dev/null || echo 0)',
    'n=$((n + 1))',
    'echo "$n" > "$calls/count"',
    'for arg in "$@"; do printf \'%s\\n\' "$arg"; done > "$calls/$n.args"',
    '/bin/cat > "$calls/$n.prompt"',
    'if [ -e progress.txt ]; then /bin/cp progress.txt "$calls/$n.progress"; fi',
    'head=$(/usr/bin/head -n 1 "$calls/$n.prompt")',
    'case "$head" in',
    `  *MARK-REPORT*) echo work > "work-$n.txt"; ${report} ;;`,
    '  *MARK-SILENT*) echo work > "work-$n.txt"; echo "Done, and nothing to report." ;;',
    `  *MARK-FAIL*) ${report}; exit 3 ;;`,
    `  *MARK-BREAK*) /bin/mkdir -p .ralph/effort/effort.sqlite; ${report} ;;`,
    `  *MARK-HANG*) ${report}; ${release} ;;`,
    'esac',
    'exit 0',
    '',
  ].join('\n');
}

/** Runs git in a scratch repository, its output kept off the test's. */
function git(dir: string, ...args: string[]): void {
  execFileSync('git', args, { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] });
}

/** Writes an executable shell script. */
function writeScript(path: string, body: string): void {
  writeFileSync(path, body, 'utf8');
  chmodSync(path, 0o755);
}

/**
 * A scratch repository on a feature branch, holding a plan of `tasks`,
 * with the stand-in beside it. A refusing pre-commit hook is installed
 * when asked for, outside the repository.
 */
function plantScratch(tasks: readonly string[], refuseCommits = false): Scratch {
  planted += 1;
  const root = join(tempRoot, `run-${planted}`);
  const repo = join(root, 'repo');
  const bin = join(root, 'bin');
  const calls = join(root, 'calls');
  const home = join(root, 'home');
  const hooks = join(root, 'hooks');
  for (const dir of [repo, bin, calls, home, hooks]) mkdirSync(dir, { recursive: true });

  const reportPath = join(root, 'report.md');
  writeFileSync(reportPath, REPORT, 'utf8');
  const claude = join(bin, 'claude');
  writeScript(claude, standInScript(calls, reportPath));
  if (refuseCommits) writeScript(join(hooks, 'pre-commit'), '#!/bin/sh\nexit 1\n');

  git(repo, 'init', '-q', '.');
  git(repo, 'config', 'user.email', 'loop@example.test');
  git(repo, 'config', 'user.name', 'Rafa Loop');
  git(repo, 'config', 'commit.gpgsign', 'false');
  git(repo, 'config', 'core.hooksPath', hooks);
  writeFileSync(join(repo, '.gitignore'), 'progress.txt\n.plans/\n.ralph/\n', 'utf8');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '--no-verify', '-m', 'seed');
  git(repo, 'checkout', '-q', '-b', `feat/${STUB}`);

  mkdirSync(join(repo, '.plans'));
  const plan = [`# Plan: ${STUB}`, '', ...tasks.map((task) => `- [ ] ${task}`), ''];
  writeFileSync(join(repo, '.plans', `PLAN-${STUB}.md`), plan.join('\n'), 'utf8');

  const gitBinary = Bun.which('git');
  if (gitBinary === null) throw new Error('git is not on the PATH this suite runs under');
  return { repo, calls, home, claude, path: [bin, dirname(gitBinary)].join(delimiter) };
}

/** The command line of every run: the scratch plan, never waiting on CI. */
function startCommand(): string[] {
  return [process.execPath, RAFA_ENTRY, 'start', `--plan=.plans/PLAN-${STUB}.md`, '--no-ci-wait'];
}

/** The environment every run gets: the scratch PATH and HOME, nothing else. */
function startEnv(scratch: Scratch): Record<string, string> {
  return { PATH: scratch.path, HOME: scratch.home };
}

/** Throws unless `claude` resolves to the stand-in on the scratch PATH. */
function assertStandIn(scratch: Scratch): void {
  const resolved = Bun.which('claude', { PATH: scratch.path });
  if (resolved !== scratch.claude) {
    throw new Error(`claude resolves to ${String(resolved)}, not the stand-in`);
  }
}

/** What one `rafa start` run did. */
interface StartRun {
  readonly exitCode: number;
  /** Its stdout and stderr, one after the other. */
  readonly output: string;
}

/** Runs `rafa start` to its end. */
function runStart(scratch: Scratch): StartRun {
  assertStandIn(scratch);
  const run = Bun.spawnSync(startCommand(), { cwd: scratch.repo, env: startEnv(scratch) });
  return {
    exitCode: run.exitCode,
    output: `${run.stdout.toString()}${run.stderr.toString()}`,
  };
}

/** Polls for a file, 20ms apart and at most 30s in all; answers whether it came. */
async function appeared(path: string): Promise<boolean> {
  for (let poll = 0; poll < 1500 && !existsSync(path); poll += 1) {
    await Bun.sleep(20);
  }
  return existsSync(path);
}

/** How many times the stand-in was called. */
function callCount(scratch: Scratch): number {
  const path = join(scratch.calls, 'count');
  return existsSync(path)
    ? Number(readFileSync(path, 'utf8').trim())
    : 0;
}

/** The arguments of the `n`th call, one per element. */
function argsOf(scratch: Scratch, n: number): string[] {
  const lines = readFileSync(join(scratch.calls, `${n}.args`), 'utf8').split('\n');
  return lines.slice(0, -1);
}

/** The first line of the prompt of the `n`th call. */
function promptHeadOf(scratch: Scratch, n: number): string {
  return readFileSync(join(scratch.calls, `${n}.prompt`), 'utf8').split('\n')[0] ?? '';
}

/** The `progress.txt` the `n`th call found, or null when there was none. */
function progressSeenBy(scratch: Scratch, n: number): string | null {
  const path = join(scratch.calls, `${n}.progress`);
  return existsSync(path)
    ? readFileSync(path, 'utf8')
    : null;
}

/** The id the `n`th call was spawned under, or null when it had none. */
function sessionIdOf(scratch: Scratch, n: number): string | null {
  const args = argsOf(scratch, n);
  const at = args.indexOf('--session-id');
  return at === -1
    ? null
    : args[at + 1] ?? null;
}

/** The id the `n`th call was spawned under. Throws when it had none. */
function requireSessionId(scratch: Scratch, n: number): string {
  const sessionId = sessionIdOf(scratch, n);
  if (sessionId === null) throw new Error(`call ${n} carried no --session-id`);
  return sessionId;
}

/** Some columns of every row of one store table, in append order. */
function rowsOf(scratch: Scratch, table: string, columns: string): Record<string, unknown>[] {
  const db = new Database(sqliteStorePath(scratch.repo), { readonly: true });
  try {
    return db.query<Record<string, unknown>, []>(`SELECT ${columns} FROM ${table} ORDER BY seq`).all();
  } finally {
    db.close();
  }
}

/** The tracker's task lines, checkbox and all. */
function trackerTasks(scratch: Scratch): string[] {
  const tracker = readFileSync(join(scratch.repo, '.plans', `PLAN_TRACKER-${STUB}.md`), 'utf8');
  return tracker.split('\n').filter((line) => line.startsWith('- ['));
}

/** A command run takes about a second, more under a loaded suite. */
const RUN_TIMEOUT = { timeout: 60_000 };

describe('rafa start, over a stand-in claude', () => {
  it('stores each report under the id its session ran with, rendering progress.txt first', () => {
    const scratch = plantScratch([REPORTING_TASK, SILENT_TASK, LATE_TASK]);
    expect(existsSync(join(scratch.repo, 'progress.txt'))).toBe(false);

    const run = runStart(scratch);

    expect(run).toMatchObject({ exitCode: 0 });
    expect(callCount(scratch)).toBe(4);
    const ids = [1, 2, 3].map((n) => requireSessionId(scratch, n));
    const [reporting, silent, late] = ids;
    for (const id of ids) expect(id).toMatch(UUID);
    expect(new Set(ids).size).toBe(3);
    expect(argsOf(scratch, 1)).toEqual([...CLAUDE_BASE_ARGS, '--session-id', reporting]);
    expect(promptHeadOf(scratch, 1)).toBe(`Your scoped task is: ${REPORTING_TASK}`);

    // The wrap-up is the fourth call: no id, and nothing stored for it.
    expect(argsOf(scratch, 4)).toEqual([...CLAUDE_BASE_ARGS]);
    expect(promptHeadOf(scratch, 4)).toBe('* Read `@progress.txt` in full.');

    // Rendered before every dispatch: empty before the first task, the
    // first task's finding before the second and third, and the third
    // task's own finding only once the wrap-up is next.
    expect(progressSeenBy(scratch, 1)).toBe('');
    expect(progressSeenBy(scratch, 2)).toContain(findingOf(1));
    expect(progressSeenBy(scratch, 3)).toContain(findingOf(1));
    expect(progressSeenBy(scratch, 3)).not.toContain(findingOf(3));
    expect(progressSeenBy(scratch, 4)).toContain(findingOf(3));

    const provenance = 'session_id, plan_stub, task_line, outcome';
    const first = { session_id: reporting, plan_stub: STUB, task_line: REPORTING_TASK, outcome: 'done' };
    const third = { session_id: late, plan_stub: STUB, task_line: LATE_TASK, outcome: 'done' };
    expect(rowsOf(scratch, 'findings', `${provenance}, what`))
      .toEqual([{ ...first, what: findingOf(1) }, { ...third, what: findingOf(3) }]);
    expect(rowsOf(scratch, 'blockers', provenance)).toEqual([first, third]);
    expect(rowsOf(scratch, 'out_of_scope_bugs', `${provenance}, security`))
      .toEqual([{ ...first, security: 0 }, { ...third, security: 0 }]);
    expect(rowsOf(scratch, 'report_absences', `${provenance}, reason`)).toEqual([{
      session_id: silent,
      plan_stub: STUB,
      task_line: SILENT_TASK,
      outcome: 'done',
      reason: 'no-block',
    }]);

    expect(trackerTasks(scratch))
      .toEqual([`- [x] ${REPORTING_TASK}`, `- [x] ${SILENT_TASK}`, `- [x] ${LATE_TASK}`]);
    expect(run.output).toContain('Report: status done; findings 1 stored');
    expect(run.output).toContain('No task report: the session output holds no rafa:report block');
  }, RUN_TIMEOUT);

  it('stores the report of a failed session as failed, and dispatches nothing after it', () => {
    const scratch = plantScratch([FAILING_TASK, REPORTING_TASK]);

    const run = runStart(scratch);

    expect(run.output).toContain('Task failed (exit 3)');
    expect(callCount(scratch)).toBe(1);
    expect(rowsOf(scratch, 'findings', 'session_id, task_line, outcome')).toEqual([{
      session_id: requireSessionId(scratch, 1),
      task_line: FAILING_TASK,
      outcome: 'failed',
    }]);
    expect(trackerTasks(scratch)).toEqual([`- [BLOCKED] ${FAILING_TASK}`, `- [ ] ${REPORTING_TASK}`]);
  }, RUN_TIMEOUT);

  it('stores the report of a task whose commit was refused as blocked', () => {
    const scratch = plantScratch([REPORTING_TASK], true);

    const run = runStart(scratch);

    expect(run.output).toContain('Commit refused');
    expect(callCount(scratch)).toBe(1);
    expect(rowsOf(scratch, 'findings', 'session_id, outcome'))
      .toEqual([{ session_id: requireSessionId(scratch, 1), outcome: 'blocked' }]);
    expect(trackerTasks(scratch)).toEqual([`- [BLOCKED] ${REPORTING_TASK}`]);
  }, RUN_TIMEOUT);

  it('stores the report of an interrupted session as blocked, then exits', async () => {
    const scratch = plantScratch([INTERRUPTED_TASK, REPORTING_TASK]);
    assertStandIn(scratch);
    const proc = Bun.spawn(startCommand(), {
      cwd: scratch.repo,
      env: startEnv(scratch),
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const streams = Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);

    // SIGINT only once the session has printed its report and waits.
    const waiting = await appeared(join(scratch.calls, '1.waiting'));
    proc.kill('SIGINT');
    writeFileSync(join(scratch.calls, 'release'), '');
    const exitCode = await proc.exited;
    const output = (await streams).join('');

    expect(waiting).toBe(true);
    expect(exitCode).toBe(0);
    expect(output).toContain('Interrupted. Task marked as blocked.');
    expect(callCount(scratch)).toBe(1);
    expect(rowsOf(scratch, 'findings', 'session_id, task_line, outcome')).toEqual([{
      session_id: requireSessionId(scratch, 1),
      task_line: INTERRUPTED_TASK,
      outcome: 'blocked',
    }]);
    expect(trackerTasks(scratch)).toEqual([`- [BLOCKED] ${INTERRUPTED_TASK}`, `- [ ] ${REPORTING_TASK}`]);
  }, RUN_TIMEOUT);

  it.skipIf(IS_ROOT)('stops after a report its store refuses, that store still rendering', () => {
    const scratch = plantScratch([REPORTING_TASK, LATE_TASK]);
    const store = sqliteStorePath(scratch.repo);
    withSqliteStore(store, true, () => null);
    chmodSync(store, 0o444);

    const run = runStart(scratch);

    // The control: the store rendered, so the write alone stopped the run.
    expect(progressSeenBy(scratch, 1)).toBe('');
    expect(run.output).toContain('was not stored: attempt to write a readonly database');
    expect(run.output).toContain('Stopping here.');
    expect(callCount(scratch)).toBe(1);
    expect(trackerTasks(scratch)).toEqual([`- [x] ${REPORTING_TASK}`, `- [ ] ${LATE_TASK}`]);
  }, RUN_TIMEOUT);

  it('refuses the run after a store it cannot read, dispatching nothing', () => {
    const scratch = plantScratch([BREAKING_TASK, REPORTING_TASK]);

    const first = runStart(scratch);

    // The session broke the store after the render: its task stands,
    // ticked, and the run stops at the report it could not store.
    expect(callCount(scratch)).toBe(1);
    expect(first.output).toContain('was not stored');
    expect(trackerTasks(scratch)).toEqual([`- [x] ${BREAKING_TASK}`, `- [ ] ${REPORTING_TASK}`]);

    const second = runStart(scratch);

    expect(second.output).toContain('could not be rendered');
    expect(callCount(scratch)).toBe(1);
    expect(trackerTasks(scratch)).toEqual([`- [x] ${BREAKING_TASK}`, `- [ ] ${REPORTING_TASK}`]);
  }, RUN_TIMEOUT);

  it('passes a routed effort unless the definition under the repo or the HOME declares its own', () => {
    const scratch = plantScratch([ROUTED_HOME_TASK, ROUTED_REPO_TASK, ROUTED_NOWHERE_TASK]);
    plantDefinition(scratch.home, 'doc-updater', 'high');
    plantDefinition(scratch.repo, 'tdd-guide', 'high');
    git(scratch.repo, 'add', '-A');
    git(scratch.repo, 'commit', '-q', '--no-verify', '-m', 'agents');

    const run = runStart(scratch);

    expect(run).toMatchObject({ exitCode: 0 });
    expect(callCount(scratch)).toBe(4);
    const idArgs = (n: number) => [...CLAUDE_BASE_ARGS, '--session-id', requireSessionId(scratch, n)];
    expect(argsOf(scratch, 1)).toEqual([...idArgs(1), '--agent', 'doc-updater']);
    expect(argsOf(scratch, 2)).toEqual([...idArgs(2), '--agent', 'tdd-guide']);

    // The control: an agent neither root defines still passes the plan
    // level, so the two absences above are definitions read, one under
    // the HOME the run was given and one under its repository.
    expect(argsOf(scratch, 3)).toEqual([...idArgs(3), '--agent', 'code-reviewer', '--effort', 'medium']);
  }, RUN_TIMEOUT);
});

/** A task routed to an agent whose only definition sits under the HOME. */
const ROUTED_HOME_TASK = 'Add the first routed module MARK-SILENT  {agent=doc-updater effort=low}';

/** A task routed to an agent whose only definition sits in the repository. */
const ROUTED_REPO_TASK = 'Add the second routed module MARK-SILENT  {agent=tdd-guide effort=low}';

/** A task routed to an agent neither root defines. */
const ROUTED_NOWHERE_TASK = 'Add the third routed module MARK-SILENT  {agent=code-reviewer effort=medium}';

/** Writes a definition of `name` under `root`, declaring `effort`. */
function plantDefinition(root: string, name: string, effort: string): void {
  const dir = join(root, '.claude', 'agents');
  mkdirSync(dir, { recursive: true });
  const text = ['---', `name: ${name}`, 'description: A stand-in definition.', `effort: ${effort}`, '---', 'The body.', ''];
  writeFileSync(join(dir, `${name}.md`), text.join('\n'), 'utf8');
}
