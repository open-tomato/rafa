/**
 * The tracker a plan file is tracked in, by path.
 *
 * {@link trackerPathFor} moved here from `src/utils/tracker.ts`, which
 * re-exports it under the same name for the importers outside core.
 * `loop/session-readings.ts` reads a plan's checklist from its tracker
 * once there is one, so with the rewrite in core it imports nothing
 * above it. This file imports nothing.
 */

/**
 * Derives the tracker path for a plan file: `PLAN.md` → `PLAN_TRACKER.md`,
 * `PLAN-foo.md` → `PLAN_TRACKER-foo.md`. Keeping one tracker per plan lets
 * several plans coexist without clobbering each other's progress.
 */
export function trackerPathFor(planPath: string): string {
  return planPath.replace(/PLAN(-[^/]*)?\.md$/, (_m, stub: string | undefined) => `PLAN_TRACKER${stub ?? ''}.md`);
}
