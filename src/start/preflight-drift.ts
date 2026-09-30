/**
 * The drift check of the preflight `loop start` runs (`start/preflight.ts`):
 * on every second run, the report `claims/drift.ts` answers, printed as
 * warnings and nothing more (`.rafa/plans/rafa-324-claim-issue-so-two`).
 *
 * ## Every second run
 *
 * The runs are counted from the session records under `.rafa/runs/`
 * (`loop/sessions.ts`): each `loop start` writes one under a new id
 * before its preflight runs, so the count this run reads includes its
 * own record. An even count is a due run, so the 2nd, the 4th and every
 * later second run of the project check, whatever plan each runs. A
 * name counts when it is `<id>.json` for an id `isSessionId` accepts;
 * the records are counted, not read, so a record another command would
 * refuse still counts. A runs directory that cannot be listed checks
 * nothing and says so in one warning.
 *
 * ## What is read
 *
 * Only on a due run, and only when the repository resolves to
 * `pr.provider: gh`, since the stage labels the check compares are
 * written through `gh` alone (`claims/labels.ts`): the board through
 * `createCachedBoardListing` (`board/board-cache.ts`), so a due run
 * spends one small incremental read once the cache is kept, and the
 * branches through `scanClaimBranches` (`board/roadmap.ts`), which the
 * check asks only when some issue carries a stage label. `roadmap.issue`
 * is compared as a board beside the listing's `type:roadmap` rows. A run
 * that is not due resolves no provider and reads neither.
 *
 * ## What it prints
 *
 * Each line of `driftLines`, through `warn`: each finding, then each
 * notice, every one opening `claim drift:`. A report with nothing to
 * say prints nothing. The check edits no label, no checklist and no
 * body, and never halts the run: a board or a git that cannot be read is
 * a notice, and anything else the check throws is one warning.
 */
import type { BoardListing } from '../board/roadmap-board.js';
import type { DriftBranches } from '../claims/drift.js';
import type { RafaConfig } from '../config.js';

import { readdirSync } from 'node:fs';

import { activeOutput } from '../adapters/output/active.js';
import { createGhRunner } from '../adapters/tracker/github.js';
import { createCachedBoardListing } from '../board/board-cache.js';
import { scanClaimBranches } from '../board/roadmap.js';
import { checkDrift, driftLines } from '../claims/drift.js';
import { messageOf } from '../config-sections.js';
import { errorCode, isSessionId, runsDir } from '../loop/sessions.js';
import { createGitRunner } from '../pr/git.js';
import { resolvePrProvider } from '../pr/provider.js';

/** A due run is one whose record count is a multiple of this; see the module note. */
export const DRIFT_EVERY = 2;

/** What a record's file name ends in, as `loop/sessions.ts` writes it. */
const RECORD_EXTENSION = '.json';

/** The seams the drift check reads through. */
export interface StartPreflightDrift {
  /** How many run records the project holds, this run's included; {@link countRunRecords} in use. */
  readonly runCount: () => number;
  /** The board listing, or null when the board is not `gh`; asked only on a due run. */
  readonly listing: () => BoardListing | null;
  /** Board numbers the listing's labels do not mark: `roadmap.issue`, when set. */
  readonly boards: readonly number[];
  /** The branch scan; asked only when some issue carries a stage label. */
  readonly branches: () => DriftBranches;
}

/**
 * How many session records `<root>/.rafa/runs/` holds, counted by name;
 * 0 when the directory does not exist. Throws when it cannot be listed.
 */
export function countRunRecords(root: string): number {
  let names: readonly string[];
  try {
    names = readdirSync(runsDir(root));
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return 0;
    throw error;
  }
  return names.filter((name) => name.endsWith(RECORD_EXTENSION)
    && isSessionId(name.slice(0, -RECORD_EXTENSION.length))).length;
}

/** Whether a run that counts `count` records is due a drift check: every second one. */
export function isDriftRun(count: number): boolean {
  return count > 0 && count % DRIFT_EVERY === 0;
}

/**
 * The seams a `loop start` run in `repoRoot` checks drift through. The
 * provider is resolved only when {@link StartPreflightDrift.listing} is
 * asked, which is on a due run alone.
 */
export function createStartPreflightDrift(
  repoRoot: string,
  config: Pick<RafaConfig, 'prProvider' | 'roadmapIssue'>,
): StartPreflightDrift {
  return {
    runCount: () => countRunRecords(repoRoot),
    listing: () => resolvePrProvider({ configured: config.prProvider, dir: repoRoot }).provider === 'gh'
      ? createCachedBoardListing({ gh: createGhRunner({ cwd: repoRoot }), root: repoRoot })
      : null,
    boards: config.roadmapIssue === null
      ? []
      : [config.roadmapIssue],
    branches: () => scanClaimBranches(createGitRunner(repoRoot)),
  };
}

/** Whether this run is due; false, after one warning, when the records cannot be counted. */
function dueRun(seams: StartPreflightDrift, warn: (line: string) => void): boolean {
  try {
    return isDriftRun(seams.runCount());
  } catch (error) {
    warn(`claim drift: the run records could not be counted, so no drift was checked: ${messageOf(error)}`);
    return false;
  }
}

/**
 * Warns each line of the drift report on a due run with a `gh` board,
 * and does nothing otherwise; never rejects. See the module note.
 */
export async function reportStartDrift(seams: StartPreflightDrift): Promise<void> {
  const output = activeOutput();
  const warn = (line: string): void => {
    output.warn(line);
  };
  if (!dueRun(seams, warn)) return;
  try {
    const listing = seams.listing();
    if (listing === null) return;
    const report = await checkDrift({ listing, boards: seams.boards, branches: seams.branches });
    for (const line of driftLines(report)) warn(line);
  } catch (error) {
    warn(`claim drift: the check could not run, so no drift was checked: ${messageOf(error)}`);
  }
}
