/**
 * The degradation chain: which tracker a run files through. The kinds
 * the config names are tried in order through the adapter registry, and
 * every one passed over is reported.
 *
 * Copied from `resolveTracker` in open-tomato's
 * `packages/shared/issue-tracker/src/resolve.ts` at commit
 * `47abf440a9748aa6cec1c64bf91b210c5444bbab` (2026-07-28). The copy is
 * retyped against rafa's `Tracker` port and makes each adapter through
 * `src/adapters/registry.ts`.
 *
 * ## Never silent
 *
 * The source's rule is kept as it was written: falling back is never
 * silent. Every failed attempt is logged, and it is folded into a
 * `fallbackReason` that travels with the tracker the chain lands on.
 * Silent degradation is what produced the loose-markdown problem the
 * source's harness replaced.
 *
 * ## The order
 *
 * `tracker.default` is tried first, then each kind in `tracker.fallback`
 * in the order written. A kind named twice is tried once, at the first
 * place it is named. The config names one that way whenever a project
 * sets `tracker.default: local` and leaves `tracker.fallback` at its
 * default, `[local]`. A second attempt would ask the same adapter the
 * same question in the same run and record its failure twice.
 *
 * ## One attempt
 *
 * An attempt resolves the kind's adapter, makes the tracker and runs its
 * preflight. The attempt lands when the preflight answers ok, and the
 * chain stops there: no kind after it is made. The attempt fails, with a
 * reason, in any of these cases:
 *
 *   - The registry holds no tracker adapter under the kind. The reason is
 *     the registry's refusal, which names the kinds it does hold. This
 *     covers a kind written for an add-on that is not registered, such as
 *     `linear`.
 *   - Making the tracker throws. The reason is the thrown message, or the
 *     thrown value as a string when it is not an `Error`.
 *   - The preflight answers not ok. The reason is the preflight's own.
 *   - The preflight rejects. The reason is `preflight rejected: ` followed
 *     by the rejection's message.
 *
 * Each failure is logged as `tracker chain: <kind> unavailable:
 * <reason>`, before the next kind is tried. It is recorded as
 * `<kind>: <reason>` and joined to the earlier ones with `; `.
 *
 * ## The reason handed over
 *
 * Every tracker is made with `fallbackReason` in its context. The value
 * is the failures joined so far, or null when none has failed. The
 * tracker the chain lands on is therefore made with exactly the reason
 * the resolution answers. A tracker whose preflight then fails is
 * dropped along with the reason it was made with. Of core's adapters,
 * `local` alone reads the reason and records it in each issue it
 * creates. The resolution answers the same reason, so a caller landing
 * on any other tracker can still surface it.
 *
 * When every kind fails, the chain rejects with an `Error` listing each
 * failure. By then every failure has already been logged.
 *
 * ## What the copy changes
 *
 *   - Adapters. The source took one factory per kind of a closed
 *     `TrackerKind`. The copy resolves each kind through an
 *     {@link AdapterRegistry}, `CORE_ADAPTER_REGISTRY` when none is
 *     named. An add-on kind is tried the same way as a core one, and a
 *     kind with no adapter is a failed attempt rather than a type error.
 *   - Order. The source took the order as a list its caller built. The
 *     copy reads it off the config's `trackerDefault` and
 *     `trackerFallback`, and tries a repeated kind once.
 *   - The reason handed over. The source's factories took nothing, so
 *     the reason reached a tracker only through the caller. The copy
 *     makes each tracker with the reason in its context.
 *   - A rejecting preflight. The source let it reject the whole chain;
 *     the copy counts it as a failed attempt. The port says a preflight
 *     never throws, but an add-on's is the first code the chain runs
 *     that core did not write.
 *   - Reporting. `log` defaults to the active output's `warn`
 *     (`src/adapters/output/active.ts`), read when the report is made,
 *     as the `local` adapter's `warn` is. The source's log line opened
 *     with `[issue-tracker]` and held an em dash; the copy's opens with
 *     `tracker chain:`, as the refusal does.
 *   - Names. `Resolution` is {@link TrackerResolution}, `AttemptLog` is
 *     {@link TrackerAttempt}, and `ResolveOptions` is
 *     {@link ResolveTrackerOptions}. The resolution and its attempts are
 *     frozen, as the trackers are.
 */
import type { RafaConfig } from '../../config.js';
import type { PreflightResult, Tracker, TrackerKind } from '../../ports/index.js';
import type { AdapterContext, AdapterRegistry } from '../registry.js';

import { messageOf } from '../../config-sections.js';
import { activeOutput } from '../output/active.js';
import { CORE_ADAPTER_REGISTRY } from '../registry.js';

/** What every report and refusal opens with. */
const PREFIX = 'tracker chain';

/** What joins one recorded failure to the next. */
const FAILURE_SEPARATOR = '; ';

/** One kind the chain tried, and why it was passed over. */
export interface TrackerAttempt {
  readonly kind: TrackerKind;
  /** True for the attempt the chain landed on, which is always the last one. */
  readonly ok: boolean;
  /** Why the kind was passed over, or null for the one landed on. */
  readonly reason: string | null;
}

/** The tracker the chain landed on, and how it got there. */
export interface TrackerResolution {
  readonly tracker: Tracker;
  /** True when the tracker landed on was not the first kind tried. */
  readonly degraded: boolean;
  /**
   * The failures before the one landed on, as `<kind>: <reason>` joined
   * with `; `, or null when the first kind landed. The tracker was made
   * with this same reason.
   */
  readonly fallbackReason: string | null;
  /** One per kind tried, in order, the one landed on last. */
  readonly attempts: readonly TrackerAttempt[];
}

/** What the chain is resolved with. */
export interface ResolveTrackerOptions {
  /** `tracker.default` and `tracker.fallback`, as the resolved config holds them. */
  readonly config: Pick<RafaConfig, 'trackerDefault' | 'trackerFallback'>;
  /**
   * What every tracker tried is made with. The chain sets the
   * `fallbackReason` itself.
   */
  readonly context: Omit<AdapterContext, 'fallbackReason'>;
  /** Where each kind's adapter is resolved. `CORE_ADAPTER_REGISTRY` when left out. */
  readonly registry?: AdapterRegistry;
  /** Reports each failed attempt. The active output's `warn` when left out. */
  readonly log?: (message: string) => void;
}

/** One attempt's outcome: the tracker it landed on, or why it failed. */
type AttemptOutcome =
  | { readonly ok: true; readonly tracker: Tracker }
  | { readonly ok: false; readonly reason: string };

/** Reports through the output active when the report is made. */
function warnThroughActiveOutput(message: string): void {
  activeOutput().warn(message);
}

/** `tracker.default`, then each `tracker.fallback` kind, each kind once, first place named. */
function trackerOrder(config: ResolveTrackerOptions['config']): readonly TrackerKind[] {
  return [...new Set([config.trackerDefault, ...config.trackerFallback])];
}

/** Resolves, makes and preflights one kind; see the module note. */
async function attempt(
  registry: AdapterRegistry,
  kind: TrackerKind,
  context: AdapterContext,
): Promise<AttemptOutcome> {
  let tracker: Tracker;
  try {
    tracker = registry.resolve('tracker', kind).create(context);
  } catch (error) {
    return { ok: false, reason: messageOf(error) };
  }

  let preflight: PreflightResult;
  try {
    preflight = await tracker.preflight();
  } catch (error) {
    return { ok: false, reason: `preflight rejected: ${messageOf(error)}` };
  }
  return preflight.ok
    ? { ok: true, tracker }
    : { ok: false, reason: preflight.reason };
}

/**
 * Lands on the first kind whose tracker passes its preflight, trying
 * `tracker.default` and then each `tracker.fallback` kind. Each failed
 * attempt is logged, and the joined failures are handed to the tracker
 * landed on as its `fallbackReason`; see the module note.
 *
 * Rejects, after logging every failure, when no kind lands.
 */
export async function resolveTracker(options: ResolveTrackerOptions): Promise<TrackerResolution> {
  const registry = options.registry ?? CORE_ADAPTER_REGISTRY;
  const log = options.log ?? warnThroughActiveOutput;
  let attempts: readonly TrackerAttempt[] = [];
  let failures: readonly string[] = [];

  for (const kind of trackerOrder(options.config)) {
    const fallbackReason = failures.length === 0
      ? null
      : failures.join(FAILURE_SEPARATOR);
    const outcome = await attempt(registry, kind, { ...options.context, fallbackReason });

    if (outcome.ok) {
      return Object.freeze({
        tracker: outcome.tracker,
        degraded: failures.length > 0,
        fallbackReason,
        attempts: Object.freeze([...attempts, Object.freeze({ kind, ok: true, reason: null })]),
      });
    }

    attempts = [...attempts, Object.freeze({ kind, ok: false, reason: outcome.reason })];
    failures = [...failures, `${kind}: ${outcome.reason}`];
    log(`${PREFIX}: ${kind} unavailable: ${outcome.reason}`);
  }

  throw new Error(`${PREFIX}: no tracker available; tried ${failures.join(FAILURE_SEPARATOR)}`);
}
