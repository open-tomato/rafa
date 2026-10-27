/**
 * The target of the pass-moves codemod (`pass-moves.ts`): the workspace
 * member a move list moves into. Core is the default, `packages/rafa/`; a
 * feature package such as `rafa-inventory` is named by `--package=` (#808,
 * pass 4). The target spells the paths every step reads: the package's
 * folder and source folder, where a coupled test parks, and the name a file
 * outside the package imports a moved file by; its `package.json` names the
 * feature packages it declares, whose files a moved test may reach without
 * parking ({@link declaredFolders}).
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { CORE_PACKAGE, CORE_PARKED_TESTS, CORE_SOURCE } from '../survey/core-moves';

import { CODE_EXTENSION } from './core-package-text';

/** The name a file outside core imports core by, with its closing `/`. */
export const PACKAGE_PREFIX = '@open-tomato/rafa/';

/** The folder name of core under `packages/`, as `--package=` spells it. */
export const CORE_NAME = 'rafa';

/** The folder a parked test's path is read below, with its closing `/`. */
export const SOURCE_ROOT = 'src/';

/** The folder every package's parking folder sits in, with its closing `/`. */
export const PARKING_ROOT = 'src/tests/';

/** The scope every workspace member's name opens with. */
const SCOPE = '@open-tomato/';

/** The name of a feature package, as `scripts/codemod/rewire-facade.ts` spells it. */
const FEATURE_NAME = /^rafa-[a-z][a-z0-9-]*$/;

/** The name core's `package.json` gives it, which a feature package declares and which is not a feature package. */
const CORE_MANIFEST_NAME = `${SCOPE}rafa-core`;

/** The package a move list moves into. */
export interface PassTarget {
  /** Its folder name under `packages/`, such as `rafa-inventory`. */
  readonly name: string;
  /** Its folder, such as `packages/rafa-inventory/`. */
  readonly folder: string;
  /** Its source folder, such as `packages/rafa-inventory/src/`. */
  readonly source: string;
  /** Where a moved test that reaches outside it parks, such as `src/tests/inventory-coupled/`. */
  readonly parked: string;
  /** The name a file outside it imports a moved file by, such as `@open-tomato/rafa-inventory/`. */
  readonly prefix: string;
  /** Whether it is core. */
  readonly core: boolean;
}

/** The two fields of a parked test its README row reads. */
export interface ParkedRow {
  /** Its parked path. */
  readonly to: string;
  /** The files outside the target and the move its imports reach, sorted. */
  readonly reaches: readonly string[];
}

/** A `--package=` that names no target. */
export class PassTargetError extends Error {}

/** Core, the target when `--package=` is absent. */
export const CORE_TARGET: PassTarget = {
  core: true,
  folder: CORE_PACKAGE,
  name: CORE_NAME,
  parked: CORE_PARKED_TESTS,
  prefix: PACKAGE_PREFIX,
  source: CORE_SOURCE,
};

/**
 * The target a `--package=` name spells: core for `rafa`, a feature package
 * for `rafa-<name>`, parking under `src/tests/<name>-coupled/`.
 *
 * @param name - The folder name under `packages/`, such as `rafa-inventory`.
 * @returns The target.
 * @throws {PassTargetError} When the name is neither `rafa` nor `rafa-<name>`.
 */
export function readPassTarget(name: string): PassTarget {
  if (name === CORE_NAME) {
    return CORE_TARGET;
  }
  if (!FEATURE_NAME.test(name)) {
    throw new PassTargetError(`--package=${name} names no rafa-<name> package`);
  }
  const folder = `packages/${name}/`;
  return {
    core: false,
    folder,
    name,
    parked: `${PARKING_ROOT}${name.slice('rafa-'.length)}-coupled/`,
    prefix: `${SCOPE}${name}/`,
    source: `${folder}${SOURCE_ROOT}`,
  };
}

/**
 * Checks that a feature target is a workspace member of the tree: its
 * folder holds a `package.json`. Core is not read, since the planted trees
 * of the core moves hold its source alone.
 *
 * @param root - The repository root.
 * @param target - The target.
 * @throws {PassTargetError} When the target's `package.json` is absent.
 */
export function checkWorkspaceMember(root: string, target: PassTarget): void {
  if (!target.core && !existsSync(join(root, target.folder, 'package.json'))) {
    throw new PassTargetError(`--package=${target.name} names no workspace member: ${target.folder}package.json is absent`);
  }
}

/**
 * The folders of the feature packages a target's `package.json` names under
 * `dependencies`: each `@open-tomato/rafa-<name>` key other than core's
 * `@open-tomato/rafa-core`, as `packages/rafa-<name>/`, sorted. Core
 * declares none, and a manifest with no `dependencies` reads none.
 *
 * @param root - The repository root.
 * @param target - The target, a workspace member ({@link checkWorkspaceMember}).
 * @returns The folders, each with its closing `/`.
 * @throws {PassTargetError} When the target's `package.json` is not a JSON object.
 */
export function declaredFolders(root: string, target: PassTarget): readonly string[] {
  if (target.core) {
    return [];
  }
  const path = join(root, target.folder, 'package.json');
  let manifest: unknown;
  try {
    manifest = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new PassTargetError(`cannot read ${target.folder}package.json: ${error instanceof Error
      ? error.message
      : String(error)}`);
  }
  if (typeof manifest !== 'object' || manifest === null) {
    throw new PassTargetError(`${target.folder}package.json is not a JSON object`);
  }
  const dependencies = (manifest as { dependencies?: unknown }).dependencies;
  if (typeof dependencies !== 'object' || dependencies === null) {
    return [];
  }
  return Object.keys(dependencies)
    .filter((name) => name !== CORE_MANIFEST_NAME && name.startsWith(SCOPE) && FEATURE_NAME.test(name.slice(SCOPE.length)))
    .map((name) => `packages/${name.slice(SCOPE.length)}/`)
    .sort();
}

/**
 * The subpath a file outside the target imports a target file by. For core,
 * its path below the source folder with a code extension and a closing
 * `/index` dropped, and `effort/store` spelled `store`; for a feature
 * package, its path below the source folder with its code extension dropped
 * and nothing else, since the package's `exports` maps `"./*"` to
 * `./src/*.ts`.
 *
 * @param target - The target.
 * @param path - A file's path under the target's source folder.
 * @returns The specifier, such as `@open-tomato/rafa/utils/tracker`.
 */
export function packageSubpath(target: PassTarget, path: string): string {
  const below = path.slice(target.source.length).replace(CODE_EXTENSION, '');
  if (!target.core) {
    return `${target.prefix}${below}`;
  }
  const folded = below.replace(/\/index$/, '');
  const named = folded === 'effort/store' || folded.startsWith('effort/store/')
    ? `store${folded.slice('effort/store'.length)}`
    : folded;
  return `${target.prefix}${named}`;
}

/**
 * Where a parked test lands: its path below `src/` under the target's
 * parking folder.
 *
 * @param target - The target.
 * @param path - Its path before the move, under `src/`.
 * @returns Its parked path.
 */
export function parkedPath(target: PassTarget, path: string): string {
  return `${target.parked}${path.slice(SOURCE_ROOT.length)}`;
}

/**
 * A parked test's row in its parking folder's README, its path relative to
 * that folder, as `src/tests/core-coupled/README.md` writes it.
 *
 * @param target - The target.
 * @param test - A parked test.
 * @returns The row.
 */
export function readmeRow(target: PassTarget, test: ParkedRow): string {
  return `| \`${test.to.slice(target.parked.length)}\` | ${test.reaches.map((path) => `\`${path}\``).join(', ')} |`;
}
