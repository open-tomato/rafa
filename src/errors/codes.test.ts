import { describe, expect, it } from 'bun:test';

import { codeProblem, defineErrorCodes, familyOf, isKnownCode } from './codes.js';

const ENTRY = {
  code: 'git:no-identity',
  description: 'a git commit runs with no author identity set',
  hint: 'set user.name and user.email for the checkout',
  level: 'error',
  since: '#949',
} as const;

describe('codeProblem', () => {
  it('accepts a kebab family and leaf', () => {
    expect(codeProblem('git:no-identity')).toBeNull();
  });

  it('refuses a code with no family', () => {
    expect(codeProblem('no-identity')).toBe('"no-identity" is not <family>:<leaf> in kebab-case');
  });

  it('refuses the reserved leaves and the unknown family', () => {
    expect(codeProblem('git:new-context')).toBe('"git:new-context" uses the reserved leaf new-context');
    expect(codeProblem('git:unknown')).toBe('"git:unknown" uses the reserved leaf unknown');
    expect(codeProblem('unknown:thing')).toBe('"unknown:thing" uses the reserved family unknown');
  });
});

describe('defineErrorCodes', () => {
  it('answers the entries frozen', () => {
    const list = defineErrorCodes([ENTRY]);
    expect(list).toEqual([ENTRY]);
    expect(Object.isFrozen(list)).toBe(true);
  });

  it('refuses a duplicate code, naming both indexes', () => {
    expect(() => defineErrorCodes([ENTRY, ENTRY])).toThrow('error codes: "git:no-identity" is declared at [0] and [1]');
  });

  it('refuses an empty hint', () => {
    expect(() => defineErrorCodes([{ ...ENTRY, hint: ' ' }])).toThrow('error codes: [0].hint is empty');
  });

  it('refuses a level outside error and warn', () => {
    expect(() => defineErrorCodes([{ ...ENTRY, level: 'info' as 'warn' }])).toThrow('error codes: [0].level is "info", expected error or warn');
  });
});

describe('isKnownCode', () => {
  const list = defineErrorCodes([ENTRY]);

  it('knows a declared code and its family new-context', () => {
    expect(isKnownCode('git:no-identity', list)).toBe(true);
    expect(isKnownCode('git:new-context', list)).toBe(true);
  });

  it('knows unknown:new-context always', () => {
    expect(isKnownCode('unknown:new-context', list)).toBe(true);
  });

  it('does not know an undeclared leaf or family', () => {
    expect(isKnownCode('git:other', list)).toBe(false);
    expect(isKnownCode('tsc:new-context', list)).toBe(false);
  });
});

describe('familyOf', () => {
  it('answers the part before the colon', () => {
    expect(familyOf('git:no-identity')).toBe('git');
  });
});
