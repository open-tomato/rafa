/**
 * The after-pull-request half of `rafa stretch item` (#816): what runs
 * once `rafa loop wait` has ended on the item's loop. `./item.ts` owns
 * the half before it, from planning to the running loop, and calls
 * {@link afterLoopWait} with `loop wait`'s exit code.
 *
 * Like the first half it decides nothing: it merges, waits for CI, writes
 * the ledger line and prints the pit-stop readings. The pit-stop skill
 * decides what to do with them.
 *
 * ## The loop's ending
 *
 * The pull request is read from the run's events file
 * (`.rafa/runs/<session-id>.events.ndjson`, `src/loop/events-file.ts`):
 * the first `pr`, `no-pr`, `halt` or `error` event in file order, the
 * order `loop wait` reads them in ({@link readLoopEnding}). A `pr` event
 * carries the pull request's number. When `loop wait` ended non-zero, or
 * the file holds no `pr` event, the loop ended without a pull request:
 * the item prints that event's reason ({@link noPullRequestLine}), names
 * the log, merges nothing and exits with `loop wait`'s code, or 2 when
 * `loop wait` ended 0 and the file holds no `pr` event.
 *
 * ## The steps, in order
 *
 *   1. `gh pr view <pr> --json ...` reads the pull request. Its base must
 *      be a `stretch/*` branch: checks are skipped only on an integration
 *      branch, never on the default branch or any other base, so another
 *      base is refused with exit 1 and nothing merged. A pull request
 *      that is not open is refused the same way.
 *   2. `rafa pr merge <pr> --skip-checks --yes` on this terminal: the
 *      `pr merge` logic, which frees the loop worktree holding the head
 *      branch and cleans up after the merge. `verify` runs on a push to
 *      `stretch/**` and on pull requests into `main` or `integration` only
 *      (`.github/workflows/verify.yml`), so the pull request reports no
 *      checks and `--yes` beside `--skip-checks` is let through. Its exit
 *      code, when not 0, is the item's.
 *   3. `gh pr view <pr> --json ...` again, for the merge commit: the new
 *      head of the integration branch. Measured on `gh` 2.102.0 against
 *      `open-tomato/rafa`: a merged pull request answers
 *      `"mergeCommit":{"oid":"<sha>"}` and `"state":"MERGED"`, an open one
 *      `"mergeCommit":null`.
 *   4. The run on the merge commit, read through `readNewestRun`
 *      (`src/ci/runs.ts`) by the base and that commit every
 *      {@link CI_POLL_MS}, until it is completed, red or green. A push
 *      to the base after the merge starts a run of its own, listed first
 *      on the branch; asked for by commit, it is never the row read
 *      (#1029). The wait gives up after {@link CI_WAIT_MS}, after
 *      {@link CI_READ_TRIES} failed reads in a row, or on an interrupt,
 *      each with a warning, and the item goes on: the merge is done, so
 *      its ledger line is written either way. The {@link CI_WAIT_MS}
 *      warning says which of two things the last read that answered
 *      found: no run on the commit, or a run on it that had not ended.
 *      Step 6 still reads the newest run of the base, which after such
 *      a push is not the run this step waited on.
 *   5. One line appended to the item ledger, `.rafa/stretch/<n>/items.ndjson`
 *      (`src/stretch/items.ts`): the issue, the plan stub, the pull
 *      request, the merge commit, a `Closes #<n>` line per issue the body
 *      closes by GitHub's keywords (`closedIssuesIn`), and the time. A
 *      merge into a branch other than the default closes no issue, so
 *      `rafa stretch end` carries these lines into the pull request that
 *      does.
 *   6. The pit-stop readings (`src/stretch/pit-readings.ts`) for the base,
 *      bugs counted as new from the last ledger line written BEFORE this
 *      one, else the `startedAt` of `.rafa/stretch/<n>/stretch.json`, else
 *      the loop's own start.
 *
 * ## `--dry-run`
 *
 * {@link mergeDryRunLines} are the lines steps 2 to 6 print in a dry run
 * with `--wait`; the pull request's number is not known before the loop
 * opens it, so the lines name it `<pr>`, and the merge commit is not
 * known before the merge, so the `gh run list` line names it
 * `--commit <merge-commit>`.
 *
 * Every process goes through {@link ItemMergeSeams}, so no test runs
 * `rafa`, reaches GitHub or sleeps.
 */
import type { GhRunner } from '../../adapters/tracker/github.js';
import type { BranchRun } from '../../ci/runs.js';
import type { RafaContext } from '@open-tomato/rafa/core/command';
import type { Tracker } from '@open-tomato/rafa/ports';

import { readFileSync } from 'node:fs';

import { CommandExit } from '@open-tomato/rafa/core/command';
import { describeValue, isMapping, messageOf } from '@open-tomato/rafa/core/config/sections';

import { closedIssuesIn } from '../../board/roadmap.js';
import { readNewestRun, runListArgs } from '../../ci/runs.js';
import { eventsFileOf, readEventsFrom } from '../../loop/events-file.js';
import { appendItem, itemsPath, lastItemTime } from '../../stretch/items.js';
import { lineText } from '../../stretch/launch.js';
import { readPitReadings, renderPitReadings } from '../../stretch/pit-readings.js';

import { STRETCH_BRANCH_PREFIX, stretchRecordPath } from './start.js';

/** The command's spelling, as its refusals name it. */
const COMMAND_NAME = 'rafa stretch item';

/** How long apart two reads of the run on the merge commit are. */
export const CI_POLL_MS = 30_000;

/** How long the item waits for the run on the merge commit to end. */
export const CI_WAIT_MS: number = 90 * 60_000;

/** How many reads of the run on the merge commit may fail in a row before the wait gives up. */
export const CI_READ_TRIES = 3;

/** The flags the merge runs with: no checks to wait on, and no question. */
export const MERGE_FLAGS: readonly string[] = Object.freeze(['--skip-checks', '--yes']);

/** The `--json` fields the pull request is read with. */
export const PR_VIEW_FIELDS = ['number', 'state', 'baseRefName', 'headRefName', 'body', 'mergeCommit'] as const;

/** The events that end a loop's wait for its pull request, as `loop wait` reads them. */
const ENDING_EVENTS = ['pr', 'no-pr', 'halt', 'error'] as const;

/** The exit code of a refusal. */
const REFUSED_EXIT = 1;

/** The exit code of a reading or step that failed. */
const FAILED_EXIT = 2;

/** How many characters of a commit a line shows. */
const SHORT_SHA = 7;

/** A full commit sha. */
const SHA = /^[0-9a-f]{40}$/;

/** What a dry run's line shows where the merge commit will be. */
const MERGE_COMMIT_PLACEHOLDER = '<merge-commit>';

/**
 * The sha a dry run builds its `gh run list` line with, shown as
 * {@link MERGE_COMMIT_PLACEHOLDER}: `runListArgs` refuses a commit that is
 * not a full sha, and the placeholder is not one.
 */
const STAND_IN_SHA = '0'.repeat(40);

/** The processes, `gh` and clock this half reaches through; see the module note. */
export interface ItemMergeSeams {
  /** Runs a rafa line on this terminal and answers its exit code, or null when it could not start. */
  readonly runRafa: (argv: readonly string[], cwd: string, env: Readonly<Record<string, string>>) => Promise<number | null>;
  /** The `gh` runner for the project root. */
  readonly gh: (root: string) => GhRunner;
  /** The tracker the open bugs are read from, each with the time it was filed. */
  readonly tracker: (gh: GhRunner) => Pick<Tracker, 'openIssues'>;
  /** Waits `ms` milliseconds. */
  readonly sleep: (ms: number) => Promise<void>;
  readonly now: () => Date;
  /** The program words that run rafa. */
  readonly rafa: readonly string[];
}

/** The item whose loop `loop wait` waited on. */
export interface WaitedItem {
  readonly root: string;
  /** The stretch `pr.base` names. */
  readonly n: number;
  readonly issue: number;
  /** The plan's stub, as the ledger keeps it. */
  readonly stub: string;
  readonly sessionId: string;
  /** When the loop's session started, ISO 8601: the last cut-off for new bugs. */
  readonly startedAt: string;
  /** The item's log, named when the loop ended without a pull request. */
  readonly log: string;
  /** The environment a rafa child runs with. */
  readonly env: Readonly<Record<string, string>>;
}

/** How the loop ended, as its events file says. */
export type LoopEnding =
  | { readonly kind: 'pr'; readonly number: number }
  | { readonly kind: 'no-pr' | 'halt' | 'error'; readonly reason: string }
  | { readonly kind: 'none'; readonly reason: string };

/** The pull request, as `gh pr view` answers it. */
export interface ViewedPull {
  readonly number: number;
  /** `OPEN`, `MERGED` or `CLOSED`, as `gh` writes it. */
  readonly state: string;
  readonly base: string;
  readonly head: string;
  readonly body: string;
  /** The merge commit's sha, or null before it merged. */
  readonly mergeCommit: string | null;
}

/** A refusal with exit code 1 naming `why`. */
function refusal(why: string): CommandExit {
  return new CommandExit(REFUSED_EXIT, `❌ ${COMMAND_NAME}: ${why}`);
}

/** A failure with exit code 2 naming `why`. */
function failure(why: string): CommandExit {
  return new CommandExit(FAILED_EXIT, `❌ ${COMMAND_NAME}: ${why}`);
}

/** The first commit characters of `sha`. */
function short(sha: string): string {
  return sha.slice(0, SHORT_SHA);
}

/** The text an ending event's data holds under `field`, else its summary. */
function reasonOf(data: Readonly<Record<string, unknown>>, field: string, summary: string): string {
  const value = data[field];
  return typeof value === 'string' && value.trim() !== ''
    ? value.trim()
    : summary;
}

/** How the loop of `sessionId` ended, read from its events file; see the module note. */
export function readLoopEnding(root: string, sessionId: string): LoopEnding {
  const file = eventsFileOf(root, { sessionId });
  let read;
  try {
    read = readEventsFrom(file, 0);
  } catch (error) {
    return { kind: 'none', reason: `its events file ${file} could not be read: ${messageOf(error)}` };
  }
  if (read.kind === 'absent') return { kind: 'none', reason: `it wrote no events file (${file})` };
  const event = read.events.find((line) => (ENDING_EVENTS as readonly string[]).includes(line.name));
  if (event === undefined) return { kind: 'none', reason: `it wrote no pr, no-pr, halt or error event to ${file}` };
  if (event.name === 'pr') {
    const number = event.data['number'];
    return typeof number === 'number' && Number.isSafeInteger(number) && number > 0
      ? { kind: 'pr', number }
      : { kind: 'none', reason: `its pr event names no pull request number: ${describeValue(number)}` };
  }
  if (event.name === 'error') return { kind: 'error', reason: reasonOf(event.data, 'message', event.summary) };
  return { kind: event.name === 'halt'
    ? 'halt'
    : 'no-pr', reason: reasonOf(event.data, 'reason', event.summary) };
}

/** The line a loop that ended without a pull request is reported by. */
export function noPullRequestLine(issue: number, ending: Exclude<LoopEnding, { kind: 'pr' }>): string {
  const how = ending.kind === 'none'
    ? 'ended without a pull request'
    : `ended on ${ending.kind}`;
  return `the loop of #${String(issue)} ${how}: ${ending.reason}`;
}

/** The arguments after `gh` that read pull request `number`. */
export function prViewArgs(number: number): string[] {
  return ['pr', 'view', String(number), '--json', PR_VIEW_FIELDS.join(',')];
}

/** The text `field` of `row` holds, or a failure naming it. */
function textField(row: Readonly<Record<string, unknown>>, field: string, command: string): string {
  const value = row[field];
  if (typeof value !== 'string') throw failure(`${command} answered ${field} ${describeValue(value)}, expected a string`);
  return value;
}

/** The merge commit `gh` wrote, null for none, or a failure. */
function mergeCommitOf(value: unknown, command: string): string | null {
  if (value === null || value === undefined) return null;
  const oid = isMapping(value)
    ? value['oid']
    : undefined;
  if (typeof oid !== 'string' || !SHA.test(oid)) {
    throw failure(`${command} answered mergeCommit ${describeValue(value)}, expected null or an object holding a 40-character oid`);
  }
  return oid;
}

/** Pull request `number`, read through `gh pr view`; a failure when `gh` fails or answers something else. */
export async function viewPull(gh: GhRunner, number: number): Promise<ViewedPull> {
  const args = prViewArgs(number);
  const command = `gh ${args.join(' ')}`;
  const result = await gh(args);
  if (!result.ok) {
    const said = result.stderr.trim() || result.stdout.trim() || 'it exited non-zero and wrote nothing';
    throw failure(`${command} failed: ${said}`);
  }
  let row: unknown;
  try {
    row = JSON.parse(result.stdout) as unknown;
  } catch (error) {
    throw failure(`${command} wrote output that is not JSON: ${messageOf(error)}`);
  }
  if (!isMapping(row)) throw failure(`${command} answered ${describeValue(row)}, expected an object`);
  if (row['number'] !== number) throw failure(`${command} answered number ${describeValue(row['number'])}`);
  return {
    number,
    state: textField(row, 'state', command),
    base: textField(row, 'baseRefName', command),
    head: textField(row, 'headRefName', command),
    body: textField(row, 'body', command),
    mergeCommit: mergeCommitOf(row['mergeCommit'], command),
  };
}

/** Refuses a pull request that is not open or whose base is not a `stretch/*` branch. */
function refuseUnmergeable(pull: ViewedPull): void {
  if (!pull.base.startsWith(STRETCH_BRANCH_PREFIX) || pull.base === STRETCH_BRANCH_PREFIX) {
    throw refusal(`#${String(pull.number)} opens into ${pull.base}, not a ${STRETCH_BRANCH_PREFIX}* branch: an item is`
      + ' merged with its checks skipped only into an integration branch. Nothing was merged.');
  }
  if (pull.state !== 'OPEN') {
    throw refusal(`#${String(pull.number)} is ${pull.state}, not open. Nothing was merged.`);
  }
}

/** The `merge` line's words. */
function mergeArgv(rafa: readonly string[], number: number): string[] {
  return [...rafa, 'pr', 'merge', String(number), ...MERGE_FLAGS];
}

/** The lines a dry run with `--wait` prints for steps 2 to 6; see the module note. */
export function mergeDryRunLines(rafa: readonly string[], root: string, n: number): string[] {
  const base = `${STRETCH_BRANCH_PREFIX}${String(n)}`;
  const runList = lineText(['gh', ...runListArgs({ branch: base, commit: STAND_IN_SHA })]).replace(STAND_IN_SHA, MERGE_COMMIT_PLACEHOLDER);
  return [
    `${lineText([...rafa, 'pr', 'merge'])} <pr> ${lineText(MERGE_FLAGS)}`,
    `${runList}  (again every ${String(CI_POLL_MS / 1_000)}s until the run on the merge commit ends)`,
    `append the item to ${itemsPath(root, n)}`,
    `print the pit-stop readings of ${base}`,
  ];
}

/** The `startedAt` of the stretch's `stretch.json`, or null when there is none to read. */
function stretchStartedAt(root: string, n: number): Date | null {
  let record: unknown;
  try {
    record = JSON.parse(readFileSync(stretchRecordPath(root, n), 'utf8')) as unknown;
  } catch {
    return null;
  }
  const at = isMapping(record)
    ? record['startedAt']
    : undefined;
  const time = typeof at === 'string'
    ? Date.parse(at)
    : Number.NaN;
  return Number.isNaN(time)
    ? null
    : new Date(time);
}

/** The cut-off new bugs are counted from; see the module note's step 6. */
function bugCutOff(item: WaitedItem): Date {
  return lastItemTime(item.root, item.n) ?? stretchStartedAt(item.root, item.n) ?? new Date(item.startedAt);
}

/** What the run wait needs. */
interface RunWait {
  readonly gh: GhRunner;
  readonly branch: string;
  readonly commit: string;
}

/** What the wait's bound says of the last read that answered: no run at `at`, or `found`, which had not ended. */
function unendedText(found: BranchRun | null, at: string): string {
  return found === null
    ? `no run on ${at} was found`
    : `run ${String(found.id)} (${found.workflow}) on ${at} had not ended`;
}

/** Step 4: waits until the run on the merge commit, read by branch and commit, is completed; see the module note. */
async function awaitRun(context: RafaContext, wait: RunWait, seams: ItemMergeSeams): Promise<void> {
  const at = `${wait.branch} at ${short(wait.commit)}`;
  const since = seams.now().getTime();
  let failedReads = 0;
  let found: BranchRun | null = null;
  context.output.info(`waiting for the run on ${at} to end`);
  for (;;) {
    try {
      const run = await readNewestRun(wait.gh, { branch: wait.branch, commit: wait.commit });
      failedReads = 0;
      found = run;
      if (run !== null && run.state === 'completed') {
        context.output.info(`run ${String(run.id)} (${run.workflow}) on ${at} ended: ${run.conclusion ?? 'no conclusion'}`);
        return;
      }
    } catch (error) {
      failedReads += 1;
      if (failedReads >= CI_READ_TRIES) {
        context.output.warn(`stopped waiting for the run on ${at}: ${String(failedReads)} reads failed in a row, the last: ${messageOf(error)}`);
        return;
      }
    }
    if (seams.now().getTime() - since >= CI_WAIT_MS) {
      context.output.warn(`${unendedText(found, at)} within ${String(CI_WAIT_MS / 60_000)} minutes`);
      return;
    }
    if (context.signal.aborted) {
      context.output.warn(`stopped waiting for the run on ${at}: interrupted`);
      return;
    }
    await seams.sleep(CI_POLL_MS);
  }
}

/** Step 2: `rafa pr merge <pr> --skip-checks --yes`, its exit code the item's when not 0. */
async function mergeStep(context: RafaContext, item: WaitedItem, number: number, seams: ItemMergeSeams): Promise<void> {
  const argv = mergeArgv(seams.rafa, number);
  context.output.info(lineText(argv));
  const exitCode = await seams.runRafa(argv, item.root, item.env);
  if (exitCode === null) throw failure(`${lineText(argv)} could not start; #${String(number)} is not merged.`);
  if (exitCode !== 0) {
    throw new CommandExit(exitCode, `❌ ${COMMAND_NAME}: ${lineText(argv)} ended with exit code ${String(exitCode)};`
      + ' no CI wait, ledger line or pit-stop reading followed.');
  }
}

/** Steps 1 to 6 for pull request `number`; see the module note. */
async function mergeItem(context: RafaContext, item: WaitedItem, number: number, seams: ItemMergeSeams): Promise<void> {
  const info = (text: string): void => context.output.info(text);
  const gh = seams.gh(item.root);
  const pull = await viewPull(gh, number);
  refuseUnmergeable(pull);
  const since = bugCutOff(item);

  await mergeStep(context, item, number, seams);
  const merged = await viewPull(gh, number);
  if (merged.state !== 'MERGED' || merged.mergeCommit === null) {
    throw failure(`rafa pr merge ended 0, and #${String(number)} reads ${merged.state} with no merge commit.`);
  }
  info(`merged #${String(number)} into ${merged.base} at ${short(merged.mergeCommit)}`);
  await awaitRun(context, { gh, branch: merged.base, commit: merged.mergeCommit }, seams);

  const closes = [...new Set(closedIssuesIn(merged.body))].map((issue) => `Closes #${String(issue)}`);
  appendItem(item.root, item.n, {
    issue: String(item.issue),
    plan: item.stub,
    pullRequest: number,
    mergeCommit: merged.mergeCommit,
    closes,
    at: seams.now().toISOString(),
  });
  info(`ledger: #${String(item.issue)} appended to ${itemsPath(item.root, item.n)}${closes.length === 0
    ? ', closing no issue'
    : `, ${closes.join(', ')}`}`);

  const readings = await readPitReadings({ gh, tracker: seams.tracker(gh) }, { branch: merged.base, since });
  for (const line of renderPitReadings(readings)) info(line);
}

/**
 * What follows `rafa loop wait` on the item's loop, which ended with
 * `waitExit`: the merge, the CI wait, the ledger line and the readings
 * when the loop opened a pull request, else its reason and the exit code;
 * see the module note.
 */
export async function afterLoopWait(context: RafaContext, item: WaitedItem, waitExit: number, seams: ItemMergeSeams): Promise<void> {
  const ending = readLoopEnding(item.root, item.sessionId);
  if (waitExit === 0 && ending.kind === 'pr') {
    await mergeItem(context, item, ending.number, seams);
    return;
  }
  if (ending.kind !== 'pr') context.output.info(noPullRequestLine(item.issue, ending));
  context.output.info(`log: ${item.log}`);
  const code = waitExit === 0
    ? FAILED_EXIT
    : waitExit;
  throw new CommandExit(code, `❌ ${COMMAND_NAME}: rafa loop wait --session-id=${item.sessionId} ended with exit code`
    + ` ${String(waitExit)} and no pull request to merge; nothing was merged.`);
}
