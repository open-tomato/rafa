/**
 * The recheck reading of the pit stop (#1477): every bug filed since the
 * last item, judged the way `rafa bug recheck` judges it, so the engineer
 * sees which of the loop's bugs still reproduce without typing the
 * recheck by hand.
 *
 * ## What it reads
 *
 * - **The bugs.** The filed-since reading, each bug carrying its ref, its
 *   number, its title and its body. No author is carried: each is read
 *   unread (`author: null`), so the judge asks the tracker's `editable`
 *   for it, and only for a bug whose reference is runnable.
 * - **The judge.** {@link PitJudge}, in production `judgeBugs`
 *   (`src/commands/bug/recheck-judge.ts`) bound to the recheck config by
 *   its caller under `src/commands/stretch/`. It is a seam rather than an
 *   import because no file outside `src/commands/` imports one inside it
 *   (`src/tests/commands-direction.sweep.test.ts`). It is called once,
 *   over every bug in filing order, and its rows are the reading's value
 *   in that order. With no bug filed it is not called at all.
 *
 * ## When it is not read
 *
 * A filed-since reading that was not read leaves this one not read with
 * the same reason, and the judge is never called. A judge that throws is
 * not read with its message. Neither is ever rendered as none filed.
 */
import type { Reading } from './pit-readings.js';
import type { RecheckVerdict } from '../bugs/recheck-verdict.js';
import type { IssueRef } from '@open-tomato/rafa/ports';

import { messageOf } from '@open-tomato/rafa/core/config/sections';

/** One bug filed since the cut-off, as the judge is handed it. */
export interface PitRecheckBug {
  readonly ref: IssueRef;
  /** The bug's number, as `Recheck #<n>` prints it. */
  readonly issue: number;
  readonly title: string;
  readonly body: string;
}

/** A bug handed to the judge: its author yet to be read. */
export interface PitJudgedBug extends PitRecheckBug {
  readonly author: null;
}

/** One bug's judged row: the fields of `RecheckRow` this reading prints. */
export interface PitRecheckRow {
  readonly issue: number;
  readonly verdict: RecheckVerdict;
  /** How many runs ran. */
  readonly runs: number;
  /** How many runs failed, on `flaky` only, else null. */
  readonly failedRuns: number | null;
  /** Why the row is `manual`, `skipped` or `stale`, else null. */
  readonly reason: string | null;
  /** The record's reproduce text, on a `manual` row only, else null. */
  readonly reproduce: string | null;
}

/** What judges the bugs: `judgeBugs` bound to its options in production. */
export type PitJudge = (bugs: readonly PitJudgedBug[]) => Promise<{ readonly rows: readonly PitRecheckRow[] }>;

/** The filed-since reading the rechecks are read over. */
export type PitFiledReading = Reading<{ readonly bugs: readonly PitRecheckBug[] }>;

/** The indent of the reproduce text under a `manual` line. */
const REPRODUCE_INDENT = '    ';

/** Judges every bug of `filed` through `judge`; see the module note. Never throws. */
export async function readPitRechecks(judge: PitJudge, filed: PitFiledReading): Promise<Reading<PitRecheckRow[]>> {
  if (!filed.ok) return filed;
  const bugs = filed.value.bugs.map((bug): PitJudgedBug => ({ ...bug, author: null }));
  if (bugs.length === 0) return { ok: true, value: [] };
  try {
    const judged = await judge(bugs);
    return { ok: true, value: [...judged.rows] };
  } catch (error) {
    return { ok: false, reason: messageOf(error) };
  }
}

/** The detail after a row's verdict: the reason, the failed runs, or none. */
function detailOf(row: PitRecheckRow): string {
  if (row.verdict === 'skipped' || row.verdict === 'stale') {
    return row.reason === null
      ? ''
      : `: ${row.reason}`;
  }
  if (row.verdict === 'flaky') return `: ${String(row.failedRuns ?? 0)} of ${String(row.runs)} runs failed`;
  return '';
}

/** The line or lines of one row: `Recheck #<n>: <verdict>`, and the reproduce text under a `manual` one. */
function rowLines(row: PitRecheckRow): string[] {
  const head = `Recheck #${String(row.issue)}: ${row.verdict}${detailOf(row)}`;
  if (row.verdict !== 'manual' || row.reproduce === null) return [head];
  return [head, ...row.reproduce.split('\n').map((line) => `${REPRODUCE_INDENT}${line}`)];
}

/** The `Recheck` lines for `rechecks`, one per bug in filing order. */
export function renderPitRechecks(rechecks: Reading<readonly PitRecheckRow[]>): string[] {
  if (!rechecks.ok) return [`Recheck: not read (${rechecks.reason}).`];
  if (rechecks.value.length === 0) return ['Recheck: no bug filed since.'];
  return rechecks.value.flatMap(rowLines);
}
