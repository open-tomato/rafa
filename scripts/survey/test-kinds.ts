/**
 * The kind of a test file, read from its name through config, never from
 * a folder. `tests.contract` names the contract tests, `tests.integration`
 * the use-case tests, and every other test file is a unit test. A name
 * both lists match is a contract test: the contract list is read first.
 *
 * {@link testKind} is the pure core: it takes the globs and matches each
 * with `Bun.Glob` against a path relative to the repository root, as
 * `integrationFiles` of `src/suite/checks.ts` does. {@link readTestKindGlobs}
 * reads the two lists from the project scope through `readProjectScope`
 * of `@open-tomato/rafa/core/config/load`, after `registerCoreConfigSections`
 * of `src/config-registry.ts` has registered the sections and the template
 * hook. The scope holds two files: the module file, `rafa.config.ts` or
 * `rafa.config.mjs` at the root, and `.rafa/config.yaml`, the local layer.
 * Each arrives with the templates its `templates` key names already laid
 * under its own keys. A key the local file sets comes first, then the
 * module file's, then `TESTS_DEFAULTS` of `packages/rafa/src/config-schema-tests.ts`,
 * whose two lists are empty. A list a file sets empty stays empty, since
 * a list written `[]` has been said. No pattern is copied here.
 *
 * Every refusal is the load's own: a template name no template holds, a
 * `tests` key that is not a mapping and a list that is not one of strings
 * are refused by `readProjectScope`, naming the file.
 */

import { TESTS_DEFAULTS } from '@open-tomato/rafa/config-schema-tests';
import { readProjectScope } from '@open-tomato/rafa/core/config/load';

import { registerCoreConfigSections } from '../../src/config-registry';

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

/**
 * The two glob lists of the project at `root`: its `.rafa/config.yaml`'s
 * key, else its module file's, else `TESTS_DEFAULTS`. Each file's
 * templates are already laid under its own keys, and an empty list
 * stays empty.
 *
 * @param root - the repository root whose project scope is read.
 * @returns the `tests.contract` and `tests.integration` lists.
 * @throws What `readProjectScope` throws for a file the load refuses.
 */
export async function readTestKindGlobs(root: string): Promise<TestKindGlobs> {
  registerCoreConfigSections();
  const { local, file } = await readProjectScope(root);
  return {
    contract: local?.values.testsContract
      ?? file?.values.testsContract
      ?? TESTS_DEFAULTS.testsContract,
    integration: local?.values.testsIntegration
      ?? file?.values.testsIntegration
      ?? TESTS_DEFAULTS.testsIntegration,
  };
}
