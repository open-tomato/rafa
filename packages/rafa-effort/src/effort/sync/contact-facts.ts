/**
 * What a hub contact (`contact.ts` beside this file) reads off the
 * selected `Sync`'s answers by shape, and the skew check a `sync()` run
 * makes over the hub's status. Every reader answers a fact it cannot
 * read as unknown (null) rather than throwing, since core's `Sync` port
 * names none of these answers. `contact.ts` re-exports the readers a
 * caller uses, and its module note is the authority for what each means.
 */
import type { HubFacts, HubLineFacts, HubRefusal, HubSyncStatus } from './contact-readings.js';
import type { Sync, SyncPullResult, SyncPushResult } from '@open-tomato/rafa/ports';

import { WIRE_CONTRACT_VERSION } from '@open-tomato/rafa/store';
import { SQLITE_MIGRATIONS } from '@open-tomato/rafa/store/migrations';

/** What every line a contact writes opens with. */
export const OPENING = 'effort sync';

/** The next step a line names when the hub is ahead of this rafa. */
const SELF_UPDATE = 'rafa self-update';

/** The migration ids this rafa knows, core's catalogue, in its order: the ones a store it builds logs. */
export const KNOWN_MIGRATIONS: readonly string[] = Object.freeze(SQLITE_MIGRATIONS.map(({ id }) => id));

/** `value` when it is a string holding anything, else null. */
function textOf(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== ''
    ? value
    : null;
}

/**
 * The hub's facts a `hubStatus()` answer carries, read by shape: each
 * field of another type, and every field of an answer that is no
 * object, null. See `contact.ts`'s module note, `The hub line`.
 */
export function hubFactsOf(answer: unknown): HubFacts {
  const fields: Readonly<Record<string, unknown>> = typeof answer === 'object' && answer !== null
    ? answer as Readonly<Record<string, unknown>>
    : {};
  const { contractVersion } = fields;
  return Object.freeze({
    contractVersion: typeof contractVersion === 'number' && Number.isInteger(contractVersion)
      ? contractVersion
      : null,
    projectId: textOf(fields.projectId),
    projectName: textOf(fields.projectName),
  });
}

/** The rows a pull's merge added and held back; both 0 for a pull with nothing to merge. */
export function pulledOf(result: SyncPullResult): Pick<HubLineFacts, 'pulled' | 'heldBack'> {
  return result.status === 'pulled'
    ? { pulled: result.merge.rowsAdded, heldBack: result.merge.rowsHeld }
    : { pulled: 0, heldBack: 0 };
}

/** `value` when it is a whole number of rows, else null. */
export function countOf(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
    ? value
    : null;
}

/** The selected `Sync`'s method `name`, read by shape and called with the strategy as `this`, or null when it has none. */
export function memberOf(sync: Sync, name: 'hubStatus' | 'pendingPush'): (() => Promise<unknown>) | null {
  const member = (sync as unknown as Readonly<Record<string, unknown>>)[name];
  if (typeof member !== 'function') return null;
  const ask = member as (this: Sync) => unknown;
  return () => Promise.resolve(ask.call(sync));
}

/**
 * The most rows the hub takes in one push payload and answers in one
 * pull page, read by shape off a `hubStatus()` answer's
 * `maxPayloadRows`: a whole number above zero, or null, no cap, for an
 * answer naming none or anything else. See `contact.ts`'s module note,
 * `The payload cap`.
 */
export function capOf(answer: unknown): number | null {
  const { maxPayloadRows } = typeof answer === 'object' && answer !== null
    ? answer as { readonly maxPayloadRows?: unknown }
    : {};
  const cap = countOf(maxPayloadRows);
  return cap === 0
    ? null
    : cap;
}

/** The rows a `pulled` answer's page carried, read by shape off its `rows`; null for an answer counting none. */
export function pageRowsOf(result: SyncPullResult): number | null {
  if (result.status !== 'pulled') return null;
  return countOf((result as { readonly rows?: unknown }).rows);
}

/** The migration ids a `hubStatus()` answer names, or null when it names no list of ids. */
function migrationsOf(answer: unknown): readonly string[] | null {
  const { migrations } = typeof answer === 'object' && answer !== null
    ? answer as { readonly migrations?: unknown }
    : {};
  return Array.isArray(migrations) && migrations.every((id) => textOf(id) !== null)
    ? Object.freeze([...migrations as readonly string[]])
    : null;
}

/** What a `sync()` run's status read answered, read by shape as {@link hubFactsOf} reads it. */
export function hubSyncStatusOf(answer: unknown): HubSyncStatus {
  return Object.freeze({ ...hubFactsOf(answer), migrations: migrationsOf(answer) });
}

/** The rows a dry-run push counted, by shape: 0 for a push with no store to read, null for an answer counting none. */
export function dryRunRowsOf(result: SyncPushResult): number | null {
  if (result.status === 'nothing-to-sync') return 0;
  const { dryRun, rows } = result as { readonly dryRun?: unknown; readonly rows?: unknown };
  return dryRun === true
    ? countOf(rows)
    : null;
}

/** The rows a pull's merge found in conflict; 0 for a pull with nothing to merge. */
export function conflictsOf(result: SyncPullResult): number {
  return result.status === 'pulled'
    ? result.merge.rowsInConflict
    : 0;
}

/** What the skew check reads: the hub's status and this rafa's own side. */
export interface SkewCheckInput {
  /** What the status read answered. */
  readonly status: HubSyncStatus;
  /** The migration ids this rafa knows. */
  readonly migrations: readonly string[];
  /** The resolved `effort.syncSkew`. */
  readonly syncSkew: string;
  /** The hub the config names, which the contract line names when this rafa is ahead of the hub. */
  readonly hubUrl: string | null;
}

/** The next step a contract mismatch names: a self-update when the hub is ahead, upgrading the hub when this rafa is. */
function contractStep(hubVersion: number, hubUrl: string | null): string {
  const hub = hubUrl === null
    ? 'the hub'
    : `the hub at ${hubUrl}`;
  return hubVersion > WIRE_CONTRACT_VERSION
    ? SELF_UPDATE
    : `upgrade ${hub} to a rafa-hub that speaks this rafa's contract`;
}

/**
 * A `sync()` run's second step: the refusal its status read shows, or
 * null when it shows none. A hub speaking another contract is refused
 * first; then a hub lacking a migration this rafa knows, then a hub
 * holding one this rafa lacks, the last only under `effort.syncSkew:
 * refuse`. A fact the status answered none of is not checked. See
 * `contact.ts`'s module note, `The sync`.
 */
export function skewCheck(input: SkewCheckInput): HubRefusal | null {
  const { contractVersion, migrations: held } = input.status;
  if (contractVersion !== null && contractVersion !== WIRE_CONTRACT_VERSION) {
    const line = `${OPENING}: the hub speaks contract ${String(contractVersion)}, this rafa contract ${String(WIRE_CONTRACT_VERSION)};`
      + ` nothing was sent. Next step: ${contractStep(contractVersion, input.hubUrl)}`;
    return Object.freeze({ cause: 'contract', line });
  }
  if (held === null) return null;
  const hubLacks = input.migrations.filter((id) => !held.includes(id));
  if (hubLacks.length > 0) {
    const line = `${OPENING}: the hub is behind this rafa (migration ${hubLacks.join(', ')}); nothing was sent.`
      + ' Next step: upgrade the hub, then rafa effort sync';
    return Object.freeze({ cause: 'skew', line });
  }
  const rafaLacks = held.filter((id) => !input.migrations.includes(id));
  if (rafaLacks.length === 0 || input.syncSkew === 'pull-projected') return null;
  const line = `${OPENING}: this rafa is behind the hub (migration ${rafaLacks.join(', ')}); nothing was merged.`
    + ` Next step: ${SELF_UPDATE}, then rafa effort sync`;
  return Object.freeze({ cause: 'skew', line });
}
