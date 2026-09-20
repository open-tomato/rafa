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
 * tracker there has an open or blocked task, refuses while
 * `~/.rafa/runtime/<version>/` is already there, runs `bun run build`,
 * copies `dist/` into that directory and links `~/.rafa/bin/rafa` at the
 * copied `cli.js`. The home is the project's, the dispatcher's.
 * Each step is an `info` line. The build's output is read, not handed
 * the streams, and written once it ends: its stdout at `info` and its
 * stderr at `warn`, so json mode's stdout stays NDJSON. The build runs
 * under `bun run --silent`, so a clean one writes no `warn` line
 * (`runBuild`).
 *
 * ## `--force`
 *
 * A version is installed once: the second install under the same version
 * would swap the runner under a loop running from that directory, so it
 * is refused. `--force` installs anyway, replacing the directory whole,
 * so nothing the old build left is kept. The flag is a boolean, and a
 * value other than `true` or `false` is refused with exit code 1. `bun
 * run snapshot --force` does the same from a checkout.
 *
 * After an install it warns when `~/.rafa/bin` is not on the context's
 * `PATH` ahead of `~/.bun/bin` (`project/bin-path.ts`): the link is in
 * place, and a `rafa` found first in `~/.bun/bin` would still run. A
 * warning never changes the exit code.
 *
 * ## The exit code
 *
 * 0 installed. 1 for a positional word, for a `--force` value that is
 * neither `true` nor `false`, for a tracker with a task left, the
 * refusal naming each tracker, its line and its task, and for a runtime
 * directory already there without `--force`, the refusal naming the
 * directory and the version. 2 when it
 * could not run: a `package.json` that cannot be read, names another
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
 */
import type { RafaCommand, RafaContext } from '../cli/command.js';
import type { BinPathReading } from '../project/bin-path.js';
import type { ProjectFound } from '../project/scope.js';
import type { BuildLines } from '../runtime/install.js';

import { CommandExit } from '../cli/command.js';
import { readBinPath } from '../project/bin-path.js';
import { exitCodeFor, installRuntime, outcomeProblem, runBuild } from '../runtime/install.js';

import { expectNoArgument } from './plan/plan-files.js';

/** How the build runs; see the module note. */
export interface SelfUpdateSeams {
  /** Builds the checkout into its `dist/`, handing its output lines to `lines`, and answers its exit code. */
  readonly build: (repoRoot: string, lines: BuildLines) => number;
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

function projectOf(context: RafaContext): ProjectFound {
  if (context.project === null) throw new Error('rafa self-update runs inside a project, and was handed none');
  return context.project;
}

async function runSelfUpdate(context: RafaContext, seams: SelfUpdateSeams): Promise<void> {
  expectNoArgument(context.args, USAGE);
  const force = readForceFlag(context.flags['force']);
  const project = projectOf(context);
  const info = (line: string): void => context.output.info(line);
  const warn = (line: string): void => context.output.warn(line);
  const outcome = installRuntime({
    repoRoot: project.root,
    home: project.home,
    build: (repoRoot) => seams.build(repoRoot, { info, warn }),
    log: info,
    warn,
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
      + ' runtime never meets a torn file. It refuses with exit code 1, before building, while a plan tracker'
      + ' in `plan.dir` holds an open or blocked task, naming each one, and while that runtime directory is'
      + ' already there, naming it and the version: a version is installed once, and `--force` replaces the'
      + ' directory whole. It exits 2 when it could not run: a'
      + ' `package.json` that is not rafa\'s, a config or tracker it cannot read, or a build, copy or link'
      + ' that failed. It warns when `~/.rafa/bin` is not on PATH ahead of `~/.bun/bin`. With'
      + ' `--output=json` the installed paths are the data of the terminal result event.',
    args: [],
    flags: [
      {
        name: 'force',
        description: 'Replace a `~/.rafa/runtime/<version>/` already there, whole, instead of refusing it.',
        type: 'boolean',
      },
    ],
    examples: [
      {
        cmd: 'rafa self-update',
        note: 'Builds the checkout and points `~/.rafa/bin/rafa` at the copy, once every plan is finished.',
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

export default createSelfUpdateCommand();
