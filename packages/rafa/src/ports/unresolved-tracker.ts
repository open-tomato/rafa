/**
 * A stand-in for a {@link Tracker} the run did not resolve.
 *
 * `src/start/triage.ts` hands it to `triageReport` for a report whose bugs
 * are all security bugs, which meet no public tracker, and for a tracker
 * chain that landed nowhere, so each public bug fails with the chain's own
 * refusal; `packages/rafa-board/src/commands/epic/close-triage.ts` uses it for the second case.
 * It sits beside the port it implements so that both take it from core.
 */

import type { Tracker, TrackerKind } from './index.js';

/**
 * A tracker standing in for one the run did not resolve: its preflight
 * answers `reason`, and every other call rejects with it. See the module
 * note.
 */
export function unresolvedTracker(kind: TrackerKind, reason: string): Tracker {
  const refuse = (): Promise<never> => Promise.reject(new Error(reason));
  return Object.freeze({
    kind,
    capabilities: () => ({ projects: false, customFields: false, issueTypes: false }),
    preflight: () => Promise.resolve({ ok: false as const, reason }),
    find: refuse,
    get: refuse,
    create: refuse,
    comment: refuse,
    transition: refuse,
  });
}
