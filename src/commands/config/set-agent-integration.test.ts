/**
 * `rafa config set dangerous.acceptVersionCollision=true` spawned for real
 * in a scratch project, under an environment the case builds itself
 * (#919): with `CLAUDECODE=1` the key is refused with exit code 1 and the
 * config file's bytes are as before, in text and in `--output=json`; with
 * the variable absent the key is written and reads true.
 *
 * The child's environment comes from `runRafa`'s `spawnedEnv`, which
 * starts from nothing and never inherits this process's `CLAUDECODE`, so
 * the case that wants it absent has it absent and the others set it
 * explicitly.
 */
import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { parseConfigText } from '../../core/config/index.js';
import { expectExit, plantScratchRepo, runRafa } from '../../tests/cli-capture.js';

const KEY_LINE = 'dangerous.acceptVersionCollision=true';
const AGENT_ENV = { CLAUDECODE: '1' };

const scratchBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-config-set-agent-')));
afterAll(() => {
  rmSync(scratchBase, { recursive: true, force: true });
});

describe('rafa config set under an agent, spawned', () => {
  it('refuses a dangerous key under CLAUDECODE, naming it and the line to run, leaving the file as it was', () => {
    // Arrange
    const scratch = plantScratchRepo(scratchBase);
    const file = join(scratch.repo, '.rafa', 'config.yaml');
    const before = readFileSync(file);

    // Act
    const run = runRafa(scratch, scratch.repo, ['config', 'set', KEY_LINE], AGENT_ENV);

    // Assert
    expectExit(run, 1, scratch);
    expect(run.stderr).toContain('CLAUDECODE');
    expect(run.stderr).toContain(`rafa config set ${KEY_LINE}`);
    expect(readFileSync(file).equals(before)).toBe(true);
  }, { timeout: 60_000 });

  it('refuses the same key with --output=json, leaving the file as it was', () => {
    // Arrange
    const scratch = plantScratchRepo(scratchBase);
    const file = join(scratch.repo, '.rafa', 'config.yaml');
    const before = readFileSync(file);

    // Act
    const run = runRafa(scratch, scratch.repo, ['config', 'set', KEY_LINE, '--output=json'], AGENT_ENV);

    // Assert
    expectExit(run, 1, scratch);
    expect(readFileSync(file).equals(before)).toBe(true);
  }, { timeout: 60_000 });

  it('writes the key when CLAUDECODE is absent', () => {
    // Arrange
    const scratch = plantScratchRepo(scratchBase);
    const file = join(scratch.repo, '.rafa', 'config.yaml');

    // Act
    const run = runRafa(scratch, scratch.repo, ['config', 'set', KEY_LINE]);

    // Assert
    expectExit(run, 0, scratch);
    const values = parseConfigText(readFileSync(file, 'utf8'), 'config.yaml').values;
    expect(values.dangerousAcceptVersionCollision).toBe(true);
  }, { timeout: 60_000 });
});
