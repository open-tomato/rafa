/**
 * `rafa effort schema [--check]`: what the project's SQLite effort store
 * holds, set against the migrations this rafa knows, and whether this
 * rafa would use it, read by `readSchemaReport`
 * (`src/effort/store/schema-report.ts`, whose note is the long form).
 * Starts no Claude session and declares no `spends`.
 *
 * It opens the store read-only and migrates nothing, so a store with a
 * migration pending, or one no log was ever made for, keeps its bytes,
 * and a development build may run it over the live store. The store is
 * the one every other command would open: under `RAFA_EFFORT_DIR` when
 * it is set, and `<root>/.rafa/effort/effort.sqlite` otherwise.
 *
 * It prints the applied, pending, unknown and edited migrations and the
 * legacy gate, then the verdict, and ends with `Next safe step:
 * <command>`: the command the matching refusal names, or `none` when
 * this rafa uses the store. In json mode the `SchemaReport`, with its
 * `nextStep`, is the data of the terminal result.
 *
 * Exit code 0 whatever the verdict, unless `--check` is given and this
 * rafa would refuse to read or to write the store: then exit code 1,
 * after the report in text mode, with the reason and the next step as
 * the refusal. Exit code 1 as well for a `RAFA_EFFORT_DIR` the store
 * location refuses, and exit code 2 when the file cannot be read as a
 * store.
 */
import type { RafaCommand, RafaContext } from '../../cli/command.js';
import type { SchemaReport, SchemaReportOptions } from '../../effort/store/schema-report.js';

import { join } from 'node:path';

import { CommandExit } from '../../cli/command.js';
import { messageOf } from '../../config-sections.js';
import { effortStoreDir } from '../../effort/store/location.js';
import { gateMeaning, readSchemaReport } from '../../effort/store/schema-report.js';
import { SQLITE_STORE_FILE_NAME } from '../../effort/store/sqlite.js';
import { expectNoArgument, readSwitch, requireProject } from '../plan/plan-files.js';

/** The command's spelling, as its refusals name it. */
const COMMAND_NAME = 'rafa effort schema';

/** The line the refusals end with. */
export const SCHEMA_USAGE = 'rafa effort schema [--check]';

const CHECK_FLAG = 'check';

/** The exit code of `--check` over a store this rafa refuses, and of a refused location. */
const REFUSED_EXIT = 1;

/** The exit code of a store that cannot be read. */
const FAILED_EXIT = 2;

/** What a test replaces. */
export type SchemaCommandSeams = SchemaReportOptions;

/** The list's line: its name, its count, and each item, or `none`. */
function listLine(name: string, items: readonly string[]): string {
  const shown = items.length === 0
    ? 'none'
    : items.join(', ');
  return `${name} (${String(items.length)}): ${shown}`;
}

/** The gate's line: what the store holds, and what the next open leaves it at. */
function gateLine(report: SchemaReport): string {
  const held = report.userVersion ?? 0;
  const now = report.logged
    ? `${String(held)} (${gateMeaning(held)})`
    : `${String(held)} (a count of legacy migrations: no log yet)`;
  const next = report.gate === null || report.gate === report.userVersion
    ? ''
    : `; ${String(report.gate)} (${gateMeaning(report.gate)}) once the next open brings it forward`;
  return `Gate (user_version): ${now}${next}`;
}

/** The verdict's line. */
function verdictLine(report: SchemaReport): string {
  switch (report.status) {
    case 'absent':
      return 'No store yet: the first write creates it at this rafa\'s migrations.';
    case 'current':
      return '✅ Current: this rafa reads and writes the store as it is.';
    case 'behind':
      return '✅ Behind: the next command that opens the store brings it forward in one transaction.';
    default:
      return `❌ Refused (${report.status}): ${String(report.refusal)}`;
  }
}

/** Every line one report prints, ending with `Next safe step:`. */
export function renderSchema(report: SchemaReport): string[] {
  if (!report.exists) return [`Effort store: ${report.path}`, verdictLine(report), `Next safe step: ${report.nextStep}`];

  const log = report.logged
    ? 'Migration log: present.'
    : 'Migration log: none; a release before the log wrote this store, and the next open adopts it.';
  return [
    `Effort store: ${report.path}`,
    log,
    gateLine(report),
    listLine('Applied', report.applied.map(({ id, appliedBy }) => (appliedBy === null
      ? id
      : `${id} (${appliedBy})`))),
    listLine('Pending', report.pending),
    listLine('Unknown', report.unknown.map(({ id, breaks, appliedBy, appliedAt }) => (
      `${id} (breaks ${breaks.length === 0
        ? 'nothing'
        : breaks.join(' and ')}; applied by ${appliedBy} on ${appliedAt})`
    ))),
    listLine('Edited', report.edited.map(({ id, recorded, expected }) => `${id} (store ${recorded}, this rafa ${expected})`)),
    verdictLine(report),
    `Next safe step: ${report.nextStep}`,
  ];
}

/** The store file every other command would open under `root`, or a refusal of `RAFA_EFFORT_DIR`. */
function storePath(context: RafaContext, root: string): string {
  try {
    return join(effortStoreDir(root, context.env), SQLITE_STORE_FILE_NAME);
  } catch (error) {
    throw new CommandExit(REFUSED_EXIT, `❌ ${COMMAND_NAME}: ${messageOf(error)}`);
  }
}

/** Runs one invocation. See the module note. */
export function runSchema(context: RafaContext, seams: SchemaCommandSeams): void {
  expectNoArgument(context.args, SCHEMA_USAGE);
  const check = readSwitch(CHECK_FLAG, context.flags[CHECK_FLAG], `Usage: ${SCHEMA_USAGE}`);
  const path = storePath(context, requireProject(context, COMMAND_NAME).root);

  let report: SchemaReport;
  try {
    report = readSchemaReport(path, seams);
  } catch (error) {
    throw new CommandExit(FAILED_EXIT, `❌ ${COMMAND_NAME}: ${path} cannot be read as an effort store: ${messageOf(error)}`);
  }

  if (context.outputMode !== 'json') {
    for (const line of renderSchema(report)) context.output.info(line);
  }
  if (check && report.refused) {
    throw new CommandExit(
      REFUSED_EXIT,
      `❌ ${COMMAND_NAME} --check: this rafa refuses ${path} (${report.status}). Next safe step: ${report.nextStep}`,
    );
  }
  if (context.outputMode === 'json') context.output.result(report);
}

/** The command, reading `seams`; see the module note. */
export function createSchemaCommand(seams: SchemaCommandSeams = {}): RafaCommand {
  const command: RafaCommand = {
    name: 'effort schema',
    subject: 'effort',
    action: 'schema',
    summary: 'say whether this rafa can read and write the effort store, and what to run next when it cannot',
    description: 'Opens the SQLite effort store read-only, the one under `RAFA_EFFORT_DIR` when it is set, and'
      + ' migrates nothing. Prints the migrations it holds that this rafa knows (applied), the ones it lacks'
      + ' (pending), the ones this rafa does not know with what they break (unknown), and the ones recorded under'
      + ' another checksum (edited), then the legacy gate `user_version` holds and whether this rafa would use'
      + ' the store or refuse it, and why. It ends with `Next safe step: <command>`, the command the matching'
      + ' refusal names, or `none`. With `--check` it exits 1 when this rafa would refuse to read or to write'
      + ' the store. Exit code 2 when the file cannot be read as a store. With `--output=json` the report, with'
      + ' its `nextStep`, is the data of the terminal result event. Starts no session.',
    args: [],
    flags: [
      {
        name: CHECK_FLAG,
        description: 'Exit 1 when this rafa would refuse to read or to write the store; exit 0 otherwise.',
        type: 'boolean',
      },
    ],
    examples: [
      {
        cmd: 'rafa effort schema',
        note: 'Prints the store\'s migrations, the gate and the verdict, ending with the next safe step.',
      },
      {
        cmd: 'rafa effort schema --check',
        note: 'The same report, exiting 1 when this rafa would refuse the store.',
      },
    ],
    outputs: ['text', 'json'],
    run: async (context) => {
      runSchema(context, seams);
      await Promise.resolve();
    },
  };
  return Object.freeze(command);
}

export default createSchemaCommand();
