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
 * `start()` hands {@link prLifecycleSeamsIn} its checkout instead
 * (`start/checkout.ts`), so the branch, the push, the `gh` readings and
 * every repair session are made in the working tree the loop committed
 * in, a linked worktree's own directory when the loop runs in one.
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
 * the commits are made either way. The one exception is a claim lost,
 * below.
 *
 * ## A refused push of a claim branch
 *
 * When that push fails, the gate asks who owns the claim on the branch
 * ({@link PrLifecycleSeams.readRefusedPush}, over `claims/lost.ts`),
 * which fetches the remote and never pushes again, with or without
 * force. When another store now owns the claim, the reading has kept
 * this device's commits on the local `lost/<stub>`, and the gate HALTS
 * the run: it throws `CommandExit` with exit code 1 and the "claim
 * lost" report as its message, printing no compare URL and no advice
 * to push by hand and open a pull request, since either would put this
 * device's work over the new owner's. `start()` then skips
 * `session.finished()`, so the run is recorded as stopped, not done.
 *
 * Every other reading keeps the failed-push report above. A claim the
 * reading could not settle (a failed fetch, an unreadable branch, a
 * store id that could not be read) adds one warning naming why; a
 * refusal that is not about the claim (this store still holds it, the
 * branch carries no claim, it is no claim branch) adds nothing, since
 * git's own words already say what happened. A push that worked reads
 * nothing.
 *
 * {@link refusedPushReaderIn} makes that reading over a checkout and a
 * store id reader. `start()` hands it the checkout and this device's
 * id read from the PROJECT root under the run's `store`
 * (`claims/device.ts`); {@link prLifecycleSeamsIn}'s own default reads
 * the SQLite store under the directory it was made for, which is the
 * same place only outside a worktree.
 *
 * What the gate tells the operator goes through the active output
 * (`adapters/output/active.ts`): the wait, each poll, a green verdict
 * and a merged PR through `info`; a skipped check, a PR not found, a
 * deadline passed, a PR with no checks and a red one through `warn`; and
 * a failed repair session and the escalation through `error`. A repair
 * session's own stdout reaches the operator through `utils/claude.ts`,
 * as `log` events in json mode.
 *
 * ## The phase on the run record
 *
 * `start/wrap-up-run.ts` hands {@link verifyPullRequest} the run's
 * session as its {@link PrLifecyclePhases} (`start/session.ts`), having
 * written `pull-request` to it just before. The gate then writes `ci`
 * before each poll of the checks and `repair` before each repair
 * session, so a repaired PR reads `ci` again once its next poll starts.
 * A gate that skips itself, finds no PR or takes the `none` path writes
 * no phase, and the record keeps `pull-request`. Left out, the gate
 * writes nothing ({@link NO_PHASES}).
 *
 * The repair prompt's first line is the `ci-repair` classifier key, and
 * `PROMPT_SHAPES` in `effort/classify.ts` names this file as the source
 * its drift guard reads that prefix and its infix from.
 */
import type { DeviceStoreId } from '../claims/device.js';
import type { RefusedPushReading } from '../claims/lost.js';
import type { ClaudeSettingSource } from '../config.js';
import type { RunSession } from './session.js';
import type {
  CheckRow,
  PrProviderReading,
  PullRequestDetail,
  PullRequests,
  PushOutcome,
  WaitOptions,
  WaitResult,
} from '../pr/index.js';
import type { ClaudeSpawner } from '../utils/claude.js';

import { activeOutput } from '../adapters/output/active.js';
import { readDeviceStoreId } from '../claims/device.js';
import { claimBranchIssue } from '../claims/git.js';
import { claimLostReport, readRefusedPush } from '../claims/lost.js';
import { CommandExit } from '../cli/command.js';
import { messageOf } from '../config-sections.js';
import { CONFIG_DEFAULTS } from '../config.js';
import {
  compareUrl,
  createGitRunner,
  failingRows,
  formatRows,
  ghAuthOkIn,
  ghPullRequestsIn,
  pushBranch,
  resolvePrProvider,
  waitForChecks,
} from '../pr/index.js';
import { runClaude, spawnClaude } from '../utils/claude.js';
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
  /**
   * Who owns the claim on a branch whose push failed, keeping this
   * device's commits on `lost/<stub>` when another store does. Read only
   * after a failed push; see the module note.
   */
  readonly readRefusedPush: (branch: string) => RefusedPushReading;
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

/**
 * The real helpers, each made in `dir`: the branch read there, the push
 * and every `gh` reading made there, and each repair session spawned
 * there through `spawn`, {@link spawnClaude} unless a test names a
 * recording one. `start()` names its checkout; see the module note.
 */
export function prLifecycleSeamsIn(dir: string, spawn: ClaudeSpawner = spawnClaude): PrLifecycleSeams {
  return {
    currentBranch: () => getCurrentBranch(dir),
    // `configured: null` leaves the answer to `origin`. `start()` passes a
    // reader carrying the run's own `pr.provider`; this default is what a
    // caller that names no seam gets.
    readProvider: () => resolvePrProvider({ configured: null, dir }),
    pushBranch: (branch) => Promise.resolve(pushBranch(dir, branch)),
    // `start()` replaces this with the project root's store under the
    // run's own `store`; see the module note.
    readRefusedPush: refusedPushReaderIn(dir, () => readDeviceStoreId(dir, CONFIG_DEFAULTS)),
    isGhUsable: () => ghAuthOkIn(dir),
    pulls: ghPullRequestsIn(dir),
    runClaude: (prompt, settingSources) => runClaude(prompt, settingSources, [], spawn, [], { cwd: dir }),
  };
}

/**
 * The reading {@link PrLifecycleSeams.readRefusedPush} makes: git run in
 * `dir`, the checkout whose push was refused, and this device's store id
 * from `readStoreId`. A store that names no id is read as no claimant
 * (`claims/lost.ts`); a store whose read THROWS answers `unknown` rather
 * than guess at one, so no claim of this device's is read as lost. A
 * branch that is no claim branch reads no store and runs no git.
 */
export function refusedPushReaderIn(
  dir: string,
  readStoreId: () => DeviceStoreId,
): (branch: string) => RefusedPushReading {
  return (branch) => {
    const issue = claimBranchIssue(branch);
    if (issue === null) return readRefusedPush(createGitRunner(dir), { branch, storeId: null });
    let device: DeviceStoreId;
    try {
      device = readStoreId();
    } catch (error) {
      return { outcome: 'unknown', issue, branch, reason: `this device's store id could not be read: ${messageOf(error)}` };
    }
    const storeId = device.ok
      ? device.storeId
      : null;
    return readRefusedPush(createGitRunner(dir), { branch, storeId });
  };
}

/**
 * The real helpers, which {@link verifyPullRequest} runs on by default:
 * the branch, the provider and `gh` over the process's own directory,
 * and repair sessions spawned in the loop's own directory.
 */
export const PR_LIFECYCLE_SEAMS: PrLifecycleSeams = {
  ...prLifecycleSeamsIn(process.cwd()),
  currentBranch: getCurrentBranch,
  runClaude,
};

/** The phases the gate writes to the run's session record; see the module note. */
export type PrLifecyclePhases = Pick<RunSession, 'ciStarted' | 'repairStarted'>;

/** The phases a gate handed no session writes: none. */
export const NO_PHASES: PrLifecyclePhases = Object.freeze({
  ciStarted: () => undefined,
  repairStarted: () => undefined,
});

/**
 * The effects one attempt reaches through: {@link PrLifecycleSeams} with
 * its repair session bound to the run's setting sources by
 * {@link verifyPullRequest}, and the run's base its repair prompts name.
 */
interface AttemptSeams extends Omit<PrLifecycleSeams, 'runClaude'> {
  /** The run's base branch, as `runWrapUp` resolved it once; a repair prompt names `origin/<base>`. */
  readonly base: string;
  /** Writes phase `repair`, then spawns one repair session with the prompt on stdin; answers its exit code. */
  readonly runRepair: (prompt: string) => Promise<number>;
  /** Where each poll writes phase `ci`. */
  readonly phases: PrLifecyclePhases;
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
 * split a single plan across two reviews. Its lockfile line restores
 * `bun.lock` from `origin/<base>`, the run's base and not the default
 * branch.
 */
async function repairPullRequest(
  prNumber: number,
  branch: string,
  base: string,
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
    `* A \`lockfile had changes, but lockfile is frozen\` failure means \`bun.lock\` no longer matches the manifests. Restore the base copy with \`git checkout origin/${base} -- bun.lock\`, run a plain \`bun install\` to re-add this branch's own dependencies, and verify with \`bun install --frozen-lockfile\`. Never hand-edit the lockfile.`,
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
 * here so no attempt can spawn one under any other. `base` is the run's
 * base branch, resolved once by `runWrapUp` (`pr.base` when set, else
 * the default branch): the conflict-repair line merges `origin/<base>`
 * and every repair prompt's lockfile line restores `bun.lock` from it.
 *
 * `seams` replaces any of the effects {@link PrLifecycleSeams} names; a
 * key left out runs the real helper. `phases` is where `ci` and `repair`
 * are written; see the module note.
 */
export async function verifyPullRequest(
  timeoutMs: number,
  maxAttempts: number,
  settingSources: readonly ClaudeSettingSource[],
  base: string,
  seams: Partial<PrLifecycleSeams> = {},
  phases: PrLifecyclePhases = NO_PHASES,
): Promise<void> {
  const given: PrLifecycleSeams = { ...PR_LIFECYCLE_SEAMS, ...seams };
  const io: AttemptSeams = {
    ...given,
    runRepair: (prompt) => {
      phases.repairStarted();
      return given.runClaude(prompt, settingSources);
    },
    base,
    phases,
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
    const claim = io.readRefusedPush(branch);
    haltIfClaimLost(claim);
    output.error(`\n❌ Could not push ${branch}.`);
    if (push.output !== '') output.error(push.output);
    output.error('   The work is committed locally. Push it yourself and open the PR by hand.');
    if (claim.outcome === 'unknown') {
      output.warn(`\n⚠️  Could not tell who holds the claim on #${String(claim.issue)}: ${claim.reason}.`);
      output.warn(`   Check with rafa status before pushing ${branch} by hand.`);
    }
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
 * Halts the run on a claim another store now holds: throws `CommandExit`
 * with exit code 1 and the "claim lost" report, so no compare URL is
 * printed and no pull request is opened. Returns for any other reading.
 */
function haltIfClaimLost(claim: RefusedPushReading): void {
  if (claim.outcome !== 'lost') return;
  throw new CommandExit(1, [
    `\n${claimLostReport(claim)}`,
    `   The run stops here: no pull request is opened for ${claim.branch}, and the CI wait is skipped.`,
  ].join('\n'));
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
  io.phases.ciStarted();
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
    io.base,
    'it conflicts with the base branch, so GitHub scheduled no CI run at all.',
    `Merge \`origin/${io.base}\` into this branch and resolve the conflicts, then push. Mechanical conflicts (versions, lockfiles, complementary additions) are yours to resolve; a genuine semantic conflict is not.`,
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
    io.base,
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
