/**
 * A spawned test of `rafa loop wait`: the real command, run as
 * `bun src/rafa.ts` against a fixture record whose pid is a live child
 * process. A `pr` line appended to the events file ends the wait with
 * exit 0 and the line printed; a second record whose child is killed
 * ends it with exit 14; an unknown `--session-id` ends it with exit 2.
 */
import { appendFileSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { WAIT_NO_SESSION_EXIT, waitExitCode } from '../loop/wait-reasons.js';
import { eventsFilePath } from '../start/loop-events.js';

import { plantScratchRepo, runRafa, startRafa } from './cli-capture.js';
import { plantSession, sessionRecord } from './loop-session-fixtures.js';

const RUN_TIMEOUT = { timeout: 60_000 };

const scratchBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-wait-spawned-')));
const children: Bun.Subprocess[] = [];

afterAll(() => {
  for (const child of children) child.kill();
  rmSync(scratchBase, { recursive: true, force: true });
});

/** A child process that stays alive until killed. */
function liveChild(): Bun.Subprocess {
  const child = Bun.spawn([process.execPath, '-e', 'setTimeout(() => {}, 300000)'], {
    stdin: 'ignore',
    stdout: 'ignore',
    stderr: 'ignore',
  });
  children.push(child);
  return child;
}

const PR_SUMMARY = 'opened pull request #42';

describe('rafa loop wait, spawned', () => {
  it('exits 0 printing the pr line appended while the run is alive', async () => {
    // Arrange
    const scratch = plantScratchRepo(scratchBase);
    const child = liveChild();
    const record = sessionRecord({ sessionId: 'wait-pr', pid: child.pid, branch: 'main' });
    plantSession(scratch.repo, record);

    // Act
    const running = startRafa(scratch, scratch.repo, ['loop', 'wait', '--session-id=wait-pr']);
    await Bun.sleep(1_000);
    appendFileSync(
      eventsFilePath(scratch.repo, 'wait-pr'),
      `${JSON.stringify({ name: 'pr', summary: PR_SUMMARY, data: {}, ts: new Date().toISOString() })}\n`,
    );
    const run = await running.result;

    // Assert
    expect(run.exitCode).toBe(waitExitCode('pr'));
    expect(run.exitCode).toBe(0);
    expect(run.stdout + run.stderr).toContain(`rafa· ${PR_SUMMARY}`);
  }, RUN_TIMEOUT);

  it('exits 14 once the record\'s pid is killed', async () => {
    // Arrange
    const scratch = plantScratchRepo(scratchBase);
    const child = liveChild();
    plantSession(scratch.repo, sessionRecord({ sessionId: 'wait-exit', pid: child.pid, branch: 'main' }));

    // Act
    const running = startRafa(scratch, scratch.repo, ['loop', 'wait', '--session-id=wait-exit']);
    await Bun.sleep(1_000);
    child.kill('SIGKILL');
    await child.exited;
    const run = await running.result;

    // Assert
    expect(run.exitCode).toBe(14);
    expect(run.stdout + run.stderr).toContain('rafa· exit');
  }, RUN_TIMEOUT);

  it('exits 2 for a session id no record answers to', () => {
    // Arrange
    const scratch = plantScratchRepo(scratchBase);

    // Act
    const run = runRafa(scratch, scratch.repo, ['loop', 'wait', '--session-id=no-such-session']);

    // Assert
    expect(run.exitCode).toBe(WAIT_NO_SESSION_EXIT);
    expect(run.exitCode).toBe(2);
  }, RUN_TIMEOUT);
});
