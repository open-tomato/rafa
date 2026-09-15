/**
 * Tests for `rafa self-update` (`self-update.ts`): the install it runs in
 * the project root, the build lines it forwards, the `PATH` warning, json
 * mode, and its refusals with their exit codes. The install itself is
 * held in `src/runtime/install.test.ts`.
 *
 * Each case dispatches a command made over a build seam of its own, in a
 * project planted under this file's temporary directory beside a home of
 * its own, with an environment of its own. No case runs the real build,
 * and every path a case reads a link or a runtime at is asserted under
 * that directory, so none reaches the real home.
 */
import type { SelfUpdateResult, SelfUpdateSeams } from './self-update.js';
import type { PlantedProject } from '../tests/cli-capture.js';

import { existsSync, mkdirSync, mkdtempSync, readlinkSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, sep } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { runBuild } from '../runtime/install.js';
import { dispatchInProject, eventsOf, plantProject } from '../tests/cli-capture.js';

import selfUpdateCommand, { createSelfUpdateCommand, DEFAULT_SELF_UPDATE_SEAMS } from './self-update.js';

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

describe('rafa self-update refuses', () => {
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

describe('the registered command', () => {
  it('is top-level, needs a project, and builds with the real bun run build', () => {
    expect([selfUpdateCommand.subject, selfUpdateCommand.action]).toEqual(['self-update', 'self-update']);
    expect(selfUpdateCommand.needsProject).toBeUndefined();
    expect(DEFAULT_SELF_UPDATE_SEAMS.build).toBe(runBuild);
  });
});
