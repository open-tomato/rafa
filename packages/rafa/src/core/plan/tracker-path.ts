/**
 * The tracker a plan file is tracked in, by path.
 *
 * {@link trackerPathFor} moved here from `packages/rafa/src/utils/tracker.ts`, which
 * re-exports it under the same name for the importers outside core.
 * `loop/session-readings.ts` reads a plan's checklist from its tracker
 * once there is one, so with the rewrite in core it imports nothing
 * above it. This file imports nothing.
 */

/** The word of a plan file's name that the tracker's name spells `PLAN_TRACKER`. */
const PLAN_WORD = 'PLAN';

/** The extension of a plan file and of its tracker. */
const MARKDOWN = '.md';

/**
 * Derives the tracker path for a plan file: `PLAN.md` → `PLAN_TRACKER.md`,
 * `PLAN-foo.md` → `PLAN_TRACKER-foo.md`. Keeping one tracker per plan lets
 * several plans coexist without clobbering each other's progress.
 *
 * The first `PLAN` of the last path segment that `.md` or a `-` stub
 * follows is rewritten, as the regex `/PLAN(-[^/]*)?\.md$/` replaced
 * it. A scan of the segment does it in linear time, where that regex was
 * tried from every `PLAN` of a long name (CodeQL js/polynomial-redos).
 */
export function trackerPathFor(planPath: string): string {
  if (!planPath.endsWith(MARKDOWN)) return planPath;
  const stubEnd = planPath.length - MARKDOWN.length;
  const name = planPath.lastIndexOf('/') + 1;
  for (let at = planPath.indexOf(PLAN_WORD, name); at !== -1; at = planPath.indexOf(PLAN_WORD, at + 1)) {
    const after = at + PLAN_WORD.length;
    if (after === stubEnd || (after < stubEnd && planPath.charAt(after) === '-')) {
      return `${planPath.slice(0, at)}PLAN_TRACKER${planPath.slice(after, stubEnd)}${MARKDOWN}`;
    }
  }
  return planPath;
}
