/**
 * The unblock reading `rafa pr merge` ends with: every open issue
 * whose `Blocked by:` line names an issue the merged pull request
 * closes, read, asked about and unlabelled where every blocker has
 * closed.
 *
 * `src/commands/issue/unblock.ts` is the whole of what touches the
 * board — the listing, the state of each blocker, the one question and
 * the one `removeLabel` — and this module is the half that decides
 * whether a merge has anything to unblock at all and turns everything
 * that can go wrong on the way into a warning. It sits beside
 * `./merge-tick.ts`, the other module holding a board-shaped piece of
 * what `pr merge` does after the provider merged, and for the same
 * reason: a merge runs it by itself at the moment a blocker clears
 * (`.rafa/specs/rafa-63-one-command-next-step.md`).
 *
 * ## Nothing is spent on the ordinary merge
 *
 * A pull request whose body names no issue with a closing keyword
 * unblocks nothing, and {@link unblockAfterMerge} answers null for it
 * BEFORE the board is asked anything. A merge that DOES close an issue
 * costs one `gh issue list` for the open `spec:blocked` issues, and
 * the state listing and the label write only where one of them names
 * a closed issue. A repository that keeps no blocked issue therefore
 * pays one listing answering `[]` and prints nothing at all — an
 * empty reading is silence here, where in `rafa issue unblock` it is
 * the line saying no issue is labelled.
 *
 * ## Which issues it considers
 *
 * The issues the merged pull request closes ({@link closedIssuesIn})
 * are what the open blocked issues are FILTERED by, through
 * `runUnblock`'s `naming`: an issue whose line names none of them was
 * not touched by this merge and is nobody's business here. Whether
 * each named blocker is actually closed is still the BOARD's answer
 * and not this module's — the state listing `runUnblock` sends is what
 * decides, so an issue also blocked by something still open keeps its
 * label with that blocker named, exactly as `rafa issue unblock` reads
 * it.
 *
 * A `Blocked by:` line that is a fault carries what parsed, so a line
 * naming ITSELF and a closed issue is considered here and reported as
 * the fault it is. A line with no ids and a body with no line name
 * nothing, so no merge ever selects them; `rafa doctor` is where those
 * two surface.
 *
 * ## Why every failure is a warning
 *
 * The merge has already happened by the time this runs, as
 * `./merge-tick.ts` records for the roadmap tick. A board that will
 * not answer the listing, an issue whose line cannot be read and a
 * `removeLabel` GitHub refused none of them un-merge anything, and
 * failing the command over one would tell an operator their merge
 * broke when what broke is a label. So every one of them is reported
 * through `warn` and `pr merge` keeps its exit code.
 *
 * The warning always names the reading ({@link unblockProblemLine},
 * {@link unblockWarningLine}), so a line in a merge's output is never
 * read as something the merge itself did.
 *
 * ## Nothing here spawns
 *
 * GitHub arrives through the {@link GhRunner} seam, the question
 * through {@link MergeUnblockOptions.ask}, and both lines it writes
 * through the two sinks, so every case in `./merge-unblock.test.ts`
 * drives a recorded runner and a scripted answer and none of them
 * reaches GitHub, spawns `gh` or waits on an answer.
 */
import type { GhRunner } from '../../adapters/tracker/github.js';
import type { UnblockAsk, UnblockReport } from '../issue/unblock.js';

import { closedIssuesIn } from '../../board/roadmap.js';
import { messageOf } from '../../config-sections.js';
import { isUnblockFailure, runUnblock } from '../issue/unblock.js';

/** What every line this module writes about the reading names it as. */
const READING = 'the blocked-issue reading';

/** What {@link unblockAfterMerge} is asked. */
export interface MergeUnblockOptions {
  /** The merged pull request's body, which the closing keywords are read out of. */
  readonly body: string;
  /** Runs every `gh` command the reading sends. */
  readonly gh: GhRunner;
  /** Asks the one question per issue, or null when there is nobody to ask. */
  readonly ask: UnblockAsk | null;
  /** Where each issue that came to something ordinary says so. */
  readonly info: (message: string) => void;
  /** Where a reading that came out badly says so. */
  readonly warn: (message: string) => void;
}

/** What a reading that could not be run at all says. */
export function unblockProblemLine(problem: string): string {
  return `${READING} did not run: ${problem}`;
}

/** What one issue the reading came out badly for says. */
export function unblockWarningLine(message: string): string {
  return `${READING}: ${message}`;
}

/**
 * Reads every open issue whose `Blocked by:` line names an issue the
 * merged pull request closes, asks about each one whose blockers have
 * all closed, and takes `spec:blocked` off the ones answered yes for;
 * or answers null when the pull request closes no issue.
 *
 * Writes one line per issue through `info`, and every failure through
 * `warn` naming the reading. Never throws: see the module note.
 */
export async function unblockAfterMerge(options: MergeUnblockOptions): Promise<UnblockReport | null> {
  const { body, gh, ask, info, warn } = options;
  const closed = closedIssuesIn(body);
  if (closed.length === 0) return null;

  let report: UnblockReport;
  try {
    report = await runUnblock({ gh, issues: null, naming: closed, ask });
  } catch (error) {
    warn(unblockProblemLine(messageOf(error)));
    return null;
  }

  if (report.problem !== null) {
    warn(unblockProblemLine(report.problem));
    return report;
  }
  for (const issue of report.issues) {
    if (isUnblockFailure(issue.status)) warn(unblockWarningLine(issue.message));
    else info(issue.message);
  }
  if (report.unchecked !== null) warn(unblockWarningLine(report.unchecked));
  return report;
}
