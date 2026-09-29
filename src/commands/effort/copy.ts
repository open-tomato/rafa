/**
 * `rafa effort copy [--to=<dir>]`: the project's effort store copied
 * into a directory of its own by `copyEffortStore`
 * (`src/effort/store/copy.ts`, whose note says how each file is copied),
 * so branch code can run over real data with `RAFA_EFFORT_DIR` pointing
 * at the copy. Starts no Claude session and declares no `spends`.
 *
 * The store copied is always `<root>/.rafa/effort/`. The copy lands in
 * `--to`, resolved against the project root when relative, or in
 * `<root>/.rafa/scratch/effort-<stamp>/` by default, the stamp read off
 * the clock as `fix-schema`'s `fileStamp` spells it. The command prints
 * the directory and the `RAFA_EFFORT_DIR=` line to put in front of each
 * command that should use it.
 *
 * It plans no schema and opens the SQLite file read-only, so a
 * development build may run it over the live store, and a loop running
 * beside it is not disturbed.
 *
 * Exit code 0 when the store was copied. Exit code 1, with nothing made,
 * when `RAFA_EFFORT_DIR` is set (the copy is taken from the project's own
 * store, never from another copy), when `.rafa/effort/` holds no store
 * file, and when the target is a file or a directory holding anything.
 * Exit code 2 when a read or a write failed, with what the copy made
 * removed. In json mode the `EffortCopyResult`, with its `env` line, is
 * the data of the terminal result.
 */
import type { RafaCommand, RafaContext } from '../../cli/command.js';
import type { EffortCopyResult } from '../../effort/store/copy.js';

import { join, resolve } from 'node:path';

import { CommandExit } from '../../cli/command.js';
import { copyEffortStore, EffortCopyFailure, EffortCopyRefusal } from '../../effort/store/copy.js';
import { EFFORT_DIR_VARIABLE } from '../../effort/store/location.js';
import { EFFORT_STORE_DIR } from '../../effort/store.js';
import { expectNoArgument, requireProject } from '../plan/plan-files.js';

import { fileStamp } from './fix-schema.js';

/** The command's spelling, as its refusals name it. */
const COMMAND_NAME = 'rafa effort copy';

/** The line the refusals end with. */
export const COPY_USAGE = 'rafa effort copy [--to=<dir>]';

const TO_FLAG = 'to';

/** The exit code of a copy never started. */
const REFUSED_EXIT = 1;

/** The exit code of a read or a write that failed. */
const FAILED_EXIT = 2;

/** Where a default copy lands, under the project root. */
const SCRATCH_DIR = join('.rafa', 'scratch');

/** What a test replaces. */
export interface CopyCommandSeams {
  /** The clock the default directory is stamped from. */
  readonly now?: () => Date;
}

/** The line that points one command at `directory`. */
export function effortDirLine(directory: string): string {
  return `${EFFORT_DIR_VARIABLE}=${directory}`;
}

/** The directory `--to` names, resolved against `root`, or null when the line leaves it out. */
function readTarget(context: RafaContext, root: string): string | null {
  const value = context.flags[TO_FLAG];
  if (value === undefined) return null;
  if (typeof value !== 'string' || value === '') {
    throw new CommandExit(REFUSED_EXIT, `❌ --${TO_FLAG} takes a directory: --${TO_FLAG}=<dir>\nUsage: ${COPY_USAGE}`);
  }
  return resolve(root, value);
}

/** Refuses while `RAFA_EFFORT_DIR` names a store: a copy is taken from the project's own. */
function refuseEffortDirOverride(context: RafaContext): void {
  const value = context.env[EFFORT_DIR_VARIABLE];
  if (value === undefined || value === '') return;
  throw new CommandExit(
    REFUSED_EXIT,
    `❌ ${COMMAND_NAME}: ${EFFORT_DIR_VARIABLE} is set (${value}); a copy is taken from the project's own store.`
      + ` Nothing was copied. Unset it and run again: ${EFFORT_DIR_VARIABLE}= ${COMMAND_NAME}`,
  );
}

/** Every line one copy prints. */
export function renderCopy(result: EffortCopyResult): string[] {
  return [
    `✅ Copied ${result.files.join(', ')} from ${result.source} to ${result.directory}.`,
    'Put this in front of each command that should use the copy, on the same line:',
    effortDirLine(result.directory),
  ];
}

/** Runs one invocation. See the module note. */
export function runCopy(context: RafaContext, seams: CopyCommandSeams): void {
  expectNoArgument(context.args, COPY_USAGE);
  const root = requireProject(context, COMMAND_NAME).root;
  const named = readTarget(context, root);
  refuseEffortDirOverride(context);
  const target = named ?? join(root, SCRATCH_DIR, `effort-${fileStamp((seams.now ?? ((): Date => new Date()))())}`);

  let result: EffortCopyResult;
  try {
    result = copyEffortStore({ source: join(root, EFFORT_STORE_DIR), target });
  } catch (error) {
    if (error instanceof EffortCopyRefusal) throw new CommandExit(REFUSED_EXIT, `❌ ${COMMAND_NAME}: ${error.message}`);
    if (error instanceof EffortCopyFailure) throw new CommandExit(FAILED_EXIT, `❌ ${COMMAND_NAME}: ${error.message}`);
    throw error;
  }

  if (context.outputMode === 'json') {
    context.output.result({ ...result, env: effortDirLine(result.directory) });
    return;
  }
  for (const line of renderCopy(result)) context.output.info(line);
}

/** The command, reading `seams`; see the module note. */
export function createCopyCommand(seams: CopyCommandSeams = {}): RafaCommand {
  const command: RafaCommand = {
    name: 'effort copy',
    subject: 'effort',
    action: 'copy',
    summary: 'copy the effort store into a scratch directory and print the RAFA_EFFORT_DIR= line that points a command at it',
    description: 'Copies `.rafa/effort/` into a directory of its own: the SQLite file through `VACUUM INTO`, which only'
      + ' reads the store and keeps its schema version and migration log, and the NDJSON files by file copy. The'
      + ' copy lands in `--to`, or in `.rafa/scratch/effort-<stamp>/`. It prints the directory and the'
      + ' `RAFA_EFFORT_DIR=` line to put in front of each command that should run over the copy instead of the'
      + ' live store. It plans no schema, so a development build may run it and a running loop is not disturbed.'
      + ' Exit code 1, making nothing, when `RAFA_EFFORT_DIR` is set, when there is no store, or when the target'
      + ' is not empty; exit code 2 when a read or write failed, with what it made removed. With `--output=json`'
      + ' the copy is the data of the terminal result event. Starts no session.',
    args: [],
    flags: [
      {
        name: TO_FLAG,
        description: 'The directory to copy into, absent or empty; a relative one is read from the project root.'
          + ' Defaults to `.rafa/scratch/effort-<stamp>/`.',
        type: 'string',
      },
    ],
    examples: [
      {
        cmd: 'rafa effort copy',
        note: 'Copies the store into `.rafa/scratch/effort-<stamp>/` and prints the `RAFA_EFFORT_DIR=` line.',
      },
      {
        cmd: 'rafa effort copy --to=.rafa/scratch/rafa-234-effort',
        note: 'Copies the store into a directory a plan names.',
      },
    ],
    outputs: ['text', 'json'],
    run: async (context) => {
      runCopy(context, seams);
      await Promise.resolve();
    },
  };
  return Object.freeze(command);
}

export default createCopyCommand();
