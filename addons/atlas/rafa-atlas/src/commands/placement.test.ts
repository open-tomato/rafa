/**
 * Tests for where the dispatcher places `build` and `serve`, which declare
 * `needsProject: true`: each line runs through the CLI's own `dispatch`
 * (`src/cli/dispatch.ts`) as `rafa module exec @open-tomato/rafa-atlas
 * <action>` does, with this module's command entry (`./index.ts`)
 * mounted under the config key its manifest declares, `atlas`, beside
 * core's `module exec`, in a working directory and a home under a tmpdir.
 *
 * Outside any project each ends as `no_project` with exit code 1 and
 * writes no replica. From a folder inside one, `build` writes the replica
 * at the project root with the layers of the project's `atlas` section,
 * which the dispatcher hands it as `moduleConfig`; with
 * `ATLAS_PROJECT_ROOT` set it reads that root's data, still with the
 * layers of the project it was placed in. `serve`, its signal already
 * aborted, builds the replica at the project root, serves it and stops,
 * exit 0. Each run's environment is the case's alone, so no variable of
 * the process running the tests reaches it, and the config keys are put
 * back after each run.
 */
import type { DispatchOutcome } from '../../../../../src/cli/dispatch.js';
import type { ModuleCommandEntry } from '../../../../../src/cli/modules.js';

import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createCommandRegistry } from '@open-tomato/rafa-core/cli/registry';
import { setModuleConfigKeys } from '@open-tomato/rafa-core/core/config/load';
import { Database } from 'bun:sqlite';
import { afterAll, describe, expect, it } from 'bun:test';

import { dispatch } from '../../../../../src/cli/dispatch.js';
import execCommand from '../../../../../src/commands/module/exec.js';
import { replicaPathOf } from '../build/index.js';
import { writeFixtureStore } from '../ingest/testdata/effort-store.fixture.js';

import { MODULE } from './shared.js';

const scope = realpathSync(mkdtempSync(join(tmpdir(), 'atlas-placement-')));
afterAll(() => {
  rmSync(scope, { recursive: true, force: true });
});

/** The config key the module's manifest declares under `provides.config`. */
const ATLAS_CONFIG_KEY = 'atlas';

/** The module's command entry, by its absolute path, with its config key. */
const ATLAS_ENTRY: ModuleCommandEntry = {
  name: MODULE,
  entry: fileURLToPath(new URL('./index.ts', import.meta.url)),
  configKey: ATLAS_CONFIG_KEY,
};

/** Where one dispatched line runs. */
interface Place {
  readonly cwd: string;
  readonly home: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** The invocation's signal; `serve` runs until it aborts. */
  readonly signal?: AbortSignal;
  /** The output mode; `json` when left out, since `serve` answers text only. */
  readonly outputMode?: 'text' | 'json';
}

/** Runs `rafa module exec @open-tomato/rafa-atlas <action> [...rest] --output=<mode>` at `place`. */
async function dispatchAtlas(
  action: string,
  rest: readonly string[],
  place: Place,
): Promise<{ outcome: DispatchOutcome; stdout: string }> {
  const stdout: string[] = [];
  const registry = createCommandRegistry({
    subjects: [{ name: 'module', summary: 'modules' }],
    commands: [execCommand],
  });
  const held = setModuleConfigKeys([ATLAS_CONFIG_KEY]);
  try {
    const outcome = await dispatch(['module', 'exec', MODULE, action, ...rest, `--output=${place.outputMode ?? 'json'}`], {
      registry,
      modules: [ATLAS_ENTRY],
      env: place.env ?? {},
      stdout: { write: (chunk) => stdout.push(chunk) },
      stderr: { write: () => true },
      cwd: place.cwd,
      home: place.home,
      ...(place.signal === undefined
        ? {}
        : { signal: place.signal }),
    });
    return { outcome, stdout: stdout.join('') };
  } finally {
    setModuleConfigKeys(held);
  }
}

/** Two module folders: a package and a root folder with no package. */
const MODULE_TREE: Readonly<Record<string, string>> = {
  'packages/core/package.json': JSON.stringify({ name: '@open-tomato/fixture-core' }),
  'packages/core/src/index.ts': 'export const core = 1;\n',
  'src/commands/index.ts': 'export const commands = 1;\n',
};

/** A root at `path` under the scope holding the fixture store and {@link MODULE_TREE}. */
function dataRoot(path: string): string {
  const root = join(scope, path);
  writeFixtureStore(root);
  for (const [file, text] of Object.entries(MODULE_TREE)) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), text);
  }
  return root;
}

/** The `atlas` section a placed project's config sets: one layer listing the fixture package. */
const ATLAS_YAML = 'atlas:\n  layers:\n    - name: core\n      modules: [\'@open-tomato/fixture-core\']\n';

/** A project under `name`: a {@link dataRoot} whose config sets {@link ATLAS_YAML}, and a home beside it. */
function placedProject(name: string): { readonly root: string; readonly home: string } {
  const root = dataRoot(join(name, 'project'));
  const home = join(scope, name, 'home');
  mkdirSync(home, { recursive: true });
  writeFileSync(join(root, '.rafa', 'config.yaml'), ATLAS_YAML);
  return { root, home };
}

/** A folder holding a fixture store and no project config, and a home beside it. */
function outsideAnyProject(name: string): { readonly cwd: string; readonly home: string } {
  const cwd = dataRoot(join(name, 'cwd'));
  const home = join(scope, name, 'home');
  mkdirSync(home, { recursive: true });
  return { cwd, home };
}

/** Each `module_facts` row's path, layer and rank, by path. */
function layerRows(root: string): readonly (readonly unknown[])[] {
  const database = new Database(replicaPathOf(root), { readonly: true });
  try {
    return database.query<{ path: string; layer: string | null; layer_rank: number | null }, []>(
      'SELECT path, layer, layer_rank FROM module_facts ORDER BY path',
    ).all()
      .map((row) => [row.path, row.layer, row.layer_rank]);
  } finally {
    database.close();
  }
}

/** The rows {@link ATLAS_YAML} stamps over {@link MODULE_TREE}. */
const PLACED_LAYERS = [
  ['packages/core', 'core', 0],
  ['src/commands', null, null],
];

describe('the build command as the dispatcher places it', () => {
  it('refuses a run outside any project as no_project, exit 1, writing no replica', async () => {
    const { cwd, home } = outsideAnyProject('build-outside');

    const { outcome } = await dispatchAtlas('build', [], { cwd, home });

    expect(outcome.exitCode).toBe(1);
    expect(outcome.result.error).toMatchObject({ code: 'no_project' });
    expect(existsSync(replicaPathOf(cwd))).toBe(false);
  });

  it('builds the replica at the project root from a folder inside it, with the layers of its atlas section', async () => {
    const { root, home } = placedProject('build-placed');

    const { outcome } = await dispatchAtlas('build', [], { cwd: join(root, 'src', 'commands'), home });

    expect(outcome.result.error).toBeUndefined();
    expect(outcome.exitCode).toBe(0);
    expect(outcome.result.data).toMatchObject({ replicaPath: replicaPathOf(root) });
    expect(layerRows(root)).toEqual(PLACED_LAYERS);
  });

  it('reads the data of ATLAS_PROJECT_ROOT when it is set, with the layers of the project it runs in', async () => {
    const { root, home } = placedProject('build-named');
    const named = dataRoot('build-named-data');

    const { outcome } = await dispatchAtlas('build', [], { cwd: root, home, env: { ATLAS_PROJECT_ROOT: named } });

    expect(outcome.exitCode).toBe(0);
    expect(existsSync(replicaPathOf(root))).toBe(false);
    expect(layerRows(named)).toEqual(PLACED_LAYERS);
  });
});

describe('the serve command as the dispatcher places it', () => {
  it('refuses a run outside any project as no_project, exit 1, building nothing', async () => {
    const { cwd, home } = outsideAnyProject('serve-outside');

    const { outcome } = await dispatchAtlas('serve', ['--port=0'], { cwd, home, outputMode: 'text' });

    expect(outcome.exitCode).toBe(1);
    expect(outcome.result.error).toMatchObject({ code: 'no_project' });
    expect(existsSync(replicaPathOf(cwd))).toBe(false);
  });

  it('serves the replica it builds at the project root from a folder inside it, then stops on its signal', async () => {
    const { root, home } = placedProject('serve-placed');
    const controller = new AbortController();
    controller.abort();

    const { outcome, stdout } = await dispatchAtlas('serve', ['--port=0'], {
      cwd: join(root, 'src'),
      home,
      outputMode: 'text',
      signal: controller.signal,
    });

    expect(outcome.result.error).toBeUndefined();
    expect(outcome.exitCode).toBe(0);
    expect(stdout).toContain(`/api/atlas over ${replicaPathOf(root)}, built on this start`);
    expect(layerRows(root)).toEqual(PLACED_LAYERS);
  });
});
