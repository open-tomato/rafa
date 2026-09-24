/**
 * The routing defaults: which agent a task of each shape goes to when
 * no config layer says otherwise, and whether each row of the resolved
 * `routing` map names an agent a session can run.
 *
 * `.rafa/specs/rafa-26-skill-tiers.md` turns the routing table, until
 * now prose in `context/workflow.md`, into the `routing` setting: a map
 * from a task shape to the agent that takes it. This module holds
 * rafa's defaults for that map, {@link DEFAULT_ROUTES}, and the map
 * `CONFIG_DEFAULTS` answers when no layer names `routing`,
 * {@link DEFAULT_ROUTING}. How a file's value is READ is
 * `config-sections.ts`'s `routeTarget` inside `config-schema.ts`'s
 * `mapOf`, as for every other setting.
 *
 * Four readings are this module's:
 *
 *   - The five rows are the spec's table, and every agent they name is
 *     on the spec's roster for the rafa tier, so a project that has
 *     written nothing is routed to agents it will be served. That tier
 *     is not bundled yet; the test resolving each row against the
 *     bundle comes with it. The table's two user-level rows,
 *     `cleanup` and TypeScript review, are left out: they name agents
 *     rafa does not ship, and belong in the configuring project's own
 *     file.
 *   - A shape is any name. `cleanup` is one a project adds, so shapes
 *     form no closed list and the map is keyed by any string.
 *   - A value is an agent name or `false`, the spelling `tiers.skills`
 *     uses to turn an item off. `resolveConfig` merges the map by key,
 *     the project file over the user file over these defaults, and a
 *     `false` kept as a key's answer removes that row: a project writing
 *     `routing: { cleanup: refactor-cleaner }` is routed by the five
 *     rows below plus that one.
 *   - {@link DEFAULT_ROUTING} is one shared `Map`, as each empty map
 *     default in `CONFIG_DEFAULTS` is. A `Map` cannot be frozen, so the
 *     promise that no caller edits it rests on its `ReadonlyMap` type,
 *     while {@link DEFAULT_ROUTES}, a list, is frozen outright.
 *
 * ## Every row must resolve
 *
 * The spec: "A `routing` row naming an agent that does not resolve is a
 * load error." {@link resolveRouting} answers that question for every
 * row of the resolved map against a {@link Resolution} from
 * `resolveTiers`. It is pure and wires itself into nothing; no caller
 * reads it yet, and the config load and the doctor are left to take
 * its two lists.
 *
 * What a row's agent resolves to, first match wins:
 *
 *   1. A `false` row is removed, so it is not read at all.
 *   2. An agent the tiers serve resolves (`served`).
 *   3. An agent the tiers hold as a collision does not (`collision`),
 *      whatever else answers the name: the preflight refuses the
 *      collision itself, and the row carries its pin line.
 *   4. An agent Claude Code answers for with no definition loaded, one
 *      of the `builtIns` a caller passes (`BUILT_IN_AGENTS` in
 *      `agents/roster.ts`), resolves (`built-in`). `--agent Explore`
 *      runs on any repository, so a row naming it is not a load error.
 *      `tiers.agents: { Explore: false }` removes the name from the
 *      tiers, which the built-ins are not.
 *   5. Otherwise it does not: turned `off` in every tier, held only in
 *      an `unloaded` tier, or held by no tier at all (`missing`).
 *
 * The built-ins are a parameter rather than an import because
 * `config-schema.ts` imports this module for {@link DEFAULT_ROUTING},
 * and `agents/roster.ts` reaches the plan parser; a routing module
 * importing it would put that graph under the config's.
 *
 * ## A configured row and a default row fail differently
 *
 * The spec's rule is aimed at the operator's own line: a row a config
 * file wrote naming an agent that does not resolve is a mistake in that
 * file, so it is a load error ({@link RoutingReading.loadErrors}), one
 * sentence each, for the caller to throw as a `ConfigError`. A DEFAULT
 * row that does not resolve is not the operator's mistake: rafa's own
 * table names an agent this project cannot be served, for instance
 * with `tiers.rafa: off`. Refusing every load for that would lock the
 * operator out of the config that fixes it, so it is a doctor-level
 * problem ({@link RoutingReading.doctorProblems}), naming the line that
 * settles it. Only a default row carries that line, and every default
 * shape is a plain name, so the line writes the shape bare.
 *
 * A row is configured when a config file names its shape
 * ({@link configuredShapes}), even with the default's own agent: the
 * operator wrote that line. A row whose agent differs from the
 * default's, or whose shape the defaults lack, is configured whatever
 * the set says, since no default could have put it there.
 */
import type { RouteTarget } from '../config-sections.js';
import type { ConfigLayers } from '../config.js';
import type { Resolution, ServedItem, TierCollision } from './resolve.js';
import type { SkillTier } from '../schema/tiers.js';

import { findTierItem } from './resolve.js';

/** One default row: a task shape and the agent that takes it. */
export type Route = readonly [shape: string, agent: string];

/** rafa's routing table, in the order the spec lists it. */
export const DEFAULT_ROUTES: readonly Route[] = Object.freeze([
  Object.freeze(['prose', 'doc-updater'] as const),
  Object.freeze(['tests', 'tdd-guide'] as const),
  Object.freeze(['repair', 'build-error-resolver'] as const),
  Object.freeze(['review', 'code-reviewer'] as const),
  Object.freeze(['implementation', 'loop-implementer'] as const),
]);

/** {@link DEFAULT_ROUTES} as the map `routing` resolves to by default. */
export const DEFAULT_ROUTING: ReadonlyMap<string, RouteTarget> = new Map<string, RouteTarget>(
  DEFAULT_ROUTES,
);

/** What one row's agent resolves to. See "Every row must resolve". */
export type RouteAnswer =
  | { readonly state: 'served'; readonly item: ServedItem }
  | { readonly state: 'built-in' }
  | { readonly state: 'collision'; readonly collision: TierCollision }
  | { readonly state: 'off' }
  | { readonly state: 'unloaded'; readonly tiers: readonly SkillTier[] }
  | { readonly state: 'missing' };

/** Whether a config file wrote the row or rafa's defaults did. */
export type RouteOrigin = 'configured' | 'default';

/** One row of the resolved `routing` map, with what its agent resolves to. */
export interface RouteRow {
  readonly shape: string;
  readonly agent: string;
  readonly origin: RouteOrigin;
  readonly answer: RouteAnswer;
  /** True when {@link answer} is `served` or `built-in`. */
  readonly resolves: boolean;
}

/** Every row read, and the sentences for those that do not resolve. */
export interface RoutingReading {
  /** One per row not turned off, in the map's order. */
  readonly rows: readonly RouteRow[];
  /** One sentence per configured row that does not resolve. */
  readonly loadErrors: readonly string[];
  /** One sentence per default row that does not resolve. */
  readonly doctorProblems: readonly string[];
}

/** What {@link resolveRouting} reads besides the map and the resolution. */
export interface RoutingContext {
  /** The shapes a config file names, from {@link configuredShapes}. */
  readonly configured: ReadonlySet<string>;
  /** The agents Claude Code answers for with no definition: `BUILT_IN_AGENTS`. */
  readonly builtIns: readonly string[];
}

/** Every shape the project or user config file names under `routing`, `false` rows included. */
export function configuredShapes(layers: ConfigLayers): ReadonlySet<string> {
  return new Set([layers.file, layers.user].flatMap((file) => [
    ...(file?.values.routing?.keys() ?? []),
  ]));
}

/** What `agent` resolves to under `resolution`. See "Every row must resolve". */
export function answerFor(
  agent: string,
  resolution: Resolution,
  builtIns: readonly string[],
): RouteAnswer {
  const item = findTierItem(resolution, 'agent', agent);
  if (item?.state === 'served') return { state: 'served', item };
  if (item?.state === 'collision') return { state: 'collision', collision: item.collision };
  if (builtIns.includes(agent)) return { state: 'built-in' };
  if (item?.state === 'off') return { state: 'off' };
  if (item?.state === 'unloaded') {
    return { state: 'unloaded', tiers: item.holders.map((holder) => holder.source as SkillTier) };
  }
  return { state: 'missing' };
}

/** Why `answer` does not resolve, as the clause after `does not resolve: `. */
function whyUnresolved(answer: RouteAnswer): string {
  switch (answer.state) {
    case 'collision':
      return `${answer.collision.holders.length} loaded tiers hold different definitions of it `
        + `(${answer.collision.holders.map((holder) => holder.path).join(' and ')}); `
        + `pin the tier that serves it: ${answer.collision.pinLine}`;
    case 'off':
      return 'tiers.agents turns it off';
    case 'unloaded':
      return `only the ${[...new Set(answer.tiers)].join(' and ')} tier holds it, `
        + 'and a loop session does not load that';
    default:
      return 'no loaded tier holds an agent of that name';
  }
}

/** The origin of `shape` routed to `agent`. See "A configured row and a default row fail differently". */
function originOf(shape: string, agent: string, configured: ReadonlySet<string>): RouteOrigin {
  return configured.has(shape) || DEFAULT_ROUTING.get(shape) !== agent
    ? 'configured'
    : 'default';
}

/** The sentence for a row that does not resolve, by its origin. */
function unresolvedSentence(row: RouteRow): string {
  const why = whyUnresolved(row.answer);
  if (row.origin === 'configured') {
    return `routing.${row.shape} names agent ${row.agent}, which does not resolve: ${why}`;
  }
  return `the default routing row ${row.shape} → ${row.agent} does not resolve: ${why}; `
    + `route the shape to an agent that resolves, or remove the row: routing: { ${row.shape}: false }`;
}

/**
 * Every row of `routing` resolved against `resolution`: configured rows
 * that do not resolve as load errors, default rows as doctor problems.
 * See the module note.
 */
export function resolveRouting(
  routing: ReadonlyMap<string, RouteTarget>,
  resolution: Resolution,
  context: RoutingContext,
): RoutingReading {
  const rows = [...routing].flatMap(([shape, agent]): RouteRow[] => {
    if (agent === false) return [];
    const answer = answerFor(agent, resolution, context.builtIns);
    return [{
      shape,
      agent,
      origin: originOf(shape, agent, context.configured),
      answer,
      resolves: answer.state === 'served' || answer.state === 'built-in',
    }];
  });
  const unresolved = rows.filter((row) => !row.resolves);

  return {
    rows,
    loadErrors: unresolved.filter((row) => row.origin === 'configured').map(unresolvedSentence),
    doctorProblems: unresolved.filter((row) => row.origin === 'default').map(unresolvedSentence),
  };
}
