/**
 * `rafa skill list [--source=<source>] [--state=<state>]
 * [--hidden-from-loop]`: every skill the inventory holds, each with
 * its source, its state, whether a loop session resolves it, and its
 * own summary.
 *
 * `rafa skill check <dir>` answers one directory in detail and exits
 * with its failures. This command answers the other question: what is
 * INSTALLED, where each one comes from, which holder of a name answers,
 * and which of them a session the loop spawns can reach. Every row is
 * an {@link InventoryRecord} of kind `skill` as `buildInventory`
 * (`src/inventory/index.ts`) decides it, so precedence, `shadowed-by:`,
 * `disabled:` and `visibleToLoop` are decided there and only there,
 * and this command filters and prints them.
 *
 * ## What the inventory is built against
 *
 * The project the dispatcher found gives the root and the home, the
 * project's config gives `loop.settingSources`, which decides
 * `visibleToLoop`, and the config's `modules:` are loaded as
 * `rafa module list` loads them, since only a `loaded` module is an
 * add-on source. A config `loadConfig` refuses is a refusal here too.
 * The rafa tier is measured from this process's entry, which under
 * `bun test` is the test runner rather than a `cli.js`, so the entry is
 * {@link SkillListSeams.entry}, `Bun.main` by default and a planted
 * file in a test; the module loader's seams are
 * {@link SkillListSeams.modules}.
 *
 * ## The three filters
 *
 * Each narrows the rows, and together they narrow by all three:
 *
 *   - `--source=<source>` keeps the rows whose source is the whole
 *     string given: `project`, `rafa`, `user`, or a `plugin:<name>` or
 *     `addon:<name>` the inventory knows, from a row of either kind or
 *     a warning about it. `--tier` is an alias, kept for one release
 *     after this one, since that was this flag's name when the command
 *     listed the three tiers alone. A plugin or add-on the inventory
 *     does not know is refused rather than answered with no rows, so a
 *     typo never reads as an empty source.
 *   - `--state=<state>` takes `enabled`, `shadowed` or `disabled` and
 *     keeps the rows whose state begins with it, so `shadowed` keeps
 *     every `shadowed-by:<source>` and `disabled` every
 *     `disabled:<how>`.
 *   - `--hidden-from-loop` keeps the rows with `visibleToLoop: false`.
 *
 * ## What each row says
 *
 * A mark, `●` when a loop session resolves the skill and `○` when it
 * does not, then its name, its source, its state and its summary, which
 * is the skill's own `description` cut at 130 characters and empty when
 * it has none. The columns are padded to the widest cell among the rows
 * printed. A skills tree whose directory is not there is a line of its
 * own after the rows, as long as `--source` leaves its tier in, so
 * "holds nothing" and "is not there" stay two answers.
 *
 * ## Warnings
 *
 * A plugin record, plugin, add-on manifest, settings file or
 * `skillOverrides` entry that does not read is one warning each,
 * through the active output (`warn: ` on stdout in text mode), and the
 * same warnings are in json mode's `data`. None drops a row another
 * source could read.
 *
 * ## The exit code is 0 whatever the rows say
 *
 * A listing reports; it does not gate. A source full of failing skills
 * still exits 0, and each row's `check` is in json mode's `data`.
 * Exit code 1 is kept for the refusals: a positional word, a `--source`
 * or `--state` naming nothing it can take, and a config that cannot be
 * used.
 */
import type { RafaCommand, RafaContext } from '../../cli/command.js';
import type { ClaudeSettingSource } from '../../config-sections.js';
import type { Inventory } from '../../inventory/index.js';
import type { InventoryRecord } from '../../inventory/record.js';
import type { ModuleLoadSeams } from '../../modules/load.js';
import type { ProjectFound } from '../../project/scope.js';

import { pathDirectories } from '../../check/references.js';
import { CommandExit } from '../../cli/command.js';
import { loadConfig } from '../../config-load.js';
import { ConfigError } from '../../config.js';
import { buildInventory } from '../../inventory/index.js';
import { loadModules, moduleSettings } from '../../modules/load.js';
import { isSkillTier, SKILL_TIERS } from '../../schema/tiers.js';
import { expectNoArgument } from '../plan/plan-files.js';

/** What neither the context nor the registry carries. */
export interface SkillListSeams {
  /** This process's entry, which the rafa tier sits beside. */
  readonly entry: () => string;
  /** What the config's modules are loaded through. */
  readonly modules: ModuleLoadSeams;
}

/** The seams the registered command runs with. */
export const DEFAULT_SKILL_LIST_SEAMS: SkillListSeams = Object.freeze({
  entry: () => Bun.main,
  modules: Object.freeze({}),
});

/** The usage line a refusal names. */
const USAGE = 'rafa skill list [--source=<source>] [--state=enabled|shadowed|disabled] [--hidden-from-loop]';

/** The words `--state` takes, each matched as a prefix of a row's state. */
export const STATE_FILTERS = ['enabled', 'shadowed', 'disabled'] as const;

/** One of {@link STATE_FILTERS}. */
export type StateFilter = (typeof STATE_FILTERS)[number];

/** The prefixes a named source is written with. */
const NAMED_SOURCE_PREFIXES: readonly string[] = ['plugin:', 'addon:'];

/** The mark a row visible to the loop carries, and the one a hidden row does. */
export const VISIBLE_MARK = '●';
export const HIDDEN_MARK = '○';

/** The three filters a line gives, each null or false when left out. */
export interface SkillListFilters {
  /** The whole source string `--source` gave. */
  readonly source: string | null;
  /** The state prefix `--state` gave. */
  readonly state: StateFilter | null;
  /** Whether `--hidden-from-loop` was given. */
  readonly hiddenFromLoop: boolean;
}

/** A skills tree, without its rows, which the listing carries instead. */
export interface SkillTreeListing {
  /** Which tier. */
  readonly source: string;
  /** The directory it resolved to, or null for the project tier with no project root. */
  readonly dir: string | null;
  /** Whether that directory is there at all. */
  readonly exists: boolean;
}

/** What json mode gives as the terminal result's `data`. */
export interface SkillListResult {
  /** The project the inventory was built in. */
  readonly projectRoot: string;
  /** `loop.settingSources`, which decided each row's `visibleToLoop`. */
  readonly settingSources: readonly ClaudeSettingSource[];
  /** The filters the line gave. */
  readonly filters: SkillListFilters;
  /** The rows the filters kept, in the inventory's order. */
  readonly skills: readonly InventoryRecord[];
  /** How many skills the inventory holds before any filter. */
  readonly total: number;
  /** The skills trees `--source` leaves in, absent ones included. */
  readonly trees: readonly SkillTreeListing[];
  /** One line per source or settings file that did not read. */
  readonly warnings: readonly string[];
}

/** A string flag's value, or null when the line left it out. */
function stringFlag(value: string | boolean | undefined, flag: string, placeholder: string): string | null {
  if (value === undefined || value === false) return null;
  if (typeof value !== 'string' || value === '') {
    throw new CommandExit(1, `❌ --${flag} needs a value: --${flag}=<${placeholder}>\nUsage: ${USAGE}`);
  }
  return value;
}

/** Whether `value` is written as a source can be: a tier, or `plugin:<name>` or `addon:<name>`. */
export function isSourceShape(value: string): boolean {
  if (isSkillTier(value)) return true;
  return NAMED_SOURCE_PREFIXES.some((prefix) => value.startsWith(prefix) && value.length > prefix.length);
}

/** The source `--source` (or `--tier`) names, or null; refused when no source is written so. */
export function readSourceFlag(value: string | boolean | undefined): string | null {
  const source = stringFlag(value, 'source', 'source');
  if (source === null || isSourceShape(source)) return source;
  throw new CommandExit(
    1,
    `❌ --source is "${source}", expected one of: ${SKILL_TIERS.join(', ')}, plugin:<name>, addon:<name>\nUsage: ${USAGE}`,
  );
}

/** The state prefix `--state` names, or null; refused when it is none of {@link STATE_FILTERS}. */
export function readStateFlag(value: string | boolean | undefined): StateFilter | null {
  const state = stringFlag(value, 'state', 'state');
  if (state === null) return null;
  const known = STATE_FILTERS.find((filter) => filter === state);
  if (known !== undefined) return known;
  throw new CommandExit(1, `❌ --state is "${state}", expected one of: ${STATE_FILTERS.join(', ')}\nUsage: ${USAGE}`);
}

/** The three filters a line gives. */
export function readFilters(flags: Readonly<Record<string, string | boolean | undefined>>): SkillListFilters {
  return {
    source: readSourceFlag(flags['source']),
    state: readStateFlag(flags['state']),
    hiddenFromLoop: flags['hidden-from-loop'] === true,
  };
}

/**
 * Every source the inventory knows, in the order it first meets them:
 * the three tiers, then each source a row of either kind or a warning
 * names.
 */
export function knownSources(inventory: Inventory): readonly string[] {
  const named = [
    ...inventory.records.map((record) => record.source),
    ...inventory.warnings.map((warning) => warning.source),
  ].filter((source) => NAMED_SOURCE_PREFIXES.some((prefix) => source.startsWith(prefix)));
  return [...new Set<string>([...SKILL_TIERS, ...[...named].sort()])];
}

/** Refuses a `plugin:` or `addon:` source the inventory does not know. */
export function expectKnownSource(source: string | null, inventory: Inventory): void {
  if (source === null) return;
  const known = knownSources(inventory);
  if (known.includes(source)) return;
  throw new CommandExit(1, `❌ --source is "${source}", which no skill, agent or warning here comes from;`
    + ` known sources: ${known.join(', ')}\nUsage: ${USAGE}`);
}

/** Whether a row passes every filter given. */
export function matchesFilters(record: InventoryRecord, filters: SkillListFilters): boolean {
  if (filters.source !== null && record.source !== filters.source) return false;
  if (filters.state !== null && !record.state.startsWith(filters.state)) return false;
  return !(filters.hiddenFromLoop && record.visibleToLoop);
}

/** The inventory's warnings, each as one line. */
export function warningLines(inventory: Inventory): readonly string[] {
  return [
    ...inventory.warnings.map((warning) => `${warning.source}: ${warning.path}: ${warning.reason}`),
    ...inventory.overrideWarnings.map((warning) => `${warning.path}: ${warning.reason}`),
  ];
}

/** The listing's data: the skills the filters keep, and the trees `--source` leaves in. */
export function skillListing(
  inventory: Inventory,
  filters: SkillListFilters,
  place: { readonly projectRoot: string; readonly settingSources: readonly ClaudeSettingSource[] },
): SkillListResult {
  const skills = inventory.records.filter((record) => record.kind === 'skill');
  return {
    projectRoot: place.projectRoot,
    settingSources: place.settingSources,
    filters,
    skills: skills.filter((record) => matchesFilters(record, filters)),
    total: skills.length,
    trees: inventory.trees
      .filter((listing) => listing.kind === 'skill')
      .filter((listing) => filters.source === null || listing.source === filters.source)
      .map((listing) => ({ source: listing.source, dir: listing.dir, exists: listing.exists })),
    warnings: warningLines(inventory),
  };
}

/** A row's cells, in column order. */
function rowCells(record: InventoryRecord): readonly string[] {
  return [record.name, record.source, record.state, record.summary];
}

/** The mark a row opens with. */
function loopMark(record: InventoryRecord): string {
  return record.visibleToLoop
    ? VISIBLE_MARK
    : HIDDEN_MARK;
}

/** The rows as text mode writes them: the mark, then every column but the last padded to its widest cell. */
export function skillRowLines(skills: readonly InventoryRecord[]): readonly string[] {
  const rows = skills.map(rowCells);
  const widths = rows.reduce<readonly number[]>(
    (widest, cells) => cells.map((cell, index) => Math.max(widest[index] ?? 0, cell.length)),
    [],
  );
  return skills.map((skill, row) => {
    const cells = rows[row] ?? [];
    const padded = cells.map((cell, index) => (index === cells.length - 1
      ? cell
      : cell.padEnd(widths[index] ?? 0)));
    return `  ${loopMark(skill)} ${padded.join('  ')}`.trimEnd();
  });
}

/** The heading: the project, then each filter the line gave. */
export function listHeading(result: SkillListResult): string {
  const { source, state, hiddenFromLoop } = result.filters;
  const narrowed = [
    source === null
      ? null
      : `source ${source}`,
    state === null
      ? null
      : `state ${state}`,
    hiddenFromLoop
      ? 'hidden from the loop'
      : null,
  ].filter((part): part is string => part !== null);
  const scope = narrowed.length === 0
    ? ''
    : `; ${narrowed.join(', ')}`;
  return `Skills (project: ${result.projectRoot}${scope}):`;
}

/** Every line text mode writes: the heading, the rows, the absent trees, then the counts and the legend. */
export function renderSkillList(result: SkillListResult): readonly string[] {
  const rows = result.skills.length === 0
    ? ['  (no skill matches)']
    : skillRowLines(result.skills);
  const absent = result.trees
    .filter((listing) => !listing.exists)
    .map((listing) => `  ${listing.source}  ${listing.dir ?? '(no project root)'}  (no such directory)`);
  const visible = result.skills.filter((record) => record.visibleToLoop).length;
  return [
    listHeading(result),
    ...rows,
    ...absent,
    `${String(result.skills.length)} of ${String(result.total)} skill(s) listed,`
      + ` ${String(visible)} visible to the loop (loop.settingSources: ${result.settingSources.join(', ')})`,
    `${VISIBLE_MARK} a loop session resolves it, ${HIDDEN_MARK} it does not`,
  ];
}

/** The project the dispatcher resolved, which this command declares it needs. */
function projectOf(context: RafaContext): ProjectFound {
  if (context.project === null) throw new Error('rafa skill list runs inside a project, and was handed none');
  return context.project;
}

/** The inventory of `project`, under its config's setting sources and loaded modules. */
async function projectInventory(
  project: ProjectFound,
  context: RafaContext,
  seams: SkillListSeams,
): Promise<{ readonly inventory: Inventory; readonly settingSources: readonly ClaudeSettingSource[] }> {
  try {
    const resolved = loadConfig({ root: project.root, home: project.home });
    const loaded = await loadModules(moduleSettings(resolved, project), seams.modules);
    const { settingSources } = resolved.config;
    const inventory = buildInventory({
      home: project.home,
      projectRoot: project.root,
      entry: seams.entry(),
      pathDirs: pathDirectories(context.env['PATH']),
      settingSources,
      modules: loaded.modules,
    });
    return { inventory, settingSources };
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    throw new CommandExit(1, ['❌ rafa skill list: the config cannot be used:', ...error.problems.map((problem) => `  ${problem}`)].join('\n'));
  }
}

/** Lists the skills. See the module note. */
async function runList(context: RafaContext, seams: SkillListSeams): Promise<void> {
  const filters = readFilters(context.flags);
  expectNoArgument(context.args, USAGE);
  const project = projectOf(context);
  const { inventory, settingSources } = await projectInventory(project, context, seams);
  expectKnownSource(filters.source, inventory);

  const result = skillListing(inventory, filters, { projectRoot: project.root, settingSources });
  for (const warning of result.warnings) context.output.warn(warning);
  if (context.outputMode === 'json') {
    context.output.result(result);
    return;
  }
  for (const line of renderSkillList(result)) context.output.info(line);
}

/** The command, measuring the rafa tier and loading modules through `seams`. See the module note. */
export function createSkillListCommand(seams: SkillListSeams = DEFAULT_SKILL_LIST_SEAMS): RafaCommand {
  const command: RafaCommand = {
    name: 'skill list',
    subject: 'skill',
    action: 'list',
    summary: 'list every skill with its source, its state and whether the loop sees it',
    description: 'Lists every skill the inventory holds — the project\'s `.claude/skills`, the `skills/`'
      + ' directory beside the running rafa, `~/.claude/skills`, each loaded add-on\'s and each installed'
      + ' plugin\'s — one row each: a mark saying whether a session the loop spawns under'
      + ' `loop.settingSources` resolves it, its name, its source, its state (`enabled`,'
      + ' `shadowed-by:<source>` when a nearer source holds the same name, or `disabled:<how>`) and its own'
      + ' description as the summary. `--source=<source>` keeps one source, `plugin:<name>` and'
      + ' `addon:<name>` included; `--state=<state>` keeps `enabled`, `shadowed` or `disabled` rows;'
      + ' `--hidden-from-loop` keeps the rows no loop session resolves. The filters combine. A skills'
      + ' directory that is not there says so, and a source that does not read is a warning. The exit code'
      + ' is 0 whatever the rows say: this command reports and `rafa skill check` gates. With'
      + ' `--output=json` the rows, each with its checker verdict, are the data of the terminal result event.',
    args: [],
    flags: [
      {
        name: 'source',
        description: `List one source alone: ${SKILL_TIERS.join(', ')}, plugin:<name> or addon:<name>.`
          + ' `--tier` is an alias, removed after one release.',
        type: 'string',
        aliases: ['tier'],
      },
      {
        name: 'state',
        description: `List the rows in one state alone: ${STATE_FILTERS.join(', ')}.`,
        type: 'string',
      },
      {
        name: 'hidden-from-loop',
        description: 'List the rows no session the loop spawns resolves.',
        type: 'boolean',
      },
    ],
    examples: [
      {
        cmd: 'rafa skill list',
        note: 'Lists every skill, each with its source, its state and whether the loop sees it.',
      },
      {
        cmd: 'rafa skill list --source=user --state=shadowed',
        note: 'Lists the `~/.claude/skills` skills a nearer source holds the name of.',
      },
      {
        cmd: 'rafa skill list --hidden-from-loop',
        note: 'Lists the skills a loop session does not resolve under `loop.settingSources`.',
      },
      {
        cmd: 'rafa skill list --output=json',
        note: 'Writes a start event, then a result event whose data holds every row with its checker verdict.',
      },
    ],
    outputs: ['text', 'json'],
    run: async (context) => {
      await runList(context, seams);
    },
  };
  return Object.freeze(command);
}

export default createSkillListCommand();
