/**
 * `rafa bug codes [--suggest=<text> [--no-proposals]] [--family=<family>] [--check]`: the
 * cause codes a bug or a rafa error can carry (#949). Starts no Claude
 * session and declares no `spends`.
 *
 * The list is rafa's own (`packages/rafa/src/errors/rafa-codes.ts`) followed by
 * the project's `errors.codes`, read through the project's config, so a
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
 *   - `--suggest` also ranks the `Proposed cause` of each open bug,
 *     through the same floor and tie rules (`suggestWithProposals`), each
 *     line naming the bug that proposed it; `--no-proposals` skips them.
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
 * ## The proposals
 *
 * With `--suggest` and without `--no-proposals` the tracker is read: the
 * chain is resolved through `resolveTracker` with the seams' registry
 * and `gh`, a runner spawning `gh` in the project root under
 * {@link PROPOSALS_GH_TIMEOUT_MS} when none is planted. The tracker it
 * lands on, degraded or not, is listed with `openIssues('bug')`, and each
 * body is read with `parseBugRecord` for its `proposed` code. A chain
 * landing nowhere and a listing that throws are each a `warn` entry of a
 * child of the active logger, bound to module `bug` and action `codes`,
 * and the suggestions print without proposals; a tracker with no
 * `openIssues` gives none. Without `--suggest`, or with
 * `--no-proposals`, no tracker is resolved and no `gh` runs.
 *
 * ## Seams
 *
 * {@link createCodesCommand} takes the {@link IssueSeams} the chain is
 * resolved with; the registered command passes `DEFAULT_ISSUE_SEAMS`.
 *
 * Exit code 0, except: 1 for an argument, a flag given no value or a
 * blank one, `--suggest` beside `--check`, `--no-proposals` without
 * `--suggest`, a `--family` nobody declares
 * and a config the reader refuses; and 1 for `--check` over a list holding a pair that reads
 * alike, after the pairs in text mode.
 */
import type { CodeProposal, CodeSuggestion, NearDuplicate } from '../../errors/match.js';
import type { RafaCommand, RafaContext } from '@open-tomato/rafa/core/command';
import type { RafaConfig } from '@open-tomato/rafa/core/config';
import type { ErrorCodeEntry } from '@open-tomato/rafa/errors/codes';
import type { ListedCode } from '@open-tomato/rafa/errors/rafa-codes';
import type { ProjectFound } from '@open-tomato/rafa/project/scope';
import type { IssueSeams } from '@open-tomato/rafa-board';

import {
  DEFAULT_ISSUE_SEAMS,
  createGhRunner,
  issueName,
  lineRefusal,
  readNonBlankFlag,
  resolveTracker,
} from '@open-tomato/rafa-board';

import { activeLogger } from '@open-tomato/rafa/adapters/logger/active';
import { parseBugRecord } from '@open-tomato/rafa/bugs/record';
import { expectNoArgument, readSwitch, requireProject, resolveProjectConfig } from '@open-tomato/rafa/commands/plan/plan-files';
import { CommandExit } from '@open-tomato/rafa/core/command';
import { messageOf } from '@open-tomato/rafa/core/config/sections';
import { familyOf, NEW_CONTEXT_LEAF, UNKNOWN_FAMILY } from '@open-tomato/rafa/errors/codes';
import { FAMILY_DESCRIPTIONS, listedCodes } from '@open-tomato/rafa/errors/rafa-codes';

import { nearDuplicates, suggestWithProposals } from '../../errors/match.js';

/** The command's spelling, as its refusals name it. */
const COMMAND_NAME = 'rafa bug codes';

/** The line the refusals end with. */
export const CODES_USAGE = 'rafa bug codes [--suggest=<text> [--no-proposals]] [--family=<family>] [--check]';

const SUGGEST_FLAG = 'suggest';
const FAMILY_FLAG = 'family';
const CHECK_FLAG = 'check';
/** Read as `proposals`: the parser answers `--no-proposals` as `proposals: false`. */
const PROPOSALS_FLAG = 'proposals';

/** How long one `gh` call of the proposals read may run before it is killed: 60 seconds. */
export const PROPOSALS_GH_TIMEOUT_MS = 60_000;

/** The cause code of a warning that the proposals could not be read. */
const PROPOSALS_UNREAD_CODE = 'tracker:unavailable';

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
  /** The codes open bugs proposed, ranked beside the list's under `suggest`. */
  readonly proposals?: readonly CodeProposal[];
}

/** What `rafa bug codes` answers; the json result's data. */
export interface CodesReport {
  /** The families listed, alphabetically. */
  readonly families: readonly CodeFamily[];
  /** The codes listed: rafa's, then the project's, each in its own order. */
  readonly codes: readonly ListedCode[];
  /** The text `--suggest` gave, or null without it. */
  readonly suggestFor: string | null;
  /**
   * The codes closest to that text, best first, the open bugs' proposals
   * among them, or null without `--suggest`.
   */
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

/**
 * The proposals `--suggest` ranks: none already a code of `all`, the
 * whole list, and only those of `family` when one is named.
 */
function rankedProposals(
  all: readonly ListedCode[],
  family: string | undefined,
  proposals: readonly CodeProposal[],
): readonly CodeProposal[] {
  const listed = new Set(all.map((entry) => entry.code));
  return proposals
    .filter((proposal) => !listed.has(proposal.code))
    .filter((proposal) => family === undefined || familyOf(proposal.code) === family);
}

/** The report for `projectCodes` beside rafa's own, as `query` narrows it. */
export function codesReport(projectCodes: readonly ErrorCodeEntry[], query: CodesQuery): CodesReport {
  const all = listedCodes(projectCodes);
  const codes = query.family === undefined
    ? all
    : all.filter((entry) => familyOf(entry.code) === query.family);
  const proposals = rankedProposals(all, query.family, query.proposals ?? []);
  return {
    families: familiesOf(codes),
    codes,
    suggestFor: query.suggest ?? null,
    suggestions: query.suggest === undefined
      ? null
      : suggestWithProposals(query.suggest, codes, proposals),
    nearDuplicates: query.check
      ? nearDuplicates(codes)
      : null,
  };
}

/** A score from 0 to 1 as a whole percentage. */
function percent(score: number): string {
  return `${Math.round(score * 100)}%`;
}

/** One line of `--suggest`: a listed code with its description, or a proposal with its bug. */
function suggestionLine(row: CodeSuggestion, described: ReadonlyMap<string, string>): string {
  const tail = row.issue === null
    ? described.get(row.code) ?? ''
    : `proposed by ${issueName(row.issue)}`;
  return `  ${row.code}  ${percent(row.score)}  ${tail}`;
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
    ...suggestions.map((row) => suggestionLine(row, described)),
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

/** Writes `message` as a `warn` entry of the command's child of the active logger. */
function warnProposalsUnread(message: string): void {
  activeLogger().child({ module: 'bug', action: 'codes' })
    .log({ level: 'warn', message, code: PROPOSALS_UNREAD_CODE });
}

/**
 * The codes the open bugs' records propose, each with its bug, in the
 * order the tracker lists them; see the module note. Never throws: a
 * chain landing nowhere or a listing that fails warns and answers none.
 */
export async function readProposals(
  project: ProjectFound,
  config: RafaConfig,
  seams: IssueSeams,
): Promise<readonly CodeProposal[]> {
  try {
    const { tracker } = await resolveTracker({
      config,
      context: {
        repoRoot: project.root,
        gh: seams.gh ?? createGhRunner({ cwd: project.root, timeoutMs: PROPOSALS_GH_TIMEOUT_MS }),
      },
      registry: seams.registry,
    });
    if (tracker.openIssues === undefined) return [];
    const bugs = await tracker.openIssues('bug');
    return bugs.flatMap((bug): CodeProposal[] => {
      const { proposed } = parseBugRecord(bug.body);
      return proposed === null
        ? []
        : [{ code: proposed, title: bug.title, issue: bug.ref }];
    });
  } catch (error) {
    warnProposalsUnread(`suggesting without the open bugs' proposals: ${messageOf(error)}`);
    return [];
  }
}

/** What the line asks of the command, read and refused before any project is. */
interface CodesLine {
  readonly check: boolean;
  readonly suggest: string | undefined;
  readonly family: string | undefined;
  readonly proposals: boolean;
}

/** The flags of the line; see the module note for what is refused. */
function readCodesLine(context: RafaContext): CodesLine {
  expectNoArgument(context.args, CODES_USAGE);
  const check = readSwitch(CHECK_FLAG, context.flags[CHECK_FLAG], `Usage: ${CODES_USAGE}`);
  const proposals = readSwitch(PROPOSALS_FLAG, context.flags[PROPOSALS_FLAG] ?? true, `Usage: ${CODES_USAGE}`);
  const suggest = readNonBlankFlag(context.flags, SUGGEST_FLAG, CODES_USAGE);
  const family = readNonBlankFlag(context.flags, FAMILY_FLAG, CODES_USAGE);
  if (suggest !== undefined && check) {
    throw lineRefusal(`--${SUGGEST_FLAG} and --${CHECK_FLAG} answer two questions: give one`, CODES_USAGE);
  }
  if (suggest === undefined && !proposals) {
    throw lineRefusal(`--no-${PROPOSALS_FLAG} only narrows --${SUGGEST_FLAG}: give both or neither`, CODES_USAGE);
  }
  return { check, suggest, family, proposals };
}

/** Runs `rafa bug codes` over `seams`; see the module note. */
export async function runCodes(context: RafaContext, seams: IssueSeams): Promise<void> {
  const { check, suggest, family, proposals: readsProposals } = readCodesLine(context);
  const project = requireProject(context, COMMAND_NAME);
  const config = await resolveProjectConfig(project, COMMAND_NAME, (message) => {
    context.output.warn(message);
  });
  const proposals = suggest !== undefined && readsProposals
    ? await readProposals(project, config, seams)
    : [];

  const report = codesReport(config.errorsCodes, { suggest, family, check, proposals });
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

/** `rafa bug codes` over `seams`, as the registry holds it with `DEFAULT_ISSUE_SEAMS`. */
export function createCodesCommand(seams: IssueSeams): RafaCommand {
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
      + 'with any code says so with exit code 0. `--suggest` reads the tracker too: the `Proposed cause` of each open '
      + 'bug is ranked beside the codes, its line naming the bug that proposed it, and a tracker that cannot be read '
      + 'is a warning, the codes ranked without proposals. `--no-proposals` skips the read, and is refused without '
      + '`--suggest`. `--check` prints the pairs of codes of one family that read alike '
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
      {
        name: PROPOSALS_FLAG,
        description: 'Rank the open bugs\' proposed codes beside the list\'s under --suggest; `--no-proposals` reads no tracker.',
        type: 'boolean',
        default: true,
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
        note: 'Ranks the closest codes, git:no-identity first, beside the codes open bugs proposed.',
      },
      {
        cmd: 'rafa bug codes --suggest="branch not found" --no-proposals',
        note: 'Ranks the list\'s codes alone, reading no tracker.',
      },
      { cmd: 'rafa bug codes --family=git', note: 'Prints the git family alone.' },
      { cmd: 'rafa bug codes --check', note: 'Exits 1 when two codes of one family read alike, naming each pair.' },
    ],
    outputs: ['text', 'json'],
    run: async (context) => {
      await runCodes(context, seams);
      await Promise.resolve();
    },
  };
  return Object.freeze(command);
}

const command: RafaCommand = createCodesCommand(DEFAULT_ISSUE_SEAMS);
export default command;
