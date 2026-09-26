/**
 * The differential parity test: collects the SIBLING's real session
 * logs and real git history into an NDJSON store and a SQLite store,
 * both fresh and both under one temporary root, and holds the two
 * stores to the same row set.
 *
 * This is one of two parity tests the spec calls for, and it is not
 * the other one. This file never reads the sibling's OWN stored rows
 * (`~/projects/agentic-research/.ralph/effort/*.ndjson`) — that
 * comparison, against what the sibling's own collector already wrote,
 * is the LINEAGE parity test. This one runs rafa's collector twice,
 * once per backend, over the same inputs, and asks only whether the
 * two backends agree with EACH OTHER. A backend whose key projection
 * disagreed with the collector's own selection logic — the exact
 * failure mode `effort/collect.ts`'s module note calls out — is what
 * this is built to catch: it would show up here as a row missing on
 * one side, or duplicated, well before it showed up as a wrong total
 * in a report.
 *
 * ## The logs are frozen once, and both backends read the copy
 *
 * The sibling's log directory is live, and the sibling runs its own
 * loop. Read twice, once per backend, it is not one input but two: a
 * session appending to its `.jsonl` between the two collections moves
 * that row's `sizeBytes`, `lineCount`, `recordCount`,
 * `recordTypeCounts`, `usage` and `lastTimestamp`, and the byte-identity
 * case below fails having compared a row to a LATER version of itself.
 * That is a race in this file, not a disagreement between backends,
 * and no re-reading of the result can tell the two apart from the
 * failure line alone.
 *
 * So the logs are copied once, by {@link freezeParitySessionLogs}, into
 * one directory under the same temporary root, and both collections
 * read that copy. The copy carries each log's mtime, so the rows are
 * the ones the live directory would have produced at the instant of the
 * freeze — only `filePath` names the copy rather than the original,
 * which is equally true on both sides and so is compared like any other
 * field. Whatever the sibling appends afterwards lands in a file no
 * collection here reads.
 *
 * Freezing removes a race; it must not remove the property. The
 * liveness control below asserts that the copy still carries the very
 * fields the race used to move — a nonzero `sizeBytes` matching the
 * frozen file on disk, a nonzero `lineCount` and `recordCount` — so a
 * freeze that copied empty files, or truncated them, is a red case
 * here rather than a parity run that agreed about nothing.
 *
 * ## Why the sibling's directory, when planted-data cases already exist
 *
 * `effort/store/sqlite.test.ts`'s "parity with the NDJSON backend" and
 * `effort/collect.test.ts`'s "the session row both backends store"
 * already hold this same property on small, authored trees. Neither
 * can catch a real session log's own irregularities — an unusual
 * character in a branch name, a histogram key no planted row ever
 * carried, a commit subject someone pasted a tab into. Running the
 * real collector over the sibling's real logs is what a small fixture
 * cannot substitute for; that is the whole reason this suite is gated
 * on {@link resolveParityFixture} rather than planting its own tree
 * the way those two do. The freeze above copies those logs; it does
 * not simplify them.
 *
 * ## What "byte-identical" is checked against
 *
 * Neither backend's `read` answers raw disk bytes — NDJSON parses a
 * line with `JSON.parse`, SQLite parses `row_json` the same way — so
 * the strongest check reachable through the port is `JSON.stringify`
 * equality of what `read` answers, which is exact down to key order.
 * That is stronger than `toEqual`, which would call two rows equal
 * even if a field had silently changed position between the two
 * independent collections this file drives.
 *
 * The two collections are independent, not one batch fed to both
 * stores in lockstep (the shape the two planted-data cases above use).
 * Each backend gets its OWN run of the whole collector, reading the
 * logs and the git history over again. Ordering must therefore not be
 * assumed: the comparison indexes both sides by the row's own key —
 * the session id, the commit sha — before comparing, exactly as the
 * task names it, rather than comparing the two `read` arrays
 * position for position.
 *
 * ## Non-vacuity
 *
 * Two backends that stored nothing would agree perfectly and prove
 * nothing. Before any equality is asserted, the suite asserts a
 * nonzero row count for both kinds on both backends, so an empty
 * fixture — logs present but all outside some future `--since` bound,
 * say — fails loudly here rather than reading as a clean parity run.
 *
 * ## Where the git history and the plan roster come from
 *
 * `resolveParityFixture` locates exactly two things, by its own module
 * note: the session log directory and the sibling's stored rows.
 * Neither the plan roster nor the git history is one of them. The
 * commit half needs an actual repository to run `git log` in, and the
 * plan-stub grouping needs the roster that repository's `.plans/`
 * holds, so both are read from {@link SIBLING_CHECKOUT_ROOT} — the
 * checkout itself, derived from the home directory the same way the
 * fixture resolver's own (overridable) defaults are, and NOT from
 * `fixture.storeDir`, which a caller is free to point somewhere with
 * no repository behind it at all. `fixture.logDir` is still read from
 * the fixture, since it IS one of the two things the resolver locates
 * and does carry an override.
 *
 * `repoRoot` is passed as the checkout for exactly this reason, and a
 * store and the checkout's `.plans/` are passed explicitly for every run,
 * which is what keeps this suite from ever writing a store under the
 * sibling's root — see the module note on `effort/collect.ts`'s
 * `CollectOptions.store` for why passing both is what stops the config
 * file, its default store location and its `plan.dir`, from being
 * consulted at all.
 */
import type { FrozenParitySessionLogs } from './parity-fixture.js';
import type {
  CommitEffortRow,
  EffortStore,
  SessionEffortRow,
} from '../effort/store/types.js';

import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';

import { collectEffort } from '../effort/collect.js';
import { openNdjsonStore, openSqliteStore } from '../effort/store/index.js';

import {
  freezeParitySessionLogs,
  resolveParityFixture,
} from './parity-fixture.js';

/** Never throws; see the module note on {@link resolveParityFixture}. */
const fixture = resolveParityFixture();

/**
 * The sibling checkout on disk: a real git repository and a real
 * `.plans/` roster, read for the commit half and the plan-stub
 * grouping. See the module note on why this is not derived from
 * {@link fixture}'s own paths.
 */
const SIBLING_CHECKOUT_ROOT = join(homedir(), 'projects', 'agentic-research');

/** One backend's rows, of both kinds, read back once after collecting. */
interface Collected {
  sessions: SessionEffortRow[];
  commits: CommitEffortRow[];
}

/** One backend under test: a name for its results, and its opener. */
interface Backend {
  name: 'ndjson' | 'sqlite';
  open: (root: string) => EffortStore;
}

/**
 * Indexes rows by a key that must be a non-empty string, the same rule
 * every stored row is held to by the store port's own key projections
 * (`EFFORT_KEY_PROJECTIONS`, in `effort/store/types.ts`). Throwing on a
 * blank or duplicate key here would be a fault in the fixture or the
 * collector, not a property this suite is about, so both are asserted
 * explicitly rather than silently overwriting a map entry.
 */
function byKey<T>(rows: readonly T[], key: (row: T) => string): Map<string, T> {
  const map = new Map<string, T>();
  for (const row of rows) {
    const value = key(row);
    if (value.length === 0) {
      throw new Error('parity differential: a stored row carries no key');
    }
    if (map.has(value)) {
      throw new Error(`parity differential: key ${value} was stored twice`);
    }
    map.set(value, row);
  }
  return map;
}

/** Sessions grouped by plan stub, with an unattributed session under one bucket. */
function countsByPlanStub(
  rows: readonly SessionEffortRow[],
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of rows) {
    const stub = row.planStub ?? '(none)';
    counts[stub] = (counts[stub] ?? 0) + 1;
  }
  return counts;
}

/** Asserts every key on one side has a byte-identical counterpart on the other. */
function expectByteIdenticalByKey<T>(
  ndjsonRows: readonly T[],
  sqliteRows: readonly T[],
  key: (row: T) => string,
): void {
  const ndjsonByKey = byKey(ndjsonRows, key);
  const sqliteByKey = byKey(sqliteRows, key);

  expect([...sqliteByKey.keys()].sort()).toEqual([...ndjsonByKey.keys()].sort());
  for (const [rowKey, ndjsonRow] of ndjsonByKey) {
    const sqliteRow = sqliteByKey.get(rowKey);
    expect(JSON.stringify(sqliteRow)).toBe(JSON.stringify(ndjsonRow));
  }
}

const BACKENDS: readonly Backend[] = [
  { name: 'ndjson', open: openNdjsonStore },
  { name: 'sqlite', open: openSqliteStore },
];

const title = fixture.present
  ? 'the differential parity test, over the live sibling directory'
  : `the differential parity test (${fixture.reason})`;

/** The directory name the frozen logs sit in, under the temporary root. */
const FROZEN_LOG_DIR = 'frozen-logs';

let tempRoot: string | null = null;
let frozen: FrozenParitySessionLogs | null = null;
let ndjson: Collected | null = null;
let sqlite: Collected | null = null;

/**
 * Runs the whole collector once, into a fresh store over one backend,
 * reading the frozen copy of the logs rather than the live directory.
 */
async function collectOnce(
  store: EffortStore,
  logDir: string,
): Promise<Collected> {
  await collectEffort({
    repoRoot: SIBLING_CHECKOUT_ROOT,
    logDir,
    plansDir: join(SIBLING_CHECKOUT_ROOT, '.plans'),
    store,
    // The skill half writes under repoRoot whatever store is passed.
    skills: null,
    verbose: false,
    log: () => undefined,
  });
  return { sessions: store.read('sessions'), commits: store.read('commits') };
}

/**
 * Two full collector runs over the live sibling directory measured at
 * under 5 seconds apiece (2026-09-11), well inside bun's 5-second
 * default test timeout on its own — but that default is PER TEST, and
 * this `beforeAll` runs both. A generous ceiling here is what keeps a
 * slower machine, or a sibling directory that has grown, from failing
 * on the clock rather than on the comparison.
 */
const BEFORE_ALL_TIMEOUT_MS = 120_000;

describe.skipIf(!fixture.present)(title, () => {
  beforeAll(async () => {
    if (!fixture.present) {
      throw new Error('unreachable: the describe block is skipped when absent');
    }
    tempRoot = mkdtempSync(join(tmpdir(), 'rafa-parity-differential-'));
    frozen = freezeParitySessionLogs(
      fixture.logDir,
      join(tempRoot, FROZEN_LOG_DIR),
    );

    for (const backend of BACKENDS) {
      const result = await collectOnce(backend.open(tempRoot), frozen.dir);
      if (backend.name === 'ndjson') {
        ndjson = result;
      } else {
        sqlite = result;
      }
    }
  }, BEFORE_ALL_TIMEOUT_MS);

  afterAll(() => {
    if (tempRoot !== null) rmSync(tempRoot, { recursive: true, force: true });
  });

  /** The row set is not empty on either side; see the module note. */
  it('collects at least one session and one commit on both backends', () => {
    if (ndjson === null || sqlite === null) throw new Error('not collected');

    expect(ndjson.sessions.length).toBeGreaterThan(0);
    expect(ndjson.commits.length).toBeGreaterThan(0);
    expect(sqlite.sessions.length).toBe(ndjson.sessions.length);
    expect(sqlite.commits.length).toBe(ndjson.commits.length);
  });

  /**
   * The liveness control for the freeze. Byte-identity between two
   * readings of ONE frozen directory is cheap to satisfy the wrong way:
   * a freeze that copied nothing readable would make both backends
   * agree about rows that carry no counters at all. So this holds the
   * copy to the very fields the live race used to move —
   * {@link SessionEffortRow.sizeBytes} equal to the frozen file as it
   * stands AFTER both collections, and nonzero `lineCount` and
   * `recordCount` across the copy — and holds every stored row to a
   * log that is actually in it. The `ndjson` side alone is read here
   * because the case above already holds `sqlite` byte-identical to it.
   */
  it('holds the frozen copy still carrying the fields the race moved', () => {
    if (frozen === null || ndjson === null) throw new Error('not collected');

    expect(frozen.unread).toEqual([]);
    expect(frozen.logs.length).toBeGreaterThan(0);
    expect(ndjson.sessions.length).toBeLessThanOrEqual(frozen.logs.length);

    const frozenById = new Map(frozen.logs.map((log) => [log.sessionId, log]));
    for (const row of ndjson.sessions) {
      const log = frozenById.get(row.sessionId);
      if (log === undefined) {
        throw new Error(
          `parity differential: ${row.sessionId} is in no frozen log`,
        );
      }
      expect(row.filePath).toBe(log.path);
      expect(row.sizeBytes).toBe(statSync(log.path).size);
    }

    const totals = ndjson.sessions.reduce(
      (sums, row) => ({
        lineCount: sums.lineCount + row.lineCount,
        recordCount: sums.recordCount + row.recordCount,
        sizeBytes: sums.sizeBytes + row.sizeBytes,
      }),
      { lineCount: 0, recordCount: 0, sizeBytes: 0 },
    );

    expect(totals.sizeBytes).toBeGreaterThan(0);
    expect(totals.lineCount).toBeGreaterThan(0);
    expect(totals.recordCount).toBeGreaterThan(0);
  });

  it('holds every session row byte-identical between backends, keyed by session id', () => {
    if (ndjson === null || sqlite === null) throw new Error('not collected');

    expectByteIdenticalByKey(
      ndjson.sessions,
      sqlite.sessions,
      (row) => row.sessionId,
    );
  });

  it('holds every commit row byte-identical between backends, keyed by sha', () => {
    if (ndjson === null || sqlite === null) throw new Error('not collected');

    expectByteIdenticalByKey(ndjson.commits, sqlite.commits, (row) => row.sha);
  });

  it('agrees on the count of sessions per plan stub', () => {
    if (ndjson === null || sqlite === null) throw new Error('not collected');

    const ndjsonCounts = countsByPlanStub(ndjson.sessions);
    const sqliteCounts = countsByPlanStub(sqlite.sessions);

    // Non-vacuity for this specific case: a roster read as empty would
    // put every session under the same '(none)' bucket and the count
    // check below would hold trivially.
    expect(Object.keys(ndjsonCounts).length).toBeGreaterThan(0);
    expect(sqliteCounts).toEqual(ndjsonCounts);
  });
});
