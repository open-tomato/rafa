/**
 * The two waits of `rafa stretch item` before its merge (`./item-merge.ts`):
 * GitHub's mergeability, then the pull request's checks. `rafa pr merge
 * <pr> --yes` refuses a pull request whose mergeability reads `UNKNOWN`
 * (#1191) and one whose checks have not passed (#1255), so the item waits
 * for both before it runs the merge rather than handing `pr merge` a pull
 * request it will refuse.
 *
 * Each wait reaches GitHub through the `gh` it is handed and the clock
 * through the `sleep` and `now` of {@link WaitSeams}, the two the merge
 * half's seams carry, so no case reaches GitHub or sleeps.
 *
 * Every refusal is exit 1, made before any merge, and names
 * `rafa stretch item <issue> --resume`, the line that finishes the item
 * once what stopped it is cleared.
 *
 * ## The mergeability
 *
 * {@link awaitMergeability} reads the pull request through `viewPull`
 * (`./item-pull.ts`) and prints one line per read. GitHub computes the
 * mergeability after the pull request is opened and answers `UNKNOWN`
 * until it has, so a pull request read `UNKNOWN` is read again every
 * {@link MERGEABILITY_POLL_MS}, for up to {@link MERGEABILITY_WAIT_MS}
 * from the first read; still `UNKNOWN` then, the item is refused naming
 * the bound. `CONFLICTING` is refused at once, naming the word and
 * `rafa pr show <pr>`. `MERGEABLE`, or any other word, is answered with
 * the pull request read, since `pr merge` decides what it refuses.
 *
 * ## The checks
 *
 * {@link awaitChecks} is `waitForChecks` of `@open-tomato/rafa-pr`
 * polling `checks` of the `gh` pull request provider every
 * {@link CHECKS_POLL_MS}, for up to {@link CHECKS_WAIT_MS}: the interval
 * and the bound `rafa pr wait` runs with by default. The wait's own start
 * is handed over as the head's commit time, so zero rows is polled again
 * through `FIRST_CHECK_GRACE_MS` while the pull request's first check may
 * not have registered yet. Each poll prints one line, its verdict and
 * the rows as `formatRows` writes them. `green` answers. `timeout` is
 * refused naming the bound, `red` naming `rafa pr triage <pr>`, and
 * `none`, zero rows past the grace, naming `rafa pr merge <pr>
 * --skip-checks --yes` as the merge to run by hand. A read of the checks
 * that fails is exit 2.
 */
import type { ViewedPull } from './item-pull.js';
import type { RafaContext } from '@open-tomato/rafa/core/command';
import type { GhRunner } from '@open-tomato/rafa-board';
import type { CheckRow } from '@open-tomato/rafa-pr';

import { createGhPullRequests, formatRows, waitForChecks } from '@open-tomato/rafa-pr';

import { CommandExit, DEFAULT_CI_TIMEOUT_MIN } from '@open-tomato/rafa/core/command';
import { messageOf } from '@open-tomato/rafa/core/config/sections';
import { CI_POLL_INTERVAL_MS } from '@open-tomato/rafa/pr/ci-poll';

import { viewPull } from './item-pull.js';

/** The command's spelling, as its refusals name it. */
const COMMAND_NAME = 'rafa stretch item';

/** How long apart two reads of a mergeability GitHub has not computed are. */
export const MERGEABILITY_POLL_MS = 5_000;

/** How long the item waits for GitHub to compute the mergeability. */
export const MERGEABILITY_WAIT_MS: number = 2 * 60_000;

/** How long apart two reads of the checks are: `rafa pr wait`'s interval. */
export const CHECKS_POLL_MS: number = CI_POLL_INTERVAL_MS;

/** How long the item waits for the checks to end: `rafa pr wait`'s default bound. */
export const CHECKS_WAIT_MS: number = DEFAULT_CI_TIMEOUT_MIN * 60_000;

/** The word `gh` writes while GitHub has not computed the mergeability. */
const UNKNOWN = 'UNKNOWN';

/** The word `gh` writes for a head that does not merge into its base. */
const CONFLICTING = 'CONFLICTING';

/** The exit code of a refusal. */
const REFUSED_EXIT = 1;

/** The exit code of a reading that failed. */
const FAILED_EXIT = 2;

/** The clock the waits run on, as the merge half's seams carry it. */
export interface WaitSeams {
  /** Waits `ms` milliseconds. */
  readonly sleep: (ms: number) => Promise<void>;
  readonly now: () => Date;
}

/** The pull request waited on, and the issue whose item opened it. */
export interface WaitTarget {
  readonly issue: number;
  /** The pull request's number. */
  readonly number: number;
}

/** What a wait prints through. */
type WaitContext = Pick<RafaContext, 'output'>;

/** The line that finishes the item of `issue` once what stopped it is cleared. */
function resumeLine(issue: number): string {
  return `${COMMAND_NAME} ${String(issue)} --resume`;
}

/** A refusal with exit code 1 naming `why`, nothing merged, and the resume line. */
function refusal(target: WaitTarget, why: string, then: string): CommandExit {
  return new CommandExit(REFUSED_EXIT, `❌ ${COMMAND_NAME}: ${why} Nothing was merged; ${then}`
    + ` finish the item with ${resumeLine(target.issue)}.`);
}

/** `ms` as whole minutes, or seconds below one. */
function boundText(ms: number): string {
  return ms >= 60_000
    ? `${String(ms / 60_000)} minutes`
    : `${String(ms / 1_000)}s`;
}

/** Reads the pull request until GitHub has computed its mergeability; see the module note. */
export async function awaitMergeability(context: WaitContext, gh: GhRunner, target: WaitTarget, seams: WaitSeams): Promise<ViewedPull> {
  const pr = `#${String(target.number)}`;
  const since = seams.now().getTime();
  for (;;) {
    const pull = await viewPull(gh, target.number);
    context.output.info(`${pr} mergeability: ${pull.mergeable}`);
    if (pull.mergeable === CONFLICTING) {
      throw refusal(
        target,
        `${pr} reads ${CONFLICTING}: its head does not merge into ${pull.base}.`,
        `read it with rafa pr show ${String(target.number)}, resolve the conflict on ${pull.head}, then`,
      );
    }
    if (pull.mergeable !== UNKNOWN) return pull;
    if (seams.now().getTime() - since >= MERGEABILITY_WAIT_MS) {
      throw refusal(
        target,
        `${pr} still reads ${UNKNOWN} mergeability after ${boundText(MERGEABILITY_WAIT_MS)}.`,
        'once GitHub has computed it,',
      );
    }
    await seams.sleep(MERGEABILITY_POLL_MS);
  }
}

/** Waits for the pull request's checks to pass; see the module note. */
export async function awaitChecks(context: WaitContext, gh: GhRunner, target: WaitTarget, seams: WaitSeams): Promise<void> {
  const pr = `#${String(target.number)}`;
  const pulls = createGhPullRequests({ gh });
  const probe = async (): Promise<readonly CheckRow[]> => {
    try {
      return (await pulls.checks(target.number)).rows;
    } catch (error) {
      throw new CommandExit(FAILED_EXIT, `❌ ${COMMAND_NAME}: the checks of ${pr} could not be read: ${messageOf(error)}`);
    }
  };
  const now = (): number => seams.now().getTime();
  context.output.info(`waiting for the checks of ${pr}, up to ${boundText(CHECKS_WAIT_MS)}`);
  const waited = await waitForChecks({
    probe,
    timeoutMs: CHECKS_WAIT_MS,
    intervalMs: CHECKS_POLL_MS,
    now,
    sleep: seams.sleep,
    headCommittedAtMs: now(),
    onPoll: (rows, verdict, elapsedMs) => {
      context.output.info(`checks of ${pr} after ${String(Math.round(elapsedMs / 1_000))}s: ${verdict}\n${formatRows(rows)}`);
    },
  });
  const number = String(target.number);
  if (waited.verdict === 'green') return;
  if (waited.verdict === 'red') {
    throw refusal(target, `a check of ${pr} failed.`, `read it with rafa pr triage ${number}, and once the checks pass,`);
  }
  if (waited.verdict === 'none') {
    throw refusal(
      target,
      `${pr} reports no check, and rafa pr merge ${number} --yes refuses it.`,
      `merge it by hand with rafa pr merge ${number} --skip-checks --yes, then`,
    );
  }
  // `timeout`; `waitForChecks` never answers `pending`, which polls on.
  throw refusal(target, `the checks of ${pr} had not ended after ${boundText(CHECKS_WAIT_MS)}.`, 'once they pass,');
}
