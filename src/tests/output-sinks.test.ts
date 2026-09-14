/**
 * Tests for `sinkOutput` (`./output-sinks.ts`), the Output the loop's
 * tests read the active output through.
 *
 * Each level is read through a sink of its own while every other sink
 * records too, so a line handed to the wrong level is a reading here
 * rather than a line some other case happens not to look for.
 */
import type { CliEvent } from '../ports/index.js';

import { afterEach, describe, expect, it } from 'bun:test';

import { activeOutput, setActiveOutput } from '../adapters/output/active.js';

import { sinkOutput } from './output-sinks.js';

/** What every sink of one output received, in order, tagged by sink. */
function recorded(): { seen: string[]; output: ReturnType<typeof sinkOutput> } {
  const seen: string[] = [];
  const output = sinkOutput({
    info: (message) => {
      seen.push(`info:${message}`);
    },
    warn: (message) => {
      seen.push(`warn:${message}`);
    },
    error: (message) => {
      seen.push(`error:${message}`);
    },
    debug: (message) => {
      seen.push(`debug:${message}`);
    },
    event: (event) => {
      seen.push(`event:${event.type}`);
    },
    result: (payload) => {
      seen.push(`result:${JSON.stringify(payload)}`);
    },
  });
  return { seen, output };
}

const TS = '2026-09-14T12:00:00.000Z';

afterEach(() => {
  setActiveOutput(null);
});

describe('sinkOutput', () => {
  it('hands each line to the sink of its level, as it was handed', () => {
    const { seen, output } = recorded();

    output.info('\n✅ one');
    output.warn('   two');
    output.error('three');
    output.debug('four');

    expect(seen).toEqual(['info:\n✅ one', 'warn:   two', 'error:three', 'debug:four']);
  });

  it('hands a log event to the sink of its level, and any other event and a result to their own', () => {
    const { seen, output } = recorded();
    const log: CliEvent = { type: 'log', level: 'error', message: 'broke', ts: TS };
    const step: CliEvent = { type: 'step', name: 'load', ts: TS };

    output.emit(log);
    output.emit(step);
    output.result({ tasks: 2 });

    expect(seen).toEqual(['error:broke', 'event:step', 'result:{"tasks":2}']);
  });

  it('drops what has no sink, and answers a frozen output', () => {
    const kept: string[] = [];
    const output = sinkOutput({
      warn: (message) => {
        kept.push(message);
      },
    });

    output.info('dropped');
    output.error('dropped');
    output.debug('dropped');
    output.emit({ type: 'step', name: 'dropped', ts: TS });
    output.result('dropped');
    output.warn('kept');

    expect(kept).toEqual(['kept']);
    expect(Object.isFrozen(output)).toBe(true);
  });

  it('reads what a module writes once it is set as the active output', () => {
    const { seen, output } = recorded();

    setActiveOutput(output);
    activeOutput().info('through the active output');
    setActiveOutput(null);
    activeOutput().debug('after the default is back');

    // The control: the default text output at verbosity 0 writes no
    // debug line, and this sink saw only the line written while it was set.
    expect(seen).toEqual(['info:through the active output']);
    expect(activeOutput()).not.toBe(output);
  });
});
