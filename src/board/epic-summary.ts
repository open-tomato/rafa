/**
 * A `native`-mode epic's `done/total` and state, read off GitHub's own
 * count of its sub-issues, `subIssuesSummary`, on the epic's listing row
 * (`./roadmap-board.ts`): what `rafa roadmap` prints for an epic when
 * `board.relationships` is `native`
 * (`.rafa/specs/rafa-340-relationships-epics-blockers-github.md`,
 * "Updated to make native relationships a mode").
 *
 * `readEpics` (`./epics.ts`) counts an epic's members on the listing.
 * In `native` mode that count can fall short of GitHub's: a sub-issue in
 * another repository, or one past the listing's limit, is on no row the
 * listing holds. GitHub's summary counts every sub-issue the epic has,
 * so {@link withSubIssuesSummary} lays it over the epic `readEpics` read
 * and recomputes what follows from it. Nothing here spawns or lists: it
 * is a pure function of the epic, its row, the claims and today, and
 * every case in `./epic-summary.test.ts` is a literal row.
 *
 * ## What is taken from the summary
 *
 *  - `done` is the summary's `completed`, and `total` its `total`, as
 *    GitHub counts them. How GitHub counts a sub-issue closed as not
 *    planned is GitHub's, and no measurement in `context/pull-requests.md`
 *    ("Native relationships") records it, so this module takes the two
 *    numbers as answered and does not correct them.
 *  - `notPlanned` stays the tally of the members on the listing closed
 *    as not planned, as `readEpics` read it: the summary carries no such
 *    count.
 *
 * ## The state, from the summary
 *
 * In this order, as `readEpics` orders its own:
 *
 *  - `empty` — the summary's `total` is 0.
 *  - `done` — `completed` equals `total`.
 *  - `in-progress` — at least one sub-issue is completed, or a member on
 *    the listing not closed as not planned is claimed by a plan, a branch
 *    or an open pull request.
 *  - `backlog` — anything else.
 *
 * The stored state reads the epic issue's own state and close reason and
 * is kept as `readEpics` read it; the disagreement between the two and
 * the lateness, which read the computed state, are recomputed from it.
 *
 * An epic row read without `subIssuesSummary` is refused with a
 * `TypeError` naming `board.relationships`, as the `native` adapter
 * (`./relations/native.ts`) refuses a row without its fields, rather than
 * read as an empty epic.
 */
import type { Epic, EpicProgress, EpicState } from './epics.js';
import type { BoardIssue, BoardSubIssuesSummary } from './roadmap-board.js';

import { disagreementOf, isNotPlanned, localDay } from './epics.js';

/** What every failure this module raises opens with. */
const PREFIX = 'board epic summary';

/** The state `summary` and the claimed members make; the module note holds the order. */
function summaryState(summary: BoardSubIssuesSummary, members: readonly BoardIssue[], claims: ReadonlySet<number>): EpicState {
  if (summary.total === 0) return 'empty';
  if (summary.completed === summary.total) return 'done';
  const claimed = members.some((member) => !isNotPlanned(member) && claims.has(member.number));
  return summary.completed > 0 || claimed
    ? 'in-progress'
    : 'backlog';
}

/**
 * `epic`, as `readEpics` read it in `native` mode, with its `done/total`
 * taken from `row`'s `subIssuesSummary` and its state, lateness and
 * disagreement recomputed from them; see the module note. Throws a
 * `TypeError` when `row` is not the epic's row or carries no summary.
 */
export function withSubIssuesSummary(epic: Epic, row: BoardIssue, claims: ReadonlySet<number>, today: Date): Epic {
  if (row.number !== epic.number) {
    throw new TypeError(`${PREFIX}: row #${String(row.number)} is not epic #${String(epic.number)}'s row`);
  }
  const summary = row.subIssuesSummary;
  if (summary === undefined) {
    throw new TypeError(
      `${PREFIX}: epic #${String(epic.number)} was read without subIssuesSummary; `
      + 'board.relationships is native, so the listing must be read with the native fields',
    );
  }
  const progress: EpicProgress = Object.freeze({
    done: summary.completed,
    total: summary.total,
    notPlanned: epic.progress.notPlanned,
  });
  const state = summaryState(summary, epic.members, claims);
  const date = epic.body?.date ?? null;
  return Object.freeze({
    ...epic,
    progress,
    state,
    late: date !== null && date < localDay(today) && state !== 'done',
    disagreement: disagreementOf(epic.number, state, epic.stored),
  });
}
