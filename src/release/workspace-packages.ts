/**
 * The one reader for "which packages does this workspace hold, and which
 * publish": settle, the release readers, the build and the graph check
 * all ask it rather than walking `packages/` themselves.
 *
 * A member is a `package.json` that the root manifest's `workspaces`
 * globs name, read in either form npm and bun accept: an array of globs,
 * or `{ "packages": [...] }`. A glob opening with `!` excludes what it
 * matches. Matching is {@link workspaceManifestPaths}, which is pure:
 * the two readers differ only in where the candidate paths and the
 * manifest texts come from.
 *
 * - {@link readWorkspacePackages} reads the disk: `Bun.Glob#scanSync`
 *   per glob for the candidates, `readFileSync` for each manifest.
 * - {@link readWorkspacePackagesAt} reads git objects only, so settle can
 *   ask it of a base commit without a checkout:
 *   `git show <commit>:package.json`, `git ls-tree -r -z --name-only
 *   <commit>` filtered to `package.json` paths, and one `git show` per
 *   member manifest.
 *
 * A member manifest that is no JSON object, or names no `name`, is a
 * problem naming its path: a member passed over in silence would be a
 * package that never releases, with nothing to say why. A root manifest
 * with no `workspaces` field answers an empty list, which is a
 * one-package project, not a fault.
 *
 * The root package itself is never a member here: the release modules
 * spell it `package: null`, and nothing reads the root's `name` to tell
 * it apart.
 */
import type { GitRunner } from '@open-tomato/rafa/core/git';

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { messageOf } from '@open-tomato/rafa/core/config/sections';
import { gitSaid } from '@open-tomato/rafa/core/git';

import { readManifestName, readManifestVersion } from './version.js';

/** The file name of every manifest, the root's and each member's. */
const MANIFEST = 'package.json';

/** The `/package.json` suffix a member manifest path ends with. */
const MANIFEST_SUFFIX = `/${MANIFEST}`;

/** One workspace member, as its manifest declares it. */
export interface WorkspacePackage {
  /** The manifest's `name`, trimmed. */
  readonly name: string;
  /** The member's directory relative to the root, `/` between segments (`packages/plugin`). */
  readonly dir: string;
  /** The manifest's `version`, trimmed, or null when it declares none. */
  readonly version: string | null;
  /** True when the manifest sets `private: true`, so the member never publishes. */
  readonly isPrivate: boolean;
  /** The manifest's path relative to the root: `<dir>/package.json`. */
  readonly manifestPath: string;
}

/** What either reader answers: every member, sorted by manifest path, or the sentence saying why not. */
export type WorkspacePackagesReading =
  | { readonly ok: true; readonly packages: readonly WorkspacePackage[] }
  | { readonly ok: false; readonly problem: string };

/** A manifest's text parsed, when it is a JSON object. */
type ManifestFields = Readonly<Record<string, unknown>>;

/**
 * The member manifest paths the `workspaces` globs name among
 * `candidates`, sorted and without repeats.
 *
 * @param globs - The root manifest's `workspaces` value, in array form
 *   or `{ packages: [] }` form; any other value names no glob, and an
 *   entry that is no string is passed over. A glob opening with `!`
 *   excludes what it matches; a trailing `/` and a leading `./` are
 *   dropped before matching.
 * @param candidates - `package.json` paths relative to the root, `/`
 *   between segments.
 * @returns The candidates some glob includes and no glob excludes.
 */
export function workspaceManifestPaths(globs: unknown, candidates: readonly string[]): string[] {
  const patterns = globsOf(globs);
  const included = patterns.filter((glob) => !glob.startsWith('!')).map(manifestGlob);
  const excluded = patterns.filter((glob) => glob.startsWith('!')).map((glob) => manifestGlob(glob.slice(1)));
  const matches = candidates.filter((path) => included.some((glob) => glob.match(path))
    && !excluded.some((glob) => glob.match(path)));
  return [...new Set(matches)].sort();
}

/**
 * The workspace members of the checkout at `root`, read off the disk.
 *
 * @param root - The directory holding the root `package.json`.
 * @returns Every member sorted by manifest path, or the problem.
 */
export function readWorkspacePackages(root: string): WorkspacePackagesReading {
  const rootPath = join(root, MANIFEST);
  if (!existsSync(rootPath)) return { ok: false, problem: `${rootPath} does not exist` };
  const rootText = readText(rootPath);
  if (typeof rootText !== 'string') return { ok: false, problem: rootText.problem };
  const rootFields = manifestFieldsOf(rootText);
  if (rootFields === null) return { ok: false, problem: `${rootPath} is no JSON object` };

  const candidates = globsOf(rootFields['workspaces'])
    .filter((glob) => !glob.startsWith('!'))
    .flatMap((glob) => [...manifestGlob(glob).scanSync({ cwd: root, onlyFiles: true })])
    .map((path) => path.split('\\').join('/'));
  const paths = workspaceManifestPaths(rootFields['workspaces'], candidates.filter(isMemberManifest));
  return packagesOf(paths, (path) => {
    const text = readText(join(root, path));
    return typeof text === 'string'
      ? text
      : { problem: `${path} could not be read: ${text.problem}` };
  });
}

/**
 * The workspace members of `commit`, read from git objects only, so no
 * checkout of `commit` is needed.
 *
 * @param git - The runner for the repository holding `commit`.
 * @param commit - Any commit-ish: `HEAD`, `origin/main`, a sha.
 * @returns Every member sorted by manifest path, or the problem.
 */
export function readWorkspacePackagesAt(git: GitRunner, commit: string): WorkspacePackagesReading {
  const shown = git(['show', `${commit}:${MANIFEST}`]);
  if (!shown.ok) return { ok: false, problem: `${commit}:${MANIFEST} could not be read: ${gitSaid(shown)}` };
  const rootFields = manifestFieldsOf(shown.stdout);
  if (rootFields === null) return { ok: false, problem: `${commit}:${MANIFEST} is no JSON object` };
  if (globsOf(rootFields['workspaces']).length === 0) return { ok: true, packages: [] };

  const listed = git(['ls-tree', '-r', '-z', '--name-only', commit]);
  if (!listed.ok) return { ok: false, problem: `${commit} could not be listed: ${gitSaid(listed)}` };
  const candidates = listed.stdout.split('\0').filter(isMemberManifest);
  const paths = workspaceManifestPaths(rootFields['workspaces'], candidates);
  return packagesOf(paths, (path) => {
    const member = git(['show', `${commit}:${path}`]);
    return member.ok
      ? member.stdout
      : { problem: `${commit}:${path} could not be read: ${gitSaid(member)}` };
  });
}

/**
 * The members that publish: those whose manifest does not set
 * `private: true`.
 *
 * @param packages - The members a reader answered.
 * @returns A new list, in the order given.
 */
export function publishableOf(packages: readonly WorkspacePackage[]): WorkspacePackage[] {
  return packages.filter((member) => !member.isPrivate);
}

/**
 * The member named `name`, or null when the workspace holds none.
 *
 * @param packages - The members a reader answered.
 * @param name - A manifest `name`, compared exactly.
 * @returns The first member with that name.
 */
export function packageNamed(packages: readonly WorkspacePackage[], name: string): WorkspacePackage | null {
  return packages.find((member) => member.name === name) ?? null;
}

/** The glob strings of a `workspaces` value, in either form. */
function globsOf(workspaces: unknown): string[] {
  const field = Array.isArray(workspaces)
    ? workspaces
    : isRecord(workspaces)
      ? workspaces['packages']
      : undefined;
  return Array.isArray(field)
    ? field.filter((glob): glob is string => typeof glob === 'string' && glob.trim() !== '')
    : [];
}

/** The glob a workspace glob names a member's manifest by. */
function manifestGlob(glob: string): Bun.Glob {
  const dir = glob.trim().replace(/^(?:\.\/)+/, '')
    .replace(/\/+$/, '');
  return new Bun.Glob(`${dir}${MANIFEST_SUFFIX}`);
}

/** True for a `package.json` path below the root; the root's own manifest is never a member. */
function isMemberManifest(path: string): boolean {
  return path.endsWith(MANIFEST_SUFFIX);
}

/** True for a plain object, the shape a manifest must have. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A manifest's fields, or null when the text is no JSON object. */
function manifestFieldsOf(text: string): ManifestFields | null {
  try {
    const parsed: unknown = JSON.parse(text);
    return isRecord(parsed)
      ? parsed
      : null;
  } catch {
    return null;
  }
}

/** A file's text, or the sentence saying why it could not be read. */
function readText(path: string): string | { readonly problem: string } {
  try {
    return readFileSync(path, 'utf8');
  } catch (error) {
    return { problem: messageOf(error) };
  }
}

/**
 * The members at `paths`, each manifest's text from `textOf`; every
 * manifest that is unreadable, no JSON object or names no `name` is
 * named in the problem, so one bad member does not hide another.
 */
function packagesOf(
  paths: readonly string[],
  textOf: (path: string) => string | { readonly problem: string },
): WorkspacePackagesReading {
  const packages: WorkspacePackage[] = [];
  const problems: string[] = [];
  for (const manifestPath of paths) {
    const read = memberOf(manifestPath, textOf(manifestPath));
    if ('problem' in read) {
      problems.push(read.problem);
    } else {
      packages.push(read);
    }
  }
  return problems.length > 0
    ? { ok: false, problem: problems.join('; ') }
    : { ok: true, packages };
}

/** One member read from its manifest's text, or the problem naming its path. */
function memberOf(
  manifestPath: string,
  text: string | { readonly problem: string },
): WorkspacePackage | { readonly problem: string } {
  if (typeof text !== 'string') return text;
  const fields = manifestFieldsOf(text);
  if (fields === null) return { problem: `${manifestPath} is no JSON object` };
  const name = readManifestName(text);
  if (name === null) return { problem: `${manifestPath} names no name` };
  return {
    name,
    dir: manifestPath.slice(0, -MANIFEST_SUFFIX.length),
    version: readManifestVersion(text),
    isPrivate: fields['private'] === true,
    manifestPath,
  };
}
