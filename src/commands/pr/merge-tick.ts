/**
 * The roadmap tick `rafa pr merge` writes once the provider has merged:
 * which issues the merged pull request closes, which issue is the
 * roadmap, and the one call that ticks their lines.
 *
 * The rule and the writes are `src/board/roadmap-tick.ts`'s; this
 * module is the half that decides whether there is anything to tick at
 * all and turns everything that can go wrong on the way into a warning.
 *
 * ## Nothing is spent on the ordinary merge
 *
 * A pull request whose body names no issue with a closing keyword ticks
 * nothing, and {@link tickRoadmapAfterMerge} answers null for it BEFORE
 * the roadmap is resolved. That matters for cost and for noise: the
 * roadmap fallback is a `gh issue list --search`, and running it after
 * every merge would spend a call on every repository that keeps no
 * roadmap and warn each of them that it found none.
 *
 * ## Why every failure is a warning
 *
 * The merge has already happened by the time this runs. A roadmap that
 * cannot be resolved, a board that would not take the edit, a
 * `roadmap.issue` pointing at an issue that is gone — none of them
 * un-merge anything, and failing the command over one would tell an
 * operator their merge broke when what broke is a checkbox. So the
 * refusals `resolveRoadmapIssue` raises (`CommandExit`, exit 2 for no
 * roadmap and for several) are caught here with everything else and
 * reported through `warn`, and `pr merge` keeps its exit code.
 *
 * The warning always names the tick, so a line in a merge's output is
 * never read as something the merge itself did.
 */
import type { GhRunner } from '../../adapters/tracker/github.js';
import type { RoadmapTickResult } from '../../board/roadmap-tick.js';

import { createGhRoadmapBody, tickRoadmapIssue } from '../../board/roadmap-tick.js';
import { closedIssuesIn, createGhRoadmapSearch, resolveRoadmapIssue } from '../../board/roadmap.js';
import { messageOf } from '../../config-sections.js';

/** What {@link tickRoadmapAfterMerge} is asked. */
export interface MergeTickOptions {
  /** The merged pull request's body, which the closing keywords are read out of. */
  readonly body: string;
  /** `roadmap.issue` as config resolved it, or null for the issue titled `Roadmap`. */
  readonly configured: number | null;
  /** Runs every `gh` command the tick sends. */
  readonly gh: GhRunner;
  /** Where a tick that could not be written says so. */
  readonly warn: (message: string) => void;
}

/** What a tick that could not be attempted at all says. */
export function tickProblemLine(problem: string): string {
  return `the roadmap was not ticked: ${problem}`;
}

/**
 * Ticks the roadmap lines of every issue the merged pull request closes,
 * or answers null when it closes none. Never throws: see the module
 * note.
 */
export async function tickRoadmapAfterMerge(options: MergeTickOptions): Promise<RoadmapTickResult | null> {
  const { body, configured, gh, warn } = options;
  const issues = closedIssuesIn(body);
  if (issues.length === 0) return null;

  try {
    const roadmap = await resolveRoadmapIssue({
      configured,
      search: createGhRoadmapSearch({ gh }),
    });
    return await tickRoadmapIssue({ roadmap, issues, board: createGhRoadmapBody({ gh }) });
  } catch (error) {
    warn(tickProblemLine(messageOf(error)));
    return null;
  }
}
