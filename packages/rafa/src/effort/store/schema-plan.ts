/**
 * The compatibility decision: whether this rafa may use a store, given
 * the named migrations the store holds and the ones this build knows.
 *
 * {@link planSchema} is a pure function over plain values. It imports
 * nothing from `bun:sqlite` or `sqlite.ts`, so the decision never
 * depends on the backend that holds the store. The caller reads the
 * store's migration log and `user_version` and passes them in. It
 * answers either "use", with what an open has to adopt and apply and
 * the `user_version` the store ends at, or "refuse", with one of the
 * seven {@link RefusalReason}s.
 *
 * ## How it decides
 *
 * A store with no log is a store a release before the log wrote, and
 * its `user_version` counts the legacy entries it holds. From 1 to
 * {@link LEGACY_GATE_OPEN} it is adopted: those entries are recorded
 * with this build's checksums, which match what ran because a shipped
 * entry is frozen. A version of 0 is a fresh store. Anything else was
 * written by no released rafa.
 *
 * A store with a log is judged from the log, never from a number. A
 * logged id this build knows must carry the checksum this build holds.
 * A logged id this build does not know is read by its `breaks`:
 * nothing lets this rafa use the store as it is; `writers` lets it
 * read and refuses a write; `readers`, or a word this rafa does not
 * know, refuses the store. An open that has migrations to apply writes
 * the store, whatever its caller asked for, so it counts as a write
 * here too.
 *
 * A pending migration this build knows is applied late when it is
 * additive, which is how two branches that each append one merge in
 * either order. A pending breaking migration applies only in order,
 * and only through `rafa effort migrate`.
 *
 * The seven rows are tried in {@link REFUSAL_REASONS} order and the
 * first that matches decides. Every refusal's message ends with its
 * {@link SchemaRefusal.nextStep}, the one command to run next.
 */
import type { MigrationSpec, SqliteMigration } from './migrations.js';

import { LEGACY_GATE_CLOSED, LEGACY_GATE_OPEN, legacyGate, migrationChecksum } from './migrations.js';

/** Whether an open reads the store only, or also writes it. */
export type StoreAccess = 'read' | 'write';

/** Who asks: an ordinary open, or `rafa effort migrate`. */
export type SchemaCaller = 'open' | 'migrate';

/** A migration this build knows, with the checksum of its body. */
export interface CatalogueEntry extends MigrationSpec {
  /** Lowercase sha256 hex of the body the backend runs. */
  readonly sha256: string;
}

/** One row of a store's migration log, as the caller read it. */
export interface LoggedMigration {
  readonly id: string;
  readonly sha256: string;
  /** The words recorded, which may include one this rafa does not know. */
  readonly breaks: readonly string[];
  readonly appliedAt: string;
  readonly appliedBy: string;
}

/** What the caller read from the store before any write. */
export interface StoreSchema {
  /** The store's path, as every refusal names it. */
  readonly path: string;
  /** `PRAGMA user_version`: the legacy gate, or a pre-log store's count. */
  readonly userVersion: number;
  /** The migration log in apply order, or null when the store has none. */
  readonly log: readonly LoggedMigration[] | null;
}

/** The seven reasons a store is refused, in the order they are tried. */
export const REFUSAL_REASONS = [
  'pre-log-unreleased',
  'gate-mismatch',
  'edited',
  'unknown-breaks-readers',
  'unknown-breaks-writers',
  'breaking-out-of-order',
  'breaking-pending',
] as const;

/** Why this rafa refuses a store. */
export type RefusalReason = typeof REFUSAL_REASONS[number];

/** This rafa may use the store once it has adopted and applied what is listed. */
export interface SchemaUse {
  readonly verdict: 'use';
  /** Legacy entries a log-less store holds, to be logged without running. */
  readonly adopted: readonly CatalogueEntry[];
  /** Entries to apply, in catalogue order. */
  readonly pending: readonly CatalogueEntry[];
  /** Logged migrations this build does not know; each is additive, or breaks writers only on a read. */
  readonly unknown: readonly LoggedMigration[];
  /** The `user_version` the store holds once everything listed is applied. */
  readonly gate: number;
}

/** This rafa refuses the store, and says why and what to run next. */
export interface SchemaRefusal {
  readonly verdict: 'refuse';
  readonly reason: RefusalReason;
  /** The refusal text, ending with `Next safe step: <nextStep>`. */
  readonly message: string;
  /** The one command to run next. */
  readonly nextStep: string;
}

/** What {@link planSchema} answers. */
export type SchemaPlan = SchemaUse | SchemaRefusal;

/** The way out of a refusal only a rebuild at this rafa's migrations repairs. */
const FIX_SCHEMA_STEP = 'rafa effort fix-schema --dry-run';

/** A migration's SQL entries with the checksums {@link planSchema} compares. */
export function sqliteCatalogue(migrations: readonly SqliteMigration[]): readonly CatalogueEntry[] {
  return migrations.map(({ sql, ...spec }) => ({ ...spec, sha256: migrationChecksum({ sql }) }));
}

/**
 * Decide whether this rafa may use `store` with this build's
 * `catalogue`, for an open with `access` from `caller`. The module note
 * says how.
 */
export function planSchema(
  store: StoreSchema,
  catalogue: readonly CatalogueEntry[],
  access: StoreAccess,
  caller: SchemaCaller,
): SchemaPlan {
  const { path, userVersion, log } = store;
  if (log === null && (userVersion < 0 || userVersion > LEGACY_GATE_OPEN)) {
    return refuse('pre-log-unreleased', FIX_SCHEMA_STEP, `effort store: ${path} is at schema version`
      + ` ${String(userVersion)} with no migration log; no released rafa wrote that.`
      + ' Refusing to read or write it.');
  }
  if (log !== null && userVersion !== LEGACY_GATE_OPEN && userVersion !== LEGACY_GATE_CLOSED) {
    return refuse('gate-mismatch', FIX_SCHEMA_STEP, `effort store: ${path} has a migration log and`
      + ` schema version ${String(userVersion)}; a build older than the log migrated it after the`
      + ' log was made. Refusing to read or write it.');
  }

  const adopted = log === null
    ? adoptedEntries(catalogue, userVersion)
    : [];
  const held = log ?? [];
  const logRefusal = judgeLog(path, held, catalogue);
  if (logRefusal !== null) return logRefusal;

  const heldIds = new Set([...adopted, ...held].map(({ id }) => id));
  const pending = catalogue.filter(({ id }) => !heldIds.has(id));
  const unknown = held.filter(({ id }) => !catalogue.some((entry) => entry.id === id));
  const writes = access === 'write' || pending.length > 0;
  const writersBroken = unknown.find(({ breaks }) => breaks.includes('writers'));
  if (writes && writersBroken !== undefined) {
    return refuseUnknown('unknown-breaks-writers', path, writersBroken);
  }

  const orderRefusal = judgePending(path, catalogue, heldIds, pending, caller);
  if (orderRefusal !== null) return orderRefusal;

  return {
    verdict: 'use',
    adopted,
    pending,
    unknown,
    gate: legacyGate([...adopted, ...held, ...pending]),
  };
}

/** The first `count` entries, which a log-less store at that version holds. */
function adoptedEntries(catalogue: readonly CatalogueEntry[], count: number): readonly CatalogueEntry[] {
  const adopted = catalogue.slice(0, count);
  if (adopted.length < count) {
    throw new Error(`schema plan: the catalogue holds ${String(catalogue.length)} migrations,`
      + ` fewer than the ${String(count)} legacy entries a store at that version holds`);
  }
  return adopted;
}

/**
 * The `edited` refusal for the first logged id whose checksum differs,
 * then the `unknown-breaks-readers` refusal for the first unknown row
 * that breaks readers or names a word this rafa does not know.
 */
function judgeLog(
  path: string,
  log: readonly LoggedMigration[],
  catalogue: readonly CatalogueEntry[],
): SchemaRefusal | null {
  const byId = new Map(catalogue.map((entry) => [entry.id, entry]));
  for (const row of log) {
    const known = byId.get(row.id);
    if (known !== undefined && known.sha256 !== row.sha256) {
      return refuse('edited', FIX_SCHEMA_STEP, `effort store: ${path} recorded migration ${row.id}`
        + ` as sha256 ${row.sha256}, and this rafa holds it as ${known.sha256}; one was edited`
        + ' after it ran. Refusing to read or write the store.');
    }
  }

  // `readers`, or any word but the two this rafa knows, breaks readers.
  const readersBroken = log.find(({ id, breaks }) => (
    !byId.has(id) && breaks.some((word) => word !== 'writers')
  ));
  return readersBroken === undefined
    ? null
    : refuseUnknown('unknown-breaks-readers', path, readersBroken);
}

/**
 * The `breaking-out-of-order` refusal for the first pending breaking
 * entry that sorts before an applied one, then the `breaking-pending`
 * refusal for the first pending breaking entry on an ordinary open.
 */
function judgePending(
  path: string,
  catalogue: readonly CatalogueEntry[],
  heldIds: ReadonlySet<string>,
  pending: readonly CatalogueEntry[],
  caller: SchemaCaller,
): SchemaRefusal | null {
  const breaking = pending.filter(({ breaks }) => breaks.length > 0);
  for (const entry of breaking) {
    const later = catalogue
      .slice(catalogue.indexOf(entry) + 1)
      .find(({ id }) => heldIds.has(id));
    if (later !== undefined) {
      return refuse('breaking-out-of-order', 'rafa effort schema', `effort store: ${path} needs`
        + ` migration ${entry.id} ahead of ${later.id}, which is already applied; a migration that`
        + ' breaks older runtimes applies only in order. Refusing to read or write the store.');
    }
  }

  const [first] = breaking;
  if (first === undefined || caller === 'migrate') return null;

  return refuse('breaking-pending', 'rafa effort migrate --dry-run', `effort store: ${path} needs`
    + ` migration ${first.id}, which breaks older runtimes and is applied only by`
    + ' \'rafa effort migrate\'; refusing to read or write the store until then.');
}

/** The refusal for an unknown logged migration that breaks what this open does. */
function refuseUnknown(
  reason: 'unknown-breaks-readers' | 'unknown-breaks-writers',
  path: string,
  row: LoggedMigration,
): SchemaRefusal {
  const ending = reason === 'unknown-breaks-readers'
    ? 'which breaks older readers; refusing to read or write it.'
    : 'which breaks older writers; refusing to write it.';
  return refuse(reason, `install a rafa that knows ${row.id}, or ${FIX_SCHEMA_STEP}`, 'effort store:'
    + ` ${path} holds migration ${row.id} (applied by ${row.appliedBy} on ${dateOf(row.appliedAt)}),`
    + ` which this rafa does not know and ${ending}`);
}

/** The calendar date of an ISO timestamp, or the stored text when it is not one. */
function dateOf(appliedAt: string): string {
  return /^\d{4}-\d{2}-\d{2}/.test(appliedAt)
    ? appliedAt.slice(0, 10)
    : appliedAt;
}

/** A refusal whose message is `text`, then its way out. */
function refuse(reason: RefusalReason, nextStep: string, text: string): SchemaRefusal {
  return { verdict: 'refuse', reason, message: `${text} Next safe step: ${nextStep}`, nextStep };
}
