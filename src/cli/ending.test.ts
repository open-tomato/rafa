/**
 * The ending's own cases: the endings `failure` and `success` build, the
 * error `endingError` gives from what the handler answered, the event
 * `resultEvent` tells each as, what `writeEnding` writes in each mode,
 * a coded failure's bracket and hint line among it, and `finish`'s
 * `result_unwritable` fallback. The dispatcher's
 * cases (`dispatch.test.ts`) read the same through whole invocations;
 * these hold the module apart from routing and running.
 */
import type { Ending, EndingSettings } from './ending.js';
import type { Failure } from '../errors/handler.js';
import type { CliContext } from '@open-tomato/rafa/core/command';
import type { CliEvent, Output } from '@open-tomato/rafa/ports';

import { describe, expect, it } from 'bun:test';

import { endingError, failure, finish, messageOf, resultEvent, success, writeEnding } from './ending.js';

/** The clock every event here is stamped from. */
const NOW = new Date('2026-10-16T00:00:00.000Z');

/** The hint the coded failures here carry. */
const HINT = 'set user.name and user.email where the commit runs';

/** What the handler answers for a coded error with a hint. */
const CODED: Failure = { cause: 'git:no-identity', hint: HINT, module: 'loop', action: 'commit', coded: true };

/** What the handler answers for a plain error a command threw. */
const UNCODED: Failure = { cause: 'unknown:new-context', hint: null, module: 'loop', action: 'crash', coded: false };

/** What a fake context and settings recorded. */
interface Written {
  readonly stderr: string[];
  readonly errors: string[];
  readonly events: CliEvent[];
  readonly results: unknown[];
}

/** A context in `mode` whose output records what it is handed, `emit` throwing when `emitThrows` holds. */
function fakeContext(mode: CliContext['outputMode'], written: Written, emitThrows: (event: CliEvent) => boolean = () => false): CliContext {
  const output: Output = {
    info: () => undefined,
    warn: () => undefined,
    error: (message) => {
      written.errors.push(message);
    },
    debug: () => undefined,
    emit: (event) => {
      if (emitThrows(event)) throw new Error('cannot hold it');
      written.events.push(event);
    },
    result: (value) => {
      written.results.push(value);
    },
  };
  return { args: [], flags: {}, outputMode: mode, verbosity: 1, output, signal: new AbortController().signal, env: {} };
}

/** Settings whose stderr records each write. */
function fakeSettings(written: Written): EndingSettings {
  return {
    stderr: {
      write: (chunk: string) => {
        written.stderr.push(chunk);
        return true;
      },
    },
    now: () => NOW,
  };
}

/** An empty record. */
function written(): Written {
  return { stderr: [], errors: [], events: [], results: [] };
}

describe('messageOf', () => {
  it('reads an Error by its message and anything else as a string', () => {
    expect(messageOf(new Error('boom'))).toBe('boom');
    expect(messageOf(42)).toBe('42');
  });
});

describe('failure and success', () => {
  it('builds a failure with exit code 1 and the rafa: line', () => {
    expect(failure('no_project', 'no project')).toEqual({
      exitCode: 1,
      payload: null,
      error: { code: 'no_project', message: 'no project', cause: 'cli:no-project' },
      stderrLine: 'rafa: no project',
      coded: false,
    });
  });

  it('builds a coded failure carrying the cause, hint, module and action the handler found', () => {
    expect(failure('command_error', 'x', CODED)).toEqual({
      exitCode: 1,
      payload: null,
      error: { code: 'command_error', message: 'x', cause: 'git:no-identity', hint: HINT, module: 'loop', action: 'commit' },
      stderrLine: 'rafa: x',
      coded: true,
    });
  });

  it('builds a success carrying its payload', () => {
    expect(success({ value: 7 })).toEqual({ exitCode: 0, payload: { value: 7 }, error: null, stderrLine: null, coded: false });
  });
});

describe('endingError', () => {
  it('gives an uncoded failure its dispatcher code\'s cause, and the module and action of the command that ran', () => {
    expect(endingError('command_exit', 'exit code 2', UNCODED)).toEqual({
      code: 'command_exit',
      message: 'exit code 2',
      cause: 'cli:command-exit',
      module: 'loop',
      action: 'crash',
    });
    expect(endingError('command_error', 'boom', UNCODED)).toEqual({
      code: 'command_error',
      message: 'boom',
      cause: 'unknown:new-context',
      module: 'loop',
      action: 'crash',
    });
  });

  it('gives a failure where nothing was thrown its cause alone', () => {
    expect(endingError('unknown_subject', 'unknown', null)).toEqual({ code: 'unknown_subject', message: 'unknown', cause: 'cli:unknown-subject' });
  });

  it('leaves out a hint, a module and an action the handler did not find', () => {
    const bare: Failure = { cause: 'git:no-identity', hint: null, module: 'loop', action: null, coded: true };
    expect(endingError('command_exit', 'refused', bare)).toEqual({
      code: 'command_exit',
      message: 'refused',
      cause: 'git:no-identity',
      module: 'loop',
    });
    expect(endingError('command_error', 'boom', { ...UNCODED, module: null, action: null })).toEqual({
      code: 'command_error',
      message: 'boom',
      cause: 'unknown:new-context',
    });
  });
});

describe('resultEvent', () => {
  it('tells a failure, a bare success and a success with data apart', () => {
    const ts = NOW.toISOString();
    expect(resultEvent(failure('command_error', 'x'), () => NOW)).toEqual({
      type: 'result',
      ok: false,
      error: { code: 'command_error', message: 'x', cause: 'unknown:new-context' },
      ts,
    });
    expect(resultEvent(success(null), () => NOW)).toEqual({ type: 'result', ok: true, ts });
    expect(resultEvent(success({ value: 'v' }), () => NOW)).toEqual({ type: 'result', ok: true, data: 'v', ts });
  });
});

describe('writeEnding', () => {
  const ending: Ending = failure('command_error', 'boom');
  const event = resultEvent(ending, () => NOW);

  it('emits the event in json mode and writes no stderr line', () => {
    const record = written();
    writeEnding(ending, event, fakeContext('json', record), fakeSettings(record));
    expect(record.events).toEqual([event]);
    expect(record.stderr).toEqual([]);
  });

  it('writes one error line in events mode, the exit code where no line is carried', () => {
    const record = written();
    writeEnding(ending, event, fakeContext('events', record), fakeSettings(record));
    const bare: Ending = { exitCode: 3, payload: null, error: { code: 'command_exit', message: 'exit code 3' }, stderrLine: null, coded: false };
    writeEnding(bare, resultEvent(bare, () => NOW), fakeContext('events', record), fakeSettings(record));
    expect(record.errors).toEqual(['rafa: boom', 'exit code 3']);
    expect(record.events).toEqual([]);
  });

  it('writes the stderr line and the payload in text mode', () => {
    const record = written();
    writeEnding(ending, event, fakeContext('text', record), fakeSettings(record));
    const given = success({ value: 'v' });
    writeEnding(given, resultEvent(given, () => NOW), fakeContext('text', record), fakeSettings(record));
    expect(record.stderr).toEqual(['rafa: boom\n']);
    expect(record.results).toEqual(['v']);
  });

  it('ends a coded failure\'s line with its cause in brackets and writes its hint below it in text mode', () => {
    const record = written();
    const coded = failure('command_error', 'x', CODED);
    writeEnding(coded, resultEvent(coded, () => NOW), fakeContext('text', record), fakeSettings(record));
    expect(record.stderr).toEqual(['rafa: x [git:no-identity]\n', `  hint: ${HINT}\n`]);
  });

  it('writes an uncoded failure of a command that ran as it is, with no bracket and no hint line', () => {
    const record = written();
    const uncoded = failure('command_error', 'boom', UNCODED);
    writeEnding(uncoded, resultEvent(uncoded, () => NOW), fakeContext('text', record), fakeSettings(record));
    expect(record.stderr).toEqual(['rafa: boom\n']);
  });

  it('writes no hint line for a coded failure with no hint, nor anything for one with no stderr line', () => {
    const record = written();
    const unhinted = failure('command_error', 'x', { ...CODED, hint: null });
    writeEnding(unhinted, resultEvent(unhinted, () => NOW), fakeContext('text', record), fakeSettings(record));
    const silent: Ending = { ...failure('command_exit', 'exit code 3', CODED), exitCode: 3, stderrLine: null };
    writeEnding(silent, resultEvent(silent, () => NOW), fakeContext('text', record), fakeSettings(record));
    expect(record.stderr).toEqual(['rafa: x [git:no-identity]\n']);
  });

  it('ends a coded failure\'s one events line with its cause in brackets, and writes no hint line', () => {
    const record = written();
    const coded = failure('command_error', 'x', CODED);
    writeEnding(coded, resultEvent(coded, () => NOW), fakeContext('events', record), fakeSettings(record));
    const silent: Ending = { ...failure('command_exit', 'exit code 3', CODED), exitCode: 3, stderrLine: null };
    writeEnding(silent, resultEvent(silent, () => NOW), fakeContext('events', record), fakeSettings(record));
    expect(record.errors).toEqual(['rafa: x [git:no-identity]', 'exit code 3 [git:no-identity]']);
    expect(record.stderr).toEqual([]);
  });

  it('carries the coded failure\'s members in the json event and writes no stderr line', () => {
    const record = written();
    const coded = failure('command_error', 'x', CODED);
    const event = resultEvent(coded, () => NOW);
    writeEnding(coded, event, fakeContext('json', record), fakeSettings(record));
    expect(record.events).toEqual([
      {
        type: 'result',
        ok: false,
        error: { code: 'command_error', message: 'x', cause: 'git:no-identity', hint: HINT, module: 'loop', action: 'commit' },
        ts: NOW.toISOString(),
      },
    ]);
    expect(record.stderr).toEqual([]);
  });
});

describe('finish', () => {
  it('answers the exit code and the event written', () => {
    const record = written();
    const outcome = finish(success(null), fakeContext('json', record), fakeSettings(record));
    expect(outcome).toEqual({ exitCode: 0, result: { type: 'result', ok: true, ts: NOW.toISOString() } });
    expect(record.events).toEqual([outcome.result]);
  });

  it('falls back to result_unwritable when the event cannot be written', () => {
    const record = written();
    const context = fakeContext('json', record, (event) => event.type === 'result' && event.ok);
    const outcome = finish(success({ value: 1 }), context, fakeSettings(record));
    expect(outcome.exitCode).toBe(1);
    expect(outcome.result).toEqual({
      type: 'result',
      ok: false,
      error: { code: 'result_unwritable', message: 'the result could not be written: cannot hold it', cause: 'cli:result-unwritable' },
      ts: NOW.toISOString(),
    });
    expect(record.events).toEqual([outcome.result]);
  });
});
