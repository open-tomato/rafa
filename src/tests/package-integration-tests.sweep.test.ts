/**
 * No integration test lives inside core: no tracked file under
 * `packages/rafa/` matches the project's `tests.integration` globs, read
 * through `readTestKindGlobs`. An integration test drives the package from
 * outside, so it stays at the root and reaches core by its subpaths
 * (`@open-tomato/rafa/<subpath>`).
 *
 * The rule ends with #913, which places each integration test with the
 * package entry it drives.
 *
 * ## The controls
 *
 * The live claim is an empty offender list, which an empty glob list also
 * answers. The controls hold that the read globs are not empty and that a
 * planted `packages/rafa/src/x/y-integration.test.ts` path matches them.
 */
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, setDefaultTimeout } from 'bun:test';

import { readTestKindGlobs } from '../../scripts/survey/test-kinds.js';

import { SWEEP_TIMEOUT } from './sweep-timeout.js';

setDefaultTimeout(SWEEP_TIMEOUT);

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const PACKAGE_DIR = 'packages/rafa/';
const PLANTED = 'packages/rafa/src/x/y-integration.test.ts';

const GLOBS = (await readTestKindGlobs(REPO_ROOT)).integration;

function isIntegrationPath(path: string): boolean {
  return GLOBS.some((pattern) => new Bun.Glob(pattern).match(path));
}

describe('no integration test lives under packages/rafa/', () => {
  it('reads a non-empty integration glob list', () => {
    expect(GLOBS.length).toBeGreaterThan(0);
  });

  it('matches a planted integration test path under the package', () => {
    expect(isIntegrationPath(PLANTED)).toBe(true);
  });

  it('finds no tracked file under the package matching the globs', () => {
    const tracked = execFileSync('git', ['ls-files', '-z', PACKAGE_DIR], { cwd: REPO_ROOT, encoding: 'utf8' })
      .split('\0')
      .filter((path) => path !== '');
    expect(tracked.length).toBeGreaterThan(0);
    expect(tracked.filter(isIntegrationPath)).toEqual([]);
  });
});
