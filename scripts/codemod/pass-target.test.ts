/**
 * The target of the pass-moves codemod: the reader of a `--package=` name,
 * the workspace-member check and the declared feature packages over a
 * planted folder, and the three path functions for core and for a feature
 * package.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import {
  checkWorkspaceMember,
  CORE_TARGET,
  declaredFolders,
  packageSubpath,
  parkedPath,
  PassTargetError,
  readmeRow,
  readPassTarget,
} from './pass-target';

const INVENTORY = readPassTarget('rafa-inventory');

const roots: string[] = [];

afterAll(() => {
  for (const root of roots) rmSync(root, { force: true, recursive: true });
});

describe('readPassTarget', () => {
  it('reads core from rafa, the very CORE_TARGET', () => {
    expect(readPassTarget('rafa')).toBe(CORE_TARGET);
    expect(CORE_TARGET).toEqual({
      core: true,
      folder: 'packages/rafa/',
      name: 'rafa',
      parked: 'src/tests/core-coupled/',
      prefix: '@open-tomato/rafa/',
      source: 'packages/rafa/src/',
    });
  });

  it('reads a feature package, parked under the name after rafa- with -coupled', () => {
    expect(INVENTORY).toEqual({
      core: false,
      folder: 'packages/rafa-inventory/',
      name: 'rafa-inventory',
      parked: 'src/tests/inventory-coupled/',
      prefix: '@open-tomato/rafa-inventory/',
      source: 'packages/rafa-inventory/src/',
    });
    expect(readPassTarget('rafa-sync-service').parked).toBe('src/tests/sync-service-coupled/');
  });

  it.each([
    ['a name without rafa-', 'inventory'],
    ['a bare rafa-', 'rafa-'],
    ['a path', '../rafa-inventory'],
    ['an upper-case name', 'rafa-Inventory'],
  ])('refuses %s, naming it', (_name, name) => {
    expect(() => readPassTarget(name)).toThrow(PassTargetError);
    expect(() => readPassTarget(name)).toThrow(`--package=${name} names no rafa-<name> package`);
  });
});

describe('checkWorkspaceMember', () => {
  const root = mkdtempSync(join(tmpdir(), 'pass-target-'));
  roots.push(root);
  mkdirSync(join(root, 'packages/rafa-inventory'), { recursive: true });
  writeFileSync(join(root, 'packages/rafa-inventory/package.json'), '{"name":"@open-tomato/rafa-inventory"}\n');

  it('passes a feature package whose folder holds a package.json', () => {
    expect(() => {
      checkWorkspaceMember(root, INVENTORY);
    }).not.toThrow();
  });

  it('refuses a feature package with no package.json, naming it', () => {
    expect(() => {
      checkWorkspaceMember(root, readPassTarget('rafa-nowhere'));
    }).toThrow('--package=rafa-nowhere names no workspace member: packages/rafa-nowhere/package.json is absent');
  });

  it('reads nothing for core, whose planted trees hold its source alone', () => {
    expect(() => {
      checkWorkspaceMember(root, CORE_TARGET);
    }).not.toThrow();
  });
});

describe('declaredFolders', () => {
  const root = mkdtempSync(join(tmpdir(), 'pass-target-declared-'));
  roots.push(root);
  mkdirSync(join(root, 'packages/rafa-pr'), { recursive: true });
  writeFileSync(join(root, 'packages/rafa-pr/package.json'), `${JSON.stringify({
    dependencies: { '@open-tomato/rafa-board': 'workspace:*', '@open-tomato/rafa-core': 'workspace:*' },
    devDependencies: { '@open-tomato/rafa-eslint-config': 'workspace:*' },
    name: '@open-tomato/rafa-pr',
  })}\n`);
  mkdirSync(join(root, 'packages/rafa-inventory'), { recursive: true });
  writeFileSync(join(root, 'packages/rafa-inventory/package.json'), '{"name":"@open-tomato/rafa-inventory"}\n');

  it('reads none for core', () => {
    expect(declaredFolders(root, CORE_TARGET)).toEqual([]);
  });

  it('reads a target naming core and board as board\'s folder alone, devDependencies unread', () => {
    expect(declaredFolders(root, readPassTarget('rafa-pr'))).toEqual(['packages/rafa-board/']);
  });

  it('reads none for a manifest with no dependencies', () => {
    expect(declaredFolders(root, INVENTORY)).toEqual([]);
  });
});

describe('packageSubpath', () => {
  it.each([
    ['packages/rafa/src/utils/tracker.ts', '@open-tomato/rafa/utils/tracker'],
    ['packages/rafa/src/config-schema-bugs.ts', '@open-tomato/rafa/config-schema-bugs'],
    ['packages/rafa/src/core/config/index.ts', '@open-tomato/rafa/core/config'],
    ['packages/rafa/src/effort/store/index.ts', '@open-tomato/rafa/store'],
    ['packages/rafa/src/effort/store/sqlite.ts', '@open-tomato/rafa/store/sqlite'],
    ['packages/rafa/src/modules/testdata/fixture/package.json', '@open-tomato/rafa/modules/testdata/fixture/package.json'],
  ])('spells core\'s %s as %s', (path, expected) => {
    expect(packageSubpath(CORE_TARGET, path)).toBe(expected);
  });

  it.each([
    ['packages/rafa-inventory/src/learning/index.ts', '@open-tomato/rafa-inventory/learning/index'],
    ['packages/rafa-inventory/src/tiers/resolve.ts', '@open-tomato/rafa-inventory/tiers/resolve'],
    ['packages/rafa-inventory/src/effort/store/index.ts', '@open-tomato/rafa-inventory/effort/store/index'],
    ['packages/rafa-inventory/src/report/testdata/lessons.txt', '@open-tomato/rafa-inventory/report/testdata/lessons.txt'],
  ])('spells a feature package\'s %s as %s, its code extension dropped and nothing else', (path, expected) => {
    expect(packageSubpath(INVENTORY, path)).toBe(expected);
  });
});

describe('parkedPath and readmeRow', () => {
  it('parks a test at its path below src/ under the target\'s parking folder', () => {
    expect(parkedPath(CORE_TARGET, 'src/utils/tracker.test.ts')).toBe('src/tests/core-coupled/utils/tracker.test.ts');
    expect(parkedPath(INVENTORY, 'src/tiers/routing.test.ts')).toBe('src/tests/inventory-coupled/tiers/routing.test.ts');
  });

  it('writes a README row relative to the target\'s parking folder', () => {
    const core = readmeRow(CORE_TARGET, { reaches: ['package.json', 'src/tests/git-identity.ts'], to: 'src/tests/core-coupled/utils/git.test.ts' });
    const inventory = readmeRow(INVENTORY, { reaches: ['src/config-registry.ts'], to: 'src/tests/inventory-coupled/tiers/routing.test.ts' });

    expect(core).toBe('| `utils/git.test.ts` | `package.json`, `src/tests/git-identity.ts` |');
    expect(inventory).toBe('| `tiers/routing.test.ts` | `src/config-registry.ts` |');
  });
});
