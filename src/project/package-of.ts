/**
 * The package a file belongs to (#951): the nearest manifest above it,
 * inside the project.
 *
 * ## The rule
 *
 * From the file's directory, {@link packageOf} climbs to the project
 * root and answers the first `package.json` that holds a `name`: its
 * name, its version, and its directory relative to the root. In a
 * workspace that is the package the file is built and published with,
 * under bun, npm, pnpm and yarn alike, so the root manifest's
 * `workspaces` globs are never read. A manifest with no name, or one
 * that cannot be read as JSON, is passed over for the one above it: it
 * names no package.
 *
 * The climb stops at the root and never reads above it, so a manifest in
 * a parent directory, or in the home, stands in for nothing. A file
 * outside the root has no package. Paths are compared as written: a
 * caller with a symlinked root hands in the spelling its files use.
 *
 * ## Who reads it
 *
 * A bug's `Versions` section (`src/bugs/versions.ts`) names the package
 * of the file the error points at. The run contract's `ctx.packages`
 * (#119), the workspace packages a change reaches, is this over each
 * changed file.
 *
 * ## Its limit
 *
 * {@link PACKAGE_MANIFESTS} holds `package.json` alone. Another
 * ecosystem's manifest is another name in that list and a reader for it.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';

import { selfAndAncestors } from './scope.js';

/** The filesystem calls this module makes. */
export interface PackageFileSystem {
  /** True when anything is at `path`. */
  readonly exists: (path: string) => boolean;
  /** The text of the file at `path`. Throws when it cannot be read. */
  readonly readFile: (path: string) => string;
}

/** The {@link PackageFileSystem} over the disk. */
export const DISK_PACKAGE_FILE_SYSTEM: PackageFileSystem = Object.freeze({
  exists: (path: string) => existsSync(path),
  readFile: (path: string) => readFileSync(path, 'utf8'),
});

/** The manifest names read, first match in a directory winning. */
export const PACKAGE_MANIFESTS: readonly string[] = Object.freeze(['package.json']);

/** A package, as its manifest names it. */
export interface PackageOwner {
  readonly name: string;
  /** Its version, or null when the manifest holds none. */
  readonly version: string | null;
  /** Its directory, relative to the project root; `.` for the root. */
  readonly dir: string;
}

/** True when `path` is `root` or lies under it. Lexical: both are taken as written. */
export function isInside(root: string, path: string): boolean {
  const steps = relative(root, path);
  return steps === '' || (!steps.startsWith('..') && !isAbsolute(steps));
}

/** A string with something in it, or null. */
function textOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== ''
    ? value
    : null;
}

/**
 * The package the manifest in `dir` names, or null: for a directory with
 * none, one that cannot be read as JSON, and one with no name. A manifest
 * that cannot be read names no package, so the failure is answered as
 * null and the climb goes on; see the module note.
 */
function ownerAt(dir: string, root: string, fs: PackageFileSystem): PackageOwner | null {
  const file = PACKAGE_MANIFESTS.map((name) => join(dir, name)).find((path) => fs.exists(path));
  if (file === undefined) return null;
  try {
    const manifest: unknown = JSON.parse(fs.readFile(file));
    if (typeof manifest !== 'object' || manifest === null) return null;
    const { name, version } = manifest as { readonly name?: unknown; readonly version?: unknown };
    const named = textOrNull(name);
    return named === null
      ? null
      : { name: named, version: textOrNull(version), dir: relative(root, dir) || '.' };
  } catch {
    return null;
  }
}

/**
 * The package `file` belongs to under `root`, or null for a file outside
 * the root and a project with no named manifest above the file. `file`
 * is absolute, or relative to `root`. See the module note.
 */
export function packageOf(file: string, root: string, fs: PackageFileSystem = DISK_PACKAGE_FILE_SYSTEM): PackageOwner | null {
  const absolute = resolve(root, file);
  if (!isInside(root, absolute)) return null;
  return selfAndAncestors(dirname(absolute))
    .filter((dir) => isInside(root, dir))
    .map((dir) => ownerAt(dir, root, fs))
    .find((owner) => owner !== null) ?? null;
}

/** The package the root's own manifest names, or null when it names none. */
export function rootPackageOf(root: string, fs: PackageFileSystem = DISK_PACKAGE_FILE_SYSTEM): PackageOwner | null {
  return ownerAt(root, root, fs);
}
