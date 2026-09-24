/**
 * Spawned proof that a raw-mode prompt gives the terminal back: a child bun
 * script holds a `select` over a recording terminal seam, and the parent
 * either sends it `SIGINT` mid-prompt or has the key source throw.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import { INTERRUPT_EXIT_CODE } from '../cli/prompt/terminal.js';

const SELECT_MODULE = join(import.meta.dir, '..', 'cli', 'prompt', 'select.ts');

/** The failure the child's key source throws in `throw` mode. */
const KEY_FAILURE = 'keys broke mid-prompt';

/** The child: `hang` waits on its keys forever, `throw` fails after one key. */
const CHILD_SOURCE = `
import { select } from ${JSON.stringify(SELECT_MODULE)};

const mode = process.argv[2];
const say = (line) => process.stdout.write(line + '\\n');

const terminal = {
  isTTY: true,
  setRawMode: (on) => say('raw:' + (on ? 'on' : 'off')),
  write: () => {},
  onInterrupt: (handler) => {
    process.on('SIGINT', handler);
    return () => process.off('SIGINT', handler);
  },
  exit: (code) => process.exit(code),
};

const keys = {
  async *[Symbol.asyncIterator]() {
    say('ready');
    if (mode === 'throw') {
      yield { name: 'down' };
      throw new Error(${JSON.stringify(KEY_FAILURE)});
    }
    await new Promise(() => {});
  },
};

try {
  await select({
    message: 'pick',
    choices: [{ label: 'one', value: 1 }, { label: 'two', value: 2 }],
    keys,
    terminal,
  });
  say('answered');
} catch (error) {
  say('error:' + error.message);
  process.exit(3);
}
`;

let scratch = '';
let childPath = '';

beforeAll(async () => {
  scratch = await mkdtemp(join(tmpdir(), 'rafa-prompt-restore-'));
  childPath = join(scratch, 'child.ts');
  await Bun.write(childPath, CHILD_SOURCE);
});

afterAll(async () => {
  await rm(scratch, { recursive: true, force: true });
});

/** Spawns the child in `mode`. */
function spawnChild(mode: 'hang' | 'throw'): ReturnType<typeof Bun.spawn> {
  return Bun.spawn([process.execPath, childPath, mode], {
    stdout: 'pipe',
    stderr: 'pipe',
    stdin: 'ignore',
  });
}

/** Reads `stream` to its end, calling `onText` with all text read so far after each chunk. */
async function collect(stream: ReadableStream<Uint8Array>, onText: (text: string) => void): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let text = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return text;
    text += decoder.decode(value, { stream: true });
    onText(text);
  }
}

describe('a raw-mode prompt in a child process', () => {
  test('SIGINT mid-prompt switches raw mode off and ends the child', async () => {
    const child = spawnChild('hang');
    const stdout = child.stdout as ReadableStream<Uint8Array>;

    let markReady: () => void = () => {};
    const ready = new Promise<void>((resolve) => {
      markReady = resolve;
    });
    const output = collect(stdout, (text) => {
      if (text.includes('ready')) markReady();
    });

    await ready;
    child.kill('SIGINT');
    const code = await child.exited;
    const text = await output;

    const lines = text.split('\n').filter((line) => line !== '');
    expect(lines).toEqual(['raw:on', 'ready', 'raw:off']);
    expect(code).toBe(INTERRUPT_EXIT_CODE);
  }, 15_000);

  test('an error thrown mid-prompt still switches raw mode off', async () => {
    const child = spawnChild('throw');

    const code = await child.exited;
    const out = await new Response(child.stdout as ReadableStream<Uint8Array>).text();

    const lines = out.split('\n').filter((line) => line !== '');
    expect(lines).toEqual(['raw:on', 'ready', 'raw:off', `error:${KEY_FAILURE}`]);
    expect(code).toBe(3);
  }, 15_000);
});
