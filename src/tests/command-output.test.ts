/**
 * The phase 0 commands besides `loop start` writing through the active
 * output: `effort collect`, `effort report` and `usage` spawned in both
 * modes, and the source of every module those commands and `plan create`
 * write from.
 *
 * ## The source cases
 *
 * `src/plan.ts`, `src/effort/collect.ts`, `src/effort/report.ts`,
 * `src/usage.ts`, `src/config.ts` and `src/config-load.ts` hold no
 * `console` member and no `process.exit` in their code, read with the
 * walk in `source-uses.ts`, whose control is `loop-output.test.ts`'s.
 * Each but `config.ts` calls `activeOutput()`; `config.ts` writes nothing,
 * its one write at `da0a76c` having moved to `config-load.ts`.
 *
 * ## The command cases
 *
 * Each runs `bun src/rafa.ts` in a scratch git repository with a HOME of
 * its own, under a PATH holding git's directory alone, in an environment
 * holding nothing else but what the case names, so no `RAFA_OUTPUT` the
 * suite runs under reaches a text case. A json run is held to NDJSON:
 * every line parses, the first is the start event and the one terminal
 * result is the last. Where a command writes lines, the same planting is
 * run in text mode beside it, and the json run's `info` messages are the
 * lines the text run printed, in order.
 *
 *   - `usage` with no reading, and with `CLAUDE_USAGE_PERCENT` set.
 *   - `effort collect --no-sessions` over a repository one commit deep,
 *     its json run beside a text run over the store a first run filled,
 *     and its refusal of a `--since` that is no date: on stderr in text
 *     mode, in the terminal result in json mode.
 *   - `effort report` over an empty store: the report as the result's
 *     `data` with `--output=json` typed after the action, ahead of the
 *     subject and as two words, and its refusal of a `--kind` that is no
 *     session kind in both modes.
 *
 * `plan create` is dispatched in both modes by `src/plan.test.ts`, which
 * hands it a fixture planner. `--json` beside `--output=json`, and a
 * config warning in both modes, run over a planted store in
 * `src/effort/report.test.ts`.
 *
 * Sixteen mutations were driven on 2026-09-15, one run each over this
 * file and ten other suites (`wrap`, `report`, `effort-report-backends`,
 * `cli/dispatch`, `commands/index`, `cli/command`, `collect`, `plan`,
 * `config-load` and `plan-injection`), with 387 pass before and after and
 * every module restored sha256-identical, and each reddened at least one
 * case. Here: `--output` handed to the parser (5), the value of
 * `--output json` kept (1), the report written as an info line in json
 * mode (3), the report's and collect's refusals thrown with no message
 * (1 each), collect's summary and the usage line back on `console.log`
 * (2 each, a source case among them), and config warnings back on
 * `console.warn` (1, the source case).
 */
import type { CliEvent } from '../ports/index.js';

import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'bun:test';

import { consoleAndExitUses } from './source-uses.js';

/** The `src/` directory. */
const SRC_DIR = fileURLToPath(new URL('../', import.meta.url));

/** The CLI entry every command case runs. */
const RAFA_ENTRY = join(SRC_DIR, 'rafa.ts');

/** How long a case spawning the CLI may run. */
const RUN_TIMEOUT = 30_000;

/** Each module held to the active output, from `src/`, and whether it writes at all. */
const ROUTED_MODULES: readonly (readonly [string, boolean])[] = [
  ['plan.ts', true],
  ['effort/collect.ts', true],
  ['effort/report.ts', true],
  ['usage.ts', true],
  ['config.ts', false],
  ['config-load.ts', true],
];

describe('the modules the other phase 0 commands write through', () => {
  it.each(ROUTED_MODULES)('holds no console member and no process.exit in the code of %s', (path, writes) => {
    const source = readFileSync(join(SRC_DIR, path), 'utf8');

    expect(consoleAndExitUses(source)).toEqual([]);
    expect(source.includes('activeOutput()')).toBe(writes);
  });
});

/** A scratch directory of this file's own, its path resolved as git answers it. */
const tempRoot = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-command-output-')));

afterAll(() => {
  rmSync(tempRoot, { recursive: true, force: true });
});

let planted = 0;

/** A scratch git repository and the HOME its runs get. */
interface Scratch {
  readonly repo: string;
  readonly home: string;
}

/** What one run wrote, and how it exited. */
interface Run {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** Plants a scratch repository one empty commit deep, beside an empty HOME. */
function plant(): Scratch {
  planted += 1;
  const repo = join(tempRoot, `run-${planted}`, 'repo');
  const home = join(tempRoot, `run-${planted}`, 'home');
  for (const dir of [repo, home]) mkdirSync(dir, { recursive: true });
  const git = (...args: string[]): void => {
    const run = Bun.spawnSync([
      'git',
      '-c',
      'user.name=rafa',
      '-c',
      'user.email=rafa@example.invalid',
      '-c',
      'commit.gpgsign=false',
      '-c',
      'core.hooksPath=/dev/null',
      ...args,
    ], { cwd: repo, env: { ...process.env, HOME: home } });
    if (run.exitCode !== 0) throw new Error(`git ${args.join(' ')}: ${run.stderr.toString()}`);
  };
  git('init', '-q');
  git('commit', '-q', '--allow-empty', '--no-verify', '-m', 'seed');
  return { repo, home };
}

/** Runs `bun src/rafa.ts` over `words` in the scratch repository; see the module note. */
function rafa(scratch: Scratch, words: readonly string[], env: Readonly<Record<string, string>> = {}): Run {
  const gitBinary = Bun.which('git');
  if (gitBinary === null) throw new Error('git is not on the PATH this suite runs under');
  const proc = Bun.spawnSync([process.execPath, RAFA_ENTRY, ...words], {
    cwd: scratch.repo,
    env: { PATH: dirname(gitBinary), HOME: scratch.home, ...env },
  });
  return { exitCode: proc.exitCode, stdout: proc.stdout.toString(), stderr: proc.stderr.toString() };
}

/** The events a json run wrote, each line parsed, held to one start first and one terminal result last. */
function eventsOf(run: Run): CliEvent[] {
  const events = run.stdout
    .trimEnd()
    .split('\n')
    .map((line) => JSON.parse(line) as CliEvent);
  expect(events[0]?.type).toBe('start');
  expect(events.filter((event) => event.type === 'result')).toHaveLength(1);
  expect(events.at(-1)?.type).toBe('result');
  return events;
}

/** The messages of the `info` events among `events`, in order. */
function infoMessages(events: readonly CliEvent[]): string[] {
  return events.flatMap((event) => {
    if (event.type !== 'log' || event.level !== 'info') return [];
    return [event.message];
  });
}

/** The lines a text run wrote to `stream`, each without its newline. */
function linesOf(stream: string): string[] {
  return stream.replace(/\n$/, '').split('\n');
}

describe('rafa usage', () => {
  it('writes the unavailable reading as info events in json mode, the lines text mode prints', () => {
    const scratch = plant();

    const text = rafa(scratch, ['usage']);
    const json = rafa(scratch, ['usage', '--output=json']);

    expect([text.exitCode, text.stderr]).toEqual([0, '']);
    expect(text.stdout).toBe('Claude usage: unavailable\n'
      + 'Tip: set CLAUDE_USAGE_PERCENT=<0-100> to override until a live source is available.\n');
    expect([json.exitCode, json.stderr]).toEqual([0, '']);
    const events = eventsOf(json);
    expect(events).toHaveLength(4);
    expect(infoMessages(events)).toEqual(linesOf(text.stdout));
    expect(events.at(-1)).toMatchObject({ ok: true });
  }, RUN_TIMEOUT);

  it('writes a reading the environment sets as one info event', () => {
    const scratch = plant();

    const json = rafa(scratch, ['usage', '--output=json'], { CLAUDE_USAGE_PERCENT: '85' });

    expect(json.exitCode).toBe(0);
    expect(infoMessages(eventsOf(json)))
      .toEqual([`Claude usage: 85.0%  [${'█'.repeat(17)}${'░'.repeat(3)}]  HIGH — monitor closely`]);
  }, RUN_TIMEOUT);
});

describe('rafa effort collect', () => {
  it('writes its summary as info events in json mode, the lines text mode prints over the same store', () => {
    const scratch = plant();

    const first = rafa(scratch, ['effort', 'collect', '--no-sessions']);
    const text = rafa(scratch, ['effort', 'collect', '--no-sessions']);
    const json = rafa(scratch, ['effort', 'collect', '--no-sessions', '--output=json']);

    expect([first.exitCode, first.stderr]).toEqual([0, '']);
    expect(linesOf(first.stdout)).toContain('  commits   1 parsed, 0 already stored, +1 rows');
    expect([text.exitCode, text.stderr]).toEqual([0, '']);
    expect(linesOf(text.stdout)).toEqual([
      `effort collect: ${scratch.repo}`,
      '  sessions  skipped (--no-sessions)',
      '  commits   1 parsed, 1 already stored, +0 rows',
    ]);
    expect([json.exitCode, json.stderr]).toEqual([0, '']);
    expect(infoMessages(eventsOf(json))).toEqual(linesOf(text.stdout));
  }, RUN_TIMEOUT);

  it('refuses a --since that is no date on stderr in text mode, and in the terminal result in json mode', () => {
    const scratch = plant();
    const refusal = 'ralph effort collect: --since value is not a date this can read: nope';

    const text = rafa(scratch, ['effort', 'collect', '--since=nope']);
    const json = rafa(scratch, ['effort', 'collect', '--since=nope', '--output=json']);

    expect([text.exitCode, text.stdout, text.stderr]).toEqual([1, '', `${refusal}\n`]);
    expect([json.exitCode, json.stderr]).toEqual([1, '']);
    const events = eventsOf(json);
    expect(events.map((event) => event.type)).toEqual(['start', 'result']);
    expect(events[1]).toMatchObject({ ok: false, error: { code: 'command_exit', message: refusal } });
  }, RUN_TIMEOUT);
});

describe('rafa effort report', () => {
  it.each([
    ['after the action', ['effort', 'report', '--output=json']],
    ['ahead of the subject', ['--output=json', 'effort', 'report']],
    ['as two words', ['effort', 'report', '--output', 'json']],
  ])('gives the report as the terminal result with --output=json typed %s', (_title, words) => {
    const scratch = plant();

    const json = rafa(scratch, words);

    expect([json.exitCode, json.stderr]).toEqual([0, '']);
    const events = eventsOf(json);
    expect(events).toHaveLength(2);
    expect(events[1]).toMatchObject({ ok: true, data: { rowsRead: 0, groups: [], taskReports: [] } });
  }, RUN_TIMEOUT);

  it('refuses a --kind that is no session kind on stderr in text mode, and in the terminal result in json mode', () => {
    const scratch = plant();

    const text = rafa(scratch, ['effort', 'report', '--kind=nope']);
    const json = rafa(scratch, ['effort', 'report', '--kind=nope', '--output=json']);

    expect([text.exitCode, text.stdout]).toEqual([1, '']);
    expect(text.stderr).toStartWith('ralph effort report: --kind value is not a session kind: nope (one of ');
    expect([json.exitCode, json.stderr]).toEqual([1, '']);
    const events = eventsOf(json);
    expect(events.map((event) => event.type)).toEqual(['start', 'result']);
    expect(events[1]).toMatchObject({ ok: false, error: { code: 'command_exit', message: linesOf(text.stderr).join('\n') } });
  }, RUN_TIMEOUT);
});
