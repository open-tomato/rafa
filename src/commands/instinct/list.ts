/**
 * `rafa instinct list`: every record the two instinct scopes hold,
 * each with its scope, what it is about and whether it reads as a
 * record at all.
 *
 * The scopes are `<root>/.rafa/instincts` and `~/.rafa/instincts`
 * (`src/schema/tiers.ts`), nearest the work first, and what counts as
 * a record there is `./instinct-records.ts`'s: a top-level `.md`, with
 * the Learning adapter's `instincts.ndjson` and `flags.ndjson` passed
 * over without a word. So the count this prints is a count of records,
 * never of the store's lines.
 *
 * ## What each row says
 *
 * The id its file name gives it, then the `kind/domain` pair, the
 * `signal`, the `confidence` and the `trigger` — the five things that
 * say whether a record is the one being looked for, which
 * `rafa instinct show <id>` then prints whole. A file that broke a
 * rule has none of them to print, so its row is the id and the number
 * of rules it broke, and `rafa instinct check` is the command that
 * names them.
 *
 * ## The exit code is 0 whatever the rows say
 *
 * A listing reports; it does not gate. A scope full of half-written
 * records still exits 0, as `rafa skill list` does, and the number
 * beside a row is what to run `rafa instinct check` on. Exit code 1 is
 * kept for the one refusal: a positional word, since this command
 * takes none.
 *
 * ## An absent scope is a row of its own
 *
 * A project that has learned nothing carries no `.rafa/instincts` at
 * all, and so does a fresh home. Such a scope prints its path and
 * `no such directory`, which is the reading a person wants, and is
 * told apart from a scope that is there and empty.
 */
import type { InstinctRecordEntry, ScopeListing } from './instinct-records.js';
import type { RafaCommand, RafaContext } from '../../cli/command.js';

import { expectNoArgument } from '../plan/plan-files.js';

import { allRecords, instinctProject, readScopes } from './instinct-records.js';

/** The usage line a refusal names. */
const USAGE = 'rafa instinct list';

/** How many digits a confidence is written with. */
const CONFIDENCE_DIGITS = 2;

/** What json mode gives as the terminal result's `data`. */
export interface InstinctListResult {
  /** The project the project scope was read under. */
  readonly projectRoot: string;
  /** One entry per scope, nearest the work first. */
  readonly scopes: readonly ScopeListing[];
  /** How many records there are in all. */
  readonly total: number;
  /** How many of them read as records. */
  readonly clean: number;
}

/** A row as text mode writes it: the mark, the id, and what it is about. */
export function instinctRowLine(entry: InstinctRecordEntry): string {
  const record = entry.instinct;
  if (record === null) return `    ❌ ${entry.id}  ${String(entry.issues.length)} issue(s)`;
  const confidence = record.confidence.toFixed(CONFIDENCE_DIGITS);
  return `    ✅ ${entry.id}  ${record.kind}/${record.domain}  ${record.signal}`
    + `  ${confidence}  ${record.trigger}`;
}

/** A scope as text mode writes it: its heading, then its rows or why it has none. */
export function scopeLines(listing: ScopeListing): readonly string[] {
  if (!listing.exists) return [`  ${listing.scope}  ${listing.dir}  (no such directory)`];
  if (listing.records.length === 0) return [`  ${listing.scope}  ${listing.dir}  (no instincts)`];
  return [
    `  ${listing.scope}  ${listing.dir}`,
    ...listing.records.map(instinctRowLine),
  ];
}

/** Every line text mode writes: the heading, each scope, then the counts. */
export function renderInstinctList(result: InstinctListResult): readonly string[] {
  return [
    `Instincts by scope (project: ${result.projectRoot}):`,
    ...result.scopes.flatMap((listing) => scopeLines(listing)),
    `${String(result.total)} instinct(s): ${String(result.clean)} read as records,`
      + ` ${String(result.total - result.clean)} do not`,
  ];
}

/** Lists the scopes. See the module note. */
function runList(context: RafaContext): void {
  expectNoArgument(context.args, USAGE);
  const project = instinctProject(context, 'rafa instinct list');
  const scopes = readScopes({ home: project.home, projectRoot: project.root });
  const records = allRecords(scopes);
  const result: InstinctListResult = {
    projectRoot: project.root,
    scopes,
    total: records.length,
    clean: records.filter((entry) => entry.instinct !== null).length,
  };

  if (context.outputMode === 'json') {
    context.output.result(result);
    return;
  }
  for (const line of renderInstinctList(result)) context.output.info(line);
}

/** The command. See the module note. */
export function createInstinctListCommand(): RafaCommand {
  const command: RafaCommand = {
    name: 'instinct list',
    subject: 'instinct',
    action: 'list',
    summary: 'list the records the project and user instinct scopes hold',
    description: 'Lists every instinct record the two scopes hold — this project\'s `.rafa/instincts` and'
      + ' `~/.rafa/instincts` — with, for each, the id its file name gives it, its `kind/domain` pair, its'
      + ' `signal`, its `confidence` and its `trigger`. A record that breaks a rule of the instinct schema'
      + ' shows the number of rules it broke instead, which `rafa instinct check` then names. The local'
      + ' Learning adapter\'s `instincts.ndjson` and `flags.ndjson` are its store and no records, and are'
      + ' passed over. A scope whose directory is not there says so. The exit code is 0 whatever the rows'
      + ' say: this command reports and `rafa instinct check` gates. With `--output=json` the scopes and'
      + ' their records are the data of the terminal result event.',
    args: [],
    flags: [],
    examples: [
      {
        cmd: 'rafa instinct list',
        note: 'Lists both scopes, each record with what it is about.',
      },
      {
        cmd: 'rafa instinct list --output=json',
        note: 'Gives the scopes and every record parsed as the data of the terminal result event.',
      },
    ],
    outputs: ['text', 'json'],
    run: async (context) => {
      runList(context);
    },
  };
  return Object.freeze(command);
}

export default createInstinctListCommand();
