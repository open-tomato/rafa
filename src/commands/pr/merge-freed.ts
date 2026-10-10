/**
 * What `rafa pr merge` reads after its clean-up under
 * `board.relationships: native`: the open issues the merge freed, printed
 * and never written to.
 *
 * In the `labels` mode, the default, that step is the unblock reading
 * (`./merge-unblock.ts`), which asks about each freed issue and takes
 * `spec:blocked` off; with the epic tick (`./merge-tick.ts`) it is what
 * the `labels` adapter's `afterMerge` runs (`src/board/relations/labels.ts`).
 * In the `native` mode a blocker is GitHub's blocked-by link, which
 * GitHub clears by itself when the blocking issue closes, and the
 * `native` adapter's `afterMerge` writes nothing. So this module asks no
 * question and sends no write: it names the issues whose last open
 * blocker this merge closed, so the operator learns what the merge made
 * ready to start.
 *
 * ## Read from one listing, through the port
 *
 * {@link freedAfterMerge} makes the `native` adapter through
 * `selectBoardRelations` (`src/board/relations/select.ts`), reads ONE
 * board listing with the fields that mode asks for, and answers the
 * port's `freedBy` over it for the issues the merged pull request closes
 * ({@link closedIssuesIn}). The rule for "freed" is the port's alone
 * (`src/board/relations/freed.ts`): an open issue one of whose blockers
 * is among the closed issues, and which waits on nothing once they count
 * as closed. A blocker still open, a truncated `blockedBy` list and a
 * blocker on this board whose state was not read all keep an issue
 * waiting, so it is not named. Nothing here sends a per-blocker
 * `gh issue view`: a blocker's state is its `blockedBy` node.
 *
 * The `native` adapter tells a blocker on this board from one on
 * another, so it is made with the board's `owner/name`, read with one
 * `gh repo view --json nameWithOwner` (`readBoardRepository`,
 * `../epic/move-native.ts`). A merge closing an issue therefore sends
 * two `gh` calls here, the repository and the listing, and a merge
 * closing none sends nothing at all, as the unblock reading does not.
 *
 * ## What it prints
 *
 * Nothing when the merge freed nothing, as an empty unblock reading is
 * silence. Otherwise {@link freedHeaderLine}, which opens with
 * {@link NATIVE_MODE} as every native-mode no-op line does, then one
 * indented line per freed issue, lowest number first, naming its title.
 *
 * ## Why every failure is a warning
 *
 * The merge has already happened by the time this runs, as
 * `./merge-unblock.ts` records for its own reading. A repository `gh`
 * will not name and a listing it will not answer are each one
 * {@link freedProblemLine} warning, and `pr merge` keeps its exit code.
 */
import type { GhRunner } from '../../adapters/tracker/github.js';
import type { BoardIssue } from '../../board/roadmap-board.js';

import { selectBoardRelations } from '../../board/relations/select.js';
import { createGhBoardListing } from '../../board/roadmap-board.js';
import { closedIssuesIn } from '../../board/roadmap.js';
import { messageOf } from '../../config-sections.js';
import { plural } from '../../plan/plan-files.js';
import { NATIVE_MODE, readBoardRepository } from '../epic/move-native.js';

import { INDENT } from './merge-cleanup.js';

/** What every warning this module writes names the reading as. */
const READING = 'the freed-issue reading';

/** One open issue the merge freed, as the listing named it. */
export interface FreedIssue {
  readonly number: number;
  readonly title: string;
}

/** What the freed-issue reading came to, as `pr merge`'s json result carries it. */
export interface FreedReport {
  /** The mode it was read in; the reading runs in `native` alone. */
  readonly relationships: 'native';
  /** The issues the merged pull request closes, in the order the body names them, each once. */
  readonly closed: readonly number[];
  /** The open issues the merge freed, lowest number first; empty when it freed none or could not read. */
  readonly freed: readonly FreedIssue[];
  /** Why the reading could not run, or null when it ran. */
  readonly problem: string | null;
}

/** What {@link freedAfterMerge} is asked. */
export interface MergeFreedOptions {
  /** The merged pull request's body, which the closing keywords are read out of. */
  readonly body: string;
  /** Runs the `gh` calls the reading sends: the repository and the listing. */
  readonly gh: GhRunner;
  /** Where the freed issues are printed. */
  readonly info: (message: string) => void;
  /** Where a reading that could not run says so. */
  readonly warn: (message: string) => void;
}

/** `#20, #21`. */
function named(issues: readonly number[]): string {
  return issues.map((issue) => `#${String(issue)}`).join(', ');
}

/** What a reading that could not run says. */
export function freedProblemLine(problem: string): string {
  return `${READING} did not run: ${problem}`;
}

/** The line printed above the freed issues; see the module note. */
export function freedHeaderLine(closed: readonly number[], freed: number): string {
  return `${NATIVE_MODE}: the merge freed ${plural(freed, 'issue')}, whose blockers GitHub cleared when`
    + ` ${named(closed)} closed, so nothing was written:`;
}

/** The line printed for one freed issue. */
export function freedIssueLine(issue: FreedIssue): string {
  const title = issue.title.trim();
  return title === ''
    ? `${INDENT}#${String(issue.number)}`
    : `${INDENT}#${String(issue.number)} ${title}`;
}

/** The report for `closed`, freezing what it holds. */
function report(closed: readonly number[], freed: readonly FreedIssue[], problem: string | null): FreedReport {
  return Object.freeze({ relationships: 'native', closed, freed: Object.freeze(freed), problem });
}

/** The issues `listing` says closing `closed` frees, read through the `native` port over `gh`. */
async function readFreed(gh: GhRunner, closed: readonly number[]): Promise<readonly FreedIssue[]> {
  const repository = await readBoardRepository(gh);
  const relations = selectBoardRelations({ boardRelationships: 'native' }, { gh, repository });
  const listing: readonly BoardIssue[] = await createGhBoardListing({ gh, mode: relations.mode })();
  const titles = new Map(listing.map((row) => [row.number, row.title]));
  return relations.read(listing).freedBy(closed)
    .map((number) => Object.freeze({ number, title: titles.get(number) ?? '' }));
}

/**
 * The open issues the merged pull request freed, printed through `info`
 * with no write sent; or null, having sent nothing, when it closes no
 * issue. A reading that could not run is one `warn` and a report
 * carrying the problem. Never throws: see the module note.
 */
export async function freedAfterMerge(options: MergeFreedOptions): Promise<FreedReport | null> {
  const { body, gh, info, warn } = options;
  const closed = Object.freeze([...new Set(closedIssuesIn(body))]);
  if (closed.length === 0) return null;

  let freed: readonly FreedIssue[];
  try {
    freed = await readFreed(gh, closed);
  } catch (error) {
    const problem = messageOf(error);
    warn(freedProblemLine(problem));
    return report(closed, [], problem);
  }

  if (freed.length > 0) {
    info(freedHeaderLine(closed, freed.length));
    for (const issue of freed) info(freedIssueLine(issue));
  }
  return report(closed, freed, null);
}
