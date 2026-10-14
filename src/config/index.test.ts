/**
 * Holds the `./config` subpath's values: it exports `defaults` and
 * `defineConfig` and no other value, and `defaults` holds every setting
 * whose default is not null at its file key, in the file's spelling, so
 * each value read back through its setting's reader is the default it
 * came from. The subpath's types are held in `shape.test.ts`.
 */
import { describe, expect, test } from 'bun:test';

import { CONFIG_DEFAULTS, SETTING_NAMES, SETTINGS } from '../config-registry.js';

import * as subpath from './index.js';

/** The value at a dotted key of a nested object, or undefined. */
function valueAt(entry: unknown, key: string): unknown {
  return key.split('.').reduce<unknown>(
    (at, segment) => typeof at === 'object' && at !== null
      ? (at as Record<string, unknown>)[segment]
      : undefined,
    entry,
  );
}

/** Every dotted path to a value that is no plain mapping, below `entry`. */
function leavesOf(entry: unknown, above = ''): string[] {
  if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return [above];
  return Object.entries(entry).flatMap(([key, value]) => {
    const path = above === ''
      ? key
      : `${above}.${key}`;
    return typeof value === 'object' && value !== null && !Array.isArray(value) && SETTING_NAMES.every(
      (setting) => SETTINGS[setting].key !== path,
    )
      ? leavesOf(value, path)
      : [path];
  });
}

/** Every mapping below `entry`, itself included. */
function mappingsOf(entry: unknown): object[] {
  if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return [];
  return [entry, ...Object.values(entry).flatMap(mappingsOf)];
}

const NULL_DEFAULTS = SETTING_NAMES.filter((setting) => CONFIG_DEFAULTS[setting] === null);

const SET_DEFAULTS = SETTING_NAMES.filter((setting) => CONFIG_DEFAULTS[setting] !== null);

describe('the ./config subpath', () => {
  test('exports defaults and defineConfig, and no other value', () => {
    expect(Object.keys(subpath).sort()).toEqual(['defaults', 'defineConfig']);
  });

  test('defineConfig answers the very list it is given', () => {
    const entries = [subpath.defaults];

    expect(subpath.defineConfig(entries)).toBe(entries);
  });
});

describe('defaults', () => {
  test('holds a value at the key of every setting whose default is not null, and nothing else', () => {
    expect(SET_DEFAULTS.length).toBeGreaterThan(80);
    expect(leavesOf(subpath.defaults).sort()).toEqual(SET_DEFAULTS.map((setting) => SETTINGS[setting].key).sort());
  });

  test('leaves out every setting whose default is null', () => {
    const keys = NULL_DEFAULTS.map((setting) => SETTINGS[setting].key);

    expect(keys).toContain('pr.base');
    expect(keys.filter((key) => valueAt(subpath.defaults, key) !== undefined)).toEqual([]);
  });

  test('reads back through each setting\'s reader to the default it came from', () => {
    const readings = SET_DEFAULTS.map((setting) => {
      const { key, read } = SETTINGS[setting];
      const reading = read(valueAt(subpath.defaults, key), { label: key, key });
      return { key, problems: reading.problems, value: reading.value };
    });

    expect(readings).toEqual(SET_DEFAULTS.map((setting) => ({
      key: SETTINGS[setting].key,
      problems: [],
      value: CONFIG_DEFAULTS[setting],
    })));
  });

  test('spells a map as a mapping and loop.settingSources as one comma-separated string', () => {
    expect(subpath.defaults.routing).toEqual(Object.fromEntries(CONFIG_DEFAULTS.routing));
    expect(subpath.defaults.loop?.settingSources).toBe(CONFIG_DEFAULTS.settingSources.join(','));
  });

  test('is frozen at every mapping', () => {
    const mappings = mappingsOf(subpath.defaults);

    expect(mappings.length).toBeGreaterThan(20);
    expect(mappings.filter((mapping) => !Object.isFrozen(mapping))).toEqual([]);
  });
});
