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
import type { OutputMode } from '../../config-sections.js';
import type { Output } from '../../ports/index.js';

import { createEventsOutput } from '../../adapters/output/events.js';
import { createJsonOutput } from '../../adapters/output/json.js';
import { createTextOutput } from '../../adapters/output/text.js';
import { OUTPUT_MODES } from '../../config-sections.js';

import { parseArgs } from './parseArgs.js';

/** The environment variable naming the output mode: `json`, or `events` for a command that declares it. */
const OUTPUT_ENV = 'RAFA_OUTPUT';

/** The output modes a flag or the environment may name; any other value reads as text. */
const NAMED_MODES: ReadonlySet<string> = new Set(OUTPUT_MODES);

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
  forceOutputMode?: OutputMode;
  /** Whether the command declares `events` among its outputs; without it, `events` reads as text. */
  eventsAllowed?: boolean;
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

/** The mode a value names, or text for one naming none. */
const modeNamed = (value: string | undefined): OutputMode => value !== undefined && NAMED_MODES.has(value)
  ? value as OutputMode
  : 'text';

const resolveOutputMode = (force: OutputMode | undefined, flags: Flags, env: Env, eventsAllowed: boolean): OutputMode => {
  if (force !== undefined) {
    return force;
  }
  const flagOutput = flags.output;
  const mode = typeof flagOutput === 'string'
    ? modeNamed(flagOutput)
    : modeNamed(env[OUTPUT_ENV]);
  return mode === 'events' && !eventsAllowed
    ? 'text'
    : mode;
};

/** The adapter a mode writes through. */
function outputFor(mode: OutputMode, verbosity: 0 | 1 | 2 | 3, stream: OutputStream): Output {
  switch (mode) {
    case 'json':
      return createJsonOutput({ stream });
    case 'events':
      return createEventsOutput({ stream });
    case 'text':
      return createTextOutput({ verbosity, stream });
  }
}

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
  const { argv, env, forceOutputMode, eventsAllowed = false, signal, stream = process.stdout, spec = {} } = options;
  const { positional, flags } = parseArgs(argv, spec);
  const typed = parseArgs(argv, { flags: typedOnly(spec.flags) }).flags;
  const outputMode = resolveOutputMode(forceOutputMode, typed, env, eventsAllowed);
  const verbosity = resolveVerbosity(argv, typed, env);
  const output = outputFor(outputMode, verbosity, stream);

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
