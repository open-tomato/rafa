/**
 * What `rafa effort schema` reports about one SQLite store: the
 * migrations it holds, set against the ones this build knows, the
 * legacy gate, and whether this rafa would use the store or refuse it,
 * ending with the one command to run next.
 *
 * ## Reading only
 *
 * {@link readSchemaReport} opens the store read-only and never calls
 * `bringForward`, so it adopts nothing and applies nothing: a store
 * with a migration pending, or one a pre-log release wrote, keeps its
 * bytes. It runs the test guard (`guardTestProcess`) before it opens
 * anything, and sets the store's busy timeout (`effort.busyTimeoutMs`)
 * as every open does. A path holding no file is reported `absent` and
 * opened not at all, since opening it would make it.
 *
 * ## The verdict
 *
 * The decision is `planSchema`'s (`schema-plan.ts`), asked for a write
 * from an ordinary open, because a runtime that reads and writes the
 * store is refused whatever a read or a write alone would be: an
 * unknown migration that breaks writers is read and refused a write,
 * and reported as that refusal. A refusal's reason, text and next step
 * are the plan's, so the report names the same command the open's
 * refusal would.
 *
 * A plan that would use the store is `current` when it has nothing to
 * adopt or apply, and `behind` otherwise, which the next open brings
 * forward. A behind store is then put to the question every such open
 * asks a development build (`refuseUnownedDevelopmentWrite`,
 * `development-build.ts`), and a development build that would be
 * refused the write is reported `development-build`, with `rafa effort
 * copy` as its next step. A store this rafa uses has `none` as its next
 * step.
 *
 * ## The lists
 *
 * The lists are read from the store and this build's catalogue
 * directly, not from the plan, so a refused store still shows them all:
 *
 *   - `applied`: each id this build knows that the store holds with the
 *     checksum this build holds, or, for a store with no log, the
 *     legacy entries its `user_version` counts, unlogged;
 *   - `pending`: each id this build knows that the store does not hold,
 *     in catalogue order;
 *   - `unknown`: each logged id this build does not know, with what it
 *     breaks and who applied it when;
 *   - `edited`: each logged id this build knows under another checksum.
 */
import type { DevelopmentProbe } from './development-build.js';
import type { SqliteMigration } from './migrations.js';
import type { CatalogueEntry, LoggedMigration, RefusalReason, SchemaPlan, StoreSchema } from './schema-plan.js';

import { existsSync } from 'node:fs';

import { Database } from 'bun:sqlite';

import { readStoreSchema, writeNames } from './bring-forward.js';
import { DEVELOPMENT_NEXT_STEP, DevelopmentBuildRefusedError, refuseUnownedDevelopmentWrite } from './development-build.js';
import { guardTestProcess } from './location.js';
import { LEGACY_GATE_CLOSED, LEGACY_GATE_OPEN, SQLITE_MIGRATIONS } from './migrations.js';
import { planSchema, sqliteCatalogue } from './schema-plan.js';
import { activeStoreSettings } from './settings.js';

/** The next step of a store this rafa uses as it is, or brings forward on its next open. */
export const NO_NEXT_STEP = 'none';

/** A store this rafa uses: nothing to write, or something the next open writes. */
export type UsableStatus = 'absent' | 'current' | 'behind';

/** What the report says of the store: usable, or refused and why. */
export type SchemaStatus = UsableStatus | RefusalReason | 'development-build';

/** One migration the store holds that this build knows, as the log recorded it. */
export interface AppliedMigration {
  readonly id: string;
  /** Who applied it, or null for a legacy entry a store with no log holds. */
  readonly appliedBy: string | null;
  /** When it was applied, or null for a legacy entry a store with no log holds. */
  readonly appliedAt: string | null;
}

/** One logged id this build knows under another checksum. */
export interface EditedMigration {
  readonly id: string;
  /** The checksum the store's log holds. */
  readonly recorded: string;
  /** The checksum this build holds. */
  readonly expected: string;
}

/** Everything `rafa effort schema` says about one store. */
export interface SchemaReport {
  /** The store file. */
  readonly path: string;
  /** Whether the file exists; the lists are empty and the versions null when it does not. */
  readonly exists: boolean;
  /** `PRAGMA user_version` as the store holds it. */
  readonly userVersion: number | null;
  /** Whether the store holds a migration log. */
  readonly logged: boolean;
  readonly applied: readonly AppliedMigration[];
  /** Ids this build knows that the store does not hold, in catalogue order. */
  readonly pending: readonly string[];
  readonly unknown: readonly LoggedMigration[];
  readonly edited: readonly EditedMigration[];
  /** The `user_version` the store holds once this rafa's next open is done, or null when it is refused. */
  readonly gate: number | null;
  readonly status: SchemaStatus;
  /** True when this rafa would refuse to read or to write the store. */
  readonly refused: boolean;
  /** The refusal's text without its way out, or null when the store is usable. */
  readonly refusal: string | null;
  /** The one command to run next, or {@link NO_NEXT_STEP}. */
  readonly nextStep: string;
}

/** What a report may vary; each field has the running build's default. */
export interface SchemaReportOptions {
  /** The catalogue the store is set against; a test passes a synthetic tail here. */
  readonly migrations?: readonly SqliteMigration[];
  /** Which build runs and which stores it owns. */
  readonly development?: DevelopmentProbe;
}

/** The report for `path`; see the module note. Throws when the file cannot be read as a store. */
export function readSchemaReport(path: string, options: SchemaReportOptions = {}): SchemaReport {
  guardTestProcess(path);
  if (!existsSync(path)) return absentReport(path);

  const catalogue = sqliteCatalogue(options.migrations ?? SQLITE_MIGRATIONS);
  const store = readReadOnly(path);
  const plan = planSchema(store, catalogue, 'write', 'open');
  return { ...listsOf(store, catalogue), ...verdictOf(path, plan, options.development ?? {}) };
}

/** The store's `user_version` and log, read on a read-only connection. */
function readReadOnly(path: string): StoreSchema {
  const db = new Database(path, { readonly: true });
  try {
    db.run(`PRAGMA busy_timeout = ${String(activeStoreSettings().busyTimeoutMs)}`);
    return readStoreSchema(db, path);
  } finally {
    db.close();
  }
}

/** The report of a path holding no store, which the first write creates at this rafa's migrations. */
function absentReport(path: string): SchemaReport {
  return {
    path,
    exists: false,
    userVersion: null,
    logged: false,
    applied: [],
    pending: [],
    unknown: [],
    edited: [],
    gate: null,
    status: 'absent',
    refused: false,
    refusal: null,
    nextStep: NO_NEXT_STEP,
  };
}

/** The part of a report the store and the catalogue answer. */
type ReportLists = Pick<SchemaReport, 'path' | 'exists' | 'userVersion' | 'logged' | 'applied' | 'pending' | 'unknown' | 'edited'>;

/** The lists; see the module note. */
function listsOf(store: StoreSchema, catalogue: readonly CatalogueEntry[]): ReportLists {
  const base = { path: store.path, exists: true, userVersion: store.userVersion, logged: store.log !== null };
  if (store.log === null) {
    const held = Math.max(0, store.userVersion);
    return {
      ...base,
      applied: catalogue.slice(0, held).map(({ id }) => ({ id, appliedBy: null, appliedAt: null })),
      pending: catalogue.slice(held).map(({ id }) => id),
      unknown: [],
      edited: [],
    };
  }

  const byId = new Map(catalogue.map((entry) => [entry.id, entry]));
  const log = store.log;
  const heldIds = new Set(log.map(({ id }) => id));
  return {
    ...base,
    applied: log
      .filter((row) => byId.get(row.id)?.sha256 === row.sha256)
      .map(({ id, appliedBy, appliedAt }) => ({ id, appliedBy, appliedAt })),
    pending: catalogue.filter(({ id }) => !heldIds.has(id)).map(({ id }) => id),
    unknown: log.filter(({ id }) => !byId.has(id)),
    edited: log.flatMap((row) => {
      const expected = byId.get(row.id)?.sha256;
      return expected === undefined || expected === row.sha256
        ? []
        : [{ id: row.id, recorded: row.sha256, expected }];
    }),
  };
}

/** The part of a report the plan answers. */
type ReportVerdict = Pick<SchemaReport, 'gate' | 'status' | 'refused' | 'refusal' | 'nextStep'>;

/** The verdict; see the module note. */
function verdictOf(path: string, plan: SchemaPlan, development: DevelopmentProbe): ReportVerdict {
  if (plan.verdict === 'refuse') {
    return refusedVerdict(plan.reason, withoutWayOut(plan.message, plan.nextStep), plan.nextStep);
  }

  const needs = writeNames(plan);
  if (needs.length === 0) return { gate: plan.gate, status: 'current', refused: false, refusal: null, nextStep: NO_NEXT_STEP };
  try {
    refuseUnownedDevelopmentWrite(path, needs, development);
  } catch (error) {
    if (!(error instanceof DevelopmentBuildRefusedError)) throw error;
    return refusedVerdict('development-build', error.message, DEVELOPMENT_NEXT_STEP);
  }
  return { gate: plan.gate, status: 'behind', refused: false, refusal: null, nextStep: NO_NEXT_STEP };
}

/** A refused verdict. */
function refusedVerdict(status: SchemaStatus, refusal: string, nextStep: string): ReportVerdict {
  return { gate: null, status, refused: true, refusal, nextStep };
}

/** A plan's refusal text with its `Next safe step:` ending taken off, since the report ends with its own. */
function withoutWayOut(message: string, nextStep: string): string {
  const ending = ` Next safe step: ${nextStep}`;
  return message.endsWith(ending)
    ? message.slice(0, -ending.length)
    : message;
}

/** What a `user_version` means to a release before the log. */
export function gateMeaning(userVersion: number): string {
  if (userVersion === LEGACY_GATE_OPEN) return 'open: a release before the migration log reads and writes the store';
  if (userVersion === LEGACY_GATE_CLOSED) return 'closed: a release before the migration log refuses the store';
  return 'neither gate';
}
