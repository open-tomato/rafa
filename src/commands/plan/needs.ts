/**
 * `rafa plan needs [<plan> | --spec=<file> | --issue=<n>] [--missing]
 * [--source=<source>]`: what a plan, or a spec, needs from this machine
 * (`src/plan/needs.ts`), printed. The reading is code only: the command
 * starts no Claude session and so declares no `spends`.
 *
 * ## What is read
 *
 * With a plan named, or none, the plan is resolved against the project
 * root as `rafa plan risk` and `loop start --plan=` resolve theirs
 * (`start/plan-path.ts`), and with none named it is the default plan
 * `loop start` falls back to. It is read by `readPlanNeeds`: its open
 * tasks' agents, skills and MCP servers, its PREREQUISITES probes'
 * programs, its declared skills' fence programs, and the stack tools of
 * the project root.
 *
 * `--spec=<file>` and `--issue=<n>` name a spec instead, through the
 * route `plan create` resolves its spec with
 * (`./spec-route.ts`, `resolveCreateSpec`), so a spec is found where
 * `plan create` would find it and an issue is read, checked and
 * snapshotted under `specs.dir` exactly as `plan create` does before
 * its session: an issue `plan create` would refuse is refused here with
 * the same code. The route is handed no offer — no `issue ready` label
 * swap, no changed-body question — since a reading writes no label; a
 * refusal an offer would have turned into a question stays a refusal.
 * The spec is read by `readSpecNeeds`: every inventory name its text
 * mentions as a whole word.
 *
 * A plan beside `--spec` or `--issue`, and `--spec` beside `--issue`,
 * are refused with exit code 1, as are a plan named that is no file, no
 * default plan, and a config `loadConfig` refuses.
 *
 * The inventory is built as `rafa skill list` builds it: the project
 * root and the home the dispatcher found, `loop.settingSources` from the
 * config, which decides `visibleToLoop` and which MCP server a run
 * starts, the config's loaded modules as add-on sources, the rafa tier
 * beside {@link PlanNeedsSeams.entry}, and `PATH` from
 * `RafaContext.env`, which is also where a program is looked up, after
 * the rafa tier's `bundled/bin` for a program rafa ships (`ts-symbols`).
 *
 * ## The two filters
 *
 *   - `--missing` keeps the needs a run would not have: missing, or
 *     present and not visible to a run (`isUnmet`), and the stacks not
 *     met. It prints NOTHING when everything is provided, and exits 1
 *     when anything is kept.
 *   - `--source=<source>` keeps the agents and skills whose holder comes
 *     from that source: `project`, `rafa`, `user`, `plugin:<name>` or
 *     `addon:<name>`, refused when written as none of them. An MCP
 *     server or a program has no inventory source, and a missing item
 *     no holder, so neither is kept, and nor is a stack's row. A
 *     `plugin:` or `addon:` name nothing here comes from keeps no row
 *     rather than being refused: the reading holds only the needs, not
 *     the whole inventory a typo could be checked against.
 *
 * ## What it writes
 *
 * Text mode writes a heading naming the plan or spec and
 * `loop.settingSources`, one row per need — `✓` or `✗`, its kind, its
 * name, where it was found (a source and a state, an MCP scope, a `PATH`
 * directory, or `missing`), whether a run sees it, and where it was
 * named — then one row per detected stack with its hint when unmet, and
 * a count. Each reader warning goes out first through the active
 * output. json mode gives {@link PlanNeedsResult} as the data of the
 * terminal result.
 *
 * The exit code is 0 whatever the reading found, unless `--missing` kept
 * a row: then 1, where text mode has printed the rows first and json
 * mode writes each kept row as an `error` log event first, since a failed
 * result carries no data (`src/cli/dispatch.ts`).
 *
 * `--missing` takes no value. Typed ahead of the plan, the parser reads
 * the plan as its value, and the line is refused with exit code 1
 * rather than read as the default plan (`readSwitch`, `plan-files.ts`).
 */
import type { SpecRouteSeams } from './spec-route.js';
import type { RafaCommand, RafaContext } from '../../cli/command.js';
import type { ClaudeSettingSource } from '../../config-sections.js';
import type { ModuleLoadSeams } from '../../modules/load.js';
import type { Need, NeedOrigin, NeedsReading, NeedsSeams, StackReading } from '../../plan/needs.js';
import type { ProjectFound } from '../../project/scope.js';

import { isAbsolute, relative, resolve } from 'node:path';

import { pathDirectories } from '../../check/references.js';
import { CommandExit } from '../../cli/command.js';
import { loadConfig } from '../../config-load.js';
import { ConfigError } from '../../config.js';
import { loadModules, moduleSettings } from '../../modules/load.js';
import { isUnmet, readPlanNeeds, readSpecNeeds } from '../../plan/needs.js';
import { DEFAULT_PLAN_FILE, resolvePlanPath } from '../../start/plan-path.js';
import { isSourceShape } from '../skill/list.js';

import { expectAtMostOneArgument, isFile, plural, readSwitch, requireProject } from './plan-files.js';
import { resolveCreateSpec } from './spec-route.js';

/** The command as a refusal names it. */
const COMMAND = 'rafa plan needs';

/** The usage line a refusal names. */
const USAGE = 'rafa plan needs [<plan> | --spec=<file> | --issue=<n>] [--missing] [--source=<source>]';

/** What a refusal of a value read into `--missing` says to do instead. */
const MISSING_HINT = `Type the plan first: ${COMMAND} <plan> --missing`;

/** The mark a met need opens with, and the one an unmet need does. */
export const MET_MARK = '✓';
export const UNMET_MARK = '✗';

/** What neither the context nor the registry carries. */
export interface PlanNeedsSeams {
  /** This process's entry, which the rafa tier sits beside. */
  readonly entry: () => string;
  /** What the config's modules are loaded through. */
  readonly modules: ModuleLoadSeams;
  /** How `--spec` and `--issue` resolve; `plan create`'s own route when left out. */
  readonly route?: SpecRouteSeams;
}

/** The seams the registered command runs with. */
export const DEFAULT_PLAN_NEEDS_SEAMS: PlanNeedsSeams = Object.freeze({
  entry: () => Bun.main,
  modules: Object.freeze({}),
});

/** What was read: a plan, or a spec. */
export interface NeedsTarget {
  readonly kind: 'plan' | 'spec';
  /** The file, absolute. */
  readonly path: string;
  /** The file as a person reads it: relative to the project root when under it. */
  readonly label: string;
}

/** What json mode gives as the terminal result's `data`. */
export interface PlanNeedsResult {
  readonly target: NeedsTarget;
  /** `loop.settingSources`, which decided each need's visibility. */
  readonly settingSources: readonly ClaudeSettingSource[];
  /** The filters the line gave. */
  readonly filters: { readonly missing: boolean; readonly source: string | null };
  /** The needs the filters kept, by kind and then name. */
  readonly items: readonly Need[];
  /** The detected stacks the filters kept. */
  readonly stacks: readonly StackReading[];
  /** How many of the kept needs and stacks a run would not have. */
  readonly unmet: number;
  /** One line per file, key or entry a reader could not use. */
  readonly warnings: readonly string[];
}

/** The source `--source` names, or null; refused when no source is written so. */
export function readNeedsSource(value: string | boolean | undefined): string | null {
  if (value === undefined || value === false) return null;
  if (typeof value === 'string' && isSourceShape(value)) return value;
  const shown = typeof value === 'string'
    ? `"${value}"`
    : 'given no value';
  throw new CommandExit(1, `❌ --source is ${shown}, expected one of: project, rafa, user, plugin:<name>, addon:<name>`
    + `\nUsage: ${USAGE}`);
}

/**
 * The words `resolveCreateSpec` reads for `--spec` and `--issue`, or
 * null when the line gave neither. A flag given bare is handed on bare,
 * for the route to refuse with the value it wants.
 */
export function specRouteWords(flags: Readonly<Record<string, string | boolean | undefined>>): string[] | null {
  const words = (['spec', 'issue'] as const).flatMap((name) => {
    const value = flags[name];
    if (value === undefined || value === false) return [];
    return value === true
      ? [`--${name}`]
      : [`--${name}=${value}`];
  });
  return words.length === 0
    ? null
    : words;
}

/** `path` as a person reads it: relative to `root` when under it, else as given. */
export function labelOf(root: string, path: string): string {
  const under = relative(root, path);
  return under === '' || under.startsWith('..') || isAbsolute(under)
    ? path
    : under;
}

/** The plan the line names, resolved against the project root, or the default plan; exit 1 for either that is no file. */
export function needsPlanPath(root: string, planDir: string, typed: string | null): string {
  const path = resolvePlanPath(root, planDir, typed ?? undefined);
  if (isFile(path)) return path;
  if (typed !== null) throw new CommandExit(1, `❌ Plan file not found: ${path}`);
  const lookedFor = [...new Set([resolve(root, planDir, DEFAULT_PLAN_FILE), resolve(root, DEFAULT_PLAN_FILE)])];
  throw new CommandExit(1, `❌ No plan named, and no default plan at ${lookedFor.join(' or ')}\nUsage: ${USAGE}`);
}

/** Whether a need passes `--source`: an agent or skill held by that source. */
function fromSource(need: Need, source: string | null): boolean {
  if (source === null) return true;
  return (need.kind === 'agent' || need.kind === 'skill') && need.source === source;
}

/** The reading narrowed by the line's filters. See the module note. */
export function needsResult(
  reading: NeedsReading,
  target: NeedsTarget,
  settingSources: readonly ClaudeSettingSource[],
  filters: PlanNeedsResult['filters'],
): PlanNeedsResult {
  const items = reading.items
    .filter((need) => fromSource(need, filters.source))
    .filter((need) => !filters.missing || isUnmet(need));
  const stacks = filters.source === null
    ? reading.stacks.filter((stack) => !filters.missing || !stack.met)
    : [];
  return {
    target,
    settingSources,
    filters,
    items,
    stacks,
    unmet: items.filter(isUnmet).length + stacks.filter((stack) => !stack.met).length,
    warnings: reading.warnings.map((warning) => `${warning.path}: ${warning.reason}`),
  };
}

/** The word each kind of origin is named with, ahead of its detail. */
const ORIGIN_WORDS: Readonly<Record<NeedOrigin['by'], string>> = {
  task: 'task line',
  prerequisite: 'prerequisite line',
  skill: 'skill',
  mentioned: 'mentioned line',
  stack: 'stack',
};

/** What one origin names after its word: a line number, a skill or a stack. */
function originDetail(origin: NeedOrigin): string {
  switch (origin.by) {
    case 'skill':
      return origin.skill;
    case 'stack':
      return origin.stack;
    default:
      return String(origin.line);
  }
}

/** Where a need was named, as a phrase. */
export function originPhrase(origin: NeedOrigin): string {
  return `${ORIGIN_WORDS[origin.by]} ${originDetail(origin)}`;
}

/**
 * Where a need was named, as one phrase: the origins of one kind grouped
 * in reading order, so three task lines read `task lines 3, 5, 9`.
 */
export function originsPhrase(origins: readonly NeedOrigin[]): string {
  const groups = new Map<NeedOrigin['by'], readonly NeedOrigin[]>();
  for (const origin of origins) groups.set(origin.by, [...(groups.get(origin.by) ?? []), origin]);
  return [...groups.entries()].map(([by, group]) => {
    const word = group.length === 1
      ? ORIGIN_WORDS[by]
      : `${ORIGIN_WORDS[by]}s`;
    return `${word} ${group.map(originDetail).join(', ')}`;
  }).join('; ');
}

/** Where a need was found: its source and a state other than `enabled`, its MCP scope, its directory, or `missing`. */
function foundAt(need: Need): string {
  if (need.status === 'missing') return 'missing';
  if (need.kind === 'program') return need.directory ?? '';
  if (need.kind === 'mcp') return `mcp ${need.scope ?? ''}`;
  const source = need.source ?? '';
  return need.state === null || need.state === 'enabled'
    ? source
    : `${source} ${need.state}`;
}

/** Whether a run sees the need, as a phrase; empty for a program or a missing need. */
function visibility(need: Need): string {
  if (need.kind === 'program' || need.status === 'missing') return '';
  return need.visibleToLoop
    ? 'visible to a run'
    : 'not visible to a run';
}

/** The rows as text mode writes them: the mark, then every column but the last padded to its widest cell. */
export function needRowLines(items: readonly Need[]): readonly string[] {
  const rows = items.map((need) => [
    need.kind,
    need.name,
    foundAt(need),
    visibility(need),
    originsPhrase(need.origins),
  ]);
  const widths = rows.reduce<readonly number[]>(
    (widest, cells) => cells.map((cell, index) => Math.max(widest[index] ?? 0, cell.length)),
    [],
  );
  return items.map((need, row) => {
    const cells = rows[row] ?? [];
    const padded = cells.map((cell, index) => (index === cells.length - 1
      ? cell
      : cell.padEnd(widths[index] ?? 0)));
    const mark = isUnmet(need)
      ? UNMET_MARK
      : MET_MARK;
    return `  ${mark} ${padded.join('  ')}`.trimEnd();
  });
}

/** A stack as one row: the mark, the stack and its program, and the hint when unmet. */
export function stackLine(stack: StackReading): string {
  if (stack.met) return `  ${MET_MARK} stack ${stack.stack}: ${stack.program}, skill ${stack.skill ?? ''}`;
  return `  ${UNMET_MARK} stack ${stack.hint ?? stack.stack}`;
}

/** Every line text mode writes; none at all under `--missing` when nothing is unmet. */
export function renderNeeds(result: PlanNeedsResult): readonly string[] {
  if (result.filters.missing && result.unmet === 0) return [];
  const heading = `Needs of ${result.target.kind} ${result.target.label}`
    + ` (loop.settingSources: ${result.settingSources.join(', ')}):`;
  const rows = result.items.length === 0 && result.stacks.length === 0
    ? ['  (no need matches)']
    : [...needRowLines(result.items), ...result.stacks.map(stackLine)];
  const count = `${plural(result.items.length, 'need')}, ${String(result.unmet)} unmet`
    + ' (missing, or not visible to a run)';
  return [heading, ...rows, count];
}

/** The refusal `--missing` ends a reading with when it kept an unmet row. */
export function missingRefusal(result: PlanNeedsResult): string {
  return `❌ ${result.target.label}: ${plural(result.unmet, 'unmet need')}; --missing refuses a reading with any`;
}

/** The config and the needs seams for `project`; exit 1 for a config `loadConfig` refuses. */
async function readMachine(
  project: ProjectFound,
  context: RafaContext,
  seams: PlanNeedsSeams,
): Promise<{ readonly config: ReturnType<typeof loadConfig>['config']; readonly needs: NeedsSeams }> {
  try {
    const resolved = loadConfig({ root: project.root, home: project.home }, {}, (message) => {
      context.output.warn(message);
    });
    const loaded = await loadModules(moduleSettings(resolved, project), seams.modules);
    const { config } = resolved;
    return {
      config,
      needs: {
        home: project.home,
        projectRoot: project.root,
        entry: seams.entry(),
        pathDirs: pathDirectories(context.env['PATH']),
        settingSources: config.settingSources,
        modules: loaded.modules,
      },
    };
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    throw new CommandExit(1, [
      `❌ ${COMMAND}: the config cannot be used:`,
      ...error.problems.map((problem) => `   ${problem}`),
    ].join('\n'));
  }
}

/** The spec `--spec` or `--issue` names, as `plan create` resolves it with no offer; see the module note. */
async function routedSpec(
  words: readonly string[],
  project: ProjectFound,
  config: Awaited<ReturnType<typeof readMachine>>['config'],
  seams: PlanNeedsSeams,
): Promise<string> {
  const resolution = await resolveCreateSpec({
    args: words,
    repoRoot: project.root,
    specsDir: config.specsDir,
    roadmapIssue: config.roadmapIssue,
    trustedAuthors: config.boardTrustedAuthors,
  }, {
    makeReadyOffer: () => null,
    makeAlternativeOffer: () => null,
    makeRefreshOffer: () => null,
    ...seams.route,
  });
  if (resolution.outcome === 'stopped') {
    throw new CommandExit(1, `❌ ${COMMAND}: the spec route stopped (${resolution.reason}) and named no spec`);
  }
  return resolve(project.root, resolution.spec.path);
}

/** Reads and prints the needs. See the module note. */
async function runNeeds(context: RafaContext, seams: PlanNeedsSeams): Promise<void> {
  const missing = readSwitch('missing', context.flags['missing'], MISSING_HINT);
  const source = readNeedsSource(context.flags['source']);
  const typed = expectAtMostOneArgument(context.args, USAGE);
  const words = specRouteWords(context.flags);
  if (typed !== null && words !== null) {
    throw new CommandExit(1, `❌ ${typed} and ${words.join(' and ')} each name what to read; give one\nUsage: ${USAGE}`);
  }

  const project = requireProject(context, COMMAND);
  const { config, needs } = await readMachine(project, context, seams);
  const kind = words === null
    ? 'plan'
    : 'spec';
  const path = words === null
    ? needsPlanPath(project.root, config.planDir, typed)
    : await routedSpec(words, project, config, seams);
  const target: NeedsTarget = { kind, path, label: labelOf(project.root, path) };
  const reading = kind === 'plan'
    ? await readPlanNeeds(path, needs)
    : await readSpecNeeds(path, needs);

  const result = needsResult(reading, target, config.settingSources, { missing, source });
  for (const warning of result.warnings) context.output.warn(warning);
  const refused = missing && result.unmet > 0;

  if (context.outputMode === 'json') {
    if (!refused) {
      context.output.result(result);
      return;
    }
    for (const line of [...needRowLines(result.items.filter(isUnmet)), ...result.stacks.map(stackLine)]) {
      context.output.error(line.trim());
    }
  } else {
    for (const line of renderNeeds(result)) context.output.info(line);
  }
  if (refused) throw new CommandExit(1, missingRefusal(result));
}

/** The command, measuring the rafa tier, loading modules and routing specs through `seams`; see the module note. */
export function createPlanNeedsCommand(seams: PlanNeedsSeams = DEFAULT_PLAN_NEEDS_SEAMS): RafaCommand {
  const command: RafaCommand = {
    name: 'plan needs',
    subject: 'plan',
    action: 'needs',
    summary: 'list the agents, skills, MCP servers and programs a plan or spec needs, starting no session',
    description: 'Reads one plan, or one spec, in code, with no model, and lists what it needs from this'
      + ' machine: for a plan, the `agent=` and `skills=` of every open task, the MCP server each'
      + ' `mcp__<server>__…` tool names, the programs its PREREQUISITES probes and its declared skills\''
      + ' shell fences call, and the symbol tool its stack needs; for a spec, every agent and skill name its'
      + ' text mentions. Each is present or missing, with its source, its MCP scope or its PATH directory,'
      + ' and whether a session the loop spawns under `loop.settingSources` sees it. The plan is read'
      + ' relative to the project root, as `rafa loop start --plan=` reads it, and is the default plan'
      + ' when none is named; `--spec` and `--issue` find the spec as `rafa plan create` does, an issue'
      + ' snapshotted under `specs.dir` as it would be. `--missing` keeps what a run would not have and'
      + ' exits 1 when anything is kept, printing nothing when all is provided; `--source=<source>` keeps'
      + ' the agents and skills held by one source. With `--output=json` the reading is the data of the'
      + ' terminal result event; under a failing `--missing` each kept row is an error log event instead.',
    args: [
      {
        name: 'plan',
        description: 'The plan file to read, relative to the project root; the default plan when left out.',
        type: 'string',
      },
    ],
    flags: [
      {
        name: 'spec',
        description: 'Read a spec file instead, found against the project root or under `specs.dir`.',
        type: 'string',
      },
      {
        name: 'issue',
        description: 'Read the spec of issue <n> instead, checked and snapshotted as `plan create` does.',
        type: 'string',
      },
      {
        name: 'missing',
        description: 'List only what a run would not have, and exit 1 when there is any. Type it after the plan.',
        type: 'boolean',
      },
      {
        name: 'source',
        description: 'List the agents and skills held by one source: project, rafa, user, plugin:<name> or addon:<name>.',
        type: 'string',
      },
    ],
    examples: [
      {
        cmd: 'rafa plan needs .rafa/plans/PLAN-my-feature.md',
        note: 'Lists each agent, skill, MCP server and program the plan needs, present or missing.',
      },
      {
        cmd: 'rafa plan needs --missing',
        note: 'Lists what a run of the default plan would not have, and exits 1 when there is any.',
      },
      {
        cmd: 'rafa plan needs --spec=my-feature.md --source=project',
        note: 'Lists the project agents and skills the spec mentions.',
      },
      {
        cmd: 'rafa plan needs --issue=42',
        note: 'Reads issue 42 as `plan create --issue=42` would, and lists what its spec mentions.',
      },
      {
        cmd: 'rafa plan needs --output=json',
        note: 'Writes a start event, then a result event whose data is the default plan\'s needs.',
      },
    ],
    outputs: ['text', 'json'],
    run: async (context) => {
      await runNeeds(context, seams);
    },
  };
  return Object.freeze(command);
}

export default createPlanNeedsCommand();
