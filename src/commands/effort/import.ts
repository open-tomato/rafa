/**
 * `rafa effort import <file> [--dry-run]`: another device's effort store
 * file, the `effort.sqlite` a `rafa effort copy` carried, pulled into
 * this project's store through the `file` sync strategy
 * (`src/effort/sync/file.ts`), whose pull is `mergeStore`
 * (`src/effort/store/merge-store.ts`, whose note is the long form).
 * Starts no Claude session and declares no `spends`.
 *
 * It is the pull half of the `file` strategy put on the command line, and
 * `rafa effort merge` with the adapter between: the store merged into,
 * the files made beside it, what it prints and every exit code are that
 * command's. The rendering is `renderMerge`, the refusal mapping
 * `mergeRefusalExit` and the store's path `mergeTargetPath`, all three
 * taken from `merge.ts` rather than spelled again, each naming this
 * command. So a dry run's closing line names `rafa effort import`.
 *
 * It merges under every `effort.sync` strategy and never reads that
 * setting: the configured strategy is what `rafa doctor`, the loop
 * preflight and `describe` read, while a file handed on the command line
 * is a file exchange whatever the project carries its store by.
 *
 * This store is the one every other command would open: under
 * `RAFA_EFFORT_DIR` when it is set, and `<root>/.rafa/effort/effort.sqlite`
 * otherwise, read from the command's environment, which the adapter is
 * handed too. `<file>` is read against the directory the command runs
 * from and handed to the adapter absolute, since the adapter reads a
 * relative path against the repository root; it is only ever read.
 *
 * Exit code 2 when the other file is another project's store, and when
 * the project keeps its sessions and commits as NDJSON (`store: ndjson`),
 * that refusal naming `rafa effort move --to=sqlite`. Exit code 1 for
 * every other refusal, each changing no byte of either file. Exit code 0
 * otherwise. In json mode the `MergeResult` is the data of the terminal
 * result, as `rafa effort merge` writes it.
 */
import type { MergeCommandSeams } from './merge.js';
import type { RafaCommand, RafaContext } from '../../cli/command.js';
import type { MergeResult } from '../../effort/store/merge-store.js';
import type { FileSyncOptions } from '../../effort/sync/file.js';
import type { Sync } from '../../ports/index.js';

import { resolve } from 'node:path';

import { createFileSync } from '../../effort/sync/file.js';
import { expectOneArgument, readSwitch, requireProject, resolveProjectConfig } from '../plan/plan-files.js';

import { mergeRefusalExit, mergeTargetPath, renderMerge } from './merge.js';

/** The command's spelling, as its refusals name it. */
const COMMAND_NAME = 'rafa effort import';

/** The line the refusals end with. */
export const IMPORT_USAGE = 'rafa effort import <file> [--dry-run]';

const DRY_RUN_FLAG = 'dry-run';

/** What a test replaces: `rafa effort merge`'s seams, and the adapter pulled through. */
export interface ImportCommandSeams extends MergeCommandSeams {
  /** Makes the strategy the file is pulled through; `createFileSync` by default. */
  readonly createSync?: (options: FileSyncOptions) => Sync;
}

/** The `file` strategy's options: the project, its backend, and the seams a test set. */
function syncOptions(context: RafaContext, repoRoot: string, backend: FileSyncOptions['backend'], seams: ImportCommandSeams): FileSyncOptions {
  const optional: Partial<FileSyncOptions> = {
    now: seams.now,
    isAlive: seams.isAlive,
    identity: seams.identity,
    migrations: seams.migrations,
    newMergeId: seams.newMergeId,
    readProject: seams.readProject,
  };
  const set = Object.fromEntries(Object.entries(optional).filter(([, value]) => value !== undefined));
  return { ...set, repoRoot, backend, env: context.env };
}

/** Pulls `otherPath` through `sync`, answering the merge or the exit its refusal maps to. */
async function pull(sync: Sync, otherPath: string, dryRun: boolean): Promise<MergeResult> {
  let pulled;
  try {
    pulled = await sync.pull({ from: otherPath, dryRun });
  } catch (error) {
    throw mergeRefusalExit(error, COMMAND_NAME) ?? error;
  }
  if (pulled.status !== 'pulled') {
    throw new TypeError(`${COMMAND_NAME}: the ${sync.kind} strategy answered ${pulled.status}, expected a merge`);
  }
  return pulled.merge;
}

/** Runs one invocation. See the module note. */
export async function runImport(context: RafaContext, seams: ImportCommandSeams): Promise<void> {
  const file = expectOneArgument(context.args, IMPORT_USAGE);
  const dryRun = readSwitch(DRY_RUN_FLAG, context.flags[DRY_RUN_FLAG], `Usage: ${IMPORT_USAGE}`);
  const project = requireProject(context, COMMAND_NAME);
  mergeTargetPath(context, project.root, COMMAND_NAME);
  const backend = resolveProjectConfig(project, COMMAND_NAME, (message) => context.output.warn(message)).store;
  const otherPath = resolve((seams.cwd ?? ((): string => process.cwd()))(), file);
  const sync = (seams.createSync ?? createFileSync)(syncOptions(context, project.root, backend, seams));

  const result = await pull(sync, otherPath, dryRun);

  if (context.outputMode === 'json') {
    context.output.result(result);
    return;
  }
  for (const line of renderMerge(result, COMMAND_NAME)) context.output.info(line);
}

/** The command, reading `seams`; see the module note. */
export function createImportCommand(seams: ImportCommandSeams = {}): RafaCommand {
  const command: RafaCommand = {
    name: 'effort import',
    subject: 'effort',
    action: 'import',
    summary: 'import the effort store file another device carried, merging it in through the file sync strategy',
    description: 'Pulls another device\'s `effort.sqlite`, the one `rafa effort copy` makes, into'
      + ' `.rafa/effort/effort.sqlite`, or the store under `RAFA_EFFORT_DIR`, through the `file` sync strategy,'
      + ' whose pull is the merge `rafa effort merge` runs: every row the file holds that this store lacks is'
      + ' added, a matching row is skipped, a set-once field NULL here is filled, and any other difference is'
      + ' kept on both sides and recorded in `merge_conflicts`. It merges whatever `effort.sync` names. The file'
      + ' is only read; the merged store is built beside this one, checked, and swapped in with the original'
      + ' kept whole as `effort.sqlite.before-merge-<stamp>.bak`. It prints the rows added, skipped and in'
      + ' conflict per table and the backup\'s name, as `rafa effort merge` does. Exit code 2 for another'
      + ' project\'s store, and for a `store: ndjson` project, naming `rafa effort move --to=sqlite`; exit code 1,'
      + ' changing nothing, for a missing or damaged file, a write in flight, a loop session running or paused,'
      + ' and a development build over a store it does not own. With `--output=json` the outcome is the data'
      + ' of the terminal result event. Starts no session.',
    args: [
      {
        name: 'file',
        description: 'The other device\'s `effort.sqlite`, as `rafa effort copy` carried it; a relative path is'
          + ' read from the directory the command runs in.',
        type: 'string',
        required: true,
      },
    ],
    flags: [
      {
        name: DRY_RUN_FLAG,
        description: 'Build and check the merged store, print what it would add, then delete it. This store is'
          + ' only read, so this runs beside a live loop and from a development build, and can be repeated.',
        type: 'boolean',
      },
    ],
    examples: [
      {
        cmd: 'rafa effort import ../from-laptop/effort.sqlite --dry-run',
        note: 'Prints what the import would add, skip and record as conflicts, changing nothing.',
      },
      {
        cmd: 'rafa effort import ../from-laptop/effort.sqlite',
        note: 'Swaps the merged store in and prints where the original was kept.',
      },
    ],
    outputs: ['text', 'json'],
    run: async (context) => {
      await runImport(context, seams);
    },
  };
  return Object.freeze(command);
}

export default createImportCommand();
