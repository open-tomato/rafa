/**
 * The public entries of the workspace members. The members are the
 * folders the root `package.json`'s `workspaces` globs name, read at run
 * time; a member's public entries are the keys of the `exports` of its
 * own `package.json`, wildcard keys included. A member whose manifest has
 * no `exports` has no public entry.
 *
 * A specifier is matched to a member by where it lands, never by its
 * name: code reaches core as `@open-tomato/rafa/<entry>` through the
 * `paths` map of `tsconfig.packages.json` while core's manifest is named
 * `@open-tomato/rafa-core`. The caller resolves the specifier, finds the
 * member with {@link memberOf}, and {@link isPublicEntry} then holds the
 * subpath after the specifier's package name to that member's keys.
 *
 * Reads the root `package.json` and each member's `package.json`;
 * refuses a root manifest that is not JSON or names no `workspaces`
 * array of strings, and a member folder with no `package.json`.
 */

import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** The scope whose bare specifiers {@link isPublicEntry} reads. */
const SCOPE = '@open-tomato/';

/** One workspace member, read from its folder's `package.json`. */
export interface WorkspaceMember {
  /** The member's folder relative to the repository root, closing `/`. */
  readonly folder: string;
  /** The `name` of the member's manifest. */
  readonly name: string;
  /** The keys of the member's `exports`, sorted; empty when it has none. */
  readonly exports: readonly string[];
}

/** Whether `value` is a plain object, not an array and not `null`. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Whether `value` is an array holding strings only. */
function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

/** Reads the JSON object at `path`, refusing text that is not one. */
function readManifest(path: string): Record<string, unknown> {
  let manifest: unknown;
  try {
    manifest = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error(`${path}: the manifest is not JSON (${(error as Error).message})`);
  }
  if (!isRecord(manifest)) {
    throw new Error(`${path}: the manifest is not a JSON object`);
  }
  return manifest;
}

/**
 * The keys of a manifest's `exports`. A string or array is the sugar for
 * `.`; an object whose keys open with `.` is a subpath map; any other
 * object is a conditions map, the sugar for `.` too.
 */
function exportKeys(exports: unknown): string[] {
  if (exports === undefined || exports === null) {
    return [];
  }
  if (!isRecord(exports)) {
    return ['.'];
  }
  const keys = Object.keys(exports);
  return keys.some((key) => key.startsWith('.'))
    ? keys.filter((key) => key.startsWith('.')).sort()
    : ['.'];
}

/** The `workspaces` globs of the root manifest, plain or under `packages`. */
function workspaceGlobs(manifest: Record<string, unknown>, path: string): string[] {
  const workspaces = isRecord(manifest.workspaces)
    ? manifest.workspaces.packages
    : manifest.workspaces;
  if (!isStringArray(workspaces)) {
    throw new Error(`${path}: the root manifest holds no \`workspaces\` array of strings`);
  }
  return workspaces;
}

/** The folders under `root` one glob names, without a closing `/`. */
function foldersOf(root: string, pattern: string): string[] {
  const glob = new Bun.Glob(pattern.replace(/\/+$/, ''));
  return [...glob.scanSync({ cwd: root, onlyFiles: false })]
    .filter((path) => statSync(join(root, path)).isDirectory());
}

/**
 * Lists the workspace members the root `package.json`'s `workspaces`
 * globs name. A glob opening with `!` takes the folders it names back out.
 *
 * @param root - the repository root holding the root `package.json`.
 * @returns each member with its folder (closing `/`), its manifest `name`
 *   and its `exports` keys, sorted by folder.
 * @throws when the root manifest is not a JSON object or names no
 *   `workspaces` array of strings, when a member folder holds no
 *   `package.json`, or when a member's manifest is not a JSON object or
 *   has no string `name`.
 */
export function readMembers(root: string): WorkspaceMember[] {
  const rootPath = join(root, 'package.json');
  const globs = workspaceGlobs(readManifest(rootPath), rootPath);
  const included = new Set(globs.filter((glob) => !glob.startsWith('!')).flatMap((glob) => foldersOf(root, glob)));
  for (const glob of globs.filter((pattern) => pattern.startsWith('!'))) {
    for (const folder of foldersOf(root, glob.slice(1))) {
      included.delete(folder);
    }
  }
  return [...included].sort().map((folder) => {
    const path = join(root, folder, 'package.json');
    if (!existsSync(path)) {
      throw new Error(`${folder}/: a workspace member folder with no package.json`);
    }
    const manifest = readManifest(path);
    if (typeof manifest.name !== 'string') {
      throw new Error(`${path}: the manifest holds no string \`name\``);
    }
    return { exports: exportKeys(manifest.exports), folder: `${folder}/`, name: manifest.name };
  });
}

/**
 * Finds the member whose folder holds a path; when folders nest, the
 * deepest one answers.
 *
 * @param path - a path relative to the repository root.
 * @param members - the members, as {@link readMembers} lists them.
 * @returns the member holding `path`, or `undefined` when none does.
 */
export function memberOf(path: string, members: readonly WorkspaceMember[]): WorkspaceMember | undefined {
  let deepest: WorkspaceMember | undefined;
  for (const member of members) {
    if (path.startsWith(member.folder) && member.folder.length > (deepest?.folder.length ?? -1)) {
      deepest = member;
    }
  }
  return deepest;
}

/**
 * The subpath of a bare `@open-tomato` specifier after its package name,
 * as an `exports` key spells it (`.` or `./<rest>`); `undefined` for a
 * specifier that is not bare or not of the scope.
 */
function scopedSubpath(specifier: string): string | undefined {
  if (!specifier.startsWith(SCOPE)) {
    return undefined;
  }
  const [name, ...rest] = specifier.slice(SCOPE.length).split('/');
  if (name === undefined || name === '') {
    return undefined;
  }
  return rest.length === 0
    ? '.'
    : `./${rest.join('/')}`;
}

/** Whether `subpath` matches an `exports` key, exact or through its `*`. */
function matchesKey(subpath: string, key: string): boolean {
  const star = key.indexOf('*');
  if (star === -1) {
    return subpath === key;
  }
  const prefix = key.slice(0, star);
  const suffix = key.slice(star + 1);
  return subpath.length > prefix.length + suffix.length
    && subpath.startsWith(prefix)
    && subpath.endsWith(suffix);
}

/**
 * Holds a specifier to a member's public entries. The specifier's own
 * package name is not compared with the member's manifest name: the
 * member is the one the specifier lands in, found by the caller.
 *
 * @param specifier - the import specifier, as written in the source.
 * @param member - the member the specifier lands in.
 * @returns `true` when the specifier is a bare `@open-tomato` specifier
 *   whose subpath after its package name an `exports` key of `member`
 *   names, exact or through a wildcard key; `false` for a member with no
 *   `exports`, a subpath no key names, and a specifier that is not bare
 *   or not of the scope.
 */
export function isPublicEntry(specifier: string, member: WorkspaceMember): boolean {
  const subpath = scopedSubpath(specifier);
  return subpath !== undefined && member.exports.some((key) => matchesKey(subpath, key));
}
