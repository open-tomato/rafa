/**
 * The last stage of a run: the PR the wrap-up pushed, until CI has
 * spoken about it.
 *
 * `start()` calls {@link verifyPullRequest} once `start/wrap-up.ts` has
 * returned, unless the run was started with `--no-ci-wait`, and takes
 * the defaults of `--ci-timeout` and `--ci-attempts` from the constants
 * exported here. Every effect it has goes through
 * {@link PrLifecycleSeams}: the pull request through the `PullRequests`
 * port (`pr/index.ts`), the branch through `utils/git.ts`, a repair
 * session through `runClaude`, and the poll's clock and wait through
 * `waitForChecks`. So a test drives each verdict with no network, no
 * session and no 20-second wait. Every repair session loads settings
 * from the sources `start()` hands over, the run's
 * `loop.settingSources`.
 *
 * The port is what the gate reads a PR through, so nothing here names
 * `gh`, a command or a JSON field: the provider answers records, and the
 * default seams hold the `gh` adapter over the process's own directory.
 * The one thing still spelled `gh` is {@link PrLifecycleSeams.isGhUsable},
 * the reading that decides whether to skip the gate at all, and the
 * repair prompt, which tells a session which commands to read logs with.
 *
 * ## The `none` provider
 *
 * Before anything is asked of `gh`, the gate reads which provider the
 * repository gets ({@link PrLifecycleSeams.readProvider}, over
 * `pr/provider.ts`). A reading of `none` has no CLI to open a pull
 * request with and so nothing to poll, and it takes the whole of the
 * gate's other path: the branch is PUSHED, the compare URL printed, and
 * the CI wait skipped and said to be skipped (`pr/none.ts`). No PR is
 * looked for, no check is polled and no repair session is spent, so
 * `pr.provider: none` costs a `git push` and nothing else.
 *
 * That reading comes before {@link PrLifecycleSeams.isGhUsable} on
 * purpose. The two skips are different facts and say different things:
 * `none` is a configured answer and the push is the loop doing its job,
 * while an unusable `gh` under a `gh` provider is a machine that cannot
 * answer and leaves the operator with a PR nothing confirmed. Asking
 * `gh auth status` first would print the second for a repository that
 * means the first.
 *
 * A push that fails is reported and not rethrown, for the reason a
 * provider that cannot be asked is: this is the run's last gate, and
 * the commits are made either way.
 *
 * What the gate tells the operator goes through the active output
 * (`adapters/output/active.ts`): the wait, each poll, a green verdict
 * and a merged PR through `info`; a skipped check, a PR not found, a
 * deadline passed, a PR with no checks and a red one through `warn`; and
 * a failed repair session and the escalation through `error`. A repair
 * session's own stdout reaches the operator through `utils/claude.ts`,
 * as `log` events in json mode.
 *
 * The repair prompt's first line is the `ci-repair` classifier key, and
 * `PROMPT_SHAPES` in `effort/classify.ts` names this file as the source
 * its drift guard reads that prefix and its infix from.
 */
import type { ClaudeSettingSource } from '../config.js';
import type {
  CheckRow,
  PrProviderReading,
  PullRequestDetail,
  PullRequests,
  PushOutcome,
  WaitOptions,
  WaitResult,
} from '../pr/index.js';

import { activeOutput } from '../adapters/output/active.js';
import { messageOf } from '../config-sections.js';
import {
  compareUrl,
  failingRows,
  formatRows,
  ghAuthOkIn,
  ghPullRequestsIn,
  pushBranch,
  resolvePrProvider,
  waitForChecks,
} from '../pr/index.js';
import { runClaude } from '../utils/claude.js';
import { getCurrentBranch } from '../utils/git.js';

import { withStamp } from './stamp.js';

/** How long to keep polling a PR's checks before giving up on them. */
export const DEFAULT_CI_TIMEOUT_MIN = 20;

/** Seconds between polls. CI here settles in 2-5 minutes. */
export const CI_POLL_INTERVAL_MS = 20_000;

/** Repair sessions spent on a red or conflicting PR before escalating. */
export const DEFAULT_CI_ATTEMPTS = 2;

/** One PR in full, or null when the provider has no such PR. */
type MergeState = PullRequestDetail | null;

/**
 * The effects {@link verifyPullRequest} reaches through, in one object
 * so a test replaces them together. {@link PR_LIFECYCLE_SEAMS} holds the
 * real ones.
 */
export interface PrLifecycleSeams {
  /** The branch whose PR is verified. */
  readonly currentBranch: () => string;
  /**
   * Which provider the repository gets. A reading of `none` takes the
   * gate's other path; see the module note.
   */
  readonly readProvider: () => PrProviderReading;
  /** Pushes the branch to `origin` with upstream set, for a `none` provider. */
  readonly pushBranch: (branch: string) => Promise<PushOutcome>;
  /** Whether `gh` is on PATH and authenticated. */
  readonly isGhUsable: () => Promise<boolean>;
  /** The provider every read of the pull request goes through. */
  readonly pulls: PullRequests;
  /**
   * Spawns one repair session with the prompt on stdin, loading settings
   * from the sources named; answers its exit code.
   */
  readonly runClaude: (
    prompt: string,
    settingSources: readonly ClaudeSettingSource[],
  ) => Promise<number>;
  /** The poll's clock. Absent, `waitForChecks` reads the real one. */
  readonly now?: WaitOptions['now'];
  /** The wait between polls. Absent, `waitForChecks` sets a real timer. */
  readonly sleep?: WaitOptions['sleep'];
}

/** The real helpers, which {@link verifyPullRequest} runs on by default. */
export const PR_LIFECYCLE_SEAMS: PrLifecycleSeams = {
  currentBranch: getCurrentBranch,
  // `configured: null` leaves the answer to `origin`. `start()` passes a
  // reader carrying the run's own `pr.provider`; this default is what a
  // caller that names no seam gets.
  readProvider: () => resolvePrProvider({ configured: null, dir: process.cwd() }),
  pushBranch: (branch) => Promise.resolve(pushBranch(process.cwd(), branch)),
  isGhUsable: () => ghAuthOkIn(process.cwd()),
  pulls: ghPullRequestsIn(process.cwd()),
  runClaude,
};

/**
 * The effects one attempt reaches through: {@link PrLifecycleSeams} with
 * its repair session bound to the run's setting sources by
 * {@link verifyPullRequest}.
 */
interface AttemptSeams extends Omit<PrLifecycleSeams, 'runClaude'> {
  /** Spawns one repair session with the prompt on stdin; answers its exit code. */
  readonly runRepair: (prompt: string) => Promise<number>;
}

/**
 * How one attempt at the PR ended. `stop` when there is nothing more to
 * do, its verdict reported. `next` when a repair session was spent and
 * the checks are to be read again, or when the verdict wants a repair
 * and no attempt is left to spend on it.
 */
type AttemptEnd = 'stop' | 'next';

/**
 * Runs one Claude session to repair a PR that CI has rejected.
 *
 * The session is told what failed and where, and explicitly told not to
 * open a second PR — the branch already has one, and a new branch would
 * split a single plan across two reviews.
 */
async function repairPullRequest(
  prNumber: number,
  branch: string,
  reason: string,
  detail: string,
  run: AttemptSeams['runRepair'],
): Promise<number> {
  const prompt = [
    `The pull request for branch \`${branch}\` (#${prNumber}) is not mergeable: ${reason}`,
    '',
    detail,
    '',
    '* Diagnose the ACTUAL cause before changing anything. For a failing GitHub Actions job, read its log: `gh run view <run-id> --log-failed`, or `gh api repos/<owner>/<repo>/actions/jobs/<job-id>/logs` while other jobs in the run are still going. Identify which STEP failed — a job that dies at `Install dependencies` says nothing about the tests, and the fix is not in the test files.',
    '* A `lockfile had changes, but lockfile is frozen` failure means `bun.lock` no longer matches the manifests. Restore the base copy with `git checkout origin/main -- bun.lock`, run a plain `bun install` to re-add this branch\'s own dependencies, and verify with `bun install --frozen-lockfile`. Never hand-edit the lockfile.',
    '* Reproduce locally before pushing a fix, and re-run the affected gate (`bun run lint:all`, `bun run check-types:all`, `bun run test:all`) so the push is not a guess.',
    '* A test that fails under the full suite and passes when run alone is the known parallel-load flake, not a regression. Re-run the file alone to establish which it is, and if it is the flake, say so and change nothing.',
    `* Commit the fix and push to the CURRENT branch (${branch}). Do NOT create a branch and do NOT open a second PR — #${prNumber} already exists and will pick the push up.`,
    '* If the cause is a genuine semantic conflict or a real defect you cannot fix without a product decision, change nothing, and report what you found and what the options are.',
    '* Do not include Claude attribution in the commit message.',
  ].join('\n');

  return run(withStamp(prompt));
}

/**
 * The wrap-up's last gate: a PR is not done until CI has spoken about it.
 *
 * Polls the PR's checks, and spends up to `maxAttempts` repair sessions on
 * a red or conflicting result before escalating to the operator. Skips
 * itself cleanly when `gh` is unusable, so the loop still works offline,
 * and reports rather than rethrows a provider that could not be asked
 * once the gate has started, for the same reason.
 *
 * Under a `none` provider it pushes the branch, prints the compare URL
 * and skips the wait instead, polling nothing; see the module note.
 *
 * Every repair session loads settings from `settingSources`, bound once
 * here so no attempt can spawn one under any other.
 *
 * `seams` replaces any of the effects {@link PrLifecycleSeams} names; a
 * key left out runs the real helper.
 */
export async function verifyPullRequest(
  timeoutMs: number,
  maxAttempts: number,
  settingSources: readonly ClaudeSettingSource[],
  seams: Partial<PrLifecycleSeams> = {},
): Promise<void> {
  const given: PrLifecycleSeams = { ...PR_LIFECYCLE_SEAMS, ...seams };
  const io: AttemptSeams = {
    ...given,
    runRepair: (prompt) => given.runClaude(prompt, settingSources),
  };
  const branch = io.currentBranch();

  const reading = io.readProvider();
  if (reading.provider === 'none') {
    await pushWithoutProvider(io, branch, reading);
    return;
  }

  if (!await io.isGhUsable()) {
    activeOutput().warn('\n⚠️  `gh` is not available or not authenticated — skipping the CI check.');
    activeOutput().warn('   The PR has been pushed but nothing here confirms CI agreed with it.');
    return;
  }

  try {
    for (let attempt = 0; attempt <= maxAttempts; attempt++) {
      const isLastAttempt = attempt === maxAttempts;
      if (await verifyAttempt(io, branch, timeoutMs, isLastAttempt) === 'stop') return;
    }
  } catch (error) {
    // The port throws when it could not be ASKED, where the helpers it
    // replaced answered an empty reading. It is reported and not
    // rethrown: this is the run's last gate, and the work is pushed
    // either way.
    activeOutput().error(`\n❌ Could not read the PR for ${branch}: ${messageOf(error)}`);
    activeOutput().error('   The PR has been pushed but nothing here confirms CI agreed with it.');
    return;
  }

  activeOutput().error(`\n❌ CI still not green after ${maxAttempts} repair attempt(s) on ${branch}.`);
  activeOutput().error('   Stopping rather than looping. Read the failing jobs and decide.');
}

/**
 * The whole of the gate for a `none` provider: pushes `branch`, names
 * where a pull request would be opened from, and says the CI wait was
 * skipped. Reports a failed push and returns; see the module note.
 */
async function pushWithoutProvider(
  io: AttemptSeams,
  branch: string,
  reading: PrProviderReading,
): Promise<void> {
  const output = activeOutput();
  const said = reading.source === 'config'
    ? 'pr.provider is none'
    : 'origin is not a GitHub remote, so pr.provider resolves to none';
  output.info(`\n⬆️  ${said} — pushing ${branch} and opening no pull request.`);

  const push = await io.pushBranch(branch);
  if (!push.ok) {
    output.error(`\n❌ Could not push ${branch}.`);
    if (push.output !== '') output.error(push.output);
    output.error('   The work is committed locally. Push it yourself and open the PR by hand.');
    return;
  }
  output.info(`\n✅ Pushed ${branch} to origin.`);

  const url = compareUrl(reading.remote, branch);
  if (url === null) {
    output.warn('   origin names no web host, so there is no compare URL to open. Open the PR by hand.');
  } else {
    output.info(`   Open the pull request: ${url}`);
  }

  output.warn('\n⚠️  CI check skipped: with no pull request provider there is nothing to poll.');
  output.warn('   The branch is pushed but nothing here confirms CI agreed with it.');
}

/**
 * One attempt: finds the branch's PR, polls its checks, and reports a
 * verdict no repair can change. Any other verdict gets a repair session,
 * unless this is the last attempt.
 */
async function verifyAttempt(
  io: AttemptSeams,
  branch: string,
  timeoutMs: number,
  isLastAttempt: boolean,
): Promise<AttemptEnd> {
  const found = await io.pulls.findOpen(branch);
  if (found === null) {
    activeOutput().warn(`\n⚠️  No open PR found for ${branch}. Nothing to verify.`);
    return 'stop';
  }
  const prNumber = found.number;

  const result = await pollChecks(io, prNumber, timeoutMs);
  if (reportSettledVerdict(prNumber, result)) return 'stop';
  if (isLastAttempt) return 'next';

  // `none` and `red` both get a repair session, with different framing:
  // no checks at all is almost always a conflict, since GitHub cannot
  // build a merge ref for a PR that does not merge cleanly.
  const merge = await io.pulls.get(prNumber);
  return result.verdict === 'none'
    ? handleNoChecks(io, branch, prNumber, merge)
    : handleRedChecks(io, branch, prNumber, result.rows);
}

/** Polls one PR's checks until they settle or the deadline passes. */
function pollChecks(
  io: AttemptSeams,
  prNumber: number,
  timeoutMs: number,
): Promise<WaitResult> {
  activeOutput().info(`\n⏳ Waiting for CI on PR #${prNumber} (up to ${Math.round(timeoutMs / 60000)} min)...`);

  return waitForChecks({
    probe: async () => (await io.pulls.checks(prNumber)).rows,
    timeoutMs,
    intervalMs: CI_POLL_INTERVAL_MS,
    now: io.now,
    sleep: io.sleep,
    onPoll: (rows, verdict, elapsedMs) => {
      const secs = Math.round(elapsedMs / 1000);
      activeOutput().info(`   [${secs}s] ${verdict} — ${rows.length} check(s)`);
    },
  });
}

/**
 * Reports a verdict no repair can change, green or still running at the
 * deadline, and answers whether the poll ended on one.
 */
function reportSettledVerdict(prNumber: number, result: WaitResult): boolean {
  if (result.verdict === 'green') {
    activeOutput().info(`\n✅ CI green on PR #${prNumber}:`);
    activeOutput().info(formatRows(result.rows));
    return true;
  }

  if (result.verdict === 'timeout') {
    activeOutput().warn(`\n⚠️  CI still running after ${Math.round(result.elapsedMs / 1000)}s. Not waiting further.`);
    activeOutput().warn(formatRows(result.rows));
    activeOutput().warn(`   Check it yourself: gh pr checks ${prNumber}`);
    return true;
  }
  return false;
}

/**
 * A PR with no checks. Nothing to do when it is merged, or when it is
 * not conflicting. A conflict, or a PR the provider answers nothing for,
 * gets a conflict-repair session.
 */
async function handleNoChecks(
  io: AttemptSeams,
  branch: string,
  prNumber: number,
  merge: MergeState,
): Promise<AttemptEnd> {
  if (merge?.state === 'merged') {
    activeOutput().info(`\n✅ PR #${prNumber} is already merged.`);
    return 'stop';
  }
  if (merge !== null && merge.mergeStateStatus !== 'DIRTY') {
    activeOutput().warn(`\n⚠️  PR #${prNumber} reports no checks and is not conflicting`);
    activeOutput().warn(`   (GitHub says it is ${merge.mergeable}, merge state ${merge.mergeStateStatus}).`);
    activeOutput().warn('   Most likely no workflow matches the changed paths. Nothing to repair.');
    return 'stop';
  }
  activeOutput().warn(`\n❌ PR #${prNumber} has no checks — it does not merge cleanly, so GitHub scheduled no run.`);
  const exitCode = await repairPullRequest(
    prNumber,
    branch,
    'it conflicts with the base branch, so GitHub scheduled no CI run at all.',
    'Merge `origin/main` into this branch and resolve the conflicts, then push. Mechanical conflicts (versions, lockfiles, complementary additions) are yours to resolve; a genuine semantic conflict is not.',
    io.runRepair,
  );
  if (exitCode !== 0) {
    activeOutput().error(`\n❌ Conflict-repair session failed (exit ${exitCode}).`);
    return 'stop';
  }
  return 'next';
}

/** A red PR gets a CI-repair session, handed its failing checks. */
async function handleRedChecks(
  io: AttemptSeams,
  branch: string,
  prNumber: number,
  rows: readonly CheckRow[],
): Promise<AttemptEnd> {
  activeOutput().warn(`\n❌ CI red on PR #${prNumber}:`);
  activeOutput().warn(formatRows(rows));
  const failed = failingRows(rows);
  const exitCode = await repairPullRequest(
    prNumber,
    branch,
    'its CI checks failed.',
    ['The failing checks are:', formatRows(failed)].join('\n'),
    io.runRepair,
  );
  if (exitCode !== 0) {
    activeOutput().error(`\n❌ CI-repair session failed (exit ${exitCode}).`);
    return 'stop';
  }
  return 'next';
}
