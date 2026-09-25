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
 *
 * ## `--blessed`: what a task would be handed
 *
 * The lessons are the learning adapter's own answer, read as
 * `rafa instinct promote` reads them: the adapter `learning.adapter`
 * names, made with `learning.bless.minConfidence`, is asked for its
 * blessed set, and every lesson it answers is a row — its id,
 * confidence, `usage_count` and trigger, with its action beneath — in
 * the adapter's order, most trusted first. Nothing narrows them
 * further, so the rows are what the next pull hands a task. Only
 * `pullBlessed` is called, so nothing is written. A config `loadConfig`
 * refuses, a kind no registry holds, an adapter that cannot be made
 * and a pull the adapter refuses are each exit code 1: an empty list
 * would read as "nothing is blessed" when nothing was read.
 *
 * ## `--conflicts`: each flagged trigger, its actions side by side
 *
 * A trigger held with more than one action is one a merge found no
 * clear winner on (confidences within `GAP`), so it kept both and
 * flagged them, and no bundle blesses either. The files are read as
 * the `local` adapter reads them: each scope's clean records through
 * `toHeldRecords` (`adapters/learning/held.ts`), which marks every
 * record on such a trigger `flagged`, grouped by `triggerKey`. Each
 * group prints its scope and trigger, then one row per action — its
 * id, confidence, `usage_count` and the action on one line — highest
 * confidence first, so the actions to choose between sit one under the
 * other. A scope is grouped on its own, as the adapter settles each on
 * its own. A record `rafa instinct flag` named is not a conflict and
 * is not shown here: that flag names one id, not a trigger held two
 * ways. A file that breaks a rule holds no action to compare and is
 * passed over; the plain listing counts it.
 *
 * `--blessed` and `--conflicts` are two views, so the line takes one
 * of them; both together is exit code 1, as is either typed with a
 * value.
 */
import type { InstinctRecordEntry, ScopeListing } from './instinct-records.js';
import type { InstinctPromoteSeams } from './promote.js';
import type { RafaCommand, RafaContext } from '../../cli/command.js';
import type { InstinctRecord } from '../../ports/index.js';
import type { Instinct, InstinctScope } from '../../schema/instinct.js';

import { toHeldRecords } from '../../adapters/learning/held.js';
import { CORE_ADAPTER_REGISTRY } from '../../adapters/registry.js';
import { CommandExit } from '../../cli/command.js';
import { messageOf } from '../../config-sections.js';
import { triggerKey } from '../../learning/index.js';
import { expectNoArgument, resolveProjectConfig } from '../plan/plan-files.js';

import { allRecords, instinctProject, readScopes } from './instinct-records.js';
import { makeLearningAdapter, refusedPullMessage } from './promote.js';

/** The command's name, as a refusal opens with it. */
const NAME = 'rafa instinct list';

/** The usage line a refusal names. */
const USAGE = 'rafa instinct list [--blessed | --conflicts]';

/** How many digits a confidence is written with. */
const CONFIDENCE_DIGITS = 2;

/** The scale confidences are ordered at: whole hundredths, as the learning library compares them. */
const HUNDREDTHS = 100;

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

/** What `--blessed` gives as the terminal result's `data`. */
export interface InstinctBlessedResult {
  /** The learning adapter kind the lessons were read from: the project's `learning.adapter`. */
  readonly adapter: string;
  /** The project's `learning.bless.minConfidence`: the lowest confidence a blessed lesson carries. */
  readonly minConfidence: number;
  /** The blessed lessons, in the adapter's order. */
  readonly lessons: readonly InstinctRecord[];
}

/** One trigger a scope holds with more than one action. */
export interface InstinctConflict {
  /** The scope that holds it. */
  readonly scope: InstinctScope;
  /** The trigger as its first record by id spells it. */
  readonly trigger: string;
  /** Every record on the trigger, highest confidence first, then by id. */
  readonly records: readonly InstinctRecord[];
}

/** What `--conflicts` gives as the terminal result's `data`. */
export interface InstinctConflictsResult {
  /** The project the project scope was read under. */
  readonly projectRoot: string;
  /** One entry per flagged trigger, the project scope's first. */
  readonly conflicts: readonly InstinctConflict[];
}

/** Which view the line asked for. */
export type InstinctListView = 'all' | 'blessed' | 'conflicts';

/** A view flag read as on or off, refusing a value typed with it. */
function readViewFlag(name: string, value: string | boolean | undefined): boolean {
  if (value === undefined || value === false || value === 'false') return false;
  if (value === true || value === 'true') return true;
  throw new CommandExit(1, `❌ --${name} takes no value, and read "${value}" as one\nUsage: ${USAGE}`);
}

/** The view the line's flags ask for; both views at once is refused. */
export function readListView(flags: Readonly<Record<string, string | boolean>>): InstinctListView {
  const blessed = readViewFlag('blessed', flags['blessed']);
  const conflicts = readViewFlag('conflicts', flags['conflicts']);
  if (blessed && conflicts) {
    throw new CommandExit(1, `❌ --blessed and --conflicts are two views; give one\nUsage: ${USAGE}`);
  }
  if (blessed) return 'blessed';
  return conflicts
    ? 'conflicts'
    : 'all';
}

/** An action on one line: every whitespace run one space. */
function oneLine(text: string): string {
  return text.trim().replace(/\s+/gu, ' ');
}

/** Highest confidence first, in whole hundredths as the library compares, then by id. */
function byConfidence(left: InstinctRecord, right: InstinctRecord): number {
  const gap = Math.round(right.confidence * HUNDREDTHS) - Math.round(left.confidence * HUNDREDTHS);
  if (gap !== 0) return gap;
  if (left.id < right.id) return -1;
  return left.id > right.id
    ? 1
    : 0;
}

/** The flagged triggers one scope holds, each with its records; see the module note. */
export function scopeConflicts(listing: ScopeListing): readonly InstinctConflict[] {
  const clean = listing.records
    .map((entry) => entry.instinct)
    .filter((instinct): instinct is Instinct => instinct !== null);
  const groups = new Map<string, InstinctRecord[]>();
  for (const record of toHeldRecords(clean)) {
    if (record.status !== 'flagged') continue;
    const key = triggerKey(record.trigger);
    groups.set(key, [...groups.get(key) ?? [], record]);
  }
  return [...groups.values()].map((records) => ({
    scope: listing.scope,
    trigger: records[0]!.trigger,
    records: [...records].sort(byConfidence),
  }));
}

/** One lesson's line: its id padded to `width`, confidence, usage, then `tail`. */
function lessonLine(indent: string, record: InstinctRecord, width: number, tail: string): string {
  return `${indent}${record.id.padEnd(width)}  ${record.confidence.toFixed(CONFIDENCE_DIGITS)}`
    + `  used ${String(record.usage_count)}  ${tail}`;
}

/** A flagged trigger as text mode writes it: its scope and trigger, then each action side by side. */
export function conflictLines(conflict: InstinctConflict): readonly string[] {
  const width = Math.max(...conflict.records.map((record) => record.id.length));
  return [
    `  ${conflict.scope}  ${conflict.trigger}`,
    ...conflict.records.map((record) => lessonLine('    ', record, width, oneLine(record.action))),
  ];
}

/** Every line `--conflicts` writes in text mode. */
export function renderConflicts(result: InstinctConflictsResult): readonly string[] {
  if (result.conflicts.length === 0) {
    return [`No trigger either instinct scope holds carries more than one action (project: ${result.projectRoot}).`];
  }
  return [
    `Triggers held with more than one action (project: ${result.projectRoot}):`,
    ...result.conflicts.flatMap((conflict) => conflictLines(conflict)),
    `${String(result.conflicts.length)} flagged trigger(s): no bundle blesses any of their actions`,
  ];
}

/** Every line `--blessed` writes in text mode. */
export function renderBlessed(result: InstinctBlessedResult): readonly string[] {
  const floor = `learning.bless.minConfidence ${result.minConfidence.toFixed(CONFIDENCE_DIGITS)}`;
  if (result.lessons.length === 0) {
    return [`No lesson the \`${result.adapter}\` learning adapter holds is blessed at ${floor}.`];
  }
  return [
    `${String(result.lessons.length)} lesson(s) blessed by the \`${result.adapter}\` learning adapter, at ${floor}:`,
    ...result.lessons.flatMap((lesson) => [
      lessonLine('  ', lesson, 0, lesson.trigger),
      `      ${lesson.action}`,
    ]),
  ];
}

/** The adapter's blessed set; see the module note. */
async function blessedLessons(context: RafaContext, seams: InstinctPromoteSeams): Promise<InstinctBlessedResult> {
  const project = instinctProject(context, NAME);
  const config = resolveProjectConfig(project, NAME, (message) => {
    context.output.warn(message);
  });
  const kind = config.learningAdapter;
  const minConfidence = config.learningBlessMinConfidence;
  const adapter = makeLearningAdapter(
    seams.registry ?? CORE_ADAPTER_REGISTRY,
    kind,
    { repoRoot: project.root, home: project.home, minConfidence },
    NAME,
  );
  try {
    return { adapter: kind, minConfidence, lessons: (await adapter.pullBlessed()).instincts };
  } catch (error) {
    throw new CommandExit(1, refusedPullMessage(kind, messageOf(error), NAME));
  }
}

/** Both scopes' flagged triggers; see the module note. */
function conflicts(context: RafaContext): InstinctConflictsResult {
  const project = instinctProject(context, NAME);
  const scopes = readScopes({ home: project.home, projectRoot: project.root });
  return { projectRoot: project.root, conflicts: scopes.flatMap((listing) => scopeConflicts(listing)) };
}

/** Both scopes, every record; see the module note. */
function everyRecord(context: RafaContext): InstinctListResult {
  const project = instinctProject(context, NAME);
  const scopes = readScopes({ home: project.home, projectRoot: project.root });
  const records = allRecords(scopes);
  return {
    projectRoot: project.root,
    scopes,
    total: records.length,
    clean: records.filter((entry) => entry.instinct !== null).length,
  };
}

/** Writes `result` as the terminal event in json mode, or as `lines` otherwise. */
function answer(context: RafaContext, result: unknown, lines: () => readonly string[]): void {
  if (context.outputMode === 'json') {
    context.output.result(result);
    return;
  }
  for (const line of lines()) context.output.info(line);
}

/** Lists the view the line asks for. See the module note. */
async function runList(context: RafaContext, seams: InstinctPromoteSeams): Promise<void> {
  expectNoArgument(context.args, USAGE);
  const view = readListView(context.flags);
  if (view === 'blessed') {
    const result = await blessedLessons(context, seams);
    answer(context, result, () => renderBlessed(result));
    return;
  }
  if (view === 'conflicts') {
    const result = conflicts(context);
    answer(context, result, () => renderConflicts(result));
    return;
  }
  const result = everyRecord(context);
  answer(context, result, () => renderInstinctList(result));
}

/** The command, resolving `--blessed`'s adapter with `seams`. See the module note. */
export function createInstinctListCommand(seams: InstinctPromoteSeams = {}): RafaCommand {
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
      + ' say: this command reports and `rafa instinct check` gates. `--blessed` lists instead the lessons'
      + ' the learning adapter `learning.adapter` names would hand a task, at `learning.bless.minConfidence`,'
      + ' most trusted first, writing nothing; an adapter that cannot be made or a pull it refuses is exit'
      + ' code 1. `--conflicts` lists instead each trigger a scope holds with more than one action, which a'
      + ' merge flagged and no bundle blesses, its actions side by side with their confidence and usage.'
      + ' The two views are one at a time. With `--output=json` the scopes and their records, or the view'
      + ' asked for, are the data of the terminal result event.',
    args: [],
    flags: [
      {
        name: 'blessed',
        description: 'List the lessons the configured learning adapter blesses, each with its confidence, usage,'
          + ' trigger and action, instead of every record. Takes no value.',
        type: 'boolean',
      },
      {
        name: 'conflicts',
        description: 'List each trigger held with more than one action, its actions side by side with their'
          + ' confidence and usage, instead of every record. Takes no value.',
        type: 'boolean',
      },
    ],
    examples: [
      {
        cmd: 'rafa instinct list',
        note: 'Lists both scopes, each record with what it is about.',
      },
      {
        cmd: 'rafa instinct list --blessed',
        note: 'Lists the lessons a task would be handed, most trusted first.',
      },
      {
        cmd: 'rafa instinct list --conflicts',
        note: 'Lists each flagged trigger with its actions side by side.',
      },
      {
        cmd: 'rafa instinct list --output=json',
        note: 'Gives the scopes and every record parsed as the data of the terminal result event.',
      },
    ],
    outputs: ['text', 'json'],
    run: async (context) => {
      await runList(context, seams);
    },
  };
  return Object.freeze(command);
}

export default createInstinctListCommand();
