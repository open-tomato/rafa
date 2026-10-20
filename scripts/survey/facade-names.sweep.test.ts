/**
 * The facade reader over this repository: the live `rafa-effort` reading,
 * the entry rendered from it under the root eslint, and the command line
 * run as a process. A sweep, since the reading follows the files under
 * `src/` and no import of this file does.
 */
import type { FacadeReading } from './facade-names';

import { fileURLToPath } from 'node:url';

import { beforeAll, describe, expect, it, setDefaultTimeout } from 'bun:test';

import { SWEEP_TIMEOUT } from '../../src/tests/sweep-timeout.js';

import { facadeFolder, readFacadeNames, renderFacadeEntry } from './facade-names';

setDefaultTimeout(SWEEP_TIMEOUT);

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

/**
 * Lints a facade entry's text as `packages/rafa-effort/index.ts` with the
 * root config, as `bunx eslint` does.
 *
 * @returns eslint's exit code.
 */
function lintEntry(source: string): number {
  return Bun.spawnSync(
    [process.execPath, 'x', 'eslint', '--stdin', '--stdin-filename', 'packages/rafa-effort/index.ts'],
    { cwd: REPO_ROOT, stdin: Buffer.from(source) },
  ).exitCode;
}

describe('the live rafa-effort reading', () => {
  let live: FacadeReading;

  beforeAll(() => {
    live = readFacadeNames(REPO_ROOT, 'rafa-effort');
  }, SWEEP_TIMEOUT);

  it('takes collect and report via default from their own files, with no problem', () => {
    const byName = new Map(live.names.map((name) => [name.name, name]));
    for (const name of ['collect', 'report']) {
      expect(byName.get(name)).toMatchObject({
        declaredIn: `src/effort/${name}.ts`,
        exportedBy: `src/effort/${name}.ts`,
        kind: 'value',
        viaDefault: true,
      });
      expect(byName.get(name)?.importers).toContain('src/index.ts');
    }
    expect(live.problems).toEqual([]);
  });

  it('renders an entry the root eslint passes, beside a broken copy it refuses', () => {
    const text = renderFacadeEntry(live, facadeFolder('rafa-effort'));
    expect(lintEntry(text)).toBe(0);
    expect(lintEntry(text.replaceAll('\'', '"'))).toBe(1);
  });

  it('refuses an unknown package from the command line on exit 1', () => {
    const run = Bun.spawnSync([process.execPath, 'scripts/survey/facade-names.ts', '--package=rafa-nope'], { cwd: REPO_ROOT });
    expect(run.exitCode).toBe(1);
    expect(run.stderr.toString()).toContain('no package named rafa-nope');
  });
});
