/**
 * `rafa stretch item` dispatched in planted projects under the temp
 * directory, every process behind a fake: `plan create` writes the plan
 * file a real planner would, the detached loop writes its session record
 * through `beginSession` and a line into the log, and `loop wait`
 * answers a code the case picks. The config, `plan.dir`, the session
 * records, the stretch folder and the log are real files.
 *
 * Every dry run and refusal finds no stretch folder and no fake called;
 * the full run finds the folder and the log made, so a reading that
 * could not tell the two apart would fail there.
 */
import type { LaunchedLoop, StretchItemSeams } from './item.js';
import type { CapturedRun, PlantedProject } from '../../tests/cli-capture.js';

import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { beginSession } from '../../loop/sessions.js';
import { eventsFilePath } from '../../start/loop-events.js';
import { dispatchInProject, plantProject } from '../../tests/cli-capture.js';

import {
  createStretchItemCommand,
  defaultStretchItemSeams,
  issuePlans,
  itemLogPath,
  RECORD_WAIT_MS,
  stretchOfBase,
} from './item.js';

const scope = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-stretch-item-')));
afterAll(() => {
  rmSync(scope, { recursive: true, force: true });
});

/** The subject the command sits under, declared for the registry the test dispatches over. */
const STRETCH_SUBJECT = { name: 'stretch', summary: 'stretches' };

/** A config pointing `pr.base` at stretch 4. */
const STRETCH_CONFIG = 'version: 1\npr:\n  base: stretch/4\n';

/** The plan `plan create` writes for #812. */
const PLAN = '.rafa/plans/PLAN-rafa-812-pit-readings.md';

/** The session id the fake loop's record carries. */
const SESSION_ID = 'loop-812-session';

/** The pid the fake loop runs as, and the only one the probe reads as alive. */
const LOOP_PID = 4242;

/** The clock every case starts at. */
const START = Date.parse('2026-10-07T09:00:00.000Z');

/** What a case changes about the fakes. */
interface CaseOptions {
  readonly config?: string;
  /** The exit code `plan create` answers; 0 when left out. */
  readonly planExit?: number;
  /** Whether `plan create` writes the plan; true when left out. */
  readonly writesPlan?: boolean;
  /** The exit code `loop wait` answers; 0 when left out. */
  readonly waitExit?: number;
  /** Whether the loop writes its record; true when left out. */
  readonly writesRecord?: boolean;
  /** The exit code the loop has ended with, or null while it runs. */
  readonly loopExit?: number | null;
  /** Whether the launch fails to start a child. */
  readonly launchFails?: boolean;
  /** How far the clock moves at each sleep. */
  readonly tickMs?: number;
}

/** A planted project and the fakes one case runs with. */
interface Case {
  readonly project: PlantedProject;
  readonly rafaCalls: { argv: string[]; env: Record<string, string> }[];
  readonly launches: { argv: string[]; env: Record<string, string>; log: string; cwd: string }[];
  readonly ghCalls: string[][];
  readonly seams: StretchItemSeams;
}

/** Writes a plan file under the project's `plan.dir`. */
function writePlan(root: string, plan: string): void {
  mkdirSync(join(root, '.rafa', 'plans'), { recursive: true });
  writeFileSync(join(root, plan), '# Plan\n\n- [ ] a task\n');
}

/** Writes the loop's session record, as `loop start` does once it opens its session. */
function writeRecord(root: string, startedAt: string, sessionId = SESSION_ID, pid = LOOP_PID): void {
  beginSession(root, {
    sessionId,
    planStub: 'rafa-812-pit-readings',
    plan: PLAN,
    branch: 'feat/rafa-812-pit-readings',
    pid,
    startedAt,
  }, { isAlive: (pid) => pid === LOOP_PID });
}

/** A project planted with `options.config`, and fakes recording every process. */
function plant(options: CaseOptions = {}): Case {
  const caseDir = realpathSync(mkdtempSync(join(scope, 'case-')));
  const project = plantProject(caseDir, options.config ?? STRETCH_CONFIG);
  const rafaCalls: Case['rafaCalls'] = [];
  const launches: Case['launches'] = [];
  const ghCalls: string[][] = [];
  let clock = START;
  const seams: StretchItemSeams = {
    runRafa: async (argv, _cwd, env) => {
      rafaCalls.push({ argv: [...argv], env: { ...env } });
      if (argv[1] === 'plan') {
        if (options.writesPlan ?? true) writePlan(project.root, PLAN);
        return Promise.resolve(options.planExit ?? 0);
      }
      return Promise.resolve(options.waitExit ?? 0);
    },
    launch: (argv, cwd, env, log): LaunchedLoop | null => {
      launches.push({ argv: [...argv], env: { ...env }, log, cwd });
      if (options.launchFails === true) return null;
      writeFileSync(log, 'rafa· loop started\nrafa· refused: the plan is running elsewhere\n', { flag: 'a' });
      if (options.writesRecord ?? true) writeRecord(project.root, new Date(clock).toISOString());
      return { pid: LOOP_PID, exitCode: () => options.loopExit ?? null };
    },
    isAlive: (pid) => pid === LOOP_PID,
    gh: () => async (args) => {
      ghCalls.push([...args]);
      // A pull request into the default branch, so the merge half refuses it before it merges; its cases are item-merge.test.ts's.
      const row = { baseRefName: 'main', body: '', headRefName: 'feat/rafa-812-pit-readings', mergeCommit: null, number: Number(args[2]), state: 'OPEN' };
      return Promise.resolve({ ok: true, stdout: JSON.stringify(row), stderr: '' });
    },
    tracker: () => ({ openIssues: async () => Promise.resolve([]) }),
    filedAt: () => undefined,
    sleep: async () => {
      clock += options.tickMs ?? 0;
      return Promise.resolve();
    },
    now: () => new Date(clock),
    rafa: ['rafa'],
  };
  return { project, rafaCalls, launches, ghCalls, seams };
}

/** Dispatches `stretch item` with `words` in the case's project. */
async function run(planted: Case, words: readonly string[]): Promise<CapturedRun> {
  const command = createStretchItemCommand(planted.seams);
  return dispatchInProject(['stretch', 'item', ...words], [STRETCH_SUBJECT], [command], planted.project, { PATH: '/fake/bin' });
}

/** The stretch folder `n` of the case's project. */
function folder(planted: Case, n: number): string {
  return join(planted.project.root, '.rafa', 'stretch', String(n));
}

/** The index of each line in `stdout`, which must hold every one. */
function positions(stdout: string, lines: readonly string[]): number[] {
  return lines.map((line) => {
    const at = stdout.indexOf(line);
    expect(at, `stdout holds ${JSON.stringify(line)}`).toBeGreaterThanOrEqual(0);
    return at;
  });
}

/** True when `numbers` rise from first to last. */
function rising(numbers: readonly number[]): boolean {
  return numbers.every((value, index) => index === 0 || value > (numbers[index - 1] ?? -1));
}

describe('stretchOfBase', () => {
  it('reads the stretch a stretch/<n> branch names', () => {
    expect(stretchOfBase('stretch/4')).toBe(4);
    expect(stretchOfBase('stretch/12')).toBe(12);
  });

  it('reads null for no base, the default branch and a stretch branch with no number', () => {
    expect(stretchOfBase(null)).toBeNull();
    expect(stretchOfBase('main')).toBeNull();
    expect(stretchOfBase('stretch/')).toBeNull();
    expect(stretchOfBase('stretch/0')).toBeNull();
    expect(stretchOfBase('stretch/4-fixes')).toBeNull();
    expect(stretchOfBase('feat/stretch/4')).toBeNull();
  });
});

describe('issuePlans', () => {
  it('finds the plans of one issue and none of an issue whose number it opens with', () => {
    const dir = realpathSync(mkdtempSync(join(scope, 'plans-')));
    for (const name of ['PLAN-rafa-812-a.md', 'PLAN_TRACKER-rafa-812-a.md', 'PLAN-rafa-8120-b.md', 'PLAN-rafa-81-c.md', 'PREREQUISITES-rafa-812-a.md']) {
      writeFileSync(join(dir, name), '');
    }

    expect(issuePlans({ label: '.rafa/plans', path: dir }, 812)).toEqual(['.rafa/plans/PLAN-rafa-812-a.md']);
    expect(issuePlans({ label: '.rafa/plans', path: dir }, 81)).toEqual(['.rafa/plans/PLAN-rafa-81-c.md']);
    expect(issuePlans({ label: '.rafa/plans', path: join(dir, 'missing') }, 812)).toEqual([]);
  });
});

describe('rafa stretch item, a full run', () => {
  it('plans the issue, starts its loop detached into the stretch log, and prints the session', async () => {
    const planted = plant();

    const outcome = await run(planted, ['812']);

    expect(outcome.exitCode).toBe(0);
    expect(planted.rafaCalls.map((call) => call.argv)).toEqual([['rafa', 'plan', 'create', '--issue=812']]);
    expect(planted.rafaCalls[0]?.env['RAFA_OUTPUT']).toBeUndefined();
    const log = itemLogPath(planted.project.root, 4, 812);
    expect(planted.launches).toHaveLength(1);
    expect(planted.launches[0]?.argv).toEqual(['rafa', 'loop', 'start', `--plan=${PLAN}`, '--as-worktree', '--no-ci-wait']);
    expect(planted.launches[0]?.env['RAFA_OUTPUT']).toBe('events');
    expect(planted.launches[0]?.env['PATH']).toBe('/fake/bin');
    expect(planted.launches[0]?.log).toBe(log);
    expect(planted.launches[0]?.cwd).toBe(planted.project.root);
    expect(log).toBe(join(folder(planted, 4), 'loop-812.log'));
    expect(readFileSync(log, 'utf8')).toContain('rafa· loop started');
    expect(rising(positions(outcome.stdout, [
      'stretch item #812: stretch 4 (pr.base stretch/4)',
      'rafa plan create --issue=812',
      `RAFA_OUTPUT=events rafa loop start --plan=${PLAN} --as-worktree --no-ci-wait >> ${log} 2>&1 &`,
      `loop running: session ${SESSION_ID}, pid ${String(LOOP_PID)}, ${PLAN}`,
      `log: ${log}`,
      `wait on it with: rafa loop wait --session-id=${SESSION_ID}`,
    ]))).toBe(true);
  });

  it('keeps a plan of the issue already there and runs no plan create', async () => {
    const planted = plant();
    writePlan(planted.project.root, PLAN);

    const outcome = await run(planted, ['812']);

    expect(outcome.exitCode).toBe(0);
    expect(planted.rafaCalls).toEqual([]);
    expect(outcome.stdout).toContain(`keep ${PLAN}, written by an earlier plan create`);
    expect(planted.launches[0]?.argv).toContain(`--plan=${PLAN}`);
  });

  it('with --wait, runs loop wait on the session and exits with its code', async () => {
    const planted = plant({ waitExit: 10 });

    const outcome = await run(planted, ['812', '--wait']);

    expect(outcome.exitCode).toBe(10);
    expect(planted.rafaCalls.map((call) => call.argv)).toEqual([
      ['rafa', 'plan', 'create', '--issue=812'],
      ['rafa', 'loop', 'wait', `--session-id=${SESSION_ID}`],
    ]);
    expect(outcome.stdout).toContain(`rafa loop wait --session-id=${SESSION_ID}`);
    expect(outcome.stdout).not.toContain('wait on it with');
    expect(outcome.stderr).toContain('ended with exit code 10');
  });

  it('with --wait and a loop wait answering pr, hands the pull request the events file names to the merge half', async () => {
    const planted = plant();
    mkdirSync(join(planted.project.root, '.rafa', 'runs'), { recursive: true });
    const prEvent = { name: 'pr', summary: 'pr #901 opened', data: { number: 901 }, ts: '2026-10-07T09:10:00.000Z' };
    writeFileSync(eventsFilePath(planted.project.root, SESSION_ID), `${JSON.stringify(prEvent)}\n`);

    const outcome = await run(planted, ['812', '--wait']);

    expect(planted.rafaCalls).toHaveLength(2);
    expect(planted.ghCalls[0]?.slice(0, 3)).toEqual(['pr', 'view', '901']);
    expect(outcome.exitCode).toBe(1);
    expect(outcome.stderr).toContain('#901 opens into main, not a stretch/* branch');
  });

  it('reads a record started before the launch as another run, and waits for the new one', async () => {
    const planted = plant({ writesRecord: false, tickMs: RECORD_WAIT_MS });
    writePlan(planted.project.root, PLAN);
    // An earlier run of the plan, ended: its pid is not the live one.
    writeRecord(planted.project.root, '2026-10-06T09:00:00.000Z', 'old-run', 1);

    const outcome = await run(planted, ['812']);

    expect(outcome.exitCode).toBe(0);
    expect(outcome.stdout).not.toContain('session old-run');
    expect(outcome.stdout).toContain(`the loop (pid ${String(LOOP_PID)}) has written no session record yet; it still runs`);
  });
});

describe('rafa stretch item, steps that fail', () => {
  it('ends with plan create\'s own code, and starts no loop', async () => {
    const planted = plant({ planExit: 3, writesPlan: false });

    const outcome = await run(planted, ['812']);

    expect(outcome.exitCode).toBe(3);
    expect(planted.launches).toEqual([]);
    expect(outcome.stderr).toContain('rafa plan create --issue=812 ended with exit code 3; no loop was started.');
    expect(existsSync(folder(planted, 4))).toBe(false);
  });

  it('ends 2 when plan create ends 0 and wrote no plan of the issue', async () => {
    const planted = plant({ writesPlan: false });

    const outcome = await run(planted, ['812']);

    expect(outcome.exitCode).toBe(2);
    expect(planted.launches).toEqual([]);
    expect(outcome.stderr).toContain('wrote no rafa-812-* plan in .rafa/plans');
  });

  it('ends 2 with the log\'s last lines when the loop ends before writing a record', async () => {
    const planted = plant({ writesRecord: false, loopExit: 1 });

    const outcome = await run(planted, ['812']);

    expect(outcome.exitCode).toBe(2);
    expect(outcome.stderr).toContain(`the loop (pid ${String(LOOP_PID)}) ended with exit code 1 before it wrote a session record`);
    expect(outcome.stderr).toContain('  rafa· refused: the plan is running elsewhere');
  });

  it('shows only the lines this launch appended to a log an earlier item left', async () => {
    const planted = plant({ writesRecord: false, loopExit: 1 });
    mkdirSync(folder(planted, 4), { recursive: true });
    writeFileSync(itemLogPath(planted.project.root, 4, 812), 'rafa· from the earlier item\n');

    const outcome = await run(planted, ['812']);

    expect(outcome.exitCode).toBe(2);
    expect(readFileSync(itemLogPath(planted.project.root, 4, 812), 'utf8')).toStartWith('rafa· from the earlier item\n');
    expect(outcome.stderr).toContain('rafa· loop started');
    expect(outcome.stderr).not.toContain('from the earlier item');
  });

  it('ends 2 when the loop cannot start', async () => {
    const planted = plant({ launchFails: true });

    const outcome = await run(planted, ['812']);

    expect(outcome.exitCode).toBe(2);
    expect(outcome.stderr).toContain(`the loop could not start; ${PLAN} is planned and no loop runs.`);
  });
});

describe('rafa stretch item --dry-run', () => {
  it('prints the plan create and the detached loop lines in order and runs neither', async () => {
    const planted = plant();

    const outcome = await run(planted, ['812', '--dry-run', '--wait']);

    expect(outcome.exitCode).toBe(0);
    expect(planted.rafaCalls).toEqual([]);
    expect(planted.launches).toEqual([]);
    expect(existsSync(folder(planted, 4))).toBe(false);
    const log = itemLogPath(planted.project.root, 4, 812);
    expect(rising(positions(outcome.stdout, [
      'stretch item #812: stretch 4 (pr.base stretch/4), dry run: each step is printed and none is run',
      'rafa plan create --issue=812',
      `RAFA_OUTPUT=events rafa loop start --plan=.rafa/plans/PLAN-rafa-812-<slug>.md --as-worktree --no-ci-wait >> ${log} 2>&1 &`,
      'rafa loop wait --session-id=<session id>',
      'dry run: would start the loop of #812 for stretch/4; nothing was run',
    ]))).toBe(true);
  });

  it('names a plan already there in the loop line', async () => {
    const planted = plant();
    writePlan(planted.project.root, PLAN);

    const outcome = await run(planted, ['812', '--dry-run']);

    expect(outcome.exitCode).toBe(0);
    expect(planted.launches).toEqual([]);
    expect(outcome.stdout).toContain(`rafa loop start --plan=${PLAN} --as-worktree --no-ci-wait`);
    expect(outcome.stdout).not.toContain('rafa loop wait');
  });
});

describe('rafa stretch item, refusals', () => {
  it.each([
    ['the default branch', 'version: 1\npr:\n  base: main\n', 'pr.base is "main", expected a stretch/<n> branch'],
    ['no pr.base', 'version: 1\n', 'pr.base is not set, so pull requests open into the default branch'],
    ['a stretch branch with no number', 'version: 1\npr:\n  base: stretch/next\n', 'pr.base is "stretch/next"'],
  ])('refuses %s as the base, running nothing', async (_name, config, said) => {
    const planted = plant({ config });

    const outcome = await run(planted, ['812']);

    expect(outcome.exitCode).toBe(1);
    expect(outcome.stderr).toContain(said);
    expect(outcome.stderr).toContain('Nothing was run.');
    expect(planted.rafaCalls).toEqual([]);
    expect(planted.launches).toEqual([]);
  });

  it.each([
    [[], 'Expected one argument, got none'],
    [['812', '813'], 'Expected one argument, got 2: 812 813'],
    [['#812'], '"#812" is no issue number'],
    [['0'], '"0" is no issue number'],
    [['812', '--wait=soon'], '--wait takes no value'],
  ])('refuses the line %j', async (words, said) => {
    const planted = plant();

    const outcome = await run(planted, words);

    expect(outcome.exitCode).toBe(1);
    expect(outcome.stderr).toContain(said);
    expect(planted.rafaCalls).toEqual([]);
  });

  it('refuses two plans of the issue', async () => {
    const planted = plant();
    writePlan(planted.project.root, PLAN);
    writePlan(planted.project.root, '.rafa/plans/PLAN-rafa-812-other.md');

    const outcome = await run(planted, ['812']);

    expect(outcome.exitCode).toBe(1);
    expect(outcome.stderr).toContain('.rafa/plans holds 2 plans of #812');
    expect(planted.launches).toEqual([]);
  });

  it('refuses while a loop of the issue\'s plan runs, and starts no second one', async () => {
    const planted = plant();
    writePlan(planted.project.root, PLAN);
    writeRecord(planted.project.root, '2026-10-07T08:00:00.000Z', 'running-812');

    const outcome = await run(planted, ['812', '--dry-run']);

    expect(outcome.exitCode).toBe(1);
    expect(outcome.stderr).toContain('a loop of rafa-812-pit-readings runs already: session running-812');
    expect(outcome.stderr).toContain('rafa loop wait --session-id=running-812');
    expect(planted.launches).toEqual([]);
  });
});

describe('the real launch', () => {
  it('appends both streams of a detached child to the log, and reads its exit code once it ends', async () => {
    const dir = realpathSync(mkdtempSync(join(scope, 'launch-')));
    const log = join(dir, 'loop.log');
    writeFileSync(log, 'before\n');
    const script = 'echo "out $RAFA_OUTPUT"; echo err >&2; exit 3';

    const launched = defaultStretchItemSeams().launch(['sh', '-c', script], dir, { PATH: process.env['PATH'] ?? '', RAFA_OUTPUT: 'events' }, log);
    expect(launched).not.toBeNull();
    for (let tries = 0; tries < 200 && launched?.exitCode() === null; tries += 1) await Bun.sleep(10);

    expect(launched?.exitCode()).toBe(3);
    expect(readFileSync(log, 'utf8')).toBe('before\nout events\nerr\n');
  });

  it('answers null for a program that cannot start', () => {
    const dir = realpathSync(mkdtempSync(join(scope, 'launch-')));

    expect(defaultStretchItemSeams().launch([join(dir, 'no-such-program')], dir, {}, join(dir, 'loop.log'))).toBeNull();
  });
});

describe('the registered command', () => {
  it('spends unless --dry-run, and takes the issue and two switches', () => {
    const command = createStretchItemCommand(plant().seams);

    expect(command.name).toBe('stretch item');
    expect(command.spends).toEqual({ when: 'unless', flag: '--dry-run', what: 'one planning session and the loop it starts' });
    expect(command.args.map((arg) => arg.name)).toEqual(['issue']);
    expect(command.flags.map((flag) => flag.name)).toEqual(['wait', 'dry-run']);
  });
});
