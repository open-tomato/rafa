/**
 * The lineage parity test: collects the SIBLING's real session logs and
 * git history through rafa's NDJSON backend, and holds every row it
 * produces to the row the sibling's OWN collector already stored for
 * the same key, under `~/projects/agentic-research/.ralph/effort/`.
 *
 * This is the second of the two parity tests the spec calls for, and it
 * is not `parity-differential.test.ts`. That file runs the collector
 * TWICE, once per backend, over the same live inputs, and asks only
 * whether NDJSON and SQLite agree with EACH OTHER. This file runs the
 * collector ONCE, through the NDJSON backend alone, and asks whether
 * rafa reproduces what a DIFFERENT, older collector already wrote — the
 * sibling's own `tools/ralph/effort/collect.ts`, before this package
 * existed. That is the property phase 0's cutover actually depends on:
 * the sibling can point its `ralph` script at this package without
 * losing the 1,052 session rows and 1,212 commit rows it already holds,
 * because rafa's port answers what its own collector would have
 * answered for every one of them.
 *
 * ## Three accounted-for exceptions, and nothing else
 *
 * A stored row is not always byte-identical to what a fresh collect of
 * TODAY's logs answers for the same key, for reasons this suite knows
 * about and checks explicitly rather than silently tolerating. Any
 * OTHER field difference fails the test — this is not a blanket
 * "close enough" comparison.
 *
 *   - Two fields the stored rows never carry. `mode` and
 *     `issueIdentifier` are the reconciled schema's widening (see the
 *     module note on `SessionEffortRow`), and every one of the
 *     sibling's stored rows predates both. Projecting a fresh row down
 *     to the sibling's own key set — dropping exactly these two — is
 *     step one of every session comparison below, not a per-row
 *     exception; {@link siblingProjection} is where it happens.
 *   - A HAND-PATCHED `planStub`. Some of the sibling's stored rows
 *     (measured 2026-09-11: 74 of 1,052) carry a `planStubPatch` object
 *     recording that an analyst overrode `planStub` by hand, on a
 *     session whose own attribution had resolved to no match — every
 *     one of those rows' `planStubMatch` reads `'none'`, and `planStub`
 *     is non-null only because of the patch. A fresh collect cannot
 *     reproduce an analyst's decision from the raw log, and re-derives
 *     `planStub` as `null`, which is what the row would have held
 *     before the patch. So `planStub` is excluded from the comparison
 *     on exactly these rows, and the exclusion is itself asserted: the
 *     fresh value must be `null` and the stored `planStubMatch` must be
 *     `'none'`, so a future collector that DID resolve one of these
 *     sessions on its own turns this from a silent pass into a loud
 *     failure.
 *   - A GROWN session log. A few of the sibling's stored rows (measured
 *     2026-09-11: 3 of 1,052) are frozen mid-session in exactly the
 *     sense the module note on `effort/collect.ts` describes: the log
 *     at `sessionId` kept being appended to after the sibling's
 *     collector read it, so `sizeBytes` and `modifiedAt` on disk today
 *     exceed what the stored row froze. Every content-derived field on
 *     such a row is legitimately different — more lines, more records,
 *     a later `lastTimestamp`, a bigger `usage` — and comparing them
 *     would be comparing two different amounts of the same session, so
 *     the row's comparison is limited to confirming the growth itself:
 *     neither `sizeBytes` nor `modifiedAt` may have moved BACKWARD.
 *     {@link hasGrown} throws, rather than answering false, on a row
 *     that shrank, so a truncated log masquerading as an unrelated
 *     mismatch still fails loudly.
 *
 * A row with neither exception is held to full equality, field for
 * field, in the sibling's own key order — the same order a fresh row
 * projects to once `mode` and `issueIdentifier` are dropped, since
 * `effort/collect.ts` builds it by spreading the session stats and then
 * appending the rest in the reconciled schema's order. `JSON.stringify`
 * equality is exact down to key order, the same reasoning
 * `parity-differential.test.ts` gives for preferring it over `toEqual`.
 *
 * ## Commits need none of the three
 *
 * `CommitEffortRow` (`= CommitStats`) is exactly the sibling's
 * `commits.ndjson` schema, key for key and in the same order — measured
 * with the live store: every one of the sibling's stored commit rows
 * compares byte-identical to what a fresh collect answers for the same
 * sha, with none missing. So the commit half is one full-equality pass
 * with no projection and no exception, which is itself the evidence
 * that the two schemas never diverged.
 *
 * ## Where the sibling's own rows are read from, and why never rewritten
 *
 * {@link readStoreRows} (`../effort/store.js`) is read-only: it
 * `JSON.parse`s each line of {@link ParityFixturePaths.sessionsPath} and
 * {@link ParityFixturePaths.commitsPath} and asserts nothing about the
 * shape beyond "a plain JSON object", so a row predating fields this
 * package added reads back exactly the object it was written as. This
 * suite never opens a store bound to the sibling's own directory — only
 * that one read function, which appends nothing — so a run can never
 * write into `~/projects/agentic-research/.ralph/`. The fresh side is
 * collected into its own temporary root, the same way
 * `parity-differential.test.ts` does it and for the same reason; see
 * that file's module note for why `repoRoot` is the checkout derived
 * from the home directory rather than {@link ParityFixturePaths.storeDir}.
 */
import type { ParityFixturePaths } from './parity-fixture.js';
import type {
  CommitEffortRow,
  SessionEffortRow,
} from '../effort/store/types.js';

import { mkdtempSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';

import { collectEffort } from '../effort/collect.js';
import { openNdjsonStore } from '../effort/store/index.js';
import { readStoreRows } from '../effort/store.js';

import { resolveParityFixture } from './parity-fixture.js';

/** Never throws; see the module note on {@link resolveParityFixture}. */
const fixture = resolveParityFixture();

/**
 * The sibling checkout on disk: a real git repository and a real
 * `.plans/` roster, read for the commit half and the plan-stub
 * attribution. Derived the same way, and for the same reason, as
 * `parity-differential.test.ts`'s own constant of this name — see that
 * file's module note.
 */
const SIBLING_CHECKOUT_ROOT = join(homedir(), 'projects', 'agentic-research');

/** Session fields the reconciled schema added; absent from every stored row. */
const SESSION_FIELDS_UNKNOWN_TO_SIBLING = ['mode', 'issueIdentifier'] as const;

/** The one key a stored row carries that a fresh row never does. */
const STORED_ONLY_SESSION_FIELD = 'planStubPatch';

/** Drops the named keys from a plain object, preserving the order of what remains. */
function omit(row: object, keys: readonly string[]): Record<string, unknown> {
  const dropped = new Set(keys);
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (!dropped.has(key)) result[key] = value;
  }
  return result;
}

/**
 * Projects a freshly-collected row onto the sibling's own key set: the
 * two fields the reconciled schema added, plus whatever else the
 * caller names for one row's own exception.
 */
function siblingProjection(
  row: SessionEffortRow,
  extra: readonly string[] = [],
): Record<string, unknown> {
  return omit(row, [...SESSION_FIELDS_UNKNOWN_TO_SIBLING, ...extra]);
}

/**
 * Projects a stored row for comparison: drops `planStubPatch`, which a
 * fresh row never carries, plus whatever else the caller names for one
 * row's own exception.
 */
function storedProjection(
  stored: Record<string, unknown>,
  extra: readonly string[] = [],
): Record<string, unknown> {
  return omit(stored, [STORED_ONLY_SESSION_FIELD, ...extra]);
}

/** A stored row's string field, asserted rather than trusted — see the module note. */
function storedString(row: Record<string, unknown>, field: string): string {
  const value = row[field];
  if (typeof value !== 'string') {
    throw new Error(`parity lineage: stored row's ${field} is not a string (${String(value)})`);
  }
  return value;
}

/** A stored row's number field, asserted rather than trusted — see the module note. */
function storedNumber(row: Record<string, unknown>, field: string): number {
  const value = row[field];
  if (typeof value !== 'number') {
    throw new Error(`parity lineage: stored row's ${field} is not a number (${String(value)})`);
  }
  return value;
}

/** Whether a stored session row carries the hand-patch marker. */
function isHandPatched(stored: Record<string, unknown>): boolean {
  return STORED_ONLY_SESSION_FIELD in stored;
}

/**
 * Whether the session log at `fresh.sessionId` grew after the sibling's
 * own collector froze `stored`. Read off `sizeBytes` and `modifiedAt`
 * alone — see the module note. Throws, rather than answering false, when
 * either moved backward: that is not growth, and waving it through this
 * check would hide a truncated log behind the wrong exception.
 */
function hasGrown(stored: Record<string, unknown>, fresh: SessionEffortRow): boolean {
  const storedSize = storedNumber(stored, 'sizeBytes');
  const storedModifiedAt = storedString(stored, 'modifiedAt');

  if (fresh.sizeBytes === storedSize && fresh.modifiedAt === storedModifiedAt) {
    return false;
  }
  if (fresh.sizeBytes < storedSize || fresh.modifiedAt < storedModifiedAt) {
    throw new Error(
      `parity lineage: ${fresh.sessionId} shrank since it was stored`
      + ` (stored sizeBytes=${storedSize} modifiedAt=${storedModifiedAt},`
      + ` fresh sizeBytes=${fresh.sizeBytes} modifiedAt=${fresh.modifiedAt})`,
    );
  }
  return true;
}

/**
 * Indexes rows by a key that must be a non-empty string, the same rule
 * every stored row is held to by the store port's own key projections.
 * Throwing here on a blank or duplicate key is a fault in the fixture or
 * the collector, not a property this suite is about.
 */
function indexByKey<T>(
  rows: readonly T[],
  key: (row: T) => string,
  label: string,
): Map<string, T> {
  const map = new Map<string, T>();
  for (const row of rows) {
    const value = key(row);
    if (value.length === 0) {
      throw new Error(`parity lineage: a ${label} row carries no key`);
    }
    if (map.has(value)) {
      throw new Error(`parity lineage: ${label} key ${value} appears twice`);
    }
    map.set(value, row);
  }
  return map;
}

/** A fresh row's counterpart for a stored key, or a thrown, named absence. */
function freshCounterpartOf<T>(
  freshByKey: ReadonlyMap<string, T>,
  key: string,
  label: string,
): T {
  const fresh = freshByKey.get(key);
  if (fresh === undefined) {
    throw new Error(`parity lineage: stored ${label} ${key} has no fresh counterpart`);
  }
  return fresh;
}

const title = fixture.present
  ? 'the lineage parity test, over the live sibling directory'
  : `the lineage parity test (${fixture.reason})`;

/**
 * One full collector run over the live sibling directory measured at
 * under 5 seconds (2026-09-11) — see `parity-differential.test.ts`'s own
 * constant of this name for why the ceiling is generous regardless.
 */
const BEFORE_ALL_TIMEOUT_MS = 120_000;

let tempRoot: string | null = null;
let freshSessions: SessionEffortRow[] | null = null;
let freshCommits: CommitEffortRow[] | null = null;
let storedSessions: Record<string, unknown>[] | null = null;
let storedCommits: Record<string, unknown>[] | null = null;

describe.skipIf(!fixture.present)(title, () => {
  beforeAll(async () => {
    if (!fixture.present) {
      throw new Error('unreachable: the describe block is skipped when absent');
    }
    const fixturePaths: ParityFixturePaths = fixture;
    tempRoot = mkdtempSync(join(tmpdir(), 'rafa-parity-lineage-'));
    const store = openNdjsonStore(tempRoot);

    await collectEffort({
      repoRoot: SIBLING_CHECKOUT_ROOT,
      logDir: fixturePaths.logDir,
      store,
      verbose: false,
      log: () => undefined,
    });

    freshSessions = store.read('sessions');
    freshCommits = store.read('commits');
    storedSessions = readStoreRows<Record<string, unknown>>(
      fixturePaths.sessionsPath,
    ).rows;
    storedCommits = readStoreRows<Record<string, unknown>>(
      fixturePaths.commitsPath,
    ).rows;
  }, BEFORE_ALL_TIMEOUT_MS);

  afterAll(() => {
    if (tempRoot !== null) rmSync(tempRoot, { recursive: true, force: true });
  });

  /** Non-vacuity: two independently-empty stores would agree on nothing. */
  it('collects a nonzero row set on both sides, for both kinds', () => {
    if (
      freshSessions === null || freshCommits === null
      || storedSessions === null || storedCommits === null
    ) {
      throw new Error('not collected');
    }

    expect(storedSessions.length).toBeGreaterThan(0);
    expect(storedCommits.length).toBeGreaterThan(0);
    expect(freshSessions.length).toBeGreaterThan(0);
    expect(freshCommits.length).toBeGreaterThan(0);
  });

  it('matches every plainly-stored session row to its fresh counterpart, byte for byte', () => {
    if (freshSessions === null || storedSessions === null) throw new Error('not collected');

    const freshByKey = indexByKey(freshSessions, (row) => row.sessionId, 'session');
    let compared = 0;

    for (const stored of storedSessions) {
      if (isHandPatched(stored)) continue;

      const sessionId = storedString(stored, 'sessionId');
      const fresh = freshCounterpartOf(freshByKey, sessionId, 'session');
      if (hasGrown(stored, fresh)) continue;

      expect(JSON.stringify(siblingProjection(fresh))).toBe(
        JSON.stringify(storedProjection(stored)),
      );
      compared += 1;
    }

    // Non-vacuity: most stored rows should carry neither exception.
    expect(compared).toBeGreaterThan(0);
  });

  it('accounts for every hand-patched planStub, rather than comparing it', () => {
    if (freshSessions === null || storedSessions === null) throw new Error('not collected');

    const freshByKey = indexByKey(freshSessions, (row) => row.sessionId, 'session');
    const patched = storedSessions.filter(isHandPatched);

    // Non-vacuity: the fixture this exception was written for.
    expect(patched.length).toBeGreaterThan(0);

    for (const stored of patched) {
      const sessionId = storedString(stored, 'sessionId');
      const fresh = freshCounterpartOf(freshByKey, sessionId, 'session');

      // The patch exists because the collector's own attribution had
      // resolved to no match; a fresh run must resolve the same way, or
      // the patch is stale and this exception should not apply to it.
      expect(storedString(stored, 'planStubMatch')).toBe('none');
      expect(fresh.planStub).toBeNull();

      if (hasGrown(stored, fresh)) continue;

      expect(JSON.stringify(siblingProjection(fresh, ['planStub']))).toBe(
        JSON.stringify(storedProjection(stored, ['planStub'])),
      );
    }
  });

  it('accounts for every grown session log: neither size nor mtime moved backward', () => {
    if (freshSessions === null || storedSessions === null) throw new Error('not collected');

    const freshByKey = indexByKey(freshSessions, (row) => row.sessionId, 'session');
    let grown = 0;

    for (const stored of storedSessions) {
      const sessionId = storedString(stored, 'sessionId');
      const fresh = freshCounterpartOf(freshByKey, sessionId, 'session');
      if (hasGrown(stored, fresh)) grown += 1;
    }

    // Non-vacuity: the fixture this exception was written for.
    expect(grown).toBeGreaterThan(0);
  });

  it('matches every stored commit row to its fresh counterpart, byte for byte', () => {
    if (freshCommits === null || storedCommits === null) throw new Error('not collected');

    const freshByKey = indexByKey(freshCommits, (row) => row.sha, 'commit');

    for (const stored of storedCommits) {
      const sha = storedString(stored, 'sha');
      const fresh = freshCounterpartOf(freshByKey, sha, 'commit');

      expect(JSON.stringify(fresh)).toBe(JSON.stringify(stored));
    }
  });
});
