/**
 * The SQLite store's catalogue of named migrations, and the legacy gate
 * that keeps releases from before the migration log working.
 *
 * ## Named migrations
 *
 * {@link SQLITE_MIGRATIONS} is the schema's history. Each entry has an
 * `id`, what it `breaks` for an older runtime, and its `sql`. The
 * description and the body are separate types. {@link MigrationSpec}
 * holds what rafa decides about a migration, whatever backend runs it,
 * and imports nothing from SQLite. {@link SqliteMigration} adds the one
 * field that carries SQL. A compatibility decision can therefore be
 * written over `MigrationSpec` alone.
 *
 *   - The `id` is kebab-case and is never reused. It names the migration
 *     wherever a store records which migrations it holds, so two
 *     branches that each append one can merge in either order.
 *   - `breaks` is `[]` for an additive migration, one an older runtime
 *     can read and write through without knowing it ran. Otherwise it
 *     names `readers`, `writers` or both, and `contract` says which
 *     earlier migration prepared the change and why it has to break.
 *   - A migration holds DDL only. A backfill of rows is a command that
 *     the installed runtime runs after the merge. The one exception is
 *     a breaking table rebuild, which may carry its `INSERT … SELECT`.
 *
 * An entry is frozen once it ships. A store that already holds it never
 * runs it again, so an edit would give new stores a schema the old ones
 * never received. A change to the schema is a new entry at the end.
 * `migrations.lock.json`, beside this module, holds each entry's sha256
 * by id, and {@link lockMismatches} names every entry the lock disagrees
 * with. The array's order is the order a fresh store applies them in.
 *
 * ## The thirteen legacy entries
 *
 * Releases before the migration log hold their history as bare SQL
 * strings in this order, and record in `PRAGMA user_version` how many
 * of them a store holds. Read at their tags, 0.23.0, 0.24.0 and 0.24.1
 * each hold these thirteen. Their SQL is byte-identical here, so a
 * checksum taken now is the checksum of what those releases ran. This
 * module's test compares the SQL with an excerpt of the 0.24.1 bundle
 * committed under `src/effort/testdata/migrations/`. All thirteen are
 * additive.
 *
 * ## The legacy gate
 *
 * The releases before the migration log read only `user_version`. They
 * refuse any value above the length of their own history, which is 13
 * from 0.23.0 to 0.24.1, and run nothing on a store at exactly that
 * length. `user_version` therefore keeps a second job: it is the switch
 * that lets those releases in or keeps them out. {@link legacyGate} answers
 * {@link LEGACY_GATE_OPEN} while every migration a store holds is
 * additive, and {@link LEGACY_GATE_CLOSED} once a breaking one is
 * applied, so a pre-log release refuses a store it could no longer use.
 * SQLite writes the field in the transaction that sets it. Measured, a
 * throw inside that transaction rolls the field back together with the
 * tables.
 *
 * ## Who reads the names
 *
 * Every open of the store reads them. `withSqliteStore` in `sqlite.ts`
 * hands each store to `bringForward` in `bring-forward.ts`, which asks
 * `planSchema` in `schema-plan.ts` whether the store can be used,
 * from `id`, `breaks` and the gate, and keeps the migration log.
 * `migrateSchema` in `sqlite.ts` still applies these entries by array
 * position and writes the array's length, {@link SQLITE_SCHEMA_VERSION},
 * to `user_version`, as the pre-log releases do; tests plant pre-log
 * stores with it, and no open or command goes through it. No module
 * outside this one and its test reads the lock.
 */
import { createHash } from 'node:crypto';

/** What an older runtime can no longer do once a migration has run. */
export type MigrationBreak = 'readers' | 'writers';

/** Why a breaking migration breaks, and what prepared the way for it. */
export interface MigrationContract {
  /**
   * The id of the additive migration that shipped the new shape in an
   * earlier release, or null when no expand step was needed.
   */
  readonly expand: string | null;
  /** Why the change cannot be additive. */
  readonly why: string;
}

/** A migration as rafa decides about it, whatever backend runs it. */
export interface MigrationSpec {
  /** Kebab-case and unique for all time: the key a store records it by. */
  readonly id: string;
  /** `[]` for an additive migration; otherwise what it breaks. */
  readonly breaks: readonly MigrationBreak[];
  /** Present exactly when `breaks` is not empty. */
  readonly contract?: MigrationContract;
}

/** The one migration type that carries SQL. */
export interface SqliteMigration extends MigrationSpec {
  /** DDL only, frozen once shipped; `migrations.lock.json` holds its sha256. */
  readonly sql: string;
}

/**
 * The `user_version` a store holds while every migration it has applied
 * is additive: the length of the history 0.23.0 to 0.24.1 hold, and so
 * the last version those releases accept.
 */
export const LEGACY_GATE_OPEN = 13;

/**
 * The `user_version` a store holds once a breaking migration is applied:
 * past any version a pre-log release counts to, so every such release
 * refuses the store.
 */
export const LEGACY_GATE_CLOSED = 1000;

/**
 * The schema's history, by name. This module's note says why an entry
 * is frozen, what its `breaks` declares, and who still reads the first
 * thirteen by position.
 */
export const SQLITE_MIGRATIONS: readonly SqliteMigration[] = [
  // Version 1: one table per kind, keyed as its NDJSON rows are.
  {
    id: 'kind-tables',
    breaks: [],
    sql: `
  CREATE TABLE sessions (
    seq        INTEGER PRIMARY KEY,
    session_id TEXT NOT NULL UNIQUE CHECK (session_id <> ''),
    row_json   TEXT NOT NULL
  );

  CREATE TABLE commits (
    seq      INTEGER PRIMARY KEY,
    sha      TEXT NOT NULL UNIQUE CHECK (sha <> ''),
    row_json TEXT NOT NULL
  );
  `,
  },
  // Version 2: one row per task-report finding, outside the port's row
  // map. `findings.ts` writes it and says why each constraint is there.
  {
    id: 'findings',
    breaks: [],
    sql: `
  CREATE TABLE findings (
    seq          INTEGER PRIMARY KEY,
    id           TEXT NOT NULL UNIQUE CHECK (id <> ''),
    session_id   TEXT NOT NULL CHECK (session_id <> ''),
    plan_stub    TEXT,
    task_line    TEXT NOT NULL,
    kind         TEXT
      CHECK (kind IN ('gotcha', 'pattern', 'location', 'skill-suggestion')),
    trigger      TEXT CHECK (trigger <> ''),
    what         TEXT CHECK (what <> ''),
    cause        TEXT,
    resolution   TEXT,
    artifact     TEXT CHECK (artifact <> ''),
    signal       TEXT CHECK (signal IN ('loud', 'silent')),
    outcome      TEXT NOT NULL,
    tracker_ref  TEXT,
    collected_at TEXT NOT NULL,
    CHECK (artifact IS NOT NULL OR (trigger IS NOT NULL AND what IS NOT NULL))
  );

  CREATE UNIQUE INDEX findings_by_artifact
    ON findings (session_id, artifact)
    WHERE artifact IS NOT NULL;

  CREATE UNIQUE INDEX findings_by_trigger_what
    ON findings (session_id, trigger, what)
    WHERE artifact IS NULL;
  `,
  },
  // Version 3: one row per task-report blocker and per out-of-scope bug,
  // outside the port's row map. `triage.ts` writes both and says why
  // each constraint and each index expression is there.
  {
    id: 'blockers-and-bugs',
    breaks: [],
    sql: `
  CREATE TABLE blockers (
    seq          INTEGER PRIMARY KEY,
    id           TEXT NOT NULL UNIQUE CHECK (id <> ''),
    session_id   TEXT NOT NULL CHECK (session_id <> ''),
    plan_stub    TEXT,
    task_line    TEXT NOT NULL,
    what         TEXT NOT NULL CHECK (what <> ''),
    artifact     TEXT CHECK (artifact <> ''),
    outcome      TEXT NOT NULL,
    collected_at TEXT NOT NULL
  );

  CREATE UNIQUE INDEX blockers_by_entry
    ON blockers (session_id, what, ifnull(artifact, ''));

  CREATE TABLE out_of_scope_bugs (
    seq          INTEGER PRIMARY KEY,
    id           TEXT NOT NULL UNIQUE CHECK (id <> ''),
    session_id   TEXT NOT NULL CHECK (session_id <> ''),
    plan_stub    TEXT,
    task_line    TEXT NOT NULL,
    what         TEXT NOT NULL CHECK (what <> ''),
    artifact     TEXT CHECK (artifact <> ''),
    security     INTEGER CHECK (security IN (0, 1)),
    outcome      TEXT NOT NULL,
    collected_at TEXT NOT NULL
  );

  CREATE UNIQUE INDEX out_of_scope_bugs_by_entry
    ON out_of_scope_bugs (session_id, what, ifnull(artifact, ''), ifnull(security, -1));
  `,
  },
  // Version 4: one telemetry row per task session whose output held no
  // report to read, outside the port's row map. `absences.ts` writes it
  // and says why each constraint is there, and why two columns have none.
  {
    id: 'report-absences',
    breaks: [],
    sql: `
  CREATE TABLE report_absences (
    seq          INTEGER PRIMARY KEY,
    id           TEXT NOT NULL UNIQUE CHECK (id <> ''),
    session_id   TEXT NOT NULL UNIQUE CHECK (session_id <> ''),
    plan_stub    TEXT,
    task_line    TEXT NOT NULL,
    reason       TEXT NOT NULL CHECK (reason <> ''),
    detail       TEXT NOT NULL CHECK (detail <> ''),
    block_body   TEXT,
    outcome      TEXT NOT NULL,
    collected_at TEXT NOT NULL
  );
  `,
  },
  // Version 5: one row per task session whose output carried a report,
  // holding the report's status beside the loop's outcome, outside the
  // port's row map. `reports.ts` writes it and says why `status` has a
  // CHECK and `outcome` has none.
  {
    id: 'task-reports',
    breaks: [],
    sql: `
  CREATE TABLE task_reports (
    seq          INTEGER PRIMARY KEY,
    id           TEXT NOT NULL UNIQUE CHECK (id <> ''),
    session_id   TEXT NOT NULL UNIQUE CHECK (session_id <> ''),
    plan_stub    TEXT,
    task_line    TEXT NOT NULL,
    status       TEXT CHECK (status IN ('done', 'blocked')),
    outcome      TEXT NOT NULL,
    collected_at TEXT NOT NULL
  );
  `,
  },
  // Version 6: one row per item a run's preflight checked, outside the
  // port's row map and filled from no task report. `preflight.ts` writes
  // it and says why `(run_id, position)` is its key, why `kind` has no
  // CHECK, and why no column says the run halted.
  {
    id: 'preflight',
    breaks: [],
    sql: `
  CREATE TABLE preflight (
    seq          INTEGER PRIMARY KEY,
    run_id       TEXT NOT NULL CHECK (run_id <> ''),
    position     INTEGER NOT NULL CHECK (typeof(position) = 'integer' AND position >= 0),
    tier         TEXT NOT NULL CHECK (tier IN ('required', 'optional')),
    kind         TEXT NOT NULL CHECK (kind <> ''),
    item         TEXT NOT NULL CHECK (item <> ''),
    probe        TEXT CHECK (probe <> ''),
    outcome      TEXT NOT NULL CHECK (outcome IN ('pass', 'fail', 'timeout')),
    duration_ms  INTEGER NOT NULL CHECK (typeof(duration_ms) = 'integer' AND duration_ms >= 0),
    failure      TEXT CHECK (failure <> ''),
    collected_at TEXT NOT NULL,
    UNIQUE (run_id, position),
    CHECK ((outcome = 'pass') = (failure IS NULL))
  );
  `,
  },
  // Version 7: one row per task session the loop dispatched, holding what
  // its declaration asked for and the flags it was spawned with, outside
  // the port's row map. `dispatches.ts` writes it and says why the session
  // id is its key and why no column holds an outcome.
  {
    id: 'dispatches',
    breaks: [],
    sql: `
  CREATE TABLE dispatches (
    seq          INTEGER PRIMARY KEY,
    session_id   TEXT NOT NULL UNIQUE CHECK (session_id <> ''),
    plan_stub    TEXT,
    task_line    TEXT NOT NULL,
    declaration  TEXT CHECK (declaration <> ''),
    agent        TEXT CHECK (agent <> ''),
    model        TEXT CHECK (model <> ''),
    effort       TEXT CHECK (effort <> ''),
    budget_usd   REAL CHECK (budget_usd IS NULL OR (typeof(budget_usd) IN ('integer', 'real') AND budget_usd > 0)),
    tools        TEXT CHECK (tools <> ''),
    flags        TEXT NOT NULL,
    collected_at TEXT NOT NULL
  );
  `,
  },
  // Version 8: one row per change note a task report carries, outside the
  // port's row map. `changes.ts` writes it and says why the entry is its
  // dedupe key, why `level` and `summary` are NOT NULL, and why no column
  // holds an outcome.
  {
    id: 'changes',
    breaks: [],
    sql: `
  CREATE TABLE changes (
    seq          INTEGER PRIMARY KEY,
    id           TEXT NOT NULL UNIQUE CHECK (id <> ''),
    session_id   TEXT NOT NULL CHECK (session_id <> ''),
    plan_stub    TEXT,
    task_line    TEXT NOT NULL,
    level        TEXT NOT NULL
      CHECK (level IN ('patch', 'minor', 'major', 'none')),
    area         TEXT CHECK (area <> ''),
    summary      TEXT NOT NULL CHECK (summary <> ''),
    collected_at TEXT NOT NULL
  );

  CREATE UNIQUE INDEX changes_by_entry
    ON changes (session_id, level, ifnull(area, ''), summary);
  `,
  },
  // Version 9: what an out-of-scope bug is a bug OF, added to the table
  // version 3 created. `triage.ts` writes it from the reading in
  // `triage/machine-fault.ts` and says why it is nullable and why it is
  // outside the table's dedupe key. Measured on SQLite 3.51.0, this
  // `ADD COLUMN` keeps the rows a version-8 store holds, reading NULL on
  // each, and leaves `out_of_scope_bugs_by_entry` in force.
  {
    id: 'out-of-scope-bug-scope',
    breaks: [],
    sql: `
  ALTER TABLE out_of_scope_bugs
    ADD COLUMN scope TEXT CHECK (scope IN ('machine', 'rafa'));
  `,
  },
  // Version 10: the skill resolver a task session ran under and what it
  // was offered, added to the table version 7 created. `dispatches.ts`
  // writes them and says why each is nullable. A row a version-9 store
  // already holds reads NULL in all three.
  {
    id: 'dispatch-skills',
    breaks: [],
    sql: `
  ALTER TABLE dispatches
    ADD COLUMN resolver TEXT CHECK (resolver IN ('planner', 'tag', 'none'));
  ALTER TABLE dispatches
    ADD COLUMN skills_offered TEXT CHECK (skills_offered IS NULL OR json_type(skills_offered) = 'array');
  ALTER TABLE dispatches
    ADD COLUMN lessons_offered TEXT CHECK (lessons_offered IS NULL OR json_type(lessons_offered) = 'array');
  `,
  },
  // Version 11: how often a session invoked each skill, outside the port's
  // row map and filled from no task report. `skill-invocations.ts` writes
  // it and says why a row with no name, no side and no count is `unknown`.
  {
    id: 'skill-invocations',
    breaks: [],
    sql: `
  CREATE TABLE skill_invocations (
    seq        INTEGER PRIMARY KEY,
    session_id TEXT NOT NULL CHECK (session_id <> ''),
    name       TEXT CHECK (name <> ''),
    sidechain  INTEGER CHECK (sidechain IN (0, 1)),
    count      INTEGER CHECK (count IS NULL OR (typeof(count) = 'integer' AND count > 0)),
    CHECK ((name IS NULL) = (count IS NULL) AND (name IS NULL) = (sidechain IS NULL))
  );

  CREATE UNIQUE INDEX skill_invocations_by_use
    ON skill_invocations (session_id, ifnull(name, ''), ifnull(sidechain, -1));
  `,
  },
  // Version 12: the skills a task session's report says it used, added to
  // the table version 5 created. `reports.ts` writes it and says why it is
  // nullable. A row a version-11 store already holds reads NULL: not
  // recorded, never an empty list.
  {
    id: 'task-report-skills',
    breaks: [],
    sql: `
  ALTER TABLE task_reports
    ADD COLUMN skills_used TEXT CHECK (skills_used IS NULL OR json_type(skills_used) = 'array');
  `,
  },
  // Version 13: one row per settled reading of a pull request's checks,
  // outside the port's row map and filled from no task report. `plan-ci.ts`
  // writes it and says why a pending reading has no row, and why
  // `(pr, head_sha, read_at)` is its key.
  {
    id: 'plan-ci',
    breaks: [],
    sql: `
  CREATE TABLE plan_ci (
    seq       INTEGER PRIMARY KEY,
    plan_stub TEXT NOT NULL CHECK (plan_stub <> ''),
    pr        INTEGER NOT NULL CHECK (typeof(pr) = 'integer' AND pr > 0),
    head_sha  TEXT NOT NULL CHECK (head_sha <> ''),
    verdict   TEXT NOT NULL CHECK (verdict IN ('green', 'red', 'none')),
    failing   TEXT NOT NULL CHECK (json_valid(failing) AND json_type(failing) = 'array'),
    read_at   TEXT NOT NULL CHECK (read_at <> ''),
    UNIQUE (pr, head_sha, read_at),
    CHECK ((verdict = 'red') = (json_array_length(failing) > 0))
  );
  `,
  },
  // The first entry past the legacy history: which store wrote each row
  // of the twelve tables a merge unions, and the row's own `seq` there.
  // Both columns are nullable with no DEFAULT, because a pre-log runtime
  // keeps inserting through this entry without naming them, and a row
  // it writes, like every row held before this entry ran, reads NULL in
  // both. Each unique index covers only rows carrying an origin, so
  // those NULL rows never collide. No trigger fills them, since a
  // trigger breaks `writers`: a writer that stamps an origin names both
  // columns in its own insert.
  {
    id: 'row-origins',
    breaks: [],
    sql: `
  ALTER TABLE sessions ADD COLUMN origin_store TEXT;
  ALTER TABLE sessions ADD COLUMN origin_seq INTEGER;
  CREATE UNIQUE INDEX sessions_by_origin
    ON sessions (origin_store, origin_seq)
    WHERE origin_store IS NOT NULL;

  ALTER TABLE commits ADD COLUMN origin_store TEXT;
  ALTER TABLE commits ADD COLUMN origin_seq INTEGER;
  CREATE UNIQUE INDEX commits_by_origin
    ON commits (origin_store, origin_seq)
    WHERE origin_store IS NOT NULL;

  ALTER TABLE findings ADD COLUMN origin_store TEXT;
  ALTER TABLE findings ADD COLUMN origin_seq INTEGER;
  CREATE UNIQUE INDEX findings_by_origin
    ON findings (origin_store, origin_seq)
    WHERE origin_store IS NOT NULL;

  ALTER TABLE blockers ADD COLUMN origin_store TEXT;
  ALTER TABLE blockers ADD COLUMN origin_seq INTEGER;
  CREATE UNIQUE INDEX blockers_by_origin
    ON blockers (origin_store, origin_seq)
    WHERE origin_store IS NOT NULL;

  ALTER TABLE out_of_scope_bugs ADD COLUMN origin_store TEXT;
  ALTER TABLE out_of_scope_bugs ADD COLUMN origin_seq INTEGER;
  CREATE UNIQUE INDEX out_of_scope_bugs_by_origin
    ON out_of_scope_bugs (origin_store, origin_seq)
    WHERE origin_store IS NOT NULL;

  ALTER TABLE report_absences ADD COLUMN origin_store TEXT;
  ALTER TABLE report_absences ADD COLUMN origin_seq INTEGER;
  CREATE UNIQUE INDEX report_absences_by_origin
    ON report_absences (origin_store, origin_seq)
    WHERE origin_store IS NOT NULL;

  ALTER TABLE task_reports ADD COLUMN origin_store TEXT;
  ALTER TABLE task_reports ADD COLUMN origin_seq INTEGER;
  CREATE UNIQUE INDEX task_reports_by_origin
    ON task_reports (origin_store, origin_seq)
    WHERE origin_store IS NOT NULL;

  ALTER TABLE preflight ADD COLUMN origin_store TEXT;
  ALTER TABLE preflight ADD COLUMN origin_seq INTEGER;
  CREATE UNIQUE INDEX preflight_by_origin
    ON preflight (origin_store, origin_seq)
    WHERE origin_store IS NOT NULL;

  ALTER TABLE dispatches ADD COLUMN origin_store TEXT;
  ALTER TABLE dispatches ADD COLUMN origin_seq INTEGER;
  CREATE UNIQUE INDEX dispatches_by_origin
    ON dispatches (origin_store, origin_seq)
    WHERE origin_store IS NOT NULL;

  ALTER TABLE changes ADD COLUMN origin_store TEXT;
  ALTER TABLE changes ADD COLUMN origin_seq INTEGER;
  CREATE UNIQUE INDEX changes_by_origin
    ON changes (origin_store, origin_seq)
    WHERE origin_store IS NOT NULL;

  ALTER TABLE skill_invocations ADD COLUMN origin_store TEXT;
  ALTER TABLE skill_invocations ADD COLUMN origin_seq INTEGER;
  CREATE UNIQUE INDEX skill_invocations_by_origin
    ON skill_invocations (origin_store, origin_seq)
    WHERE origin_store IS NOT NULL;

  ALTER TABLE plan_ci ADD COLUMN origin_store TEXT;
  ALTER TABLE plan_ci ADD COLUMN origin_seq INTEGER;
  CREATE UNIQUE INDEX plan_ci_by_origin
    ON plan_ci (origin_store, origin_seq)
    WHERE origin_store IS NOT NULL;
  `,
  },
  // The store's own identity and its merge trail, three tables that never
  // leave this machine. `store_meta` holds one row, pinned by `id = 1`:
  // the origin this store stamps on the rows it writes, the project it
  // belongs to, and the host, absolute path and file identity it was
  // minted under, which a writing open compares to detect a copy.
  // `merges` records each merge by the other store's id, NULL when that
  // store was never minted, with the rows it added, skipped and left in
  // conflict. `merge_conflicts` keeps each incoming row a merge could not
  // settle, as the JSON of its columns, beside the local row's `seq`;
  // `field` names the edited field whose two values differ, and is NULL
  // when the rows differ outside any edited field.
  {
    id: 'store-meta',
    breaks: [],
    sql: `
  CREATE TABLE store_meta (
    id                  INTEGER PRIMARY KEY CHECK (id = 1),
    store_id            TEXT NOT NULL CHECK (store_id <> ''),
    project_root_commit TEXT NOT NULL CHECK (project_root_commit <> ''),
    project_remote      TEXT CHECK (project_remote <> ''),
    host_id             TEXT NOT NULL CHECK (host_id <> ''),
    store_path          TEXT NOT NULL CHECK (store_path <> ''),
    file_dev            INTEGER NOT NULL CHECK (typeof(file_dev) = 'integer'),
    file_ino            INTEGER NOT NULL CHECK (typeof(file_ino) = 'integer'),
    minted_at           TEXT NOT NULL CHECK (minted_at <> '')
  );

  CREATE TABLE merges (
    seq              INTEGER PRIMARY KEY,
    id               TEXT NOT NULL UNIQUE CHECK (id <> ''),
    other_store      TEXT CHECK (other_store <> ''),
    merged_at        TEXT NOT NULL CHECK (merged_at <> ''),
    rows_added       INTEGER NOT NULL CHECK (typeof(rows_added) = 'integer' AND rows_added >= 0),
    rows_skipped     INTEGER NOT NULL CHECK (typeof(rows_skipped) = 'integer' AND rows_skipped >= 0),
    rows_in_conflict INTEGER NOT NULL CHECK (typeof(rows_in_conflict) = 'integer' AND rows_in_conflict >= 0)
  );

  CREATE TABLE merge_conflicts (
    seq         INTEGER PRIMARY KEY,
    merge_id    TEXT NOT NULL CHECK (merge_id <> ''),
    table_name  TEXT NOT NULL CHECK (table_name <> ''),
    local_seq   INTEGER NOT NULL CHECK (typeof(local_seq) = 'integer'),
    field       TEXT CHECK (field <> ''),
    incoming    TEXT NOT NULL CHECK (json_valid(incoming) AND json_type(incoming) = 'object'),
    recorded_at TEXT NOT NULL CHECK (recorded_at <> '')
  );
  `,
  },
];

/**
 * The length of the history. `migrateSchema` in `sqlite.ts`, which
 * tests plant pre-log stores with, brings a store to this
 * `user_version` and refuses one past it, as the pre-log releases do.
 */
export const SQLITE_SCHEMA_VERSION = SQLITE_MIGRATIONS.length;

/**
 * The `user_version` a store is given when it holds `applied`. The
 * value is {@link LEGACY_GATE_OPEN} when every entry declares no
 * `breaks`, and {@link LEGACY_GATE_CLOSED} otherwise. Any word counts
 * as a break, including one this rafa does not know, because a pre-log
 * release can use the store only when nothing in it breaks.
 */
export function legacyGate(
  applied: readonly { readonly breaks: readonly string[] }[],
): number {
  return applied.every(({ breaks }) => breaks.length === 0)
    ? LEGACY_GATE_OPEN
    : LEGACY_GATE_CLOSED;
}

/** The sha256 of a migration's SQL, as lowercase hex over its UTF-8 bytes. */
export function migrationChecksum(migration: Pick<SqliteMigration, 'sql'>): string {
  return createHash('sha256')
    .update(migration.sql, 'utf8')
    .digest('hex');
}

/** The lock file's shape: each migration's sha256, keyed by its id. */
export type MigrationLock = Readonly<Record<string, string>>;

/** One way the migrations and their lock disagree. */
export type LockMismatch =
  /** The entry's SQL hashes to something other than its lock line. */
  | { readonly kind: 'edited'; readonly id: string; readonly locked: string; readonly computed: string }
  /** The entry has no lock line. */
  | { readonly kind: 'unlocked'; readonly id: string; readonly computed: string }
  /** The lock line has no entry, so a migration was removed or renamed. */
  | { readonly kind: 'missing'; readonly id: string; readonly locked: string };

/**
 * Every way `migrations` and `lock` disagree. Entries come first, in
 * array order, followed by the lock lines that no entry matches, in
 * lock order. An empty answer means the lock holds exactly these
 * entries, each with the checksum of its SQL.
 */
export function lockMismatches(
  migrations: readonly SqliteMigration[],
  lock: MigrationLock,
): readonly LockMismatch[] {
  const fromEntries = migrations.flatMap((migration): LockMismatch[] => {
    const { id } = migration;
    const computed = migrationChecksum(migration);
    if (!Object.hasOwn(lock, id)) return [{ kind: 'unlocked', id, computed }];

    const locked = lock[id] ?? '';
    return locked === computed
      ? []
      : [{ kind: 'edited', id, locked, computed }];
  });
  const ids = new Set(migrations.map(({ id }) => id));
  const fromLock = Object.entries(lock)
    .filter(([id]) => !ids.has(id))
    .map(([id, locked]): LockMismatch => ({ kind: 'missing', id, locked }));
  return [...fromEntries, ...fromLock];
}
