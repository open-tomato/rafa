/**
 * A command line run, and what it wrote, for the tests of a command:
 * dispatched in-process over a registry a case builds, or spawned as
 * `bun src/rafa.ts` in a scratch git repository.
 *
 * In-process, the invocation gets streams, an environment and a clock of
 * its own, so a case reads exactly what that invocation wrote and no
 * `RAFA_OUTPUT` the suite runs under reaches it. It runs inside a project
 * of its own: a temporary directory holding the `.rafa/config.yaml`
 * `rafa init` writes, beside an empty home, both removed once it answers.
 * So a command needing a project finds one, and no walk reaches the
 * suite's working directory or the real home. A case reading what a
 * command left in its project plants one with {@link plantProject} under
 * a directory the case owns, and dispatches from its root with
 * {@link dispatchInProject}, which removes nothing.
 *
 * Spawned, the child runs under a scratch repository whose HOME, `bin/`
 * directory and call log sit beside it in a temporary directory, never
 * the real home. Its environment holds a PATH of that `bin/` directory
 * then git's own, the scratch HOME, and nothing else but what the case
 * names. So `claude` resolves to the stand-in {@link plantStandInClaude}
 * writes there, or to nothing: {@link runRafa} refuses to spawn when it
 * resolves anywhere else.
 *
 * {@link plantScratchRepo} makes the scratch repository a project with
 * {@link plantProjectConfig}, as every spawn of a command needing a
 * project must: outside one the dispatcher refuses it with the
 * `rafa init` hint (`src/cli/dispatch.ts`). A case running `init`, the
 * command that makes a project, asks for none.
 */
import type { OutputStream } from '../adapters/output/stream.js';
import type { RafaCommand } from '../cli/command.js';
import type { SubjectSpec } from '../cli/registry.js';
import type { CliEvent } from '../ports/index.js';

import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { dispatch } from '../cli/dispatch.js';
import { createCommandRegistry } from '../cli/registry.js';
import { configFilePath } from '../config.js';
import { projectConfigText } from '../project/scaffold.js';

/** The CLI entry a spawned run executes. */
const RAFA_ENTRY = fileURLToPath(new URL('../rafa.ts', import.meta.url));

/** How long a spawned run may take before it is killed. */
const KILL_AFTER_MS = 30_000;

/** What one run wrote, and how it ended. */
export interface CapturedRun {
  /** Null when a spawned run was killed. */
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

/** A stream collecting what is written to it. */
function memoryStream(): { stream: OutputStream; text: () => string } {
  const chunks: string[] = [];
  return {
    stream: {
      write: (chunk) => {
        chunks.push(chunk);
        return true;
      },
    },
    text: () => chunks.join(''),
  };
}

/**
 * Makes `root` a rafa project: writes `.rafa/config.yaml` under it, the
 * file `rafa init` writes unless `text` says otherwise. Answers the file.
 */
export function plantProjectConfig(root: string, text: string = projectConfigText()): string {
  const file = configFilePath(root);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text, 'utf8');
  return file;
}

/** A project a case planted: its root, holding `.rafa/config.yaml`, beside an empty home. */
export interface PlantedProject {
  /** The project root, holding `.rafa/config.yaml`. */
  readonly root: string;
  /** The home the dispatcher's walk passes over, empty. */
  readonly home: string;
}

/**
 * Plants a project under `scope`, a directory that exists: `project/`
 * holding {@link plantProjectConfig}'s file, written with `text` unless
 * it is left out, and an empty `home/` beside it. Answers both paths.
 */
export function plantProject(scope: string, text: string = projectConfigText()): PlantedProject {
  const root = join(scope, 'project');
  const home = join(scope, 'home');
  plantProjectConfig(root, text);
  mkdirSync(home);
  return { root, home };
}

/**
 * Dispatches `words` in-process over a registry of `subjects` and
 * `commands` from the root of `project`, with streams, a clock and the
 * environment `env` of its own. Nothing is removed afterwards; see the
 * module note.
 */
export async function dispatchInProject(
  words: readonly string[],
  subjects: readonly SubjectSpec[],
  commands: readonly RafaCommand[],
  project: PlantedProject,
  env: Readonly<Record<string, string>> = {},
): Promise<CapturedRun> {
  const stdout = memoryStream();
  const stderr = memoryStream();
  const { exitCode } = await dispatch(words, {
    registry: createCommandRegistry({ subjects, commands }),
    env,
    stdout: stdout.stream,
    stderr: stderr.stream,
    now: () => new Date('2026-09-15T12:00:00.000Z'),
    cwd: project.root,
    home: project.home,
  });
  return { exitCode, stdout: stdout.text(), stderr: stderr.text() };
}

/**
 * Dispatches `words` in-process over a registry of `subjects` and
 * `commands`, with streams, a clock and the environment `env` of its own,
 * inside a temporary project of its own, removed once it answers; see the
 * module note.
 */
export async function dispatchCaptured(
  words: readonly string[],
  subjects: readonly SubjectSpec[],
  commands: readonly RafaCommand[],
  env: Readonly<Record<string, string>> = {},
): Promise<CapturedRun> {
  const scope = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-dispatch-captured-')));
  try {
    return await dispatchInProject(words, subjects, commands, plantProject(scope), env);
  } finally {
    rmSync(scope, { recursive: true, force: true });
  }
}

/** Every line of a json-mode stdout, parsed. Throws on a line that is no JSON. */
export function eventsOf(stdout: string): CliEvent[] {
  return stdout
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => JSON.parse(line) as CliEvent);
}

/** A scratch repository, and the directories beside it a spawned run reads. */
export interface ScratchRepo {
  /** The git repository, its path resolved through every link, as git answers its root. */
  readonly repo: string;
  /** The HOME a spawned run gets. */
  readonly home: string;
  /** The directory first on the PATH a spawned run gets. */
  readonly bin: string;
  /** The file a stand-in `claude` appends one line to per call. */
  readonly callLog: string;
  /** The PATH a spawned run gets: `bin`, then git's own directory. */
  readonly path: string;
}

/** What {@link plantScratchRepo} plants beyond the repository. */
export interface ScratchOptions {
  /** Whether the repository is a project, holding {@link plantProjectConfig}'s file. Defaults to true. */
  readonly project?: boolean;
}

/**
 * Plants a git repository with no commit under a fresh directory in
 * `base`, with its HOME and `bin/` beside it, and makes it a project
 * unless `options` says otherwise; see the module note.
 */
export function plantScratchRepo(base: string, options: ScratchOptions = {}): ScratchRepo {
  const root = realpathSync(mkdtempSync(join(base, 'scratch-')));
  const repo = join(root, 'repo');
  const home = join(root, 'home');
  const bin = join(root, 'bin');
  for (const dir of [repo, home, bin]) mkdirSync(dir, { recursive: true });

  execFileSync('git', ['init', '-q', '.'], {
    cwd: repo,
    stdio: 'pipe',
    env: { ...process.env, HOME: home, GIT_CONFIG_GLOBAL: join(home, '.gitconfig'), GIT_CONFIG_NOSYSTEM: '1' },
  });
  if (options.project !== false) plantProjectConfig(repo);

  const gitBinary = Bun.which('git');
  if (gitBinary === null) throw new Error('git is not on the PATH this suite runs under');
  return { repo, home, bin, callLog: join(root, 'calls.log'), path: [bin, dirname(gitBinary)].join(delimiter) };
}

/** Writes a stand-in `claude` into the scratch `bin/`, which reads its stdin, logs the call and exits 0. */
export function plantStandInClaude(scratch: ScratchRepo): string {
  const claude = join(scratch.bin, 'claude');
  writeFileSync(claude, [
    '#!/bin/sh',
    'while read -r _line; do :; done',
    `echo called >> '${scratch.callLog}'`,
    'exit 0',
    '',
  ].join('\n'), 'utf8');
  chmodSync(claude, 0o755);
  return claude;
}

/**
 * Spawns `bun src/rafa.ts` with `words` in `cwd`, under the scratch PATH
 * and HOME and the variables `env` names; see the module note.
 */
export function runRafa(
  scratch: ScratchRepo,
  cwd: string,
  words: readonly string[],
  env: Readonly<Record<string, string>> = {},
): CapturedRun {
  const resolved = Bun.which('claude', { PATH: scratch.path });
  if (resolved !== null && resolved !== join(scratch.bin, 'claude')) {
    throw new Error(`claude resolves to ${resolved}, not to the stand-in or to nothing`);
  }
  const run = Bun.spawnSync([process.execPath, RAFA_ENTRY, ...words], {
    cwd,
    env: { ...env, PATH: scratch.path, HOME: scratch.home },
    timeout: KILL_AFTER_MS,
  });
  return { exitCode: run.exitCode, stdout: run.stdout.toString(), stderr: run.stderr.toString() };
}
