/**
 * `rafa loop start` writing through the active output, and refusing by
 * throwing `CommandExit` for the dispatcher to end the invocation with.
 *
 * ## The source cases
 *
 * `src/start.ts`, `src/start/run-config.ts`, `src/start/commit.ts` and
 * `src/start/wrap-up.ts` hold no `console` member and no `process.exit`
 * in their code, and each calls `activeOutput()`. Each is parsed with
 * TypeScript and walked, so a comment or a string naming either is no
 * reading. The control walks a planted source holding each in code, in a
 * comment and in a string.
 *
 * ## The command cases
 *
 * `start()` finds its root through git and spawns `claude` off PATH, so it
 * is run as `bun src/rafa.ts loop start` in a scratch repository with a
 * HOME of its own, under a PATH holding a stand-in `claude` and git's own
 * directory, in an environment holding nothing else but `RAFA_OUTPUT` for
 * json mode. Each run first asserts that `claude` resolves to the
 * stand-in. The stand-in drains its prompt with the shell's own `read`,
 * notes the call outside the repository and exits with the code its
 * planting names.
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
 *   - **A failed session**: its line as an `error` event, and the run
 *     ended by its return, as a success with exit code 0.
 *     `start/dispatch.ts` still prints through `console`, so only the
 *     lines opening with `{` are read as events here.
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
import ts from 'typescript';

import { CONFIG_DEFAULTS } from '../config.js';
import { parsePlan } from '../plan/index.js';

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
];

/** The owner and member a property or element access names, or null for any other node. */
function accessOf(node: ts.Node): readonly [string, string] | null {
  if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression)) {
    return [node.expression.text, node.name.text];
  }
  if (ts.isElementAccessExpression(node) && ts.isIdentifier(node.expression)) {
    const member = ts.isStringLiteralLike(node.argumentExpression)
      ? node.argumentExpression.text
      : '[computed]';
    return [node.expression.text, member];
  }
  return null;
}

/**
 * Each `console` member and each `process.exit` in the code of a source,
 * as `<line>: <owner>.<member>`, in source order.
 */
function consoleAndExitUses(source: string): string[] {
  const file = ts.createSourceFile('probe.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    const access = accessOf(node);
    if (access !== null) {
      const [owner, member] = access;
      if (owner === 'console' || (owner === 'process' && member === 'exit')) {
        const { line } = file.getLineAndCharacterOfPosition(node.getStart(file));
        found.push(`${line + 1}: ${owner}.${member}`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

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

/** A plan holding one open task. */
const PLAN_OPEN = `# Plan: ${STUB}\n\n- [ ] A task for the stand-in\n`;

/** A plan holding no open task, and a block never closed after its last task. */
const PLAN_DONE = `# Plan: ${STUB}\n\n- [x] A finished task\n\n\`\`\`rafa:notes\na note never closed\n`;

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
  /** `.rafa/config.yaml`, when one is planted. */
  readonly config?: string;
  /** The exit code the stand-in answers every call with. Defaults to 0. */
  readonly claudeExit?: number;
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
  const claude = join(bin, 'claude');
  writeFileSync(claude, [
    '#!/bin/sh',
    'while read -r _line; do :; done',
    `echo called >> '${callLog}'`,
    `exit ${planting.claudeExit ?? 0}`,
    '',
  ].join('\n'), 'utf8');
  chmodSync(claude, 0o755);

  git(repo, home, 'init', '-q', '.');
  git(repo, home, 'config', 'user.email', 'loop@example.test');
  git(repo, home, 'config', 'user.name', 'Rafa Loop');
  git(repo, home, 'config', 'commit.gpgsign', 'false');
  writeFileSync(join(repo, '.gitignore'), 'progress.txt\n.plans/\n.ralph/\n.rafa/\n', 'utf8');
  git(repo, home, 'add', '-A');
  git(repo, home, 'commit', '-q', '--no-verify', '-m', 'seed');
  git(repo, home, 'checkout', '-q', '-B', planting.branch);

  if (planting.plan !== null) {
    mkdirSync(join(repo, '.plans'));
    writeFileSync(join(repo, '.plans', `PLAN-${STUB}.md`), planting.plan, 'utf8');
  }
  if (planting.config !== undefined) {
    mkdirSync(join(repo, '.rafa'));
    writeFileSync(join(repo, '.rafa', 'config.yaml'), planting.config, 'utf8');
  }

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
    ['info', '🧹 Wrap-up session starting: promote progress.txt findings, sync with main, then commit, push and open the PR.'],
    ['info', '   This is one full Claude session with no intermediate output — expect several quiet minutes. Interrupting it skips the push and PR; if that happens, run again to retry just this stage.'],
    ['info', '\n✅ Progress preserved; PR opened or updated on this branch.'],
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
  it('writes the failure as its one error event and ends the run as a success, with exit code 0', () => {
    const scratch = plant({ branch: `feat/${STUB}`, plan: PLAN_OPEN, claudeExit: 3 });

    const run = runLoopStart(scratch, 'json', [PLAN_FLAG, '--no-ci-wait']);
    const events = eventsOf(run.stdout
      .split('\n')
      .filter((line) => line.startsWith('{'))
      .join('\n'));
    const failure = {
      type: 'log' as const,
      level: 'error' as const,
      message: '\n❌ Task failed (exit 3). Marked as blocked. Run again to retry.',
      ts: expect.any(String),
    };

    expect(run.exitCode).toBe(0);
    expect(existsSync(scratch.callLog)).toBe(true);
    expect(events[0]).toMatchObject({ type: 'start', command: 'loop start' });
    expect(events.at(-1)).toMatchObject({ type: 'result', ok: true });
    expect(events.filter((event) => event.type === 'result')).toHaveLength(1);
    expect(events.filter((event) => event.type === 'log' && event.level === 'error')).toEqual([failure]);
    expect(readFileSync(join(scratch.repo, '.plans', `PLAN_TRACKER-${STUB}.md`), 'utf8'))
      .toContain('- [BLOCKED] A task for the stand-in');
  }, RUN_TIMEOUT);
});
