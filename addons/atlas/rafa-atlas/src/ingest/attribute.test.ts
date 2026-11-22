/**
 * Tests for `attribute.ts`: `discoverModules` expands each glob into the
 * folders under a tmpdir root, skipping dot folders, `node_modules` and
 * files, and refuses a glob it cannot read; `attributeModule` answers the
 * longest module a row's first naming text names as a whole path, the
 * artifact before the `what`. Each reading that could pass for the wrong
 * reason has a control beside it.
 */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { attributeModule, DEFAULT_MODULE_GLOBS, discoverModules } from './attribute.js';

const scope = realpathSync(mkdtempSync(join(tmpdir(), 'atlas-attribute-')));
afterAll(() => {
  rmSync(scope, { recursive: true, force: true });
});

/** A project root under the suite's scope holding `folders`, and `files` beside them. */
function projectWith(name: string, folders: readonly string[], files: readonly string[] = []): string {
  const root = join(scope, name);
  for (const folder of folders) mkdirSync(join(root, folder), { recursive: true });
  for (const file of files) writeFileSync(join(root, file), '');
  return root;
}

describe('discoverModules', () => {
  it('takes each folder the default globs name, sorted, and none for a glob whose parent is missing', () => {
    const root = projectWith('default', ['packages/rafa', 'packages/rafa-effort', 'src/cli', 'docs/guide']);

    expect(discoverModules(root)).toEqual(['packages/rafa', 'packages/rafa-effort', 'src/cli']);
    expect(DEFAULT_MODULE_GLOBS).toContain('addons/*');
  });

  it('skips dot folders, node_modules and files', () => {
    const root = projectWith('skipped', ['packages/a', 'packages/.cache', 'packages/node_modules'], ['packages/notes.md']);

    expect(discoverModules(root, ['packages/*'])).toEqual(['packages/a']);
  });

  it('control: the skipped names are there, so a scan that kept them would list them', () => {
    const root = projectWith('skipped-control', ['packages/a', 'packages/.cache', 'packages/node_modules'], ['packages/notes.md']);

    expect(discoverModules(root, ['packages/.cache', 'packages/node_modules'])).toEqual(['packages/.cache', 'packages/node_modules']);
  });

  it('expands a * at any segment and a literal folder, each module once', () => {
    const root = projectWith('nested', ['addons/atlas/data', 'addons/atlas/ui', 'addons/d2c/core']);

    expect(discoverModules(root, ['addons/*/*', 'addons/atlas/data'])).toEqual([
      'addons/atlas/data',
      'addons/atlas/ui',
      'addons/d2c/core',
    ]);
  });

  it.each([
    ['a double star', 'packages/**'],
    ['a star beside other characters', 'packages/rafa-*'],
    ['a parent segment', '../packages/*'],
    ['an empty segment', 'packages//*'],
    ['the empty glob', ''],
  ])('refuses %s, naming the glob', (_label, glob) => {
    const root = projectWith('refused', ['packages/a']);

    expect(() => discoverModules(root, [glob])).toThrow(`the module glob '${glob}'`);
  });
});

describe('attributeModule', () => {
  const modules = ['packages/rafa', 'packages/rafa-effort', 'src/cli', 'addons/atlas'];

  it('answers the longest module a text names', () => {
    expect(attributeModule(modules, ['packages/rafa-effort/src/report.ts:12 throws'])).toBe('packages/rafa-effort');
    expect(attributeModule(modules, ['packages/rafa/src/cli/run.ts throws'])).toBe('packages/rafa');
  });

  it('control: a shorter module that is a prefix of the longer one is not named by its text', () => {
    expect(attributeModule(['packages/rafa'], ['packages/rafa-effort/src/report.ts:12 throws'])).toBeNull();
  });

  it('takes the artifact before the what, and the what when the artifact names none', () => {
    expect(attributeModule(modules, ['addons/atlas/data/src/a.ts', 'src/cli is slow'])).toBe('addons/atlas');
    expect(attributeModule(modules, [null, 'src/cli is slow'])).toBe('src/cli');
    expect(attributeModule(modules, ['database is locked', 'src/cli is slow'])).toBe('src/cli');
  });

  it('names a module in an absolute path, and at the end of a sentence', () => {
    expect(attributeModule(modules, ['/home/someone/repo/packages/rafa/src/a.ts'])).toBe('packages/rafa');
    expect(attributeModule(modules, ['the bug sits in addons/atlas.'])).toBe('addons/atlas');
  });

  it('answers null for texts that name no module, or name one inside a longer word', () => {
    expect(attributeModule(modules, ['database is locked', null, ''])).toBeNull();
    expect(attributeModule(modules, ['xsrc/cli/run.ts', 'src/cli.ts'])).toBeNull();
    expect(attributeModule([], ['packages/rafa/src/a.ts'])).toBeNull();
  });
});
