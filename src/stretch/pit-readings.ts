/**
 * The pit-stop readings `rafa stretch item` prints once an item has
 * merged into the integration branch (#816): what the newest CI run on
 * that branch did, how many bugs are open, and which bugs were filed
 * since the last item. The readings decide nothing; the pit-stop skill
 * (`src/bundled/operators/skills/rafa-stretch-pit-stop/SKILL.md`) does.
 *
 * ## What each reading reads
 *
 * - **CI**: the newest run on the branch, of one workflow when one is
 *   named, through `readNewestRun` (`../ci/runs.ts`), and for a red run
 *   its `--log-failed` text through the reader `rafa ci status` uses
 *   (`../ci/status-reading.ts`), whose cases `readFailedCases`
 *   (`../ci/failed-cases.ts`) groups by file. The reading is a
 *   {@link CiStatusReading}, rendered by `renderCiStatus`, so a pit stop
 *   and `rafa ci status --branch` print one run the same way.
 * - **Open bugs**: the length of the tracker port's
 *   `openIssues('bug')`. A tracker without that optional member reads as
 *   not read, never as zero.
 * - **Bugs filed since**: the tracker port's `filedIssues('bug', since)`,
 *   a listing of its own, by filing time and in any state, `since` being
 *   the caller's cut-off (the last ledger line's time, `lastItemTime` in
 *   `./items.ts`, else the stretch's start). A bug filed after the cut-off
 *   and closed before the reading is listed, since a pit stop wants the
 *   bugs the loop filed whatever has happened to them since. Each bug's
 *   time is the `createdAt` its `FiledIssue` carries
 *   (`packages/rafa/src/ports/index.ts`), so the one listing dates them
 *   and no call is sent per bug. The bugs are filtered to those after
 *   `since` again here, since an adapter may answer one filed at it or
 *   just before it: the GitHub adapter writes the cut-off to the second,
 *   and the local one answers a record at or after it. A time that does
 *   not parse makes the reading not read and names the bug, since a bug
 *   left out would read as not filed. Each bug carries its body's first
 *   line: the first non-blank line, trimmed, cut to
 *   {@link FIRST_LINE_MAX} characters, or null for a body with none. A
 *   tracker without `filedIssues` reads as not read
 *   ({@link NO_FILED_ISSUES}), never as none.
 *
 *   The GitHub adapter lists through `gh issue list --search`, which goes
 *   through GitHub's search API and its index, seconds behind a filing: a
 *   bug filed in the last moments before a reading can be missing from
 *   it. The readings run minutes after the loop ends, past the merge and
 *   the CI wait, so the lag is noted here and not worked around.
 *
 * ## Why filed-since has a listing of its own
 *
 * The reading once filtered the same `openIssues('bug')` the count reads,
 * so a bug the pit-stop operator closed between the loop's filing and the
 * item's readings dropped out of both. Stretch 7 recorded it in five
 * times: the cut-off (`2026-10-14T01:29:39.610Z`, the last ledger line),
 * #1084 filed after it (`2026-10-14T03:04:38Z`), #1084 closed by the
 * operator, the item's readings taken, and the lines printed,
 * `Bugs: 3 open.` and `Filed since 2026-10-14T01:29:39.610Z: none.`. The
 * listing's label filter, its limit and the cut-off were all right; the
 * source of the reading was not. The count still reads the open listing
 * alone, the board's open `type:bug` count, and the filed-since reading
 * now lists #1084 in that shape; `pit-readings.test.ts` records it.
 *
 * ## Each reading stands alone
 *
 * A reading that fails, a `gh` that would not answer or a tracker that
 * threw, is held as `{ ok: false, reason }` and printed as such; the
 * other readings are still read and printed. The count and the
 * filed-since reading send a call each, so a `filedIssues` that throws
 * leaves the count printed, and an `openIssues` that throws leaves the
 * filed bugs listed. A pit stop that sees one reading is worth more than
 * none, and a failure is never shown as a green run, a zero count or
 * none filed.
 */
import type { CiStatusReading } from '../ci/status-reading.js';
import type { FiledIssue, OpenIssue, Tracker } from '@open-tomato/rafa/ports';
import type { GhRunner } from '@open-tomato/rafa-board';

import { messageOf } from '@open-tomato/rafa/core/config/sections';

import { readFailedCases } from '../ci/failed-cases.js';
import { readNewestRun } from '../ci/runs.js';
import { CI_STATUS_EXIT, readFailedLog, renderCiStatus, verdictOf } from '../ci/status-reading.js';

/** Where the readings come from. */
export interface PitSeams {
  /** The runner `gh run list` and `gh run view` are sent through. */
  readonly gh: GhRunner;
  /** The tracker port, read for its open bugs and for the bugs filed since the cut-off. */
  readonly tracker: Pick<Tracker, 'openIssues' | 'filedIssues'>;
}

/** What to read. */
export interface PitQuery {
  /** The integration branch, `stretch/<n>`. */
  readonly branch: string;
  /** The workflow whose runs count, as `gh run list --workflow` takes it. Left out, any. */
  readonly workflow?: string;
  /** Bugs filed after this time are listed as new. */
  readonly since: Date;
}

/** A reading that was read, or why it was not. */
export type Reading<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly reason: string };

/** One bug filed since the cut-off, open or closed since. */
export interface FiledBug {
  /** The tracker's own number for it, as the port's `externalId`. */
  readonly id: string;
  readonly title: string;
  readonly url: string | null;
  /** ISO 8601. */
  readonly filedAt: string;
  /**
   * The body's first non-blank line, trimmed, cut to
   * {@link FIRST_LINE_MAX} characters; null for a body with none.
   */
  readonly firstLine: string | null;
}

/** Every pit-stop reading. */
export interface PitReadings {
  readonly ci: Reading<CiStatusReading>;
  readonly openBugs: Reading<number>;
  /** The cut-off, ISO 8601, and the bugs filed after it, oldest first. */
  readonly filedSince: Reading<{ readonly since: string; readonly bugs: readonly FiledBug[] }>;
}

/** Why the open bugs are not read on a tracker without `openIssues`. */
export const NO_OPEN_ISSUES = 'the tracker lists no open issues (it has no openIssues)';

/** Why the bugs filed since are not read on a tracker without `filedIssues`. */
export const NO_FILED_ISSUES = 'the tracker lists no filed issues (it has no filedIssues)';

/** Why the bugs filed since are not read for a cut-off that is no time. */
const INVALID_CUT_OFF = 'the cut-off is not a valid time';

/** The most characters of a body's first line a filed bug carries. */
export const FIRST_LINE_MAX = 100;

/** Reads every pit-stop reading for `query`; see the module note. Never throws on a failed reading. */
export async function readPitReadings(seams: PitSeams, query: PitQuery): Promise<PitReadings> {
  const ci = await attempt(() => readCi(seams.gh, query));
  const bugs = await attempt(() => readOpenBugs(seams.tracker));
  const openBugs: Reading<number> = bugs.ok
    ? { ok: true, value: bugs.value.length }
    : bugs;
  return { ci, openBugs, filedSince: await readFiledSince(seams.tracker, query.since) };
}

/** The CI reading, in the shape `rafa ci status` reads. */
async function readCi(gh: GhRunner, query: PitQuery): Promise<CiStatusReading> {
  const run = await readNewestRun(gh, query.workflow === undefined
    ? { branch: query.branch }
    : { branch: query.branch, workflow: query.workflow });
  const verdict = verdictOf(run);
  const log = run !== null && verdict === 'red'
    ? await readFailedLog(gh, run.id)
    : null;
  return {
    branch: query.branch,
    workflow: query.workflow ?? null,
    verdict,
    run,
    failed: log === null
      ? null
      : readFailedCases(log),
    exitCode: CI_STATUS_EXIT[verdict],
  };
}

/** The open bugs, through the port. */
async function readOpenBugs(tracker: PitSeams['tracker']): Promise<readonly OpenIssue[]> {
  if (tracker.openIssues === undefined) throw new Error(NO_OPEN_ISSUES);
  return tracker.openIssues('bug');
}

/** The bugs filed after `since`, in any state, through the port. */
async function readFiledBugs(tracker: PitSeams['tracker'], since: Date): Promise<readonly FiledIssue[]> {
  if (tracker.filedIssues === undefined) throw new Error(NO_FILED_ISSUES);
  return tracker.filedIssues('bug', since);
}

/** The first non-blank line of `body`, trimmed and cut to {@link FIRST_LINE_MAX} characters, null for none. */
function firstLineOf(body: string): string | null {
  const line = body
    .split(/\r?\n/)
    .map((text) => text.trim())
    .find((text) => text !== '');
  if (line === undefined) return null;
  const chars = Array.from(line).slice(0, FIRST_LINE_MAX);
  return chars.join('');
}

/** The bugs filed after `since`, oldest first, each dated by its own `createdAt`. */
async function readFiledSince(tracker: PitSeams['tracker'], since: Date): Promise<PitReadings['filedSince']> {
  if (Number.isNaN(since.getTime())) return { ok: false, reason: INVALID_CUT_OFF };
  const bugs = await attempt(() => readFiledBugs(tracker, since));
  if (!bugs.ok) return bugs;
  const dated = bugs.value.map((bug) => ({ bug, at: Date.parse(bug.createdAt) }));
  const unknown = dated.filter((entry) => Number.isNaN(entry.at)).map((entry) => `#${entry.bug.ref.externalId}`);
  if (unknown.length > 0) return { ok: false, reason: `no filing time for ${unknown.join(', ')}` };
  const filed = dated
    .filter((entry) => entry.at > since.getTime())
    .sort((a, b) => a.at - b.at)
    .map(({ bug, at }): FiledBug => ({
      id: bug.ref.externalId,
      title: bug.title,
      url: bug.ref.url,
      filedAt: new Date(at).toISOString(),
      firstLine: firstLineOf(bug.body),
    }));
  return { ok: true, value: { since: since.toISOString(), bugs: filed } };
}

/** `read()`'s value, or the reason it threw. */
async function attempt<T>(read: () => Promise<T>): Promise<Reading<T>> {
  try {
    return { ok: true, value: await read() };
  } catch (error) {
    return { ok: false, reason: messageOf(error) };
  }
}

/** The lines `rafa stretch item` prints for `readings`, CI first, then the bugs. */
export function renderPitReadings(readings: PitReadings): string[] {
  return [...ciLines(readings.ci), openBugsLine(readings.openBugs), ...filedSinceLines(readings.filedSince)];
}

function ciLines(ci: PitReadings['ci']): string[] {
  if (!ci.ok) return [`CI: not read: ${ci.reason}`];
  const [head = '', ...rest] = renderCiStatus(ci.value);
  return [`CI: ${head}`, ...rest];
}

function openBugsLine(open: PitReadings['openBugs']): string {
  return open.ok
    ? `Bugs: ${String(open.value)} open.`
    : `Bugs: not read: ${open.reason}`;
}

/** One filed bug's line, `   #<n> <title>: <first line>`, or `   #<n> <title>` for a body with no line. */
function filedBugLine(bug: FiledBug): string {
  return bug.firstLine === null
    ? `   #${bug.id} ${bug.title}`
    : `   #${bug.id} ${bug.title}: ${bug.firstLine}`;
}

function filedSinceLines(filed: PitReadings['filedSince']): string[] {
  if (!filed.ok) return [`Filed since the last item: not read: ${filed.reason}`];
  const { since, bugs } = filed.value;
  if (bugs.length === 0) return [`Filed since ${since}: none.`];
  return [`Filed since ${since}: ${String(bugs.length)}.`, ...bugs.map(filedBugLine)];
}
