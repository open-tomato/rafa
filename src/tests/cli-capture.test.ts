/**
 * Tests for `./cli-capture.js`, the helper the command suites run a line
 * through: an in-process dispatch runs inside a project of its own, and a
 * scratch repository is a project unless a case asks for none.
 *
 * The in-process case reads the project the dispatcher hands a command,
 * where reading only that the command ran would prove nothing on a
 * machine holding a `.rafa/config.yaml` in a directory above the
 * checkout: a dispatch from the suite's working directory finds that
 * project. Measured on 2026-09-15 on such a machine, `dispatchCaptured`
 * passing no working directory and no home left all 281 cases of the
 * eleven suites dispatching commands green. So the case holds the root
 * and the home under the temporary directory, and the root gone once the
 * dispatch answers.
 *
 * Driven against this file the same day, each restored sha256-identical:
 * that mutation reddened the in-process case alone, and the scratch
 * repository planting no config reddened the planting case alone.
 */
import type { RafaCommand } from '../cli/command.js';
import type { ProjectFound } from '../project/scope.js';

import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'bun:test';

import { configFilePath } from '../config.js';
import { projectConfigText } from '../project/scaffold.js';

import { dispatchCaptured, dispatchInProject, plantProject, plantScratchRepo, runRafa, spawnedEnv } from './cli-capture.js';

/** The CLI entry the control spawns by hand, as `runRafa` spawns it. */
const RAFA_ENTRY = fileURLToPath(new URL('../rafa.ts', import.meta.url));

/** A temporary directory of this file's own. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-cli-capture-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** A command recording the project its context carries into `seen`. */
function recorder(seen: (ProjectFound | null)[]): RafaCommand {
  return {
    name: 'loop start',
    description: 'Records the project it runs in.',
    subject: 'loop',
    action: 'start',
    summary: 'records its project',
    args: [],
    flags: [],
    examples: [{ cmd: 'rafa loop start', note: 'records its project' }],
    outputs: ['text'],
    run: async (context) => {
      seen.push(context.project);
    },
  };
}

describe('dispatchCaptured', () => {
  it('dispatches inside a project of its own under the temporary directory, removed once it answers', async () => {
    const seen: (ProjectFound | null)[] = [];
    const temporary = `${realpathSync(tmpdir())}/`;

    const run = await dispatchCaptured(['loop', 'start'], [{ name: 'loop', summary: 'the loop' }], [recorder(seen)]);

    const project = seen[0] ?? null;
    expect(run.exitCode).toBe(0);
    expect([project?.root.startsWith(temporary), project?.home.startsWith(temporary)]).toEqual([true, true]);
    expect(existsSync(project?.root ?? tempBase)).toBe(false);
  });
});

describe('plantProject and dispatchInProject', () => {
  it('dispatch from the root of a project the case planted, leaving the project and its config in place', async () => {
    const seen: (ProjectFound | null)[] = [];
    const planted = plantProject(mkdtempSync(join(tempBase, 'planted-')), 'store: ndjson\n');

    const run = await dispatchInProject(['loop', 'start'], [{ name: 'loop', summary: 'the loop' }], [recorder(seen)], planted);

    expect(run.exitCode).toBe(0);
    expect([seen[0]?.root, seen[0]?.home]).toEqual([planted.root, planted.home]);
    expect(planted.root.startsWith(`${tempBase}/`)).toBe(true);
    expect([readFileSync(configFilePath(planted.root), 'utf8'), existsSync(planted.home)]).toEqual(['store: ndjson\n', true]);
  });
});

describe('plantScratchRepo', () => {
  it('plants the config rafa init writes, and none when a case asks for no project', () => {
    const project = plantScratchRepo(tempBase);
    const bare = plantScratchRepo(tempBase, { project: false });

    expect(readFileSync(configFilePath(project.repo), 'utf8')).toBe(projectConfigText());
    expect(existsSync(configFilePath(bare.repo))).toBe(false);
  });
});

describe('runRafa', () => {
  // Bun's behaviour differs here: 1.4.2 writes an install cache under
  // $HOME/.bun on a bare spawn; 1.3.14 writes none. Rafa's claim (nothing
  // under the scratch HOME) holds on every version; only the control's
  // expectation is version-dependent.
  const bunWritesInstallCache = Bun.semver.satisfies(Bun.version, '>=1.4.0');

  it('leaves no .bun directory under the scratch HOME, where the same spawn under HOME alone leaves one only on Bun versions that write the install cache', () => {
    const scratch = plantScratchRepo(tempBase);
    const control = plantScratchRepo(tempBase);

    const run = runRafa(scratch, scratch.repo, ['--help']);
    const bare = Bun.spawnSync([process.execPath, RAFA_ENTRY, '--help'], {
      cwd: control.repo,
      env: { PATH: control.path, HOME: control.home },
    });

    expect(run.exitCode).toBe(0);
    expect(bare.exitCode).toBe(0);
    expect(existsSync(join(control.home, '.bun'))).toBe(bunWritesInstallCache);
    expect(existsSync(join(scratch.home, '.bun'))).toBe(false);
  });
});

describe('spawnedEnv', () => {
  // The first case can only fail when this process runs under a TMPDIR
  // other than the system default: with none set, a child handed no
  // TMPDIR reads /tmp as well. Driven on 2026-10-03 under a TMPDIR made
  // with `mktemp -d -p "$HOME"`: dropping TMPDIR from spawnedEnv reddened
  // the first case alone, and moving it after the case's env reddened
  // the second alone; with no TMPDIR set the dropped key left both green.
  /** What `tmpdir()` answers in a child spawned under the environment `spawnedEnv` gives for `env`. */
  function childTmpdir(env: Readonly<Record<string, string>>): string {
    const scratch = plantScratchRepo(tempBase);
    const child = Bun.spawnSync([process.execPath, '-e', 'process.stdout.write(require("node:os").tmpdir())'], {
      cwd: scratch.repo,
      env: spawnedEnv(scratch, env),
    });
    expect(child.exitCode).toBe(0);
    return child.stdout.toString();
  }

  it('hands a spawned child the tmpdir() of the parent process when the case names no TMPDIR', () => {
    expect(childTmpdir({})).toBe(tmpdir());
  });

  it('hands a spawned child the TMPDIR the case names when the case names one', () => {
    const own = join(tempBase, 'case-tmpdir');

    expect(childTmpdir({ TMPDIR: own })).toBe(own);
  });
});
