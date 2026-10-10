/**
 * Tests for the `errors` section: `errors.codes`.
 *
 * The key is driven through the spec `SETTINGS` holds for it, so what is
 * proved is the reader the schema wires to the key. Every refusal sits
 * beside an accepting control, and every key and message is SPELLED,
 * never read off the module.
 */
import type { ErrorCodeEntry } from './errors/codes.js';

import { describe, expect, it } from 'bun:test';

import { SETTINGS } from './config-schema.js';

/** Where every case reads the key. */
const AT = { label: 'F: errors.codes', key: 'errors.codes' };

/** `errors.codes` read from `raw`. */
function read(raw: unknown): ReturnType<typeof SETTINGS.errorsCodes.read> {
  return SETTINGS.errorsCodes.read(raw, AT);
}

/** A project entry no rule refuses. */
const ENTRY: ErrorCodeEntry = { code: 'deploy:missing-secret', description: 'a deploy reads an unset secret', hint: 'set the secret', level: 'error', since: 'v1' };

describe('errors.codes', () => {
  it('accepts an empty list', () => {
    expect<unknown>(read([])).toEqual({ value: [], problems: [], extras: [] });
  });

  it('accepts a project family', () => {
    expect(read([ENTRY]).value).toEqual([ENTRY]);
  });

  it('accepts an entry naming no since, and answers it without one', () => {
    const rest = Object.fromEntries(Object.entries(ENTRY).filter(([key]) => key !== 'since'));

    expect<unknown>(read([rest])).toEqual({ value: [rest], problems: [], extras: [] });
  });

  it('refuses a since that is not text', () => {
    expect(read([{ ...ENTRY, since: 1.2 }]).problems).toEqual([
      'F: errors.codes[0].since is 1.2, expected the version or issue that added it, a non-empty string',
    ]);
  });

  it('accepts a new leaf in a rafa family', () => {
    expect(read([{ ...ENTRY, code: 'git:shallow-clone' }]).problems).toEqual([]);
  });

  it('refuses redefining a rafa code, naming both', () => {
    expect(read([{ ...ENTRY, code: 'git:no-identity' }]).problems).toEqual([
      'F: errors.codes[0].code is "git:no-identity", which rafa already declares; add a leaf of your own instead',
    ]);
  });

  it('refuses one code given twice, naming both indexes', () => {
    expect(read([ENTRY, ENTRY]).problems).toEqual(['F: errors.codes[1].code is "deploy:missing-secret", already given at [0]']);
  });

  it('refuses a reserved leaf', () => {
    expect(read([{ ...ENTRY, code: 'deploy:new-context' }]).problems).toEqual([
      'F: errors.codes[0].code is "deploy:new-context", expected a code: "deploy:new-context" uses the reserved leaf new-context',
    ]);
  });

  it('refuses a level outside error and warn', () => {
    expect(read([{ ...ENTRY, level: 'info' }]).problems).toEqual(['F: errors.codes[0].level is "info", expected one of: error, warn']);
  });

  it('refuses an entry missing its hint', () => {
    const rest = Object.fromEntries(Object.entries(ENTRY).filter(([key]) => key !== 'hint'));
    expect(read([rest]).problems).toEqual(['F: errors.codes[0].hint is undefined, expected the next action, a non-empty string']);
  });

  it('keeps an unknown key as an extra', () => {
    expect(read([{ ...ENTRY, hints: 'x' }]).extras).toEqual([{ key: 'errors.codes[0].hints', value: 'x' }]);
  });

  it('refuses a value that is not a list', () => {
    expect(read('git:x').problems).toEqual(['F: errors.codes is "git:x", expected a list of error code entries']);
  });
});
