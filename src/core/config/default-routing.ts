/**
 * rafa's routing defaults: which agent a task of each shape goes to
 * when no config layer says otherwise.
 *
 * The table moved here from `src/tiers/routing.ts`, which re-exports
 * each name, so `core-section.ts` reads {@link DEFAULT_ROUTING} without
 * importing above core. What the rows mean, and why the map is one
 * shared `Map` while the list is frozen, is `routing.ts`'s module note.
 */
import type { RouteTarget } from './config-sections.js';

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
