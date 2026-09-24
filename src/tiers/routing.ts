/**
 * The routing defaults: which agent a task of each shape goes to when
 * no config layer says otherwise.
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
 *     uses to turn an item off. The spec has maps merge by key across
 *     layers, a `false` removing the row. Nothing merges yet, so today
 *     a layer naming `routing` answers the map WHOLE, as every setting's
 *     layer does: a project writing `routing: { cleanup: refactor-cleaner }`
 *     is routed by that one row, without the five below. The value
 *     shape is settled here so the merge can apply without a special
 *     case.
 *   - {@link DEFAULT_ROUTING} is one shared `Map`, as each empty map
 *     default in `CONFIG_DEFAULTS` is. A `Map` cannot be frozen, so the
 *     promise that no caller edits it rests on its `ReadonlyMap` type,
 *     while {@link DEFAULT_ROUTES}, a list, is frozen outright.
 *
 * Whether each row's agent RESOLVES through the tiers is a question for
 * the resolver the spec plans in `tiers/resolve.ts`, not this module.
 */
import type { RouteTarget } from '../config-sections.js';

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
