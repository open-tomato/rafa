/**
 * The SQLite store's schema history and the version it brings a store to.
 *
 * ## Schema versioning
 *
 * {@link SQLITE_MIGRATIONS} is the schema's history, a versioned array
 * modelled on the reference's `effort-db.ts`. The entry at index `i`
 * takes a store from version `i` to version `i + 1`. Two things differ
 * from the reference, and each closes a failure the reference leaves
 * open:
 *
 *   - The last version is the array's length rather than a constant
 *     beside it. The reference declares `SCHEMA_VERSION = 1` next to
 *     its array, so an entry appended without the bump would never run.
 *   - The version lives in `PRAGMA user_version`, SQLite's header field
 *     for it, written in the same transaction as the migrations it
 *     records. Measured, a throw inside the transaction rolls the field
 *     back with the tables. The reference keeps its version in a table
 *     and inserts it after the migration, outside any transaction, so a
 *     run killed between the two leaves a migrated schema recorded as
 *     unmigrated.
 *
 * Every call brings an existing store forward before using it, as the
 * reference's `openDb` does: reads included, and an append with nothing
 * to insert, so no call reads or writes a store under a schema this
 * code does not know. `migrateSchema` in `sqlite.ts` names the two stores it
 * refuses instead.
 */

/**
 * The schema's history. The entry at index `i` takes a store from
 * version `i` to version `i + 1`; this module's note says why the version
 * is this array's length and lives in `user_version`.
 *
 * An entry is frozen once it ships. A store already past it never runs
 * it again, so an edit would give new stores a schema the old ones
 * never received. A change to the schema is a new entry at the end.
 */
export const SQLITE_MIGRATIONS: readonly string[] = [
  // Version 1: one table per kind, keyed as its NDJSON rows are.
  `
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
  // Version 2: one row per task-report finding, outside the port's row
  // map. `findings.ts` writes it and says why each constraint is there.
  `
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
  // Version 3: one row per task-report blocker and per out-of-scope bug,
  // outside the port's row map. `triage.ts` writes both and says why
  // each constraint and each index expression is there.
  `
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
  // Version 4: one telemetry row per task session whose output held no
  // report to read, outside the port's row map. `absences.ts` writes it
  // and says why each constraint is there, and why two columns have none.
  `
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
  // Version 5: one row per task session whose output carried a report,
  // holding the report's status beside the loop's outcome, outside the
  // port's row map. `reports.ts` writes it and says why `status` has a
  // CHECK and `outcome` has none.
  `
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
  // Version 6: one row per item a run's preflight checked, outside the
  // port's row map and filled from no task report. `preflight.ts` writes
  // it and says why `(run_id, position)` is its key, why `kind` has no
  // CHECK, and why no column says the run halted.
  `
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
  // Version 7: one row per task session the loop dispatched, holding what
  // its declaration asked for and the flags it was spawned with, outside
  // the port's row map. `dispatches.ts` writes it and says why the session
  // id is its key and why no column holds an outcome.
  `
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
  // Version 8: one row per change note a task report carries, outside the
  // port's row map. `changes.ts` writes it and says why the entry is its
  // dedupe key, why `level` and `summary` are NOT NULL, and why no column
  // holds an outcome.
  `
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
  // Version 9: what an out-of-scope bug is a bug OF, added to the table
  // version 3 created. `triage.ts` writes it from the reading in
  // `triage/machine-fault.ts` and says why it is nullable and why it is
  // outside the table's dedupe key. Measured on SQLite 3.51.0, this
  // `ADD COLUMN` keeps the rows a version-8 store holds, reading NULL on
  // each, and leaves `out_of_scope_bugs_by_entry` in force.
  `
  ALTER TABLE out_of_scope_bugs
    ADD COLUMN scope TEXT CHECK (scope IN ('machine', 'rafa'));
  `,
  // Version 10: the skill resolver a task session ran under and what it
  // was offered, added to the table version 7 created. `dispatches.ts`
  // writes them and says why each is nullable. A row a version-9 store
  // already holds reads NULL in all three.
  `
  ALTER TABLE dispatches
    ADD COLUMN resolver TEXT CHECK (resolver IN ('planner', 'tag', 'none'));
  ALTER TABLE dispatches
    ADD COLUMN skills_offered TEXT CHECK (skills_offered IS NULL OR json_type(skills_offered) = 'array');
  ALTER TABLE dispatches
    ADD COLUMN lessons_offered TEXT CHECK (lessons_offered IS NULL OR json_type(lessons_offered) = 'array');
  `,
  // Version 11: how often a session invoked each skill, outside the port's
  // row map and filled from no task report. `skill-invocations.ts` writes
  // it and says why a row with no name, no side and no count is `unknown`.
  `
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
  // Version 12: the skills a task session's report says it used, added to
  // the table version 5 created. `reports.ts` writes it and says why it is
  // nullable. A row a version-11 store already holds reads NULL: not
  // recorded, never an empty list.
  `
  ALTER TABLE task_reports
    ADD COLUMN skills_used TEXT CHECK (skills_used IS NULL OR json_type(skills_used) = 'array');
  `,
  // Version 13: one row per settled reading of a pull request's checks,
  // outside the port's row map and filled from no task report. `plan-ci.ts`
  // writes it and says why a pending reading has no row, and why
  // `(pr, head_sha, read_at)` is its key.
  `
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
];

/**
 * The version a store is brought to: the history's length, so
 * appending a migration is what raises it.
 */
export const SQLITE_SCHEMA_VERSION = SQLITE_MIGRATIONS.length;
