/**
 * Tests for the bug-route writer and the reader of a plan's rows.
 *
 * Every store sits under a fresh temporary repo root, and the disk is
 * real; none opens `.rafa/effort/` of this checkout. Every reading of
 * what a write left goes through `bun:sqlite` directly and never through
 * the module, with its columns named, so the column names and the dedupe
 * rule are spelled here rather than read off the code under test. The
 * table's own CHECKs and indexes are read in
 * `bug-routes-migration.test.ts`.
 *
 * Each refusal sits beside the write it was varied from, which the store
 * takes, so a writer refusing everything reddens.
 *
 * The reader's cases read a store written through `writeBugRoutes`
 * rather than planted, so the columns the writer fills and the ones the
 * reader answers are checked against each other. Every case asking for
 * one stub writes rows under another stub and under none beside them.
 */
import type { BugRouteEntry, BugRoutesWrite, BugRoutesWriteResult } from './bug-routes.js';
import type { FindingsWriterSeams } from './findings.js';

import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { Database } from 'bun:sqlite';
import { afterAll, describe, expect, it } from 'bun:test';

import { bringForward } from './bring-forward.js';
import { BUG_ROUTES, readBugRoutesForPlan, writeBugRoutes } from './bug-routes.js';
import { SQLITE_MIGRATIONS, SQLITE_SCHEMA_VERSION } from './migrations.js';

/** A `bug_routes` row as the table holds it. */
interface StoredBugRoute {
  seq: number;
  id: string;
  session_id: string;
  plan_stub: string | null;
  task_line: string;
  entry_index: number;
  what: string;
  said: string | null;
  kind: string;
  route: string;
  collected_at: string;
  origin_store: string | null;
  origin_seq: number | null;
}

/** The table's columns, in order. */
const COLUMNS = [
  'seq',
  'id',
  'session_id',
  'plan_stub',
  'task_line',
  'entry_index',
  'what',
  'said',
  'kind',
  'route',
  'collected_at',
  'origin_store',
  'origin_seq',
];

const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-bug-routes-')));
let planted = 0;

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** A repo root of its own, not yet on disk, so no case sees another's. */
function freshRoot(name: string): string {
  planted += 1;
  return join(tempBase, `${String(planted)}-${name}`);
}

/** The store file under a root. */
function storeFile(root: string): string {
  return join(root, '.rafa', 'effort', 'effort.sqlite');
}

/** The store file's bytes, or null when nothing was ever written. */
function readRaw(root: string): Buffer | null {
  const path = storeFile(root);
  return existsSync(path)
    ? readFileSync(path)
    : null;
}

/** Runs one query against the store file, read-only, module uninvolved. */
function rawQuery<T>(root: string, sql: string): T[] {
  const db = new Database(storeFile(root), { readonly: true });
  try {
    return db.query<T, []>(sql).all();
  } finally {
    db.close();
  }
}

/** Every `bug_routes` row, in `seq` order. */
function rowsOf(root: string): StoredBugRoute[] {
  return rawQuery<StoredBugRoute>(root, `SELECT ${COLUMNS.join(', ')} FROM bug_routes ORDER BY seq`);
}

/** One column of every row, in `seq` order. */
function columnOf(root: string, column: string): unknown[] {
  const sql = `SELECT ${column} AS value FROM bug_routes ORDER BY seq`;
  return rawQuery<{ value: unknown }>(root, sql).map(({ value }) => value);
}

/** Sets the store's `user_version` one past the last this rafa knows. */
function bumpPastThisRafa(root: string): void {
  const db = new Database(storeFile(root));
  try {
    db.run(`PRAGMA user_version = ${String(SQLITE_SCHEMA_VERSION + 1)}`);
  } finally {
    db.close();
  }
}

/** The refusal of a store one version past this rafa's. */
const PAST_THIS_RAFA = `has a migration log and schema version ${String(SQLITE_SCHEMA_VERSION + 1)};`;

/** A routed entry, every field filled. */
function route(overrides: Partial<BugRouteEntry> = {}): BugRouteEntry {
  return {
    entryIndex: 0,
    what: 'the helper drops a row',
    said: 'own-fallout',
    kind: 'own-fallout',
    route: 'repair',
    ...overrides,
  };
}

/** The stub most cases write under. */
const STUB = 'rafa-1077-spec-what-plan-broke';

/** The dispatch most cases write under. */
const DISPATCH = {
  sessionId: 'bbbb-2222',
  planStub: STUB,
  taskLine: 'Add the route rows',
};

/** A write of no entry under the default dispatch, with `overrides` laid over it. */
function writeOf(overrides: Partial<BugRoutesWrite> = {}): BugRoutesWrite {
  return { dispatch: DISPATCH, routes: [], ...overrides };
}

/** The time every seamed write stamps, unless a case passes its own. */
const WRITTEN_AT = '2026-10-14T10:00:00.000Z';

/** Ids no other case generates, and a fixed clock. */
function seams(prefix: string, at: string = WRITTEN_AT): Required<FindingsWriterSeams> {
  let count = 0;
  return {
    now: () => new Date(at),
    newId: () => {
      count += 1;
      return `${prefix}-${String(count)}`;
    },
  };
}

/** A write's counts and the indexes it refused, path left out. */
function counts(result: BugRoutesWriteResult): unknown {
  return {
    appended: result.appended,
    skipped: result.skipped,
    rejected: result.rejected.map(({ index }) => index),
  };
}

/** Counts in the shape {@link counts} answers. */
function countsOf(appended: number, skipped: number, rejected: number[] = []): unknown {
  return { appended, skipped, rejected };
}

describe('writeBugRoutes rows', () => {
  it('writes one row per routed entry: dispatch, entry, kinds, route, write time', () => {
    const root = freshRoot('rows');
    const routes = [
      route(),
      route({ entryIndex: 1, what: 'the file is too long', said: 'convention', kind: 'convention', route: 'pr-body' }),
    ];

    const result = writeBugRoutes(root, writeOf({ routes }), seams('rows'));

    expect(result).toEqual({ path: storeFile(root), appended: 2, skipped: 0, rejected: [] });
    const provenance = {
      session_id: 'bbbb-2222',
      plan_stub: STUB,
      task_line: 'Add the route rows',
      collected_at: WRITTEN_AT,
      origin_store: null,
      origin_seq: null,
    };
    expect(rowsOf(root)).toEqual([
      {
        seq: 1, id: 'rows-1', ...provenance,
        entry_index: 0, what: 'the helper drops a row', said: 'own-fallout', kind: 'own-fallout', route: 'repair',
      },
      {
        seq: 2, id: 'rows-2', ...provenance,
        entry_index: 1, what: 'the file is too long', said: 'convention', kind: 'convention', route: 'pr-body',
      },
    ]);
  });

  it('stores a said kind of null as NULL, beside the kind the loop routed it under', () => {
    const root = freshRoot('said-null');

    writeBugRoutes(root, writeOf({ routes: [route({ said: null, kind: 'bug', route: 'filed' })] }), seams('said-null'));

    expect(rowsOf(root).map(({ said, kind, route: where }) => [said, kind, where])).toEqual([[null, 'bug', 'filed']]);
  });

  it.each([...BUG_ROUTES])('stores the route %s', (where) => {
    const root = freshRoot(`route-${where}`);

    const result = writeBugRoutes(root, writeOf({ routes: [route({ route: where })] }), seams(`route-${where}`));

    expect(counts(result)).toEqual(countsOf(1, 0));
    expect(columnOf(root, 'route')).toEqual([where]);
  });

  it('stamps every row with one time, taken once', () => {
    const root = freshRoot('clock');
    let reads = 0;
    const clock = {
      ...seams('clock'),
      now: () => {
        reads += 1;
        return new Date(Date.UTC(2026, 9, 14, 10, reads));
      },
    };
    const routes = [route(), route({ entryIndex: 1 }), route({ entryIndex: 2 })];

    writeBugRoutes(root, writeOf({ routes }), clock);

    expect(reads).toBe(1);
    expect(columnOf(root, 'collected_at')).toEqual(Array(3).fill('2026-10-14T10:01:00.000Z'));
  });

  it('generates a distinct UUID per row and reads the clock by default', () => {
    const root = freshRoot('defaults');
    const before = Date.now();

    writeBugRoutes(root, writeOf({ routes: [route(), route({ entryIndex: 1 })] }));

    const ids = columnOf(root, 'id');
    expect(new Set(ids).size).toBe(2);
    for (const id of ids) expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    const stamps = columnOf(root, 'collected_at').map((at) => Date.parse(String(at)));
    for (const stamp of stamps) expect(stamp).toBeGreaterThanOrEqual(before - 1000);
  });
});

describe('a null plan stub', () => {
  it('stores the stub as NULL, beside a row written under a stub', () => {
    const root = freshRoot('null-stub-row');
    const unplanned = { sessionId: 'cccc-3333', planStub: null, taskLine: 'Sweep the board' };

    const result = writeBugRoutes(root, writeOf({ dispatch: unplanned, routes: [route()] }), seams('null-stub-1'));
    writeBugRoutes(root, writeOf({ routes: [route()] }), seams('null-stub-2'));

    expect(counts(result)).toEqual(countsOf(1, 0));
    expect(columnOf(root, 'plan_stub')).toEqual([null, STUB]);
  });

  it('is read back by the null stub alone, and no stub reads its row', () => {
    const root = freshRoot('null-stub-read');
    const unplanned = { sessionId: 'cccc-3333', planStub: null, taskLine: 'Sweep the board' };
    writeBugRoutes(root, writeOf({ dispatch: unplanned, routes: [route({ what: 'unplanned' })] }), seams('null-read-1'));
    writeBugRoutes(root, writeOf({ routes: [route({ what: 'planned' })] }), seams('null-read-2'));

    expect(readBugRoutesForPlan(root, null).map(({ what, planStub }) => [what, planStub])).toEqual([['unplanned', null]]);
    expect(readBugRoutesForPlan(root, STUB).map(({ what }) => what)).toEqual(['planned']);
    // The control: a stub of the empty string is no null, and reads nothing.
    expect(readBugRoutesForPlan(root, '')).toEqual([]);
  });
});

describe('a repeated write', () => {
  it('writes its rows once, changing no byte the second time', () => {
    const root = freshRoot('repeat');
    const routes = [route(), route({ entryIndex: 1, what: 'a second entry', said: null, kind: 'bug', route: 'filed' })];
    const first = writeBugRoutes(root, writeOf({ routes }), seams('repeat-1'));
    const before = readRaw(root);

    const second = writeBugRoutes(root, writeOf({ routes }), seams('repeat-2', '2026-10-14T11:00:00.000Z'));

    expect(counts(first)).toEqual(countsOf(2, 0));
    expect(counts(second)).toEqual(countsOf(0, 2));
    expect(readRaw(root)).toEqual(before);
    expect(columnOf(root, 'id')).toEqual(['repeat-1-1', 'repeat-1-2']);
  });

  it('keeps the first route of an entry routed again, whatever the second says', () => {
    const root = freshRoot('rerouted');
    writeBugRoutes(root, writeOf({ routes: [route()] }), seams('rerouted-1'));

    const again = writeBugRoutes(root, writeOf({ routes: [route({ kind: 'bug', route: 'filed' })] }), seams('rerouted-2'));

    expect(counts(again)).toEqual(countsOf(0, 1));
    expect(rowsOf(root).map(({ id, kind, route: where }) => [id, kind, where])).toEqual([['rerouted-1-1', 'own-fallout', 'repair']]);
  });

  it('keeps the first of two identical entries within a write', () => {
    const root = freshRoot('within');

    const result = writeBugRoutes(root, writeOf({ routes: [route(), route({ route: 'follow-up' })] }), seams('within'));

    expect(counts(result)).toEqual(countsOf(1, 1));
    expect(columnOf(root, 'route')).toEqual(['repair']);
  });

  it('stores two entries of one report sharing a what as two rows, by their index', () => {
    const root = freshRoot('shared-what');

    const result = writeBugRoutes(root, writeOf({ routes: [route(), route({ entryIndex: 1 })] }), seams('shared-what'));

    expect(counts(result)).toEqual(countsOf(2, 0));
    expect(columnOf(root, 'entry_index')).toEqual([0, 1]);
  });

  it('stores the same entry again for another session', () => {
    const root = freshRoot('other-session');
    writeBugRoutes(root, writeOf({ routes: [route()] }), seams('other-session-1'));
    const other = { ...DISPATCH, sessionId: 'dddd-4444' };

    const result = writeBugRoutes(root, writeOf({ dispatch: other, routes: [route()] }), seams('other-session-2'));

    expect(counts(result)).toEqual(countsOf(1, 0));
    expect(columnOf(root, 'session_id')).toEqual(['bbbb-2222', 'dddd-4444']);
  });

  it('matches what byte for byte, so a differing entry is a row of its own', () => {
    const root = freshRoot('byte-match');
    writeBugRoutes(root, writeOf({ routes: [route()] }), seams('byte-match-1'));

    const result = writeBugRoutes(root, writeOf({ routes: [route({ what: 'the helper drops a row ' })] }), seams('byte-match-2'));

    expect(counts(result)).toEqual(countsOf(1, 0));
  });
});

describe('a refused row', () => {
  it.each([
    ['a null what', { what: null as never }, 'missing-field', 'what', 'bug routes[1].what is missing; not written'],
    ['a blank what', { what: '  ' }, 'unstorable-field', 'what', 'bug routes[1].what is blank; not written'],
    ['a lone surrogate in what', { what: 'x\uDC00' }, 'unstorable-field', 'what', 'lone UTF-16 surrogate'],
    ['a negative entry index', { entryIndex: -1 }, 'unstorable-field', 'entryIndex', 'is -1, not a non-negative integer'],
    ['a fractional entry index', { entryIndex: 1.5 }, 'unstorable-field', 'entryIndex', 'is 1.5, not a non-negative integer'],
    ['a said kind outside the set', { said: 'oops' as never }, 'unstorable-field', 'said', 'is "oops", not one of bug, own-fallout'],
    ['a null kind', { kind: null as never }, 'missing-field', 'kind', 'bug routes[1].kind is missing'],
    ['a kind outside the set', { kind: 'flaky' as never }, 'unstorable-field', 'kind', 'is "flaky", not one of bug'],
    ['a null route', { route: null as never }, 'missing-field', 'route', 'bug routes[1].route is missing'],
    ['a route outside the set', { route: 'public' as never }, 'unstorable-field', 'route', 'is "public", not one of filed, private'],
  ] as const)('refuses %s alone, writing the rows beside it', (_label, overrides, reason, field, text) => {
    const root = freshRoot('refused-row');
    const routes = [route(), route({ entryIndex: 1, what: 'the refused one', ...overrides }), route({ entryIndex: 2 })];

    const result = writeBugRoutes(root, writeOf({ routes }), seams('refused-row'));

    expect(counts(result)).toEqual(countsOf(2, 0, [1]));
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]).toMatchObject({ index: 1, reason, field });
    expect(result.rejected[0]?.text).toContain(text);
    expect(columnOf(root, 'entry_index')).toEqual([0, 2]);
  });

  it('takes the same row once its field is one the table holds (control)', () => {
    const root = freshRoot('refused-control');
    const refused = route({ entryIndex: 1, route: 'public' as never });

    const before = writeBugRoutes(root, writeOf({ routes: [refused] }), seams('refused-control-1'));
    const taken = writeBugRoutes(root, writeOf({ routes: [{ ...refused, route: 'private' }] }), seams('refused-control-2'));

    expect(counts(before)).toEqual(countsOf(0, 0, [0]));
    expect(counts(taken)).toEqual(countsOf(1, 0));
    expect(columnOf(root, 'route')).toEqual(['private']);
  });

  it('adds up: appended, skipped and rejected', () => {
    const root = freshRoot('adds-up');
    writeBugRoutes(root, writeOf({ routes: [route()] }), seams('adds-up-1'));
    const routes = [route(), route({ entryIndex: 1, kind: 'flaky' as never }), route({ entryIndex: 2 })];

    const result = writeBugRoutes(root, writeOf({ routes }), seams('adds-up-2'));

    expect(counts(result)).toEqual(countsOf(1, 1, [1]));
    expect(result.appended + result.skipped + result.rejected.length).toBe(routes.length);
  });

  it('creates no file and no directory when every row is refused', () => {
    const root = freshRoot('all-refused');

    const result = writeBugRoutes(root, writeOf({ routes: [route({ what: '' }), route({ route: 'nowhere' as never })] }));

    expect(counts(result)).toEqual(countsOf(0, 0, [0, 1]));
    expect(existsSync(root)).toBe(false);
  });

  it('creates no file and no directory for an empty list', () => {
    const root = freshRoot('empty');

    expect(counts(writeBugRoutes(root, writeOf()))).toEqual(countsOf(0, 0));
    expect(existsSync(root)).toBe(false);
  });
});

describe('whole-write refusals', () => {
  it.each([
    ['an empty session id', { ...DISPATCH, sessionId: '' }, 'session id ""'],
    ['a null task line', { ...DISPATCH, taskLine: null as never }, 'task line null'],
    ['a numeric plan stub', { ...DISPATCH, planStub: 7 as never }, 'plan stub 7'],
  ] as const)('refuses %s with an entry to write, creating nothing', (_label, dispatch, why) => {
    const root = freshRoot('refused-write');

    expect(() => writeBugRoutes(root, writeOf({ dispatch, routes: [route()] })))
      .toThrow(`effort store: bug routes write has ${why}`);
    expect(existsSync(root)).toBe(false);

    // The control: the same entry under the default dispatch is stored.
    expect(counts(writeBugRoutes(root, writeOf({ routes: [route()] })))).toEqual(countsOf(1, 0));
  });

  it('refuses before opening an existing store, changing no byte', () => {
    const root = freshRoot('refused-existing');
    writeBugRoutes(root, writeOf({ routes: [route()] }), seams('refused-existing'));
    const before = readRaw(root);
    const dispatch = { ...DISPATCH, sessionId: '' };

    expect(() => writeBugRoutes(root, writeOf({ dispatch, routes: [route({ entryIndex: 1 })] })))
      .toThrow('effort store: bug routes write has session id ""');
    expect(readRaw(root)).toEqual(before);
  });

  it('rolls the write back when a generated id repeats', () => {
    const root = freshRoot('id-repeat');
    writeBugRoutes(root, writeOf({ routes: [route()] }), seams('id-repeat'));
    const before = readRaw(root);
    const routes = [route({ entryIndex: 1 }), route({ entryIndex: 2 })];

    expect(() => writeBugRoutes(root, writeOf({ routes }), { newId: () => 'same' }))
      .toThrow('UNIQUE constraint failed: bug_routes.id');
    expect(readRaw(root)).toEqual(before);
    expect(columnOf(root, 'id')).toEqual(['id-repeat-1']);
  });

  it('refuses a store past the version this rafa knows, an empty write included, bytes untouched', () => {
    const root = freshRoot('newer');
    writeBugRoutes(root, writeOf({ routes: [route()] }), seams('newer'));
    const current = readRaw(root);

    // The control: an empty write on a current store opens it and changes
    // nothing, so the refusals below are the version and not the emptiness.
    expect(counts(writeBugRoutes(root, writeOf()))).toEqual(countsOf(0, 0));
    expect(readRaw(root)).toEqual(current);

    bumpPastThisRafa(root);
    const before = readRaw(root);

    expect(() => writeBugRoutes(root, writeOf({ routes: [route({ entryIndex: 1 })] }), seams('newer-2')))
      .toThrow(PAST_THIS_RAFA);
    expect(() => writeBugRoutes(root, writeOf())).toThrow(PAST_THIS_RAFA);
    expect(readRaw(root)).toEqual(before);
  });
});

describe('readBugRoutesForPlan', () => {
  /** A store holding rows under the stub, another stub and none, in that order of writes. */
  function mixedRoot(name: string): string {
    const root = freshRoot(name);
    writeBugRoutes(root, writeOf({ routes: [route({ what: 'first' }), route({ entryIndex: 1, what: 'second' })] }), seams(`${name}-1`));
    const other = { ...DISPATCH, sessionId: 'eeee-5555', planStub: 'another-plan' };
    writeBugRoutes(root, writeOf({ dispatch: other, routes: [route({ what: 'elsewhere' })] }), seams(`${name}-2`));
    const unplanned = { ...DISPATCH, sessionId: 'ffff-6666', planStub: null };
    writeBugRoutes(root, writeOf({ dispatch: unplanned, routes: [route({ what: 'unplanned' })] }), seams(`${name}-3`));
    const later = { ...DISPATCH, sessionId: 'gggg-7777' };
    writeBugRoutes(root, writeOf({ dispatch: later, routes: [route({ what: 'third' })] }), seams(`${name}-4`, '2026-10-14T12:00:00.000Z'));
    return root;
  }

  it('answers every row under the stub, in append order, and no other stub\'s', () => {
    const root = mixedRoot('read-stub');

    expect(readBugRoutesForPlan(root, STUB).map(({ what }) => what)).toEqual(['first', 'second', 'third']);
    expect(readBugRoutesForPlan(root, 'another-plan').map(({ what }) => what)).toEqual(['elsewhere']);
  });

  it('answers each row whole', () => {
    const root = freshRoot('read-whole');
    writeBugRoutes(root, writeOf({ routes: [route({ said: null, kind: 'bug', route: 'inherited' })] }), seams('read-whole'));

    expect(readBugRoutesForPlan(root, STUB)).toEqual([{
      id: 'read-whole-1',
      sessionId: 'bbbb-2222',
      planStub: STUB,
      taskLine: 'Add the route rows',
      entryIndex: 0,
      what: 'the helper drops a row',
      said: null,
      kind: 'bug',
      route: 'inherited',
      collectedAt: WRITTEN_AT,
    }]);
  });

  it('orders by the stamp, not the local seq, when a clock goes backwards', () => {
    const root = freshRoot('read-backwards');
    writeBugRoutes(root, writeOf({ routes: [route({ what: 'written first' })] }), seams('back-1', '2026-10-14T12:00:00.000Z'));
    const other = { ...DISPATCH, sessionId: 'hhhh-8888' };
    writeBugRoutes(root, writeOf({ dispatch: other, routes: [route({ what: 'stamped first' })] }), seams('back-2'));

    expect(readBugRoutesForPlan(root, STUB).map(({ what }) => what)).toEqual(['stamped first', 'written first']);
    // The control: seq holds the other order, so the reading above is the stamp's.
    expect(columnOf(root, 'what')).toEqual(['written first', 'stamped first']);
  });

  it('answers none for a store that does not exist, creating nothing', () => {
    const root = freshRoot('read-missing');

    expect(readBugRoutesForPlan(root, STUB)).toEqual([]);
    expect(existsSync(root)).toBe(false);
  });

  it('answers none for a stub the store holds no row under', () => {
    const root = mixedRoot('read-none');

    expect(readBugRoutesForPlan(root, 'no-such-plan')).toEqual([]);
  });

  it('refuses a store past the version this rafa knows, bytes untouched', () => {
    const root = mixedRoot('read-newer');
    bumpPastThisRafa(root);
    const before = readRaw(root);

    expect(() => readBugRoutesForPlan(root, STUB)).toThrow(PAST_THIS_RAFA);
    expect(readRaw(root)).toEqual(before);
  });

  it('answers none over a store left before the bug-routes migration, the table just made', () => {
    const root = freshRoot('read-older');
    const path = storeFile(root);
    const beforeEntry = SQLITE_MIGRATIONS.slice(0, SQLITE_MIGRATIONS.findIndex(({ id }) => id === 'bug-routes'));
    mkdirSync(dirname(path), { recursive: true });
    const db = new Database(path, { readwrite: true, create: true });
    try {
      bringForward(db, path, 'write', 'open', { migrations: beforeEntry });
    } finally {
      db.close();
    }
    const tables = 'SELECT name FROM sqlite_master WHERE type = \'table\' AND name = \'bug_routes\'';

    // The control: the planted store has no such table, so a reader that
    // opened it without bringing it forward would throw.
    expect(beforeEntry.length).toBeGreaterThan(0);
    expect(rawQuery(root, tables)).toEqual([]);

    expect(readBugRoutesForPlan(root, STUB)).toEqual([]);
    expect(rawQuery(root, tables)).toEqual([{ name: 'bug_routes' }]);
  });
});
