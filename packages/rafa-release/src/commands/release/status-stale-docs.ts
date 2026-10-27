/**
 * The stale-docs reading of `rafa release status`: how many lines the
 * release's stale-docs issues hold open, so an operator sees before a
 * release whether `rafa docs plan` has anything left to plan.
 *
 * ## What is read
 *
 * The tracker the chain lands on for the project, from `tracker.default`
 * and `tracker.fallback` (`packages/rafa-board/src/adapters/tracker/resolve.ts`), each kind
 * passed over warned about as the chain always warns. Then the open
 * lines through `readOpenStaleDocLines` (`packages/rafa-release/src/docs/open-lines.ts`):
 * every unticked checklist item of every open `chore` issue carrying the
 * stale-docs marker. This is the one reading of the command that can
 * reach the network: the `github` tracker runs `gh`.
 *
 * ## Nothing here throws
 *
 * A chain landing nowhere, a tracker that cannot list its issues, and a
 * listing that rejects each answer a reading with a `problem` and no
 * count, which {@link staleDocsCell} renders as the unreadable cell and
 * the block says why under itself. Zero open lines is a reading, `none`;
 * a failed listing is none. No reading here changes the command's exit
 * code, and no count refuses a release.
 */
import type { OpenLinesTracker } from '../../docs/open-lines.js';
import type { RafaConfig } from '@open-tomato/rafa/core/config';
import type { ProjectFound } from '@open-tomato/rafa/project/scope';

import { messageOf } from '@open-tomato/rafa/core/config/sections';
import { resolveTracker } from '@open-tomato/rafa-board';

import { readOpenStaleDocLines } from '../../docs/open-lines.js';

/** A run of white space, the line separators included. */
const WHITE_SPACE = /\s+/g;

/** How many stale-docs lines are open, or why that could not be read. */
export interface StaleDocsReading {
  /** The open lines, or null when they could not be read. */
  readonly count: number | null;
  /** Why they could not be read, in one line, or null when they were. */
  readonly problem: string | null;
}

/** The tracker settings the chain is resolved from. */
export type StaleDocsSettings = Pick<RafaConfig, 'trackerDefault' | 'trackerFallback'>;

/** What of the project the reading needs: its root, where the chain resolves. */
export type StaleDocsProject = Pick<ProjectFound, 'root'>;

/** Reads the stale-docs lines for a project; the seam a test replaces. */
export type StaleDocsReader = (project: StaleDocsProject, settings: StaleDocsSettings) => Promise<StaleDocsReading>;

/** The sentence a problem is said under the block in. */
export function staleDocsProblem(problem: string): string {
  return `the stale-docs lines could not be read: ${problem}`;
}

/** The reading of `tracker`'s open lines, a null tracker being one the chain did not land on. */
export async function staleDocsReadingOf(tracker: OpenLinesTracker | null): Promise<StaleDocsReading> {
  const read = await readOpenStaleDocLines(tracker);
  return read.problem === null
    ? { count: read.count, problem: null }
    : { count: null, problem: read.problem };
}

/** The tracker the chain lands on for `project`, or the chain's failure in one line. */
async function landTracker(
  project: StaleDocsProject,
  settings: StaleDocsSettings,
): Promise<{ tracker: OpenLinesTracker | null; problem: string | null }> {
  try {
    const resolution = await resolveTracker({ config: settings, context: { repoRoot: project.root } });
    return { tracker: resolution.tracker, problem: null };
  } catch (error) {
    return { tracker: null, problem: `no tracker can be read: ${messageOf(error)}`.replace(WHITE_SPACE, ' ').trim() };
  }
}

/** The system's own reader: the chain, then the open lines; see the module note. Never throws. */
export const readStaleDocs: StaleDocsReader = async (project, settings) => {
  const landed = await landTracker(project, settings);
  if (landed.problem !== null) return { count: null, problem: landed.problem };
  return staleDocsReadingOf(landed.tracker);
};

/**
 * What `read` answers, a reader that rejects or throws kept as a
 * problem, so no reader can change the command's exit code.
 */
export async function readStaleDocsSafely(
  read: StaleDocsReader,
  project: StaleDocsProject,
  settings: StaleDocsSettings,
): Promise<StaleDocsReading> {
  try {
    return await read(project, settings);
  } catch (error) {
    const problem = messageOf(error).replace(WHITE_SPACE, ' ')
      .trim();
    return { count: null, problem };
  }
}

/** The stale-docs cell: the open-line count, `nothing` at zero, or null when unread. */
export function staleDocsCell(reading: StaleDocsReading, nothing: string): string | null {
  if (reading.count === null) return null;
  if (reading.count === 0) return nothing;
  return reading.count === 1
    ? '1 open line'
    : `${reading.count} open lines`;
}
