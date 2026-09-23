/**
 * `rafa skill search "<question>" [--all] [--no-model]`: the skills that
 * answer a question, found by the search runner of
 * `src/inventory/search/` and printed with the quote each was kept on.
 *
 * `rafa skill list` says what is installed; this command says which of
 * it answers a question put in words. The runner does the work in two
 * code steps around one Claude session: it ranks the inventory by the
 * question's words and keeps the top twelve, hands those twelve to one
 * `haiku` session that may only read them, and keeps each match whose
 * quote is in its file near the line given. This module reads the line,
 * builds the inventory, runs the runner once per kind searched and
 * prints what it answers. `rafa agent search` is the same command over
 * agent definitions, through {@link createSearchCommand}.
 *
 * ## What the inventory is built against
 *
 * Exactly what `rafa skill list` builds it against, through the
 * `projectInventory` that command exports: the project the dispatcher
 * resolved, its config's `loop.settingSources`, the modules
 * `loadModules` answers `loaded`, and the rafa tier beside
 * {@link SearchSeams.entry}. A config `loadConfig` refuses is exit
 * code 1. The runner ranks only the first holder of each name, the one
 * a session would load.
 *
 * ## `--all` and `--no-model`
 *
 * `--all` searches skills and agent definitions both, the command's own
 * kind first. It runs the runner once per kind, so a model search under
 * `--all` starts two sessions, one per kind, and stores two effort rows:
 * a candidate is keyed by its name alone, and a skill and an agent may
 * share one.
 *
 * `--no-model` runs step one alone, the keyword ranking, prints it and
 * stops: no session starts, no scratch copy is made and no effort row is
 * written. The command's `spends` declaration is `unless --no-model`, so
 * the spend guard in `src/utils/claude.ts` refuses a session that a run
 * carrying `--no-model` would start.
 *
 * ## What each kind prints
 *
 * A heading naming the kind, the question and the project, then one of:
 *
 *   - the ranking, one numbered row per candidate with its source, its
 *     score and its summary: under `--no-model`, and after a `warn: `
 *     line when the session gave no usable answer (the runner's
 *     `fallback`, whose notice is that line);
 *   - each kept match, its name, source and `why`, then its quote and
 *     the file and line it was found at, and the runner's dropped line
 *     ("1 match dropped: its quote is not in the file") when the quote
 *     check dropped any;
 *   - "not answerable from these files" when the session said so;
 *   - `(no skill ranks for these words)` when nothing ranked, in which
 *     case no session started.
 *
 * Each entry the block parser could not use, and an effort row that was
 * not stored, is one `warn: ` line: neither fails the search.
 *
 * ## The exit code
 *
 * A search reports; it exits 0 whatever it found. Exit code 1 is kept for
 * the refusals: no question or more than one, a blank question, a value
 * read into `--all` or `--no-model`, and a config that cannot be used. A
 * spawner that throws, the spend guard's refusal included, is the
 * dispatcher's to report.
 *
 * ## Json mode
 *
 * The terminal result's `data` is a {@link SearchCommandResult}: the
 * project, `loop.settingSources`, the question, whether a model ran, the
 * inventory's warnings, and one entry per kind searched holding the
 * runner's whole outcome (ranking, kept matches with their records,
 * dropped count, parser issues, notice, effort write), or the ranking
 * alone under `--no-model`, as status `ranked`.
 */
import type { SkillListSeams } from './list.js';
import type { RafaCommand, RafaContext } from '../../cli/command.js';
import type { ClaudeSettingSource } from '../../config-sections.js';
import type { EffortStore } from '../../effort/store/types.js';
import type { InventoryKind, InventoryRecord } from '../../inventory/record.js';
import type { SearchOutcome } from '../../inventory/search/index.js';
import type { RankedCandidate } from '../../inventory/search/rank.js';
import type { ProjectFound } from '../../project/scope.js';
import type { CapturingSpawner } from '../../utils/claude.js';

import { CommandExit } from '../../cli/command.js';
import { loadConfig } from '../../config-load.js';
import { selectEffortStore } from '../../effort/store/index.js';
import { droppedLine, rankSearch, runSearch } from '../../inventory/search/index.js';
import { expectOneArgument, readSwitch } from '../plan/plan-files.js';

import { DEFAULT_SKILL_LIST_SEAMS, projectInventory, warningLines } from './list.js';

/** What the search commands run with beyond the listing's seams. */
export interface SearchSeams extends SkillListSeams {
  /** The session spawner; the real capturing door when left out. */
  readonly spawn?: CapturingSpawner;
  /** Where the scratch copy is made; the temp directory when left out. */
  readonly scratchRoot?: string;
  /** Picks each session's id; `randomUUID` when left out. */
  readonly sessionId?: () => string;
}

/** The seams the registered commands run with. */
export const DEFAULT_SEARCH_SEAMS: SearchSeams = DEFAULT_SKILL_LIST_SEAMS;

/** One kind's search as json mode gives it: the runner's outcome, or the ranking alone. */
export type KindSearch =
  | ({ readonly kind: InventoryKind } & SearchOutcome)
  | { readonly kind: InventoryKind; readonly status: 'ranked'; readonly ranking: readonly RankedCandidate[] };

/** What json mode gives as the terminal result's `data`. */
export interface SearchCommandResult {
  /** The project the inventory was built in. */
  readonly projectRoot: string;
  /** `loop.settingSources`, which the sessions were spawned under. */
  readonly settingSources: readonly ClaudeSettingSource[];
  /** The question as typed. */
  readonly question: string;
  /** False under `--no-model`, when no session started. */
  readonly model: boolean;
  /** One entry per kind searched, the command's own kind first. */
  readonly searches: readonly KindSearch[];
  /** One line per source or settings file that did not read. */
  readonly warnings: readonly string[];
}

/** The line a search command is read from. */
interface SearchLine {
  readonly question: string;
  readonly kinds: readonly InventoryKind[];
  readonly model: boolean;
}

/** The other kind. */
function otherKind(kind: InventoryKind): InventoryKind {
  return kind === 'skill'
    ? 'agent'
    : 'skill';
}

/** `rafa <kind> search "<question>" [--all] [--no-model]`. */
function usageOf(kind: InventoryKind): string {
  return `rafa ${kind} search "<question>" [--all] [--no-model]`;
}

/**
 * The question, the kinds and whether a model runs, from the line. The
 * switches are read ahead of the question, as `rafa skill show` reads
 * `--full`, since `--all "<question>"` hands the question to `--all`.
 */
export function readSearchLine(context: Pick<RafaContext, 'args' | 'flags'>, kind: InventoryKind): SearchLine {
  const usage = usageOf(kind);
  const hint = `Type the question ahead of it: ${usage}`;
  const all = readSwitch('all', context.flags['all'], hint);
  const model = readSwitch('model', context.flags['model'] ?? true, hint);
  const question = expectOneArgument(context.args, usage);
  if (question.trim() === '') throw new CommandExit(1, `❌ The question is blank.\nUsage: ${usage}`);
  const kinds = all
    ? [kind, otherKind(kind)]
    : [kind];
  return { question, kinds, model };
}

/** The ranking as numbered rows: name, source and score padded, then the summary. */
export function rankingLines(ranking: readonly RankedCandidate[]): readonly string[] {
  const cells = ranking.map(({ record, score }) => [record.name, record.source, `score ${String(score)}`]);
  const widths = cells.reduce<readonly number[]>(
    (widest, row) => row.map((cell, index) => Math.max(widest[index] ?? 0, cell.length)),
    [],
  );
  const number = String(ranking.length).length;
  return ranking.map(({ record }, row) => {
    const padded = (cells[row] ?? []).map((cell, index) => cell.padEnd(widths[index] ?? 0));
    return `  ${String(row + 1).padStart(number)}. ${[...padded, record.summary].join('  ')}`.trimEnd();
  });
}

/** One kept match as two lines: who and why, then the quote and where it was found. */
function matchLines(match: { readonly record: InventoryRecord; readonly why: string; readonly quote: string; readonly line: number }): readonly string[] {
  return [
    `  ${match.record.name} (${match.record.source}): ${match.why}`,
    `    "${match.quote}" (${match.record.path}:${String(match.line)})`,
  ];
}

/** The heading of one kind's section. */
function headingOf(search: KindSearch, question: string, projectRoot: string): string {
  const plural = `${search.kind === 'skill'
    ? 'Skills'
    : 'Agents'}`;
  const how = search.status === 'ranked'
    ? '; keyword ranking, no session'
    : '';
  return `${plural} for "${question}" (project: ${projectRoot}${how}):`;
}

/** The body lines of one kind's section, below its heading. */
function bodyLines(search: KindSearch): readonly string[] {
  switch (search.status) {
    case 'no-candidates':
      return [`  (no ${search.kind} ranks for these words)`];
    case 'ranked':
    case 'fallback':
      return rankingLines(search.ranking);
    case 'unanswerable':
      return [`  ${search.text}`];
    case 'answered': {
      const kept = search.matches.length === 0
        ? ['  (no match kept)']
        : search.matches.flatMap(matchLines);
      const dropped = droppedLine(search.dropped);
      return dropped === ''
        ? kept
        : [...kept, dropped];
    }
  }
}

/** The warnings one kind's search raises: the notice, the parser's issues, an unstored effort row. */
export function searchWarnings(search: KindSearch): readonly string[] {
  if (search.status === 'ranked' || search.status === 'no-candidates') return [];
  const notice = search.status === 'fallback'
    ? [search.notice]
    : [];
  const issues = search.status === 'answered'
    ? search.issues.map((issue) => `${issue.field}: ${issue.text}`)
    : [];
  const effort = search.effort.written
    ? []
    : [`the ${search.kind} search session's effort row was not stored: ${search.effort.reason}`];
  return [...notice, ...issues, ...effort];
}

/** Every line text mode writes for one kind: the heading, then its body. */
export function renderKindSearch(search: KindSearch, question: string, projectRoot: string): readonly string[] {
  return [headingOf(search, question, projectRoot), ...bodyLines(search)];
}

/** The project the dispatcher resolved, which this command declares it needs. */
function projectOf(context: RafaContext, kind: InventoryKind): ProjectFound {
  if (context.project === null) throw new Error(`rafa ${kind} search runs inside a project, and was handed none`);
  return context.project;
}

/** The store the `search` rows go to: the one the project's config names. */
function storeOf(project: ProjectFound): EffortStore {
  const resolved = loadConfig({ root: project.root, home: project.home }, {}, () => undefined);
  return selectEffortStore(project.root, resolved.config);
}

/** Runs one search command. See the module note. */
async function runSearchCommand(context: RafaContext, seams: SearchSeams, kind: InventoryKind): Promise<void> {
  const line = readSearchLine(context, kind);
  const project = projectOf(context, kind);
  const { inventory, settingSources } = await projectInventory(project, context, seams, `rafa ${kind} search`);
  const warnings = warningLines(inventory);
  for (const warning of warnings) context.output.warn(warning);

  const store = line.model
    ? storeOf(project)
    : null;
  const searches: KindSearch[] = [];
  for (const searched of line.kinds) {
    const search: KindSearch = store === null
      ? { kind: searched, status: 'ranked', ranking: rankSearch(searched, line.question, inventory.records) }
      : {
        kind: searched,
        ...await runSearch({
          kind: searched,
          question: line.question,
          records: inventory.records,
          settingSources,
          store,
          home: project.home,
          ...(seams.spawn === undefined
            ? {}
            : { spawn: seams.spawn }),
          ...(seams.scratchRoot === undefined
            ? {}
            : { scratchRoot: seams.scratchRoot }),
          ...(seams.sessionId === undefined
            ? {}
            : { sessionId: seams.sessionId }),
        }),
      };
    searches.push(search);
    for (const warning of searchWarnings(search)) context.output.warn(warning);
    if (context.outputMode !== 'json') {
      for (const text of renderKindSearch(search, line.question, project.root)) context.output.info(text);
    }
  }

  if (context.outputMode === 'json') {
    const result: SearchCommandResult = {
      projectRoot: project.root,
      settingSources,
      question: line.question,
      model: line.model,
      searches,
      warnings,
    };
    context.output.result(result);
  }
}

/** The words a command's help uses for its kind. */
const KIND_WORDS: Readonly<Record<InventoryKind, { readonly plural: string; readonly other: string; readonly example: string }>> = {
  skill: { plural: 'skills', other: 'agent definitions', example: 'who writes TSDoc for exported symbols' },
  agent: { plural: 'agent definitions', other: 'skills', example: 'which agent reviews a diff for security' },
};

/** The search command for `kind`, running through `seams`. See the module note. */
export function createSearchCommand(kind: InventoryKind, seams: SearchSeams = DEFAULT_SEARCH_SEAMS): RafaCommand {
  const words = KIND_WORDS[kind];
  const command: RafaCommand = {
    name: `${kind} search`,
    subject: kind,
    action: 'search',
    summary: `find the ${words.plural} that answer a question, each with a quote from its file`,
    description: `Finds the ${words.plural} that answer a question. First, in code, the inventory \`rafa ${kind} list\``
      + ' reads is ranked by the question\'s words against each item\'s tags, `prevents`, `when_to_use`,'
      + ' description and body, and the top twelve are kept. Then one `haiku` session, given the tools'
      + ' `Read`, `Grep` and `Glob` and nothing else and run in a scratch copy of those twelve files, says'
      + ' which of them answer, each with a quote from its file. Then, in code, a match whose quote is not in'
      + ' its file within three lines of the line given is dropped and counted. A session that gives no'
      + ' usable answer prints the ranking with a notice. Each session stores one effort row of kind'
      + ` \`search\`. \`--no-model\` prints the ranking and starts no session. \`--all\` searches ${words.other}`
      + ' too, one session per kind. The exit code is 0 whatever is found. With `--output=json` each kind\'s'
      + ' ranking, kept matches and dropped count are the data of the terminal result event.',
    args: [
      {
        name: 'question',
        description: 'The question, quoted as one word.',
        type: 'string',
        required: true,
      },
    ],
    flags: [
      {
        name: 'all',
        description: `Search ${words.other} as well, one session per kind; type it after the question.`,
        type: 'boolean',
      },
      {
        name: 'model',
        description: 'Run the search session; `--no-model` prints the keyword ranking and starts none.',
        type: 'boolean',
        default: true,
      },
    ],
    examples: [
      {
        cmd: `rafa ${kind} search "${words.example}"`,
        note: `Ranks the ${words.plural}, asks one session which answer, and prints each match with its quote.`,
      },
      {
        cmd: `rafa ${kind} search "${words.example}" --no-model`,
        note: 'Prints the keyword ranking alone and starts no session.',
      },
      {
        cmd: `rafa ${kind} search "${words.example}" --all`,
        note: `Searches ${words.plural} and ${words.other}, one session each.`,
      },
      {
        cmd: `rafa ${kind} search "${words.example}" --output=json`,
        note: 'Writes a start event, then a result event holding the ranking, the kept matches and the dropped count.',
      },
    ],
    outputs: ['text', 'json'],
    spends: { when: 'unless', flag: '--no-model', what: 'one search session' },
    run: async (context) => {
      await runSearchCommand(context, seams, kind);
    },
  };
  return Object.freeze(command);
}

/** `rafa skill search` with the seams `rafa skill search` is created with. */
export function createSkillSearchCommand(seams: SearchSeams = DEFAULT_SEARCH_SEAMS): RafaCommand {
  return createSearchCommand('skill', seams);
}

export default createSkillSearchCommand();
