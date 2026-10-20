/**
 * Tests for the templates `loadConfig` lays under each file of a scope:
 * each name a file's `templates` key gives is read through the active
 * template hook as an entry ahead of the file's own, so the file's keys
 * outrank the template's, a project's template outranks the user's
 * files, and a scope's YAML file's template outranks its module file, a
 * setting the template answered reporting source `template`.
 *
 * The defaults of `tests.integration` and its two neighbours are empty
 * (`CONFIG_DEFAULTS`), so the `escalation` template's values, which are
 * not, tell a template laid from one dropped by the value alone. Every
 * case still reads the source beside the value, and reads a `checks.*`
 * key too, whose default is empty and whose template value is not.
 *
 * Every refusal is paired with the acceptance that makes it a reading:
 * the unknown name beside the known one loading, the load with no hook
 * set beside the same file under the registry's hook, and a template's
 * stray key beside the same hook answering a clean entry.
 *
 * The settings and the hook are the ones `src/config-registry.ts` sets
 * when it is imported, as this file imports it. A case that sets a hook
 * of its own puts the one it found back in a `finally`, since bun runs
 * every test file in one process.
 */
import type { ConfigTemplateHook } from '@open-tomato/rafa/core/config/section';

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, afterEach, describe, expect, it } from 'bun:test';

import { ConfigError } from '@open-tomato/rafa/core/config/config';
import { loadConfig } from '@open-tomato/rafa/core/config/config-load';
import { setConfigTemplateHook } from '@open-tomato/rafa/core/config/section';
import { setActiveStoreSettings } from '@open-tomato/rafa/store/settings';

import { setActiveLoggerSettings } from '../../../../adapters/logger/settings.js';
import { CONFIG_DEFAULTS } from '../../../../config-registry.js';

/** The four spellings of an integration test the `escalation` template names. */
const INTEGRATION = [
  '**/*-integration.test.ts',
  '**/*.integration.test.ts',
  '**/*-spawned*.test.ts',
  '**/*-cli.test.ts',
];

const tempRoot = mkdtempSync(join(tmpdir(), 'rafa-config-load-templates-'));
let planted = 0;

afterAll(() => {
  rmSync(tempRoot, { recursive: true, force: true });
});

// `loadConfig` hands the store and the logger the settings it resolved,
// which a later file would otherwise open with.
afterEach(() => {
  setActiveStoreSettings(null);
  setActiveLoggerSettings(null);
});

/** A fresh, empty directory under this file's temporary root. */
function freshDir(name: string): string {
  planted += 1;
  const dir = join(tempRoot, `${planted}-${name}`);
  mkdirSync(dir);
  return dir;
}

/** Writes `text` at `path`, creating its directory, and answers `path`. */
function write(path: string, text: string): string {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
  return path;
}

/** A project root and a home side by side, each holding its YAML text if given, and the two paths. */
function scopes(project: string | null, user: string | null = null): {
  root: string;
  home: string;
  projectFile: string;
  userFile: string;
} {
  const root = freshDir('project');
  const home = freshDir('home');
  const projectFile = join(root, '.rafa', 'config.yaml');
  const userFile = join(home, '.rafa', 'config.yaml');
  if (project !== null) write(projectFile, project);
  if (user !== null) write(userFile, user);
  return { root, home, projectFile, userFile };
}

/** A warning sink that keeps nothing. */
function quiet(): void {}

/** The {@link ConfigError} `run` rejects with. Fails when it settles otherwise. */
async function refusal(run: () => Promise<unknown>): Promise<ConfigError> {
  try {
    await run();
  } catch (error) {
    if (error instanceof ConfigError) return error;
    throw error;
  }
  throw new Error('expected a ConfigError, and the load resolved');
}

/** Runs `body` with `hook` as the template hook, putting the one it found back after. */
async function withHook<T>(hook: ConfigTemplateHook | null, body: () => Promise<T>): Promise<T> {
  const held = setConfigTemplateHook(hook);
  try {
    return await body();
  } finally {
    setConfigTemplateHook(held);
  }
}

describe('loadConfig laying a YAML file\'s templates under its keys', () => {
  it('resolves tests.integration to the four spellings with source template for a project naming escalation', async () => {
    const { root, home, projectFile } = scopes('templates: [escalation]\n');

    const resolved = await loadConfig({ root, home }, {}, quiet);

    expect(resolved.config.testsIntegration).toEqual(INTEGRATION);
    expect(resolved.sources.testsIntegration).toBe('template');
    expect(resolved.provenance.testsIntegration).toEqual({ file: projectFile, entry: 0, template: 'escalation' });
    expect(resolved.config.checksTask).toEqual(['affected']);
    expect(resolved.sources.checksTask).toBe('template');
    expect(resolved.config.templates).toEqual(['escalation']);
    expect(resolved.sources.templates).toBe('local');
  });

  it('leaves every key to its default with source default for the same project naming no template', async () => {
    const { root, home } = scopes('templates: []\n');

    const resolved = await loadConfig({ root, home }, {}, quiet);

    expect(resolved.config.testsIntegration).toEqual(CONFIG_DEFAULTS.testsIntegration);
    expect(resolved.sources.testsIntegration).toBe('default');
    expect(resolved.config.checksTask).toEqual([]);
    expect(resolved.sources.checksTask).toBe('default');
    expect(resolved.provenance.checksTask).toBeNull();
  });

  it('lets the file\'s own tests.integration: [] outrank the template, resolving empty with source local', async () => {
    const { root, home, projectFile } = scopes('templates: [escalation]\ntests:\n  integration: []\n');

    const resolved = await loadConfig({ root, home }, {}, quiet);

    expect(resolved.config.testsIntegration).toEqual([]);
    expect(resolved.sources.testsIntegration).toBe('local');
    expect(resolved.provenance.testsIntegration).toEqual({ file: projectFile, entry: 0 });
    expect(resolved.config.testsContract).toEqual(['**/*.contract.test.ts']);
    expect(resolved.sources.testsContract).toBe('template');
  });

  it('lays a user file\'s template under a project file that sets the key, and under the user file\'s own keys', async () => {
    const { root, home, projectFile, userFile } = scopes(
      'tests:\n  integration: [\'e2e/**/*.test.ts\']\n',
      'templates: [escalation]\nchecks:\n  loop: [related]\n',
    );

    const resolved = await loadConfig({ root, home }, {}, quiet);

    expect(resolved.config.testsIntegration).toEqual(['e2e/**/*.test.ts']);
    expect(resolved.sources.testsIntegration).toBe('local');
    expect(resolved.provenance.testsIntegration).toEqual({ file: projectFile, entry: 0 });
    expect(resolved.config.checksLoop).toEqual(['related']);
    expect(resolved.sources.checksLoop).toBe('user');
    expect(resolved.config.checksStage).toEqual(['related', 'integration']);
    expect(resolved.sources.checksStage).toBe('template');
    expect(resolved.provenance.checksStage).toEqual({ file: userFile, entry: 0, template: 'escalation' });
  });

  it('lets a project\'s template outrank the user file', async () => {
    const { root, home, projectFile } = scopes('templates: [escalation]\n', 'checks:\n  task: [full]\n  stretch: [unit]\n');

    const resolved = await loadConfig({ root, home }, {}, quiet);

    expect(resolved.config.checksTask).toEqual(['affected']);
    expect(resolved.sources.checksTask).toBe('template');
    expect(resolved.provenance.checksTask).toEqual({ file: projectFile, entry: 0, template: 'escalation' });
    expect(resolved.config.checksStretch).toEqual(['unit']);
    expect(resolved.sources.checksStretch).toBe('user');
  });

  it('lays a later template over an earlier one, both under the file', async () => {
    const hook: ConfigTemplateHook = (name) => name === 'first'
      ? { pr: { base: 'first' }, store: 'ndjson' }
      : name === 'second'
        ? { pr: { base: 'second', mergeMethod: 'rebase' } }
        : null;
    const { root, home, projectFile } = scopes('templates: [first, second]\npr:\n  mergeMethod: merge\n');

    const resolved = await withHook(hook, () => loadConfig({ root, home }, {}, quiet));

    expect([resolved.config.prBase, resolved.config.store, resolved.config.prMergeMethod]).toEqual(['second', 'ndjson', 'merge']);
    expect([resolved.sources.prBase, resolved.sources.store, resolved.sources.prMergeMethod]).toEqual(['template', 'template', 'local']);
    expect([resolved.provenance.prBase, resolved.provenance.store]).toEqual([
      { file: projectFile, entry: 0, template: 'second' },
      { file: projectFile, entry: 0, template: 'first' },
    ]);
  });
});

describe('loadConfig refusing a template name', () => {
  it('refuses a name the hook does not know, naming the file and the known names', async () => {
    const { root, home, projectFile } = scopes('templates: [escalation, escalate]\n');

    const error = await refusal(() => loadConfig({ root, home }, {}, quiet));

    expect(error.problems).toEqual([
      `${projectFile}: templates names "escalate", which no template holds (known templates: escalation)`,
    ]);
  });

  it('refuses a user file\'s unknown name too, naming the user file', async () => {
    const { root, home, userFile } = scopes(null, 'templates: [nonesuch]\n');

    const error = await refusal(() => loadConfig({ root, home }, {}, quiet));

    expect(error.problems).toEqual([
      `${userFile}: templates names "nonesuch", which no template holds (known templates: escalation)`,
    ]);
  });

  it('refuses a templates key read with no hook set, the known names none, where the registry\'s hook reads it', async () => {
    const { root, home, projectFile } = scopes('templates: [escalation]\n');

    const error = await withHook(null, () => refusal(() => loadConfig({ root, home }, {}, quiet)));
    const resolved = await loadConfig({ root, home }, {}, quiet);

    expect(error.problems).toEqual([
      `${projectFile}: templates names "escalation", but no template hook is set to read it (known templates: none)`,
    ]);
    expect(resolved.sources.checksTask).toBe('template');
  });

  it('reads an empty templates list with no hook set', async () => {
    const { root, home } = scopes('templates: []\n');

    const resolved = await withHook(null, () => loadConfig({ root, home }, {}, quiet));

    expect(resolved.config.templates).toEqual([]);
  });

  it('names no known template for a hook that carries no names', async () => {
    const { root, home, projectFile } = scopes('templates: [other]\n');

    const error = await withHook(() => null, () => refusal(() => loadConfig({ root, home }, {}, quiet)));

    expect(error.problems).toEqual([
      `${projectFile}: templates names "other", which no template holds (known templates: none)`,
    ]);
  });

  it('refuses a template whose key names no setting, or whose value a reader refuses, naming the file and the template', async () => {
    const { root, home, projectFile } = scopes('templates: [odd]\n');
    const stray: ConfigTemplateHook = () => ({ nonesuch: 1 });
    const unusable: ConfigTemplateHook = () => ({ store: 'postgres' });
    const clean: ConfigTemplateHook = () => ({ store: 'ndjson' });

    const strayError = await withHook(stray, () => refusal(() => loadConfig({ root, home }, {}, quiet)));
    const unusableError = await withHook(unusable, () => refusal(() => loadConfig({ root, home }, {}, quiet)));
    const resolved = await withHook(clean, () => loadConfig({ root, home }, {}, quiet));

    expect(strayError.problems).toEqual([`${projectFile} (template odd): nonesuch names no setting`]);
    expect(unusableError.problems).toHaveLength(1);
    expect(unusableError.problems[0]).toStartWith(`${projectFile} (template odd): store`);
    expect([resolved.config.store, resolved.sources.store]).toEqual(['ndjson', 'template']);
  });
});

describe('loadConfig laying a module file\'s templates under its entries', () => {
  it('reads a rafa.config.ts with no runtime import naming the template, its own entry outranking it', async () => {
    const root = freshDir('ts-template');
    const path = write(join(root, 'rafa.config.ts'), 'import type { Config } from \'@open-tomato/rafa/config\';\n'
      + 'export default [{ checks: { stage: [\'related\'] } }, { templates: [\'escalation\'] }] satisfies Config;\n');

    const resolved = await loadConfig({ root, home: freshDir('home') }, {}, quiet);

    expect(() => Bun.resolveSync('@open-tomato/rafa/config', root)).toThrow();
    expect(resolved.config.checksStage).toEqual(['related']);
    expect(resolved.sources.checksStage).toBe('file');
    expect(resolved.provenance.checksStage).toEqual({ file: path, entry: 0 });
    expect(resolved.config.testsIntegration).toEqual(INTEGRATION);
    expect(resolved.sources.testsIntegration).toBe('template');
    expect(resolved.provenance.testsIntegration).toEqual({ file: path, entry: 1, template: 'escalation' });
  });
});

describe('loadConfig laying each file\'s templates under that file alone', () => {
  it('lets a YAML file\'s template outrank its scope\'s module file, whose keys the template leaves out still answer', async () => {
    const { root, home, projectFile } = scopes('templates: [escalation]\n');
    const ts = write(join(root, 'rafa.config.ts'), 'export default [{ checks: { task: [\'full\'], publish: [\'unit\'] } }];\n');

    const resolved = await loadConfig({ root, home }, {}, quiet);

    expect([resolved.config.checksTask, resolved.sources.checksTask, resolved.provenance.checksTask])
      .toEqual([['affected'], 'template', { file: projectFile, entry: 0, template: 'escalation' }]);
    // The escalation template names no checks.publish, so the module
    // file's own key still answers it beneath the YAML file.
    expect([resolved.config.checksPublish, resolved.sources.checksPublish, resolved.provenance.checksPublish])
      .toEqual([['unit'], 'file', { file: ts, entry: 0 }]);

    // The control: the same module file with no YAML file beside it
    // answers both keys itself.
    const alone = freshDir('ts-alone');
    write(join(alone, 'rafa.config.ts'), 'export default [{ checks: { task: [\'full\'], publish: [\'unit\'] } }];\n');
    const fromModule = await loadConfig({ root: alone, home }, {}, quiet);
    expect([fromModule.config.checksTask, fromModule.sources.checksTask, fromModule.config.checksPublish])
      .toEqual([['full'], 'file', ['unit']]);
    expect(fromModule.provenance.checksTask).toEqual({ file: join(alone, 'rafa.config.ts'), entry: 0 });
  });
});
