/**
 * `rafa config set` and `rafa config show --sources` spawned for real in a
 * scratch project holding `rafa.config.ts` beside `.rafa/config.yaml`: the
 * set writes the YAML file (the local layer) and leaves the module file
 * byte-identical, `show --sources` names each layer's file, and `doctor`
 * has no `warn` line naming either file.
 */
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { expectExit, plantScratchRepo, runRafa } from '../../tests/cli-capture.js';

const MODULE_TEXT = 'export default [{ templates: [\'escalation\'], pr: { base: \'main\' } }];\n';

const scratchBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-config-local-layer-')));
afterAll(() => {
  rmSync(scratchBase, { recursive: true, force: true });
});

describe('rafa config beside a module file, spawned', () => {
  it('sets into the YAML file, leaves the module file alone, and shows and doctors both layers cleanly', () => {
    // Arrange
    const scratch = plantScratchRepo(scratchBase);
    const modulePath = join(scratch.repo, 'rafa.config.ts');
    const yamlPath = join(scratch.repo, '.rafa', 'config.yaml');
    writeFileSync(modulePath, MODULE_TEXT, 'utf8');
    const before = readFileSync(modulePath);

    // Act
    const set = runRafa(scratch, scratch.repo, ['config', 'set', 'pr.base=stretch/9']);
    const show = runRafa(scratch, scratch.repo, ['config', 'show', '--sources']);
    const doctor = runRafa(scratch, scratch.repo, ['doctor']);

    // Assert
    expectExit(set, 0, scratch);
    expect(readFileSync(modulePath).equals(before)).toBe(true);
    expectExit(show, 0, scratch);
    const rows = show.stdout.split('\n');
    const rowOf = (key: string): string => rows.find((row) => row.startsWith(`${key}: `)) ?? '';
    expect(rowOf('pr.base')).toContain(`from local ${yamlPath} entry 0`);
    expect(rowOf('templates')).toContain(`from project ${modulePath} entry 0`);
    expect(rowOf('checks.task')).toContain(`from template:escalation ${modulePath} entry 0`);
    const warnLines = `${doctor.stdout}\n${doctor.stderr}`.split('\n').filter((line) => /\bwarn\b/i.test(line));
    for (const line of warnLines) {
      expect(line).not.toContain(modulePath);
      expect(line).not.toContain(yamlPath);
    }
  }, { timeout: 120_000 });
});
