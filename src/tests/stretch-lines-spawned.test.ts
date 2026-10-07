/**
 * A spawned test of `rafa config set`: the real command, run as
 * `bun src/rafa.ts` in a scratch project whose config opts into the
 * release row and carries a comment.
 *
 * `rafa config set pr.base=stretch/9` must write the value, keep the
 * comment, and be read back by `rafa doctor`, whose release row names
 * `origin/<pr.base>` (`origin/stretch/9`). An unknown key and a
 * `key=value` word with no `=` are refused with exit 1, and the file is
 * left byte-identical. No `gh` or `claude` is called.
 */
import type { ScratchRepo } from './cli-capture.js';

import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeEach, describe, expect, it } from 'bun:test';

import { expectExit, plantProjectConfig, plantScratchRepo, runRafa } from './cli-capture.js';

const RUN_TIMEOUT = { timeout: 60_000 };

const COMMENT = '# the integration branch is set by a stretch';
const CONFIG_TEXT = [
  COMMENT,
  'release:',
  '  versionFile: package.json',
  '  changelog: CHANGELOG.md',
  'pr:',
  '  provider: none',
  '',
].join('\n');

const scratchBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-stretch-lines-spawned-')));

afterAll(() => {
  rmSync(scratchBase, { recursive: true, force: true });
});

/** A scratch project whose release row is enabled, and its config path. */
function plantWorld(): { scratch: ScratchRepo; configPath: string } {
  const scratch = plantScratchRepo(scratchBase);
  plantProjectConfig(scratch.repo, CONFIG_TEXT);
  writeFileSync(join(scratch.repo, 'package.json'), '{"version":"1.0.0"}\n', 'utf8');
  writeFileSync(join(scratch.repo, 'CHANGELOG.md'), '# Changelog\n\n## 1.0.0\n', 'utf8');
  mkdirSync(join(scratch.repo, '.rafa'), { recursive: true });
  return { scratch, configPath: join(scratch.repo, '.rafa', 'config.yaml') };
}

describe('rafa config set, spawned', () => {
  let world: ReturnType<typeof plantWorld>;

  beforeEach(() => {
    world = plantWorld();
  });

  it('writes pr.base, which doctor reads back, and keeps the comment', () => {
    const { scratch, configPath } = world;

    const set = runRafa(scratch, scratch.repo, ['config', 'set', 'pr.base=stretch/9']);
    expectExit(set, 0, scratch);
    expect(set.stdout).toContain('stretch/9');

    const text = readFileSync(configPath, 'utf8');
    expect(text).toContain(COMMENT);
    expect(text).toMatch(/^ {2}base: stretch\/9$/m);

    const doctor = runRafa(scratch, scratch.repo, ['doctor']);
    expectExit(doctor, 0, scratch);
    expect(doctor.stdout).toContain('origin/stretch/9');
  }, RUN_TIMEOUT);

  it('refuses an unknown key and leaves the file as it was', () => {
    const { scratch, configPath } = world;
    const before = readFileSync(configPath, 'utf8');

    const run = runRafa(scratch, scratch.repo, ['config', 'set', 'nope.key=1']);

    expectExit(run, 1, scratch);
    expect(run.stderr + run.stdout).toContain('Nothing was written');
    expect(readFileSync(configPath, 'utf8')).toBe(before);
  }, RUN_TIMEOUT);

  it('refuses a word with no = and leaves the file as it was', () => {
    const { scratch, configPath } = world;
    const before = readFileSync(configPath, 'utf8');

    const run = runRafa(scratch, scratch.repo, ['config', 'set', 'pr.base']);

    expectExit(run, 1, scratch);
    expect(run.stderr + run.stdout).toContain('Nothing was written');
    expect(readFileSync(configPath, 'utf8')).toBe(before);
  }, RUN_TIMEOUT);
});
