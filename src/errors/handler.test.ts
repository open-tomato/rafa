/**
 * Tests for the error handler: what `failureOf` answers for a
 * `RafaError` with and without an action, a `CommandExit` caused by one,
 * a chain past the walk's bound and a plain error with and without a
 * boundary; and the cause `causeOfDispatchCode` gives each dispatcher
 * code.
 */
import { describe, expect, it } from 'bun:test';

import { CommandExit } from '@open-tomato/rafa/core/command';
import { RafaError } from '@open-tomato/rafa/errors/rafa-error';

import { DISPATCH_ERROR_CODES } from '../cli/dispatch.js';

import { causeOfDispatchCode, codedErrorOf, failureOf, MAX_CAUSE_LINKS, UNCODED_CAUSE } from './handler.js';

class LoopError extends RafaError {
  static readonly module = 'loop';
}

const BOUNDARY = { module: 'loop', action: 'start' };

const IDENTITY_HINT = 'set user.name and user.email where the commit runs';

/** `inner` under `wrappers` plain errors, each the cause of the one above it. */
function chained(inner: unknown, wrappers: number): unknown {
  let top = inner;
  for (let index = 0; index < wrappers; index += 1) top = new Error(`wrapper ${index}`, { cause: top });
  return top;
}

describe('failureOf', () => {
  it('reads a RafaError with an action as it is', () => {
    const error = new LoopError({ code: 'git:no-identity', message: 'x', action: 'commit' });
    expect(failureOf(error, BOUNDARY)).toEqual({
      cause: 'git:no-identity',
      hint: IDENTITY_HINT,
      module: 'loop',
      action: 'commit',
      coded: true,
    });
  });

  it('gives a RafaError without an action the boundary\'s', () => {
    const error = new LoopError({ code: 'git:no-identity', message: 'x' });
    expect(failureOf(error, { module: 'status', action: 'status' })).toEqual({
      cause: 'git:no-identity',
      hint: IDENTITY_HINT,
      module: 'loop',
      action: 'status',
      coded: true,
    });
  });

  it('leaves a RafaError without an action at null where no command ran', () => {
    const error = new LoopError({ code: 'git:no-identity', message: 'x' });
    expect(failureOf(error, null).action).toBeNull();
  });

  it('reads the RafaError a CommandExit is caused by', () => {
    const cause = new LoopError({ code: 'git:no-identity', message: 'x' });
    const exit = new CommandExit(3, 'refused', { cause });
    expect(failureOf(exit, BOUNDARY)).toEqual({
      cause: 'git:no-identity',
      hint: IDENTITY_HINT,
      module: 'loop',
      action: 'start',
      coded: true,
    });
  });

  it('reads a CommandExit with no cause as uncoded', () => {
    expect(failureOf(new CommandExit(3, 'refused'), BOUNDARY)).toEqual({
      cause: UNCODED_CAUSE,
      hint: null,
      module: 'loop',
      action: 'start',
      coded: false,
    });
  });

  it('finds a RafaError at the last link the walk reads', () => {
    const coded = new LoopError({ code: 'git:no-identity', message: 'x' });
    const error = chained(coded, MAX_CAUSE_LINKS - 1);
    expect(failureOf(error, BOUNDARY)).toMatchObject({ cause: 'git:no-identity', coded: true });
  });

  it('stops at eight links, so a RafaError past them is not read', () => {
    expect(MAX_CAUSE_LINKS).toBe(8);
    const coded = new LoopError({ code: 'git:no-identity', message: 'x' });
    const error = chained(coded, MAX_CAUSE_LINKS);
    expect(failureOf(error, BOUNDARY)).toEqual({
      cause: UNCODED_CAUSE,
      hint: null,
      module: 'loop',
      action: 'start',
      coded: false,
    });
  });

  it('reads a plain error as uncoded, with the boundary\'s module and action', () => {
    expect(failureOf(new Error('boom'), { module: 'status', action: 'status' })).toEqual({
      cause: UNCODED_CAUSE,
      hint: null,
      module: 'status',
      action: 'status',
      coded: false,
    });
  });

  it('reads a plain error with no boundary as uncoded, with no module or action', () => {
    expect(failureOf(new Error('boom'), null)).toEqual({
      cause: 'unknown:new-context',
      hint: null,
      module: null,
      action: null,
      coded: false,
    });
  });

  it('reads a thrown value that is not an error as uncoded', () => {
    expect(failureOf('boom', BOUNDARY)).toMatchObject({ cause: UNCODED_CAUSE, coded: false });
  });
});

describe('codedErrorOf', () => {
  it('answers the RafaError itself', () => {
    const error = new LoopError({ code: 'git:no-identity', message: 'x' });
    expect(codedErrorOf(error)).toBe(error);
  });

  it('answers the first RafaError of the chain', () => {
    const inner = new LoopError({ code: 'tsc:tests-excluded', message: 'inner' });
    const outer = new LoopError({ code: 'git:no-identity', message: 'outer', cause: inner });
    expect(codedErrorOf(new Error('top', { cause: outer }))).toBe(outer);
  });

  it('answers null for a chain holding none', () => {
    expect(codedErrorOf(new Error('top', { cause: new Error('below') }))).toBeNull();
  });

  it('ends a chain whose cause loops back on itself', () => {
    const looped = new Error('looped');
    looped.cause = looped;
    expect(codedErrorOf(looped)).toBeNull();
  });
});

describe('causeOfDispatchCode', () => {
  const expected: Readonly<Record<(typeof DISPATCH_ERROR_CODES)[number], string>> = {
    unknown_subject: 'cli:unknown-subject',
    missing_action: 'cli:missing-action',
    unknown_action: 'cli:unknown-action',
    unknown_module: 'cli:unknown-module',
    unexpected_version: 'cli:unexpected-version',
    invalid_spec: 'cli:invalid-spec',
    no_project: 'cli:no-project',
    command_exit: 'cli:command-exit',
    command_error: 'unknown:new-context',
    result_unwritable: 'cli:result-unwritable',
  };

  it.each([...DISPATCH_ERROR_CODES])('gives %s its cause', (code) => {
    expect(causeOfDispatchCode(code)).toBe(expected[code]);
  });

  it('gives a code no entry spells unknown:new-context', () => {
    expect(causeOfDispatchCode('no_such_code')).toBe(UNCODED_CAUSE);
  });

  it('reads only the cli entries, so a skill entry\'s legacy spelling is not a dispatcher code', () => {
    expect(causeOfDispatchCode('missing-field')).toBe(UNCODED_CAUSE);
  });
});
