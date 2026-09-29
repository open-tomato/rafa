/**
 * Tests for `rafa self-update` (`self-update.ts`): the install it runs in
 * the project root, the build lines it forwards, the `PATH` warning, json
 * mode, `--force` reaching the install, the wait for a live loop and
 * `dangerous.selfUpdateDuringLoop`, and its refusals with their exit
 * codes. The install itself is held in `src/runtime/install.test.ts`.
 *
 * Each case dispatches a command made over a build seam of its own, in a
 * project planted under this file's temporary directory beside a home of
 * its own, with an environment of its own. No case runs the real build,
 * and every path a case reads a link or a runtime at is asserted under
 * that directory, so none reaches the real home. A live loop is a
 * session record planted under the project's `.rafa/runs/`, its pid
 * judged by the case's own probe, except in the one case reading the
 * default probe, whose record names this test process's own pid.
 */
import type { SelfUpdateResult, SelfUpdateSeams } from './self-update.js';
import type { SessionRecord, SessionState } from '../loop/sessions.js';
import type { PlantedProject } from '../tests/cli-capture.js';

import { existsSync, mkdirSync, mkdtempSync, readlinkSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, sep } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { projectConfigText } from '../project/scaffold.js';
import { runBuild } from '../runtime/install.js';
import { dispatchInProject, eventsOf, plantProject, plantProjectConfig } from '../tests/cli-capture.js';

import selfUpdateCommand, {
  createSelfUpdateCommand,
  DEFAULT_SELF_UPDATE_SEAMS,
  DURING_LOOP_KEY,
  liveLoopsOf,
} from './self-update.js';

/** A temporary directory of this file's own, its real path. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-self-update-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

const VERSION = '9.8.7';

let worlds = 0;

/** A rafa checkout that is a project, beside a home, under a directory of its own. */
function plantCheckout(name = '@open-tomato/rafa'): PlantedProject {
  worlds += 1;
  const scope = join(tempBase, `world-${worlds}`);
  mkdirSync(scope);
  const project = plantProject(scope);
  writeFileSync(join(project.root, 'package.json'), `${JSON.stringify({ name, version: VERSION })}\n`);
  for (const path of [project.root, project.home]) expect(path.startsWith(`${tempBase}${sep}`)).toBe(true);
  return project;
}

function writeFile(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

/** A build seam recording each root it built, writing `dist/cli.js` and one line to each stream. */
function recordingBuild(builds: string[], exitCode = 0): SelfUpdateSeams {
  return {
    build: (root, lines) => {
      builds.push(root);
      writeFile(join(root, 'dist', 'cli.js'), 'console.log(1);\n');
      lines.info('Bundled 1 module');
      lines.warn('a build warning');
      return exitCode;
    },
  };
}

function rafaBinOf(project: PlantedProject): string {
  return join(project.home, '.rafa', 'bin');
}

async function selfUpdate(
  project: PlantedProject,
  seams: SelfUpdateSeams,
  words: readonly string[] = [],
  env: Readonly<Record<string, string>> = { PATH: rafaBinOf(project) },
): ReturnType<typeof dispatchInProject> {
  return dispatchInProject(['self-update', ...words], [], [createSelfUpdateCommand(seams)], project, env);
}

describe('rafa self-update installs the checkout', () => {
  it('builds the project root and links ~/.rafa/bin/rafa at the copied cli.js, forwarding the build lines', async () => {
    const project = plantCheckout();
    const builds: string[] = [];

    const run = await selfUpdate(project, recordingBuild(builds));

    const cli = join(project.home, '.rafa', 'runtime', VERSION, 'cli.js');
    const linkPath = join(rafaBinOf(project), 'rafa');
    expect(run.exitCode).toBe(0);
    expect(run.stderr).toBe('');
    expect(builds).toEqual([project.root]);
    expect(readlinkSync(linkPath)).toBe(cli);
    const lines = run.stdout.trimEnd().split('\n');
    expect(lines).toContain('Bundled 1 module');
    expect(lines).toContain('warn: a build warning');
    expect(lines.at(-1)).toBe(`${linkPath} resolves to ${realpathSync(cli)}`);
  });

  it('warns when ~/.rafa/bin is behind ~/.bun/bin on the PATH, and still exits 0', async () => {
    const project = plantCheckout();
    const bunBin = join(project.home, '.bun', 'bin');

    const run = await selfUpdate(project, recordingBuild([]), [], { PATH: [bunBin, rafaBinOf(project)].join(delimiter) });

    expect(run.exitCode).toBe(0);
    const lines = run.stdout.trimEnd().split('\n');
    expect(lines.at(-1)).toStartWith(`warn: ${rafaBinOf(project)} is on PATH after ${bunBin}`);
  });

  it('gives the install as the result data in json mode, every line an event', async () => {
    const project = plantCheckout();

    const run = await selfUpdate(project, recordingBuild([]), ['--output=json']);

    expect(run.exitCode).toBe(0);
    const events = eventsOf(run.stdout);
    const result = events.at(-1);
    expect(result).toMatchObject({ type: 'result', ok: true });
    const data = (result as { data: SelfUpdateResult }).data;
    expect(data).toMatchObject({
      root: project.root,
      version: VERSION,
      runtimeDir: join(project.home, '.rafa', 'runtime', VERSION),
      linkPath: join(rafaBinOf(project), 'rafa'),
      copied: 1,
      binPath: { state: 'ahead', warning: null },
    });
    expect(events.some((event) => event.type === 'log' && 'message' in event && event.message === 'Bundled 1 module')).toBe(true);
  });
});

describe('rafa self-update --force', () => {
  it('replaces a runtime directory already there whole, dropping what the old build left', async () => {
    const project = plantCheckout();
    const runtimeDir = join(project.home, '.rafa', 'runtime', VERSION);
    writeFile(join(runtimeDir, 'marker.txt'), 'planted\n');
    const builds: string[] = [];

    // The control: the same project without the flag refuses and builds nothing.
    const refused = await selfUpdate(project, recordingBuild(builds));
    expect(refused.exitCode).toBe(1);
    expect(builds).toEqual([]);

    const run = await selfUpdate(project, recordingBuild(builds), ['--force']);

    expect(run.exitCode).toBe(0);
    expect(builds).toEqual([project.root]);
    expect(existsSync(join(runtimeDir, 'marker.txt'))).toBe(false);
    expect(readlinkSync(join(rafaBinOf(project), 'rafa'))).toBe(join(runtimeDir, 'cli.js'));
  });

  it('exits 1 for a value on the flag, before anything is read', async () => {
    const project = plantCheckout();
    const builds: string[] = [];

    const run = await selfUpdate(project, recordingBuild(builds), ['--force=nonsense']);

    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain('--force takes no value, and read "nonsense" as one');
    expect(run.stderr).toContain('Usage: rafa self-update [--force]');
    expect(builds).toEqual([]);
  });
});

describe('rafa self-update refuses', () => {
  it('exits 1 when this version is already installed, naming the directory and building nothing', async () => {
    const project = plantCheckout();
    const runtimeDir = join(project.home, '.rafa', 'runtime', VERSION);
    writeFile(join(runtimeDir, 'cli.js'), 'the runtime in use\n');
    const builds: string[] = [];

    const run = await selfUpdate(project, recordingBuild(builds));

    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain(`REFUSED — ${runtimeDir} already holds version ${VERSION}`);
    expect(run.stderr).toContain('run it again with --force');
    expect(builds).toEqual([]);
    expect(existsSync(join(rafaBinOf(project), 'rafa'))).toBe(false);
  });

  it('exits 1 while a tracker in plan.dir holds a task, naming it and building nothing', async () => {
    const project = plantCheckout();
    writeFile(join(project.root, '.rafa', 'plans', 'PLAN_TRACKER-a.md'), '- [x] done\n- [BLOCKED] stuck\n');
    const builds: string[] = [];

    const run = await selfUpdate(project, recordingBuild(builds));

    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain('REFUSED — 1 plan tracker(s) in .rafa/plans still hold a task');
    expect(run.stderr).toContain(`${join('.rafa', 'plans', 'PLAN_TRACKER-a.md')}:2  [BLOCKED] stuck`);
    expect(builds).toEqual([]);
    expect(existsSync(join(project.home, '.rafa'))).toBe(false);
  });

  it('exits 2 in a project that is no rafa checkout, building nothing', async () => {
    const project = plantCheckout('@someone/else');
    const builds: string[] = [];

    const run = await selfUpdate(project, recordingBuild(builds));

    expect(run.exitCode).toBe(2);
    expect(run.stderr).toContain('FAIL — manifest:');
    expect(run.stderr).toContain('this is no rafa checkout');
    expect(builds).toEqual([]);
  });

  it('exits 2 when the build fails, linking nothing', async () => {
    const project = plantCheckout();

    const run = await selfUpdate(project, recordingBuild([], 1));

    expect(run.exitCode).toBe(2);
    expect(run.stderr).toContain('FAIL — build: the build exited 1');
    expect(existsSync(join(rafaBinOf(project), 'rafa'))).toBe(false);
  });

  it('exits 1 for a positional word, before anything is read', async () => {
    const project = plantCheckout();
    const builds: string[] = [];

    const run = await selfUpdate(project, recordingBuild(builds), ['now']);

    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain('Usage: rafa self-update');
    expect(builds).toEqual([]);
  });
});

/** The pids a case's probe reads as alive. */
const LIVE_PID = 4242;
const LIVE_PID_TOO = 4343;
const GONE_PID = 4444;

/** A probe reading {@link LIVE_PID} and {@link LIVE_PID_TOO} alive and every other pid gone. */
const probe = (pid: number): boolean => pid === LIVE_PID || pid === LIVE_PID_TOO;

/** Writes a session record under the project's `.rafa/runs/`, as `loop start` would. */
function plantLoop(
  project: PlantedProject,
  sessionId: string,
  branch: string,
  pid: number,
  state: SessionState = 'running',
  startedAt = '2026-09-29T10:00:00.000Z',
): void {
  const record: SessionRecord = {
    sessionId,
    planStub: `stub-${sessionId}`,
    plan: `.rafa/plans/PLAN-${sessionId}.md`,
    branch,
    pid,
    startedAt,
    state,
    task: null,
  };
  writeFile(join(project.root, '.rafa', 'runs', `${sessionId}.json`), `${JSON.stringify(record, null, 2)}\n`);
}

/** A build seam as {@link recordingBuild}, judging pids by {@link probe}. */
function probedBuild(builds: string[]): SelfUpdateSeams {
  return { ...recordingBuild(builds), isAlive: probe };
}

/** The project's config with `dangerous.selfUpdateDuringLoop` set to `value`. */
function setDuringLoop(project: PlantedProject, value: boolean): void {
  plantProjectConfig(project.root, `${projectConfigText()}dangerous:\n  selfUpdateDuringLoop: ${String(value)}\n`);
}

describe('rafa self-update beside a live loop', () => {
  it('exits 1 naming each live loop\'s branch and pid, oldest first, and builds nothing', async () => {
    const project = plantCheckout();
    plantLoop(project, 'later', 'feature/b', LIVE_PID_TOO, 'paused', '2026-09-29T11:00:00.000Z');
    plantLoop(project, 'earlier', 'feature/a', LIVE_PID);
    plantLoop(project, 'killed', 'feature/gone', GONE_PID);
    plantLoop(project, 'finished', 'feature/done', LIVE_PID, 'done');
    const builds: string[] = [];

    const run = await selfUpdate(project, probedBuild(builds));

    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain('REFUSED — 2 loop(s) of this project are live');
    const named = run.stderr.split('\n').filter((line) => line.startsWith('  loop on '));
    expect(named).toEqual([
      `  loop on feature/a (pid ${LIVE_PID}, session earlier)`,
      `  loop on feature/b (pid ${LIVE_PID_TOO}, session later)`,
    ]);
    expect(run.stderr).toContain(`set ${DURING_LOOP_KEY}: true to install under them`);
    expect(builds).toEqual([]);
    expect(existsSync(join(project.home, '.rafa'))).toBe(false);
  });

  it('refuses ahead of a tracker with a task left, so the loop is what it names', async () => {
    const project = plantCheckout();
    writeFile(join(project.root, '.rafa', 'plans', 'PLAN_TRACKER-a.md'), '- [ ] open\n');
    plantLoop(project, 'running', 'feature/a', LIVE_PID);

    const run = await selfUpdate(project, probedBuild([]));

    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain('loop on feature/a (pid 4242, session running)');
    expect(run.stderr).not.toContain('plan tracker(s)');
  });

  it('keeps refusing under --force, which does not override the wait', async () => {
    const project = plantCheckout();
    plantLoop(project, 'running', 'feature/a', LIVE_PID);
    const builds: string[] = [];

    const run = await selfUpdate(project, probedBuild(builds), ['--force']);

    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain('loop on feature/a (pid 4242, session running)');
    expect(builds).toEqual([]);
  });

  it('installs under a live loop when dangerous.selfUpdateDuringLoop is true', async () => {
    const project = plantCheckout();
    plantLoop(project, 'running', 'feature/a', LIVE_PID);
    const builds: string[] = [];

    // The control: the key set to false refuses, as its absence does.
    setDuringLoop(project, false);
    const refused = await selfUpdate(project, probedBuild(builds));
    expect(refused.exitCode).toBe(1);
    expect(builds).toEqual([]);

    setDuringLoop(project, true);
    const run = await selfUpdate(project, probedBuild(builds));

    expect(run.exitCode).toBe(0);
    expect(builds).toEqual([project.root]);
    expect(readlinkSync(join(rafaBinOf(project), 'rafa'))).toBe(join(project.home, '.rafa', 'runtime', VERSION, 'cli.js'));
  });

  it('installs once every recorded pid is gone, the records left as they are', async () => {
    const project = plantCheckout();
    plantLoop(project, 'killed', 'feature/a', GONE_PID);
    const builds: string[] = [];

    const run = await selfUpdate(project, probedBuild(builds));

    expect(run.exitCode).toBe(0);
    expect(builds).toEqual([project.root]);
    expect(existsSync(join(project.root, '.rafa', 'runs', 'killed.json'))).toBe(true);
  });

  it('reads a pid with isPidAlive when the seams name no probe, this process reading as alive', async () => {
    const project = plantCheckout();
    plantLoop(project, 'this-process', 'feature/self', process.pid);
    const builds: string[] = [];

    const run = await selfUpdate(project, recordingBuild(builds));

    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain(`loop on feature/self (pid ${process.pid}, session this-process)`);
    expect(builds).toEqual([]);
  });

  it('gives the refusal as a failed terminal result in json mode', async () => {
    const project = plantCheckout();
    plantLoop(project, 'running', 'feature/a', LIVE_PID);

    const run = await selfUpdate(project, probedBuild([]), ['--output=json']);

    expect(run.exitCode).toBe(1);
    const result = eventsOf(run.stdout).at(-1);
    expect(result).toMatchObject({ type: 'result', ok: false });
    expect(JSON.stringify(result)).toContain('loop on feature/a (pid 4242, session running)');
  });

  it('exits 2 for a loop record it cannot read, building nothing', async () => {
    const project = plantCheckout();
    writeFile(join(project.root, '.rafa', 'runs', 'broken.json'), 'not json\n');
    const builds: string[] = [];

    const run = await selfUpdate(project, probedBuild(builds));

    expect(run.exitCode).toBe(2);
    expect(run.stderr).toContain('FAIL — loops:');
    expect(run.stderr).toContain('broken.json');
    expect(builds).toEqual([]);
  });
});

describe('liveLoopsOf', () => {
  it('answers no loop for a project with no runs directory', () => {
    const project = plantCheckout();

    expect(liveLoopsOf(project.root, probe)).toEqual([]);
  });
});

describe('the registered command', () => {
  it('is top-level, needs a project, and builds with the real bun run build', () => {
    expect([selfUpdateCommand.subject, selfUpdateCommand.action]).toEqual(['self-update', 'self-update']);
    expect(selfUpdateCommand.needsProject).toBeUndefined();
    expect(DEFAULT_SELF_UPDATE_SEAMS.build).toBe(runBuild);
  });
});
