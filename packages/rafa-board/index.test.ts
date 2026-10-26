/**
 * The facade of `rafa-board` (#808, pass 2) holds the three readings of
 * `scripts/survey/facade-check.ts`: its entry exports exactly the names
 * the reader finds, it loads in a fresh `bun` process under its package
 * name, and the workspace gates stay green with it as a member. The root
 * is read from this file's place, two folders up, since turbo runs the
 * member's `test` script from its own folder.
 */
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'bun:test';

import { compareFacade, loadsFresh, readFacadeExports, workspaceGates } from '../../scripts/survey/facade-check.js';
import { readFacadeNames } from '../../scripts/survey/facade-names.js';
import { SWEEP_TIMEOUT } from '../../src/tests/sweep-timeout.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const PACKAGE = 'rafa-board';

describe(`the ${PACKAGE} facade`, () => {
  it('exports the names the reader finds, none missing, extra or misaligned', () => {
    const comparison = compareFacade(
      readFacadeNames(ROOT, PACKAGE),
      readFacadeExports(ROOT, `packages/${PACKAGE}/index.ts`),
    );
    expect(comparison, JSON.stringify(comparison, null, 2)).toEqual({ extra: [], misaligned: [], missing: [] });
  }, SWEEP_TIMEOUT);

  it('loads in a fresh process under its package name', () => {
    const load = loadsFresh(`@open-tomato/${PACKAGE}`, ROOT);
    expect({ exitCode: load.exitCode, stderr: load.stderr }).toEqual({ exitCode: 0, stderr: '' });
  }, SWEEP_TIMEOUT);

  it('leaves the graph check and the references build at exit 0', () => {
    const gates = workspaceGates(ROOT);
    expect({ exitCode: gates.graph.exitCode, lines: gates.graph.lines }).toMatchObject({ exitCode: 0 });
    expect({ exitCode: gates.references.exitCode, lines: gates.references.lines }).toMatchObject({ exitCode: 0 });
  }, SWEEP_TIMEOUT);
});
