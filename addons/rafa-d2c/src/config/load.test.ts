import type { ProcessRunner } from '../process.js';

import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'bun:test';

import { spawnProcess } from '../process.js';

import { D2C_CONFIG_FILE, loadD2cConfig } from './load.js';

const CONFIG = `visual:
  suite: { kind: storybook-jest, package: packages/ui, command: bun run test:visual }
  runner: { kind: host }
  store: { kind: side-repo, dir: /srv/baselines/example, set: packages-ui }
`;

const made: string[] = [];

/** A temp project root holding `text` as its d2c config, when given. */
async function projectWith(text?: string): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'd2c-load-')));
  made.push(root);
  await mkdir(join(root, '.rafa'), { recursive: true });
  if (text !== undefined) await writeFile(join(root, D2C_CONFIG_FILE), text);
  return root;
}

/** A runner answering `exitCode` for every command, recording each argv. */
function runnerAnswering(exitCode: number, seen: string[][] = []): ProcessRunner {
  return (argv) => {
    seen.push([...argv]);
    return Promise.resolve({ exitCode, stdout: '', stderr: '' });
  };
}

afterEach(async () => {
  await Promise.all(made.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('loadD2cConfig', () => {
  it('reads .rafa/d2c.yaml at the root', async () => {
    const root = await projectWith(CONFIG);
    const loaded = await loadD2cConfig(root, runnerAnswering(1));

    expect(loaded.file).toBe(join(root, D2C_CONFIG_FILE));
    expect(loaded.root).toBe(root);
    expect(loaded.config.visual.store).toMatchObject({ set: 'packages-ui' });
    expect(loaded.warnings).toEqual([]);
  });

  it('refuses a missing file naming the path', async () => {
    const root = await projectWith();

    expect(loadD2cConfig(root, runnerAnswering(1))).rejects.toThrow(join(root, D2C_CONFIG_FILE));
  });

  it('refuses YAML that does not parse, naming the file', async () => {
    const root = await projectWith('visual: [unclosed\n');

    expect(loadD2cConfig(root, runnerAnswering(1))).rejects.toThrow(D2C_CONFIG_FILE);
  });

  it('warns when the file is tracked and holds a store dir', async () => {
    const root = await projectWith(CONFIG);
    const seen: string[][] = [];
    const loaded = await loadD2cConfig(root, runnerAnswering(0, seen));

    expect(seen).toContainEqual(['git', 'ls-files', '--error-unmatch', D2C_CONFIG_FILE]);
    expect(loaded.warnings).toHaveLength(1);
    expect(loaded.warnings[0]).toContain('Before you publish visual tests');
  });
});

describe('spawnProcess', () => {
  it('answers the exit code and output', async () => {
    const result = await spawnProcess(['sh', '-c', 'echo out; echo err >&2; exit 3'], { cwd: tmpdir() });

    expect(result).toEqual({ exitCode: 3, stdout: 'out\n', stderr: 'err\n' });
  });

  it('answers 124 when the timeout passes', async () => {
    const result = await spawnProcess(['sleep', '5'], { cwd: tmpdir(), timeoutMs: 100 });

    expect(result.exitCode).toBe(124);
  });

  it('answers 127 for a program that is not found', async () => {
    const result = await spawnProcess(['d2c-no-such-program'], { cwd: tmpdir() });

    expect(result.exitCode).toBe(127);
  });
});
