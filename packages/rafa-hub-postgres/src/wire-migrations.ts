/**
 * The table mapping each of the connector's Drizzle migrations to the
 * device's wire migration ids it covers: the ids `status().migrations`
 * and `contract().migrations` answer, which the row suite compares with a
 * device's. Drizzle's own names stay inside the connector; a device and
 * the hub's route only ever read wire ids.
 *
 * The entries run in the order of the Drizzle journal (`drizzle/meta/
 * _journal.json`), one per Drizzle migration, each `tag` the journal's.
 * A project whose schema has applied the first `n` of them mirrors the
 * wire ids of those `n`, in order. A Drizzle migration that changes no
 * wire table, such as an index of the connector's own, covers no id.
 *
 * The wire ids are written out, never read from the device's catalogue:
 * a device migration this schema does not yet mirror must not be claimed
 * by it. `schema.test.ts` fails when the ids covered here, in order, are
 * not exactly the migration log of a device store brought through every
 * migration, so a device migration lands here with the schema change and
 * the generated Drizzle migration that mirror it. A device migration that
 * changes no wire table (a local table's) still has to be covered, by an
 * empty `drizzle-kit generate --custom` migration's entry.
 */

/** One Drizzle migration and the wire migration ids it covers. */
export interface DrizzleWireCoverage {
  /** The Drizzle journal's tag for the migration. */
  readonly tag: string;
  /** The device's wire migration ids the migration brings the schema to, in the device's apply order. */
  readonly wire: readonly string[];
}

/** The connector's Drizzle migrations in journal order, each with the wire ids it covers. */
export const DRIZZLE_WIRE_MIGRATIONS: readonly DrizzleWireCoverage[] = [
  {
    tag: '0000_wire_contract_1',
    wire: [
      'kind-tables',
      'findings',
      'blockers-and-bugs',
      'report-absences',
      'task-reports',
      'preflight',
      'dispatches',
      'changes',
      'out-of-scope-bug-scope',
      'dispatch-skills',
      'skill-invocations',
      'task-report-skills',
      'plan-ci',
      'row-origins',
      'store-meta',
      'store-meta-generation',
      'session-worktree',
      'store-replaced',
      'stale-docs',
      'bug-routes',
      'reading-supersedes',
      'held-rows',
    ],
  },
  { tag: '0001_hub_devices', wire: [] },
];

/** A journal entry, as the migrator reads it: its tag and the `when` Drizzle logs it under. */
export interface JournalEntry {
  /** The Drizzle journal's tag for the migration. */
  readonly tag: string;
  /** The journal's `when`, the value Drizzle logs as `created_at`. */
  readonly when: number;
}

/** A row of a schema's Drizzle log, by the `when` it was logged under. */
export interface LoggedMigration {
  /** The journal `when` Drizzle logged as `created_at`. */
  readonly createdAt: number;
}

/**
 * The wire migration ids a project's schema mirrors: for each Drizzle
 * migration its log holds, in journal order, the wire ids `coverage`
 * maps it to. Refuses a logged migration no journal entry holds, and an
 * applied tag `coverage` does not map, naming each, so a schema never
 * claims an id nothing says it mirrors.
 */
export function wireMigrationIds(
  journal: readonly JournalEntry[],
  logged: readonly LoggedMigration[],
  coverage: readonly DrizzleWireCoverage[] = DRIZZLE_WIRE_MIGRATIONS,
): string[] {
  const applied = new Set(logged.map(({ createdAt }) => createdAt));
  const stray = [...applied].filter((when) => !journal.some((entry) => entry.when === when));
  if (stray.length > 0) {
    throw new Error(`hub postgres: the schema's log holds a migration logged at ${stray.join(', ')}, which no journal entry holds`);
  }
  return journal
    .filter(({ when }) => applied.has(when))
    .flatMap(({ tag }) => {
      const covered = coverage.find((entry) => entry.tag === tag);
      if (covered === undefined) {
        throw new Error(`hub postgres: the Drizzle migration ${tag} is applied but wire-migrations.ts maps it to no wire ids`);
      }
      return covered.wire;
    });
}
