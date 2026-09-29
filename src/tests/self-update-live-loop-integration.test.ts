/**
 * `rafa self-update` beside a live loop, end to end over a real pid: the
 * unit cases in `commands/self-update.test.ts` judge liveness with a
 * probe of the case's own choosing, and the one case reading the default
 * probe names a pid that stays alive for the whole case (this test
 * process's own). Neither proves the refusal lifts once a REAL process
 * the record names has actually exited.
 *
 * This case spawns a child of its own — `bun -e 'setTimeout(...)'`, which
 * holds no lock and prints nothing, so it stays alive until killed — and
 * plants a session record naming its pid, as `loop start` would. It
 * dispatches `rafa self-update` with a build seam of its own (so no real
 * `bun run build` runs) but no `isAlive` seam, so the command's default,
 * the real `isPidAlive` (`loop/sessions.ts`), reads the child's pid
 * through the OS. The run exits 1, naming the loop's branch, pid and
 * session, and builds nothing. The child is then killed and awaited, so
 * its pid is gone by the time a second, otherwise identical run is
 * dispatched: that run installs, reaching the build seam and linking
 * `~/.rafa/bin/rafa`, the record itself untouched.
 */
import type { PlantedProject } from './cli-capture.js';
import type { SessionRecord } from '../loop/sessions.js';

import { existsSync, mkdirSync, mkdtempSync, readlinkSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { createSelfUpdateCommand } from '../commands/self-update.js';

import { dispatchInProject, plantProject } from './cli-capture.js';

/** A temporary directory of this file's own, its real path. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-self-update-live-loop-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

const VERSION = '5.6.7';

/** A rafa checkout that is a project, beside a home, under a directory of its own. */
function plantCheckout(): PlantedProject {
  const scope = join(tempBase, 'world');
  mkdirSync(scope);
  const project = plantProject(scope);
  writeFileSync(join(project.root, 'package.json'), `${JSON.stringify({ name: '@open-tomato/rafa', version: VERSION })}\n`);
  return project;
}

/** Writes `text` at `path`, making its directories. */
function writeFile(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

/** Writes a session record under the project's `.rafa/runs/`, as `loop start` would. */
function plantLoop(project: PlantedProject, sessionId: string, branch: string, pid: number): void {
  const record: SessionRecord = {
    sessionId,
    planStub: `stub-${sessionId}`,
    plan: `.rafa/plans/PLAN-${sessionId}.md`,
    branch,
    pid,
    startedAt: '2026-09-29T10:00:00.000Z',
    state: 'running',
    task: null,
  };
  writeFile(join(project.root, '.rafa', 'runs', `${sessionId}.json`), `${JSON.stringify(record, null, 2)}\n`);
}

describe('rafa self-update beside a real live loop, over a real pid', () => {
  it('exits 1 naming the loop while its pid answers alive, and installs once that pid is gone', async () => {
    const project = plantCheckout();
    const child = Bun.spawn([process.execPath, '-e', 'setTimeout(() => {}, 600000)'], {
      stdin: 'ignore',
      stdout: 'ignore',
      stderr: 'ignore',
    });
    if (child.pid === undefined) throw new Error('the stand-in loop process was spawned with no pid');
    plantLoop(project, 'live', 'feature/real-pid', child.pid);
    const builds: string[] = [];
    const seams = {
      build: (root: string) => {
        builds.push(root);
        writeFile(join(root, 'dist', 'cli.js'), 'console.log(1);\n');
        return 0;
      },
    };
    const env = { PATH: join(project.home, '.rafa', 'bin') };

    try {
      const refused = await dispatchInProject(['self-update'], [], [createSelfUpdateCommand(seams)], project, env);

      expect(refused.exitCode).toBe(1);
      expect(refused.stderr).toContain('REFUSED — 1 loop(s) of this project are live');
      expect(refused.stderr).toContain(`loop on feature/real-pid (pid ${String(child.pid)}, session live)`);
      expect(builds).toEqual([]);
      expect(existsSync(join(project.home, '.rafa'))).toBe(false);
    } finally {
      child.kill();
      await child.exited;
    }

    const run = await dispatchInProject(['self-update'], [], [createSelfUpdateCommand(seams)], project, env);

    expect(run.exitCode).toBe(0);
    expect(builds).toEqual([project.root]);
    const linkPath = join(project.home, '.rafa', 'bin', 'rafa');
    const cli = join(project.home, '.rafa', 'runtime', VERSION, 'cli.js');
    expect(readlinkSync(linkPath)).toBe(cli);
    expect(existsSync(join(project.root, '.rafa', 'runs', 'live.json'))).toBe(true);
  }, 20_000);
});
