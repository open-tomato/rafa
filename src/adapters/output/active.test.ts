/**
 * Tests for the process-wide active output (`src/adapters/output/active.ts`).
 *
 * The default is read once, before any case sets an output, and each
 * case after is held against that reading. What the default writes is
 * read off a spy on `process.stdout.write`, restored in the same case:
 * `debug` hidden and `info` unprefixed tell the `text` adapter at
 * verbosity 0 apart from the `json` adapter and from a higher verbosity.
 * The case setting a `json` output is the control that the spy reading
 * can come out empty.
 *
 * Bun runs every test file in one process and the active output is
 * module state, so every case here is followed by a reset to the
 * default. Without it, each file bun runs later would write through the
 * output a case set.
 *
 * Two mutations of `active.ts` were driven against `src/adapters/` on
 * 2026-09-14, one run each, with 112 pass before and after and the
 * module restored byte-identical (sha256): `null` leaving the current
 * output in place reddened the reset case alone, and the default made at
 * verbosity 2 the default-output case alone.
 */
import type { OutputStream } from './stream.js';

import { afterEach, describe, expect, it, spyOn } from 'bun:test';

import { activeOutput, setActiveOutput } from './active.js';
import { createJsonOutput } from './json.js';

/** The output active when this file was loaded, before any case set one. */
const DEFAULT_OUTPUT = activeOutput();

/** A stream of its own, and the chunks written to it. */
function memoryStream(): { stream: OutputStream; chunks: string[] } {
  const chunks: string[] = [];
  return {
    stream: {
      write: (chunk) => {
        chunks.push(chunk);
        return true;
      },
    },
    chunks,
  };
}

/** Runs `write` with `process.stdout.write` spied on, answering what reached it. */
function stdoutDuring(write: () => void): string[] {
  const chunks: string[] = [];
  const spy = spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
    chunks.push(String(chunk));
    return true;
  });
  try {
    write();
  } finally {
    spy.mockRestore();
  }
  return chunks;
}

describe('the active output', () => {
  afterEach(() => {
    setActiveOutput(null);
  });

  it('writes as the text adapter at verbosity 0 to process.stdout while nothing is set', () => {
    const written = stdoutDuring(() => {
      const output = activeOutput();
      output.debug('hidden');
      output.info('loop line');
      output.warn('careful');
      output.result({ items: 1 });
    });

    expect(written).toEqual(['loop line\n', 'warn: careful\n', 'result: {"items":1}\n']);
  });

  it('answers the same default object on every read while nothing is set', () => {
    expect(activeOutput()).toBe(DEFAULT_OUTPUT);
    expect(activeOutput()).toBe(activeOutput());
  });

  it('answers the output a caller sets, which receives every line in place of process.stdout', () => {
    const { stream, chunks } = memoryStream();
    const json = createJsonOutput({ stream, now: () => new Date('2026-09-14T12:00:00.000Z') });
    setActiveOutput(json);

    const written = stdoutDuring(() => {
      activeOutput().info('loop line');
    });

    expect(activeOutput()).toBe(json);
    expect(written).toEqual([]);
    expect(chunks).toEqual([
      '{"type":"log","level":"info","message":"loop line","ts":"2026-09-14T12:00:00.000Z"}\n',
    ]);
  });

  it('answers the output set last when a second one replaces the first', () => {
    const first = createJsonOutput(memoryStream());
    const second = createJsonOutput(memoryStream());

    setActiveOutput(first);
    setActiveOutput(second);

    expect(activeOutput()).toBe(second);
  });

  it('puts the default back when null is set', () => {
    setActiveOutput(createJsonOutput(memoryStream()));
    expect(activeOutput()).not.toBe(DEFAULT_OUTPUT);

    setActiveOutput(null);

    expect(activeOutput()).toBe(DEFAULT_OUTPUT);
  });
});
