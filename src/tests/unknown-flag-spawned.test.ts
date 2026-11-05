/**
 * Spawned proof for the undeclared-flag refusal (#1267): `rafa release tag
 * --dry-run` used to write the tag because no command refused a flag it does
 * not declare. Run as the real `rafa` entry in a planted repository, the
 * dispatcher refuses it with exit 2, names the typed flag and the command's
 * declared `--push`, and the repository's tag list stays empty. A second case
 * proves the refusal is not specific to one flag or one release subcommand.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { expectExit, plantScratchRepo, runRafa } from './cli-capture.js';

/** This suite's temporary directory, removed once every case has run. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-unknown-flag-spawned-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** How long a spawned case may run. */
const SPAWN_TIMEOUT = 60_000;

/** The tags of `repo`, as `git tag --list` prints them. */
function tagsOf(repo: string): string {
  return execFileSync('git', ['tag', '--list'], { cwd: repo, encoding: 'utf8' });
}

describe('an undeclared flag on a release command, spawned', () => {
  it('refuses release tag --dry-run with exit 2, naming --dry-run and --push, and writes no tag', () => {
    const scratch = plantScratchRepo(tempBase);

    const run = runRafa(scratch, scratch.repo, ['release', 'tag', '--dry-run']);

    expectExit(run, 2, scratch);
    const output = `${run.stdout}${run.stderr}`;
    expect(output).toContain('--dry-run');
    expect(output).toContain('--push');
    expect(tagsOf(scratch.repo)).toBe('');
  }, SPAWN_TIMEOUT);

  it('refuses release status --bogus-flag with exit 2, naming --bogus-flag', () => {
    const scratch = plantScratchRepo(tempBase);

    const run = runRafa(scratch, scratch.repo, ['release', 'status', '--bogus-flag']);

    expectExit(run, 2, scratch);
    expect(`${run.stdout}${run.stderr}`).toContain('--bogus-flag');
  }, SPAWN_TIMEOUT);
});
