import type { RafaContext } from '@open-tomato/rafa-core/core/command';

import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'bun:test';

import { spawnProcess } from './process.js';
import { projectRootOf, workRootOf } from './project.js';

const made: string[] = [];

afterEach(async () => {
  await Promise.all(made.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

/** Runs git in `cwd`, failing the test on a non-zero exit. */
function git(cwd: string, ...args: string[]): void {
  const result = Bun.spawnSync(['git', ...args], { cwd, env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null' } });
  if (result.exitCode !== 0) throw new Error(`git ${args.join(' ')}: ${result.stderr.toString()}`);
}

/** A context with no project, as `module exec` hands one, and `home` as HOME. */
function contextAt(home: string): RafaContext {
  return { project: null, env: { HOME: home } } as unknown as RafaContext;
}

describe('projectRootOf', () => {
  it('answers the context project when the dispatcher resolved one', () => {
    const context = { project: { root: '/srv/project' }, env: {} } as unknown as RafaContext;

    expect(projectRootOf(context, '/elsewhere')).toBe('/srv/project');
  });

  it('a linked worktree resolves to the main checkout', async () => {
    const base = await realpath(await mkdtemp(join(tmpdir(), 'd2c-scope-')));
    made.push(base);
    const main = join(base, 'main');
    const home = join(base, 'home');
    await mkdir(join(main, '.rafa'), { recursive: true });
    await mkdir(home);
    await writeFile(join(main, '.gitignore'), '.rafa/\n');
    await writeFile(join(main, '.rafa', 'config.yaml'), 'schemaVersion: 1\n');
    await writeFile(join(main, '.rafa', 'd2c.yaml'), 'visual: {}\n');
    git(main, 'init', '-q', '-b', 'main');
    git(main, '-c', 'user.name=t', '-c', 'user.email=t@example.com', 'add', '.gitignore');
    git(main, '-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-q', '-m', 'init');
    git(main, 'worktree', 'add', '-q', join(base, 'linked'));
    await mkdir(join(base, 'linked', 'packages'));

    expect(projectRootOf(contextAt(home), join(base, 'linked'))).toBe(main);
    expect(await workRootOf(main, join(base, 'linked', 'packages'), spawnProcess)).toBe(join(base, 'linked'));
    expect(await workRootOf(main, main, spawnProcess)).toBe(main);
  });

  it('the work root outside any repository is the project root', async () => {
    const base = await realpath(await mkdtemp(join(tmpdir(), 'd2c-scope-')));
    made.push(base);

    expect(await workRootOf(base, base, spawnProcess)).toBe(base);
  });

  it('refuses outside any project with the init hint', async () => {
    const base = await realpath(await mkdtemp(join(tmpdir(), 'd2c-scope-')));
    made.push(base);

    expect(() => projectRootOf(contextAt(join(base, 'home')), base)).toThrow('rafa init');
  });
});
