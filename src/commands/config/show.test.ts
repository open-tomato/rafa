/**
 * `rafa config show` dispatched in planted projects under the temp
 * directory, over a project file, a user-scope file under the planted
 * home, and the defaults: both views, in text and as json `data`, and
 * the refusals.
 *
 * `pr.base` is the key the project's file sets and `pr.mergeMethod` the
 * one the user's sets, so a reading that named every setting `default`,
 * or every one `project`, would fail on one of them. The module-file
 * case sets `naming.branch` in the second entry of a `rafa.config.ts`,
 * so an entry index read as 0 for every setting would fail there, and
 * its first entry's `pr.base` is the control reading 0.
 */
import type { ConfigShowResult, ConfigShowSource } from './show.js';
import type { CapturedRun, PlantedProject } from '../../tests/cli-capture.js';

import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, afterEach, describe, expect, it } from 'bun:test';

import { setActiveLoggerSettings } from '../../adapters/logger/settings.js';
import { CONFIG_DEFAULTS, SETTING_NAMES, SETTINGS } from '../../config-registry.js';
import { setActiveStoreSettings } from '../../effort/store/settings.js';
import { dispatchInProject, eventsOf, plantProject } from '../../tests/cli-capture.js';

import { createConfigShowCommand, plainValue, readView, renderTree } from './show.js';

const scope = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-config-show-command-')));
afterAll(() => {
  rmSync(scope, { recursive: true, force: true });
});

// `loadConfig` hands the store and the logger the settings it resolved,
// which a later file would otherwise open with.
afterEach(() => {
  setActiveStoreSettings(null);
  setActiveLoggerSettings(null);
});

/** The subject the command sits under, declared for the registry the test dispatches over. */
const CONFIG_SUBJECT = { name: 'config', summary: 'the project config' };

/** The project's config: `pr.base` set, nothing else. */
const PROJECT_CONFIG = 'version: 1\npr:\n  base: stretch/9\n';

/** The user scope's config: `pr.mergeMethod` set. */
const USER_CONFIG = 'version: 1\npr:\n  mergeMethod: rebase\n';

/** A project planted with `text` as its config and `user` as the home's, when given. */
function plant(text: string, user: string | null = null): PlantedProject {
  const project = plantProject(realpathSync(mkdtempSync(join(scope, 'case-'))), text);
  if (user !== null) {
    mkdirSync(join(project.home, '.rafa'), { recursive: true });
    writeFileSync(join(project.home, '.rafa', 'config.yaml'), user, 'utf8');
  }
  return project;
}

/** Dispatches `config show` with `words` in `project`, under an empty environment. */
async function run(project: PlantedProject, words: readonly string[] = []): Promise<CapturedRun> {
  return dispatchInProject(['config', 'show', ...words], [CONFIG_SUBJECT], [createConfigShowCommand()], project);
}

/** The terminal result's `data` of a json run. */
function dataOf(outcome: CapturedRun): ConfigShowResult {
  const result = eventsOf(outcome.stdout).find((event) => event['type'] === 'result');
  if (result === undefined) throw new Error(`no result event in ${outcome.stdout}`);
  return result['data'] as ConfigShowResult;
}

/** The `--sources` row of `key` in `data`. */
function rowOf(data: ConfigShowResult, key: string): ConfigShowSource {
  if (data.view !== 'sources') throw new Error(`expected the sources view, got ${data.view}`);
  const row = data.settings.find((setting) => setting.key === key);
  if (row === undefined) throw new Error(`no row for ${key}`);
  return row;
}

describe('rafa config show', () => {
  it('prints every setting nested as the file spells it, as YAML reading to the tree json mode gives', async () => {
    const project = plant(PROJECT_CONFIG, USER_CONFIG);

    const outcome = await run(project);
    const data = dataOf(await run(project, ['--output=json']));

    expect(outcome.exitCode).toBe(0);
    expect(outcome.stdout).toContain('pr:\n  provider: null\n  mergeMethod: "rebase"\n  base: "stretch/9"\n');
    expect(data.view).toBe('resolved');
    if (data.view !== 'resolved') return;
    expect(Bun.YAML.parse(outcome.stdout)).toEqual(data.config);
  });

  it('prints the same view under --resolved as with no flag', async () => {
    const project = plant(PROJECT_CONFIG, USER_CONFIG);

    const bare = await run(project);
    const resolved = await run(project, ['--resolved']);

    expect(resolved.exitCode).toBe(0);
    expect(resolved.stdout).toBe(bare.stdout);
  });

  it('gives every setting nested under config as the json data of the resolved view', async () => {
    const project = plant(PROJECT_CONFIG, USER_CONFIG);

    const outcome = await run(project, ['--output=json']);

    expect(outcome.exitCode).toBe(0);
    const data = dataOf(outcome);
    expect(data.view).toBe('resolved');
    if (data.view !== 'resolved') return;
    expect(data.config['pr']).toEqual({
      provider: null,
      mergeMethod: 'rebase',
      base: 'stretch/9',
      resolveBudget: CONFIG_DEFAULTS.prResolveBudget,
      versionCollision: CONFIG_DEFAULTS.prVersionCollision,
    });
    expect(data.config['version']).toBe(1);
  });

  it('lists every setting under --sources with its layer, and the file and entry of each a file answered', async () => {
    const project = plant(PROJECT_CONFIG, USER_CONFIG);
    const projectFile = join(project.root, '.rafa', 'config.yaml');
    const userFile = join(project.home, '.rafa', 'config.yaml');

    const outcome = await run(project, ['--sources']);

    expect(outcome.exitCode).toBe(0);
    const lines = outcome.stdout.trimEnd().split('\n');
    expect(lines).toHaveLength(SETTING_NAMES.length);
    expect(lines).toContain(`pr.base: "stretch/9"  from project ${projectFile} entry 0`);
    expect(lines).toContain(`pr.mergeMethod: "rebase"  from user ${userFile} entry 0`);
    expect(lines).toContain(`effort.busyTimeoutMs: ${String(CONFIG_DEFAULTS.effortBusyTimeoutMs)}  from default`);
  });

  it('gives the same rows as the json data of the sources view, a default naming no file and no entry', async () => {
    const project = plant(PROJECT_CONFIG, USER_CONFIG);

    const data = dataOf(await run(project, ['--sources', '--output=json']));

    expect(data.view).toBe('sources');
    if (data.view !== 'sources') return;
    expect(data.settings.map((row) => row.key).sort()).toEqual(SETTING_NAMES.map((setting) => SETTINGS[setting].key).sort());
    expect(rowOf(data, 'pr.base')).toEqual({ key: 'pr.base', value: 'stretch/9', layer: 'project', file: join(project.root, '.rafa', 'config.yaml'), entry: 0 });
    expect(rowOf(data, 'pr.mergeMethod')).toEqual({ key: 'pr.mergeMethod', value: 'rebase', layer: 'user', file: join(project.home, '.rafa', 'config.yaml'), entry: 0 });
    expect(rowOf(data, 'pr.provider')).toEqual({ key: 'pr.provider', value: null, layer: 'default', file: null, entry: null });
  });

  it('names rafa.config.ts and the entry that last set each setting it answers', async () => {
    const project = plant(PROJECT_CONFIG);
    rmSync(join(project.root, '.rafa', 'config.yaml'));
    const moduleFile = join(project.root, 'rafa.config.ts');
    writeFileSync(moduleFile, 'export default [{ pr: { base: \'trunk\' } }, { naming: { branch: \'work/{stub}\' } }];\n', 'utf8');

    const outcome = await run(project, ['--sources']);

    expect(outcome.exitCode).toBe(0);
    expect(outcome.stdout).toContain(`naming.branch: "work/{stub}"  from project ${moduleFile} entry 1\n`);
    expect(outcome.stdout).toContain(`pr.base: "trunk"  from project ${moduleFile} entry 0\n`);
  });

  it('refuses both flags at once with exit code 1, naming the usage', async () => {
    const project = plant(PROJECT_CONFIG);

    const outcome = await run(project, ['--resolved', '--sources']);

    expect(outcome.exitCode).toBe(1);
    expect(outcome.stderr).toContain('--resolved and --sources are two views; give one of them');
    expect(outcome.stderr).toContain('Usage: rafa config show [--resolved | --sources]');
    expect(outcome.stdout).toBe('');
  });

  it('refuses an argument with exit code 1', async () => {
    const project = plant(PROJECT_CONFIG);

    const outcome = await run(project, ['pr.base']);

    expect(outcome.exitCode).toBe(1);
    expect(outcome.stderr).toContain('Expected no argument, got 1: pr.base');
  });

  it('refuses a config that cannot be used with exit code 1, naming each problem', async () => {
    const project = plant('version: 1\npr:\n  mergeMethod: sideways\n');

    const outcome = await run(project);

    expect(outcome.exitCode).toBe(1);
    expect(outcome.stderr).toContain('❌ rafa config show: the config cannot be used:');
    expect(outcome.stderr).toContain('pr.mergeMethod');
  });
});

describe('readView', () => {
  it('reads resolved with no flag and under --resolved, and sources under --sources', () => {
    expect(readView({})).toBe('resolved');
    expect(readView({ resolved: true })).toBe('resolved');
    expect(readView({ sources: true })).toBe('sources');
  });

  it('refuses a flag given a value', () => {
    expect(() => readView({ sources: 'yes' })).toThrow('--sources takes no value');
  });
});

describe('plainValue', () => {
  it('writes each map as an object, nested ones included, and copies arrays and objects through', () => {
    const value = new Map<string, unknown>([['a', new Map([['b', [1, { c: 2 }]]])]]);

    expect(plainValue(value)).toEqual({ a: { b: [1, { c: 2 }] } });
    expect(plainValue('x')).toBe('x');
    expect(plainValue(null)).toBeNull();
  });
});

describe('renderTree', () => {
  it('writes a map setting as one JSON leaf rather than a section of its own', () => {
    expect(renderTree({ logger: { modules: { git: 'debug' }, level: 'info' } })).toEqual([
      'logger:',
      '  modules: {"git":"debug"}',
      '  level: "info"',
    ]);
  });
});
