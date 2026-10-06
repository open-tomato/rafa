/**
 * What a release finish leaves in the pull request body, and the second
 * chance it gets when no pull request was open to take it.
 *
 * `finishRelease` (`./release-stage.ts`) decides WHAT the body is given
 * — one failure sentence, or the forecast block, with the level report
 * beside either — and hands it here as a {@link BodyWrite}. This module
 * is the write itself: which provider it goes through, the
 * read-modify-write against the branch's open pull request, and the
 * terminal line naming where the lines went.
 *
 * ## The write is a read-modify-write
 *
 * A provider has no way to append to a body, so the body is read back
 * and the new one built over it. A body the write would not change is
 * left alone, which is what makes a re-run idempotent and what keeps
 * the sentence single when the session already copied it in from its
 * prompt. A pull request that cannot be found or cannot be asked is
 * reported and NOT thrown: the release is already decided by then, and
 * the operator is owed the reason on their terminal whether or not
 * GitHub took it.
 *
 * ## Which provider is asked, and what a `none` reading costs
 *
 * WHICH provider the write goes through is a reading, not a constant.
 * {@link ReleaseBodySeams.readProvider} answers it —
 * `resolvePrProvider` (`src/pr/provider.ts`), the one reading in this
 * repository that says `gh` or `none` — and it is taken BEFORE
 * {@link ReleaseBodySeams.pulls} is called, so a repository that
 * resolves to `none` spawns no `gh` at all rather than spawning one and
 * reporting what it said. A run under `pr.provider: none` has no pull
 * request to carry anything: the loop pushes the branch and prints a
 * compare URL (`src/pr/none.ts`), and asking the GitHub CLI for a body
 * there is a call that can only fail, slowly, on a machine that may not
 * have `gh` installed.
 *
 * The reading is the RUN's, so `src/start/wrap-up-run.ts` hands the
 * release stage a reader carrying the run's own `pr.provider`. The
 * default seam here leaves `configured` null, which is `origin`
 * deciding — right for a caller that names no seam, and wrong for a
 * GitHub Enterprise remote, which reads as not GitHub until a config
 * says otherwise.
 *
 * What reaches no body is still what the operator is owed, so the
 * `none` path prints ONE line naming it: the lines quoted, and the
 * reading that kept them off the board. It prints at info rather than
 * error level, because a configured `none` provider writing no body is
 * the setting working and not a fault.
 *
 * ## A pull request opened after the finish
 *
 * The release step runs straight after the first wrap-up session, and
 * that session is not the only thing that opens the pull request: a
 * retry session or the runner itself (`./runner-pr.ts`) may open it
 * later. A finish that found no pull request therefore keeps what it
 * meant to write (`ReleaseFinish.written`), and
 * {@link carryReleaseIntoPullRequest} writes it again once the delivery
 * has answered. A finish whose write reached a pull request, or that
 * had nothing to write, is left alone.
 */
import type { PrProviderReading, PullRequests } from '../pr/index.js';

import { activeOutput } from '../adapters/output/active.js';
import { messageOf } from '../config-sections.js';
import { ghPullRequestsIn, resolvePrProvider } from '../pr/index.js';
import { bodyWithRelease } from '../release/branch-forecast.js';

/** What one finish writes into the body, before it is written. */
export interface BodyWrite {
  /** The failure line, appended when the body lacks it; null on success. */
  readonly sentence: string | null;
  /** The marked forecast and level report block; null when both are absent. */
  readonly block: string | null;
  /** What a reader sees of the two, for the terminal line naming them. */
  readonly lines: readonly string[];
}

/** What became of what the body had to be given. */
export interface ReleaseBodyWrite {
  /** The pull request it was written to, or null when none was found. */
  readonly number: number | null;
  /** True when the body carries it now. */
  readonly carried: boolean;
  /** True when it already did, so nothing was written. */
  readonly already: boolean;
  /** Why it does not, or null when it does. */
  readonly problem: string | null;
}

/**
 * The effects the body write reaches through. `ReleaseStageSeams`
 * carries the same two keys, so the release stage's seams are these.
 */
export interface ReleaseBodySeams {
  /** The provider the body is written through. */
  readonly pulls: (repoRoot: string) => PullRequests;
  /**
   * Which provider that is. A reading of `none` writes no body and
   * reaches no `gh`; see the module note.
   */
  readonly readProvider: (repoRoot: string) => PrProviderReading;
}

/** The real helpers, which the body write runs on by default. */
export const RELEASE_BODY_SEAMS: ReleaseBodySeams = {
  pulls: ghPullRequestsIn,
  // `configured: null` leaves the answer to `origin`. `start()` passes
  // a reader carrying the run's own `pr.provider`; this default is what
  // a caller that names no seam gets.
  readProvider: (repoRoot: string) => resolvePrProvider({ configured: null, dir: repoRoot }),
};

/** Where the body is written: the run's checkout and its head branch. */
export interface ReleaseBodyTarget {
  /** The repository the provider is resolved and asked in. */
  readonly repoRoot: string;
  /** The run's head branch, whose open pull request carries the body. */
  readonly branch: string;
}

/** What a finish wrote, and what that write answered. */
export interface ReleaseBodyRecord {
  /** What the finish wrote into the body, or null when it wrote nothing. */
  readonly written: BodyWrite | null;
  /** What became of that write, or null when there was nothing to write. */
  readonly body: ReleaseBodyWrite | null;
}

/** Nothing reached a body, and why. */
function unwritten(number: number | null, problem: string): ReleaseBodyWrite {
  return { number, carried: false, already: false, problem };
}

/**
 * Puts `write` in the pull request body of `branch`, unless the body
 * already carries it.
 *
 * Reported and never thrown; see the module note for why the read comes
 * first and why a body the write would not change is left alone.
 */
async function carryIntoBody(
  pulls: PullRequests,
  branch: string,
  write: BodyWrite,
): Promise<ReleaseBodyWrite> {
  try {
    const found = await pulls.findOpen(branch);
    if (found === null) {
      return unwritten(null, `no open pull request was found for ${branch} to write it to`);
    }

    const detail = await pulls.get(found.number);
    if (detail === null) {
      return unwritten(found.number, `pull request #${found.number} could not be read back`);
    }
    const next = bodyWithRelease(detail.body, write.sentence, write.block);
    if (next === detail.body) {
      return { number: found.number, carried: true, already: true, problem: null };
    }

    await pulls.editBody(found.number, next);
    return { number: found.number, carried: true, already: false, problem: null };
  } catch (error) {
    return unwritten(null, `the pull request body could not be written: ${messageOf(error)}`);
  }
}

/**
 * Why a reading that is not `gh` leaves the body unwritten, as the
 * record's own `problem` carries it.
 */
function noProviderProblem(reading: PrProviderReading): string {
  const origin = reading.remote === null
    ? 'origin is not set'
    : `origin is ${reading.remote}`;
  const because = reading.source === 'config'
    ? 'pr.provider says so'
    : origin;
  return `this repository resolves to pr.provider: ${reading.provider}, because ${because},`
    + ' so there is no pull request to write it to';
}

/** `That line is` or `Those lines are`, by how many there are. */
function linesSubject(count: number): { readonly noun: string; readonly verb: string } {
  return count === 1
    ? { noun: 'That line', verb: 'is' }
    : { noun: 'Those lines', verb: 'are' };
}

/** Says where the lines went, or that they went nowhere. */
function announceBody(write: ReleaseBodyWrite, count: number): void {
  const out = activeOutput();
  const { noun, verb } = linesSubject(count);
  if (write.problem !== null) {
    out.error(`   ${noun} ${verb} not in the pull request body: ${write.problem}`);
    return;
  }
  if (write.already) {
    out.info(`   Pull request #${write.number} already carries ${noun.toLowerCase()}.`);
    return;
  }
  out.info(`   ${noun} ${verb} now in the body of pull request #${write.number}.`);
}

/**
 * Writes `write` into the pull request body of `target.branch` through
 * the resolved provider, or prints the one line naming what went
 * unwritten.
 */
export async function writeBody(
  seams: ReleaseBodySeams,
  target: ReleaseBodyTarget,
  write: BodyWrite,
): Promise<ReleaseBodyWrite> {
  // Read BEFORE the provider is built, so a `none` repository spawns no
  // `gh`; the one line it prints names what went unwritten. See the
  // module note.
  const reading = seams.readProvider(target.repoRoot);
  if (reading.provider !== 'gh') {
    const problem = noProviderProblem(reading);
    activeOutput().info(`   No pull request body carries ${JSON.stringify(write.lines.join(' '))}: ${problem}.`);
    return unwritten(null, problem);
  }

  const body = await carryIntoBody(seams.pulls(target.repoRoot), target.branch, write);
  announceBody(body, write.lines.length);
  return body;
}

/**
 * Writes a finish's {@link BodyWrite} again, for a pull request opened
 * after the finish ran: by a wrap-up retry session or by the runner.
 *
 * Writes only when the finish wrote something and its own write
 * answered no pull request (`body.number` null); a finish with nothing
 * to write, or whose write reached a pull request, is left alone and
 * answers null. Otherwise answers what the second write did, which is
 * reported and never thrown, as the first one was.
 */
export async function carryReleaseIntoPullRequest(
  finish: ReleaseBodyRecord,
  target: ReleaseBodyTarget,
  seams: Partial<ReleaseBodySeams> = {},
): Promise<ReleaseBodyWrite | null> {
  const { written, body } = finish;
  if (written === null || body === null || body.number !== null) return null;
  return writeBody({ ...RELEASE_BODY_SEAMS, ...seams }, target, written);
}
