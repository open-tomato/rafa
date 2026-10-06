/**
 * The wrap-up branch of the loop: what `start()` runs once
 * `findNextTask` answers no open task (`start.ts`).
 *
 * In order: the session record names no task, the operator is told the
 * wrap-up is starting, step 1 of the release writes the plan's change
 * fragment (`start/release-stage.ts`), the wrap-up session is spawned
 * with that record (`start/wrap-up.ts`), the loop guard reads the
 * checkout against the HEAD the session's commits left
 * (`start/checkout-watch.ts`), step 3 of the release verifies, commits
 * and pushes the fragment, the pull request is DELIVERED (below), and,
 * when the run waits on CI, the pull request's checks are waited on
 * (`start/pr-lifecycle.ts`). The session
 * record reads `wrap-up` from the start of the branch, `pull-request` as
 * that gate starts, and the gate writes `ci` and `repair` itself, handed
 * the session (`start/session.ts`). Step 3 runs
 * BEFORE that gate: a fragment pushed after the wait started would be a
 * commit those checks never read.
 *
 * ## The pull request, delivered
 *
 * A run never ends `done` without its pull request
 * (`.rafa/specs/rafa-579-loop-run-ends-delivered.md`, #576). After step
 * 3, so the fragment's notes exist, and before the CI wait,
 * {@link deliverPullRequest} reads the branch's open pull request. With
 * none, it spends `loop.wrapUp.retries` (`config-schema-wrap-up.ts`)
 * retry wrap-up sessions (`start/wrap-up-retry.ts`), each handed the
 * final message of the session before it and each followed by the same
 * reading. Still none, or `false` retries, and the runner opens the pull
 * request itself (`start/runner-pr.ts`), titled from the plan's issue and
 * title ({@link runnerPrInputFor}) with the fragment's notes in its body.
 * A repository whose `pr.provider` resolves to `none` has no pull request
 * to deliver, and none of this runs: the CI gate's own `none` path
 * pushes the branch as before.
 *
 * Whoever opened it, a DELIVERED pull request whose base is not the
 * run's — the `base` resolved once at the top of {@link runWrapUp} —
 * is then retargeted onto it (`start/pr-retarget.ts`), before the CI
 * wait, so the checks the wait reads ran against the right base. A
 * refused retarget is one warning and the run goes on to the wait; a
 * blocked or interrupted delivery reaches no retarget.
 *
 * The delivery is BLOCKED when the open pull request cannot be read
 * (the provider could not be asked), when the plan carries no issue
 * number the runner could title the pull request with, or when the
 * runner's own attempt stops at the dirty-tree, push or create step.
 * A blocked delivery throws `CommandExit` with exit code 1 and a report
 * naming the branch and the failed step, so the run's end writes
 * `stopped`; the record has no `blocked` state an older rafa could read.
 * A run the operator interrupted spawns no further retry and opens
 * nothing, and returns, also leaving the record `stopped`.
 *
 * A checkout the guard finds moved skips the release commit, its push,
 * the delivery and the wait, and returns without marking the session
 * finished, so the run's end writes `stopped`. A delivered pull request
 * or a `none` provider goes on to the wait and marks the session
 * finished, and the run's end writes `done`. Either way the caller ends
 * its loop once this returns.
 *
 * ## The pull request's event
 *
 * The `pr` or `no-pr` loop event is emitted once a run, in every output
 * mode and at the same place: the delivery's, after the retries and the
 * runner have had their turn ({@link emitPullRequestEvent}), so a pull
 * request a retry or the runner opened is the one the event names, and
 * the run's events file holds it in text too. It reads the delivered
 * number with no lookup, or a lookup of the branch's open pull request
 * made there on the paths with no number: a moved checkout, or a blocked
 * or interrupted delivery. A `none` provider makes no delivery, and its
 * `no-pr` reason says no provider is configured, with no lookup. Nothing
 * is emitted right after the wrap-up session: a reading there would
 * precede the retries and the runner.
 *
 * Every line written here goes through the active output
 * (`adapters/output/active.ts`), as the rest of `loop start` does.
 */
import type { CheckoutExpectation } from './checkout-guard.js';
import type { ClaudeSettingSource, RafaConfig } from '../config.js';
import type { RunnerPrInput, RunnerPrOpened } from './runner-pr.js';
import type { SessionServing } from './serving.js';
import type { RunSession } from './session.js';
import type { WrapUpLearning } from './wrap-up.js';
import type { WrapUpRetries } from '../config-schema-wrap-up.js';
import type { PullRequestSummary } from '../pr/index.js';

import { activeOutput } from '../adapters/output/active.js';
import { readDeviceStoreId } from '../claims/device.js';
import { resolveBaseBranch } from '../cleanup/index.js';
import { CommandExit } from '../cli/command.js';
import { messageOf } from '../config-sections.js';
import { parsePlan } from '../plan/index.js';
import { createGitRunner, ghPullRequestsIn, resolvePrProvider } from '../pr/index.js';

import { expectWrapUpCommits, haltIfWrapUpMoved } from './checkout-watch.js';
import { emitLoopEvent } from './loop-events.js';
import { prLifecycleSeamsIn, refusedPushReaderIn, verifyPullRequest } from './pr-lifecycle.js';
import { retargetPullRequest } from './pr-retarget.js';
import { finishRelease, planTitleIn, prepareReleaseStage } from './release-stage.js';
import { fragmentNotesIn, openRunnerPullRequest, runnerPrSeamsIn } from './runner-pr.js';
import { retryWrapUp } from './wrap-up-retry.js';
import { openPullRequestNumber, preserveProgress } from './wrap-up.js';

/** What {@link runWrapUp} runs the wrap-up over, each as `start()` settled it. */
export interface WrapUpRunInput {
  /** The run's session record: told the wrap-up started, each phase of the CI gate, and that the run finished. */
  readonly session: Pick<RunSession, 'wrapUpStarted' | 'pullRequestStarted' | 'ciStarted' | 'repairStarted' | 'finished'>;
  /** The project root, holding `.rafa/`: the store and this device's store id are read there. */
  readonly repoRoot: string;
  /** The checkout git and the wrap-up session run in (`start/checkout.ts`). */
  readonly checkout: string;
  /** The run's resolved config. */
  readonly settings: RafaConfig;
  /** The plan's stub, or null for a plan whose file name carries none. */
  readonly planStub: string | null;
  /** The plan as it stood when the run read it; the wrap-up is handed all of it. */
  readonly planContent: string;
  /** The setting sources every session the run spawns loads. */
  readonly settingSources: readonly ClaudeSettingSource[];
  /** What the wrap-up session is served against (`start/serving.ts`). */
  readonly serving: SessionServing;
  /** Where the wrap-up reads the lessons it asks the session to promote. */
  readonly wrapUpLearning: WrapUpLearning;
  /** The pair the loop guard holds the checkout to, as the last task commit left it. */
  readonly expected: CheckoutExpectation;
  /** Whether the run waits on the pull request's checks. */
  readonly ciWait: boolean;
  /** Minutes to wait for those checks to settle, floored at one. */
  readonly ciTimeoutMin: number;
  /** Repair sessions to spend on a red or conflicting PR, floored at zero. */
  readonly ciAttempts: number;
  /** True once the operator has interrupted the run; no retry or runner PR follows. */
  readonly isInterrupted: () => boolean;
}

/** Runs the wrap-up branch of the loop; see the module note. */
export async function runWrapUp(input: WrapUpRunInput): Promise<void> {
  const {
    session,
    repoRoot,
    checkout,
    settings,
    planStub,
    planContent,
    settingSources,
    serving,
    wrapUpLearning,
    expected,
    ciWait,
    ciTimeoutMin,
    ciAttempts,
  } = input;

  session.wrapUpStarted();
  activeOutput().info('\n✅ All tasks completed!');
  activeOutput().info('🧹 Wrap-up session starting: promote progress.txt findings, sync with main, then commit, push and open the PR.');
  activeOutput().info('   This is one full Claude session with no intermediate output — expect several quiet minutes. Interrupting it skips the push and PR; if that happens, run again to retry just this stage.');
  // Step 1 of the release, written BEFORE the session that
  // rewrites it (`start/release-stage.ts`), and handed to the
  // session as the record its prompt's release bullets are built
  // from. A preparation of null is the stage having failed to run
  // at all, and the wrap-up carries on without a release.
  emitLoopEvent({ kind: 'wrap-up', phase: 'fragment' });
  const release = prepareReleaseStage({
    repoRoot,
    checkout,
    settings,
    planStub,
    planContent,
  });
  // The run's base, resolved ONCE here and handed to every reader of
  // it: the wrap-up's and each retry's `gh pr create --base` bullet,
  // the runner's own open, the retarget of a delivered pull request,
  // and the CI gate's repair prompts, which name `origin/<base>`.
  const base = resolveBaseBranch(createGitRunner(checkout), settings.prBase);
  emitLoopEvent({ kind: 'wrap-up', phase: 'session' });
  const finalMessage = await preserveProgress(planContent, settingSources, release, serving, wrapUpLearning, base, checkout);
  // The `pr` or `no-pr` event, in every output mode, at the delivery's
  // place below and never here: over the number the delivery holds when
  // it holds one, else over this lookup, made after the retries and the
  // runner (see `emitPullRequestEvent`). A `none` provider has no pull
  // request to ask: its lookup answers the reason and never runs
  // `gh pr list`.
  const readProvider = () => resolvePrProvider({
    configured: settings.prProvider ?? null,
    dir: checkout,
  });
  const lookup = (): Promise<number | string | null> => readProvider().provider === 'none'
    ? Promise.resolve(NO_PROVIDER_REASON)
    : openPullRequestNumber(checkout, expected.branch);
  // The loop guard before the loop's own release commit, against the
  // HEAD the wrap-up session's commits left on the run's branch: a
  // moved branch or a gone checkout skips the commit, push and wait.
  if (haltIfWrapUpMoved({ expected: expectWrapUpCommits(expected), before: 'release' })) {
    await emitPullRequestEvent(expected.branch, null, lookup);
    emitLoopEvent({ kind: 'halt', reason: 'checkout moved' });
    return;
  }
  // Step 3, over that same record, after the session has returned
  // and BEFORE the CI gate: the verification, the restore on a
  // refusal, the `chore: release fragment` commit, its push and the
  // forecast. A fragment pushed after the wait started would be a
  // commit those checks never read, and the wait would then report
  // on a head the release moved.
  // The reading that decides whether the sentence or the forecast
  // reaches a pull request body at all is made here too, and for the same
  // reason: the run's `pr.provider` lives in this config, and a
  // repository resolving to `none` has no pull request to carry it
  // (`start/release-stage.ts`).
  emitLoopEvent({ kind: 'wrap-up', phase: 'release' });
  const finish = await finishRelease(
    { repoRoot: checkout, branch: expected.branch, settings, preparation: release },
    { readProvider },
  );
  // The pull request, delivered after step 3 and before the CI gate:
  // read, retried, opened by the runner; see the module note. A `none`
  // provider has no pull request to deliver.
  if (readProvider().provider !== 'none') {
    const delivery = await deliverPullRequest(
      { branch: expected.branch, retries: settings.loopWrapUpRetries, previousMessage: finalMessage },
      deliverySeamsIn({ ...input, base, fragment: finish.fragment }),
    );
    await emitPullRequestEvent(expected.branch, delivery.kind === 'delivered'
      ? delivery.pull.number
      : null, lookup);
    if (delivery.kind === 'interrupted') return;
    if (delivery.kind === 'blocked') throw new CommandExit(1, delivery.message);
    // A delivered pull request opened into another base than the run's
    // is retargeted onto it, BEFORE the CI wait, so the checks the wait
    // reads are the ones GitHub runs against the right base. A refused
    // edit is a warning and the run carries on (`start/pr-retarget.ts`).
    await retargetPullRequest(delivery.pull, base, { pulls: ghPullRequestsIn(checkout), output: activeOutput() });
  } else {
    // A `none` provider delivers nothing: the event carries its reason, with no lookup.
    await emitPullRequestEvent(expected.branch, null, lookup);
  }
  if (ciWait) {
    emitLoopEvent({ kind: 'wrap-up', phase: 'ci' });
    session.pullRequestStarted();
    await verifyPullRequest(
      Math.max(1, ciTimeoutMin) * 60_000,
      Math.max(0, ciAttempts),
      settingSources,
      base,
      // The gate takes its own path when this reads `none`: the
      // branch pushed, the compare URL printed and no CI wait
      // (`start/pr-lifecycle.ts`). The reading is made here
      // because the run's `pr.provider` lives in this config.
      {
        ...prLifecycleSeamsIn(checkout),
        readProvider,
        // A refused push reads this device's store id from the
        // project root, where the store lives, not the checkout.
        readRefusedPush: refusedPushReaderIn(checkout, () => readDeviceStoreId(repoRoot, settings)),
      },
      session,
    );
  }
  session.finished();
}

/** The `no-pr` reason of a run whose `pr.provider` is `none`. */
const NO_PROVIDER_REASON = 'no pull request provider is configured';

/**
 * Emits the `pr` or `no-pr` event for `branch`, the same in every output
 * mode. {@link runWrapUp} calls it once a run, at the delivery's place:
 * after the delivery, its retries and the runner's own open, or where a
 * moved checkout or a `none` provider reaches that place with no
 * delivery made. The number is `known` when the delivery holds it, and
 * only then is `lookup`, a read of the branch's open pull request over
 * the provider, skipped; otherwise the lookup is made here, after
 * anything the delivery opened. A `lookup` answering a string gives the
 * `no-pr` reason as is. Text prints nothing for the event: the events
 * output decides what reaches stdout, and the run's events file holds it
 * whatever the mode (`start/loop-events.ts`).
 */
export async function emitPullRequestEvent(
  branch: string,
  known: number | null,
  lookup: () => Promise<number | string | null>,
): Promise<void> {
  const number = known ?? await lookup();
  if (typeof number === 'string') {
    emitLoopEvent({ kind: 'no-pr', reason: number });
    return;
  }
  emitLoopEvent(number === null
    ? { kind: 'no-pr', reason: `no open pull request for ${branch}` }
    : { kind: 'pr', number });
}

/** Who opened the pull request a delivery found or made. */
export type PullRequestOpener = 'wrap-up' | 'retry' | 'runner';

/** How {@link deliverPullRequest} ended; see the module note. */
export type PullRequestDelivery =
  | {
    readonly kind: 'delivered';
    /** The open pull request. */
    readonly pull: PullRequestSummary;
    /** The first wrap-up session, a retry, or the runner. */
    readonly by: PullRequestOpener;
    /** The retry sessions spawned on the way. */
    readonly retriesSpent: number;
  }
  | {
    readonly kind: 'blocked';
    /** The report naming the branch and the step, the run's exit message. */
    readonly message: string;
    readonly retriesSpent: number;
  }
  | { readonly kind: 'interrupted'; readonly retriesSpent: number };

/** What the runner's own attempt answers: opened, or blocked with its report. */
export type RunnerAttempt = RunnerPrOpened | { readonly kind: 'blocked'; readonly message: string };

/**
 * The effects {@link deliverPullRequest} reaches through;
 * {@link deliverySeamsIn} makes the real ones.
 */
export interface PullRequestDeliverySeams {
  /** The branch's open pull request, or null; throws when the provider could not be asked. */
  readonly findOpen: (branch: string) => Promise<PullRequestSummary | null>;
  /** Spawns one retry wrap-up session after `previousMessage` and answers its own final message. */
  readonly retry: (previousMessage: string) => Promise<string>;
  /** The runner's own attempt at the pull request (`start/runner-pr.ts`). */
  readonly openRunnerPullRequest: () => Promise<RunnerAttempt>;
  /** True once the operator has interrupted the run. */
  readonly isInterrupted: () => boolean;
}

/** What one delivery is made over. */
export interface PullRequestDeliveryInput {
  /** The run's branch, the pull request's head. */
  readonly branch: string;
  /** `loop.wrapUp.retries`: retry sessions to spend, or `false` for none. */
  readonly retries: WrapUpRetries;
  /** The first wrap-up session's final message. */
  readonly previousMessage: string;
}

/** The line every blocked report ends with: what the stopped record leaves the operator. */
export const DELIVERY_BLOCKED_TAIL = '   The run is recorded stopped, not done. Open the pull request by hand, or fix the step above and run again to retry the wrap-up.';

/** The tail after a delivery the operator interrupted. */
const DELIVERY_INTERRUPTED = '\n⚠️  Interrupted: no further wrap-up session runs and the loop opens no pull request. Run again to retry the wrap-up.';

/** A blocked delivery, its message ending with {@link DELIVERY_BLOCKED_TAIL}. */
function blockedDelivery(report: string, retriesSpent: number): PullRequestDelivery {
  return { kind: 'blocked', message: `${report}\n${DELIVERY_BLOCKED_TAIL}`, retriesSpent };
}

/** The open pull request, null for none, or the blocked report when the provider could not be asked. */
async function readOpenPull(
  seams: PullRequestDeliverySeams,
  branch: string,
): Promise<{ readonly pull: PullRequestSummary | null } | { readonly unread: string }> {
  try {
    return { pull: await seams.findOpen(branch) };
  } catch (error) {
    return { unread: `❌ The run is blocked: the loop could not read whether a pull request is open for ${branch}.\n   ${messageOf(error)}` };
  }
}

/** The line saying what follows a reading that found no pull request. */
function missingLine(branch: string, spent: number, retries: number): string {
  const after = spent === 0
    ? 'the wrap-up session'
    : `retry ${String(spent)} of ${String(retries)}`;
  return spent < retries
    ? `\n⚠️  No open pull request for ${branch} after ${after}: running retry wrap-up session ${String(spent + 1)} of ${String(retries)} (loop.wrapUp.retries).`
    : `\n⚠️  No open pull request for ${branch} after ${after}: the loop opens it itself.`;
}

/**
 * Reads the branch's open pull request, spends the retries while there
 * is none, and has the runner open it after the last; see the module
 * note. Never throws on its own account: what stopped it is in the
 * answer, and the caller ends the run.
 */
export async function deliverPullRequest(
  input: PullRequestDeliveryInput,
  seams: PullRequestDeliverySeams,
): Promise<PullRequestDelivery> {
  const { branch } = input;
  const retries = input.retries === false
    ? 0
    : input.retries;
  let message = input.previousMessage;
  for (let spent = 0; ; spent++) {
    const reading = await readOpenPull(seams, branch);
    if ('unread' in reading) return blockedDelivery(reading.unread, spent);
    if (reading.pull !== null) {
      const by: PullRequestOpener = spent === 0
        ? 'wrap-up'
        : 'retry';
      return { kind: 'delivered', pull: reading.pull, by, retriesSpent: spent };
    }
    if (seams.isInterrupted()) {
      activeOutput().warn(DELIVERY_INTERRUPTED);
      return { kind: 'interrupted', retriesSpent: spent };
    }
    activeOutput().warn(missingLine(branch, spent, retries));
    if (spent === retries) return openByRunner(seams, branch, spent);
    message = await seams.retry(message);
  }
}

/** The runner's own attempt, after every retry; reported either way. */
async function openByRunner(
  seams: PullRequestDeliverySeams,
  branch: string,
  retriesSpent: number,
): Promise<PullRequestDelivery> {
  const attempt = await seams.openRunnerPullRequest();
  if (attempt.kind === 'blocked') return blockedDelivery(attempt.message, retriesSpent);
  activeOutput().info(`\n✅ The loop opened pull request #${String(attempt.pull.number)} for ${branch}: ${attempt.pull.url}`);
  return { kind: 'delivered', pull: attempt.pull, by: 'runner', retriesSpent };
}

/** What {@link runnerPrInputFor} reads the runner's pull request from. */
export interface RunnerPrSource {
  /** The run's branch. */
  readonly branch: string;
  /** The branch the pull request goes into. */
  readonly base: string;
  /** The plan as the run read it. */
  readonly planContent: string;
  /** The plan's stub, or null. */
  readonly planStub: string | null;
  /** The release fragment's note lines. */
  readonly notes: readonly string[];
}

/** A `rafa:plan` issue written as a GitHub number, with or without `#`. */
const ISSUE_NUMBER = /^#?(\d+)$/;

/** `rafa-<n>` opening a stub, or a branch's last path segment. */
const RAFA_ID = /(?:^|\/)rafa-(\d+)(?:-|$)/;

/**
 * The issue the plan implements: its `rafa:plan` block's `issue:` when
 * that is a number, else the `rafa-<n>` its stub or branch opens with,
 * as the wrap-up prompt reads it; null when none of them names one.
 */
export function planIssueNumber(planContent: string, planStub: string | null, branch: string): number | null {
  const declared = parsePlan(planContent).header.issue?.trim() ?? '';
  const spelled = ISSUE_NUMBER.exec(declared)?.[1]
    ?? RAFA_ID.exec(planStub ?? '')?.[1]
    ?? RAFA_ID.exec(branch)?.[1];
  return spelled === undefined
    ? null
    : Number(spelled);
}

/**
 * The runner's pull request input: the issue {@link planIssueNumber}
 * reads and the title `planTitleIn` reads (`start/release-stage.ts`), or
 * null when the plan names no issue number.
 */
export function runnerPrInputFor(source: RunnerPrSource): RunnerPrInput | null {
  const issue = planIssueNumber(source.planContent, source.planStub, source.branch);
  if (issue === null) return null;
  return {
    branch: source.branch,
    base: source.base,
    issue,
    planTitle: planTitleIn(source.planContent, source.planStub),
    notes: source.notes,
  };
}

/** What {@link deliverySeamsIn} closes over: the run's input, its base and the fragment step 3 committed. */
export interface DeliveryContext extends WrapUpRunInput {
  /** The run's base branch, as `runWrapUp` resolved it once; never resolved again here. */
  readonly base: string;
  /** The fragment `finishRelease` committed, relative to the checkout, or null. */
  readonly fragment: string | null;
}

/** The report for a plan that names no issue number to title the pull request with. */
function noIssueReport(branch: string): string {
  return [
    `❌ The run is blocked: the loop could not open the pull request for ${branch}: the plan names no issue number.`,
    '   Neither its `rafa:plan` block\'s `issue:` nor its stub or branch reads `rafa-<n>`.',
  ].join('\n');
}

/** The real seams, each made over the run's checkout. */
export function deliverySeamsIn(context: DeliveryContext): PullRequestDeliverySeams {
  const { checkout, expected } = context;
  const pulls = ghPullRequestsIn(checkout);
  return {
    findOpen: (branch) => pulls.findOpen(branch),
    retry: (previousMessage) => retryWrapUp({
      previousMessage,
      branch: expected.branch,
      base: context.base,
      planContent: context.planContent,
      settingSources: context.settingSources,
      serving: context.serving,
      learning: context.wrapUpLearning,
      checkout,
    }),
    openRunnerPullRequest: async () => {
      const runnerInput = runnerPrInputFor({
        branch: expected.branch,
        base: context.base,
        planContent: context.planContent,
        planStub: context.planStub,
        notes: fragmentNotesIn(checkout, context.fragment),
      });
      if (runnerInput === null) return { kind: 'blocked', message: noIssueReport(expected.branch) };
      return openRunnerPullRequest(runnerInput, runnerPrSeamsIn(checkout));
    },
    isInterrupted: context.isInterrupted,
  };
}
