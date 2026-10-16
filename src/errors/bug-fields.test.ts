/**
 * Tests for `toBugFields`: the fields it answers for a `RafaError`, a
 * `CommandExit` caused by one, a plain error with a boundary and a value
 * that is no error; and that the artifact is the coded error's stack,
 * not the wrapper's.
 */
import { describe, expect, it } from 'bun:test';

import { CommandExit } from '@open-tomato/rafa/core/command';
import { RafaError } from '@open-tomato/rafa/errors/rafa-error';

import { toBugFields } from './bug-fields.js';
import { UNCODED_CAUSE } from './handler.js';

class LoopError extends RafaError {
  static readonly module = 'loop';
}

const BOUNDARY = { module: 'status', action: 'status' };

/** A coded error thrown from a function of its own, so its stack names it. */
function throwCoded(): LoopError {
  return new LoopError({ code: 'git:no-identity', message: 'no author identity is set', action: 'commit' });
}

/** A `CommandExit` built in a different function from the error it wraps. */
function convert(cause: unknown): CommandExit {
  return new CommandExit(3, 'refused', { cause });
}

describe('toBugFields', () => {
  it('reads a RafaError\'s module, action, cause and own stack', () => {
    const error = throwCoded();
    const fields = toBugFields(error, BOUNDARY);
    expect(fields).toEqual({
      module: 'loop',
      action: 'commit',
      cause: 'git:no-identity',
      artifact: error.stack ?? '',
    });
    expect(fields.artifact?.split('\n')[0]).toBe('LoopError: no author identity is set');
  });

  it('reads the RafaError a CommandExit wraps, with the boundary\'s action where it has none', () => {
    const cause = new LoopError({ code: 'git:no-identity', message: 'x' });
    expect(toBugFields(convert(cause), BOUNDARY)).toEqual({
      module: 'loop',
      action: 'status',
      cause: 'git:no-identity',
      artifact: cause.stack ?? '',
    });
  });

  it('writes the coded error\'s stack as the artifact, not the wrapper\'s', () => {
    const cause = throwCoded();
    const exit = convert(cause);
    const artifact = toBugFields(exit, BOUNDARY).artifact ?? '';
    // Control: the two stacks differ, so an artifact read from the wrapper would fail here.
    expect(exit.stack).not.toBe(cause.stack);
    expect(exit.stack).toContain('convert');
    expect(artifact).toBe(cause.stack ?? '');
    expect(artifact).toContain('throwCoded');
    expect(artifact).not.toContain('convert');
    expect(artifact).not.toContain('refused');
  });

  it('reads a plain error as uncoded, with the boundary\'s module and action and its own stack', () => {
    const error = new Error('boom');
    expect(toBugFields(error, BOUNDARY)).toEqual({
      module: 'status',
      action: 'status',
      cause: UNCODED_CAUSE,
      artifact: error.stack ?? '',
    });
    expect(toBugFields(error, BOUNDARY).artifact?.split('\n')[0]).toBe('Error: boom');
  });

  it('leaves the module and action null for a plain error where no command ran', () => {
    const fields = toBugFields(new Error('boom'), null);
    expect(fields.module).toBeNull();
    expect(fields.action).toBeNull();
    expect(fields.cause).toBe(UNCODED_CAUSE);
  });

  it('writes the name and message above a stack that does not open with them', () => {
    const error = new Error('boom');
    error.name = 'RenamedError';
    const artifact = toBugFields(error, BOUNDARY).artifact ?? '';
    expect(artifact.split('\n')[0]).toBe('RenamedError: boom');
    expect(artifact).toContain(error.stack ?? '');
  });

  it('answers the name and message alone for an error with no stack', () => {
    const error = new Error('boom');
    error.stack = undefined;
    expect(toBugFields(error, BOUNDARY).artifact).toBe('Error: boom');
  });

  it('answers the string form of a thrown value that is no error', () => {
    expect(toBugFields('boom', BOUNDARY)).toEqual({
      module: 'status',
      action: 'status',
      cause: UNCODED_CAUSE,
      artifact: 'boom',
    });
  });
});
