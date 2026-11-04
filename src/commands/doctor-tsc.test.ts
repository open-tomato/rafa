/**
 * The `tsc` row of `rafa doctor` (`./doctor-tsc.ts`), read over scratch
 * project roots under this file's temporary directory.
 *
 * The real-spawn case links the checkout's own `node_modules/.bin/tsc`
 * into a scratch root and runs it under a PATH with no node: a directory
 * holding a link to the running bun and nothing else, plus `/usr/bin` and
 * `/bin` only when no node sits in them. tsc's shebang names
 * `/usr/bin/env` by absolute path, so `env` is found whatever the PATH
 * and reads the PATH the row hands it. Its control is the same root under
 * the runner's own PATH, which starts tsc and reads `ok`, so the
 * failure is the PATH and not the link.
 *
 * Every other exit is scripted through the row's `runTscVersion` seam,
 * each beside the reading it is told apart from.
 */
import type { DoctorTscReading, TscVersionOptions, TscVersionRun } from './doctor-tsc.js';
import type { RafaContext } from '@open-tomato/rafa/core/command';

import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'bun:test';

import { cannotStartFix, readDoctorTsc, tscRefusal, tscRow, writeDoctorTsc } from './doctor-tsc.js';

const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-doctor-tsc-')));
afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** How long a real tsc spawn may take. */
const SPAWN_TIMEOUT = 30_000;

/** The checkout's own tsc, as the type step's walk finds it from the checkout root. */
const CHECKOUT_TSC = fileURLToPath(new URL('../../node_modules/.bin/tsc', import.meta.url));

/** The system directories a PATH with no node keeps when no node sits in them. */
const SYSTEM_DIRS: readonly string[] = ['/usr/bin', '/bin'];

/** What env prints for a node it cannot find, measured on this machine. */
const MISSING = 'env: \'node\': No such file or directory';

/** A scratch directory under the temporary one. */
function scratch(prefix: string): string {
  return mkdtempSync(join(tempBase, prefix));
}

/** A project root holding a `tsconfig.json` and, unless `tsc` is null, `node_modules/.bin/tsc` made by `tsc`. */
function projectRoot(tsc: ((path: string) => void) | null): string {
  const root = scratch('project-');
  writeFileSync(join(root, 'tsconfig.json'), '{}\n', 'utf8');
  if (tsc === null) return root;
  mkdirSync(join(root, 'node_modules', '.bin'), { recursive: true });
  tsc(join(root, 'node_modules', '.bin', 'tsc'));
  return root;
}

/** A tsc script holding `text`, executable. */
function script(text: string): (path: string) => void {
  return (path) => {
    writeFileSync(path, text, { encoding: 'utf8', mode: 0o755 });
  };
}

/**
 * A PATH with no node: a directory holding a link to the running bun
 * and nothing else, then {@link SYSTEM_DIRS} when no node sits in them,
 * and that directory alone when one does.
 */
function pathWithNoNode(): string {
  const dir = scratch('no-node-');
  symlinkSync(process.execPath, join(dir, 'bun'));
  const system = SYSTEM_DIRS.join(':');
  return Bun.which('node', { PATH: system }) === null
    ? `${dir}:${system}`
    : dir;
}

/** A runner answering `run`, recording what it was asked to spawn. */
function scripted(run: TscVersionRun | Error): { runTscVersion: (options: TscVersionOptions) => Promise<TscVersionRun>; seen: TscVersionOptions[] } {
  const seen: TscVersionOptions[] = [];
  const runTscVersion = (options: TscVersionOptions): Promise<TscVersionRun> => {
    seen.push(options);
    return run instanceof Error
      ? Promise.reject(run)
      : Promise.resolve(run);
  };
  return { runTscVersion, seen };
}

/** A context whose `info` and `warn` lines are kept, in `mode`, under `env`. */
function capture(mode: 'text' | 'json', env: Readonly<Record<string, string | undefined>> = {}): {
  context: Pick<RafaContext, 'output' | 'outputMode' | 'env'>;
  info: string[];
  warn: string[];
} {
  const info: string[] = [];
  const warn: string[] = [];
  const output = {
    info: (line: string): void => {
      info.push(line);
    },
    warn: (line: string): void => {
      warn.push(line);
    },
  } as unknown as RafaContext['output'];
  return { context: { output, outputMode: mode, env }, info, warn };
}

describe('readDoctorTsc under a PATH with no node', () => {
  it('reads the checkout\'s real tsc as cannot start with exit 127 naming node, and ok under the runner\'s own PATH', async () => {
    expect(existsSync(CHECKOUT_TSC)).toBe(true);
    const root = projectRoot((path) => {
      symlinkSync(realpathSync(CHECKOUT_TSC), path);
    });
    const tsc = join(root, 'node_modules', '.bin', 'tsc');
    const path = pathWithNoNode();
    expect(Bun.which('node', { PATH: path })).toBeNull();
    expect(Bun.which('bun', { PATH: path })).not.toBeNull();

    const reading = await readDoctorTsc(root, { PATH: path });

    expect(reading).toEqual({ kind: 'cannot-start', tsc, exitCode: 127, said: MISSING, interpreter: 'node' });
    expect(tscRefusal(reading)).toBe(`rafa doctor: tsc: ${tsc} exited 127 (${MISSING}). `
      + 'tsc runs under node, which its first line names: put node on the PATH the loop runs under.');

    // Control: the same root under the runner's own PATH starts tsc.
    const started = await readDoctorTsc(root, { PATH: process.env['PATH'] });
    expect(started.kind).toBe('ok');
    expect(started).toMatchObject({ tsc, version: expect.stringMatching(/^Version \d+\.\d+\.\d+$/u) as unknown as string });
    expect(tscRefusal(started)).toBeNull();
  }, SPAWN_TIMEOUT);

  it('reads a `#!/usr/bin/env node` script under the same PATH as cannot start, and a `#!/bin/sh` one as ok', async () => {
    const path = pathWithNoNode();
    const node = projectRoot(script('#!/usr/bin/env node\nconsole.log("Version 0.0.0");\n'));
    const shell = projectRoot(script('#!/bin/sh\necho "Version 0.0.1"\n'));

    const failed = await readDoctorTsc(node, { PATH: path });
    const passed = await readDoctorTsc(shell, { PATH: path });

    expect(failed).toMatchObject({ kind: 'cannot-start', exitCode: 127, said: MISSING, interpreter: 'node' });
    expect(passed).toEqual({ kind: 'ok', tsc: join(shell, 'node_modules', '.bin', 'tsc'), version: 'Version 0.0.1' });
  }, SPAWN_TIMEOUT);
});

describe('readDoctorTsc', () => {
  it('reads nothing and spawns nothing for a root with no tsconfig.json', async () => {
    const root = scratch('bare-');
    const run = scripted({ exitCode: 0, stdout: 'Version 5.9.3\n', stderr: '' });

    expect(await readDoctorTsc(root, {}, run)).toEqual({ kind: 'none' });
    expect(run.seen).toEqual([]);
  });

  it('reads a tsconfig.json with no node_modules/.bin/tsc as missing, spawning nothing', async () => {
    const root = projectRoot(null);
    const run = scripted({ exitCode: 0, stdout: 'Version 5.9.3\n', stderr: '' });

    expect(await readDoctorTsc(root, {}, run)).toEqual({ kind: 'missing', tsc: join(root, 'node_modules', '.bin', 'tsc') });
    expect(run.seen).toEqual([]);
  });

  it('spawns `<root>/node_modules/.bin/tsc --version` in the root under the environment handed in', async () => {
    const root = projectRoot(script('#!/usr/bin/env node\n'));
    const tsc = join(root, 'node_modules', '.bin', 'tsc');
    const run = scripted({ exitCode: 0, stdout: '\nVersion 5.9.3\n', stderr: '' });
    const env = { PATH: '/nowhere' };

    expect(await readDoctorTsc(root, env, run)).toEqual({ kind: 'ok', tsc, version: 'Version 5.9.3' });
    expect(run.seen).toEqual([{ cwd: root, argv: [tsc, '--version'], env }]);
  });

  it('reads 126 and 127 as cannot start, and 2 as broken, never cannot start', async () => {
    const root = projectRoot(script('#!/usr/bin/env node\n'));
    const tsc = join(root, 'node_modules', '.bin', 'tsc');

    for (const exitCode of [126, 127]) {
      const reading = await readDoctorTsc(root, {}, scripted({ exitCode, stdout: '', stderr: `${MISSING}\n` }));
      expect(reading).toEqual({ kind: 'cannot-start', tsc, exitCode, said: MISSING, interpreter: 'node' });
    }
    const broken = await readDoctorTsc(root, {}, scripted({ exitCode: 2, stdout: '', stderr: '' }));
    expect(broken).toEqual({ kind: 'broken', tsc, exitCode: 2, said: null });
    expect(tscRefusal(broken)).toBeNull();
  });

  it('reads a spawn that throws as unspawned, never cannot start', async () => {
    const root = projectRoot(script('#!/usr/bin/env node\n'));
    const tsc = join(root, 'node_modules', '.bin', 'tsc');

    const reading = await readDoctorTsc(root, {}, scripted(new Error('EACCES: permission denied, posix_spawn')));

    expect(reading).toEqual({ kind: 'unspawned', tsc, problem: 'EACCES: permission denied, posix_spawn' });
    expect(tscRefusal(reading)).toBeNull();
  });

  it('reads a script whose first line names no interpreter with a null interpreter', async () => {
    const root = projectRoot(script('console.log(1);\n'));
    const tsc = join(root, 'node_modules', '.bin', 'tsc');

    const reading = await readDoctorTsc(root, {}, scripted({ exitCode: 126, stdout: '', stderr: '' }));

    expect(reading).toEqual({ kind: 'cannot-start', tsc, exitCode: 126, said: null, interpreter: null });
    expect(cannotStartFix(tsc, null)).toBe(`Its first line names no interpreter: make ${tsc} runnable from the PATH the loop runs under.`);
  });
});

describe('tscRow', () => {
  const tsc = '/p/node_modules/.bin/tsc';

  it('gives each reading its line, and no row for none', () => {
    const readings: readonly [DoctorTscReading, ReturnType<typeof tscRow>][] = [
      [{ kind: 'none' }, null],
      [{ kind: 'ok', tsc, version: 'Version 5.9.3' }, { warn: false, lines: [`tsc: ok, Version 5.9.3 (${tsc})`] }],
      [{ kind: 'missing', tsc }, { warn: true, lines: [`tsc: warn, tsconfig.json is here and ${tsc} is not: the type step runs nothing`] }],
      [
        { kind: 'cannot-start', tsc, exitCode: 127, said: MISSING, interpreter: 'node' },
        {
          warn: true,
          lines: [
            `tsc: fail, ${tsc} exited 127 (${MISSING})`,
            '  tsc runs under node, which its first line names: put node on the PATH the loop runs under.',
          ],
        },
      ],
      [{ kind: 'broken', tsc, exitCode: 2, said: 'bad' }, { warn: true, lines: [`tsc: warn, ${tsc} exited 2 (bad)`] }],
      [{ kind: 'unspawned', tsc, problem: 'ENOENT' }, { warn: true, lines: [`tsc: warn, ${tsc} could not be spawned: ENOENT`] }],
    ];
    for (const [reading, row] of readings) expect(tscRow(reading)).toEqual(row);
  });
});

describe('writeDoctorTsc', () => {
  it('writes a cannot-start row as one warning in both modes and answers the refusal', async () => {
    const path = pathWithNoNode();
    const root = projectRoot(script('#!/usr/bin/env node\n'));
    const tsc = join(root, 'node_modules', '.bin', 'tsc');

    for (const mode of ['text', 'json'] as const) {
      const { context, info, warn } = capture(mode, { PATH: path });
      const refusal = await writeDoctorTsc(context, root);
      expect(info).toEqual([]);
      expect(warn).toEqual([`tsc: fail, ${tsc} exited 127 (${MISSING})\n`
        + '  tsc runs under node, which its first line names: put node on the PATH the loop runs under.']);
      expect(refusal).toContain(`rafa doctor: tsc: ${tsc} exited 127`);
    }
  }, SPAWN_TIMEOUT);

  it('writes an ok row at info in text mode alone, answering no refusal', async () => {
    const root = projectRoot(script('#!/bin/sh\necho "Version 0.0.1"\n'));
    const tsc = join(root, 'node_modules', '.bin', 'tsc');
    const text = capture('text');
    const json = capture('json');

    expect(await writeDoctorTsc(text.context, root)).toBeNull();
    expect(await writeDoctorTsc(json.context, root)).toBeNull();

    expect(text.info).toEqual([`tsc: ok, Version 0.0.1 (${tsc})`]);
    expect(json.info).toEqual([]);
    expect([...text.warn, ...json.warn]).toEqual([]);
  }, SPAWN_TIMEOUT);

  it('writes nothing and answers no refusal for a root with no tsconfig.json', async () => {
    const { context, info, warn } = capture('text');

    expect(await writeDoctorTsc(context, scratch('bare-'))).toBeNull();
    expect([...info, ...warn]).toEqual([]);
  });
});
