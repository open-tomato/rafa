/**
 * `rafa effort move --to=sqlite`: a `store: ndjson` project's sessions
 * and commits appended to its SQLite store through the port, the counts
 * checked, and `store: sqlite` set in `.rafa/config.yaml`, by
 * `moveToSqlite` (`src/effort/store/move.ts`, whose note is the long
 * form). Starts no Claude session and declares no `spends`.
 *
 * Both sides are the ones every other command would open: under
 * `RAFA_EFFORT_DIR` when it is set, and `<root>/.rafa/effort/` otherwise.
 * The NDJSON files are only read and are left where they are. A move run
 * again adds nothing and changes no config byte, so it is safe to repeat
 * after a loop that started before the move has ended.
 *
 * `--to` is required and `sqlite` is the one value it takes; any other,
 * or none, is refused with exit code 1 before anything is read. So is a
 * config `loadConfig` refuses, one spelling `store` in a shape the edit
 * does not cover, a count check that fails (the config is then left as
 * it was), a schema this rafa will not write, and a development build
 * over a store it does not own. Exit code 0 otherwise. In json mode the
 * `MoveResult` is the data of the terminal result.
 */
import type { RafaCommand, RafaContext } from '../../cli/command.js';
import type { KindMove, MoveResult } from '../../effort/store/move.js';

import { CommandExit } from '../../cli/command.js';
import { messageOf } from '../../config-sections.js';
import { SchemaRefusedError } from '../../effort/store/bring-forward.js';
import { DevelopmentBuildRefusedError } from '../../effort/store/development-build.js';
import { effortStoreDir } from '../../effort/store/location.js';
import { MOVE_TO_SQLITE } from '../../effort/store/merge-store.js';
import { MOVE_TARGET, MoveRefusal, moveToSqlite } from '../../effort/store/move.js';
import { expectNoArgument, requireProject, resolveProjectConfig } from '../plan/plan-files.js';

/** The command's spelling, as its refusals name it. */
const COMMAND_NAME = 'rafa effort move';

/** The line the refusals end with: the step `rafa effort merge` names for a `store: ndjson` project. */
export const MOVE_USAGE = MOVE_TO_SQLITE;

const TO_FLAG = 'to';

/** The exit code of every refusal. */
const REFUSED_EXIT = 1;

/** Refuses a line whose `--to` is anything but `sqlite`, naming what it held. */
function readTarget(context: RafaContext): void {
  const value = context.flags[TO_FLAG];
  if (value === MOVE_TARGET) return;
  const found = value === undefined
    ? 'no --to'
    : `--${TO_FLAG}=${String(value)}`;
  throw new CommandExit(
    REFUSED_EXIT,
    `❌ ${COMMAND_NAME}: ${found}; a move writes to ${MOVE_TARGET} and nothing else. Nothing was moved.\nUsage: ${MOVE_USAGE}`,
  );
}

/** One kind's line. */
function kindLine(move: KindMove): string {
  const extra = [
    ...(move.unkeyed === 0
      ? []
      : [`${String(move.unkeyed)} without a key, not moved`]),
    ...(move.unparsed === 0
      ? []
      : [`${String(move.unparsed)} unparsed lines, not moved`]),
  ];
  const counts = [`${String(move.read)} read`, `${String(move.added)} added`, `${String(move.skipped)} already held`, ...extra];
  return `  ${move.kind}: ${counts.join(', ')} (from ${move.from})`;
}

/** Every line one move prints. */
export function renderMove(result: MoveResult): string[] {
  const config = result.configChanged
    ? `✅ Set store: ${MOVE_TARGET} in ${result.configPath}.`
    : `✅ ${result.configPath} already reads store: ${MOVE_TARGET}; left as it was.`;
  return [
    `Moves the NDJSON sessions and commits into ${result.to}.`,
    ...result.kinds.map(kindLine),
    'Checked: the SQLite store holds every key read, and its count is the old count plus the rows added.',
    config,
    'The NDJSON files are left where they are; running the move again adds nothing.',
  ];
}

/** The exit a move's error is answered with, or null for one this command does not know. */
function refusalExit(error: unknown): CommandExit | null {
  const known = error instanceof MoveRefusal
    || error instanceof SchemaRefusedError
    || error instanceof DevelopmentBuildRefusedError;
  return known
    ? new CommandExit(REFUSED_EXIT, `❌ ${COMMAND_NAME}: ${error.message}`)
    : null;
}

/** Runs one invocation. See the module note. */
export function runMove(context: RafaContext): void {
  expectNoArgument(context.args, MOVE_USAGE);
  readTarget(context);
  const project = requireProject(context, COMMAND_NAME);
  resolveProjectConfig(project, COMMAND_NAME, (message) => context.output.warn(message));
  try {
    effortStoreDir(project.root, context.env);
  } catch (error) {
    throw new CommandExit(REFUSED_EXIT, `❌ ${COMMAND_NAME}: ${messageOf(error)}`);
  }

  let result: MoveResult;
  try {
    result = moveToSqlite({ root: project.root });
  } catch (error) {
    throw refusalExit(error) ?? error;
  }

  if (context.outputMode === 'json') {
    context.output.result(result);
    return;
  }
  for (const line of renderMove(result)) context.output.info(line);
}

/** The command; see the module note. */
export function createMoveCommand(): RafaCommand {
  const command: RafaCommand = {
    name: 'effort move',
    subject: 'effort',
    action: 'move',
    summary: 'move a store: ndjson project\'s sessions and commits into the SQLite store and switch to it',
    description: 'Appends every session and commit row the NDJSON files under `.rafa/effort/`, or under'
      + ' `RAFA_EFFORT_DIR`, hold to the SQLite store beside them, through the store port, so each row is'
      + ' deduplicated by its key as `rafa effort collect` would. It then checks that the SQLite store holds'
      + ' every key read and that its count is the old count plus the rows added, and only then sets'
      + ' `store: sqlite` in `.rafa/config.yaml`, keeping every other line. The NDJSON files are left where'
      + ' they are, and a move run again adds nothing, so it can be repeated once a loop started before it'
      + ' has ended. Exit code 1, with nothing moved, for a `--to` other than `sqlite`, a config it cannot'
      + ' edit, and a development build over a store it does not own; a failed count check is exit code 1'
      + ' with the config left as it was. With `--output=json` the outcome is the data of the terminal'
      + ' result event. Starts no session.',
    args: [],
    flags: [
      {
        name: TO_FLAG,
        description: 'The store to move to; `sqlite` is the one value it takes, and it is required.',
        type: 'string',
      },
    ],
    examples: [
      {
        cmd: MOVE_USAGE,
        note: 'Moves the NDJSON rows into the SQLite store, checks the counts and sets store: sqlite.',
      },
    ],
    outputs: ['text', 'json'],
    run: async (context) => {
      runMove(context);
      await Promise.resolve();
    },
  };
  return Object.freeze(command);
}

export default createMoveCommand();
