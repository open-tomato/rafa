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
 * and pushes the fragment, and, when the run waits on CI, the pull
 * request's checks are waited on (`start/pr-lifecycle.ts`). Step 3 runs
 * BEFORE that gate: a fragment pushed after the wait started would be a
 * commit those checks never read.
 *
 * A checkout the guard finds moved skips the release commit, its push
 * and the wait, and returns without marking the session finished, so
 * the run's end writes `stopped`. Every other way through marks it
 * finished, and the run's end writes `done`. Either way the caller ends
 * its loop once this returns.
 *
 * Every line written here goes through the active output
 * (`adapters/output/active.ts`), as the rest of `loop start` does.
 */
import type { CheckoutExpectation } from './checkout-guard.js';
import type { ClaudeSettingSource, RafaConfig } from '../config.js';
import type { SessionServing } from './serving.js';
import type { RunSession } from './session.js';
import type { WrapUpLearning } from './wrap-up.js';

import { activeOutput } from '../adapters/output/active.js';
import { readDeviceStoreId } from '../claims/device.js';
import { resolvePrProvider } from '../pr/index.js';

import { expectWrapUpCommits, haltIfWrapUpMoved } from './checkout-watch.js';
import { prLifecycleSeamsIn, refusedPushReaderIn, verifyPullRequest } from './pr-lifecycle.js';
import { finishRelease, prepareReleaseStage } from './release-stage.js';
import { preserveProgress } from './wrap-up.js';

/** What {@link runWrapUp} runs the wrap-up over, each as `start()` settled it. */
export interface WrapUpRunInput {
  /** The run's session record: told the wrap-up started, and that the run finished. */
  readonly session: Pick<RunSession, 'wrapUpStarted' | 'finished'>;
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
  const release = prepareReleaseStage({
    repoRoot,
    checkout,
    settings,
    planStub,
    planContent,
  });
  await preserveProgress(planContent, settingSources, release, serving, wrapUpLearning, checkout);
  // The loop guard before the loop's own release commit, against the
  // HEAD the wrap-up session's commits left on the run's branch: a
  // moved branch or a gone checkout skips the commit, push and wait.
  if (haltIfWrapUpMoved({ expected: expectWrapUpCommits(expected), before: 'release' })) return;
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
  await finishRelease(
    { repoRoot: checkout, settings, preparation: release },
    {
      readProvider: () => resolvePrProvider({
        configured: settings.prProvider ?? null,
        dir: checkout,
      }),
    },
  );
  if (ciWait) {
    await verifyPullRequest(
      Math.max(1, ciTimeoutMin) * 60_000,
      Math.max(0, ciAttempts),
      settingSources,
      // The gate takes its own path when this reads `none`: the
      // branch pushed, the compare URL printed and no CI wait
      // (`start/pr-lifecycle.ts`). The reading is made here
      // because the run's `pr.provider` lives in this config.
      {
        ...prLifecycleSeamsIn(checkout),
        readProvider: () => resolvePrProvider({
          configured: settings.prProvider ?? null,
          dir: checkout,
        }),
        // A refused push reads this device's store id from the
        // project root, where the store lives, not the checkout.
        readRefusedPush: refusedPushReaderIn(checkout, () => readDeviceStoreId(repoRoot, settings)),
      },
    );
  }
  session.finished();
}
