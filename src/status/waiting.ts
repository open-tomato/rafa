/**
 * The pull request a hop left waiting on its owner's review, as the
 * place line of `rafa status` reads it (`./sections.ts`, its module note
 * holds when a pull request waits). The hop record names the pull
 * request; it waits while the record is `waiting`, the position is the
 * one the record was written from, and the pull request is open with an
 * owner gate that lets no merge through. A read that fails is `unknown`,
 * never approved.
 */
import type { PullRequests } from '../pr/index.js';
import type { OwnerApproval } from '../pr/owner-approval.js';

import { messageOf } from '../config-sections.js';
import { readHopRecord, staleAgainst } from '../next/hop-record.js';
import { readPositionFile } from '../project/position.js';

/** The owner gate states that let no merge through, and so leave a pull request waiting. */
export type WaitingGate = Exclude<OwnerApproval['state'], 'approved' | 'not-gated'>;

/** A hop's pull request still open and waiting on its owner's review; see the module note. */
export interface WaitingReading {
  /** C, the hop record's target, or the pull request's own number on a record naming none. */
  readonly issue: number;
  /** The pull request the hop record names. */
  readonly pullRequest: number;
  /** What the owner gate answered, `unknown` for a reading that failed. */
  readonly gate: WaitingGate;
  /** Why it is not approved, in the gate's words or the failure's. */
  readonly reason: string;
}

/** What the waiting pull request is read through. */
export interface WaitingSources {
  readonly root: string;
  /** The provider over the bounded runner, a waiting pull request read through it. */
  readonly pulls: Pick<PullRequests, 'get'>;
  /** The owner gate, opened only once a waiting pull request is read open. */
  readonly ownerGate: () => (pullRequest: number) => Promise<OwnerApproval>;
}

/** No waiting line, and nothing read around. */
const NOT_WAITING: { readonly waiting: null; readonly notes: readonly string[] } = { waiting: null, notes: [] };

/** `#<n>`. */
function ref(number: number): string {
  return `#${String(number)}`;
}

/** The gate for `pullRequest`, a rejection read as `unknown`; never approved on a failure. */
async function readGate(sources: WaitingSources, pullRequest: number): Promise<OwnerApproval> {
  try {
    return await sources.ownerGate()(pullRequest);
  } catch (error) {
    return { state: 'unknown', reason: `could not read the owner gate of ${ref(pullRequest)}: ${messageOf(error)}`, owners: [] };
  }
}

/**
 * The owner gate of `pullRequest` while it is still open, or null once it
 * merged, closed or is absent. A pull request that could not be read is
 * `unknown`, the failure its reason.
 */
async function openPullGate(sources: WaitingSources, pullRequest: number): Promise<OwnerApproval | null> {
  let detail: Awaited<ReturnType<PullRequests['get']>>;
  try {
    detail = await sources.pulls.get(pullRequest);
  } catch (error) {
    return { state: 'unknown', reason: `could not read pull request ${ref(pullRequest)}: ${messageOf(error)}`, owners: [] };
  }
  return detail?.state === 'open'
    ? readGate(sources, pullRequest)
    : null;
}

/** The pull request a hop left waiting on its owner's review, or null; see the module note. */
export async function readWaiting(sources: WaitingSources): Promise<{ readonly waiting: WaitingReading | null; readonly notes: readonly string[] }> {
  const hop = readHopRecord(sources.root);
  if (!hop.set) {
    return hop.reason === 'absent'
      ? NOT_WAITING
      : { waiting: null, notes: [`${hop.detail}, so no waiting pull request is read`] };
  }
  const { record } = hop;
  const { pullRequest } = record;
  if (record.state !== 'waiting' || pullRequest === null) return NOT_WAITING;
  const placed = readPositionFile(sources.root);
  if (!placed.set || staleAgainst(record, placed.position)) return NOT_WAITING;

  const gate = await openPullGate(sources, pullRequest);
  if (gate === null || gate.state === 'approved' || gate.state === 'not-gated') return NOT_WAITING;
  const waiting: WaitingReading = { issue: record.target ?? pullRequest, pullRequest, gate: gate.state, reason: gate.reason };
  return { waiting, notes: [] };
}
