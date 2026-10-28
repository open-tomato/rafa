/**
 * One preflight check as the runner answers it and the store records it:
 * its tier, its item, its outcome, how long it took and what failed.
 * `packages/rafa/src/preflight/run.ts` checks every item and re-exports these types for
 * its importers; the store's preflight writer (`./preflight.ts`) keys its
 * CHECKs by them.
 *
 * They sit in core so the store reads a check without importing the
 * `preflight` module above it.
 */
import type { PrerequisiteItem } from '../../core/config/index.js';

/** The tier an item was configured on. */
export type PreflightTier = 'required' | 'optional';

/** How one check went: `timeout` is a failure that ran out of time. */
export type CheckOutcome = 'pass' | 'fail' | 'timeout';

/** One item, checked. */
export interface PreflightCheck {
  readonly tier: PreflightTier;
  readonly item: PrerequisiteItem;
  readonly outcome: CheckOutcome;
  /** How long the check took, in whole milliseconds. */
  readonly durationMs: number;
  /** What failed, as the halt and the warning word it; null for a pass. */
  readonly failure: string | null;
}
