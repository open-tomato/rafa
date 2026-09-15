/**
 * Tests for the refusal of a detached run (`start/run-config.ts`):
 * which words ask for one, the refusal they meet, and that `loop start`
 * meets it before it reads anything else.
 *
 * `asksDetached` is read over each spelling that asks and beside each near
 * miss that does not: the flag negated, valued `false`, after a `--`, with
 * a longer name, and as the value of another flag.
 *
 * The spawned cases run `bun src/rafa.ts loop start` in a scratch git
 * repository that is a project, under a HOME and PATH of its own with a
 * stand-in `claude` first on it. Both name a plan that does not exist, so
 * the run without the flag, the control, ends on the missing plan: its
 * refusal is what the line meets once nothing refuses it earlier. The run
 * with `-d` ends on the detached refusal instead, and neither leaves a
 * session record or calls the stand-in.
 */
import { existsSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { CommandExit } from '../cli/command.js';
import { plantScratchRepo, plantStandInClaude, runRafa } from '../tests/cli-capture.js';

import { asksDetached, refuseDetachedRun } from './run-config.js';
import { NOTHING_DISPATCHED } from './session.js';

/** A temporary directory of this file's own. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-run-config-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** How long a spawned case may run. */
const SPAWN_TIMEOUT = 30_000;

/** The first line of the refusal. */
const REFUSAL_HEAD = '❌ Refusing to start detached: `-d|--detached` arrives with phase 6';

describe('asksDetached', () => {
  it.each([
    [['--detached']],
    [['-d']],
    [['--detached=true']],
    [['-d=yes']],
    [['--plan=.plans/PLAN-a.md', '-d', '--no-ci-wait']],
  ])('answers true for %j', (words) => {
    expect(asksDetached(words)).toBe(true);
  });

  it.each([
    [[]],
    [['--no-detached']],
    [['--detached=false']],
    [['-d=false']],
    [['--', '--detached']],
    [['--detachedly']],
    [['-dx']],
    [['--plan=-d']],
  ])('answers false for %j', (words) => {
    expect(asksDetached(words)).toBe(false);
  });
});

describe('refuseDetachedRun', () => {
  it('throws exit code 1 with the whole refusal for a line asking for a detached run', () => {
    let thrown: unknown;
    try {
      refuseDetachedRun(['-d']);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(CommandExit);
    const exit = thrown as CommandExit;
    expect(exit.exitCode).toBe(1);
    expect(exit.message.startsWith(REFUSAL_HEAD)).toBe(true);
    expect(exit.message.endsWith(NOTHING_DISPATCHED)).toBe(true);
  });

  it('returns for a line asking for none', () => {
    expect(refuseDetachedRun(['--no-detached', '--plan=.plans/PLAN-a.md'])).toBeUndefined();
  });
});

describe('rafa loop start -d, spawned', () => {
  it('refuses before the plan is looked for, where the same line without the flag meets the missing plan', () => {
    const scratch = plantScratchRepo(tempBase);
    plantStandInClaude(scratch);
    const plan = '--plan=.plans/PLAN-absent.md';

    const detached = runRafa(scratch, scratch.repo, ['loop', 'start', '-d', plan]);
    const control = runRafa(scratch, scratch.repo, ['loop', 'start', plan]);

    expect(detached.exitCode).toBe(1);
    expect(detached.stderr.startsWith(REFUSAL_HEAD)).toBe(true);
    expect(detached.stderr).not.toContain('Plan file not found');
    expect(control.exitCode).toBe(1);
    expect(control.stderr).toContain('Plan file not found');
    expect(control.stderr).not.toContain('detached');
    expect(existsSync(join(scratch.repo, '.rafa', 'runs'))).toBe(false);
    expect(existsSync(scratch.callLog)).toBe(false);
  }, SPAWN_TIMEOUT);
});
