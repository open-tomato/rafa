/**
 * The kind of a test file, read from its name through config, never from
 * a folder. `tests.contract` names the contract tests, `tests.integration`
 * the use-case tests, and every other test file is a unit test. A name
 * both lists match is a contract test: the contract list is read first.
 *
 * {@link testKind} is the pure core: it takes the globs and matches each
 * with `Bun.Glob` against a path relative to the repository root, as
 * `integrationFiles` of `src/suite/scope.ts` does. {@link readTestKindGlobs}
 * reads the two lists from the project's `.rafa/config.yaml` through
 * `readConfigFile`, each falling back to `TESTS_DEFAULTS` of
 * `src/config-schema-tests.ts` when the file sets no such key. A list the
 * file sets empty stays empty, since a list written `[]` has been said.
 * No pattern is copied here.
 *
 * `readConfigFile` reads the file without the config registry. Measured on
 * bun 1.3.14: with the registry unloaded the `tests` mapping arrives in the
 * file's `extras`; with it loaded, as `testsIntegration` and `testsContract`
 * in its `values`. The reader takes `values` first and `extras` after, so
 * it answers the same whichever module loaded first. It refuses a key the
 * file sets to anything but a list of strings, and a `tests` key that is
 * not a mapping, naming the file and the key.
 */

import type { ConfigFile } from '@open-tomato/rafa/core/config';

import { readConfigFile } from '@open-tomato/rafa/core/config/load';

import { TESTS_DEFAULTS } from '../../src/config-schema-tests';

/** The kind of a test file: a unit, contract or use-case test. */
export type TestKind = 'unit' | 'contract' | 'use-case';

/** The two glob lists a kind is read through. */
export interface TestKindGlobs {
  /** The `tests.contract` patterns. */
  readonly contract: readonly string[];
  /** The `tests.integration` patterns, the use-case tests. */
  readonly integration: readonly string[];
}

/** Whether one of `patterns` matches `path`. */
function matchesAny(path: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => new Bun.Glob(pattern).match(path));
}

/**
 * The kind of the test file at `path`: `contract` when a `tests.contract`
 * glob matches, else `use-case` when a `tests.integration` glob matches,
 * else `unit`.
 *
 * @param path - the test file's path relative to the repository root.
 * @param globs - the two lists, as {@link readTestKindGlobs} answers them.
 * @returns the file's kind.
 */
export function testKind(path: string, globs: TestKindGlobs): TestKind {
  if (matchesAny(path, globs.contract)) return 'contract';
  if (matchesAny(path, globs.integration)) return 'use-case';
  return 'unit';
}

/** Whether `value` is a plain object, not an array and not `null`. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The `tests` mapping of the file's extras, or an empty one. */
function testsExtra(file: ConfigFile): Record<string, unknown> {
  const extra = file.extras.find((entry) => entry.key === 'tests');
  if (extra === undefined) return {};
  if (!isRecord(extra.value)) {
    throw new Error(`${file.path}: tests is not a mapping`);
  }
  return extra.value;
}

/** `value` as a list of strings, refused naming `key` when it is not one. */
function globList(file: ConfigFile, key: string, value: unknown): readonly string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    throw new Error(`${file.path}: tests.${key} is not a list of strings`);
  }
  return value;
}

/** The list the file sets at `key`, or undefined where it sets none. */
function fileList(
  file: ConfigFile,
  key: 'contract' | 'integration',
  resolved: readonly string[] | undefined,
): readonly string[] | undefined {
  if (resolved !== undefined) return resolved;
  const value = testsExtra(file)[key];
  return value === undefined
    ? undefined
    : globList(file, key, value);
}

/**
 * The two glob lists of the project at `root`, read from its
 * `.rafa/config.yaml`, each falling back to `TESTS_DEFAULTS` where the
 * file sets no such key or there is no file. An empty list stays empty.
 *
 * @param root - the repository root whose `.rafa/config.yaml` is read.
 * @returns the `tests.contract` and `tests.integration` lists.
 */
export function readTestKindGlobs(root: string): TestKindGlobs {
  const file = readConfigFile(root);
  if (file === null) {
    return { contract: TESTS_DEFAULTS.testsContract, integration: TESTS_DEFAULTS.testsIntegration };
  }
  return {
    contract: fileList(file, 'contract', file.values.testsContract) ?? TESTS_DEFAULTS.testsContract,
    integration: fileList(file, 'integration', file.values.testsIntegration) ?? TESTS_DEFAULTS.testsIntegration,
  };
}
