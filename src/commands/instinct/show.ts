/**
 * `rafa instinct show <id>`: one record whole — its frontmatter, its
 * Action and Cause sections, its evidence, and the `action_hash` that
 * is computed and never stored.
 *
 * The id is the record's FILE NAME, which is what `rafa instinct list`
 * prints, so the two commands agree about a record whose frontmatter
 * `id` disagrees with its file. A record like that is the checker's
 * `name-mismatch`; a lookup that preferred the frontmatter would leave
 * it unreachable by the name it is filed under.
 *
 * ## Which scope answers, when both hold the id
 *
 * The scopes are searched nearest the work first, so a project record
 * shadows a user one of the same name, and a line under the printout
 * says the other scope holds that id too. Nothing is merged: the two
 * files are two records, and the line is what sends a person to
 * `rafa instinct list` for the second one.
 *
 * ## An unreadable record is a refusal
 *
 * A record that breaks a rule of the instinct schema has no fields to
 * print, so the run refuses with exit code 1, naming the file and one
 * line per rule. That is `rafa doctor`'s shape for a refusal that has
 * to say what it found, and the only shape that survives json mode:
 * the dispatcher drops a nonzero exit's result payload
 * (`cli/dispatch.ts`), so what a failing run says has to be the
 * message. A clean run gives {@link InstinctShowResult} as the result
 * payload, and exits 0.
 *
 * An id no scope holds is the other refusal, with the scopes it
 * looked in named, since an absent `~/.rafa/instincts` is an ordinary
 * state and worth seeing in the message.
 */
import type { InstinctRecordEntry, ScopeListing } from './instinct-records.js';
import type { RafaCommand, RafaContext } from '../../cli/command.js';
import type { Instinct, InstinctEvidence } from '../../schema/instinct.js';
import type { InstinctScope } from '../../schema/tiers.js';

import { CommandExit } from '../../cli/command.js';
import { ACTION_HEADING, CAUSE_HEADING } from '../../schema/instinct.js';
import { expectOneArgument } from '../plan/plan-files.js';

import { findRecords, instinctProject, readScopes } from './instinct-records.js';

/** The usage line a refusal names. */
const USAGE = 'rafa instinct show <id>';

/** The fields printed above the body, in the order they are written. */
const FIELD_ORDER: readonly (keyof Instinct)[] = [
  'trigger',
  'kind',
  'domain',
  'signal',
  'confidence',
  'usageCount',
  'artifact',
  'scope',
  'projectId',
  'source',
  'createdAt',
  'updatedAt',
  'actionHash',
];

/** The frontmatter key each field is written under, so a printout reads as the file does. */
const FIELD_KEYS: Readonly<Record<string, string>> = Object.freeze({
  trigger: 'trigger',
  kind: 'kind',
  domain: 'domain',
  signal: 'signal',
  confidence: 'confidence',
  usageCount: 'usage_count',
  artifact: 'artifact',
  scope: 'scope',
  projectId: 'project_id',
  source: 'source',
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  actionHash: 'action_hash',
});

/** How wide the key column is, which is `usage_count` plus a space. */
const KEY_WIDTH = 12;

/** What json mode gives as the terminal result's `data`. */
export interface InstinctShowResult {
  /** The id asked for, which is the record's file name. */
  readonly id: string;
  /** The scope the record was read from. */
  readonly scope: InstinctScope;
  /** The file, absolute. */
  readonly path: string;
  /** The record, every field as {@link Instinct} carries it. */
  readonly instinct: Instinct;
  /** The other scopes holding a record of the same id, empty when none does. */
  readonly alsoIn: readonly InstinctScope[];
}

/** One evidence entry as a line: its keys in the order the file wrote them. */
export function evidenceLine(entry: InstinctEvidence): string {
  return Object.entries(entry)
    .map(([key, value]) => `${key}: ${String(value)}`)
    .join(', ');
}

/** One field as a line, or null for a field the record left out. */
export function fieldLine(record: Instinct, field: keyof Instinct): string | null {
  const value = record[field];
  if (value === null) return null;
  const key = FIELD_KEYS[field] ?? field;
  return `  ${key.padEnd(KEY_WIDTH)}${String(value)}`;
}

/** Every line text mode writes for one record. */
export function renderInstinct(result: InstinctShowResult): readonly string[] {
  const record = result.instinct;
  const evidence = record.evidence.length === 0
    ? ['Evidence: none']
    : [`Evidence (${String(record.evidence.length)}):`, ...record.evidence.map((entry) => `  - ${evidenceLine(entry)}`)];
  const shadowed = result.alsoIn.map((scope) => `Also filed under this id in the ${scope} scope.`);
  return [
    `${result.id}  (${result.scope} scope)`,
    result.path,
    '',
    ...FIELD_ORDER.map((field) => fieldLine(record, field)).filter((line): line is string => line !== null),
    '',
    ACTION_HEADING,
    record.action,
    '',
    CAUSE_HEADING,
    record.cause,
    '',
    ...evidence,
    ...shadowed,
  ];
}

/** The message a record that broke a rule is refused with. */
export function unreadableMessage(entry: InstinctRecordEntry): string {
  return [
    `❌ ${entry.path} is no record: ${String(entry.issues.length)} issue(s)`,
    ...entry.issues.map((issue) => `  ${issue.field}: ${issue.message}`),
    'Run `rafa instinct check` on the scope to see them beside every other record.',
  ].join('\n');
}

/** The message an id no scope holds is refused with. */
export function unknownIdMessage(id: string, scopes: readonly ScopeListing[]): string {
  const looked = scopes.map((listing) => `  ${listing.scope}  ${listing.dir}${listing.exists
    ? ''
    : '  (no such directory)'}`);
  return [`❌ No instinct is filed under "${id}". Looked in:`, ...looked, `Usage: ${USAGE}`].join('\n');
}

/** Shows the record. See the module note. */
function runShow(context: RafaContext): void {
  const id = expectOneArgument(context.args, USAGE);
  const project = instinctProject(context, 'rafa instinct show');
  const scopes = readScopes({ home: project.home, projectRoot: project.root });
  const found = findRecords(scopes, id);
  if (found.length === 0) throw new CommandExit(1, unknownIdMessage(id, scopes));

  const [entry, ...rest] = found as [InstinctRecordEntry, ...InstinctRecordEntry[]];
  if (entry.instinct === null) throw new CommandExit(1, unreadableMessage(entry));

  const result: InstinctShowResult = {
    id: entry.id,
    scope: entry.scope,
    path: entry.path,
    instinct: entry.instinct,
    alsoIn: rest.map((other) => other.scope),
  };

  if (context.outputMode === 'json') {
    context.output.result(result);
    return;
  }
  for (const line of renderInstinct(result)) context.output.info(line);
}

/** The command. See the module note. */
export function createInstinctShowCommand(): RafaCommand {
  const command: RafaCommand = {
    name: 'instinct show',
    subject: 'instinct',
    action: 'show',
    summary: 'show one instinct record whole, from the project or user scope',
    description: 'Shows one instinct record: its frontmatter fields, its Action and Cause sections, its'
      + ' evidence, and the `action_hash` computed from the action, which no file stores. The id is the'
      + ' record\'s file name, which is what `rafa instinct list` prints, so a record whose frontmatter `id`'
      + ' disagrees with its file is still reachable. The scopes are searched nearest the work first, so'
      + ' this project\'s `.rafa/instincts` shadows `~/.rafa/instincts`, and a line says when the other'
      + ' scope holds that id too. A record that breaks a rule of the instinct schema is refused with exit'
      + ' code 1 and its issues named, as is an id no scope holds. With `--output=json` the record is the'
      + ' data of the terminal result event.',
    args: [
      {
        name: 'id',
        description: 'The record\'s file name without `.md`, as `rafa instinct list` prints it.',
        type: 'string',
        required: true,
      },
    ],
    flags: [],
    examples: [
      {
        cmd: 'rafa instinct show worktree-missing-node-modules',
        note: 'Shows that record from whichever scope holds it, the project scope first.',
      },
      {
        cmd: 'rafa instinct show worktree-missing-node-modules --output=json',
        note: 'Gives the record as the data of the terminal result event.',
      },
    ],
    outputs: ['text', 'json'],
    run: async (context) => {
      runShow(context);
    },
  };
  return Object.freeze(command);
}

export default createInstinctShowCommand();
