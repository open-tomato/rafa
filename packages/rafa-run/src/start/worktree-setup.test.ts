/**
 * Unit tests for `worktree-setup.ts`, over a real `/bin/sh` in a
 * temporary directory standing in for the worktree, with an output that
 * records each message it is handed.
 */
import type { Output } from '@open-tomato/rafa/ports';

import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { CommandExit } from '@open-tomato/rafa/core/command';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { runWorktreeSetup, SETUP_TAIL_LINES, WORKTREE_SETUP_TIMEOUT_MS } from './worktree-setup.js';

let scratch: string;

beforeEach(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-worktree-setup-')));
});

afterEach(() => {
  rmSync(scratch, { recursive: true, force: true });
});

/** The environment every run here has: a `PATH` reaching the system tools. */
function scratchEnv(extra: Record<string, string> = {}): Record<string, string> {
  return { PATH: '/usr/bin:/bin', HOME: scratch, ...extra };
}

/** An output that records each `info` message, and fails on any other channel. */
function recordingOutput(): { readonly output: Output; readonly infos: readonly string[] } {
  const infos: string[] = [];
  const unexpected = (message: unknown) => {
    throw new Error(`unexpected output: ${String(message)}`);
  };
  const output: Output = {
    info: (message) => {
      infos.push(message);
    },
    warn: unexpected,
    error: unexpected,
    debug: unexpected,
    emit: unexpected,
    result: unexpected,
  };
  return { output, infos };
}

/** What `run` threw, failing the test when it answered. */
async function thrownBy(run: Promise<void>): Promise<CommandExit> {
  try {
    await run;
  } catch (error) {
    if (error instanceof CommandExit) return error;
    throw error;
  }
  throw new Error('expected a CommandExit, but the setup answered');
}

/** True while a process with `pid`, or with `-pid` a group, exists. */
function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Polls `condition` every 20 ms until it holds or `limitMs` passes; answers whether it held. */
async function eventually(condition: () => boolean, limitMs: number): Promise<boolean> {
  const until = Date.now() + limitMs;
  while (Date.now() < until) {
    if (condition()) return true;
    await Bun.sleep(20);
  }
  return condition();
}

describe('the constants', () => {
  it('limits the command to ten minutes and quotes twenty lines', () => {
    expect(WORKTREE_SETUP_TIMEOUT_MS).toBe(600_000);
    expect(SETUP_TAIL_LINES).toBe(20);
  });
});

describe('runWorktreeSetup', () => {
  it('answers on exit 0, printing the line naming the command and the worktree, then both streams', async () => {
    const { output, infos } = recordingOutput();
    const command = 'echo installed; echo "a warning" >&2';

    await runWorktreeSetup({ command, worktree: scratch, env: scratchEnv() }, { output });

    expect(infos).toEqual([
      `\n🧰 Setting up the worktree: running loop.worktreeSetup \`${command}\` in ${scratch}.`,
      'installed\na warning',
    ]);
  });

  it('prints the line alone when the command writes nothing', async () => {
    const { output, infos } = recordingOutput();

    await runWorktreeSetup({ command: 'true', worktree: scratch, env: scratchEnv() }, { output });

    expect(infos).toEqual([`\n🧰 Setting up the worktree: running loop.worktreeSetup \`true\` in ${scratch}.`]);
  });

  it('refuses a nonzero exit with exit code 1, naming the key, the command, the worktree, the code and the output', async () => {
    const { output, infos } = recordingOutput();
    const command = 'echo partly; echo "broke here" >&2; exit 3';

    const exit = await thrownBy(runWorktreeSetup({ command, worktree: scratch, env: scratchEnv() }, { output }));

    expect(exit.exitCode).toBe(1);
    expect(exit.message).toBe(
      `loop.worktreeSetup \`${command}\` in ${scratch} exited 3.\nIts output:\n  partly\n  broke here`,
    );
    expect(infos.at(-1)).toBe('partly\nbroke here');
  });

  it('quotes only the last SETUP_TAIL_LINES lines of a longer output', async () => {
    const { output, infos } = recordingOutput();
    const command = 'for i in $(seq 1 25); do echo "line $i"; done; exit 2';

    const exit = await thrownBy(runWorktreeSetup({ command, worktree: scratch, env: scratchEnv() }, { output }));

    const quoted = Array.from({ length: SETUP_TAIL_LINES }, (_, index) => `  line ${index + 6}`);
    expect(exit.message).toBe(
      [`loop.worktreeSetup \`${command}\` in ${scratch} exited 2.`, 'The last 20 of its 25 lines of output:', ...quoted]
        .join('\n'),
    );
    expect(infos.at(-1)?.split('\n')).toHaveLength(25);
  });

  it('says a failing command that wrote nothing wrote nothing', async () => {
    const { output } = recordingOutput();

    const exit = await thrownBy(runWorktreeSetup({ command: 'exit 4', worktree: scratch, env: scratchEnv() }, { output }));

    expect(exit.message).toBe(`loop.worktreeSetup \`exit 4\` in ${scratch} exited 4.\nIt wrote nothing.`);
  });

  it('kills the process group at the limit, refusing with the limit and what was read', async () => {
    const { output } = recordingOutput();
    const shellPidFile = join(scratch, 'shell.pid');
    const childPidFile = join(scratch, 'child.pid');
    const command = `echo $$ > ${shellPidFile}; sleep 30 & echo $! > ${childPidFile}; echo started; wait`;

    const started = Date.now();
    const exit = await thrownBy(runWorktreeSetup(
      { command, worktree: scratch, env: scratchEnv() },
      { output, timeoutMs: 500 },
    ));

    expect(Date.now() - started).toBeLessThan(5_000);
    expect(exit.exitCode).toBe(1);
    expect(exit.message).toBe(
      `loop.worktreeSetup \`${command}\` in ${scratch} timed out after 0.5s and was killed.\nIts output:\n  started`,
    );
    const shellPid = Number(readFileSync(shellPidFile, 'utf8').trim());
    const childPid = Number(readFileSync(childPidFile, 'utf8').trim());
    expect(await eventually(() => !isAlive(childPid), 2_000)).toBe(true);
    expect(await eventually(() => !isAlive(-shellPid), 2_000)).toBe(true);
  });

  it('names a millisecond limit as a fraction of a second', async () => {
    const { output } = recordingOutput();

    const exit = await thrownBy(runWorktreeSetup(
      { command: 'sleep 5', worktree: scratch, env: scratchEnv() },
      { output, timeoutMs: 1 },
    ));

    expect(exit.message).toBe(
      `loop.worktreeSetup \`sleep 5\` in ${scratch} timed out after 0.001s and was killed.\nIt wrote nothing.`,
    );
  });

  it('runs in the worktree: a file the command writes lands there', async () => {
    const { output } = recordingOutput();

    await runWorktreeSetup({ command: 'echo run >> setup-marker.txt', worktree: scratch, env: scratchEnv() }, { output });

    expect(readFileSync(join(scratch, 'setup-marker.txt'), 'utf8')).toBe('run\n');
  });

  it('closes stdin, so cat ends at once with exit 0', async () => {
    const { output, infos } = recordingOutput();

    const started = Date.now();
    await runWorktreeSetup({ command: 'cat', worktree: scratch, env: scratchEnv() }, { output, timeoutMs: 5_000 });

    expect(Date.now() - started).toBeLessThan(2_000);
    expect(infos).toHaveLength(1);
  });

  it('runs with the environment handed in', async () => {
    const { output, infos } = recordingOutput();

    await runWorktreeSetup(
      { command: 'echo "mark=$SETUP_MARK"', worktree: scratch, env: scratchEnv({ SETUP_MARK: 'handed-in' }) },
      { output },
    );

    expect(infos.at(-1)).toBe('mark=handed-in');
  });

  it('refuses a shell that could not start, naming the key, the command and the worktree', async () => {
    const { output, infos } = recordingOutput();
    const missing = join(scratch, 'no-such-worktree');

    const exit = await thrownBy(runWorktreeSetup({ command: 'true', worktree: missing, env: scratchEnv() }, { output }));

    expect(existsSync(missing)).toBe(false);
    expect(exit.exitCode).toBe(1);
    expect(exit.message).toStartWith(`loop.worktreeSetup \`true\` in ${missing} could not start /bin/sh: `);
    expect(exit.message).toContain('ENOENT');
    expect(exit.message).not.toContain('\n');
    expect(infos).toHaveLength(1);
  });
});
