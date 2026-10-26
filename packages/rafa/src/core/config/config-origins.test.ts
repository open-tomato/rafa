/**
 * Tests for `originOf`: the file and entry a resolved setting names,
 * read off the file that answered it, and none for the command line or
 * a default.
 *
 * The files are built here as literals, each recording a different
 * entry for the same setting, so an origin read off any file but the
 * one handed in names the other file or the other entry. The two user
 * files both report source `user`, so only the file handed in can tell
 * them apart; the case naming each holds that. The template cases lay a
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
const LOCAL = fileAt('/repo/.rafa/config.yaml');
const USER = fileAt('/home/me/.rafa/rafa.config.ts', new Map<ConfigSetting, number>([['store', 4]]));
const USER_LOCAL = fileAt('/home/me/.rafa/config.yaml');

describe('originOf', () => {
  it('names the file handed in and the entry it records for a setting answered by file', () => {
    expect(originOf('file', 'store', PROJECT)).toEqual({ file: '/repo/rafa.config.ts', entry: 2 });
  });

  it('names entry 0 of a file recording no entries, a YAML file', () => {
    expect(originOf('local', 'store', LOCAL)).toEqual({ file: '/repo/.rafa/config.yaml', entry: 0 });
  });

  it('tells the two user files apart, both of source user, by the file handed in', () => {
    expect([originOf('user', 'store', USER), originOf('user', 'store', USER_LOCAL)]).toEqual([
      { file: '/home/me/.rafa/rafa.config.ts', entry: 4 },
      { file: '/home/me/.rafa/config.yaml', entry: 0 },
    ]);
  });

  it('names entry 0 for a setting a file of several entries records nothing for', () => {
    expect(originOf('file', 'planDir', PROJECT)).toEqual({ file: '/repo/rafa.config.ts', entry: 0 });
  });

  it('names nothing for the command line or a default, whatever file is handed in', () => {
    expect([originOf('cli', 'store', PROJECT), originOf('default', 'store', LOCAL)]).toEqual([null, null]);
  });

  it('names nothing for a file source with no file, rather than throwing', () => {
    expect([originOf('file', 'store', null), originOf('local', 'store', null), originOf('user', 'store', null)])
      .toEqual([null, null, null]);
  });

  it('names the file handed in, its templates entry and the template for a setting its template answered', () => {
    const project = withTemplate(
      fileAt('/repo/rafa.config.ts', new Map<ConfigSetting, number>([['store', 2], ['templates', 1]])),
      'escalation',
      ['checksTask'],
    );
    const userLocal = withTemplate(USER_LOCAL, 'other', ['checksTask', 'checksStage']);

    expect(originOf('template', 'checksTask', project))
      .toEqual({ file: '/repo/rafa.config.ts', entry: 1, template: 'escalation' });
    expect(originOf('template', 'checksTask', userLocal))
      .toEqual({ file: '/home/me/.rafa/config.yaml', entry: 0, template: 'other' });
  });

  it('carries no template for a file source, and names nothing for a template the file records none for', () => {
    const project = withTemplate(PROJECT, 'escalation', ['checksTask']);

    expect(originOf('file', 'store', project)).toEqual({ file: '/repo/rafa.config.ts', entry: 2 });
    expect(originOf('template', 'checksLoop', project)).toBeNull();
  });

  it('answers a frozen origin', () => {
    expect(Object.isFrozen(originOf('file', 'store', PROJECT))).toBe(true);
  });
});
