/**
 * Tests for the locked-settings declaration: every entry is a
 * `SETTINGS` key, and the set is exactly the two of the first release,
 * spelled here by their dotted file keys rather than read off the
 * module.
 */
import { describe, expect, it } from 'bun:test';

import { LOCKED_SETTINGS } from './config-locked.js';
import { SETTINGS } from './config-schema.js';

describe('LOCKED_SETTINGS', () => {
  it('holds every entry to a SETTINGS key', () => {
    const names = new Set(Object.keys(SETTINGS));

    expect(LOCKED_SETTINGS.filter((name) => !names.has(name))).toEqual([]);
  });

  it('locks effort.sync and prerequisites.required and nothing else', () => {
    const keys = LOCKED_SETTINGS.map((name) => SETTINGS[name].key);

    expect(keys).toEqual(['effort.sync', 'prerequisites.required']);
  });

  it('holds no entry twice', () => {
    expect(new Set(LOCKED_SETTINGS).size).toBe(LOCKED_SETTINGS.length);
  });

  it('does not compile a name outside SETTINGS', () => {
    // @ts-expect-error -- 'effort.sync' is a file key, not a setting name
    const wrong: typeof LOCKED_SETTINGS[number] = 'effort.sync';

    expect(Object.keys(SETTINGS)).not.toContain(wrong);
  });
});
