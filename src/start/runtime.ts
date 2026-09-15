/**
 * `--runtime=<path|version>`: the installed rafa a `loop start` run runs
 * from.
 *
 * The loop edits the code it runs from, so a plan in a rafa checkout runs
 * from an installed copy and never from the checkout's `src/`
 * (`.specs/rafa-roadmap.md`). `start()` hands its words to
 * {@link runFromSelectedRuntime} right after the detached refusal and
 * before anything else is read, so a run that goes elsewhere loads no
 * config, waits for no `--start-at` and writes no session record here:
 * the runtime it goes to does all of that itself.
 *
 * ## What the value names
 *
 *   - **A version**, shaped as semver (`0.1.0`, `1.2.3-rc.1`): the
 *     `cli.js` of `~/.rafa/runtime/<version>/`, where
 *     `scripts/snapshot-runtime.ts` copies a build. The home is `HOME`'s.
 *   - **A path**, anything else: resolved against the working directory,
 *     as the shell it was typed in reads it. A directory names the
 *     `cli.js` it holds, and a file names itself.
 *
 * The runtime is that file with every link resolved.
 *
 * ## The refusals
 *
 * Each throws `CommandExit` (`cli/command.ts`) with exit code 1 and the
 * whole refusal as its message, ending with
 * `Nothing was checked and nothing was dispatched.`:
 *
 *   - `--runtime` with no value, bare or empty.
 *   - A version with no `cli.js` installed, naming the versions that are.
 *   - A path that is neither a file nor a directory holding `cli.js`.
 *   - **A runtime inside `src/`** of the working directory or of the
 *     project root, whether the path as typed or the file its links
 *     resolve to sits there. The project root is checked beside the
 *     working directory because a run started from a subdirectory would
 *     otherwise reach the checkout's `src/` through `../src`. It is
 *     checked before the path is looked for, so a runtime there is
 *     refused whether it exists or not.
 *
 * {@link refuseMisplacedRuntime} refuses, in the command itself
 * (`commands/loop/start.ts`), a `--runtime` typed ahead of `loop start`:
 * the dispatcher reads it as a flag there, and it never reaches the words
 * `start()` reads, so the run would go on in this runtime as though none
 * had been named.
 *
 * ## Running there
 *
 * When this process's entry (`Bun.main`, which bun answers with its links
 * resolved) is that runtime, the run goes on here. Otherwise this bun runs
 * the runtime's `cli.js` in the working directory with the words `start`
 * and the run's own words, every `--runtime` word left out, and waits for
 * it. `start` rather than `loop start`: the `0.1.0` runtime predates the
 * command tree and its switch reads `start` alone, while every runtime
 * since reads `start` as the alias of `loop start`, after one deprecation
 * line on its stderr. The child's environment is this one with
 * `RAFA_OUTPUT` set to this invocation's mode, since `--output` is never
 * among the words a wrapped command is handed (`commands/wrap.ts`).
 *
 *   - **text**: the child's streams are this process's, so its bytes reach
 *     the terminal as it writes them. Exit code 0 is a success; any other
 *     is thrown as `CommandExit` with that code and no message, the child
 *     having written its own.
 *   - **json**: the child's stdout is read line by line
 *     ({@link forwardLine}). Its `step` and `log` events are emitted
 *     through the active output as they arrive, its `start` event is
 *     dropped, since this invocation wrote its own, and its terminal
 *     result is read rather than written: a failed one, or a nonzero exit
 *     code, is thrown as `CommandExit` carrying the child's code, or 1,
 *     and its message. A line that is no event is an `info` line.
 *
 * While the child runs, a SIGINT to this process does nothing: a
 * terminal's Ctrl-C reaches the child in the same process group, and
 * `rafa loop stop` signals the pid the child's own session record names.
 * Ending here instead would leave the child running with no one waiting.
 *
 * Every line goes through the active output (`adapters/output/active.ts`).
 */
import type { OutputMode } from '../config-sections.js';
import type { CliEvent, CliEventResult, Output } from '../ports/index.js';

import { existsSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

import { activeOutput, activeOutputMode } from '../adapters/output/active.js';
import { CommandExit } from '../cli/command.js';
import { messageOf } from '../config-sections.js';

import { argValue } from './run-config.js';
import { NOTHING_DISPATCHED } from './session.js';

/** The flag naming the runtime. */
const RUNTIME_FLAG = '--runtime';

/** Where versions sit under the home: `~/.rafa/runtime/<version>/`. */
export const RUNTIME_SUBDIR = join('.rafa', 'runtime');

/** A runtime's entry, in a version's directory and in a directory a path names. */
export const RUNTIME_ENTRY = 'cli.js';

/** The source directory no runtime may sit in, under the working directory and the project root. */
export const SOURCE_DIR = 'src';

/** The words a runtime is run with ahead of the run's own; see the module note. */
export const RUNTIME_COMMAND: readonly string[] = ['start'];

/**
 * A value read as a version: semver's shape, opening with a digit and
 * holding no separator, so it names one directory under the runtime root.
 */
const VERSION_SHAPE = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.+-]+)?$/;

/** How to spell the flag, as every refusal about its value says. */
const SPELLING = '`--runtime=<version>` for a build under `~/.rafa/runtime/`, or `--runtime=<path>` for a `cli.js` or the directory holding it';

/**
 * The raw `--runtime` value: undefined without the flag, and the empty
 * string for a bare `--runtime`, which is refused rather than read as no
 * flag, as `--inject` is (`start/run-config.ts`).
 */
export function runtimeFlagValue(args: readonly string[]): string | undefined {
  return args.includes(RUNTIME_FLAG)
    ? ''
    : argValue(args, RUNTIME_FLAG);
}

/** A fresh copy of `args` without any `--runtime` word, bare or valued. */
export function withoutRuntimeFlag(args: readonly string[]): string[] {
  return args.filter((word) => word !== RUNTIME_FLAG && !word.startsWith(`${RUNTIME_FLAG}=`));
}

/**
 * Throws `CommandExit` with exit code 1 when the dispatcher read a
 * `runtime` flag that none of `argv`'s words carries as `start()` reads
 * it; see the module note.
 */
export function refuseMisplacedRuntime(flags: Readonly<Record<string, unknown>>, argv: readonly string[]): void {
  if (flags['runtime'] === undefined) return;
  if (argv.some((word) => word === RUNTIME_FLAG || word.startsWith(`${RUNTIME_FLAG}=`))) return;
  throw refusal([
    '❌ Refusing to start: `--runtime` reaches the loop only typed after `loop start`, as `rafa loop start --runtime=<path|version>`.',
    '   Typed ahead of the subject, or with one dash, the run would go on in this runtime as though none were named.',
  ]);
}

/** Where a runtime is looked for, and what it may not sit in. */
export interface RuntimePlaces {
  /** The directory a path is resolved against; its `src/` is refused. */
  readonly cwd: string;
  /** The project root; its `src/` is refused too. */
  readonly root: string;
  /** The home `~/.rafa/runtime/` sits under. */
  readonly home: string;
}

/**
 * The runtime `value` names, as its `cli.js` with every link resolved, or
 * a `CommandExit` refusal; see the module note.
 */
export function resolveRuntime(value: string, places: RuntimePlaces): string {
  if (value.trim() === '') {
    throw refusal([`❌ Refusing to start: \`--runtime\` names no runtime. Spell it ${SPELLING}.`]);
  }
  const isVersion = VERSION_SHAPE.test(value);
  const named = isVersion
    ? join(places.home, RUNTIME_SUBDIR, value, RUNTIME_ENTRY)
    : resolve(places.cwd, value);
  refuseInsideSource(value, named, places);

  const entry = entryOf(value, named, isVersion, places.home);
  const real = realpathSync(entry);
  refuseInsideSource(value, real, places);
  return real;
}

/** The file `named` stands for: itself, or the `cli.js` of the directory it is. */
function entryOf(value: string, named: string, isVersion: boolean, home: string): string {
  if (isVersion) {
    if (isFile(named)) return named;
    const root = join(home, RUNTIME_SUBDIR);
    const installed = installedVersions(root);
    throw refusal([
      `❌ Refusing to start: \`--runtime=${value}\` names no installed runtime: ${named} is no file.`,
      installed.length === 0
        ? `   ${root} holds no version.`
        : `   ${root} holds ${installed.join(', ')}.`,
    ]);
  }
  if (isFile(named)) return named;
  const inside = join(named, RUNTIME_ENTRY);
  if (isDirectory(named) && isFile(inside)) return inside;
  throw refusal([
    `❌ Refusing to start: \`--runtime=${value}\` names no runtime: ${named} is neither a file nor a directory holding \`${RUNTIME_ENTRY}\`.`,
    `   Spell it ${SPELLING}.`,
  ]);
}

/** Throws the refusal when `path` sits inside the `src/` of the working directory or of the project root. */
function refuseInsideSource(value: string, path: string, places: RuntimePlaces): void {
  const hit = sourceDirs(places).find((dir) => isInside(path, dir));
  if (hit === undefined) return;
  throw refusal([
    `❌ Refusing to start: \`--runtime=${value}\` resolves to ${path}, inside ${hit}.`,
    '   The loop edits the source it would run from, so it runs from an installed copy: a version under `~/.rafa/runtime/`, or a built `cli.js` outside `src/`.',
  ]);
}

/** The `src/` directories of the working directory and the project root, each also with its links resolved. */
function sourceDirs({ cwd, root }: RuntimePlaces): string[] {
  const dirs = [join(cwd, SOURCE_DIR), join(root, SOURCE_DIR)];
  const real = dirs.filter((dir) => existsSync(dir)).map((dir) => realpathSync(dir));
  return [...new Set([...dirs, ...real])];
}

/** Whether `path` is `dir` or sits anywhere under it. */
export function isInside(path: string, dir: string): boolean {
  const rel = relative(dir, path);
  return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`));
}

/** The version directories under `root` holding a `cli.js`, sorted; none when `root` cannot be read. */
function installedVersions(root: string): string[] {
  try {
    return readdirSync(root)
      .filter((name) => isFile(join(root, name, RUNTIME_ENTRY)))
      .sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/** A refusal: exit code 1, the lines, and the closing line every `loop start` refusal before a session ends with. */
function refusal(lines: readonly string[]): CommandExit {
  return new CommandExit(1, [...lines, NOTHING_DISPATCHED].join('\n'));
}

/** What a run reads its runtime off. Each left out is the system's own. */
export interface RuntimeSeams {
  /** The words `start()` was handed. */
  readonly args: readonly string[];
  /** The project root. */
  readonly root: string;
  /** Defaults to `process.cwd()`. */
  readonly cwd?: string;
  /** Defaults to `homedir()`. */
  readonly home?: string;
  /** This process's entry. Defaults to `Bun.main`. */
  readonly currentEntry?: string;
  /** The bun a runtime is run with. Defaults to `process.execPath`. */
  readonly execPath?: string;
  /** The environment a runtime is run in, before `RAFA_OUTPUT`. Defaults to `process.env`. */
  readonly env?: Readonly<Record<string, string | undefined>>;
}

/**
 * Runs the loop from the runtime `--runtime` names, when it names one this
 * process is not; see the module note. Answers false when the run goes on
 * here: no flag, or this process is that runtime. Answers true once the
 * runtime ran and succeeded, and throws `CommandExit` when it refused or
 * failed, or when the flag is refused.
 */
export async function runFromSelectedRuntime(seams: RuntimeSeams): Promise<boolean> {
  const value = runtimeFlagValue(seams.args);
  if (value === undefined) return false;
  const cwd = seams.cwd ?? process.cwd();
  const entry = resolveRuntime(value, { cwd, root: seams.root, home: seams.home ?? homedir() });
  if (realOrResolved(seams.currentEntry ?? Bun.main) === entry) return false;

  const mode = activeOutputMode();
  activeOutput().info(`🔁 Running the loop from ${entry}, as \`--runtime=${value}\` names; this process waits for it.`);
  await runRuntime(entry, withoutRuntimeFlag(seams.args), {
    cwd,
    mode,
    execPath: seams.execPath ?? process.execPath,
    env: seams.env ?? process.env,
  });
  return true;
}

/** `path` with its links resolved, or as it resolves when it does not exist. */
function realOrResolved(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

/** How one runtime is run. */
interface RuntimeRun {
  readonly cwd: string;
  readonly mode: OutputMode;
  readonly execPath: string;
  readonly env: Readonly<Record<string, string | undefined>>;
}

/** Runs `entry` with the run's words and waits for it, throwing its failure; see the module note. */
async function runRuntime(entry: string, words: readonly string[], run: RuntimeRun): Promise<void> {
  const ignoreInterrupt = (): void => {};
  process.on('SIGINT', ignoreInterrupt);
  try {
    const child = Bun.spawn([run.execPath, entry, ...RUNTIME_COMMAND, ...words], {
      cwd: run.cwd,
      env: { ...run.env, RAFA_OUTPUT: run.mode },
      stdin: 'inherit',
      stdout: run.mode === 'json'
        ? 'pipe'
        : 'inherit',
      stderr: 'inherit',
    });
    const result = child.stdout instanceof ReadableStream
      ? await forwardStream(child.stdout, activeOutput())
      : null;
    const exitCode = await child.exited;
    throwFailure(entry, exitCode, run.mode, result);
  } catch (error) {
    if (error instanceof CommandExit) throw error;
    throw refusal([`❌ Could not run the loop from ${entry}: ${messageOf(error)}`]);
  } finally {
    process.off('SIGINT', ignoreInterrupt);
  }
}

/** Throws a runtime's failure as its `CommandExit`, and returns for its success; see the module note. */
export function throwFailure(entry: string, exitCode: number, mode: OutputMode, result: CliEventResult | null): void {
  const failed = result !== null && !result.ok;
  if (exitCode === 0 && !failed) return;
  const code = exitCode === 0
    ? 1
    : exitCode;
  if (mode !== 'json') throw new CommandExit(code);
  throw new CommandExit(code, result?.error?.message ?? `the loop run from ${entry} exited ${exitCode}`);
}

/** Reads `stream` line by line through {@link forwardLine}, answering the last result it held. */
async function forwardStream(stream: ReadableStream<Uint8Array>, output: Output): Promise<CliEventResult | null> {
  const decoder = new TextDecoder();
  let pending = '';
  let result: CliEventResult | null = null;
  for await (const chunk of stream) {
    const lines = (pending + decoder.decode(chunk, { stream: true })).split('\n');
    pending = lines.pop() ?? '';
    for (const line of lines) result = forwardLine(line, output) ?? result;
  }
  return forwardLine(pending + decoder.decode(), output) ?? result;
}

/**
 * One line of a json-mode runtime's stdout: a `step` or `log` event
 * emitted through `output`, a `start` event dropped, a `result` answered
 * and not written, a blank line dropped, and any other line written at
 * `info`. Answers the result, or null.
 */
export function forwardLine(line: string, output: Output): CliEventResult | null {
  if (line.trim() === '') return null;
  const event = eventOf(line);
  if (event === null) {
    output.info(line);
    return null;
  }
  if (event.type === 'result') return event;
  if (event.type !== 'start') output.emit(event);
  return null;
}

/** The event a line holds, or null when it holds none of the four kinds. */
function eventOf(line: string): CliEvent | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || !('type' in parsed) || !('ts' in parsed)) return null;
  const event = parsed as CliEvent;
  switch (event.type) {
    case 'start':
      return typeof event.command === 'string'
        ? event
        : null;
    case 'step':
      return typeof event.name === 'string'
        ? event
        : null;
    case 'log':
      return typeof event.message === 'string' && ['debug', 'info', 'warn', 'error'].includes(event.level)
        ? event
        : null;
    case 'result':
      return typeof event.ok === 'boolean'
        ? event
        : null;
    default:
      return null;
  }
}
