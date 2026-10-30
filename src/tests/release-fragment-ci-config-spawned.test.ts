/**
 * `rafa release fragment` spawned as the real binary in a scratch
 * repository with a bare origin and no rafa config, the checkout a CI
 * runner holds: the dispatcher refuses it with exit 1 and `not inside a
 * rafa project`, then, after the bot fragment template's `Write the CI
 * config` script has run there under bash, the same line exits 0 and
 * writes `.changes/dependabot-7.md`.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { gitIdentityEnv } from '@open-tomato/rafa/tests/git-identity';
import { scratchHomeEnv } from '@open-tomato/rafa/tests/scratch-home-env';
import { readReleaseTemplate } from '@open-tomato/rafa-release/release/templates';

import { expectExit, plantScratchRepo, runRafa } from './cli-capture.js';

/** A temporary directory of this file's own. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-fragment-ci-config-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

const FRAGMENT_WORDS = ['release', 'fragment', '--plan=dependabot-7', '--level=none', '--title=Bump zod'] as const;

/** The `run` script of the bot fragment template's step of this name. */
function stepScript(name: string): string {
  const parsed = Bun.YAML.parse(readReleaseTemplate('release-bot-fragment.yml')) as {
    jobs: Record<string, { steps: { name?: string; run?: string; shell?: string }[] }>;
  };
  for (const job of Object.values(parsed.jobs)) {
    const step = job.steps.find((candidate) => candidate.name === name);
    if (step?.run !== undefined) {
      expect(step.shell).toBe('bash');
      return step.run;
    }
  }
  throw new Error(`no step named ${name}`);
}

describe('rafa release fragment in a checkout with no rafa config', () => {
  it('refuses before the Write the CI config script runs and succeeds after it', () => {
    // Arrange: a scratch repository, not a project, with a bare origin holding main.
    const scratch = plantScratchRepo(tempBase, { project: false });
    const env = { TMPDIR: tmpdir(), ...scratchHomeEnv(scratch.home), PATH: scratch.path, GIT_CONFIG_GLOBAL: join(scratch.home, '.gitconfig'), GIT_CONFIG_NOSYSTEM: '1', ...gitIdentityEnv() };
    const git = (args: readonly string[], cwd = scratch.repo): void => {
      execFileSync('git', [...args], { cwd, env, stdio: 'pipe' });
    };
    const origin = join(scratch.home, '..', 'origin.git');
    mkdirSync(origin, { recursive: true });
    git(['init', '-q', '--bare', '--initial-branch=main', origin], origin);
    writeFileSync(join(scratch.repo, 'README.md'), 'demo\n');
    git(['switch', '-q', '-c', 'main']);
    git(['add', '-A']);
    git(['commit', '-q', '-m', 'first']);
    git(['remote', 'add', 'origin', origin]);
    git(['push', '-q', 'origin', 'main']);
    git(['fetch', '-q', 'origin']);

    // Act and assert: refused before the script.
    const before = runRafa(scratch, scratch.repo, FRAGMENT_WORDS);
    expectExit(before, 1, scratch);
    expect(before.stderr).toContain('not inside a rafa project');
    expect(existsSync(join(scratch.repo, '.changes', 'dependabot-7.md'))).toBe(false);

    // Act: the template's script, under bash, in the checkout.
    execFileSync('bash', ['-e', '-o', 'pipefail', '-c', stepScript('Write the CI config')], { cwd: scratch.repo, env, stdio: 'pipe' });
    const config = readFileSync(join(scratch.repo, '.rafa', 'config.yaml'), 'utf8');
    expect(config).toContain('release:\n  enabled: true\n');

    // Assert: the same line now succeeds.
    const after = runRafa(scratch, scratch.repo, FRAGMENT_WORDS);
    expectExit(after, 0, scratch);
    expect(readFileSync(join(scratch.repo, '.changes', 'dependabot-7.md'), 'utf8')).toContain('Bump zod');
  });
});
