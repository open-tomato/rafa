/**
 * `rafa bug codes [--suggest=<text>] [--family=<family>] [--check]`: the
 * cause codes a bug or a rafa error can carry (#949). Starts no Claude
 * session and declares no `spends`.
 *
 * The list is rafa's own (`src/errors/rafa-codes.ts`) followed by the
 * project's `errors.codes`, read through the project's config, so a
 * config that redefines a rafa code is refused here as it is anywhere.
 * It writes nothing.
 *
 *   - With no flag it prints each family, alphabetically, with its count
 *     and what it stands for (`(project)` for a family only the project
 *     declares), its codes under it in list order, and a closing line
 *     naming the two reserved codes.
 *   - `--family` narrows the list to one family.
 *   - `--suggest` ranks the codes closest to a cause written in words,
 *     best first, at most `SUGGESTION_LIMIT`, each with the share of the
 *     text's words it holds. It never picks one: the caller does. A text
 *     sharing no word with any code says so and still exits 0.
 *   - `--check` prints the pairs of codes of one family that read alike.
 *
 * In json mode the {@link CodesReport} is the data of the terminal
 * result, and no text line is written. When `--check` finds a pair the
 * command refuses, and a refusal's terminal event carries no data, so
 * the report is written first as a `bug-codes-alike` event.
 *
 * `--suggest` and `--check` answer two questions and are refused
 * together.
 *
 * Exit code 0, except: 1 for an argument, a flag given no value or a
 * blank one, `--suggest` beside `--check`, a `--family` nobody declares
 * and a config the reader refuses; and 1 for `--check` over a list holding a pair that reads
 * alike, after the pairs in text mode.
 */
import type { RafaCommand, RafaContext } from '../../cli/command.js';
import type { ErrorCodeEntry } from '../../errors/codes.js';
import type { CodeSuggestion, NearDuplicate } from '../../errors/match.js';
import type { ListedCode } from '../../errors/rafa-codes.js';

import { CommandExit } from '../../cli/command.js';
import { familyOf, NEW_CONTEXT_LEAF, UNKNOWN_FAMILY } from '../../errors/codes.js';
import { nearDuplicates, suggestCodes } from '../../errors/match.js';
import { FAMILY_DESCRIPTIONS, listedCodes } from '../../errors/rafa-codes.js';
import { lineRefusal, readNonBlankFlag } from '../issue/issue-tracker.js';
import { expectNoArgument, readSwitch, requireProject, resolveProjectConfig } from '../plan/plan-files.js';

/** The command's spelling, as its refusals name it. */
const COMMAND_NAME = 'rafa bug codes';

/** The line the refusals end with. */
export const CODES_USAGE = 'rafa bug codes [--suggest=<text>] [--family=<family>] [--check]';

const SUGGEST_FLAG = 'suggest';
const FAMILY_FLAG = 'family';
const CHECK_FLAG = 'check';

/** The name of the json event carrying the report when `--check` finds a pair. */
export const CODES_ALIKE_EVENT = 'bug-codes-alike';

/** The exit code of `--check` over a list holding a pair that reads alike. */
const ALIKE_EXIT = 1;

/** What a family only the project declares is described as. */
const PROJECT_FAMILY = '(project)';

/** The closing line of the list. */
const RESERVED_LINE = `Every family also takes <family>:${NEW_CONTEXT_LEAF}; `
  + `${UNKNOWN_FAMILY}:${NEW_CONTEXT_LEAF} is the last resort.`;

/** One family of the list. */
export interface CodeFamily {
  readonly name: string;
  /** What the family stands for, or null for one only the project declares. */
  readonly description: string | null;
  /** How many listed codes it holds. */
  readonly count: number;
}

/** What the flags ask of the list. */
export interface CodesQuery {
  /** A cause in words, to rank the codes against. */
  readonly suggest?: string;
  /** The one family to list. */
  readonly family?: string;
  /** Whether to look for codes that read alike. */
  readonly check: boolean;
}

/** What `rafa bug codes` answers; the json result's data. */
export interface CodesReport {
  /** The families listed, alphabetically. */
  readonly families: readonly CodeFamily[];
  /** The codes listed: rafa's, then the project's, each in its own order. */
  readonly codes: readonly ListedCode[];
  /** The text `--suggest` gave, or null without it. */
  readonly suggestFor: string | null;
  /** The codes closest to that text, best first, or null without `--suggest`. */
  readonly suggestions: readonly CodeSuggestion[] | null;
  /** The pairs that read alike, or null without `--check`. */
  readonly nearDuplicates: readonly NearDuplicate[] | null;
}

/** The families of `codes`, alphabetically, each with its count. */
function familiesOf(codes: readonly ListedCode[]): readonly CodeFamily[] {
  const names = [...new Set(codes.map((entry) => familyOf(entry.code)))].sort((a, b) => a.localeCompare(b));
  return names.map((name) => ({
    name,
    description: FAMILY_DESCRIPTIONS[name] ?? null,
    count: codes.filter((entry) => familyOf(entry.code) === name).length,
  }));
}

/** The report for `projectCodes` beside rafa's own, as `query` narrows it. */
export function codesReport(projectCodes: readonly ErrorCodeEntry[], query: CodesQuery): CodesReport {
  const all = listedCodes(projectCodes);
  const codes = query.family === undefined
    ? all
    : all.filter((entry) => familyOf(entry.code) === query.family);
  return {
    families: familiesOf(codes),
    codes,
    suggestFor: query.suggest ?? null,
    suggestions: query.suggest === undefined
      ? null
      : suggestCodes(query.suggest, codes),
    nearDuplicates: query.check
      ? nearDuplicates(codes)
      : null,
  };
}

/** A score from 0 to 1 as a whole percentage. */
function percent(score: number): string {
  return `${Math.round(score * 100)}%`;
}

/** The lines of `--suggest`: the ranked codes, or that none matches. */
function suggestionLines(report: CodesReport, suggestions: readonly CodeSuggestion[]): string[] {
  const asked = JSON.stringify(report.suggestFor);
  if (suggestions.length === 0) {
    return [`No code matches ${asked}. File it as <family>:${NEW_CONTEXT_LEAF} with a proposed leaf.`];
  }
  const described = new Map(report.codes.map((entry) => [entry.code, entry.description]));
  return [
    `Closest codes for ${asked}:`,
    ...suggestions.map((row) => `  ${row.code}  ${percent(row.score)}  ${described.get(row.code) ?? ''}`),
  ];
}

/** The lines of `--check`: each pair that reads alike, or that none does. */
function checkLines(pairs: readonly NearDuplicate[]): string[] {
  return pairs.length === 0
    ? ['No two codes of one family read alike.']
    : [
      'Codes of one family that read alike:',
      ...pairs.map((pair) => `  ${pair.first} ~ ${pair.second}  ${percent(pair.score)}`),
    ];
}

/** The lines of the list: each family, its codes under it, and the reserved codes. */
function listLines(report: CodesReport): string[] {
  const lines = report.families.flatMap((family) => [
    `${family.name} (${family.count}): ${family.description ?? PROJECT_FAMILY}`,
    ...report.codes
      .filter((entry) => familyOf(entry.code) === family.name)
      .map((entry) => `  ${entry.code}  ${entry.description}`),
  ]);
  return [...lines, RESERVED_LINE];
}

/** What text mode prints for `report`: the suggestions, the check, or the list. */
export function renderCodes(report: CodesReport): string[] {
  if (report.suggestions !== null) return suggestionLines(report, report.suggestions);
  if (report.nearDuplicates !== null) return checkLines(report.nearDuplicates);
  return listLines(report);
}

/** How the `--check` refusal counts its pairs. */
function alikeMessage(pairs: number): string {
  return pairs === 1
    ? '1 pair of codes reads alike'
    : `${pairs} pairs of codes read alike`;
}

/** Runs `rafa bug codes`; see the module note. */
export function runCodes(context: RafaContext): void {
  expectNoArgument(context.args, CODES_USAGE);
  const check = readSwitch(CHECK_FLAG, context.flags[CHECK_FLAG], `Usage: ${CODES_USAGE}`);
  const suggest = readNonBlankFlag(context.flags, SUGGEST_FLAG, CODES_USAGE);
  const family = readNonBlankFlag(context.flags, FAMILY_FLAG, CODES_USAGE);
  if (suggest !== undefined && check) {
    throw lineRefusal(`--${SUGGEST_FLAG} and --${CHECK_FLAG} answer two questions: give one`, CODES_USAGE);
  }
  const project = requireProject(context, COMMAND_NAME);
  const config = resolveProjectConfig(project, COMMAND_NAME, (message) => {
    context.output.warn(message);
  });

  const report = codesReport(config.errorsCodes, { suggest, family, check });
  if (family !== undefined && report.codes.length === 0) {
    const known = codesReport(config.errorsCodes, { check: false }).families.map((row) => row.name);
    throw lineRefusal(`No family ${JSON.stringify(family)}. Families: ${known.join(', ')}`, CODES_USAGE);
  }

  const json = context.outputMode === 'json';
  if (!json) for (const line of renderCodes(report)) context.output.info(line);
  const pairs = report.nearDuplicates?.length ?? 0;
  if (pairs === 0) {
    if (json) context.output.result(report);
    return;
  }
  // A refusal's terminal event carries no data, so json mode gets the pairs in an event first.
  if (json) {
    context.output.emit({
      type: 'event',
      name: CODES_ALIKE_EVENT,
      summary: alikeMessage(pairs),
      data: { ...report },
      ts: new Date().toISOString(),
    });
  }
  throw new CommandExit(ALIKE_EXIT, `❌ ${COMMAND_NAME} --check: ${alikeMessage(pairs)}`);
}

/** `rafa bug codes`, as the registry holds it. */
export function createCodesCommand(): RafaCommand {
  const command: RafaCommand = {
    name: 'bug codes',
    subject: 'bug',
    action: 'codes',
    summary: 'list the cause codes a bug can carry, rank the closest to a cause in words, or check for codes that read alike',
    description: 'Lists the cause codes: rafa\'s own, then the ones the project adds under `errors.codes` in '
      + '`.rafa/config.yaml`. A code is `<family>:<leaf>`: the family names the gate or tool that tripped, the leaf '
      + 'the condition. Prints each family alphabetically with its count and what it stands for, `(project)` for a '
      + 'family only the project declares, its codes under it, and a closing line naming the reserved codes: every '
      + 'family also takes `<family>:new-context` for a cause no leaf fits yet, and `unknown:new-context` is the '
      + 'last resort. `--family` narrows the list to one family, and a family nobody declares is refused with the '
      + 'families that exist. `--suggest` ranks the codes closest to a cause written in words, best first, at most '
      + 'five, each with the share of the text\'s words it holds; it never picks one, and a text sharing no word '
      + 'with any code says so with exit code 0. `--check` prints the pairs of codes of one family that read alike '
      + 'and exits 1 when there is one; it is refused beside `--suggest`. With `--output=json` the families, the '
      + 'codes with the source of each, the suggestions and the pairs are the data of the terminal result event, '
      + 'and of a `bug-codes-alike` event ahead of the refusal when `--check` finds a pair. Writes nothing and starts '
      + 'no session.',
    args: [],
    flags: [
      {
        name: SUGGEST_FLAG,
        description: 'A cause in words, quoted: the codes closest to it are ranked, best first.',
        type: 'string',
      },
      { name: FAMILY_FLAG, description: 'The one family to list, such as git.', type: 'string' },
      {
        name: CHECK_FLAG,
        description: 'Print the pairs of codes of one family that read alike, and exit 1 when there is one.',
        type: 'boolean',
      },
    ],
    examples: [
      { cmd: 'rafa bug codes', note: 'Prints every family alphabetically, each with its codes, rafa\'s and the project\'s alike.' },
      {
        cmd: 'rafa bug codes --suggest="git commit has no author identity"',
        note: 'Ranks the closest codes, git:no-identity first.',
      },
      { cmd: 'rafa bug codes --family=git', note: 'Prints the git family alone.' },
      { cmd: 'rafa bug codes --check', note: 'Exits 1 when two codes of one family read alike, naming each pair.' },
    ],
    outputs: ['text', 'json'],
    run: async (context) => {
      runCodes(context);
      await Promise.resolve();
    },
  };
  return Object.freeze(command);
}

export default createCodesCommand();
