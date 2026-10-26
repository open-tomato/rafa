/**
 * A project tree in memory for the cases that ask which package a file
 * belongs to (`src/tests/core-coupled/project/package-of.test.ts`, `src/tests/core-coupled/bugs/stack-path.test.ts`):
 * a root package with two workspaces, one manifest with no name, one that
 * is not JSON, a dependency, and a manifest ABOVE the root that no walk
 * may reach.
 */
import type { PackageFileSystem } from '@open-tomato/rafa/project/package-of';

/** A file system over a map of absolute path to text. */
export function plantFiles(files: Readonly<Record<string, string>>): PackageFileSystem {
  return {
    exists: (path) => Object.hasOwn(files, path),
    readFile: (path) => {
      const text = files[path];
      if (text === undefined) throw new Error(`ENOENT: ${path}`);
      return text;
    },
  };
}

/** The root of {@link PACKAGE_TREE}. */
export const TREE_ROOT = '/repo';

/** The tree; see the module note. */
export const PACKAGE_TREE: PackageFileSystem = plantFiles({
  '/repo/package.json': '{"name":"@acme/app","version":"1.2.0","workspaces":["packages/*"]}',
  '/repo/src/a.ts': '',
  '/repo/packages/hub/package.json': '{"name":"@acme/hub","version":"0.3.1"}',
  '/repo/packages/hub/src/deep/b.ts': '',
  '/repo/packages/bare/package.json': '{"private":true}',
  '/repo/packages/bare/c.ts': '',
  '/repo/packages/broken/package.json': '{not json',
  '/repo/packages/broken/d.ts': '',
  '/repo/packages/unversioned/package.json': '{"name":"@acme/unversioned"}',
  '/repo/packages/unversioned/e.ts': '',
  '/repo/node_modules/dep/index.js': '',
  '/package.json': '{"name":"above","version":"9.9.9"}',
  '/elsewhere/x.ts': '',
});
