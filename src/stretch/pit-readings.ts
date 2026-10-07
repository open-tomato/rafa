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
 *   (`../commands/ci/status.ts`), whose cases `readFailedCases`
 *   (`../ci/failed-cases.ts`) groups by file. The reading is a
 *   {@link CiStatusReading}, rendered by `renderCiStatus`, so a pit stop
 *   and `rafa ci status --branch` print one run the same way.
 * - **Open bugs**: the length of the tracker port's
 *   `openIssues('bug')`. A tracker without that optional member reads as
 *   not read, never as zero.
 * - **Bugs filed since**: those of the same open bugs filed after
 *   `since`, the caller's cut-off (the last ledger line's time,
 *   `lastItemTime` in `./items.ts`, else the stretch's start). The port
 *   names no filing time on any issue (`src/ports/index.ts`: neither
 *   `OpenIssue` nor `Issue` carries one), so the time of each bug is
 *   read through a {@link FiledAtReader} the caller hands over. Without
 *   one the reading is not read, with the reason. A bug filed and closed
 *   between two items is not open, so it is not listed.
 *
 * ## Each reading stands alone
 *
 * A reading that fails, a `gh` that would not answer or a tracker that
 * threw, is held as `{ ok: false, reason }` and printed as such; the
 * other readings are still read and printed. A pit stop that sees one
 * reading is worth more than none, and a failure is never shown as a
 * green run or a zero count.
 */
import type { GhRunner } from '../adapters/tracker/github.js';
import type { CiStatusReading } from '../commands/ci/status.js';
import type { IssueRef, OpenIssue, Tracker } from '../ports/index.js';

import { readFailedCases } from '../ci/failed-cases.js';
import { readNewestRun } from '../ci/runs.js';
import { CI_STATUS_EXIT, readFailedLog, renderCiStatus, verdictOf } from '../commands/ci/status.js';
import { messageOf } from '../config-sections.js';

/** The time an issue was filed, or null when the tracker does not say. */
export type FiledAtReader = (ref: IssueRef) => Promise<Date | null>;

/** Where the readings come from. */
export interface PitSeams {
  /** The runner `gh run list` and `gh run view` are sent through. */
  readonly gh: GhRunner;
  /** The tracker port, read for its open bugs. */
  readonly tracker: Pick<Tracker, 'openIssues'>;
  /** Each bug's filing time; see the module note. Left out, the bugs filed since are not read. */
  readonly filedAt?: FiledAtReader;
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

/** One bug filed since the cut-off. */
export interface FiledBug {
  /** The tracker's own number for it, as the port's `externalId`. */
  readonly id: string;
  readonly title: string;
  readonly url: string | null;
  /** ISO 8601. */
  readonly filedAt: string;
}

/** Every pit-stop reading. */
export interface PitReadings {
  readonly ci: Reading<CiStatusReading>;
  readonly openBugs: Reading<number>;
  /** The cut-off, ISO 8601, and the bugs filed after it, oldest first. */
  readonly filedSince: Reading<{ readonly since: string; readonly bugs: readonly FiledBug[] }>;
}

/** Why the bugs filed since are not read when no {@link FiledAtReader} is given. */
export const NO_FILED_AT = 'the tracker port names no filing time, and no reader of one was given';

/** Why the open bugs are not read on a tracker without `openIssues`. */
export const NO_OPEN_ISSUES = 'the tracker lists no open issues (it has no openIssues)';

/** Reads every pit-stop reading for `query`; see the module note. Never throws on a failed reading. */
export async function readPitReadings(seams: PitSeams, query: PitQuery): Promise<PitReadings> {
  const ci = await attempt(() => readCi(seams.gh, query));
  const bugs = await attempt(() => readOpenBugs(seams.tracker));
  const openBugs: Reading<number> = bugs.ok
    ? { ok: true, value: bugs.value.length }
    : bugs;
  return { ci, openBugs, filedSince: await readFiledSince(bugs, seams.filedAt, query.since) };
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
async function readOpenBugs(tracker: Pick<Tracker, 'openIssues'>): Promise<readonly OpenIssue[]> {
  if (tracker.openIssues === undefined) throw new Error(NO_OPEN_ISSUES);
  return tracker.openIssues('bug');
}

/** The open bugs filed after `since`, oldest first. */
async function readFiledSince(
  bugs: Reading<readonly OpenIssue[]>,
  filedAt: FiledAtReader | undefined,
  since: Date,
): Promise<PitReadings['filedSince']> {
  if (!bugs.ok) return bugs;
  if (filedAt === undefined) return { ok: false, reason: NO_FILED_AT };
  if (Number.isNaN(since.getTime())) return { ok: false, reason: 'the cut-off is not a valid time' };
  return attempt(async () => {
    const dated = await Promise.all(bugs.value.map(async (bug) => ({ bug, at: await filedAt(bug.ref) })));
    const unknown = dated.filter((entry) => entry.at === null).map((entry) => `#${entry.bug.ref.externalId}`);
    if (unknown.length > 0) throw new Error(`no filing time for ${unknown.join(', ')}`);
    const filed = dated
      .filter((entry): entry is { bug: OpenIssue; at: Date } => entry.at !== null && entry.at.getTime() > since.getTime())
      .sort((a, b) => a.at.getTime() - b.at.getTime())
      .map(({ bug, at }): FiledBug => ({
        id: bug.ref.externalId,
        title: bug.title,
        url: bug.ref.url,
        filedAt: at.toISOString(),
      }));
    return { since: since.toISOString(), bugs: filed };
  });
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

function filedSinceLines(filed: PitReadings['filedSince']): string[] {
  if (!filed.ok) return [`Filed since the last item: not read: ${filed.reason}`];
  const { since, bugs } = filed.value;
  if (bugs.length === 0) return [`Filed since ${since}: none.`];
  return [
    `Filed since ${since}: ${String(bugs.length)}.`,
    ...bugs.map((bug) => `   #${bug.id} ${bug.title} (${bug.filedAt})`),
  ];
}
