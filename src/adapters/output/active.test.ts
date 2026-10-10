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
 *
 * The mode cases read the mode set beside the output: `text` while
 * nothing is set, the mode named with an output, `text` for an output
 * set with no mode over one set in `json`, and `text` again with the
 * default, whatever mode `null` is named with. `null` keeping the mode it
 * was named with, driven on 2026-09-15 and restored sha256-identical,
 * reddened the third mode case alone.
 *
 * The scope cases read the output and the mode {@link runWithActiveOutput}
 * runs a function with. Two runs that overlap each read their own after
 * an await, and the default is read once both have ended, in both
 * orders: the first started ending first, where a set and a `finally`
 * restore leave the first's output behind for good, and ending last,
 * where a reader outside both reads the first's between the two endings.
 * Each overlap is ordered by gates the case opens itself, never by a
 * timer. An output set at module level ahead of a scope is the control
 * that the scope leaves it alone: the same reader answers it again once
 * the scope has ended.
 *
 * Driven on 2026-10-10 against a stand-in of {@link runWithActiveOutput}
 * that set the module-level output and restored it in a `finally`, one
 * run over this file: the two overlap cases, the set-inside-a-scope
 * case and the listener case were red, the other thirteen green.
 *
 * The listener case holds the module note's "What reads outside the
 * scope" with an emitter of its own in place of a process signal: a
 * listener registered inside a scope and called from outside it reads
 * the module-level output, and the same listener wrapped with
 * `AsyncResource.bind` where it is registered reads the scope's.
 */
import type { OutputStream } from './stream.js';
import type { Output } from '../../ports/index.js';

import { AsyncResource } from 'node:async_hooks';
import { EventEmitter } from 'node:events';

import { afterEach, describe, expect, it, spyOn } from 'bun:test';

import { activeOutput, activeOutputMode, runWithActiveOutput, setActiveOutput } from './active.js';
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

describe('the active output mode', () => {
  afterEach(() => {
    setActiveOutput(null);
  });

  it('is text while nothing is set, and the mode named with an output once one is', () => {
    expect(activeOutputMode()).toBe('text');

    setActiveOutput(createJsonOutput(memoryStream()), 'json');

    expect(activeOutputMode()).toBe('json');
  });

  it('is text for an output set with no mode, even over one set in json', () => {
    setActiveOutput(createJsonOutput(memoryStream()), 'json');

    setActiveOutput(createJsonOutput(memoryStream()));

    expect(activeOutputMode()).toBe('text');
  });

  it('goes back to text with the default when null is set, whatever mode is named', () => {
    setActiveOutput(createJsonOutput(memoryStream()), 'json');

    setActiveOutput(null, 'json');

    expect(activeOutput()).toBe(DEFAULT_OUTPUT);
    expect(activeOutputMode()).toBe('text');
  });
});

/** A promise and the function that settles it, so a case orders its own overlaps. */
function gate(): { readonly opened: Promise<void>; readonly open: () => void } {
  let open: () => void = () => {};
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { opened, open };
}

describe('the active output in an async scope', () => {
  afterEach(() => {
    setActiveOutput(null);
  });

  it('answers the scope\'s output and mode inside the run, after an await too, and the default once it ends', async () => {
    const json = createJsonOutput(memoryStream());
    const during: [Output, string][] = [];

    const answer = await runWithActiveOutput(json, 'json', async () => {
      during.push([activeOutput(), activeOutputMode()]);
      await Promise.resolve();
      during.push([activeOutput(), activeOutputMode()]);
      return 'done';
    });

    expect(answer).toBe('done');
    expect(during).toEqual([[json, 'json'], [json, 'json']]);
    expect(during[1]?.[0]).toBe(json);
    expect(activeOutput()).toBe(DEFAULT_OUTPUT);
    expect(activeOutputMode()).toBe('text');
  });

  it('writes a line read inside the scope to the scope\'s output, and none to process.stdout', async () => {
    const { stream, chunks } = memoryStream();
    const json = createJsonOutput({ stream, now: () => new Date('2026-10-10T12:00:00.000Z') });
    const written: string[] = [];
    const spy = spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      written.push(String(chunk));
      return true;
    });

    try {
      await runWithActiveOutput(json, 'json', async () => {
        await Promise.resolve();
        activeOutput().info('scoped line');
      });
    } finally {
      spy.mockRestore();
    }

    expect(written).toEqual([]);
    expect(chunks).toEqual([
      '{"type":"log","level":"info","message":"scoped line","ts":"2026-10-10T12:00:00.000Z"}\n',
    ]);
  });

  it('gives two overlapping runs their own output and mode when the first started ends last, and leaves the default', async () => {
    const first = createJsonOutput(memoryStream());
    const second = createJsonOutput(memoryStream());
    const firstMayEnd = gate();
    const secondEnded = gate();
    const read: [string, Output, string][] = [];

    await Promise.all([
      runWithActiveOutput(first, 'json', async () => {
        await firstMayEnd.opened;
        read.push(['first', activeOutput(), activeOutputMode()]);
      }),
      runWithActiveOutput(second, 'events', async () => {
        await Promise.resolve();
        read.push(['second', activeOutput(), activeOutputMode()]);
        secondEnded.open();
      }),
      secondEnded.opened.then(() => {
        read.push(['between', activeOutput(), activeOutputMode()]);
        firstMayEnd.open();
      }),
    ]);

    expect(read.map(([name, , mode]) => [name, mode])).toEqual([['second', 'events'], ['between', 'text'], ['first', 'json']]);
    expect(read[0]?.[1]).toBe(second);
    expect(read[1]?.[1]).toBe(DEFAULT_OUTPUT);
    expect(read[2]?.[1]).toBe(first);
    expect(activeOutput()).toBe(DEFAULT_OUTPUT);
    expect(activeOutputMode()).toBe('text');
  });

  it('gives two overlapping runs their own output and mode when the first started ends first, and leaves the default', async () => {
    const first = createJsonOutput(memoryStream());
    const second = createJsonOutput(memoryStream());
    const firstEnded = gate();
    const read: [string, Output, string][] = [];

    await Promise.all([
      runWithActiveOutput(first, 'json', async () => {
        await Promise.resolve();
        read.push(['first', activeOutput(), activeOutputMode()]);
      }).then(firstEnded.open),
      runWithActiveOutput(second, 'events', async () => {
        await firstEnded.opened;
        read.push(['second', activeOutput(), activeOutputMode()]);
      }),
    ]);

    expect(read.map(([name, , mode]) => [name, mode])).toEqual([['first', 'json'], ['second', 'events']]);
    expect(read[0]?.[1]).toBe(first);
    expect(read[1]?.[1]).toBe(second);
    expect(activeOutput()).toBe(DEFAULT_OUTPUT);
    expect(activeOutputMode()).toBe('text');
  });

  it('answers the inner output inside a nested run and the outer one after it', async () => {
    const outer = createJsonOutput(memoryStream());
    const inner = createJsonOutput(memoryStream());
    const read: [Output, string][] = [];

    await runWithActiveOutput(outer, 'json', async () => {
      read.push([activeOutput(), activeOutputMode()]);
      await runWithActiveOutput(inner, 'text', async () => {
        await Promise.resolve();
        read.push([activeOutput(), activeOutputMode()]);
      });
      read.push([activeOutput(), activeOutputMode()]);
    });

    expect(read.map(([output]) => output === outer)).toEqual([true, false, true]);
    expect(read[1]?.[0]).toBe(inner);
    expect(read.map(([, mode]) => mode)).toEqual(['json', 'text', 'json']);
    expect(activeOutput()).toBe(DEFAULT_OUTPUT);
  });

  it('leaves the default behind a run that throws, and one that rejects', async () => {
    const json = createJsonOutput(memoryStream());

    expect(() => runWithActiveOutput(json, 'json', () => {
      throw new Error('boom');
    })).toThrow('boom');
    expect(activeOutput()).toBe(DEFAULT_OUTPUT);
    expect(activeOutputMode()).toBe('text');

    const rejected = runWithActiveOutput(json, 'json', async () => {
      await Promise.resolve();
      throw new Error('later');
    });
    await expect(rejected).rejects.toThrow('later');
    expect(activeOutput()).toBe(DEFAULT_OUTPUT);
    expect(activeOutputMode()).toBe('text');
  });

  it('leaves an output set at module level in place: hidden inside the scope, answered again after it', async () => {
    const outside = createJsonOutput(memoryStream());
    const scoped = createJsonOutput(memoryStream());
    setActiveOutput(outside, 'json');

    const inside = await runWithActiveOutput(scoped, 'text', async () => [activeOutput(), activeOutputMode()] as const);

    expect(inside[0]).toBe(scoped);
    expect(inside[1]).toBe('text');
    expect(activeOutput()).toBe(outside);
    expect(activeOutputMode()).toBe('json');
  });

  it('a listener registered inside a scope and called from outside it reads the module-level output, and one wrapped with AsyncResource.bind the scope\'s', async () => {
    const scoped = createJsonOutput(memoryStream());
    const emitter = new EventEmitter();
    const read: Record<string, [Output, string]> = {};

    await runWithActiveOutput(scoped, 'json', async () => {
      emitter.on('interrupt', () => {
        read['plain'] = [activeOutput(), activeOutputMode()];
      });
      emitter.on('interrupt', AsyncResource.bind(() => {
        read['bound'] = [activeOutput(), activeOutputMode()];
      }));
      await Promise.resolve();
    });
    emitter.emit('interrupt');

    expect(read['plain']?.[0]).toBe(DEFAULT_OUTPUT);
    expect(read['plain']?.[1]).toBe('text');
    expect(read['bound']?.[0]).toBe(scoped);
    expect(read['bound']?.[1]).toBe('json');
  });

  it('a set made inside a scope writes the module-level output: the scope still answers its own, and the set one is read after', async () => {
    const scoped = createJsonOutput(memoryStream());
    const set = createJsonOutput(memoryStream());

    const inside = await runWithActiveOutput(scoped, 'text', async () => {
      setActiveOutput(set, 'json');
      return [activeOutput(), activeOutputMode()] as const;
    });

    expect(inside[0]).toBe(scoped);
    expect(inside[1]).toBe('text');
    expect(activeOutput()).toBe(set);
    expect(activeOutputMode()).toBe('json');
  });
});
