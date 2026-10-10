import type { FailureStringCode } from '../schema/failure-strings.js';

import { describe, expect, it } from 'bun:test';

import { DISPATCH_ERROR_CODES } from '../cli/dispatch.js';
import { ROUTE_REFUSALS } from '../cli/route.js';
import { SKILL_ISSUE_CODES } from '../schema/skill.js';

import { familyOf } from './codes.js';
import { nearDuplicates, suggestCodes } from './match.js';
import { FAMILY_DESCRIPTIONS, listedCodes, RAFA_CODES } from './rafa-codes.js';

/** Every FailureStringCode, closed by `satisfies` so a new member reddens this file. */
const FAILURE_STRING_CODES = Object.keys({
  'empty-failure-string': true,
  'short-failure-string': true,
} satisfies Record<FailureStringCode, true>);

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
