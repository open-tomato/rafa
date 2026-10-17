import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { templateEntry } from '../../src/config/templates';
import { TESTS_DEFAULTS } from '../../src/config-schema-tests';

import { readTestKindGlobs, testKind } from './test-kinds';

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

  it('answers the defaults for a project with no config file', () => {
    expect(readTestKindGlobs(root)).toEqual(DEFAULTS);
  });

  it('answers the defaults for a config that sets no tests key', () => {
    plantConfig('cleanup:\n  keep: []\n');
    expect(readTestKindGlobs(root)).toEqual(DEFAULTS);
  });

  it('answers the escalation template\'s lists for a config naming it and no tests key', () => {
    plantConfig('templates: [escalation]\n');
    const globs = readTestKindGlobs(root);
    expect(globs).toEqual(ESCALATION);
    expect(globs.integration.length).toBeGreaterThan(0);
    expect(testKind('src/tests/references-gate-spawned.test.ts', globs)).toBe('use-case');
  });

  it('lays the template under the file\'s own tests keys', () => {
    plantConfig('templates: [escalation]\ntests:\n  integration: []\n');
    const globs = readTestKindGlobs(root);
    expect(globs.integration).toEqual([]);
    expect(globs.contract).toEqual(ESCALATION.contract);
  });

  it('refuses a template name no template holds, naming the file and the known names', () => {
    plantConfig('templates: [nosuch]\n');
    expect(() => readTestKindGlobs(root)).toThrow(/config\.yaml: templates names "nosuch".*escalation/);
  });

  it('keeps tests.integration: [] empty and the contract list at its default', () => {
    plantConfig('tests:\n  integration: []\n');
    const globs = readTestKindGlobs(root);
    expect(globs.integration).toEqual([]);
    expect(globs.contract).toEqual(TESTS_DEFAULTS.testsContract);
    expect(testKind('src/tests/references-gate-spawned.test.ts', globs)).toBe('unit');
  });

  it('reads a list the file sets in place of the default', () => {
    plantConfig('tests:\n  contract:\n    - \'**/*.promise.test.ts\'\n');
    const globs = readTestKindGlobs(root);
    expect(globs.contract).toEqual(['**/*.promise.test.ts']);
    expect(globs.integration).toEqual(TESTS_DEFAULTS.testsIntegration);
    expect(testKind('src/a/b.promise.test.ts', globs)).toBe('contract');
    expect(testKind('src/a/b.contract.test.ts', globs)).toBe('unit');
  });

  it('refuses a tests key that is not a mapping', () => {
    plantConfig('tests: 3\n');
    expect(() => readTestKindGlobs(root)).toThrow('tests');
  });

  it('refuses a glob list that is not a list of strings', () => {
    plantConfig('tests:\n  integration: 3\n');
    expect(() => readTestKindGlobs(root)).toThrow('tests.integration');
  });
});
