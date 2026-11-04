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
 * (`.rafa/runs/<session-id>.events.ndjson`, `packages/rafa-run/src/loop/events-file.ts`):
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
 *   1. `gh pr view <pr> --json ...` reads the pull request (`viewPull`,
 *      `./item-pull.ts`). Its base must be a `stretch/*` branch: an item
 *      merges into an integration branch, never the default branch or
 *      any other base, so another base is refused with exit 1 and
 *      nothing merged. A pull request that is not open is refused the
 *      same way. Then the two waits of `./item-checks.ts`, each refused
 *      with exit 1 naming `rafa stretch item <issue> --resume`: the
 *      mergeability, read again while GitHub answers `UNKNOWN` (#1191),
 *      then the pull request's checks, since every pull request reports
 *      the `fragment` check and `pr merge` refuses one whose checks have
 *      not passed (#1255).
 *   2. `rafa pr merge <pr> --yes` on this terminal: the `pr merge` logic,
 *      which frees the loop worktree holding the head branch and cleans
 *      up after the merge. No `--skip-checks`: `pr merge` refuses it
 *      where the pull request reports any check. Its exit code is kept
 *      for step 3 rather than ending the item, since a clean-up that
 *      fails after the merge went through ends `pr merge` non-zero too
 *      (#1171). A line that could not start ends the item with exit 2.
 *   3. `gh pr view <pr> --json ...` again, up to {@link MERGED_READ_TRIES}
 *      times every {@link MERGED_POLL_MS}, until it reads `MERGED` with a
 *      merge commit: the new head of the integration branch. Measured on
 *      `gh` 2.102.0 against `open-tomato/rafa`: a merged pull request
 *      answers `"mergeCommit":{"oid":"<sha>"}` and `"state":"MERGED"`, an
 *      open one `"mergeCommit":null`. Read merged, steps 4 to 6 run
 *      whatever `pr merge`'s code, and a code that was not 0 prints one
 *      warning naming it: the clean-up is what failed, and `rafa cleanup`
 *      finishes it. Not merged after the reads, the item ends with
 *      `pr merge`'s code when it was not 0, else 2, and nothing after
 *      runs.
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
 *      Step 6 still reads every workflow on the head commit of the base,
 *      which after such a push is not the commit this step waited on.
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
 * {@link mergeDryRunLines} are the lines the two waits and steps 2 to 6
 * print in a dry run with `--wait`; the pull request's number is not
 * known before the loop opens it, so the lines name it `<pr>`, and the
 * merge commit is not known before the merge, so the `gh run list` line
 * names it `--commit <merge-commit>`.
 *
 * Steps 1 to 3 are {@link mergePull} and steps 4 to 6 {@link finishItem},
 * so an item resumed after its loop has ended runs the same two.
 *
 * Every process goes through {@link ItemMergeSeams}, so no test runs
 * `rafa`, reaches GitHub or sleeps.
 */
import type { WaitSeams } from './item-checks.js';
import type { ViewedPull } from './item-pull.js';
import type { BranchRun } from '../../ci/runs.js';
import type { RafaContext } from '@open-tomato/rafa/core/command';
import type { Tracker } from '@open-tomato/rafa/ports';
import type { GhRunner } from '@open-tomato/rafa-board';

import { readFileSync } from 'node:fs';

import { closedIssuesIn } from '@open-tomato/rafa-board';
import { eventsFileOf, readEventsFrom } from '@open-tomato/rafa-run';

import { CommandExit } from '@open-tomato/rafa/core/command';
import { describeValue, isMapping, messageOf } from '@open-tomato/rafa/core/config/sections';

import { readNewestRun, runListArgs } from '../../ci/runs.js';
import { appendItem, itemsPath, lastItemTime } from '../../stretch/items.js';
import { lineText } from '../../stretch/launch.js';
import { readPitReadings, renderPitReadings } from '../../stretch/pit-readings.js';

import {
  awaitChecks,
  awaitMergeability,
  CHECKS_POLL_MS,
  CHECKS_WAIT_MS,
  MERGEABILITY_POLL_MS,
  MERGEABILITY_WAIT_MS,
} from './item-checks.js';
import { viewPull } from './item-pull.js';
import { STRETCH_BRANCH_PREFIX, stretchRecordPath } from './start.js';

/** The command's spelling, as its refusals name it. */
const COMMAND_NAME = 'rafa stretch item';

/** How long apart two reads of the run on the merge commit are. */
export const CI_POLL_MS = 30_000;

/** How long the item waits for the run on the merge commit to end. */
export const CI_WAIT_MS: number = 90 * 60_000;

/** How many reads of the run on the merge commit may fail in a row before the wait gives up. */
export const CI_READ_TRIES = 3;

/** The flags the merge runs with: no question, the checks already waited on. */
export const MERGE_FLAGS: readonly string[] = Object.freeze(['--yes']);

/** How many times step 3 reads the pull request for its merge commit. */
export const MERGED_READ_TRIES = 5;

/** How long apart two reads of step 3 are. */
export const MERGED_POLL_MS = 5_000;

/** The events that end a loop's wait for its pull request, as `loop wait` reads them. */
const ENDING_EVENTS = ['pr', 'no-pr', 'halt', 'error'] as const;

/** The exit code of a refusal. */
const REFUSED_EXIT = 1;

/** The exit code of a reading or step that failed. */
const FAILED_EXIT = 2;

/** How many characters of a commit a line shows. */
const SHORT_SHA = 7;

/** What a dry run's line shows where the merge commit will be. */
const MERGE_COMMIT_PLACEHOLDER = '<merge-commit>';

/**
 * The sha a dry run builds its `gh run list` line with, shown as
 * {@link MERGE_COMMIT_PLACEHOLDER}: `runListArgs` refuses a commit that is
 * not a full sha, and the placeholder is not one.
 */
const STAND_IN_SHA = '0'.repeat(40);

/** The processes, `gh` and clock this half reaches through; see the module note. */
export interface ItemMergeSeams extends WaitSeams {
  /** Runs a rafa line on this terminal and answers its exit code, or null when it could not start. */
  readonly runRafa: (argv: readonly string[], cwd: string, env: Readonly<Record<string, string>>) => Promise<number | null>;
  /** The `gh` runner for the project root. */
  readonly gh: (root: string) => GhRunner;
  /** The tracker the open bugs and the bugs filed since the cut-off are read from. */
  readonly tracker: (gh: GhRunner) => Pick<Tracker, 'openIssues' | 'filedIssues'>;
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

/** What steps 1 to 3 need of the item: where it runs, its issue, and the environment a rafa child runs with. */
export type MergeInput = Pick<WaitedItem, 'root' | 'issue' | 'env'>;

/** What steps 4 to 6 need of the item, the cut-off new bugs are counted from among it. */
export interface FinishInput {
  readonly root: string;
  /** The stretch `pr.base` names. */
  readonly n: number;
  readonly issue: number;
  /** The plan's stub, as the ledger keeps it. */
  readonly stub: string;
  /** The cut-off new bugs are counted from. */
  readonly since: Date;
}

/** A pull request read merged, its merge commit known. */
export interface MergedPull extends ViewedPull {
  readonly mergeCommit: string;
}

/** How the loop ended, as its events file says. */
export type LoopEnding =
  | { readonly kind: 'pr'; readonly number: number }
  | { readonly kind: 'no-pr' | 'halt' | 'error'; readonly reason: string }
  | { readonly kind: 'none'; readonly reason: string };

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

/** Refuses a pull request that is not open or whose base is not a `stretch/*` branch. */
function refuseUnmergeable(pull: ViewedPull): void {
  if (!pull.base.startsWith(STRETCH_BRANCH_PREFIX) || pull.base === STRETCH_BRANCH_PREFIX) {
    throw refusal(`#${String(pull.number)} opens into ${pull.base}, not a ${STRETCH_BRANCH_PREFIX}* branch: an item`
      + ' merges into an integration branch, never the default branch. Nothing was merged.');
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
    `wait for GitHub to compute the mergeability of <pr>  (again every ${String(MERGEABILITY_POLL_MS / 1_000)}s while it reads`
      + ` UNKNOWN, up to ${String(MERGEABILITY_WAIT_MS / 60_000)} minutes)`,
    `wait for the checks of <pr> to pass  (again every ${String(CHECKS_POLL_MS / 1_000)}s, up to`
      + ` ${String(CHECKS_WAIT_MS / 60_000)} minutes)`,
    `${lineText([...rafa, 'pr', 'merge'])} <pr> ${lineText(MERGE_FLAGS)}`,
    `${runList}  (again every ${String(CI_POLL_MS / 1_000)}s until the run on the merge commit ends)`,
    `append the item to ${itemsPath(root, n)}`,
    `print the pit-stop readings of ${base}`,
  ];
}

/** The `startedAt` of the stretch's `stretch.json`, or null when there is none to read. */
export function stretchStartedAt(root: string, n: number): Date | null {
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

/** Step 2: `rafa pr merge <pr> --yes`, answering its exit code; a failure, exit 2, when the line could not start. */
async function mergeStep(context: RafaContext, item: MergeInput, number: number, seams: ItemMergeSeams): Promise<number> {
  const argv = mergeArgv(seams.rafa, number);
  context.output.info(lineText(argv));
  const exitCode = await seams.runRafa(argv, item.root, item.env);
  if (exitCode === null) throw failure(`${lineText(argv)} could not start; #${String(number)} is not merged.`);
  return exitCode;
}

/** Whether `pull` reads merged with a merge commit. */
function isMerged(pull: ViewedPull): pull is MergedPull {
  return pull.state === 'MERGED' && pull.mergeCommit !== null;
}

/** Step 3: reads the pull request until it reads merged, up to {@link MERGED_READ_TRIES} times; the last read. */
async function readMerged(gh: GhRunner, number: number, seams: ItemMergeSeams): Promise<ViewedPull> {
  let pull = await viewPull(gh, number);
  for (let read = 1; read < MERGED_READ_TRIES && !isMerged(pull); read += 1) {
    await seams.sleep(MERGED_POLL_MS);
    pull = await viewPull(gh, number);
  }
  return pull;
}

/**
 * Steps 1 to 3 for pull request `number`: the base guard, the two waits,
 * the merge and the read of its merge commit; see the module note.
 * Answers the pull request read merged, or ends the item.
 */
export async function mergePull(context: RafaContext, item: MergeInput, number: number, seams: ItemMergeSeams): Promise<MergedPull> {
  const gh = seams.gh(item.root);
  refuseUnmergeable(await viewPull(gh, number));
  const target = { issue: item.issue, number };
  await awaitMergeability(context, gh, target, seams);
  await awaitChecks(context, gh, target, seams);

  const exitCode = await mergeStep(context, item, number, seams);
  const line = lineText(mergeArgv(seams.rafa, number));
  const pull = await readMerged(gh, number, seams);
  const reads = `after ${String(MERGED_READ_TRIES)} reads`;
  if (!isMerged(pull)) {
    const how = `#${String(number)} reads ${pull.state} with no merge commit ${reads}`;
    if (exitCode !== 0) {
      throw new CommandExit(exitCode, `❌ ${COMMAND_NAME}: ${line} ended with exit code ${String(exitCode)}, and ${how};`
        + ' no CI wait, ledger line or pit-stop reading followed.');
    }
    throw failure(`${line} ended 0, and ${how}.`);
  }
  if (exitCode !== 0) {
    context.output.warn(`${line} ended with exit code ${String(exitCode)}, and #${String(number)} is merged: the clean-up`
      + ' after the merge is what failed; finish it with rafa cleanup.');
  }
  context.output.info(`merged #${String(number)} into ${pull.base} at ${short(pull.mergeCommit)}`);
  return pull;
}

/** Steps 4 to 6 for the merged pull request: the CI wait, the ledger line and the readings; see the module note. */
export async function finishItem(context: RafaContext, item: FinishInput, merged: MergedPull, seams: ItemMergeSeams): Promise<void> {
  const info = (text: string): void => context.output.info(text);
  const gh = seams.gh(item.root);
  await awaitRun(context, { gh, branch: merged.base, commit: merged.mergeCommit }, seams);

  const closes = [...new Set(closedIssuesIn(merged.body))].map((issue) => `Closes #${String(issue)}`);
  appendItem(item.root, item.n, {
    issue: String(item.issue),
    plan: item.stub,
    pullRequest: merged.number,
    mergeCommit: merged.mergeCommit,
    closes,
    at: seams.now().toISOString(),
  });
  info(`ledger: #${String(item.issue)} appended to ${itemsPath(item.root, item.n)}${closes.length === 0
    ? ', closing no issue'
    : `, ${closes.join(', ')}`}`);

  const readings = await readPitReadings({ gh, tracker: seams.tracker(gh) }, { branch: merged.base, since: item.since });
  for (const line of renderPitReadings(readings)) info(line);
}

/** Steps 1 to 6 for pull request `number`, new bugs counted from {@link bugCutOff}; see the module note. */
async function mergeItem(context: RafaContext, item: WaitedItem, number: number, seams: ItemMergeSeams): Promise<void> {
  const since = bugCutOff(item);
  const merged = await mergePull(context, item, number, seams);
  await finishItem(context, { root: item.root, n: item.n, issue: item.issue, stub: item.stub, since }, merged, seams);
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
