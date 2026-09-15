/**
 * Tests for the `text` Output adapter (`src/adapters/output/text.ts`).
 *
 * The source's suite, `output.test.ts` beside the source at the commit
 * the module header records, is ported to `bun:test`, with the one case
 * the copy reverses: `info` at verbosity 0, which the source held
 * suppressed, is written here with no prefix. Every line is held to its
 * exact bytes. The debug cases are each other's control, verbosity 1
 * writing nothing and verbosity 2 the line, and every event kind `emit`
 * renders has a case of its own.
 *
 * The claim that `info` writes what `console.log` writes is read off a
 * child bun process, since `console.log` does not write through
 * `process.stdout.write` where a spy could see it. The child prints the
 * same messages through `console.log`, through the adapter over
 * `process.stdout`, and through the source's `info: ` prefix, and the
 * last is the control that the comparison can fail.
 *
 * Six mutations of `text.ts` were driven against `src/adapters/` on
 * 2026-09-14, one run each, with 112 pass before and after and the
 * module restored byte-identical (sha256), and every one reddened at
 * least one case. `info` held to the source's verbosity 1 reddened seven
 * cases across this file and the registry and active suites, the
 * `console.log` comparison among them, and `info` given the source's
 * prefix reddened ten. `debug` from verbosity 1 reddened that verbosity's
 * case alone, `warn` left unprefixed five, a failed result printing a
 * colon after an empty message two, and the output left unfrozen the
 * frozen case alone.
 */
import type { OutputStream } from './stream.js';
import type { CliEvent, Output } from '../../ports/index.js';

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';

import { createTextOutput } from './text.js';

/** The timestamp every event here carries. The text adapter never prints it. */
const TS = '2026-09-14T12:00:00.000Z';

/** The adapter module, as the child process imports it. */
const TEXT_MODULE = fileURLToPath(new URL('./text.ts', import.meta.url));

/** Messages a formatter could change, each printed on its own. */
const MESSAGES = [
  'plain',
  '\n❌ Task failed (exit 1). Marked as blocked.',
  '50%s done',
  '100%% sure',
  '%d items',
  '%o object',
  '%c styled',
  '%j json',
  'two\nlines',
  '',
  '   indented\twith a tab',
];

/** A child that prints {@link MESSAGES} one way, named by its first argument. */
const PRINTER = `import { createTextOutput } from ${JSON.stringify(TEXT_MODULE)};

const [mode, encoded] = process.argv.slice(2);
const output = createTextOutput({ verbosity: 0, stream: process.stdout });
for (const message of JSON.parse(encoded)) {
  if (mode === 'console') console.log(message);
  else if (mode === 'text') output.info(message);
  else process.stdout.write('info: ' + message + '\\n');
}
`;

/** Each event `emit` renders at verbosity 0, and the chunks it writes. */
const EMITTED: readonly (readonly [string, CliEvent, readonly string[]])[] = [
  ['a start event', { type: 'start', command: 'loop start', ts: TS }, ['start: loop start\n']],
  ['a step event', { type: 'step', name: 'task 2', ts: TS }, ['step: task 2\n']],
  ['an info log event', { type: 'log', level: 'info', message: 'hello', ts: TS }, ['hello\n']],
  ['a warn log event', { type: 'log', level: 'warn', message: 'careful', ts: TS }, ['warn: careful\n']],
  ['an error log event', { type: 'log', level: 'error', message: 'broken', ts: TS }, ['error: broken\n']],
  ['a debug log event', { type: 'log', level: 'debug', message: 'detail', ts: TS }, []],
  ['an ok result with no data', { type: 'result', ok: true, ts: TS }, ['result: ok\n']],
  [
    'an ok result with object data',
    { type: 'result', ok: true, data: { items: 3 }, ts: TS },
    ['result: ok {"items":3}\n'],
  ],
  ['an ok result with string data', { type: 'result', ok: true, data: 'done', ts: TS }, ['result: ok done\n']],
  [
    'a failed result with a code and a message',
    { type: 'result', ok: false, error: { code: 'E_PLAN', message: 'no plan' }, ts: TS },
    ['result: error E_PLAN: no plan\n'],
  ],
  [
    'a failed result with an empty message',
    { type: 'result', ok: false, error: { code: 'E_PLAN', message: '' }, ts: TS },
    ['result: error E_PLAN\n'],
  ],
  ['a failed result with no error', { type: 'result', ok: false, ts: TS }, ['result: error unknown\n']],
];

/** A text output at `verbosity`, and the chunks it wrote. */
function textAt(verbosity: number): { output: Output; chunks: string[] } {
  const chunks: string[] = [];
  const stream: OutputStream = {
    write: (chunk) => {
      chunks.push(chunk);
      return true;
    },
  };
  return { output: createTextOutput({ verbosity, stream }), chunks };
}

let tempDir = '';

/** What the child wrote to stdout printing {@link MESSAGES} one way. */
function printed(mode: 'console' | 'text' | 'prefixed'): { exitCode: number; stdout: string } {
  const child = Bun.spawnSync({
    cmd: [process.execPath, join(tempDir, 'printer.ts'), mode, JSON.stringify(MESSAGES)],
    cwd: tempDir,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  return { exitCode: child.exitCode, stdout: child.stdout.toString() };
}

beforeAll(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'rafa-text-output-'));
  writeFileSync(join(tempDir, 'printer.ts'), PRINTER);
});

afterAll(() => {
  if (tempDir !== '') rmSync(tempDir, { recursive: true, force: true });
});

describe('createTextOutput at verbosity 0', () => {
  it('suppresses debug messages', () => {
    const { output, chunks } = textAt(0);

    output.debug('hidden debug detail');

    expect(chunks).toEqual([]);
  });

  it('writes info messages with no prefix', () => {
    const { output, chunks } = textAt(0);

    output.info('shown info detail');

    expect(chunks).toEqual(['shown info detail\n']);
  });

  it('emits warn messages', () => {
    const { output, chunks } = textAt(0);

    output.warn('disk almost full');

    expect(chunks).toEqual(['warn: disk almost full\n']);
  });

  it('emits error messages', () => {
    const { output, chunks } = textAt(0);

    output.error('connection refused');

    expect(chunks).toEqual(['error: connection refused\n']);
  });

  it('emits result payloads', () => {
    const { output, chunks } = textAt(0);

    output.result({ ok: true, items: 3 });

    expect(chunks).toEqual([`result: ${JSON.stringify({ ok: true, items: 3 })}\n`]);
  });

  it('writes a string result payload as it is', () => {
    const { output, chunks } = textAt(0);

    output.result('done');

    expect(chunks).toEqual(['result: done\n']);
  });

  it('writes info, warn, error and result while suppressing debug in a mixed sequence', () => {
    const { output, chunks } = textAt(0);

    output.debug('debug-1');
    output.info('info-1');
    output.warn('warn-1');
    output.error('error-1');
    output.result('done');
    output.debug('debug-2');
    output.info('info-2');

    expect(chunks).toEqual([
      'info-1\n',
      'warn: warn-1\n',
      'error: error-1\n',
      'result: done\n',
      'info-2\n',
    ]);
  });
});

describe('createTextOutput by verbosity', () => {
  it.each([
    [0, []],
    [1, []],
    [2, ['debug: detail\n']],
    [3, ['debug: detail\n']],
  ])('at verbosity %p writes debug as %p', (verbosity, expected) => {
    const { output, chunks } = textAt(verbosity);

    output.debug('detail');

    expect(chunks).toEqual(expected);
  });

  it.each([0, 1, 2, 3])('at verbosity %p writes info with no prefix', (verbosity) => {
    const { output, chunks } = textAt(verbosity);

    output.info('line');

    expect(chunks).toEqual(['line\n']);
  });

  it('writes a debug log event at verbosity 2 through debug', () => {
    const { output, chunks } = textAt(2);

    output.emit({ type: 'log', level: 'debug', message: 'detail', ts: TS });

    expect(chunks).toEqual(['debug: detail\n']);
  });
});

describe('emit', () => {
  it.each(EMITTED)('renders %s', (_label, event, expected) => {
    const { output, chunks } = textAt(0);

    output.emit(event);

    expect(chunks).toEqual([...expected]);
  });
});

describe('the text output', () => {
  it('is frozen, so no caller replaces one of its functions', () => {
    const { output } = textAt(0);
    const loose = output as { info: unknown };

    expect(Object.isFrozen(output)).toBe(true);
    expect(() => {
      loose.info = () => {};
    }).toThrow(TypeError);
  });

  it('writes to process.stdout the bytes console.log writes for each message', () => {
    const fromConsole = printed('console');
    const fromText = printed('text');
    const prefixed = printed('prefixed');

    expect([fromConsole.exitCode, fromText.exitCode, prefixed.exitCode]).toEqual([0, 0, 0]);
    expect(fromConsole.stdout).toBe(MESSAGES.map((message) => `${message}\n`).join(''));
    expect(fromText.stdout).toBe(fromConsole.stdout);
    expect(prefixed.stdout).not.toBe(fromConsole.stdout);
  }, 30_000);
});
