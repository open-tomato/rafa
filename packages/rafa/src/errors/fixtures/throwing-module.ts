/**
 * Support file for `../rafa-error.contract.test.ts`: a module that throws
 * a `RafaError` subclass, and throws whatever error class it is handed.
 * The contract asserts that the first stack frame of the thrown error
 * names this file, the module that threw it.
 */

import { RafaError } from '../rafa-error.js';

/** A module class as a rafa module declares one. */
export class FixtureError extends RafaError {
  static readonly module = 'fixture';
}

/** The constructor shape the contract's control classes share. */
export type ThrownErrorClass = new (message: string) => Error;

/** Throws a `FixtureError` from this file. */
export function throwFixtureError(): never {
  throw new FixtureError({ code: 'fixture:thrown', message: 'thrown from the fixture' });
}

/** Throws an instance of `ErrorClass` from this file. */
export function throwControl(ErrorClass: ThrownErrorClass): never {
  throw new ErrorClass('thrown from the fixture');
}
