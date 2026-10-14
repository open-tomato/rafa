/**
 * Tests for `originOf`: the file and entry a resolved setting names,
 * read off the layer its source names, and none for the command line
 * or a default.
 *
 * Both files are built here as literals, each answering a different
 * entry for the same setting, so an origin read off the wrong layer
 * names the other file or the other entry.
 */
import type { ConfigFile, ConfigLayer, ConfigSetting } from './config.js';

import { describe, expect, it } from 'bun:test';

import { originOf } from './config-origins.js';

/** A file at `path` naming no value, with `entries` when given. */
function fileAt(path: string, entries?: ReadonlyMap<ConfigSetting, number>): ConfigFile {
  return {
    path,
    values: {} as ConfigLayer,
    extras: [],
    ...(entries === undefined
      ? {}
      : { entries }),
  };
}

const PROJECT = fileAt('/repo/rafa.config.ts', new Map<ConfigSetting, number>([['store', 2]]));
const USER = fileAt('/home/me/.rafa/config.yaml');

describe('originOf', () => {
  it('names the project file and the entry it records for a setting answered by file', () => {
    expect(originOf('file', 'store', PROJECT, USER)).toEqual({ file: '/repo/rafa.config.ts', entry: 2 });
  });

  it('names entry 0 of a file recording no entries, a YAML file', () => {
    expect(originOf('user', 'store', PROJECT, USER)).toEqual({ file: '/home/me/.rafa/config.yaml', entry: 0 });
  });

  it('names entry 0 for a setting a file of several entries records nothing for', () => {
    expect(originOf('file', 'planDir', PROJECT, USER)).toEqual({ file: '/repo/rafa.config.ts', entry: 0 });
  });

  it('names nothing for the command line or a default, whatever files there are', () => {
    expect([originOf('cli', 'store', PROJECT, USER), originOf('default', 'store', PROJECT, USER)]).toEqual([null, null]);
  });

  it('names nothing for a file source with no file, rather than throwing', () => {
    expect([originOf('file', 'store', null, USER), originOf('user', 'store', PROJECT, null)]).toEqual([null, null]);
  });

  it('answers a frozen origin', () => {
    expect(Object.isFrozen(originOf('file', 'store', PROJECT, USER))).toBe(true);
  });
});
