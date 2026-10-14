/**
 * `rafa self-update`: builds the rafa checkout it runs in and installs it
 * as the global rafa, as `bun run snapshot` does. See the phase 1
 * installable spec for "Runtime".
 *
 * A top-level command, its action spelled as its subject, so it sits
 * directly under `src/commands/`. It wraps no phase 0 command. It runs
 * inside a project, the checkout, whose root the dispatcher resolved: its
 * `package.json`, its config's `plan.dir`, its trackers and its `dist/`.
 * The command runs from the bundle, which never reaches `scripts/`, so
 * the install is `runtime/install.ts`, shared with the script, whose note
 * is the long form.
 *
 * ## What it does
 *
 * It installs the project root through `installRuntime`: refuses a
 * `package.json` that is not rafa's, reads `plan.dir`, refuses while a
 * tracker there has an open or blocked task and a loop is live, refuses
 * while `~/.rafa/runtime/<version>/` is already there, warns once of the
 * trackers with a task left it installs beside, runs `bun run build`,
 * copies `dist/` into that directory and links `~/.rafa/bin/rafa` at the
 * copied `cli.js`. The home is the project's, the dispatcher's.
 * Each step is an `info` line. The build's output is read, not handed
 * the streams, and written once it ends: its stdout at `info` and its
 * stderr at `warn`, so json mode's stdout stays NDJSON. The build runs
 * under `bun run --silent`, so a clean one writes no `warn` line
 * (`runBuild`).
 *
 * ## A live loop refuses
 *
 * Before the install reads anything, it reads the session records under
 * the project root's `.rafa/runs/` (`readSessions`, `core/loop/sessions.ts`),
 * the project root being the main checkout even when the command runs
 * in a linked worktree (`project/scope.ts`). Each record reading
 * `running` or `paused`, which `readState` answers only while its pid is
 * alive, is a live loop, and the loop runs from the runtime this would
 * replace. While one is live the command exits 1 before building, one
 * line per loop naming its branch, its pid and its session, oldest
 * first, unless `dangerous.selfUpdateDuringLoop` is `true` in the
 * config, which lets the install start. `--force` does not override the
 * wait. The config is read for the key only while
 * a loop is live, its warnings dropped because the install reads it
 * again and warns then, so a project with no live loop reads as before.
 * A record that cannot be read, or a config `loadConfig` refuses, exits
 * 2: a loop the command cannot rule out is never read as none.
 *
 * ## A tracker with a task left
 *
 * A tracker in `plan.dir` with an open or blocked task holds the install
 * back only while a loop is live (`runtime/install.ts`, whose note is
 * the long form). The wait above has answered that by the time the
 * install runs, so with no loop live the install goes on, one `warn`
 * line naming each such tracker and its line: a plan stopped halfway
 * leaves a tracker no loop will clear, and the update no longer waits
 * on it. A loop is live at the install only under
 * `dangerous.selfUpdateDuringLoop`, and there a tracker with a task left
 * still exits 1, naming each one, unless `--force` is on the line, which
 * installs with the same warning. Both readings of the live loops go
 * through `liveLoopsOf` (`runtime/live-loops.ts`) with the one pid probe.
 *
 * ## `--force`
 *
 * A version is installed once: the second install under the same version
 * would swap the runner under a loop running from that directory, so it
 * is refused. `--force` installs anyway, replacing the directory whole,
 * so nothing the old build left is kept. It installs beside a tracker
 * with a task left under a live loop too, as the section above says. The
 * flag is a boolean, and a value other than `true` or `false` is refused
 * with exit code 1. `bun run snapshot --force` does the same from a
 * checkout.
 *
 * After an install it warns when `~/.rafa/bin` is not on the context's
 * `PATH` ahead of `~/.bun/bin` (`project/bin-path.ts`): the link is in
 * place, and a `rafa` found first in `~/.bun/bin` would still run. A
 * warning never changes the exit code.
 *
 * ## The exit code
 *
 * 0 installed. 1 for a positional word, for a `--force` value that is
 * neither `true` nor `false`, for a live loop without
 * `dangerous.selfUpdateDuringLoop`, the refusal naming each loop's branch
 * and pid, for a tracker with a task left while a loop is live without
 * `--force`, the
 * refusal naming each tracker, its line and its task, and for a runtime
 * directory already there without `--force`, the refusal naming the
 * directory and the version. 2 when it
 * could not run: a session record that cannot be read, a `package.json` that cannot be read, names another
 * package or no usable version, a config `loadConfig` refuses, a
 * `plan.dir` that cannot be read, or a build, copy or link that failed,
 * the message naming the step and what that step leaves changed. Each is
 * a `CommandExit`, on stderr in text mode and in the terminal result in
 * json mode.
 *
 * ## What it prints
 *
 * Text mode writes the step lines, the last naming where the link
 * resolves. In json mode each is an `info` `log` event, and the terminal
 * result's `data` is a {@link SelfUpdateResult}.
 *
 * ## Seams
 *
 * The project, its home and the environment are the dispatcher's
 * (`cli/dispatch.ts`). How the build runs is {@link SelfUpdateSeams}, the
 * real `bun run build` for the registered command, so a case plants a
 * checkout under its own temporary directory and a build writing `dist/`.
 * Whether a record's pid is alive is its `isAlive`, `isPidAlive` when left
 * out, so a case plants a live loop without a process of its own.
 */
import type { RafaCommand, RafaContext } from '../core/command/index.js';
import type { PidProbe, SessionRecord } from '../core/loop/index.js';
import type { BinPathReading } from '../project/bin-path.js';
import type { ProjectFound } from '../project/scope.js';
import type { BuildLines } from '../runtime/install.js';

import { SETTINGS } from '../config-registry.js';
import { CommandExit } from '../core/command/index.js';
import { loadConfig } from '../core/config/load.js';
import { messageOf } from '../core/config/sections.js';
import { isPidAlive } from '../core/loop/index.js';
import { readBinPath } from '../project/bin-path.js';
import { exitCodeFor, installRuntime, outcomeProblem, runBuild } from '../runtime/install.js';
import { liveLoopsOf } from '../runtime/live-loops.js';

import { expectNoArgument } from './plan/plan-files.js';

/** How the build runs; see the module note. */
export interface SelfUpdateSeams {
  /** Builds the checkout into its `dist/`, handing its output lines to `lines`, and answers its exit code. */
  readonly build: (repoRoot: string, lines: BuildLines) => number;
  /** Whether a session record's pid is alive; `isPidAlive` when left out. */
  readonly isAlive?: PidProbe;
}

/** The seams the registered command runs with: the real `bun run build`. */
export const DEFAULT_SELF_UPDATE_SEAMS: SelfUpdateSeams = Object.freeze({ build: runBuild });

/** What json mode gives as the terminal result's `data`. */
export interface SelfUpdateResult {
  /** The checkout that was built, the project root. */
  readonly root: string;
  /** The version installed, from `package.json`. */
  readonly version: string;
  /** `~/.rafa/runtime/<version>/`. */
  readonly runtimeDir: string;
  /** `~/.rafa/bin/rafa`. */
  readonly linkPath: string;
  /** The path the link resolves to. */
  readonly resolved: string;
  /** How many files were copied. */
  readonly copied: number;
  /** Where `~/.rafa/bin` sits on the `PATH` handed in. */
  readonly binPath: BinPathReading;
}

/** The usage line a refusal ends with. */
const USAGE = 'rafa self-update [--force]';

/**
 * The value of `--force` as a boolean, refusing a value that is neither
 * `true` nor `false`: the flag takes none.
 */
export function readForceFlag(value: string | boolean | undefined): boolean {
  if (value === undefined || value === false || value === 'false') return false;
  if (value === true || value === 'true') return true;
  throw new CommandExit(1, `❌ --force takes no value, and read "${value}" as one\nUsage: ${USAGE}`);
}

/** The config key that installs past a live loop. */
export const DURING_LOOP_KEY: string = SETTINGS.dangerousSelfUpdateDuringLoop.key;

/** The refusal's lines while `loops` are live; see the module note. */
export function liveLoopRefusalLines(loops: readonly SessionRecord[]): string[] {
  return [
    `REFUSED — ${loops.length} loop(s) of this project are live, and each runs from the runtime this would replace:`,
    ...loops.map((loop) => `  loop on ${loop.branch} (pid ${String(loop.pid)}, session ${loop.sessionId})`),
    'nothing was built, copied or linked. Wait for those loops to finish, then run it again,'
      + ` or set ${DURING_LOOP_KEY}: true to install under them; --force does not.`,
  ];
}

/** Runs `read`, answering what it throws as a could-not-run exit naming `stage`. */
async function orCouldNotRun<T>(stage: string, read: () => T | Promise<T>): Promise<T> {
  try {
    return await read();
  } catch (error) {
    throw new CommandExit(2, `FAIL — ${stage}: ${messageOf(error)}\nnothing was built, copied or linked.`);
  }
}

/** Refuses while a loop of the project is live, unless the config lets it through; see the module note. */
async function refuseDuringLiveLoop(project: ProjectFound, isAlive: PidProbe): Promise<void> {
  const loops = await orCouldNotRun('loops', () => liveLoopsOf(project.root, isAlive));
  if (loops.length === 0) return;
  const config = await orCouldNotRun('config', async () => (await loadConfig({ root: project.root, home: project.home }, {}, () => {})).config);
  if (config.dangerousSelfUpdateDuringLoop) return;
  throw new CommandExit(1, liveLoopRefusalLines(loops).join('\n'));
}

function projectOf(context: RafaContext): ProjectFound {
  if (context.project === null) throw new Error('rafa self-update runs inside a project, and was handed none');
  return context.project;
}

async function runSelfUpdate(context: RafaContext, seams: SelfUpdateSeams): Promise<void> {
  expectNoArgument(context.args, USAGE);
  const force = readForceFlag(context.flags['force']);
  const project = projectOf(context);
  const isAlive = seams.isAlive ?? isPidAlive;
  await refuseDuringLiveLoop(project, isAlive);
  const info = (line: string): void => context.output.info(line);
  const warn = (line: string): void => context.output.warn(line);
  const outcome = await installRuntime({
    repoRoot: project.root,
    home: project.home,
    build: (repoRoot) => seams.build(repoRoot, { info, warn }),
    log: info,
    warn,
    liveLoops: (repoRoot) => liveLoopsOf(repoRoot, isAlive),
  }, { force });
  if (outcome.kind !== 'done') {
    throw new CommandExit(exitCodeFor(outcome), (outcomeProblem(outcome, project.root) ?? []).join('\n'));
  }

  const binPath = readBinPath(context.env['PATH'], project.home);
  if (context.outputMode === 'json') {
    const { version, runtimeDir, linkPath, resolved, copied } = outcome;
    const result: SelfUpdateResult = { root: project.root, version, runtimeDir, linkPath, resolved, copied, binPath };
    context.output.result(result);
  }
  if (binPath.warning !== null) warn(binPath.warning);
}

/** `rafa self-update` over `seams`. */
export function createSelfUpdateCommand(seams: SelfUpdateSeams = DEFAULT_SELF_UPDATE_SEAMS): RafaCommand {
  const command: RafaCommand = {
    name: 'self-update',
    subject: 'self-update',
    action: 'self-update',
    summary: 'build this rafa checkout and install it as the global rafa in ~/.rafa',
    description: 'Builds the rafa checkout it runs in with `bun run build`, copies `dist/` into'
      + ' `~/.rafa/runtime/<version>/` with the version from `package.json`, and links `~/.rafa/bin/rafa` at'
      + ' the copied `cli.js`, the directory and the link landing by a rename so a loop running from that'
      + ' runtime never meets a torn file. It refuses with exit code 1, before building, while a loop of the'
      + ' project is live, naming each loop\'s branch and pid, unless `dangerous.selfUpdateDuringLoop` is true;'
      + ' `--force` does not override that wait. A plan tracker in `plan.dir` holding an open or blocked task'
      + ' holds the install back only while a loop is live: with none live it warns once, naming each such'
      + ' tracker, and installs; with that key true and a loop live it refuses with exit code 1, naming each'
      + ' one, unless `--force` is on the line. It refuses with exit code 1 too while that runtime directory is'
      + ' already there, naming it and the version: a version is installed once, and `--force` replaces the'
      + ' directory whole. It exits 2 when it could not run: a session record it cannot read, a'
      + ' `package.json` that is not rafa\'s, a config or tracker it cannot read, or a build, copy or link'
      + ' that failed. It warns when `~/.rafa/bin` is not on PATH ahead of `~/.bun/bin`. With'
      + ' `--output=json` the installed paths are the data of the terminal result event.',
    args: [],
    flags: [
      {
        name: 'force',
        description: 'Replace a `~/.rafa/runtime/<version>/` already there, whole, instead of refusing it, and'
          + ' install beside a plan tracker holding a task while a loop is live.',
        type: 'boolean',
      },
    ],
    examples: [
      {
        cmd: 'rafa self-update',
        note: 'Builds the checkout and points `~/.rafa/bin/rafa` at the copy, once no loop of the project is live.',
      },
      {
        cmd: 'rafa self-update --force',
        note: 'Installs over the runtime this version is already installed as, replacing that directory whole.',
      },
    ],
    outputs: ['text', 'json'],
    run: async (context) => runSelfUpdate(context, seams),
  };
  return Object.freeze(command);
}

const command: RafaCommand = createSelfUpdateCommand();
export default command;
