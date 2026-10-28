import { rmSync } from 'node:fs';

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';

import { CORE_PACKAGE } from './cut-table';
import { main } from './test-index';
import {
  git,
  IDENTITY,
  plant,
  plantScratch,
  RECORD_MODE,
  runGuard,
  SCRATCH_FILES,
} from './test-index-scratch';

const BASELINE = 'docs/survey/test-index.baseline.json';
const CONTROL_MAP = 'docs/survey/cut-table.control.json';
const TYPED_CORE = 'src/a/typed-core.test.ts';
const VALUED_CORE = 'src/a/valued-core.test.ts';
const TYPED_FAR = 'src/a/typed-far.test.ts';
const HEADER = 'import { expect, it } from \'bun:test\';\nimport { x } from \'../deep/x.js\';\n';
const FOOTER = 'it(\'x\', () => expect(x).toBe(1));\n';

/** A cut table placing `src/core/core.ts` in a unit named `coreName`, the three tests beside `x.ts`. */
function tableWithCore(coreName: string): string {
  return `${JSON.stringify({
    packages: [
      { files: ['src/a/one.test.ts', TYPED_CORE, VALUED_CORE, TYPED_FAR, 'src/deep/x.ts', 'src/rafa.ts'], name: '@scratch/cli' },
      { files: ['src/far/y.ts'], name: '@scratch/far' },
      { files: ['src/core/core.ts'], name: coreName },
    ],
    unassigned: [],
  }, null, 2)}\n`;
}

const FILES: Readonly<Record<string, string>> = {
  ...SCRATCH_FILES,
  'src/core/core.ts': 'export type Core = number;\nexport const core = 3;\n',
  'src/far/y.ts': 'export type Far = number;\nexport const y = 2;\n',
};

describe('the guard over a scratch repository, a type-only import of core', () => {
  let root = '';

  beforeAll(async () => {
    root = plantScratch('survey-test-index-core-', FILES, tableWithCore(CORE_PACKAGE));
    plant(root, CONTROL_MAP, tableWithCore('@scratch/not-core'));
    git(root, ['add', '-A']);
    git(root, [...IDENTITY, 'commit', '--quiet', '-m', 'plant']);
    await main(root, RECORD_MODE);
    plant(root, TYPED_CORE, `${HEADER}import type { Core } from '../core/core.js';\n${FOOTER}export type Held = Core;\n`);
    plant(root, VALUED_CORE, `${HEADER}import { core } from '../core/core.js';\n${FOOTER}export const held = core;\n`);
    plant(root, TYPED_FAR, `${HEADER}import type { Far } from '../far/y.js';\n${FOOTER}export type Held = Far;\n`);
  });

  afterAll(() => {
    rmSync(root, { force: true, recursive: true });
  });

  it('names the value import of core and the type import of another package as risen, and the type import of core not', () => {
    const run = runGuard(root, BASELINE);
    expect(run.stdout).toContain('2 risen');
    expect(run.stdout).toContain(`  ${VALUED_CORE} (unit test in @scratch/cli, not in the record): reaches ${CORE_PACKAGE} beyond its own unit`);
    expect(run.stdout).toContain(`  ${TYPED_FAR} (unit test in @scratch/cli, not in the record): reaches @scratch/far beyond its own unit`);
    expect(run.stdout).not.toContain(`  ${TYPED_CORE} (`);
    expect(run.stdout).toContain(`New, not in the record and meeting its rule (1):\n  ${TYPED_CORE}\n`);
    expect(run).toMatchObject({ exitCode: 1, stderr: '' });
  });

  it('names the type import of core as risen too when the same tree is read with the rule removed, the control', () => {
    // The rule keys on the unit's name: a table naming the core row otherwise reads the same tree without it.
    const run = runGuard(root, BASELINE, CONTROL_MAP);
    expect(run.stdout).toContain('3 risen');
    expect(run.stdout).toContain(`  ${TYPED_CORE} (unit test in @scratch/cli, not in the record): reaches @scratch/not-core beyond its own unit`);
    expect(run.stdout).toContain(`  ${VALUED_CORE} (unit test in @scratch/cli, not in the record): reaches @scratch/not-core beyond its own unit`);
    expect(run.stdout).toContain(`  ${TYPED_FAR} (unit test in @scratch/cli, not in the record): reaches @scratch/far beyond its own unit`);
    expect(run.exitCode).toBe(1);
  });
});
