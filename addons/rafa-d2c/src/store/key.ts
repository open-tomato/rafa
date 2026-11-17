/**
 * The storage key: where a baseline set lives in a store, and where a
 * run stages its results before the person promotes them.
 *
 *   <store dir>/<set>/<playwright version>/<runner key>/__image_snapshots__/*.png
 *   <store dir>/<set>/<playwright version>/<runner key>/set.json
 *   <store dir>/.staging/<set>/<runner key>/<run id>/
 *
 * The playwright version pins the Chromium revision, and the runner key
 * names what drew the pixels, so two sets drawn differently never stand
 * in for each other. No commit is in the key: the commit is in the
 * set's record.
 */
import { readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';

/** The folder of a set's PNGs inside its key folder. */
export const SNAPSHOTS_FOLDER = '__image_snapshots__';

/** A set's record inside its key folder. */
export const RECORD_FILE = 'set.json';

/** The store folder runs stage into. */
export const STAGING_FOLDER = '.staging';

/** The paths of one set at one key. */
export interface SetPaths {
  readonly keyDir: string;
  readonly snapshotsDir: string;
  readonly recordFile: string;
}

/** One key a set holds. */
export interface SetKey {
  readonly playwrightVersion: string;
  readonly runnerKey: string;
}

/** The node platforms a host key names. */
const HOST_PLATFORMS = new Set(['darwin', 'linux']);

/** Node's arch names to the key's. */
const HOST_ARCHES = new Map([['arm64', 'arm64'], ['x64', 'amd64']]);

/** The runner key of the host: `host-darwin-arm64`. Throws for a platform or arch with no key. */
export function hostRunnerKey(platform: string, arch: string): string {
  const keyArch = HOST_ARCHES.get(arch);
  if (!HOST_PLATFORMS.has(platform) || keyArch === undefined) {
    throw new Error(`the host runner has no key for platform ${platform} and arch ${arch}; it reads darwin or linux on arm64 or x64`);
  }
  return `host-${platform}-${keyArch}`;
}

/** The paths of `set` at one key under the store folder `dir`. */
export function setPaths(dir: string, set: string, playwrightVersion: string, runnerKey: string): SetPaths {
  const keyDir = join(dir, set, playwrightVersion, runnerKey);
  return { keyDir, snapshotsDir: join(keyDir, SNAPSHOTS_FOLDER), recordFile: join(keyDir, RECORD_FILE) };
}

/** The staging folder of one run. */
export function stagingDir(dir: string, set: string, runnerKey: string, runId: string): string {
  return join(dir, STAGING_FOLDER, set, runnerKey, runId);
}

/** The sub-folder names of `dir`, sorted; none when it is missing. */
async function foldersIn(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
}

/** Every key `set` holds under the store folder `dir`, sorted by version then runner key. */
export async function existingKeys(dir: string, set: string): Promise<readonly SetKey[]> {
  const keys: SetKey[] = [];
  for (const playwrightVersion of await foldersIn(join(dir, set))) {
    for (const runnerKey of await foldersIn(join(dir, set, playwrightVersion))) keys.push({ playwrightVersion, runnerKey });
  }
  return keys;
}

/**
 * The installed `playwright-core` version, resolved from the suite's
 * package folder with node's resolution, so a hoisted copy is found.
 * Throws naming the folder when none resolves.
 */
export function readPlaywrightVersion(packageDir: string): string {
  try {
    const require = createRequire(join(packageDir, 'package.json'));
    const manifest = require(require.resolve('playwright-core/package.json')) as { version?: unknown };
    if (typeof manifest.version === 'string') return manifest.version;
  } catch {
    // Answered below.
  }
  throw new Error(`playwright-core does not resolve from ${packageDir}; install the project's dependencies first`);
}

/** A run id: the UTC time to the second, then four hex digits. */
export function newRunId(now: Date, random: () => number): string {
  const stamp = now.toISOString().replace(/[-:]/g, '')
    .replace(/\.\d+Z$/, 'Z');
  const suffix = Math.floor(random() * 0x10000).toString(16)
    .padStart(4, '0');
  return `${stamp}-${suffix}`;
}
