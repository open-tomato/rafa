/**
 * The `tsc` refusal of `rafa loop start` (`./start.ts`), read over
 * scratch project roots under this file's temporary directory.
 *
 * Each tsc is a planted `node_modules/.bin/tsc` script spawned for real
 * under the runner's own PATH: one whose shebang names an interpreter on
 * no PATH, so `env` exits 127 whatever the machine holds, and its
 * control, a `#!/bin/sh` script printing `Version 5.9.3` and exiting 0.
 * The refusal text is compared against `tscRefusal` of the same reading,
 * so the command refuses with `doctor`'s own words. A root with no
 * `tsconfig.json` is read through a seam that counts its spawns, so the
 * case that resolves also shows nothing was spawned.
 *
 * The command case builds `loop start` over a stand-in for `start` that
 * counts its calls: over the refusing tsc it rejects with exit code 1
 * and the stand-in is never reached, and its control, the same command
 * over the tsc exiting 0, reaches the stand-in once.
 */
import type { TscVersionOptions, TscVersionRun } from '../doctor-tsc.js';
import type { RafaContext } from '@open-tomato/rafa/core/command';

import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { CommandExit } from '@open-tomato/rafa/core/command';

import { readDoctorTsc, tscRefusal } from '../doctor-tsc.js';

import { loopStartCommand, refuseTscCannotStart } from './start.js';

const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-loop-start-tsc-')));
afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** How long a real tsc spawn may take. */
const SPAWN_TIMEOUT = 30_000;

/** The environment every case hands the command: the runner's own PATH. */
const ENV: Readonly<Record<string, string | undefined>> = { PATH: process.env['PATH'] ?? '' };

/** The interpreter the refusing tsc's shebang names, on no PATH. */
const MISSING_INTERPRETER = 'rafa-no-such-interpreter';

/** A tsc whose shebang names {@link MISSING_INTERPRETER}, so `env` exits 127 whatever the machine holds. */
const REFUSING_TSC = `#!/usr/bin/env ${MISSING_INTERPRETER}\n`;

/** A tsc that starts. */
const STARTING_TSC = ['#!/bin/sh', 'echo "Version 5.9.3"', 'exit 0', ''].join('\n');

/** A project root holding, unless `tsconfig` is false, a `tsconfig.json`, and a tsc script holding `text`. */
function projectRoot(text: string, tsconfig = true): string {
  const root = mkdtempSync(join(tempBase, 'project-'));
  if (tsconfig) writeFileSync(join(root, 'tsconfig.json'), '{}\n', 'utf8');
  mkdirSync(join(root, 'node_modules', '.bin'), { recursive: true });
  writeFileSync(join(root, 'node_modules', '.bin', 'tsc'), text, { encoding: 'utf8', mode: 0o755 });
  return root;
}

/** What a promise rejected with, or null when it resolved. */
async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
    return null;
  } catch (error) {
    return error;
  }
}

/** The context `loop start` reads: its words, no flags, the environment and the project at `root`. */
function contextAt(root: string): RafaContext {
  return {
    argv: [],
    flags: {},
    env: ENV,
    project: { root },
  } as unknown as RafaContext;
}

describe('refuseTscCannotStart', () => {
  it('throws exit code 1 with doctor\'s refusal text for a tsc that exits 127', async () => {
    const root = projectRoot(REFUSING_TSC);

    const error = await rejection(refuseTscCannotStart(root, ENV));

    const reading = await readDoctorTsc(root, ENV);
    expect(reading.kind).toBe('cannot-start');
    expect(error).toBeInstanceOf(CommandExit);
    expect((error as CommandExit).exitCode).toBe(1);
    expect((error as CommandExit).message).toBe(tscRefusal(reading) ?? 'no refusal');
    expect((error as CommandExit).message).toStartWith(`rafa doctor: tsc: ${join(root, 'node_modules', '.bin', 'tsc')} exited 127 (`);
    expect((error as CommandExit).message).toEndWith(
      `. tsc runs under ${MISSING_INTERPRETER}, which its first line names: put ${MISSING_INTERPRETER} on the PATH the loop runs under.`,
    );
  }, SPAWN_TIMEOUT);

  it('resolves for a tsc that exits 0', async () => {
    const root = projectRoot(STARTING_TSC);

    const error = await rejection(refuseTscCannotStart(root, ENV));

    expect(error).toBeNull();
    expect((await readDoctorTsc(root, ENV)).kind).toBe('ok');
  }, SPAWN_TIMEOUT);

  it('resolves for a root with no tsconfig.json, and spawns nothing', async () => {
    const root = projectRoot(REFUSING_TSC, false);
    const spawned: TscVersionOptions[] = [];
    const runTscVersion = (options: TscVersionOptions): Promise<TscVersionRun> => {
      spawned.push(options);
      return Promise.resolve({ exitCode: 127, stdout: '', stderr: 'refused' });
    };

    const error = await rejection(refuseTscCannotStart(root, ENV, { runTscVersion }));

    expect(error).toBeNull();
    expect(spawned).toEqual([]);
  });

  it('is told apart from the same seam over a root with a tsconfig.json, which it spawns and refuses', async () => {
    const root = projectRoot(REFUSING_TSC);
    const spawned: TscVersionOptions[] = [];
    const runTscVersion = (options: TscVersionOptions): Promise<TscVersionRun> => {
      spawned.push(options);
      return Promise.resolve({ exitCode: 127, stdout: '', stderr: 'refused' });
    };

    const error = await rejection(refuseTscCannotStart(root, ENV, { runTscVersion }));

    expect(error).toBeInstanceOf(CommandExit);
    expect(spawned).toHaveLength(1);
  });
});

describe('loopStartCommand', () => {
  it('refuses a tsc that cannot start before the stand-in start is reached', async () => {
    const root = projectRoot(REFUSING_TSC);
    const calls: string[] = [];
    const command = loopStartCommand((_args, at) => {
      calls.push(at);
      return Promise.resolve();
    });

    const error = await rejection(command.run(contextAt(root)));

    expect(error).toBeInstanceOf(CommandExit);
    expect((error as CommandExit).exitCode).toBe(1);
    expect((error as CommandExit).message).toBe(tscRefusal(await readDoctorTsc(root, ENV)) ?? 'no refusal');
    expect(calls).toEqual([]);
  }, SPAWN_TIMEOUT);

  it('reaches the stand-in start once over a tsc that starts', async () => {
    const root = projectRoot(STARTING_TSC);
    const calls: string[] = [];
    const command = loopStartCommand((_args, at) => {
      calls.push(at);
      return Promise.resolve();
    });

    const error = await rejection(command.run(contextAt(root)));

    expect(error).toBeNull();
    expect(calls).toEqual([root]);
  }, SPAWN_TIMEOUT);
});
