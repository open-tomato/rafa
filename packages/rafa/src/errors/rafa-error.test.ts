/**
 * Tests for `RafaError`'s fields: the code kept or replaced, the hint
 * and level read off `RAFA_CODES`, the module read off the constructed
 * class's static, the action and the cause, and the class name. The
 * first stack frame has its own contract suite.
 */
import { describe, expect, it } from 'bun:test';

import { RafaError, UNKNOWN_MODULE } from './rafa-error.js';

class LoopError extends RafaError {
  static readonly module = 'loop';
}

class GateError extends LoopError {}

class BareError extends RafaError {}

describe('RafaError code', () => {
  it('replaces an unshaped code with unknown:new-context and keeps it in context.code', () => {
    const error = new LoopError({ code: 'Not A Code', message: 'x', context: { path: 'a.ts' } });
    expect(error.code).toBe('unknown:new-context');
    expect(error.context).toEqual({ path: 'a.ts', code: 'Not A Code' });
  });

  it('keeps a shaped code no list holds as written, with no code in its context', () => {
    const error = new LoopError({ code: 'deploy:missing-secret', message: 'x' });
    expect(error.code).toBe('deploy:missing-secret');
    expect(error.context).toEqual({});
  });

  it('keeps a reserved but shaped code as written', () => {
    expect(new LoopError({ code: 'git:new-context', message: 'x' }).code).toBe('git:new-context');
  });

  it('answers its context frozen and leaves the given one untouched', () => {
    const given = { path: 'a.ts' };
    const error = new LoopError({ code: 'Bad', message: 'x', context: given });
    expect(Object.isFrozen(error.context)).toBe(true);
    expect(given).toEqual({ path: 'a.ts' });
  });
});

describe('RafaError hint and level', () => {
  it('takes the hint and level of the code\'s RAFA_CODES entry', () => {
    const error = new LoopError({ code: 'git:no-identity', message: 'x' });
    expect(error.hint).toBe('set user.name and user.email where the commit runs');
    expect(error.level).toBe('error');
  });

  it('takes a warn level from the entry', () => {
    expect(new LoopError({ code: 'git:filesystem-boundary', message: 'x' }).level).toBe('warn');
  });

  it('prefers the hint given over the entry\'s', () => {
    expect(new LoopError({ code: 'git:no-identity', message: 'x', hint: 'run git config' }).hint).toBe('run git config');
  });

  it('answers a null hint and the error level for a code with no entry', () => {
    const unlisted = new LoopError({ code: 'deploy:missing-secret', message: 'x' });
    expect(unlisted.hint).toBeNull();
    expect(unlisted.level).toBe('error');
    const newContext = new LoopError({ code: 'git:new-context', message: 'x' });
    expect(newContext.hint).toBeNull();
    expect(newContext.level).toBe('error');
  });
});

describe('RafaError module and action', () => {
  it('reads the module off the constructed class\'s static', () => {
    expect(new LoopError({ code: 'git:no-identity', message: 'x' }).module).toBe('loop');
  });

  it('inherits a parent class\'s static module', () => {
    expect(new GateError({ code: 'git:no-identity', message: 'x' }).module).toBe('loop');
  });

  it('answers unknown for a class that sets no module', () => {
    expect(new BareError({ code: 'git:no-identity', message: 'x' }).module).toBe(UNKNOWN_MODULE);
    expect(new RafaError({ code: 'git:no-identity', message: 'x' }).module).toBe('unknown');
  });

  it('keeps the action given, and null without one', () => {
    expect(new LoopError({ code: 'git:no-identity', message: 'x', action: 'start' }).action).toBe('start');
    expect(new LoopError({ code: 'git:no-identity', message: 'x' }).action).toBeNull();
  });
});

describe('RafaError cause, message and name', () => {
  it('carries the cause as ErrorOptions.cause', () => {
    const cause = new Error('underneath');
    expect(new LoopError({ code: 'git:no-identity', message: 'x', cause }).cause).toBe(cause);
  });

  it('sets no cause when none is given', () => {
    expect('cause' in new LoopError({ code: 'git:no-identity', message: 'x' })).toBe(false);
  });

  it('keeps the message as given', () => {
    expect(new LoopError({ code: 'git:no-identity', message: 'no author identity is set' }).message)
      .toBe('no author identity is set');
  });

  it('is named after the constructed class, on the error and its stack', () => {
    const error = new GateError({ code: 'git:no-identity', message: 'x' });
    expect(error.name).toBe('GateError');
    expect(error.stack?.split('\n')[0]).toBe('GateError: x');
    expect(new RafaError({ code: 'git:no-identity', message: 'x' }).name).toBe('RafaError');
  });

  it('is an Error, a RafaError and its own class', () => {
    const error = new GateError({ code: 'git:no-identity', message: 'x' });
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(RafaError);
    expect(error).toBeInstanceOf(LoopError);
  });
});
