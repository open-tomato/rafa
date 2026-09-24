/**
 * `rafa agent list [--source=<source>] [--state=<state>]
 * [--hidden-from-loop] [-i]`: every agent definition the inventory holds,
 * each with its source, its state, whether a loop session resolves it,
 * and its own summary, then the vendor hint for the home definitions a
 * run cannot reach.
 *
 * Every row is an {@link InventoryRecord} of kind `agent` as
 * `buildInventory` (`src/inventory/index.ts`) decides it, so
 * precedence, `collision`, `shadowed-by:` and `visibleToLoop` are
 * decided there and only there, and this command filters and prints
 * them. A `collision` row is one of two loaded tiers' different
 * definitions under one name, which the loop serves neither of until a
 * `tiers.agents` pin settles it. A `rafa` row, from the
 * `bundled/agents` directory beside the running rafa, is visible when
 * it is served to a loop session (the winner of its name, admitted by
 * `serveVerdict`), and hidden otherwise. An agents tree
 * is read by its definitions' frontmatter `name`, the way Claude Code
 * resolves `--agent`, so a row names what a task routed
 * `agent=<name>` would reach. The Claude Code built-ins are not
 * inventory rows, since no file holds them, and are not listed; they
 * resolve under every source.
 *
 * ## What the inventory is built against
 *
 * The same as `rafa skill list` builds it: the project the dispatcher
 * found gives the root and the home, the project's config gives
 * `loop.settingSources`, which decides `visibleToLoop`, and
 * `tiers.rafa`, `tiers.skills` and `tiers.agents`, which `resolveTiers`
 * reads for a tier row's state, and the config's `modules:` are
 * loaded, only a `loaded` one being an add-on source. A config
 * `loadConfig` refuses is a refusal here too. The
 * rafa tier is measured from {@link AgentListSeams.entry}, `Bun.main`
 * by default and a planted file in a test, and the module loader's
 * seams are {@link AgentListSeams.modules}.
 *
 * ## The three filters
 *
 * The same three `rafa skill list` takes, read the same way and
 * matched by the same `matchesFilters`: `--source=<source>` on the
 * whole source string (`plugin:<name>` and `addon:<name>` included,
 * `--tier` its alias for one release after this one), `--state` on the
 * state's prefix (`enabled`, `collision`, `shadowed`, `disabled`), and
 * `--hidden-from-loop` on `visibleToLoop: false`. A `plugin:` or
 * `addon:` source the inventory does not know is refused, so a typo
 * never reads as an empty source.
 *
 * ## The vendor hint
 *
 * Under the default `project,local` no `~/.claude/agents` definition
 * reaches a run, and `rafa agent vendor` is what copies one into the
 * project. Text mode says so in one trailing line naming the `user`
 * rows whose name NO visible row answers, then one pointing at the
 * vendor command. A home definition the project shadows is not one of
 * them: its name resolves, at the project's file, and there is nothing
 * to vendor. Nor is one in a `collision`: vendoring it would not settle
 * which copy serves the name, a pin does. The hint reads the whole
 * inventory whatever the filters keep, so narrowing the rows never
 * hides it, and json mode gives the same names as `unreachable`.
 *
 * ## `-i | --interactive`
 *
 * Browses the rows the filters kept instead of printing them, as
 * `rafa skill list -i` does and through the same `interactiveTerminal`
 * and `browseListing`: the list, Enter to show a definition as
 * `rafa agent show` would, `f` for its whole file, Escape back, `q` to
 * quit. The warnings still go out first; the vendor hint, a line of the
 * text listing, is not printed. When the filters keep no row the text
 * listing is printed instead. `-i` is refused, exit code 1 and before
 * the inventory is built, when standard input is not a terminal, with a
 * line naming `rafa agent list --output=json`, and beside
 * `--output=json`. The terminal and the keys are the `terminal` and
 * `keys` seams {@link AgentListSeams} shares with `rafa skill list`.
 *
 * ## The exit code
 *
 * A listing reports; it exits 0 whatever the rows say. Exit code 1 is
 * kept for the refusals: a positional word, a `--source` or `--state`
 * naming nothing it can take, a config that cannot be used, and a `-i`
 * that cannot browse. `ctrl-c` inside a browse is exit code 130.
 */
import type { RafaCommand, RafaContext } from '../../cli/command.js';
import type { ClaudeSettingSource } from '../../config-sections.js';
import type { Inventory } from '../../inventory/index.js';
import type { InventoryRecord } from '../../inventory/record.js';
import type { ProjectFound } from '../../project/scope.js';
import type { SkillListFilters, SkillListSeams, SkillTreeListing, StateFilter } from '../skill/list.js';

import { VENDOR_COMMAND } from '../../agents/roster.js';
import { pathDirectories } from '../../check/references.js';
import { CommandExit } from '../../cli/command.js';
import { loadConfig } from '../../config-load.js';
import { ConfigError } from '../../config.js';
import { buildInventory } from '../../inventory/index.js';
import { loadModules, moduleSettings } from '../../modules/load.js';
import { SKILL_TIERS } from '../../schema/tiers.js';
import { expectNoArgument } from '../plan/plan-files.js';
import {
  browseListing,
  HIDDEN_MARK,
  interactiveFlag,
  interactiveTerminal,
  isSourceShape,
  knownSources,
  matchesFilters,
  skillRowLines,
  STATE_FILTERS,
  VISIBLE_MARK,
  warningLines,
} from '../skill/list.js';

/** What neither the context nor the registry carries: the entry and the module loader's seams. */
export type AgentListSeams = SkillListSeams;

/** The seams the registered command runs with. */
export const DEFAULT_AGENT_LIST_SEAMS: AgentListSeams = Object.freeze({
  entry: () => Bun.main,
  modules: Object.freeze({}),
});

/** The command's spelling, as the no-terminal refusal names it. */
const COMMAND_NAME = 'rafa agent list';

/** The usage line a refusal names. */
const USAGE = 'rafa agent list [--source=<source>] [--state=enabled|collision|shadowed|disabled] [--hidden-from-loop] [-i]';

/** What json mode gives as the terminal result's `data`. */
export interface AgentListResult {
  /** The project the inventory was built in. */
  readonly projectRoot: string;
  /** `loop.settingSources`, which decided each row's `visibleToLoop`. */
  readonly settingSources: readonly ClaudeSettingSource[];
  /** The filters the line gave. */
  readonly filters: SkillListFilters;
  /** The rows the filters kept, in the inventory's order. */
  readonly agents: readonly InventoryRecord[];
  /** How many agents the inventory holds before any filter. */
  readonly total: number;
  /** The agents trees `--source` leaves in, absent ones included. */
  readonly trees: readonly SkillTreeListing[];
  /** The `~/.claude/agents` names no visible row answers, sorted: what `rafa agent vendor` would copy. */
  readonly unreachable: readonly string[];
  /** One line per source or settings file that did not read. */
  readonly warnings: readonly string[];
}

/** A string flag's value, or null when the line left it out. */
function stringFlag(value: string | boolean | undefined, flag: string): string | null {
  if (value === undefined || value === false) return null;
  if (typeof value !== 'string' || value === '') {
    throw new CommandExit(1, `❌ --${flag} needs a value: --${flag}=<${flag}>\nUsage: ${USAGE}`);
  }
  return value;
}

/** The three filters a line gives, refusing a `--source` or `--state` written as none can be. */
export function readAgentFilters(flags: Readonly<Record<string, string | boolean | undefined>>): SkillListFilters {
  const source = stringFlag(flags['source'], 'source');
  if (source !== null && !isSourceShape(source)) {
    throw new CommandExit(1, `❌ --source is "${source}", expected one of: ${SKILL_TIERS.join(', ')},`
      + ` plugin:<name>, addon:<name>\nUsage: ${USAGE}`);
  }
  const stateWord = stringFlag(flags['state'], 'state');
  const state: StateFilter | null = stateWord === null
    ? null
    : STATE_FILTERS.find((filter) => filter === stateWord) ?? null;
  if (stateWord !== null && state === null) {
    throw new CommandExit(1, `❌ --state is "${stateWord}", expected one of: ${STATE_FILTERS.join(', ')}\nUsage: ${USAGE}`);
  }
  return { source, state, hiddenFromLoop: flags['hidden-from-loop'] === true };
}

/** Refuses a `plugin:` or `addon:` source the inventory does not know. */
export function expectKnownAgentSource(source: string | null, inventory: Inventory): void {
  if (source === null) return;
  const known = knownSources(inventory);
  if (known.includes(source)) return;
  throw new CommandExit(1, `❌ --source is "${source}", which no skill, agent or warning here comes from;`
    + ` known sources: ${known.join(', ')}\nUsage: ${USAGE}`);
}

/**
 * The `user` agent names no visible agent row answers, sorted, each
 * once: the definitions `rafa agent vendor` would copy. A name the
 * project also holds is answered there and left out, and a `collision`
 * row is left out, as a pin settles it and vendoring does not.
 */
export function unreachableUserAgents(agents: readonly InventoryRecord[]): readonly string[] {
  const answered = new Set(agents.filter((agent) => agent.visibleToLoop).map((agent) => agent.name));
  const names = agents
    .filter((agent) => agent.source === 'user' && agent.state !== 'collision' && !answered.has(agent.name))
    .map((agent) => agent.name);
  return [...new Set(names)].sort((a, b) => a.localeCompare(b));
}

/** The listing's data: the agents the filters keep, the trees `--source` leaves in, and the vendor names. */
export function agentListing(
  inventory: Inventory,
  filters: SkillListFilters,
  place: { readonly projectRoot: string; readonly settingSources: readonly ClaudeSettingSource[] },
): AgentListResult {
  const agents = inventory.records.filter((record) => record.kind === 'agent');
  return {
    projectRoot: place.projectRoot,
    settingSources: place.settingSources,
    filters,
    agents: agents.filter((record) => matchesFilters(record, filters)),
    total: agents.length,
    trees: inventory.trees
      .filter((listing) => listing.kind === 'agent')
      .filter((listing) => filters.source === null || listing.source === filters.source)
      .map((listing) => ({ source: listing.source, dir: listing.dir, exists: listing.exists })),
    unreachable: unreachableUserAgents(agents),
    warnings: warningLines(inventory),
  };
}

/** The heading: the project, then each filter the line gave. */
export function agentListHeading(result: AgentListResult): string {
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
  return `Agents (project: ${result.projectRoot}${scope}):`;
}

/** The two vendor hint lines, or none when every home name is answered. */
export function vendorHintLines(unreachable: readonly string[]): readonly string[] {
  if (unreachable.length === 0) return [];
  return [
    `${String(unreachable.length)} definition(s) under ~/.claude/agents resolve under none of these sources:`
      + ` ${unreachable.join(', ')}`,
    `Run \`${VENDOR_COMMAND} <name>\` to copy one into this project.`,
  ];
}

/** Every line text mode writes: heading, rows, absent trees, counts, legend, then the vendor hint. */
export function renderAgentList(result: AgentListResult): readonly string[] {
  const rows = result.agents.length === 0
    ? ['  (no agent matches)']
    : skillRowLines(result.agents);
  const absent = result.trees
    .filter((listing) => !listing.exists)
    .map((listing) => `  ${listing.source}  ${listing.dir ?? '(no project root)'}  (no such directory)`);
  const visible = result.agents.filter((record) => record.visibleToLoop).length;
  return [
    agentListHeading(result),
    ...rows,
    ...absent,
    `${String(result.agents.length)} of ${String(result.total)} agent(s) listed,`
      + ` ${String(visible)} visible to the loop (loop.settingSources: ${result.settingSources.join(', ')})`,
    `${VISIBLE_MARK} a loop session resolves it, ${HIDDEN_MARK} it does not`,
    ...vendorHintLines(result.unreachable),
  ];
}

/** The project the dispatcher resolved, which this command declares it needs. */
function projectOf(context: RafaContext): ProjectFound {
  if (context.project === null) throw new Error('rafa agent list runs inside a project, and was handed none');
  return context.project;
}

/** The inventory of `project`, under its config's setting sources and loaded modules. */
async function projectInventory(
  project: ProjectFound,
  context: RafaContext,
  seams: AgentListSeams,
): Promise<{ readonly inventory: Inventory; readonly settingSources: readonly ClaudeSettingSource[] }> {
  try {
    const resolved = loadConfig({ root: project.root, home: project.home });
    const loaded = await loadModules(moduleSettings(resolved, project), seams.modules);
    const { settingSources, tiersRafa, tiersSkills, tiersAgents } = resolved.config;
    const inventory = buildInventory({
      home: project.home,
      projectRoot: project.root,
      entry: seams.entry(),
      pathDirs: pathDirectories(context.env['PATH']),
      settingSources,
      tiersRafa,
      tiersSkills,
      tiersAgents,
      modules: loaded.modules,
    });
    return { inventory, settingSources };
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    throw new CommandExit(1, ['❌ rafa agent list: the config cannot be used:', ...error.problems.map((problem) => `  ${problem}`)].join('\n'));
  }
}

/** Lists the agents. See the module note. */
async function runList(context: RafaContext, seams: AgentListSeams): Promise<void> {
  const filters = readAgentFilters(context.flags);
  expectNoArgument(context.args, USAGE);
  const terminal = interactiveTerminal(context, seams, COMMAND_NAME, USAGE);
  const project = projectOf(context);
  const { inventory, settingSources } = await projectInventory(project, context, seams);
  expectKnownAgentSource(filters.source, inventory);

  const result = agentListing(inventory, filters, { projectRoot: project.root, settingSources });
  for (const warning of result.warnings) context.output.warn(warning);
  if (context.outputMode === 'json') {
    context.output.result(result);
    return;
  }
  if (terminal !== null) {
    const listing = {
      commandName: COMMAND_NAME,
      message: agentListHeading(result).replace(/:$/, ''),
      rows: result.agents,
      records: inventory.records,
    };
    if (await browseListing(terminal, seams, listing)) return;
  }
  for (const line of renderAgentList(result)) context.output.info(line);
}

/** The command, measuring the rafa tier and loading modules through `seams`. See the module note. */
export function createAgentListCommand(seams: AgentListSeams = DEFAULT_AGENT_LIST_SEAMS): RafaCommand {
  const command: RafaCommand = {
    name: 'agent list',
    subject: 'agent',
    action: 'list',
    summary: 'list every agent definition with its source, its state and whether the loop sees it',
    description: 'Lists every agent definition the inventory holds — the project\'s `.claude/agents`, the'
      + ' `bundled/agents` directory beside the running rafa, `~/.claude/agents`, each loaded add-on\'s and each'
      + ' installed plugin\'s — one row each, under the frontmatter `name` a task routes to: a mark saying'
      + ' whether a session the loop spawns under `loop.settingSources` resolves it or is served it from the'
      + ' rafa tier, its name, its source, its state (`enabled`, `collision` when two loaded tiers hold'
      + ' different definitions under the name and a `tiers.agents` pin must settle it,'
      + ' `shadowed-by:<source>` when another source serves the name, or `disabled:<how>`) and its own'
      + ' description as the summary. The Claude Code built-ins are not listed. `--source=<source>` keeps'
      + ' one source, `plugin:<name>` and `addon:<name>` included; `--state=<state>` keeps `enabled`,'
      + ' `collision`, `shadowed` or `disabled` rows; `--hidden-from-loop` keeps the rows no loop session'
      + ' resolves. The filters combine. When `~/.claude/agents` holds a name no visible row answers, a trailing line'
      + ' names it and points at `rafa agent vendor`. It spawns no session and exits 0 whatever the rows'
      + ' say. With `--output=json` the rows, the vendor names and the warnings are the data of the'
      + ' terminal result event. `-i` browses the listed rows in the terminal instead of printing them,'
      + ' and refuses without one.',
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
      interactiveFlag(),
    ],
    examples: [
      {
        cmd: 'rafa agent list',
        note: 'Lists every agent definition, each with its source, its state and whether the loop sees it.',
      },
      {
        cmd: 'rafa agent list --hidden-from-loop --source=user',
        note: 'Lists the `~/.claude/agents` definitions a loop session does not resolve.',
      },
      {
        cmd: 'rafa agent list --state=collision',
        note: 'Lists the holders of every name two loaded tiers hold different definitions under, which a pin settles.',
      },
      {
        cmd: 'rafa agent list -i',
        note: 'Browses every agent definition: Enter shows one, `f` its whole file, Escape goes back, `q` quits.',
      },
      {
        cmd: 'rafa agent list --output=json',
        note: 'Writes a start event, then a result event whose data holds every row and the vendor names.',
      },
    ],
    outputs: ['text', 'json'],
    run: async (context) => {
      await runList(context, seams);
    },
  };
  return Object.freeze(command);
}

export default createAgentListCommand();
