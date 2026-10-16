import type { WorkspaceMember } from './package-entries';

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { isPublicEntry, memberOf, readMembers } from './package-entries';

/** Core as its manifest stands: named `rafa-core`, reached as `rafa/`. */
const CORE: WorkspaceMember = {
  exports: ['./core/config', './core/config/load', './ports', './ports/*', './store', './store/*'],
  folder: 'packages/rafa/',
  name: '@open-tomato/rafa-core',
};

/** A member whose manifest has no `exports`, as the hub's has none. */
const HUB: WorkspaceMember = { exports: [], folder: 'packages/rafa-hub/', name: '@open-tomato/rafa-hub' };

/** A member exporting its root only. */
const LINT: WorkspaceMember = { exports: ['.'], folder: 'packages/eslint-config/', name: '@open-tomato/rafa-eslint-config' };

describe('isPublicEntry', () => {
  it('holds a subpath to an exact exports key', () => {
    expect(isPublicEntry('@open-tomato/rafa-core/core/config/load', CORE)).toBe(true);
    expect(isPublicEntry('@open-tomato/rafa-core/store', CORE)).toBe(true);
  });

  it('holds a subpath to core\'s ./store/* wildcard key', () => {
    expect(isPublicEntry('@open-tomato/rafa-core/store/check-rows', CORE)).toBe(true);
    expect(isPublicEntry('@open-tomato/rafa-core/store/sync/push', CORE)).toBe(true);
  });

  it('holds a specifier whose name is not the member\'s but lands in its folder', () => {
    expect(isPublicEntry('@open-tomato/rafa/store/check-rows', CORE)).toBe(true);
    expect(isPublicEntry('@open-tomato/rafa/core/config', CORE)).toBe(true);
  });

  it('is false for core/absent, a subpath no key names', () => {
    expect(isPublicEntry('@open-tomato/rafa/core/absent', CORE)).toBe(false);
    expect(isPublicEntry('@open-tomato/rafa/core', CORE)).toBe(false);
  });

  it('is false for the wildcard\'s own prefix, which the star does not match empty', () => {
    expect(isPublicEntry('@open-tomato/rafa/store/', CORE)).toBe(false);
  });

  it('is false for every specifier of a member exporting nothing', () => {
    expect(isPublicEntry('@open-tomato/rafa-hub', HUB)).toBe(false);
    expect(isPublicEntry('@open-tomato/rafa-hub/src/bin', HUB)).toBe(false);
  });

  it('reads the bare package name as the `.` key', () => {
    expect(isPublicEntry('@open-tomato/rafa-eslint-config', LINT)).toBe(true);
    expect(isPublicEntry('@open-tomato/rafa-eslint-config/base', LINT)).toBe(false);
    expect(isPublicEntry('@open-tomato/rafa', CORE)).toBe(false);
  });

  it('is false for a specifier that is not bare or not of the scope', () => {
    expect(isPublicEntry('./store/check-rows.js', CORE)).toBe(false);
    expect(isPublicEntry('../rafa/src/store/index.js', CORE)).toBe(false);
    expect(isPublicEntry('/abs/packages/rafa/src/store/index.ts', CORE)).toBe(false);
    expect(isPublicEntry('@other/rafa/store/check-rows', CORE)).toBe(false);
    expect(isPublicEntry('@open-tomato/', CORE)).toBe(false);
  });
});

describe('memberOf', () => {
  const members = [CORE, HUB, LINT];

  it('answers the member whose folder holds the path', () => {
    expect(memberOf('packages/rafa/src/effort/store/check-rows.ts', members)).toBe(CORE);
    expect(memberOf('packages/rafa-hub/src/bin.ts', members)).toBe(HUB);
  });

  it('does not take a folder for the prefix of a longer sibling name', () => {
    expect(memberOf('packages/rafa-hub/package.json', [CORE])).toBeUndefined();
  });

  it('answers undefined for a path outside every member', () => {
    expect(memberOf('src/effort/store/index.ts', members)).toBeUndefined();
  });

  it('answers the deepest member when folders nest', () => {
    const inner: WorkspaceMember = { exports: [], folder: 'packages/rafa/inner/', name: '@open-tomato/inner' };
    expect(memberOf('packages/rafa/inner/a.ts', [CORE, inner])).toBe(inner);
    expect(memberOf('packages/rafa/inner/a.ts', [inner, CORE])).toBe(inner);
  });
});

describe('readMembers', () => {
  let root: string;

  /** Writes `value` as JSON at `path` under the planted root. */
  function plant(path: string, value: unknown): void {
    mkdirSync(join(root, path, '..'), { recursive: true });
    writeFileSync(join(root, path), JSON.stringify(value));
  }

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'package-entries-'));
  });

  afterEach(() => {
    rmSync(root, { force: true, recursive: true });
  });

  it('lists each member the workspaces globs name, with its folder, name and exports keys', () => {
    plant('package.json', { name: '@open-tomato/rafa', workspaces: ['packages/*', 'tools/one'] });
    plant('packages/rafa/package.json', {
      exports: { './store': './src/effort/store/index.ts', './store/*': './src/effort/store/*.ts' },
      name: '@open-tomato/rafa-core',
    });
    plant('packages/rafa-hub/package.json', { bin: { 'rafa-hub': './src/bin.ts' }, name: '@open-tomato/rafa-hub' });
    plant('tools/one/package.json', { exports: './index.ts', name: '@open-tomato/one' });
    plant('tools/two/package.json', { name: '@open-tomato/two' });
    writeFileSync(join(root, 'packages', 'stray.json'), '{}');

    expect(readMembers(root)).toEqual([
      { exports: ['./store', './store/*'], folder: 'packages/rafa/', name: '@open-tomato/rafa-core' },
      { exports: [], folder: 'packages/rafa-hub/', name: '@open-tomato/rafa-hub' },
      { exports: ['.'], folder: 'tools/one/', name: '@open-tomato/one' },
    ]);
  });

  it('reads a conditions-only exports object as the `.` key', () => {
    plant('package.json', { workspaces: ['packages/*'] });
    plant('packages/a/package.json', { exports: { import: './a.js', types: './a.d.ts' }, name: '@open-tomato/a' });

    expect(readMembers(root)).toEqual([{ exports: ['.'], folder: 'packages/a/', name: '@open-tomato/a' }]);
  });

  it('takes a negated glob\'s folders back out', () => {
    plant('package.json', { workspaces: ['packages/*', '!packages/skip'] });
    plant('packages/keep/package.json', { name: '@open-tomato/keep' });
    plant('packages/skip/package.json', { name: '@open-tomato/skip' });

    expect(readMembers(root).map((member) => member.folder)).toEqual(['packages/keep/']);
  });

  it('refuses a member folder with no package.json', () => {
    plant('package.json', { workspaces: ['packages/*'] });
    plant('packages/a/package.json', { name: '@open-tomato/a' });
    mkdirSync(join(root, 'packages', 'bare'));

    expect(() => readMembers(root)).toThrow('packages/bare/: a workspace member folder with no package.json');
  });

  it('refuses a root manifest with no workspaces array', () => {
    plant('package.json', { name: '@open-tomato/rafa' });

    expect(() => readMembers(root)).toThrow('holds no `workspaces` array of strings');
  });

  it('refuses a member manifest with no name', () => {
    plant('package.json', { workspaces: ['packages/*'] });
    plant('packages/a/package.json', { exports: './a.ts' });

    expect(() => readMembers(root)).toThrow('holds no string `name`');
  });
});
