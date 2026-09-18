/**
 * `rafa agent list`: every agent name a session this project spawns would
 * resolve, where each resolves, and which user definition a project one
 * shadows.
 *
 * The roster is `agents/roster.ts`'s, resolved against the project the
 * dispatcher found and the `loop.settingSources` of the config that
 * resolves there — the same reading `loop start`'s preflight halts on
 * and `rafa plan validate` refuses a plan for. So this command answers,
 * for a name a plan is about to route to, whether the run will reach it,
 * and it spawns nothing to answer: no `claude`, no session.
 *
 * ## What is listed
 *
 * One row per name, each name once, in the roster's order: the project's
 * `.claude/agents` definitions, then the home's when the sources include
 * `user`, then the Claude Code built-ins
 * (`BUILT_IN_AGENTS`). A project definition SHADOWS a user one of
 * the same name rather than merging with it
 * (`context/workflow.md`), and the row says which file it shadows, which
 * is the one thing the CLI's own list cannot show: it prints the one
 * name.
 *
 * Under the default `project,local` no home definition is in the roster
 * at all, and no row says it shadows one either, since nothing there
 * resolves to be shadowed. That the home holds a definition a run cannot
 * reach is what `rafa agent vendor` is for, and text mode says so in one
 * trailing line counting the home definitions no listed row resolves. A
 * home name a PROJECT definition also carries is not one of them: the
 * name resolves, at the project's file, and there is nothing to vendor.
 *
 * ## What it writes
 *
 * Text mode writes the sources it resolved under, one row per name, and
 * the vendor line when the home carries a name the run does not resolve.
 * In json mode the terminal result's `data` is an
 * {@link AgentListResult}: the sources, the rows, and the unreachable
 * home names. `AgentRoster.userDefinitions` itself is a map and is not
 * given, so the document holds lists alone.
 *
 * ## Refusals
 *
 * Exit code 1 for a positional word, and for a config `loadConfig`
 * refuses, as `rafa plan validate` refuses one. The command declares no
 * flag.
 */
import type { AgentRoster, RosterAgent } from '../../agents/roster.js';
import type { RafaCommand, RafaContext } from '../../cli/command.js';
import type { ClaudeSettingSource, RafaConfig } from '../../config.js';
import type { ProjectFound } from '../../project/scope.js';

import { resolveAgentRoster, VENDOR_COMMAND } from '../../agents/roster.js';
import { CommandExit } from '../../cli/command.js';
import { loadConfig } from '../../config-load.js';
import { ConfigError } from '../../config.js';
import { expectNoArgument } from '../plan/plan-files.js';

/** The usage line a refusal names. */
const USAGE = 'rafa agent list';

/** What json mode gives as the terminal result's `data`. */
export interface AgentListResult {
  /** The `loop.settingSources` the roster was resolved under. */
  readonly settingSources: readonly ClaudeSettingSource[];
  /** Each name a session resolves, once, in roster order. */
  readonly agents: readonly RosterAgent[];
  /** The names `~/.claude/agents` carries that no listed row resolves, sorted. */
  readonly unreachable: readonly string[];
}

/**
 * The home names the roster resolves under no scope, which
 * `rafa agent vendor` would copy, sorted. A name a listed row carries is
 * left out whatever scope that row is, so a home definition the project
 * shadows is not reported as out of reach.
 */
export function unreachableUserAgents(roster: AgentRoster): readonly string[] {
  const resolved = new Set(roster.agents.map((agent) => agent.name));
  return [...roster.userDefinitions.keys()]
    .filter((name) => !resolved.has(name))
    .sort((a, b) => a.localeCompare(b));
}

/** One row: the name, the scope that answers, its file and what it shadows. */
export function agentRow(agent: RosterAgent): string {
  const where = agent.path === null
    ? agent.scope
    : `${agent.scope} ${agent.path}`;
  const shadows = agent.shadows === null
    ? ''
    : ` (shadows ${agent.shadows})`;
  return `  ${agent.name}: ${where}${shadows}`;
}

/** The lines text mode writes for a roster. */
export function renderAgentList(result: AgentListResult): readonly string[] {
  const unreachable = result.unreachable.length === 0
    ? []
    : [
      `${result.unreachable.length} definition(s) under ~/.claude/agents resolve under none of these sources:`
        + ` ${result.unreachable.join(', ')}`,
      `Run \`${VENDOR_COMMAND} <name>\` to copy one into this project.`,
    ];
  return [
    `Agents a session resolves (loop.settingSources: ${result.settingSources.join(', ')}):`,
    ...result.agents.map(agentRow),
    ...unreachable,
  ];
}

/** The config as it resolves for the project, refusing one `loadConfig` refuses. */
function resolvedConfig(project: ProjectFound, warn: (message: string) => void): RafaConfig {
  try {
    return loadConfig({ root: project.root, home: project.home }, {}, warn).config;
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    throw new CommandExit(1, [
      `❌ ${USAGE}: the config cannot be used:`,
      ...error.problems.map((problem) => `   ${problem}`),
    ].join('\n'));
  }
}

function projectOf(context: RafaContext): ProjectFound {
  if (context.project === null) throw new Error('rafa agent list runs inside a project, and was handed none');
  return context.project;
}

/** Lists the roster. See the module note. */
function runList(context: RafaContext): void {
  expectNoArgument(context.args, USAGE);
  const project = projectOf(context);
  const { settingSources } = resolvedConfig(project, (message) => {
    context.output.warn(message);
  });
  const roster = resolveAgentRoster({ repoRoot: project.root, home: project.home }, settingSources);
  const result: AgentListResult = {
    settingSources,
    agents: roster.agents,
    unreachable: unreachableUserAgents(roster),
  };
  if (context.outputMode === 'json') {
    context.output.result(result);
    return;
  }
  for (const line of renderAgentList(result)) context.output.info(line);
}

/** The command; see the module note. */
const agentListCommand: RafaCommand = {
  name: 'agent list',
  subject: 'agent',
  action: 'list',
  summary: 'list the agent names a session this project spawns resolves, and where each resolves',
  description: 'Lists every `--agent` name a session spawned under this project\'s `loop.settingSources`'
    + ' would resolve, each once and in the order the CLI resolves them: the project\'s `.claude/agents`'
    + ' definitions, then `~/.claude/agents` when the sources include `user`, then the Claude Code'
    + ' built-ins. Each row names the scope that answers, the file it was read from, and the user-level'
    + ' file a project definition shadows. It spawns no session to answer, and reads a definition under'
    + ' the frontmatter `name` it carries rather than its file stem. When `~/.claude/agents` holds a name'
    + ' the sources leave out of reach, a trailing line counts those names and points at'
    + ' `rafa agent vendor`. With `--output=json` the sources, the rows and those names are the data of'
    + ' the terminal result event.',
  args: [],
  flags: [],
  examples: [
    {
      cmd: 'rafa agent list',
      note: 'Prints one row per name a task routed `agent=<name>` could be dispatched to.',
    },
    {
      cmd: 'rafa agent list --output=json',
      note: 'Writes a start event, then a result event whose data is the roster.',
    },
  ],
  outputs: ['text', 'json'],
  run: async (context) => {
    runList(context);
  },
};

export default Object.freeze(agentListCommand);
