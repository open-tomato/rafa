/**
 * What `rafa pr triage` gathers that is neither the line nor the pull
 * request itself: the failing job logs and the repository's workflow
 * count, read through the port, and the conflicting file list, read
 * through git.
 *
 * `src/pr/triage/` holds the pure half of the assessment — the classes,
 * the classifier, the log reader, the conflict parser, the comment, the
 * re-run readings and the selection — and every module there is total
 * and spawns nothing. This module is the impure half that feeds them:
 * it decides WHICH run's log to ask for and WHICH refs to merge, sends
 * those questions, and hands the answers on as data. Nothing here
 * classifies; `classifyTriage` does.
 *
 * ## The run id comes off the check link
 *
 * `gh pr checks --json name,state,link` answers a link per row and no
 * run id, so the id a `gh run view <id> --log-failed` needs is read out
 * of the link. A check-run's link is
 * `https://github.com/<owner>/<repo>/actions/runs/<run>/job/<job>`, and
 * {@link runIdOf} takes the `<run>` out of it. A STATUS CONTEXT — a row
 * GitHub did not run itself, which is how an external CI reports — has
 * whatever URL that service chose, matches nothing, and is answered
 * `null` rather than guessed at: a wrong run id would quote another
 * job's log as this pull request's evidence.
 *
 * Several failing rows usually share one run, so the ids are
 * deduplicated in the order the rows came, and one `--log-failed` is
 * sent per run rather than per row.
 *
 * ## Which reading becomes the evidence
 *
 * The spec quotes the tail of the failing job's log, and the class is
 * read from the failing STEP name, so of the runs read, the one that
 * NAMED a step is the one that decides the class
 * ({@link FailedLogsReading.chosen}). Where none named one, the first
 * reading with any lines in it stands, so the report still quotes
 * something; where nothing was readable at all, `chosen` is null and
 * the classifier is handed no step, which is `ci-other` by its own
 * rule.
 *
 * A `failedLog` call that REJECTED is a problem on the reading and
 * never a throw. A log GitHub has dropped comes back from the port as
 * the empty string, which `readFailedLog` reads as no jobs, no step and
 * no lines — an ordinary reading, not a failure.
 *
 * ## The workflow count is read only when no check reported
 *
 * `classifyTriage` reads the count on verdict `none` alone, where it
 * goes into the `no-checks` reason, so {@link readWorkflowCount} asks
 * `PullRequests.workflowCount` only then and answers null — NOT ASKED —
 * for every other verdict, which spends no `gh api` call on a pull
 * request whose checks did report. Asked, the reading's `count` is the
 * port's answer, where null is a count that could not be read: the
 * riskier reading `src/pr/unchecked.ts` files beside "workflows exist",
 * never "no workflow". The port answers null on any failure rather than
 * throwing; a rejection is caught all the same and read as that null,
 * because a triage that crashed on it would leave the pull request
 * unassessed where an unread count only makes the warning the stricter
 * one.
 *
 * ## The conflict is read only when GitHub says it might be one
 *
 * `readsAsConflicting` (`src/pr/triage/classify.ts`) answers `false`
 * outright for `mergeable: 'mergeable'`, so a pull request GitHub has
 * already merged in its head is never merged again here: the git read
 * is skipped and the file list is empty. It runs for `conflicting` and
 * for `unknown`, the latter being GitHub's answer while it computes,
 * where the local reading is the one that breaks the tie.
 *
 * ## Nothing is fetched
 *
 * `git merge-tree` needs both commit-ish in the local object database,
 * and `gh pr view` fetches nothing, so a head nobody has fetched is not
 * there to merge. This module does NOT fetch it: a triage is a read,
 * and a fetch writes to the operator's object database and talks to the
 * network on a command whose whole job is to report. So the refs are
 * RESOLVED first, with `git rev-parse --verify`, and a pair that does
 * not resolve answers {@link CONFLICT_UNREAD} with an empty file list —
 * which `classifyTriage` reads as `conflict-other` and reports as "no
 * conflicting file was read", the wording `comment.ts` and
 * `follow-up.ts` already carry for exactly this case.
 *
 * The candidates are tried nearest-the-remote first, since that is what
 * GitHub merged: `origin/<base>` before `<base>`, and the head commit
 * itself before `origin/<head branch>`. The head OID goes first because
 * it is the commit the triage is pinned to; the branch ref is the
 * fallback for a repository whose remote-tracking ref is fetched while
 * the commit is not reachable by sha alone. A cross-repository pull
 * request has no `origin/<head branch>` at all, so only its OID is
 * tried.
 *
 * `rev-parse --verify --quiet <ref>` exits nonzero and says nothing for
 * a ref that does not resolve, which is why the probe is a separate
 * command: `merge-tree` answers exit 1 for an unresolvable ref AND for
 * a real conflict, the ambiguity `conflict.ts`'s note records, and
 * resolving first means the reading handed to the classifier is never
 * the ambiguous one.
 */
import type { CheckRow, GitRunner, PullRequests } from '../../pr/index.js';
import type { ConflictReading } from '../../pr/triage/conflict.js';
import type { FailedLogEvidence } from '../../pr/triage/evidence.js';

import { messageOf } from '../../config-sections.js';
import { failingRows, verdictOf } from '../../pr/index.js';
import { readConflict } from '../../pr/triage/conflict.js';
import { readFailedLog } from '../../pr/triage/evidence.js';

/**
 * The run id inside an Actions check link. Anchored on the `/actions/
 * runs/` path segment, so a URL that merely holds digits — an external
 * CI's build page — matches nothing; see the module note.
 */
const RUN_URL = /\/actions\/runs\/(\d+)(?:[/?#]|$)/;

/** What the conflict reading says when no pair of refs resolved locally. */
export const CONFLICT_UNREAD = 'unread';

/** The remote whose tracking refs the base and the head are looked for under. */
const REMOTE = 'origin';

/** The port members this module sends; a caller hands over the provider it already has. */
export type TriageLogReader = Pick<PullRequests, 'failedLog'>;

/** The port member {@link readWorkflowCount} sends. */
export type TriageWorkflowReader = Pick<PullRequests, 'workflowCount'>;

/** The workflow count, as it read when it was asked for; see the module note. */
export interface WorkflowCountReading {
  /** The repository's workflow count, or null when it could not be read. */
  readonly count: number | null;
}

/** One failing run's log, as it read. */
export interface FailedJobReading {
  /** The run the log was asked for, as {@link runIdOf} read it off the link. */
  readonly runId: string;
  /** The check rows pointing at that run, by name, in the order they came. */
  readonly checks: readonly string[];
  /** What `readFailedLog` made of the capture. */
  readonly evidence: FailedLogEvidence;
}

/** Every failing job read for one pull request. */
export interface FailedLogsReading {
  /** One entry per distinct run, in the order the failing rows named them. */
  readonly readings: readonly FailedJobReading[];
  /**
   * The reading the class is decided from: the first that named a
   * step, else the first with any lines, else null. See the module
   * note.
   */
  readonly chosen: FailedJobReading | null;
  /** The failing checks whose link named no run, by name; see the module note. */
  readonly unlinked: readonly string[];
  /** What a `failedLog` call said when it rejected, one line each. */
  readonly problems: readonly string[];
}

/** The conflicting file list, and which refs answered it. */
export interface ConflictFilesReading {
  /**
   * `clean`, `conflict`, `error` as `readConflict` answered, or
   * {@link CONFLICT_UNREAD} when no pair of refs resolved locally and
   * git was never asked to merge.
   */
  readonly kind: ConflictReading['kind'] | typeof CONFLICT_UNREAD;
  /** The conflicting paths, in git's order. Empty for every kind but `conflict`. */
  readonly files: readonly string[];
  /** The base ref that resolved, or null when none did. */
  readonly base: string | null;
  /** The head ref that resolved, or null when none did. */
  readonly head: string | null;
  /** Every ref tried, in order, so a report can name what was looked for. */
  readonly tried: readonly string[];
  /** What git said, empty when it said nothing or was never asked. */
  readonly said: string;
}

/** What a pull request's conflict is read from. */
export interface ConflictRefs {
  /** The base branch name, as the pull request carries it. */
  readonly baseRefName: string;
  /** The head branch name, as the pull request carries it. */
  readonly headRefName: string;
  /** The head commit, which the triage is pinned to. */
  readonly headRefOid: string;
  /** True when the head is on a fork, which has no local tracking ref. */
  readonly isCrossRepository: boolean;
}

/**
 * The Actions run id a check link names, or null when it names none.
 * See the module note for which links name one.
 */
export function runIdOf(link: string): string | null {
  return RUN_URL.exec(link)?.[1] ?? null;
}

/** The distinct run ids the failing rows name, in order, with the checks naming each. */
export function failingRuns(rows: readonly CheckRow[]): ReadonlyMap<string, readonly string[]> {
  const runs = new Map<string, readonly string[]>();
  for (const row of failingRows(rows)) {
    const id = runIdOf(row.link);
    if (id === null) continue;
    runs.set(id, [...(runs.get(id) ?? []), row.name]);
  }
  return runs;
}

/** The failing checks whose link named no run, by name, in order. */
export function unlinkedChecks(rows: readonly CheckRow[]): readonly string[] {
  return failingRows(rows)
    .filter((row) => runIdOf(row.link) === null)
    .map((row) => row.name);
}

/** The reading the class is decided from; see the module note. */
function chooseReading(readings: readonly FailedJobReading[]): FailedJobReading | null {
  return readings.find((one) => one.evidence.step !== undefined)
    ?? readings.find((one) => one.evidence.lines.length > 0)
    ?? null;
}

/**
 * Reads the `--log-failed` capture of every run the failing rows name.
 *
 * Never throws: a call that rejected is a line on
 * {@link FailedLogsReading.problems}, because a pull request whose
 * class was read fine off its conflict must still be reported when its
 * log could not be fetched.
 */
export async function readFailedLogs(
  pulls: TriageLogReader,
  rows: readonly CheckRow[],
): Promise<FailedLogsReading> {
  const readings: FailedJobReading[] = [];
  const problems: string[] = [];
  for (const [runId, checks] of failingRuns(rows)) {
    try {
      const text = await pulls.failedLog(runId);
      readings.push({ runId, checks, evidence: readFailedLog(text) });
    } catch (error) {
      problems.push(`the failing log of run ${runId} could not be read: ${messageOf(error)}`);
    }
  }
  return {
    readings,
    chosen: chooseReading(readings),
    unlinked: unlinkedChecks(rows),
    problems,
  };
}

/**
 * The repository's workflow count, read only when the check rows read
 * verdict `none`; null when it was not asked for. Never throws; see the
 * module note.
 */
export async function readWorkflowCount(
  pulls: TriageWorkflowReader,
  rows: readonly CheckRow[],
): Promise<WorkflowCountReading | null> {
  if (verdictOf(rows) !== 'none') return null;
  try {
    return { count: await pulls.workflowCount() };
  } catch {
    return { count: null };
  }
}

/** The base refs tried, nearest the remote first; see the module note. */
export function baseCandidates(refs: ConflictRefs): readonly string[] {
  return [`${REMOTE}/${refs.baseRefName}`, refs.baseRefName];
}

/** The head refs tried, the pinned commit first; see the module note. */
export function headCandidates(refs: ConflictRefs): readonly string[] {
  return refs.isCrossRepository
    ? [refs.headRefOid]
    : [refs.headRefOid, `${REMOTE}/${refs.headRefName}`];
}

/** Whether git resolves `ref` in the repository the runner was made for. */
export function resolvesRef(git: GitRunner, ref: string): boolean {
  return git(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]).ok;
}

/** The first candidate git resolves, or null when none does. */
function firstResolved(git: GitRunner, candidates: readonly string[]): string | null {
  return candidates.find((ref) => resolvesRef(git, ref)) ?? null;
}

/**
 * The conflicting file list of one pull request, or the reading that
 * says why there is none.
 *
 * The refs are resolved before anything is merged, so an exit 1 from
 * `merge-tree` is never read as a conflict it was not; see the module
 * note and `src/pr/triage/conflict.ts`.
 */
export function readConflictFiles(git: GitRunner, refs: ConflictRefs): ConflictFilesReading {
  const bases = baseCandidates(refs);
  const heads = headCandidates(refs);
  const tried = [...bases, ...heads];
  const base = firstResolved(git, bases);
  const head = firstResolved(git, heads);
  if (base === null || head === null) {
    return { kind: CONFLICT_UNREAD, files: [], base, head, tried, said: '' };
  }
  const reading = readConflict(git, base, head);
  return { kind: reading.kind, files: reading.files, base, head, tried, said: reading.said };
}
