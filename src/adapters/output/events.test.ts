/**
 * Cases for the events output (`adapters/output/events.ts`): a named
 * event is one `rafa· ` line of its summary, an error is one folded
 * `rafa· error` line, and every other call writes nothing.
 */
import type { OutputStream } from './stream.js';
import type { Output } from '../../ports/index.js';

import { describe, expect, it } from 'bun:test';

import { createEventsOutput, EVENT_PREFIX } from './events.js';

/** The instant every event here carries. */
const TS = '2026-10-01T12:00:00.000Z';

/** An events output, and the chunks it wrote. */
function eventsOutput(): { output: Output; chunks: string[] } {
  const chunks: string[] = [];
  const stream: OutputStream = {
    write: (chunk) => {
      chunks.push(chunk);
      return true;
    },
  };
  return { output: createEventsOutput({ stream }), chunks };
}

describe('createEventsOutput', () => {
  it('writes a named event as one prefixed line of its summary', () => {
    const { output, chunks } = eventsOutput();

    output.emit({ type: 'event', name: 'task-start', summary: 'task 3/9 start   "Group duplicate bugs"', data: {}, ts: TS });

    expect(chunks).toEqual([`${EVENT_PREFIX}task 3/9 start   "Group duplicate bugs"\n`]);
  });

  it('folds a summary holding newlines onto its one line', () => {
    const { output, chunks } = eventsOutput();

    output.emit({ type: 'event', name: 'halt', summary: 'halt             a\n  b\n', data: {}, ts: TS });

    expect(chunks).toEqual([`${EVENT_PREFIX}halt             a b\n`]);
  });

  it('writes nothing for info, warn, debug, result, a step or a log below error', () => {
    const { output, chunks } = eventsOutput();

    output.info('\n🔄 Executing task: x');
    output.warn('careful');
    output.debug('detail');
    output.result({ ok: true });
    output.emit({ type: 'step', name: 'x', ts: TS });
    output.emit({ type: 'log', level: 'info', message: 'x', ts: TS });

    expect(chunks).toEqual([]);
  });

  it('writes an error as one prefixed line, its blank lines and indentation folded', () => {
    const { output, chunks } = eventsOutput();

    output.error('\n❌ Task failed (exit 3).\n   Marked as blocked.');
    output.emit({ type: 'log', level: 'error', message: 'refused: no plan', ts: TS });

    expect(chunks).toEqual([
      `${EVENT_PREFIX}error            ❌ Task failed (exit 3). Marked as blocked.\n`,
      `${EVENT_PREFIX}error            refused: no plan\n`,
    ]);
  });

  it('is frozen', () => {
    const { output } = eventsOutput();

    expect(Object.isFrozen(output)).toBe(true);
  });
});
