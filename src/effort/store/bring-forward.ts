/**
 * The log-aware open: bring a SQLite store to this build's migrations,
 * recording each one in the store's migration log, or refuse it.
 *
 * ## The migration log
 *
 * `schema_migrations` holds one row per migration the store holds: its
 * id, the sha256 of its SQL, what it `breaks` as a JSON array of words,
 * when it was applied and by which rafa. {@link bringForward} creates the
 * table in the same transaction as the rows it first records, so a store
 * never holds an empty log it was not given in that transaction.
 *
 * ## What an open does
 *
 * {@link bringForward} reads the log and `user_version`, and hands them
 * to `planSchema` (`schema-plan.ts`), which decides. A refusal is thrown
 * as a {@link SchemaRefusedError} carrying the plan's reason, message and
 * next step, and nothing is written. A plan with nothing to adopt or
 * apply returns at once, taking no lock and writing nothing, so a read
 * open of a current store never writes.
 *
 * Otherwise the open takes the write lock with `BEGIN IMMEDIATE`, reads
 * the store again and plans again, since another process may have
 * brought the store forward, or recorded a migration this build does
 * not know, while this one waited. Under that second plan, and in one
 * transaction, it:
 *
 *   - creates `schema_migrations` when the store has none;
 *   - adopts a store with no log: the legacy entries its `user_version`
 *     counts are logged with this build's checksums and not run, since
 *     a shipped entry is frozen and so is what ran;
 *   - runs each pending migration's SQL and logs it, in catalogue order;
 *   - sets `user_version` to the gate the plan answers.
 *
 * A throw anywhere rolls all of it back, `user_version` included, and
 * leaves the store as it was found. The second plan can find nothing
 * left to do, which is the answer when another process applied the same
 * migrations first; the transaction then writes nothing.
 *
 * A store with a log and nothing pending keeps the `user_version` it
 * holds, even when its log would give another gate: only a transaction
 * that records a migration moves the gate.
 *
 * ## A development build never migrates the live store
 *
 * Between the first plan and the lock, an open with something to write
 * asks `refuseUnownedDevelopmentWrite` (`development-build.ts`), which
 * throws a `DevelopmentBuildRefusedError` when this rafa is a
 * development build and the store lies outside the temporary directory
 * and `RAFA_EFFORT_DIR`. The refusal comes before the lock and before
 * any write, adoption included, so the store keeps its bytes. With
 * nothing to write the open returns before that question is asked, so
 * a development build uses a current store as any rafa does. That
 * module's note says which stores it owns and what the text names.
 *
 * ## What this module does not decide
 *
 * `planSchema` owns every refusal and its text. Which rafa counts as the
 * one applying a migration is the caller's to say through
 * {@link BringForwardOptions.appliedBy}; with none given it is this
 * build's package version.
 */
import type { DevelopmentProbe } from './development-build.js';
import type { SqliteMigration } from './migrations.js';
import type {
  CatalogueEntry,
  LoggedMigration,
  RefusalReason,
  SchemaCaller,
  SchemaRefusal,
  SchemaUse,
  StoreAccess,
  StoreSchema,
} from './schema-plan.js';
import type { Database } from 'bun:sqlite';

import { RAFA_VERSION } from '../../cli/version.js';

import { ADOPTION_NAME, refuseUnownedDevelopmentWrite } from './development-build.js';
import { SQLITE_MIGRATIONS } from './migrations.js';
import { planSchema, sqliteCatalogue } from './schema-plan.js';

/** The migration log's table. */
export const MIGRATION_LOG_TABLE = 'schema_migrations';

/** The migration log's DDL, as the spec gives it. */
const CREATE_MIGRATION_LOG = `
  CREATE TABLE IF NOT EXISTS ${MIGRATION_LOG_TABLE} (
    seq        INTEGER PRIMARY KEY,
    id         TEXT NOT NULL UNIQUE CHECK (id <> ''),
    sha256     TEXT NOT NULL CHECK (length(sha256) = 64),
    breaks     TEXT NOT NULL,
    applied_at TEXT NOT NULL,
    applied_by TEXT NOT NULL CHECK (applied_by <> '')
  );
`;

/** A store refused by `planSchema`, carrying the plan's answer. */
export class SchemaRefusedError extends Error {
  /** Which of the seven refusals this is. */
  readonly reason: RefusalReason;
  /** The one command to run next, which the message also ends with. */
  readonly nextStep: string;

  constructor(refusal: SchemaRefusal) {
    super(refusal.message);
    this.name = 'SchemaRefusedError';
    this.reason = refusal.reason;
    this.nextStep = refusal.nextStep;
  }
}

/**
 * What an open may vary; each field has the running build's default.
 * The {@link DevelopmentProbe} fields say which build runs and which
 * stores it owns (`development-build.ts`).
 */
export interface BringForwardOptions extends DevelopmentProbe {
  /** The catalogue to bring the store to; a test passes a synthetic tail here. */
  readonly migrations?: readonly SqliteMigration[];
  /** The `applied_by` of every row this open logs; this build's version by default. */
  readonly appliedBy?: string;
  /** The clock `applied_at` is read from. */
  readonly now?: () => Date;
}

/** What an open wrote. Both lists are empty when it wrote nothing. */
export interface BroughtForward {
  /** Legacy ids logged without running, in catalogue order. */
  readonly adopted: readonly string[];
  /** Ids whose SQL ran and was logged, in the order it ran. */
  readonly applied: readonly string[];
  /** The store's `user_version` once the open is done. */
  readonly userVersion: number;
}

/**
 * Bring the store open on `db` to this build's migrations for an open
 * with `access` from `caller`, or throw {@link SchemaRefusedError}.
 * `path` is what a refusal names the store as. The module note says
 * what is written, and when.
 */
export function bringForward(
  db: Database,
  path: string,
  access: StoreAccess,
  caller: SchemaCaller,
  options: BringForwardOptions = {},
): BroughtForward {
  const migrations = options.migrations ?? SQLITE_MIGRATIONS;
  const catalogue = sqliteCatalogue(migrations);
  const first = usablePlan(readStoreSchema(db, path), catalogue, access, caller);
  if (!hasWork(first)) return nothingWritten(db);
  refuseUnownedDevelopmentWrite(path, writeNames(first), options);

  const apply = db.transaction((): BroughtForward => {
    const store = readStoreSchema(db, path);
    const plan = usablePlan(store, catalogue, access, caller);
    if (!hasWork(plan)) return nothingWritten(db);

    const stamp = {
      appliedAt: (options.now ?? (() => new Date()))().toISOString(),
      appliedBy: options.appliedBy ?? RAFA_VERSION,
    };
    db.run(CREATE_MIGRATION_LOG);
    for (const entry of plan.adopted) logMigration(db, entry, stamp);
    for (const entry of plan.pending) {
      db.run(bodyOf(migrations, entry.id));
      logMigration(db, entry, stamp);
    }
    db.run(`PRAGMA user_version = ${String(plan.gate)}`);
    return {
      adopted: plan.adopted.map(({ id }) => id),
      applied: plan.pending.map(({ id }) => id),
      userVersion: plan.gate,
    };
  });
  return apply.immediate();
}

/**
 * The store's `user_version` and its migration log, or a null log when
 * it has no `schema_migrations` table. Reads only.
 */
export function readStoreSchema(db: Database, path: string): StoreSchema {
  return { path, userVersion: readUserVersion(db), log: readMigrationLog(db, path) };
}

/** The plan, or a throw carrying its refusal. */
function usablePlan(
  store: StoreSchema,
  catalogue: readonly CatalogueEntry[],
  access: StoreAccess,
  caller: SchemaCaller,
): SchemaUse {
  const plan = planSchema(store, catalogue, access, caller);
  if (plan.verdict === 'refuse') throw new SchemaRefusedError(plan);
  return plan;
}

/** Whether a plan leaves anything to adopt or apply. */
function hasWork(plan: SchemaUse): boolean {
  return plan.adopted.length > 0 || plan.pending.length > 0;
}

/**
 * What a plan's write would record: the log first when it adopts, then
 * each pending id. Empty when the plan writes nothing. `rafa effort
 * schema` names the same list when it asks the development-build
 * question an open would ask (`schema-report.ts`).
 */
export function writeNames(plan: SchemaUse): readonly string[] {
  const adoption = plan.adopted.length > 0
    ? [ADOPTION_NAME]
    : [];
  return [...adoption, ...plan.pending.map(({ id }) => id)];
}

/** The answer of an open that wrote nothing. */
function nothingWritten(db: Database): BroughtForward {
  return { adopted: [], applied: [], userVersion: readUserVersion(db) };
}

/** `PRAGMA user_version`, which a fresh database holds as 0. */
function readUserVersion(db: Database): number {
  const row = db
    .query<{ user_version: number }, []>('PRAGMA user_version')
    .get();
  return row?.user_version ?? 0;
}

/** A migration log row as SQLite hands it back. */
interface LogRow {
  readonly id: string;
  readonly sha256: string;
  readonly breaks: string;
  readonly applied_at: string;
  readonly applied_by: string;
}

/** The log in apply order, or null when the store has none. */
function readMigrationLog(db: Database, path: string): readonly LoggedMigration[] | null {
  const table = db
    .query<{ name: string }, [string]>('SELECT name FROM sqlite_master WHERE type = \'table\' AND name = ?')
    .get(MIGRATION_LOG_TABLE);
  if (table === null) return null;

  return db
    .query<LogRow, []>(`SELECT id, sha256, breaks, applied_at, applied_by FROM ${MIGRATION_LOG_TABLE} ORDER BY seq`)
    .all()
    .map((row) => ({
      id: row.id,
      sha256: row.sha256,
      breaks: parseBreaks(row.breaks, row.id, path),
      appliedAt: row.applied_at,
      appliedBy: row.applied_by,
    }));
}

/**
 * A log row's `breaks`, which must be a JSON array of strings. Any word
 * is kept, one this rafa does not know included, since `planSchema`
 * refuses on it; a value that is not such an array is a log no rafa
 * wrote, and throws.
 */
function parseBreaks(text: string, id: string, path: string): readonly string[] {
  const refused = new Error(`effort store: ${path} logs migration ${id} with breaks ${text},`
    + ' which is not a JSON array of words; refusing to read or write it');
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (cause) {
    throw new Error(refused.message, { cause });
  }
  if (!Array.isArray(parsed) || !parsed.every((word) => typeof word === 'string')) throw refused;
  return parsed;
}

/** The SQL of the migration `id` names; the catalogue was built from `migrations`, so it is there. */
function bodyOf(migrations: readonly SqliteMigration[], id: string): string {
  const migration = migrations.find((candidate) => candidate.id === id);
  if (migration === undefined) throw new Error(`bring forward: no migration ${id} in the catalogue it planned from`);
  return migration.sql;
}

/** Appends `entry` to the log, stamped with who applied it and when. */
function logMigration(
  db: Database,
  entry: CatalogueEntry,
  stamp: { readonly appliedAt: string; readonly appliedBy: string },
): void {
  db.run(
    `INSERT INTO ${MIGRATION_LOG_TABLE} (id, sha256, breaks, applied_at, applied_by) VALUES (?, ?, ?, ?, ?)`,
    [entry.id, entry.sha256, JSON.stringify(entry.breaks), stamp.appliedAt, stamp.appliedBy],
  );
}
