/**
 * Tests for rafa's own cause codes, and the guard that holds the list
 * and the four older code unions together: every union value has an
 * entry whose `legacy` spells it, and every `legacy` names a union
 * value. Each union is read as a runtime list, since `tsc` skips test
 * files and a type-level check here would hold nothing.
 */
import { describe, expect, it } from 'bun:test';

import { DISPATCH_ERROR_CODES } from '../cli/dispatch.js';
import { ROUTE_REFUSALS } from '../cli/route.js';
import { FAILURE_STRING_CODES } from '../schema/failure-strings.js';
import { SKILL_ISSUE_CODES } from '../schema/skill.js';

import { familyOf } from './codes.js';
import { nearDuplicates, suggestCodes } from './match.js';
import { FAMILY_DESCRIPTIONS, listedCodes, RAFA_CODES } from './rafa-codes.js';

const UNIONS: ReadonlyArray<readonly [string, readonly string[]]> = [
  ['ROUTE_REFUSALS', ROUTE_REFUSALS],
  ['DISPATCH_ERROR_CODES', DISPATCH_ERROR_CODES],
  ['SKILL_ISSUE_CODES', SKILL_ISSUE_CODES],
  ['FailureStringCode', FAILURE_STRING_CODES],
];

describe('RAFA_CODES', () => {
  it('describes every family it uses', () => {
    const families = [...new Set(RAFA_CODES.map((entry) => familyOf(entry.code)))];
    expect(families.filter((family) => FAMILY_DESCRIPTIONS[family] === undefined)).toEqual([]);
  });

  it('holds no two leaves of one family that read alike', () => {
    expect(nearDuplicates(RAFA_CODES)).toEqual([]);
  });

  it('spells every legacy value at most once', () => {
    const legacy = RAFA_CODES.flatMap((entry) => entry.legacy === undefined
      ? []
      : [entry.legacy]);
    expect(legacy.length).toBe(new Set(legacy).size);
  });

  it.each(UNIONS)('has an entry for every value of %s', (_name, values) => {
    const legacy = new Set(RAFA_CODES.map((entry) => entry.legacy));
    expect(values.filter((value) => !legacy.has(value))).toEqual([]);
  });

  it('names only union values as legacy', () => {
    const known = new Set(UNIONS.flatMap(([, values]) => values));
    const stray = RAFA_CODES.filter((entry) => entry.legacy !== undefined && !known.has(entry.legacy));
    expect(stray.map((entry) => entry.code)).toEqual([]);
  });

  it('answers no code for an everyday sentence about a cause the list lacks', () => {
    expect(suggestCodes('the database connection pool is exhausted', RAFA_CODES)).toEqual([]);
    expect(suggestCodes('docker build runs out of memory on the runner', RAFA_CODES)).toEqual([]);
  });

  it('hints at what the code it names really offers', () => {
    const hintOf = (code: string): string | undefined => RAFA_CODES.find((entry) => entry.code === code)?.hint;

    expect(hintOf('cli:unknown-module')).toBe('run rafa module list for the modules that are mounted');
    expect(hintOf('cli:unexpected-version')).toBe('run rafa --version alone, with no command beside it');
    expect(hintOf('cli:result-unwritable')).toBe('file a bug: the command answered data that cannot be written as JSON');
  });

  it('tells a tracker passed over in the chain from one that cannot be reached', () => {
    const codes = RAFA_CODES.map((entry) => entry.code);

    expect(codes).toContain('tracker:unreachable');
    expect(codes).toContain('tracker:unavailable');
    expect(RAFA_CODES.find((entry) => entry.code === 'tracker:unavailable')?.level).toBe('warn');
  });

  it('ranks git:no-identity first for the spec example', () => {
    expect(suggestCodes('git commit has no author identity', RAFA_CODES)[0]?.code).toBe('git:no-identity');
  });
});

describe('listedCodes', () => {
  it('lists rafa first, then the project, each tagged', () => {
    const project = [{ code: 'deploy:missing-secret', description: 'a deploy reads an unset secret', hint: 'set it', level: 'error', since: 'v1' }] as const;
    const listed = listedCodes(project);
    expect(listed.at(-1)).toEqual({ ...project[0], source: 'project' });
    expect(listed[0]?.source).toBe('rafa');
  });
});
