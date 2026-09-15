/**
 * `rafa loop start` writing through the active output, and refusing by
 * throwing `CommandExit` for the dispatcher to end the invocation with.
 *
 * ## The source cases
 *
 * `src/start.ts`, `src/start/run-config.ts`, `src/start/commit.ts`,
 * `src/start/wrap-up.ts`, `src/start/dispatch.ts`,
 * `src/start/pr-lifecycle.ts`, `src/utils/claude.ts` and
 * `src/utils/schedule.ts` hold no `console` member and no `process.exit`
 * in their code, and each calls `activeOutput()`. Each is parsed with
 * TypeScript and walked by `source-uses.ts`, so a comment or a string
 * naming either is no reading. The control walks a planted source holding
 * each in code, in a comment and in a string.
 *
 * ## The command cases
 *
 * `start()` takes its root from the project the dispatcher resolves and
 * spawns `claude` off PATH, so it is run as `bun src/rafa.ts loop start`
 * in a scratch repository holding `.rafa/config.yaml`, with a
 * HOME of its own, under a PATH holding a stand-in `claude` and git's own
 * directory, in an environment holding nothing else but `RAFA_OUTPUT` for
 * json mode. Each run first asserts that `claude` resolves to the
 * stand-in. The stand-in drains its prompt with the shell's own `read`,
 * notes the call outside the repository, writes the stdout its planting
 * names with `/bin/cat`, and exits with the code its planting names.
 *
 *   - **The three refusals**: an unusable config, a plan file that does
 *     not exist and the `main` branch. In text mode each writes its
 *     refusal to stderr as one message and nothing to stdout, the bytes
 *     the loop printed through `console.error` line by line before it
 *     threw instead. In json mode stdout holds the start event and one
 *     terminal result carrying the refusal. None reaches the stand-in,
 *     which the run with no open task shows being reached.
 *   - **A run with no open task**, on a plan branch with no type prefix
 *     and over a plan holding a block never closed: every line the loop,
 *     `run-config.ts` and `wrap-up.ts` write, in order, as `log` events
 *     of their levels in json mode, each line NDJSON. In text mode the
 *     `info` lines are written as `console.log` wrote them, and each
 *     warning as the `text` adapter writes one: on stdout, after
 *     `warn: `, where `console.warn` wrote it bare on stderr.
 *   - **A failed session**, whose stand-in writes a blank line and a last
 *     line with no newline: every line NDJSON, from the task's one `step`
 *     event to the result. The step comes ahead of the line announcing the
 *     task, each line of the session's stdout is an `info` event, the
 *     failure is the run's one error event, and the missing report is
 *     warned about after it. The run ends by its return, as a success
 *     with exit code 0.
 *   - **A run whose task and wrap-up sessions both write that stdout**: in
 *     json mode the same step, and the session lines twice, once through
 *     the task session's tee and once through the wrap-up, which spawns
 *     through `runClaude`. In text mode there is no step line and no
 *     event, and the bytes of both sessions come out as they were written,
 *     the last line running into the loop's next one.
 *
 * Both session cases run under `--inject=full`, so no injection fallback
 * warning sits among the lines they read.
 *
 * ## Readings
 *
 * A probe over the same plantings, spawning `loop start` in both modes,
 * ran on 2026-09-14 before this change at `c3a5a6d` and after it. The
 * text-mode stdout and stderr of all three refusals came out
 * byte-identical. In json mode each refusal went from the start event
 * alone, with the refusal on stderr, to the start event and the terminal
 * result, with stderr empty. The info lines of a run with no open task
 * came out as before, and its warnings moved from stderr to stdout after
 * `warn: `.
 *
 * Twelve mutations of the four modules were driven the same day, each
 * against the suites reading the line it changed, each file restored
 * sha256-identical and the six suites green before and after, and every
 * one reddened at least one case: a refused commit or a failed task
 * written at `warn`; a branch warning or the plan issues header written
 * at `info`; the done line, the tracker line or the wrap-up line back on
 * `console.log`; the config warnings left to `console.warn`; the config
 * refusal thrown with no message; the plan-not-found message changed; the
 * branch refusal thrown with exit code 2; and an interrupted task exiting
 * 1, which reddened the interrupt case of `task-report.test.ts` alone.
 *
 * The session cases came with `start/dispatch.ts`, `start/pr-lifecycle.ts`,
 * `utils/claude.ts` and `utils/schedule.ts` joining the scan. Twenty
 * mutations of those modules, the dispatcher and `active.ts` were driven
 * on 2026-09-15, one run each over ten suites, with 228 pass before and
 * after and every file restored sha256-identical. These cases reddened
 * under each leg reaching `loop start`'s stream:
 *   - the step never emitted, or named otherwise: both json cases;
 *   - the step emitted in text mode too: the text case alone;
 *   - the tee's mode inverted: all three session cases;
 *   - a last line left unflushed, blank lines dropped, or bytes written in
 *     json mode as well: both json cases;
 *   - `spawnClaude` never piping in json mode: the json run with a
 *     wrap-up alone;
 *   - the dispatcher setting no mode, or a stored report's warning written
 *     at `info`: both json cases;
 *   - the line announcing a task back on `console.log`: both json cases
 *     and the source case of `start/dispatch.ts`.
 */
import type { CliEvent } from '../ports/index.js';

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

import { CONFIG_DEFAULTS } from '../config.js';
import { parsePlan } from '../plan/index.js';

import { plantProjectConfig } from './cli-capture.js';
import { consoleAndExitUses } from './source-uses.js';

/** The `src/` directory. */
const SRC_DIR = fileURLToPath(new URL('../', import.meta.url));

/** The CLI entry every command case runs. */
const RAFA_ENTRY = join(SRC_DIR, 'rafa.ts');

/** The modules held to the active output, from `src/`. */
const ROUTED_MODULES: string[] = [
  'start.ts',
  'start/run-config.ts',
  'start/commit.ts',
  'start/wrap-up.ts',
  'start/dispatch.ts',
  'start/pr-lifecycle.ts',
  'utils/claude.ts',
  'utils/schedule.ts',
];

describe('the modules loop start writes through', () => {
  it.each(ROUTED_MODULES)('holds no console member and no process.exit in the code of %s', (path) => {
    const source = readFileSync(join(SRC_DIR, path), 'utf8');

    expect(consoleAndExitUses(source)).toEqual([]);
    expect(source).toContain('activeOutput()');
  });

  it('reads a console member and a process.exit in code, and neither in a comment or a string', () => {
    const planted = [
      '// console.log(\'a comment\'); process.exit(1);',
      'const note = \'console.error and process.exit(2)\';',
      'console.warn(note);',
      'if (note === \'\') process.exit(1);',
      'console[\'log\'](note);',
      'process.exitCode = 1;',
    ].join('\n');

    expect(consoleAndExitUses(planted)).toEqual(['3: console.warn', '4: process.exit', '5: console.log']);
  });
});

/** A scratch directory of this file's own, its path resolved as git answers it. */
const tempRoot = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-loop-output-')));

afterAll(() => {
  rmSync(tempRoot, { recursive: true, force: true });
});

/** The plan stub every planting runs. */
const STUB = 'probe';

/** The flag naming the planted plan. */
const PLAN_FLAG = `--plan=.plans/PLAN-${STUB}.md`;

/** The one task the open plan holds. */
const TASK = 'A task for the stand-in';

/** A plan holding one open task. */
const PLAN_OPEN = `# Plan: ${STUB}\n\n- [ ] ${TASK}\n`;

/** A plan holding no open task, and a block never closed after its last task. */
const PLAN_DONE = `# Plan: ${STUB}\n\n- [x] A finished task\n\n\`\`\`rafa:notes\na note never closed\n`;

/** What a session stand-in writes to stdout: a blank line, and a last line with no newline. */
const SESSION_STDOUT = 'session line one\n\nsession line two';

/** {@link SESSION_STDOUT} as json mode carries it, one `info` event per line, each as {@link labelOf} spells it. */
const SESSION_LINES: readonly string[] = ['info:session line one', 'info:', 'info:session line two'];

/** The flags a session case runs with: the whole plan injected, so no fallback warning sits among its lines. */
const SESSION_FLAGS: readonly string[] = [PLAN_FLAG, '--no-ci-wait', '--inject=full'];

/** The line announcing the wrap-up session. */
const WRAP_UP_STARTING = '🧹 Wrap-up session starting: promote progress.txt findings, sync with main, then commit, push and open the PR.';

/** The line after it, saying the wrap-up is one quiet session. */
const WRAP_UP_QUIET = '   This is one full Claude session with no intermediate output — expect several quiet minutes. Interrupting it skips the push and PR; if that happens, run again to retry just this stage.';

/** The line a wrap-up session that exited 0 ends with. */
const PROGRESS_PRESERVED = '\n✅ Progress preserved; PR opened or updated on this branch.';

/** The warning a session that wrote no report is stored with, as {@link labelOf} spells it. */
const NO_REPORT_WARNING = /^warn: {3}No task report: .+; recorded as telemetry$/;

/** How long a case may run, over the kill below. */
const RUN_TIMEOUT = { timeout: 60_000 };

/** How long one run may take before it is killed, so a run that never stops fails its case. */
const KILL_AFTER_MS = 45_000;

/** What a scratch repository is planted with. */
interface Planting {
  /** The branch checked out. */
  readonly branch: string;
  /** The plan at `.plans/PLAN-probe.md`, or null for none. */
  readonly plan: string | null;
  /** `.rafa/config.yaml`; the file `rafa init` writes when absent, so every run stands in a project. */
  readonly config?: string;
  /** The exit code the stand-in answers every call with. Defaults to 0. */
  readonly claudeExit?: number;
  /** What the stand-in writes to stdout on every call, byte for byte. Defaults to nothing. */
  readonly claudeStdout?: string;
}

/** One planted scratch repository and what a run under it reads. */
interface Scratch {
  readonly repo: string;
  readonly home: string;
  /** The stand-in `claude`. */
  readonly claude: string;
  /** The file the stand-in appends a line to per call, outside the repository. */
  readonly callLog: string;
  /** The PATH a run gets: the stand-in, then git's own directory. */
  readonly path: string;
}

let planted = 0;

/** Runs git in a scratch repository under that scratch HOME. */
function git(cwd: string, home: string, ...args: string[]): void {
  execFileSync('git', args, {
    cwd,
    stdio: 'pipe',
    env: { ...process.env, HOME: home, GIT_CONFIG_GLOBAL: join(home, '.gitconfig'), GIT_CONFIG_NOSYSTEM: '1' },
  });
}

/** Plants a scratch repository, its HOME and its stand-in. */
function plant(planting: Planting): Scratch {
  planted += 1;
  const root = join(tempRoot, `run-${planted}`);
  const repo = join(root, 'repo');
  const bin = join(root, 'bin');
  const home = join(root, 'home');
  for (const dir of [repo, bin, home]) mkdirSync(dir, { recursive: true });

  const callLog = join(root, 'calls.log');
  const claudeStdout = join(root, 'claude-stdout.txt');
  writeFileSync(claudeStdout, planting.claudeStdout ?? '', 'utf8');
  const claude = join(bin, 'claude');
  writeFileSync(claude, [
    '#!/bin/sh',
    'while read -r _line; do :; done',
    `echo called >> '${callLog}'`,
    `/bin/cat '${claudeStdout}'`,
    `exit ${planting.claudeExit ?? 0}`,
    '',
  ].join('\n'), 'utf8');
  chmodSync(claude, 0o755);

  git(repo, home, 'init', '-q', '.');
  git(repo, home, 'config', 'user.email', 'loop@example.test');
  git(repo, home, 'config', 'user.name', 'Rafa Loop');
  git(repo, home, 'config', 'commit.gpgsign', 'false');
  writeFileSync(join(repo, '.gitignore'), 'progress.txt\n.plans/\n.rafa/\n', 'utf8');
  git(repo, home, 'add', '-A');
  git(repo, home, 'commit', '-q', '--no-verify', '-m', 'seed');
  git(repo, home, 'checkout', '-q', '-B', planting.branch);

  if (planting.plan !== null) {
    mkdirSync(join(repo, '.plans'));
    writeFileSync(join(repo, '.plans', `PLAN-${STUB}.md`), planting.plan, 'utf8');
  }
  plantProjectConfig(repo, planting.config);

  const gitBinary = Bun.which('git');
  if (gitBinary === null) throw new Error('git is not on the PATH this suite runs under');
  return { repo, home, claude, callLog, path: [bin, dirname(gitBinary)].join(delimiter) };
}

/** What one `rafa loop start` run did. */
interface LoopRun {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

/** Runs `rafa loop start` in a scratch repository, in one output mode. */
function runLoopStart(scratch: Scratch, mode: 'text' | 'json', flags: readonly string[]): LoopRun {
  const resolved = Bun.which('claude', { PATH: scratch.path });
  if (resolved !== scratch.claude) {
    throw new Error(`claude resolves to ${String(resolved)}, not the stand-in`);
  }
  const env: Record<string, string> = { PATH: scratch.path, HOME: scratch.home };
  if (mode === 'json') env.RAFA_OUTPUT = 'json';
  const run = Bun.spawnSync([process.execPath, RAFA_ENTRY, 'loop', 'start', ...flags], {
    cwd: scratch.repo,
    env,
    timeout: KILL_AFTER_MS,
  });
  return { exitCode: run.exitCode, stdout: run.stdout.toString(), stderr: run.stderr.toString() };
}

/** Every line of a json-mode stdout, parsed. Throws on a line that is no JSON. */
function eventsOf(stdout: string): CliEvent[] {
  return stdout
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => JSON.parse(line) as CliEvent);
}

/** An event as one string: `<level>:<message>` for a log, `step:<name>` for a step, and its type for the rest. */
function labelOf(event: CliEvent): string {
  switch (event.type) {
    case 'log':
      return `${event.level}:${event.message}`;
    case 'step':
      return `step:${event.name}`;
    case 'start':
    case 'result':
      return event.type;
  }
}

/** The labels from `first` to the next `last` after it, both kept. Throws when either is missing. */
function span(labels: readonly string[], first: string, last: string): string[] {
  const from = labels.indexOf(first);
  const to = from === -1
    ? -1
    : labels.indexOf(last, from);
  if (to === -1) {
    throw new Error(`no span from ${JSON.stringify(first)} to ${JSON.stringify(last)} in ${JSON.stringify(labels)}`);
  }
  return labels.slice(from, to + 1);
}

/** How one refusal is planted and run, and the refusal it answers. */
interface RefusalCase {
  readonly planting: Planting;
  readonly flags: readonly string[];
  readonly refusal: (scratch: Scratch) => string;
}

const REFUSALS: readonly (readonly [string, RefusalCase])[] = [
  ['an unusable config', {
    planting: { branch: `feat/${STUB}`, plan: PLAN_OPEN, config: 'plan:\n  inject: stages\n' },
    flags: [PLAN_FLAG, '--no-ci-wait'],
    refusal: (scratch) => [
      '❌ Refusing to start on this configuration:',
      `   ${join(scratch.repo, '.rafa', 'config.yaml')}: plan.inject is "stages", expected one of: full, stage, task`,
    ].join('\n'),
  }],
  ['a plan file that does not exist', {
    planting: { branch: `feat/${STUB}`, plan: null },
    flags: ['--plan=.plans/PLAN-missing.md', '--no-ci-wait'],
    refusal: (scratch) => `❌ Plan file not found: ${join(scratch.repo, '.plans', 'PLAN-missing.md')}`,
  }],
  ['the main branch', {
    planting: { branch: 'main', plan: PLAN_OPEN },
    flags: [PLAN_FLAG, '--no-ci-wait'],
    refusal: () => [
      '\n❌ Refusing to run a plan on `main`.',
      '   A plan run needs its own branch: that is what gives it a PR to',
      '   review, and what lets the wrap-up\'s CI stage have something to',
      '   wait on. Run on main and both are silently skipped.',
      `\n   git checkout -b feat/${STUB}`,
      '\n   Pass --any-branch to run here anyway.',
    ].join('\n'),
  }],
];

describe('loop start refusing', () => {
  it.each(REFUSALS)('refuses %s: on stderr in text mode, in the terminal result in json mode', (_label, refusalCase) => {
    const { planting, flags, refusal } = refusalCase;
    const textScratch = plant(planting);
    const jsonScratch = plant(planting);

    const text = runLoopStart(textScratch, 'text', flags);
    const json = runLoopStart(jsonScratch, 'json', flags);

    expect(text).toEqual({ exitCode: 1, stdout: '', stderr: `${refusal(textScratch)}\n` });

    expect(json.exitCode).toBe(1);
    expect(json.stderr).toBe('');
    expect(eventsOf(json.stdout)).toEqual([
      { type: 'start', command: 'loop start', ts: expect.any(String) },
      {
        type: 'result',
        ok: false,
        error: { code: 'command_exit', message: refusal(jsonScratch) },
        ts: expect.any(String),
      },
    ]);

    expect([existsSync(textScratch.callLog), existsSync(jsonScratch.callLog)]).toEqual([false, false]);
  }, RUN_TIMEOUT);
});

describe('loop start with no --plan', () => {
  it('runs PLAN.md in plan.dir, reaching the branch refusal rather than a missing plan', () => {
    const scratch = plant({ branch: 'main', plan: null });
    mkdirSync(join(scratch.repo, '.rafa', 'plans'), { recursive: true });
    writeFileSync(join(scratch.repo, '.rafa', 'plans', 'PLAN.md'), PLAN_OPEN, 'utf8');

    const run = runLoopStart(scratch, 'text', ['--no-ci-wait']);

    expect(run.exitCode).toBe(1);
    expect(run.stdout).toBe('');
    expect(run.stderr.startsWith('\n❌ Refusing to run a plan on `main`.\n')).toBe(true);
    expect(existsSync(scratch.callLog)).toBe(false);
  }, RUN_TIMEOUT);

  it('reads no .plans/PLAN.md under the default plan.dir, refusing the PLAN.md at the root as missing', () => {
    const scratch = plant({ branch: 'main', plan: null });
    mkdirSync(join(scratch.repo, '.plans'));
    writeFileSync(join(scratch.repo, '.plans', 'PLAN.md'), PLAN_OPEN, 'utf8');

    const run = runLoopStart(scratch, 'text', ['--no-ci-wait']);

    expect(run).toEqual({ exitCode: 1, stdout: '', stderr: `❌ Plan file not found: ${join(scratch.repo, 'PLAN.md')}\n` });
    expect(existsSync(scratch.callLog)).toBe(false);
  }, RUN_TIMEOUT);
});

/** Each line a run with no open task writes, as its level and its message, in order. */
function noTaskLines(): readonly (readonly ['info' | 'warn', string])[] {
  const { issues } = parsePlan(PLAN_DONE);
  if (issues.length === 0) throw new Error('the planted plan holds no issue to announce');
  return [
    ['warn', `\n⚠️  Branch \`${STUB}\` carries no \`<type>/\` prefix.`],
    ['warn', '   The run proceeds; the convention is `feat/<plan-stub>`.'],
    ['info', `🧭 Task sessions are handed the plan as \`${CONFIG_DEFAULTS.inject}\` (the default); the wrap-up is handed all of it.`],
    ['warn', `\n⚠️  The plan holds ${issues.length} part(s) the loop does not read as written:`],
    ...issues.map((issue) => ['warn', `   line ${issue.line}: ${issue.text}`] as const),
    ['info', `📋 Creating new plan tracker at PLAN_TRACKER-${STUB}.md...`],
    ['info', '\n✅ All tasks completed!'],
    ['info', WRAP_UP_STARTING],
    ['info', WRAP_UP_QUIET],
    ['info', PROGRESS_PRESERVED],
  ];
}

describe('a loop start run with no open task', () => {
  it('writes every line as a log event of its level in json mode, each line NDJSON', () => {
    const scratch = plant({ branch: STUB, plan: PLAN_DONE });

    const run = runLoopStart(scratch, 'json', [PLAN_FLAG, '--no-ci-wait']);

    expect(run.exitCode).toBe(0);
    expect(run.stderr).toBe('');
    expect(eventsOf(run.stdout)).toEqual([
      { type: 'start', command: 'loop start', ts: expect.any(String) },
      ...noTaskLines().map(([level, message]) => ({ type: 'log' as const, level, message, ts: expect.any(String) })),
      { type: 'result', ok: true, ts: expect.any(String) },
    ]);

    // The wrap-up reached the stand-in, so a refusal leaving no call is a reading.
    expect(existsSync(scratch.callLog)).toBe(true);
  }, RUN_TIMEOUT);

  it('writes the info lines as console.log did in text mode, and each warning after warn: on stdout', () => {
    const scratch = plant({ branch: STUB, plan: PLAN_DONE });

    const run = runLoopStart(scratch, 'text', [PLAN_FLAG, '--no-ci-wait']);
    const expected = noTaskLines()
      .map(([level, message]) => (level === 'info'
        ? `${message}\n`
        : `warn: ${message}\n`))
      .join('');

    expect(run).toEqual({ exitCode: 0, stdout: expected, stderr: '' });
  }, RUN_TIMEOUT);
});

describe('a loop start run whose session fails', () => {
  it('writes its one step, the session lines as info events and the failure as its one error event, every line NDJSON, and exits 0', () => {
    const scratch = plant({ branch: `feat/${STUB}`, plan: PLAN_OPEN, claudeExit: 3, claudeStdout: SESSION_STDOUT });

    const run = runLoopStart(scratch, 'json', SESSION_FLAGS);
    const events = eventsOf(run.stdout);
    const labels = events.map(labelOf);
    const failure = 'error:\n❌ Task failed (exit 3). Marked as blocked. Run again to retry.';

    expect(run.exitCode).toBe(0);
    expect(run.stderr).toBe('');
    expect(existsSync(scratch.callLog)).toBe(true);
    expect(labels[0]).toBe('start');
    expect(events.at(-1)).toMatchObject({ type: 'result', ok: true });
    expect(labels.filter((label) => label === 'result')).toEqual(['result']);
    expect(events.filter((event) => event.type === 'step')).toEqual([{ type: 'step', name: TASK, ts: expect.any(String) }]);
    expect(labels.filter((label) => label.startsWith('error:'))).toEqual([failure]);
    expect(span(labels, `step:${TASK}`, 'result')).toEqual([
      `step:${TASK}`,
      `info:\n🔄 Executing task: ${TASK}`,
      ...SESSION_LINES,
      failure,
      expect.stringMatching(NO_REPORT_WARNING),
      'result',
    ]);
    expect(readFileSync(join(scratch.repo, '.plans', `PLAN_TRACKER-${STUB}.md`), 'utf8'))
      .toContain(`- [BLOCKED] ${TASK}`);
  }, RUN_TIMEOUT);
});

describe('a loop start run whose task and wrap-up sessions write to stdout', () => {
  const planting: Planting = { branch: `feat/${STUB}`, plan: PLAN_OPEN, claudeStdout: SESSION_STDOUT };

  it('writes one step and each session line as an info event in json mode, every line NDJSON', () => {
    const scratch = plant(planting);

    const run = runLoopStart(scratch, 'json', SESSION_FLAGS);
    const events = eventsOf(run.stdout);
    const labels = events.map(labelOf);
    const steps = events.filter((event) => event.type === 'step');

    expect(run.exitCode).toBe(0);
    expect(run.stderr).toBe('');
    expect(labels[0]).toBe('start');
    expect(events.at(-1)).toMatchObject({ type: 'result', ok: true });
    expect(labels.filter((label) => label === 'result')).toEqual(['result']);
    expect(steps).toEqual([{ type: 'step', name: TASK, ts: expect.any(String) }]);
    expect(new Date(steps[0]?.ts ?? '').toISOString()).toBe(steps[0]?.ts ?? 'no step');
    expect(span(labels, `step:${TASK}`, 'result')).toEqual([
      `step:${TASK}`,
      `info:\n🔄 Executing task: ${TASK}`,
      ...SESSION_LINES,
      `info:✅ Task done: ${TASK}`,
      'info:   Nothing to commit: the task changed no tracked file.',
      expect.stringMatching(NO_REPORT_WARNING),
      'info:\n✅ All tasks completed!',
      `info:${WRAP_UP_STARTING}`,
      `info:${WRAP_UP_QUIET}`,
      ...SESSION_LINES,
      `info:${PROGRESS_PRESERVED}`,
      'result',
    ]);
    expect(readFileSync(scratch.callLog, 'utf8')).toBe('called\ncalled\n');
  }, RUN_TIMEOUT);

  it('echoes the bytes of both sessions in text mode, with no step line and no event', () => {
    const scratch = plant(planting);

    const run = runLoopStart(scratch, 'text', SESSION_FLAGS);

    expect(run.exitCode).toBe(0);
    expect(run.stderr).toBe('');
    expect(run.stdout).toContain(`\n🔄 Executing task: ${TASK}\n${SESSION_STDOUT}✅ Task done: ${TASK}\n`);
    expect(run.stdout).toContain(`${WRAP_UP_QUIET}\n${SESSION_STDOUT}${PROGRESS_PRESERVED}\n`);
    expect(run.stdout.split(SESSION_STDOUT)).toHaveLength(3);
    expect(run.stdout).not.toContain('step: ');
    expect(run.stdout.split('\n').filter((line) => line.startsWith('{'))).toEqual([]);
    expect(readFileSync(scratch.callLog, 'utf8')).toBe('called\ncalled\n');
  }, RUN_TIMEOUT);
});
