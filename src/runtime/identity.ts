/**
 * Which kind of rafa build is running: an installed runtime, or a
 * development build run from a checkout.
 *
 * ## The two builds
 *
 * - An **installed runtime** is a rafa build under
 *   `~/.rafa/runtime/<version>/`, which `rafa self-update` copies from a
 *   checkout's `dist/` and which holds no `package.json`, or the package
 *   installed from npm, which ships `dist`, `NOTICE` and its
 *   `package.json` and no `src/`. The loop runs from one of these.
 * - A **development build** is rafa run from a checkout: `bun
 *   src/rafa.ts`, the checkout's own `dist/cli.js`, and every `bun test`
 *   process, whose entry is a test file under `src/`.
 *
 * The effort store tells them apart because a development build never
 * migrates the live store (`effort/store/development-build.ts`).
 *
 * ## How it is read
 *
 * {@link readRuntimeIdentity} starts at the entry file (`Bun.main` by
 * default), followed through its real path when it exists, so a link
 * such as `~/.rafa/bin/rafa` is judged by the build it points at. From
 * the entry's directory it walks up one directory at a time to the
 * nearest `package.json` whose `name` is rafa's (`@open-tomato/rafa`).
 * The build is a development build when that directory also holds
 * `src/rafa.ts`, and an installed runtime otherwise. A walk that
 * reaches the filesystem root without finding one is an installed
 * runtime, as a runtime copy is.
 *
 * The nearest one decides: an npm install of rafa inside a rafa
 * checkout's `node_modules` is installed, although the checkout above
 * it would read as a development build. A `package.json` naming another
 * package is passed over, and so is one that cannot be read or holds no
 * JSON object, since neither names rafa.
 */
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { name as RAFA_PACKAGE_NAME } from '../../package.json';

/** The manifest the walk looks for in each directory. */
const MANIFEST = 'package.json';

/** The file under a checkout that makes it one: the CLI's source entry. */
const CHECKOUT_ENTRY = join('src', 'rafa.ts');

/** An installed runtime: a runtime copy, or the package installed from npm. */
export interface InstalledIdentity {
  readonly kind: 'installed';
  /** The entry file, through its real path when it exists. */
  readonly entry: string;
}

/** A development build: rafa run from a checkout. */
export interface DevelopmentIdentity {
  readonly kind: 'development';
  /** The entry file, through its real path when it exists. */
  readonly entry: string;
  /** The checkout's root, the directory holding its `package.json` and `src/rafa.ts`. */
  readonly checkout: string;
}

/** Which build is running; see the module note. */
export type RuntimeIdentity = InstalledIdentity | DevelopmentIdentity;

/** `path` through its real path when it exists, and resolved otherwise. */
function realOrResolved(path: string): string {
  const resolved = resolve(path);
  return existsSync(resolved)
    ? realpathSync(resolved)
    : resolved;
}

/** The `name` a manifest holds, or null when it cannot be read or names none. */
function manifestName(file: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    // A manifest that cannot be read or parsed names no package, and so not rafa.
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
  const name: unknown = (parsed as Record<string, unknown>)['name'];
  return typeof name === 'string'
    ? name
    : null;
}

/** The nearest directory at or above `start` whose manifest names rafa, or null. */
function nearestRafaPackage(start: string): string | null {
  let dir = start;
  for (;;) {
    const manifest = join(dir, MANIFEST);
    if (existsSync(manifest) && manifestName(manifest) === RAFA_PACKAGE_NAME) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * Which build runs from `entry`, `Bun.main` by default. See the module
 * note for the walk.
 */
export function readRuntimeIdentity(entry: string = Bun.main): RuntimeIdentity {
  const real = realOrResolved(entry);
  const packageDir = nearestRafaPackage(dirname(real));
  if (packageDir !== null && existsSync(join(packageDir, CHECKOUT_ENTRY))) {
    return { kind: 'development', entry: real, checkout: packageDir };
  }
  return { kind: 'installed', entry: real };
}
