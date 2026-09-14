/**
 * Builds the context a command runs with, from the words of its line and
 * the environment.
 *
 * Copied from open-tomato's
 * `packages/shared/cli-core/src/assembleContext.ts` at commit
 * `2c5bba9fd4de00641f947e0919f0c3eaa52709f9` (2026-06-25). `types.ts`
 * beside this module says why the package is copied.
 *
 * ## What the context holds
 *
 * The source's resolution, unchanged but for the names it reads. The
 * output mode is `forceOutputMode` when one is handed; else `json` when
 * `--output` carries the value `json`, and `text` when it carries any
 * other; else `json` when `RAFA_OUTPUT` reads exactly `json`; else
 * `text`. A bare `--output` carries no value and falls through to the
 * environment.
 *
 * The verbosity is the number `--verbose` or `-v` carries; else the count
 * of bare `-v` and `--verbose` tokens ahead of any `--`; else
 * `RAFA_VERBOSITY` read as a number; else 0, each clamped to 0 through 3.
 * A `-v` followed by a word takes the word as its value, as any flag
 * does: under `-v plan` the verbosity falls through to the environment,
 * since `plan` is not a number, and `plan` is not a positional word.
 *
 * `args`, `flags` and `env` are frozen, `env` as a copy of the object
 * handed in, and so is the context. The signal is the one handed in, or
 * one nothing aborts.
 *
 * ## What the copy changes
 *
 * `RAFA_OUTPUT` and `RAFA_VERBOSITY` are read where the source reads
 * `TOMATO_OUTPUT` and `TOMATO_VERBOSITY`, and the tomato names are not
 * read at all.
 *
 * The output is made by rafa's `text` and `json` adapters in
 * `src/adapters/output/`, whose notes say where each renders differently
 * from the source. The stream defaults to `process.stdout` itself, as
 * `src/adapters/registry.ts` defaults it, where the source wraps its
 * `write` in a stream of its own.
 *
 * `spec`, a command's `args` and `flags`, is handed to `parseArgs`, so
 * `args` and `flags` carry its defaults and read its aliases, and a spec
 * `parseArgs` refuses throws its `TypeError` from here. The output mode
 * and the verbosity are read from a second parse of the same line, one
 * that reads the spec's aliases and fills no default. A default is not
 * typed on the line, and one declared for `output` or `verbose` would
 * otherwise stand in front of `RAFA_OUTPUT` or `RAFA_VERBOSITY`. An alias
 * is typed, so `-o json` selects json mode under a spec declaring `o` for
 * `output`. Only `-v` and `--verbose` are counted as bare tokens, whatever
 * the spec declares.
 */
import type { ParseArgsSpec } from './parseArgs.js';
import type { CliContext, FlagSpec } from './types.js';
import type { OutputStream } from '../../adapters/output/stream.js';
import type { Output } from '../../ports/index.js';

import { createJsonOutput } from '../../adapters/output/json.js';
import { createTextOutput } from '../../adapters/output/text.js';

import { parseArgs } from './parseArgs.js';

/** The environment variable selecting json mode when it reads `json`. */
const OUTPUT_ENV = 'RAFA_OUTPUT';

/** The environment variable read as the verbosity when no flag sets one. */
const VERBOSITY_ENV = 'RAFA_VERBOSITY';

/** Flags by name, as `parseArgs` answers them. */
type Flags = Readonly<Record<string, string | boolean>>;

/** An environment by variable name. */
type Env = Readonly<Record<string, string | undefined>>;

/** What {@link assembleContext} builds a context from. */
export interface AssembleContextOptions {
  /** The words of the line the command runs with. */
  argv: readonly string[];
  /** The environment the output mode and the verbosity fall back to, copied into the context. */
  env: Env;
  /** An output mode winning over the line and the environment. */
  forceOutputMode?: 'text' | 'json';
  /** The signal that stops the command. Defaults to one nothing aborts. */
  signal?: AbortSignal;
  /** Where the output writes. Defaults to `process.stdout`. */
  stream?: OutputStream;
  /** The command's `args` and `flags`, whose defaults and aliases `parseArgs` applies. Defaults to none. */
  spec?: ParseArgsSpec;
}

const clampVerbosity = (value: number): 0 | 1 | 2 | 3 => {
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }
  if (value >= 3) {
    return 3;
  }
  if (value >= 2) {
    return 2;
  }
  return 1;
};

const countVerboseTokens = (argv: readonly string[]): number => {
  let count = 0;
  for (const arg of argv) {
    if (arg === '--') {
      break;
    }
    if (arg === '-v' || arg === '--verbose') {
      count++;
    }
  }
  return count;
};

const resolveOutputMode = (force: 'text' | 'json' | undefined, flags: Flags, env: Env): 'text' | 'json' => {
  if (force !== undefined) {
    return force;
  }
  const flagOutput = flags.output;
  if (typeof flagOutput === 'string') {
    return flagOutput === 'json'
      ? 'json'
      : 'text';
  }
  if (env[OUTPUT_ENV] === 'json') {
    return 'json';
  }
  return 'text';
};

const resolveVerbosity = (argv: readonly string[], flags: Flags, env: Env): 0 | 1 | 2 | 3 => {
  const flagValue = flags.verbose ?? flags.v;
  if (typeof flagValue === 'string') {
    const parsed = Number.parseInt(flagValue, 10);
    if (!Number.isNaN(parsed)) {
      return clampVerbosity(parsed);
    }
  }
  if (flagValue === true) {
    const count = countVerboseTokens(argv);
    if (count > 0) {
      return clampVerbosity(count);
    }
  }
  const envValue = env[VERBOSITY_ENV];
  if (envValue !== undefined) {
    const parsed = Number.parseInt(envValue, 10);
    if (!Number.isNaN(parsed)) {
      return clampVerbosity(parsed);
    }
  }
  return 0;
};

/** A spec's flags with no default, so a parse under them reads only what the line typed. */
function typedOnly(flags: readonly FlagSpec[] = []): FlagSpec[] {
  return flags.map((flag) => ({ ...flag, default: undefined }));
}

/**
 * Builds and freezes the context a command runs with. Throws the
 * `TypeError` `parseArgs` refuses a spec with.
 */
export function assembleContext(options: AssembleContextOptions): CliContext {
  const { argv, env, forceOutputMode, signal, stream = process.stdout, spec = {} } = options;
  const { positional, flags } = parseArgs(argv, spec);
  const typed = parseArgs(argv, { flags: typedOnly(spec.flags) }).flags;
  const outputMode = resolveOutputMode(forceOutputMode, typed, env);
  const verbosity = resolveVerbosity(argv, typed, env);
  const output: Output = outputMode === 'json'
    ? createJsonOutput({ stream })
    : createTextOutput({ verbosity, stream });

  return Object.freeze({
    args: Object.freeze(positional),
    flags: Object.freeze(flags),
    outputMode,
    verbosity,
    output,
    signal: signal ?? new AbortController().signal,
    env: Object.freeze({ ...env }),
  });
}
