import { describe, expect, it } from 'bun:test';

import { isInside, packageOf, rootPackageOf } from '@open-tomato/rafa/project/package-of';

import { PACKAGE_TREE, plantFiles, TREE_ROOT } from '../../package-tree.js';

/** The root package of the tree. */
const ROOT_PACKAGE = { name: '@acme/app', version: '1.2.0', dir: '.' };

describe('the package a file belongs to', () => {
  it('answers the nearest manifest above the file, by a relative or an absolute path', () => {
    const hub = { name: '@acme/hub', version: '0.3.1', dir: 'packages/hub' };
    expect(packageOf('packages/hub/src/deep/b.ts', TREE_ROOT, PACKAGE_TREE)).toEqual(hub);
    expect(packageOf('/repo/packages/hub/src/deep/b.ts', TREE_ROOT, PACKAGE_TREE)).toEqual(hub);
  });

  it('answers the root package for a file under no workspace', () => {
    expect(packageOf('src/a.ts', TREE_ROOT, PACKAGE_TREE)).toEqual(ROOT_PACKAGE);
  });

  it('passes over a manifest with no name and one that is not JSON', () => {
    expect(packageOf('packages/bare/c.ts', TREE_ROOT, PACKAGE_TREE)).toEqual(ROOT_PACKAGE);
    expect(packageOf('packages/broken/d.ts', TREE_ROOT, PACKAGE_TREE)).toEqual(ROOT_PACKAGE);
  });

  it('answers a package with no version as one', () => {
    expect(packageOf('packages/unversioned/e.ts', TREE_ROOT, PACKAGE_TREE))
      .toEqual({ name: '@acme/unversioned', version: null, dir: 'packages/unversioned' });
  });

  it('never leaves the root: a file outside it has no package, and the manifest above the root is never read', () => {
    expect(packageOf('/elsewhere/x.ts', TREE_ROOT, PACKAGE_TREE)).toBeNull();
    expect(packageOf('../x.ts', TREE_ROOT, PACKAGE_TREE)).toBeNull();
    const bare = plantFiles({ '/package.json': '{"name":"above"}', '/repo/src/a.ts': '' });
    expect(packageOf('src/a.ts', TREE_ROOT, bare)).toBeNull();
    expect(rootPackageOf(TREE_ROOT, bare)).toBeNull();
  });

  it('answers the root\'s own package', () => {
    expect(rootPackageOf(TREE_ROOT, PACKAGE_TREE)).toEqual(ROOT_PACKAGE);
  });

  it.each([
    ['/repo', '/repo', true],
    ['/repo', '/repo/a', true],
    ['/repo', '/repo2/a', false],
    ['/repo', '/', false],
  ])('reads %p as holding %p: %p', (root, path, inside) => {
    expect(isInside(root, path)).toBe(inside);
  });
});
