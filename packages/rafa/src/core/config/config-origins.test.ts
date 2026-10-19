/**
 * Tests for `originOf`: the file and entry a resolved setting names,
 * read off the layer its source names, and none for the command line
 * or a default.
 *
 * Both files are built here as literals, each answering a different
 * entry for the same setting, so an origin read off the wrong layer
 * names the other file or the other entry. The template cases lay a
 * different template under each file, so a template origin read off the
 * wrong file names the other file and the other template.
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

/** `file` recording `template` as the template that answered each of `settings`. */
function withTemplate(file: ConfigFile, template: string, settings: readonly ConfigSetting[]): ConfigFile {
  return { ...file, templates: new Map(settings.map((setting) => [setting, template])) };
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

  it('names the project file, its templates entry and the template for a setting its template answered', () => {
    const project = withTemplate(
      fileAt('/repo/rafa.config.ts', new Map<ConfigSetting, number>([['store', 2], ['templates', 1]])),
      'escalation',
      ['checksTask'],
    );
    const user = withTemplate(USER, 'other', ['checksTask', 'checksStage']);

    expect(originOf('template', 'checksTask', project, user))
      .toEqual({ file: '/repo/rafa.config.ts', entry: 1, template: 'escalation' });
    expect(originOf('template', 'checksStage', project, user))
      .toEqual({ file: '/home/me/.rafa/config.yaml', entry: 0, template: 'other' });
  });

  it('carries no template for a file source, and names nothing for a template no file records', () => {
    const project = withTemplate(PROJECT, 'escalation', ['checksTask']);

    expect(originOf('file', 'store', project, USER)).toEqual({ file: '/repo/rafa.config.ts', entry: 2 });
    expect(originOf('template', 'checksLoop', project, USER)).toBeNull();
  });

  it('answers a frozen origin', () => {
    expect(Object.isFrozen(originOf('file', 'store', PROJECT, USER))).toBe(true);
  });
});
