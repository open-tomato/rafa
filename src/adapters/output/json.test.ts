/**
 * Tests for the `json` Output adapter (`src/adapters/output/json.ts`).
 *
 * The source's two cases, from `output.test.ts` beside the source at the
 * commit the module header records, are ported to `bun:test`. Every
 * other case holds a line to its exact bytes, with the clock fixed
 * through `now`, and one reads the system clock when `now` is left out.
 *
 * Each refusal of a second terminal result sits beside the first result
 * the same adapter wrote, so an adapter refusing every result fails as
 * surely as one refusing none. The two-adapter case is the control that
 * the count is not shared across adapters, and the unserialisable and
 * throwing-stream cases that a result never written is never counted.
 *
 * Seven mutations of `json.ts` were driven against `src/adapters/` on
 * 2026-09-14, one run each, with 112 pass before and after and the
 * module restored byte-identical (sha256), and every one reddened at
 * least one case. The refusal dropped reddened the six refusals here and
 * the registry's fresh-output case. The count held at module level
 * reddened sixteen, since every adapter after the first result refused
 * its own. The count set before the write reddened the unserialisable
 * and throwing-stream cases, `emit` writing past the count the three
 * refusals that emit a result, and the refusal checked after
 * serialising the unserialisable second result alone. A `log` stamped
 * from the system clock in place of `now` reddened six, and the output
 * left unfrozen the frozen case alone.
 */
import type { OutputStream } from './stream.js';
import type { CliEvent, Output } from '../../ports/index.js';

import { describe, expect, it } from 'bun:test';

import { createJsonOutput } from './json.js';

/** The instant every adapter here is stamped from. */
const NOW = new Date('2026-09-14T12:00:00.000Z');

/** {@link NOW} as an event carries it. */
const TS = '2026-09-14T12:00:00.000Z';

/** What a second terminal result is refused with, in full. */
const REFUSAL = 'json output: refused a second terminal result event; a command emits exactly one';

/** An ISO 8601 timestamp as `toISOString` writes one. */
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/**
 * A json output over a stream of its own, and the chunks it wrote,
 * stamped from {@link NOW} unless `options` names another clock or none.
 * An options object and never a bare `now`, because `undefined` handed
 * to a parameter with a default takes the default: a first draft of the
 * system clock case was stamped from {@link NOW} that way, and failed.
 */
function jsonOutput(
  options: { now?: () => Date } = { now: () => NOW },
): { output: Output; chunks: string[] } {
  const chunks: string[] = [];
  const stream: OutputStream = {
    write: (chunk) => {
      chunks.push(chunk);
      return true;
    },
  };
  return { output: createJsonOutput({ stream, ...options }), chunks };
}

describe('createJsonOutput', () => {
  it('produces exactly one JSON object per line for each call', () => {
    const { output, chunks } = jsonOutput();

    output.info('first');
    output.warn('second');
    output.error('third');
    output.debug('fourth');
    output.result({ count: 1 });

    expect(chunks).toHaveLength(5);
    for (const chunk of chunks) {
      expect(chunk.endsWith('\n')).toBe(true);
      const body = chunk.slice(0, -1);
      expect(body).not.toContain('\n');
      const parsed: unknown = JSON.parse(body);
      expect(typeof parsed).toBe('object');
      expect(parsed).not.toBeNull();
    }
  });

  it('emits a type: "result" event when result is called', () => {
    const { output, chunks } = jsonOutput({});

    output.result({ items: 5 });

    expect(chunks).toHaveLength(1);
    const event = JSON.parse(chunks[0] ?? '') as { type: string; ok: boolean; data: unknown; ts: unknown };
    expect(event.type).toBe('result');
    expect(event.ok).toBe(true);
    expect(event.data).toEqual({ items: 5 });
    expect(typeof event.ts).toBe('string');
  });

  it.each(['debug', 'info', 'warn', 'error'] as const)(
    'writes %s as a log event at that level, stamped from now',
    (level) => {
      const { output, chunks } = jsonOutput();

      output[level]('a "quoted" message');

      expect(chunks).toEqual([
        `{"type":"log","level":"${level}","message":"a \\"quoted\\" message","ts":"${TS}"}\n`,
      ]);
    },
  );

  it('writes result as an ok result event carrying the payload as data', () => {
    const { output, chunks } = jsonOutput();

    output.result({ items: 3 });

    expect(chunks).toEqual([`{"type":"result","ok":true,"data":{"items":3},"ts":"${TS}"}\n`]);
  });

  it('writes an undefined payload as a result event with no data key', () => {
    const { output, chunks } = jsonOutput();

    output.result(undefined);

    expect(chunks).toEqual([`{"type":"result","ok":true,"ts":"${TS}"}\n`]);
  });

  it('writes an emitted event as it is, its own ts included', () => {
    const { output, chunks } = jsonOutput();
    const ts = '2020-01-01T00:00:00.000Z';

    output.emit({ type: 'start', command: 'loop start', ts });
    output.emit({ type: 'step', name: 'task 2', ts });
    output.emit({ type: 'result', ok: false, error: { code: 'E_PLAN', message: 'no plan' }, ts });

    expect(chunks).toEqual([
      `{"type":"start","command":"loop start","ts":"${ts}"}\n`,
      `{"type":"step","name":"task 2","ts":"${ts}"}\n`,
      `{"type":"result","ok":false,"error":{"code":"E_PLAN","message":"no plan"},"ts":"${ts}"}\n`,
    ]);
  });

  it('stamps from the system clock when no now is given', () => {
    const { output, chunks } = jsonOutput({});
    const before = Date.now();

    output.info('now');

    const after = Date.now();
    const { ts } = JSON.parse(chunks[0] ?? '') as { ts: string };
    expect(ts).toMatch(ISO_TIMESTAMP);
    expect(Date.parse(ts)).toBeGreaterThanOrEqual(before);
    expect(Date.parse(ts)).toBeLessThanOrEqual(after);
  });

  it('is frozen, so no caller replaces one of its functions', () => {
    const { output } = jsonOutput();
    const loose = output as { result: unknown };

    expect(Object.isFrozen(output)).toBe(true);
    expect(() => {
      loose.result = () => {};
    }).toThrow(TypeError);
  });
});

describe('the one terminal result', () => {
  const RESULT_EVENT: CliEvent = { type: 'result', ok: false, error: { code: 'E', message: 'm' }, ts: TS };

  it('refuses a second result call, writing nothing', () => {
    const { output, chunks } = jsonOutput();

    output.result('first');
    expect(() => output.result('second')).toThrow(REFUSAL);

    expect(chunks).toEqual([`{"type":"result","ok":true,"data":"first","ts":"${TS}"}\n`]);
  });

  it('refuses an emitted result event after a result call', () => {
    const { output, chunks } = jsonOutput();

    output.result('first');
    expect(() => output.emit(RESULT_EVENT)).toThrow(REFUSAL);

    expect(chunks).toHaveLength(1);
  });

  it('refuses a result call after an emitted result event', () => {
    const { output, chunks } = jsonOutput();

    output.emit(RESULT_EVENT);
    expect(() => output.result('second')).toThrow(REFUSAL);

    expect(chunks).toEqual([`${JSON.stringify(RESULT_EVENT)}\n`]);
  });

  it('refuses a second emitted result event, a failed first one counting as the result', () => {
    const { output, chunks } = jsonOutput();

    output.emit(RESULT_EVENT);
    expect(() => output.emit(RESULT_EVENT)).toThrow(REFUSAL);

    expect(chunks).toHaveLength(1);
  });

  it('refuses with an Error, and keeps refusing every later result', () => {
    const { output, chunks } = jsonOutput();

    output.result('first');
    expect(() => output.result('second')).toThrow(Error);
    expect(() => output.result('third')).toThrow(REFUSAL);

    expect(chunks).toHaveLength(1);
  });

  it('writes every other event after the result, refusing only a second result', () => {
    const { output, chunks } = jsonOutput();

    output.result('first');
    output.warn('after');
    output.emit({ type: 'step', name: 'cleanup', ts: TS });

    expect(chunks).toEqual([
      `{"type":"result","ok":true,"data":"first","ts":"${TS}"}\n`,
      `{"type":"log","level":"warn","message":"after","ts":"${TS}"}\n`,
      `{"type":"step","name":"cleanup","ts":"${TS}"}\n`,
    ]);
  });

  it('counts one result per adapter, so a second adapter writes its own', () => {
    const first = jsonOutput();
    const second = jsonOutput();

    first.output.result('one');
    second.output.result('two');

    expect(first.chunks).toHaveLength(1);
    expect(second.chunks).toEqual([`{"type":"result","ok":true,"data":"two","ts":"${TS}"}\n`]);
  });

  it('leaves the result unwritten when its payload cannot be serialised, so the next is written', () => {
    const { output, chunks } = jsonOutput();

    expect(() => output.result({ tokens: 1n })).toThrow(TypeError);
    expect(chunks).toEqual([]);
    output.result({ tokens: 1 });

    expect(chunks).toEqual([`{"type":"result","ok":true,"data":{"tokens":1},"ts":"${TS}"}\n`]);
  });

  it('refuses a second result with the refusal whatever its payload', () => {
    const { output } = jsonOutput();

    output.result('first');

    expect(() => output.result({ tokens: 1n })).toThrow(REFUSAL);
  });

  it('leaves the result unwritten when the stream throws, so the next is written', () => {
    const chunks: string[] = [];
    let failing = true;
    const output = createJsonOutput({
      now: () => NOW,
      stream: {
        write: (chunk) => {
          if (failing) throw new Error('stream closed');
          chunks.push(chunk);
          return true;
        },
      },
    });

    expect(() => output.result('lost')).toThrow('stream closed');
    failing = false;
    output.result('kept');

    expect(chunks).toEqual([`{"type":"result","ok":true,"data":"kept","ts":"${TS}"}\n`]);
  });
});
