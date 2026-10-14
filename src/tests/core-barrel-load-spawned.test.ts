import type { CapturedRun } from './cli-capture.js';

import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from 'bun:test';

import { expectExit } from './cli-capture.js';

/**
 * A barrel that closes a runtime cycle fails with a `ReferenceError` in one
 * import order only, so a green `tsc` proves nothing. Each case here loads
 * one file first in a fresh `bun` process, then the registry
 * (`src/config-registry.ts`), which registers the sections with core, and
 * reads a setting both off the registry's `SETTINGS` and off the specs the
 * core barrel's `activeSettings()` answers.
 */

const SRC = fileURLToPath(new URL('..', import.meta.url));
const CONFIG_BARREL_DIR = join(SRC, 'core', 'config');

const CONFIG_BARRELS: string[] = ['index.ts', 'sections.ts', 'load.ts'];

/** Section files hold their `*_SETTINGS` records; a test file is no section. */
const SECTION_FILES = readdirSync(SRC)
  .filter((name) => /^config-schema-.+\.ts$/.test(name) && !name.endsWith('.test.ts'))
  .sort();

/** The child's program: load `first`, then the registry, then read from both and the config barrel. */
const CHILD = `
const [first, registry, barrel] = process.argv.slice(1);
const loaded = await import(first);
const { SETTINGS } = await import(registry);
const config = await import(barrel);
const active = config.activeSettings();
const records = Object.entries(loaded)
  .filter(([name]) => name.endsWith('_SETTINGS'))
  .map(([, record]) => record);
const read = [];
for (const record of records) {
  const key = Object.keys(record)[0];
  if (key === undefined) throw new Error('an empty settings record in ' + first);
  if (SETTINGS[key] !== record[key]) throw new Error('SETTINGS does not hold ' + key + ' from ' + first);
  if (active[key] !== record[key]) throw new Error('activeSettings() does not hold ' + key + ' from ' + first);
  read.push(key);
}
console.log(JSON.stringify({ names: Object.keys(loaded).length, read, settings: Object.keys(active).length }));
`;

async function loadFirst(first: string): Promise<CapturedRun> {
  const child = Bun.spawn(
    ['bun', '-e', CHILD, first, join(SRC, 'config-registry.ts'), join(CONFIG_BARREL_DIR, 'index.ts')],
    { cwd: SRC, stdout: 'pipe', stderr: 'pipe' },
  );
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { exitCode, stdout, stderr };
}

interface Reading {
  readonly names: number;
  readonly read: readonly string[];
  readonly settings: number;
}

function reading(run: CapturedRun): Reading {
  return JSON.parse(run.stdout.trim()) as Reading;
}

describe('each config barrel loaded first in a fresh process', () => {
  test.each(CONFIG_BARRELS)('%s loads, exits 0 and SETTINGS is readable', async (barrel) => {
    const run = await loadFirst(join(CONFIG_BARREL_DIR, barrel));
    expectExit(run, 0);
    const result = reading(run);
    expect(result.names).toBeGreaterThan(0);
    expect(result.settings).toBeGreaterThan(0);
  });
});

describe('each config-schema section file loaded first in a fresh process', () => {
  test('the tree holds section files to load', () => {
    expect(SECTION_FILES.length).toBeGreaterThanOrEqual(11);
  });

  test.each(SECTION_FILES)('%s loads, exits 0 and its first setting is read from SETTINGS', async (file) => {
    const run = await loadFirst(join(SRC, file));
    expectExit(run, 0);
    const result = reading(run);
    if (file === 'config-schema-readings.ts') {
      // The readings file is a note: it exports nothing to read.
      expect(result.read).toEqual([]);
      return;
    }
    expect(result.read.length).toBeGreaterThan(0);
  });
});

const CORE_DIR = join(SRC, 'core');

/** The command, output, adapters and git barrels: one folder, one `index.ts`. */
const FOLDER_BARRELS: string[] = ['command', 'output', 'adapters', 'git'];

/** The child's program: load one barrel first and count what it exports. */
const BARREL_CHILD = `
const loaded = await import(process.argv[1]);
console.log(JSON.stringify({ names: Object.keys(loaded).length }));
`;

async function spawnBun(args: readonly string[]): Promise<CapturedRun> {
  const child = Bun.spawn(['bun', ...args], { cwd: SRC, stdout: 'pipe', stderr: 'pipe' });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { exitCode, stdout, stderr };
}

describe('each command, output, adapters and git barrel loaded first in a fresh process', () => {
  test.each(FOLDER_BARRELS)('core/%s/index.ts loads first and exits 0', async (folder) => {
    const run = await spawnBun(['-e', BARREL_CHILD, join(CORE_DIR, folder, 'index.ts')]);
    expectExit(run, 0);
    expect((JSON.parse(run.stdout.trim()) as { names: number }).names).toBeGreaterThan(0);
  });
});

describe('the entry point in a fresh process', () => {
  test('bun src/rafa.ts --version prints the version of the root package.json', async () => {
    const { version } = (await Bun.file(join(SRC, '..', 'package.json')).json()) as { version: string };
    const run = await spawnBun([join(SRC, 'rafa.ts'), '--version']);
    expectExit(run, 0);
    expect(run.stdout.trim()).toBe(`rafa ${version}`);
  });
});

/** The plan and loop barrels, and the store's entry, each loaded first. */
const PLAN_LOOP_STORE_FIRST: string[] = [
  join('core', 'plan', 'index.ts'),
  join('core', 'plan', 'block-reader.ts'),
  join('core', 'loop', 'index.ts'),
  join('core', 'loop', 'readings.ts'),
  join('effort', 'store', 'index.ts'),
];

describe('each plan and loop barrel, and the store entry, loaded first in a fresh process', () => {
  test.each(PLAN_LOOP_STORE_FIRST)('%s loads first and exits 0', async (file) => {
    const run = await spawnBun(['-e', BARREL_CHILD, join(SRC, file)]);
    expectExit(run, 0);
    expect((JSON.parse(run.stdout.trim()) as { names: number }).names).toBeGreaterThan(0);
  });
});
