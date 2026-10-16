/**
 * Tests for `base.mjs`, the shared flat config every rafa ESLint config
 * builds on through `@open-tomato/rafa-eslint-config`.
 *
 * The lint cases run one `ESLint` instance, with `base.mjs` as its config
 * file, over files planted in a scratch directory, so each reading is what
 * the package's config says of a file, with no root leaf in between. A
 * rule-breaking file reads red with the rule named, once for a rule of
 * `sharedRules.mjs` and once for `ar/no-unsafe-unicode` from
 * `rules/unsafe-unicode.mjs`; a clean file beside them reads green, the
 * control that the red cases come from those rules and not from a
 * config that refuses everything.
 *
 * The instance is warmed once, in the describe's `beforeAll`: a cold ESLint
 * start (loading the plugins and the config) is slow under parallel tasks,
 * so it is paid there, under its own 30 000 ms timeout, and no case carries
 * it. The scratch folder is made in the same hook and outlives every lint,
 * removed only by the `afterAll`, so no lint reads a folder already gone.
 * The warm-up lints a clean file and asserts it green, so a config broken
 * on first load still fails the describe.
 *
 * The manifest cases hold the `dependencies` to every package `base.mjs`
 * imports by name: bun links each workspace member in isolation, so the
 * config resolves its plugins from this package's own `node_modules`, and
 * a plugin left out of the manifest fails to load wherever the package
 * is used.
 *
 * The `.mts` cases hold that the config parses the module-TypeScript
 * extensions rather than ignoring them.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { ESLint } from 'eslint';

/** The package's directory. */
const PACKAGE_DIR = import.meta.dir;

/** The config file under test. */
const CONFIG_FILE = join(PACKAGE_DIR, 'base.mjs');

/** A file every rule of the base passes. */
const CLEAN = 'export const greeting = \'hello\';\n';

/** Breaks `@stylistic/quotes`, a rule of `sharedRules.mjs`, and nothing else. */
const DOUBLE_QUOTED = 'export const greeting = "hello";\n';

/** Breaks `ar/no-unsafe-unicode` with a zero-width space written literally. */
const ZERO_WIDTH = `export const greeting = 'hel${String.fromCodePoint(0x200b)}lo';\n`;

/** One message of a lint result, reduced to what the cases read. */
interface Finding {
  readonly ruleId: string | null;
  readonly severity: number;
}

/** The `beforeAll` timeout: the cold ESLint start and the warm-up lint. */
const WARM_UP_TIMEOUT_MS = 30_000;

/** The timeout of each lint case over the warm instance. */
const LINT_CASE_TIMEOUT_MS = 15_000;

let scratch: string;
let eslint: ESLint;

/** The package a bare specifier names: `eslint` of `eslint/config`, `@eslint/js` of itself. */
function packageName(specifier: string): string {
  const segments = specifier.split('/');
  const length = specifier.startsWith('@')
    ? 2
    : 1;
  return segments.slice(0, length).join('/');
}

/** Plants `source` as `name` in the scratch directory and lints it through the package's config. */
async function lintPlanted(name: string, source: string): Promise<{ errorCount: number; findings: Finding[] }> {
  const path = join(scratch, name);
  writeFileSync(path, source, 'utf8');
  const [result] = await eslint.lintFiles([path]);
  if (result === undefined) throw new Error(`ESLint answered no result for ${name}`);
  return {
    errorCount: result.errorCount,
    findings: result.messages.map(({ ruleId, severity }) => ({ ruleId, severity })),
  };
}

describe('base.mjs', () => {
  beforeAll(async () => {
    scratch = mkdtempSync(join(tmpdir(), 'rafa-eslint-config-'));
    eslint = new ESLint({ cwd: scratch, overrideConfigFile: CONFIG_FILE });
    const started = performance.now();
    const warmUp = await lintPlanted('warm-up.ts', CLEAN);
    const elapsed = Math.round(performance.now() - started);
    expect(warmUp.findings).toEqual([]);
    expect(warmUp.errorCount).toBe(0);
    console.info(`base.mjs warm-up: ${elapsed} ms`);
  }, WARM_UP_TIMEOUT_MS);

  afterAll(() => {
    rmSync(scratch, { recursive: true, force: true });
  });

  it('reads a clean file green', async () => {
    const outcome = await lintPlanted('clean.ts', CLEAN);

    expect(outcome.findings).toEqual([]);
    expect(outcome.errorCount).toBe(0);
  }, LINT_CASE_TIMEOUT_MS);

  it('reads a double-quoted string red under @stylistic/quotes', async () => {
    const outcome = await lintPlanted('quoted.ts', DOUBLE_QUOTED);

    expect(outcome.errorCount).toBeGreaterThan(0);
    expect(outcome.findings).toContainEqual({ ruleId: '@stylistic/quotes', severity: 2 });
  }, LINT_CASE_TIMEOUT_MS);

  it('reads a double-quoted string in a .mts file red under @stylistic/quotes', async () => {
    const outcome = await lintPlanted('quoted.mts', DOUBLE_QUOTED);

    expect(outcome.errorCount).toBeGreaterThan(0);
    expect(outcome.findings).toContainEqual({ ruleId: '@stylistic/quotes', severity: 2 });
  }, LINT_CASE_TIMEOUT_MS);

  it('reads a clean .mts file green', async () => {
    const outcome = await lintPlanted('clean.mts', CLEAN);

    expect(outcome.findings).toEqual([]);
    expect(outcome.errorCount).toBe(0);
  }, LINT_CASE_TIMEOUT_MS);

  it('reads a literal zero-width space red under ar/no-unsafe-unicode', async () => {
    const outcome = await lintPlanted('invisible.ts', ZERO_WIDTH);

    expect(outcome.errorCount).toBeGreaterThan(0);
    expect(outcome.findings).toContainEqual({ ruleId: 'ar/no-unsafe-unicode', severity: 2 });
  }, LINT_CASE_TIMEOUT_MS);
});

describe('package.json', () => {
  it('exports base.mjs as . and ./base', async () => {
    const manifest = (await Bun.file(join(PACKAGE_DIR, 'package.json')).json()) as Record<string, unknown>;

    expect(manifest['name']).toBe('@open-tomato/rafa-eslint-config');
    expect(manifest['private']).toBe(true);
    expect(manifest['exports']).toEqual({ '.': './base.mjs', './base': './base.mjs' });
  });

  it('declares every package base.mjs imports in its dependencies', async () => {
    const manifest = (await Bun.file(join(PACKAGE_DIR, 'package.json')).json()) as Record<string, unknown>;
    const dependencies = Object.keys(manifest['dependencies'] as Record<string, string>);
    const source = await Bun.file(CONFIG_FILE).text();
    const specifiers = [...source.matchAll(/^import .* from '([^']+)';$/gm)].map((match) => match[1] ?? '');
    const packages = specifiers
      .filter((specifier) => !specifier.startsWith('.'))
      .map(packageName);

    expect(packages.length).toBeGreaterThan(0);
    expect(dependencies).toEqual(expect.arrayContaining(packages));
  });

  it('declares the import resolver base.mjs names by its short name', async () => {
    const manifest = (await Bun.file(join(PACKAGE_DIR, 'package.json')).json()) as Record<string, unknown>;
    const source = await Bun.file(CONFIG_FILE).text();

    expect(source).toContain('\'import/resolver\': {\n        typescript: {');
    expect(manifest['dependencies']).toHaveProperty('eslint-import-resolver-typescript');
  });
});
