/**
 * `rafa instinct groups`: the gold-set export. Prints each lesson the
 * project scope holds under several records with one action — its
 * same-action group — and writes nothing.
 *
 * ## The held set is `--conflicts`'s
 *
 * The project scope (`<root>/.rafa/instincts`) is read as
 * `rafa instinct list --conflicts` reads it: its clean records through
 * `toHeldRecords` (`adapters/learning/held.ts`), which marks every
 * record on a trigger held with more than one action `flagged`. The
 * blessed set is not asked for, so a promoted lesson stays in the
 * export, and the library's `flagged` status is the only exclusion; a
 * flag `rafa instinct flag` appended to `flags.ndjson` is not read, as
 * `--conflicts` reads none. The user scope is not read: the export is
 * the project's own pairs. A file that breaks a rule holds no action
 * and is passed over.
 *
 * ## The groups are the library's
 *
 * The held records are grouped by `sameActionGroups`
 * (`learning/groups.ts`): one group per `action_hash` across triggers,
 * `flagged` members left out, its sources the union of its members',
 * its confidence `merge`'s same-action arithmetic. Only groups of two or
 * more members are listed, so an action held under one record is not an
 * entry. Groups keep the library's order: confidence, then source
 * count, both highest first, then the named record's `id`.
 *
 * ## What a clean run answers
 *
 * A heading naming the project, then each group as its action hash,
 * confidence and source count, with each distinct trigger (by
 * `triggerKey`, in member order) beneath; or one line saying the scope
 * holds none. With `--output=json`, {@link InstinctGroupsResult} is the
 * data of the terminal result event: `{ groups: [{ action_hash,
 * triggers, sources, confidence }] }`, `sources` the count.
 *
 * ## Refusals
 *
 * A positional word is exit code 1, naming the usage. A scope holding
 * no groups is exit code 0 with its line: the export reports and does
 * not gate.
 */
import type { RafaCommand, RafaContext } from '@open-tomato/rafa/core/command';
import type { InstinctRecord } from '@open-tomato/rafa/ports';
import type { Instinct } from '@open-tomato/rafa-inventory';

import { readScopes, sameActionGroups, toHeldRecords, triggerKey } from '@open-tomato/rafa-inventory';

import { expectNoArgument } from '@open-tomato/rafa/commands/plan/plan-files';

import { instinctProject } from './instinct-records.js';

/** The command's name, as a refusal opens with it. */
const NAME = 'rafa instinct groups';

/** The usage line a refusal names. */
const USAGE = 'rafa instinct groups';

/** How many digits a confidence is written with. */
const CONFIDENCE_DIGITS = 2;

/** The fewest members a listed group has. */
const MIN_MEMBERS = 2;

/** One same-action group as the export gives it. */
export interface InstinctGroup {
  /** The `action_hash` every member shares. */
  readonly action_hash: string;
  /** Each distinct trigger its members are held on, by `triggerKey`, in member order. */
  readonly triggers: readonly string[];
  /** How many distinct sources its members hold together. */
  readonly sources: number;
  /** The group's pooled confidence, at two decimals. */
  readonly confidence: number;
}

/** What json mode gives as the terminal result's `data`. */
export interface InstinctGroupsResult {
  /** Each group of two or more members, in the library's order. */
  readonly groups: readonly InstinctGroup[];
}

/** Each distinct trigger of `members`, by `triggerKey`, its first spelling kept. */
function distinctTriggers(members: readonly InstinctRecord[]): string[] {
  const seen = new Map<string, string>();
  for (const member of members) {
    const key = triggerKey(member.trigger);
    if (!seen.has(key)) seen.set(key, member.trigger);
  }
  return [...seen.values()];
}

/** The groups of two or more members `held` forms; see the module note. */
export function heldGroups(held: readonly InstinctRecord[]): InstinctGroup[] {
  return sameActionGroups(held)
    .filter((group) => group.members.length >= MIN_MEMBERS)
    .map((group) => ({
      action_hash: group.action_hash,
      triggers: distinctTriggers(group.members),
      sources: group.sources.length,
      confidence: group.confidence,
    }));
}

/** The project scope's held set, read as `--conflicts` reads it; see the module note. */
function projectHeld(context: RafaContext): InstinctRecord[] {
  const project = instinctProject(context, NAME);
  const listing = readScopes({ home: project.home, projectRoot: project.root })
    .find((each) => each.scope === 'project');
  const clean = (listing?.records ?? [])
    .map((entry) => entry.instinct)
    .filter((instinct): instinct is Instinct => instinct !== null);
  return toHeldRecords(clean);
}

/** Reads the project scope's groups; see the module note. */
export function readInstinctGroups(context: RafaContext): InstinctGroupsResult {
  expectNoArgument(context.args, USAGE);
  return { groups: heldGroups(projectHeld(context)) };
}

/** Every line text mode writes: the heading, then each group or the line saying there is none. */
export function renderGroups(result: InstinctGroupsResult, projectRoot: string): readonly string[] {
  if (result.groups.length === 0) {
    return [`No action the project scope holds is held under two or more records (project: ${projectRoot}).`];
  }
  return [
    `${String(result.groups.length)} same-action group(s) in the project scope (project: ${projectRoot}):`,
    ...result.groups.flatMap((group) => [
      `  ${group.action_hash}  ${group.confidence.toFixed(CONFIDENCE_DIGITS)}`
        + `  from ${String(group.sources)} source(s)`,
      ...group.triggers.map((trigger) => `      ${trigger}`),
    ]),
  ];
}

/** The command; see the module note. */
export function createInstinctGroupsCommand(): RafaCommand {
  const command: RafaCommand = {
    name: 'instinct groups',
    subject: 'instinct',
    action: 'groups',
    summary: 'list each lesson the project holds under several wordings, writing nothing',
    description: 'Lists each same-action group the project scope `.rafa/instincts` holds: the records'
      + ' sharing one action across triggers, read as `rafa instinct list --conflicts` reads them, a'
      + ' record on a trigger held with more than one action left out. Only a group of two or more'
      + ' records is listed, with its action hash, its pooled confidence, how many distinct sources its'
      + ' records hold together, and each trigger it is held on. Nothing is written. With'
      + ' `--output=json` the groups are the data of the terminal result event: the gold set the hub'
      + ' calibrates its similarity against.',
    args: [],
    flags: [],
    examples: [
      {
        cmd: 'rafa instinct groups',
        note: 'Lists each same-action group with its action hash, confidence, source count and triggers.',
      },
      {
        cmd: 'rafa instinct groups --output=json',
        note: 'Gives the groups as the data of the terminal result event.',
      },
    ],
    outputs: ['text', 'json'],
    run: (context) => {
      const result = readInstinctGroups(context);
      if (context.outputMode === 'json') {
        context.output.result(result);
        return Promise.resolve();
      }
      const root = instinctProject(context, NAME).root;
      for (const line of renderGroups(result, root)) context.output.info(line);
      return Promise.resolve();
    },
  };
  return Object.freeze(command);
}

const command: RafaCommand = createInstinctGroupsCommand();
export default command;
