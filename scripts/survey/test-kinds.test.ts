import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { TESTS_DEFAULTS } from '@open-tomato/rafa/config-schema-tests';

import { templateEntry } from '../../src/config/templates';

import { readTestKindGlobs, testKind } from './test-kinds';

/** This repository's root, whose tracked `rafa.config.ts` the spec's case copies. */
const REPO_ROOT = resolve(import.meta.dir, '../..');

/** The defaults, as a project with no `tests` key and no template reads them: both empty. */
const DEFAULTS = { contract: TESTS_DEFAULTS.testsContract, integration: TESTS_DEFAULTS.testsIntegration };

/** The `escalation` template's two lists, as a project naming it reads them. */
const ESCALATION = {
  contract: templateEntry('escalation')?.tests?.contract ?? [],
  integration: templateEntry('escalation')?.tests?.integration ?? [],
};

describe('testKind', () => {
  it('reads a -spawned name as a use-case test', () => {
    expect(testKind('src/tests/references-gate-spawned.test.ts', ESCALATION)).toBe('use-case');
  });

  it('reads a .contract.test.ts name that an integration glob also matches as a contract test', () => {
    const path = 'packages/rafa/src/store/store-spawned.contract.test.ts';
    expect(new Bun.Glob('**/*-spawned*.test.ts').match(path)).toBe(true);
    expect(testKind(path, ESCALATION)).toBe('contract');
  });

  it('reads a plain .test.ts name as a unit test', () => {
    expect(testKind('scripts/survey/cut-map.test.ts', ESCALATION)).toBe('unit');
  });

  it('reads a -spawned name as a unit test when the integration list is empty', () => {
    expect(testKind('src/tests/references-gate-spawned.test.ts', { ...ESCALATION, integration: [] })).toBe('unit');
  });

  it('reads every name as a unit test under the empty defaults', () => {
    expect(DEFAULTS).toEqual({ contract: [], integration: [] });
    expect(testKind('src/tests/references-gate-spawned.test.ts', DEFAULTS)).toBe('unit');
    expect(testKind('packages/rafa/src/store/store.contract.test.ts', DEFAULTS)).toBe('unit');
  });
});

describe('readTestKindGlobs', () => {
  let root = '';

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'test-kinds-'));
  });

  afterEach(() => {
    rmSync(root, { force: true, recursive: true });
  });

  /** Writes `text` as the project's `.rafa/config.yaml`. */
  function plantConfig(text: string): void {
    mkdirSync(join(root, '.rafa'));
    writeFileSync(join(root, '.rafa', 'config.yaml'), text);
  }

  /** Writes `entries` as the project's `rafa.config.ts`, its default export. */
  function plantModule(entries: readonly unknown[]): void {
    writeFileSync(join(root, 'rafa.config.ts'), `export default ${JSON.stringify(entries)};\n`);
  }

  it('answers the defaults for a project with no config file', async () => {
    expect(existsSync(join(root, 'rafa.config.ts'))).toBe(false);
    expect(existsSync(join(root, '.rafa'))).toBe(false);
    expect(await readTestKindGlobs(root)).toEqual(DEFAULTS);
  });

  it('answers the defaults for a config that sets no tests key', async () => {
    plantConfig('cleanup:\n  keep: []\n');
    expect(await readTestKindGlobs(root)).toEqual(DEFAULTS);
  });

  it('answers the escalation template\'s lists for a project whose only config is a rafa.config.ts naming it', async () => {
    plantModule([{ templates: ['escalation'] }]);
    const globs = await readTestKindGlobs(root);
    expect(existsSync(join(root, '.rafa'))).toBe(false);
    expect(globs).toEqual(ESCALATION);
    expect(testKind('src/a/b.contract.test.ts', globs)).toBe('contract');
    expect(testKind('src/a/b-integration.test.ts', globs)).toBe('use-case');
  });

  it('classifies the two paths as contract and use-case under a copy of this repository\'s rafa.config.ts and no .rafa folder', async () => {
    copyFileSync(join(REPO_ROOT, 'rafa.config.ts'), join(root, 'rafa.config.ts'));
    const globs = await readTestKindGlobs(root);
    expect(existsSync(join(root, '.rafa'))).toBe(false);
    expect(testKind('src/a/b.contract.test.ts', globs)).toBe('contract');
    expect(testKind('src/a/b-integration.test.ts', globs)).toBe('use-case');
    // The control: the same two paths under the defaults read as unit tests.
    expect(testKind('src/a/b.contract.test.ts', DEFAULTS)).toBe('unit');
    expect(testKind('src/a/b-integration.test.ts', DEFAULTS)).toBe('unit');
  });

  it('reads the YAML file\'s tests.contract over its module file\'s', async () => {
    plantModule([{ tests: { contract: ['**/*.module.test.ts'] } }]);
    plantConfig('tests:\n  contract:\n    - \'**/*.local.test.ts\'\n');
    const globs = await readTestKindGlobs(root);
    expect(globs.contract).toEqual(['**/*.local.test.ts']);
    expect(testKind('src/a/b.local.test.ts', globs)).toBe('contract');
    expect(testKind('src/a/b.module.test.ts', globs)).toBe('unit');
  });

  it('reads the module file\'s tests.contract where the YAML file sets none', async () => {
    plantModule([{ tests: { contract: ['**/*.module.test.ts'] } }]);
    plantConfig('cleanup:\n  keep: []\n');
    expect((await readTestKindGlobs(root)).contract).toEqual(['**/*.module.test.ts']);
  });

  it('answers the escalation template\'s lists for a YAML config naming it and no tests key', async () => {
    plantConfig('templates: [escalation]\n');
    const globs = await readTestKindGlobs(root);
    expect(globs).toEqual(ESCALATION);
    expect(globs.integration.length).toBeGreaterThan(0);
    expect(testKind('src/tests/references-gate-spawned.test.ts', globs)).toBe('use-case');
  });

  it('lays the template under the file\'s own tests keys', async () => {
    plantConfig('templates: [escalation]\ntests:\n  integration: []\n');
    const globs = await readTestKindGlobs(root);
    expect(globs.integration).toEqual([]);
    expect(globs.contract).toEqual(ESCALATION.contract);
  });

  it('refuses a template name no template holds, naming the file and the known names', async () => {
    plantConfig('templates: [nosuch]\n');
    await expect(readTestKindGlobs(root)).rejects.toThrow(/config\.yaml: templates names "nosuch".*escalation/);
  });

  it('keeps tests.integration: [] empty and the contract list at its default', async () => {
    plantConfig('tests:\n  integration: []\n');
    const globs = await readTestKindGlobs(root);
    expect(globs.integration).toEqual([]);
    expect(globs.contract).toEqual(TESTS_DEFAULTS.testsContract);
    expect(testKind('src/tests/references-gate-spawned.test.ts', globs)).toBe('unit');
  });

  it('reads a list the file sets in place of the default', async () => {
    plantConfig('tests:\n  contract:\n    - \'**/*.promise.test.ts\'\n');
    const globs = await readTestKindGlobs(root);
    expect(globs.contract).toEqual(['**/*.promise.test.ts']);
    expect(globs.integration).toEqual(TESTS_DEFAULTS.testsIntegration);
    expect(testKind('src/a/b.promise.test.ts', globs)).toBe('contract');
    expect(testKind('src/a/b.contract.test.ts', globs)).toBe('unit');
  });

  it('refuses a tests key that is not a mapping', async () => {
    plantConfig('tests: 3\n');
    await expect(readTestKindGlobs(root)).rejects.toThrow('tests');
  });

  it('refuses a glob list that is not a list of strings', async () => {
    plantConfig('tests:\n  integration: 3\n');
    await expect(readTestKindGlobs(root)).rejects.toThrow('tests.integration');
  });
});
