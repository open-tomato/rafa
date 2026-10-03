import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { gitIdentityEnv } from './git-identity.js';

interface GitRun {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

describe('a commit in a scratch repository with no host identity reachable', () => {
  let root: string;
  let repo: string;
  let isolatedEnv: Record<string, string>;

  beforeEach(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), 'rafa-git-identity-')));
    repo = join(root, 'repo');
    const home = join(root, 'home');
    await mkdir(repo);
    await mkdir(home);
    const emptyGlobal = join(root, 'empty-gitconfig');
    await writeFile(emptyGlobal, '');
    // Nothing of the host reaches git: no inherited environment, an
    // empty global file, no system file and a home with no dotfiles.
    isolatedEnv = {
      PATH: process.env['PATH'] ?? '',
      HOME: home,
      XDG_CONFIG_HOME: join(home, '.config'),
      GIT_CONFIG_GLOBAL: emptyGlobal,
      GIT_CONFIG_NOSYSTEM: '1',
    };
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  async function git(args: readonly string[], env: Record<string, string>): Promise<GitRun> {
    const child = Bun.spawn(['git', ...args], {
      cwd: repo,
      env,
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    return { exitCode, stdout, stderr };
  }

  async function initWithFile(env: Record<string, string>): Promise<void> {
    expect((await git(['init', '--quiet'], env)).exitCode).toBe(0);
    await writeFile(join(repo, 'file.txt'), 'content\n');
    expect((await git(['add', 'file.txt'], env)).exitCode).toBe(0);
  }

  test('fails without the helper, so the isolated environment holds no identity', async () => {
    await initWithFile(isolatedEnv);

    const run = await git(['-c', 'user.useConfigOnly=true', 'commit', '-m', 'first'], isolatedEnv);

    expect(run.exitCode).not.toBe(0);
    expect(run.stderr).toMatch(/identity|user\.(name|email)/i);
  });

  test('succeeds with the helper environment spread in, under the fixed test identity', async () => {
    const env = { ...isolatedEnv, ...gitIdentityEnv() };
    await initWithFile(env);

    const commit = await git(['-c', 'user.useConfigOnly=true', 'commit', '-m', 'first'], env);
    const log = await git(['log', '-1', '--format=%an <%ae>|%cn <%ce>'], env);

    expect(commit.exitCode).toBe(0);
    expect(log.stdout.trim()).toBe('rafa test <rafa@example.test>|rafa test <rafa@example.test>');
  });
});
