/**
 * Tests for the stale-doc writer and the reader of a plan's rows.
 *
 * Every store sits under a fresh temporary repo root, and the disk is
 * real. Every reading of what a write left goes through `bun:sqlite`
 * directly and never through the module, with its columns named, so the
 * column names and the dedupe rule are spelled here rather than read off
 * the code under test. The table's own CHECKs and indexes are read in
 * `stale-docs-migration.test.ts`.
 *
 * Entries are built in the shape `parseReport` answers, and one case
 * feeds the writer a report parsed for real.
 *
 * Each refusal sits beside the write it was varied from, which the store
 * takes, so a writer refusing everything reddens.
 *
 * The reader's cases read a store written through `writeStaleDocs`
 * rather than planted, so the columns the writer fills and the ones the
 * reader answers are checked against each other. Every case asking for
 * one stub writes rows under another stub and under none beside them.
 * One case reads a store merged from two devices' through `mergeStore`,
 * once from each side (`src/tests/merged-stores.ts`).
 *
 * Nineteen mutations of the module were driven against this file alone
 * on 2026-10-14, with the unmutated source green before and after and
 * restored byte-identical. All nineteen reddened at least one of the 44
 * cases. In the writer: `kind` out of the conflict target, and the bare
 * `where_at` in it (34 each), the plan stub dropped from the row (11),
 * refused entries written anyway (9), the dispatch check dropped (6),
 * `where` dropped from the row (6), the conflict clause dropped (4),
 * the kind check dropped (3), every row stored as a sighting (3), the
 * clock read once per row (1), and `what` checked as an optional field
 * (1). In the reader: `ORDER BY what` (4), the stub filter dropped (3),
 * `ORDER BY seq` (2), and one each for `ORDER BY collected_at, seq`,
 * `IS` made `=`, the missing-store guard dropped, `where` answered
 * null, and `kind` answered as a sighting.
 */
import type { Device, MergedBothWays } from '../../../merged-stores.js';
import type { ReportStaleDoc } from '@open-tomato/rafa/report/parse';
import type { FindingsWriterSeams } from '@open-tomato/rafa/store/findings';
import type { StaleDocRow, StaleDocsWrite, StaleDocsWriteResult } from '@open-tomato/rafa/store/stale-docs';

import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { Database } from 'bun:sqlite';
import { afterAll, describe, expect, it } from 'bun:test';

import { parseReport } from '@open-tomato/rafa/report/parse';
import { bringForward } from '@open-tomato/rafa/store/bring-forward';
import { SQLITE_MIGRATIONS, SQLITE_SCHEMA_VERSION } from '@open-tomato/rafa/store/migrations';
import { readStaleDocsForPlan, STALE_DOC_KINDS, writeStaleDocs } from '@open-tomato/rafa/store/stale-docs';

import { copyDevice, freshDevice, mergeBothWays } from '../../../merged-stores.js';

/** A `stale_docs` row as the table holds it. */
interface StoredStaleDoc {
  seq: number;
  id: string;
  session_id: string;
  plan_stub: string | null;
  task_line: string;
  kind: string;
  where_at: string | null;
  what: string;
  outcome: string;
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
  'kind',
  'where_at',
  'what',
  'outcome',
  'collected_at',
  'origin_store',
  'origin_seq',
];

const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-stale-docs-')));
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
function rawQuery<T>(root: string, sql: string, ...bindings: (string | null)[]): T[] {
  const db = new Database(storeFile(root), { readonly: true });
  try {
    return db.query<T, (string | null)[]>(sql).all(...bindings);
  } finally {
    db.close();
  }
}

/** Every `stale_docs` row, in `seq` order. */
function rowsOf(root: string): StoredStaleDoc[] {
  return rawQuery<StoredStaleDoc>(root, `SELECT ${COLUMNS.join(', ')} FROM stale_docs ORDER BY seq`);
}

/** One column of every row, in `seq` order. */
function columnOf(root: string, column: string): unknown[] {
  const sql = `SELECT ${column} AS value FROM stale_docs ORDER BY seq`;
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

/** A stale-doc entry as `parseReport` answers one, every field filled. */
function staleDoc(overrides: Partial<ReportStaleDoc> = {}): ReportStaleDoc {
  return {
    where: 'context/triage.md:12',
    what: 'says triage has three channels',
    extras: [],
    ...overrides,
  };
}

/** The dispatch most cases write under. */
const DISPATCH = {
  sessionId: 'aaaa-1111',
  planStub: 'rafa-1072-spec-loop-files-no',
  taskLine: 'Add the docs channel',
};

/** A sighting write of no entry under the default dispatch, with `overrides` laid over it. */
function writeOf(overrides: Partial<StaleDocsWrite> = {}): StaleDocsWrite {
  return { dispatch: DISPATCH, outcome: 'done', kind: 'sighting', staleDocs: [], ...overrides };
}

/** Ids no other case generates, and a fixed clock. */
function seams(prefix: string): Required<FindingsWriterSeams> {
  let count = 0;
  return {
    now: () => new Date('2026-10-14T10:00:00.000Z'),
    newId: () => {
      count += 1;
      return `${prefix}-${String(count)}`;
    },
  };
}

/** A write's counts and the indexes it refused, path left out. */
function counts(result: StaleDocsWriteResult): unknown {
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

/** The message a call throws. Fails the case when it throws nothing. */
function refusalOf(call: () => unknown): string {
  try {
    call();
  } catch (error) {
    return error instanceof Error
      ? error.message
      : String(error);
  }
  throw new Error('expected the call to throw');
}

describe('writeStaleDocs rows', () => {
  it('writes one row per entry: dispatch, kind, entry, outcome, write time', () => {
    const root = freshRoot('rows');
    const staleDocs = [
      staleDoc(),
      staleDoc({ where: 'context/cli.md', what: 'names a command that was renamed' }),
    ];

    const result = writeStaleDocs(root, writeOf({ outcome: 'blocked', staleDocs }), seams('rows'));

    expect(result).toEqual({ path: storeFile(root), appended: 2, skipped: 0, rejected: [] });
    const provenance = {
      session_id: 'aaaa-1111',
      plan_stub: 'rafa-1072-spec-loop-files-no',
      task_line: 'Add the docs channel',
      kind: 'sighting',
      outcome: 'blocked',
      collected_at: '2026-10-14T10:00:00.000Z',
      origin_store: null,
      origin_seq: null,
    };
    expect(rowsOf(root)).toEqual([
      { seq: 1, id: 'rows-1', ...provenance, where_at: 'context/triage.md:12', what: 'says triage has three channels' },
      { seq: 2, id: 'rows-2', ...provenance, where_at: 'context/cli.md', what: 'names a command that was renamed' },
    ]);
  });

  it.each([...STALE_DOC_KINDS])('stores every row of a write under the kind %s', (kind) => {
    const root = freshRoot(`kind-${kind}`);
    const staleDocs = [staleDoc({ what: 'one line' }), staleDoc({ what: 'another line' })];

    writeStaleDocs(root, writeOf({ kind, staleDocs }), seams(`kind-${kind}`));

    expect(columnOf(root, 'kind')).toEqual([kind, kind]);
  });

  it('stores a null plan stub as NULL, beside a row written under a stub', () => {
    const root = freshRoot('null-stub-row');
    const closing = { sessionId: 'epic-close', planStub: null, taskLine: 'Close the epic' };

    const result = writeStaleDocs(root, writeOf({ dispatch: closing, staleDocs: [staleDoc()] }), seams('null-stub-row-1'));
    writeStaleDocs(root, writeOf({ staleDocs: [staleDoc()] }), seams('null-stub-row-2'));

    expect(counts(result)).toEqual(countsOf(1, 0));
    expect(columnOf(root, 'plan_stub')).toEqual([null, 'rafa-1072-spec-loop-files-no']);
    expect(rawQuery<{ n: number }>(root, 'SELECT count(*) AS n FROM stale_docs WHERE plan_stub IS NULL')).toEqual([{ n: 1 }]);
  });

  it('stores an entry that named no place with where_at NULL', () => {
    const root = freshRoot('null-where');

    writeStaleDocs(root, writeOf({ staleDocs: [staleDoc({ where: null }), staleDoc()] }), seams('null-where'));

    expect(columnOf(root, 'where_at')).toEqual([null, 'context/triage.md:12']);
  });

  it('stamps every row with one time, taken once', () => {
    const root = freshRoot('one-time');
    const times = ['2026-10-14T10:00:00.000Z', '2026-10-14T10:00:01.000Z'];
    let reads = 0;
    const now = (): Date => {
      reads += 1;
      return new Date(times[reads - 1] ?? '2026-10-14T11:00:00.000Z');
    };
    const staleDocs = [staleDoc({ what: 'one' }), staleDoc({ what: 'two' }), staleDoc({ what: 'three' })];

    writeStaleDocs(root, writeOf({ staleDocs }), { now, newId: seams('one-time').newId });

    expect(reads).toBe(1);
    expect(columnOf(root, 'collected_at')).toEqual([times[0], times[0], times[0]]);
  });

  it('generates a distinct UUID per row and reads the clock by default', () => {
    const root = freshRoot('defaults');
    const before = Date.now();

    writeStaleDocs(root, writeOf({ staleDocs: [staleDoc({ what: 'one' }), staleDoc({ what: 'two' })] }));

    const after = Date.now();
    const rows = rowsOf(root);
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map(({ id }) => id)).size).toBe(2);
    for (const { id, collected_at: collectedAt } of rows) {
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
      expect(Date.parse(collectedAt)).toBeGreaterThanOrEqual(before);
      expect(Date.parse(collectedAt)).toBeLessThanOrEqual(after);
    }
  });

  it('carries a parsed report entry for entry', () => {
    const output = [
      'Done.',
      '',
      '```rafa:report',
      'status: done',
      'stale_docs:',
      '  - where: "context/triage.md:12"',
      '    what: "says triage has three channels"',
      '  - what: "the README still names the old command"',
      '    extra_key: kept by the parser, not stored',
      '```',
    ].join('\n');
    const reading = parseReport(output);
    if (!reading.present) throw new Error(reading.text);
    const root = freshRoot('parsed');
    const { staleDocs } = reading.report;

    writeStaleDocs(root, writeOf({ staleDocs }), seams('parsed'));

    expect(staleDocs).toHaveLength(2);
    expect(rowsOf(root).map(({ where_at: where, what }) => ({ where, what })))
      .toEqual(staleDocs.map(({ where, what }) => ({ where, what })));
    expect(columnOf(root, 'where_at')).toEqual(['context/triage.md:12', null]);
  });
});

describe('a repeated write', () => {
  it('writes its rows once, changing no byte the second time', () => {
    const root = freshRoot('repeat');
    const staleDocs = [staleDoc(), staleDoc({ where: null, what: 'a line with no place' })];
    const first = writeStaleDocs(root, writeOf({ staleDocs }), seams('repeat-1'));
    const before = readRaw(root);

    const second = writeStaleDocs(root, writeOf({ staleDocs }), seams('repeat-2'));

    expect(counts(first)).toEqual(countsOf(2, 0));
    expect(counts(second)).toEqual(countsOf(0, 2));
    expect(readRaw(root)).toEqual(before);
    expect(columnOf(root, 'id')).toEqual(['repeat-1-1', 'repeat-1-2']);
  });

  it('keeps the first of two identical entries within a write, a missing where included', () => {
    const root = freshRoot('within');
    const staleDocs = [
      staleDoc(),
      staleDoc(),
      staleDoc({ where: null }),
      staleDoc({ where: null }),
    ];

    const result = writeStaleDocs(root, writeOf({ staleDocs }), seams('within'));

    expect(counts(result)).toEqual(countsOf(2, 2));
    expect(columnOf(root, 'id')).toEqual(['within-1', 'within-3']);
  });

  it('stores the same entry under the other kind as a row of its own', () => {
    const root = freshRoot('other-kind');
    writeStaleDocs(root, writeOf({ kind: 'sighting', staleDocs: [staleDoc()] }), seams('other-kind-1'));

    const unsettled = writeStaleDocs(root, writeOf({ kind: 'unsettled', staleDocs: [staleDoc()] }), seams('other-kind-2'));
    const again = writeStaleDocs(root, writeOf({ kind: 'unsettled', staleDocs: [staleDoc()] }), seams('other-kind-3'));

    expect(counts(unsettled)).toEqual(countsOf(1, 0));
    expect(counts(again)).toEqual(countsOf(0, 1));
    expect(columnOf(root, 'kind')).toEqual(['sighting', 'unsettled']);
  });

  it('stores the same entry again for another session', () => {
    const root = freshRoot('other-session');
    writeStaleDocs(root, writeOf({ staleDocs: [staleDoc()] }), seams('other-session-1'));
    const dispatch = { ...DISPATCH, sessionId: 'bbbb-2222' };

    const result = writeStaleDocs(root, writeOf({ dispatch, staleDocs: [staleDoc()] }), seams('other-session-2'));

    expect(counts(result)).toEqual(countsOf(1, 0));
    expect(columnOf(root, 'session_id')).toEqual(['aaaa-1111', 'bbbb-2222']);
  });

  it('matches where and what byte for byte, so a differing entry is a row of its own', () => {
    const root = freshRoot('exact');
    const staleDocs = [
      staleDoc(),
      staleDoc({ where: 'context/triage.md:13' }),
      staleDoc({ what: 'says triage has three channels ' }),
      staleDoc({ what: 'Says triage has three channels' }),
    ];

    const result = writeStaleDocs(root, writeOf({ staleDocs }), seams('exact'));

    expect(counts(result)).toEqual(countsOf(4, 0));
  });
});

describe('entry rejections', () => {
  it.each([
    ['no what', { what: null as never }, 'what', 'missing-field', 'is missing'],
    ['a blank what', { what: '  ' }, 'what', 'unstorable-field', 'is blank'],
    ['a numeric what', { what: 7 as never }, 'what', 'unstorable-field', 'is 7, not a string'],
    ['a what holding a lone surrogate', { what: 'ab\uD800cd' }, 'what', 'unstorable-field', 'lone UTF-16 surrogate'],
    ['an empty where', { where: '' }, 'where', 'unstorable-field', 'is blank'],
    ['a numeric where', { where: 4 as never }, 'where', 'unstorable-field', 'is 4, not a string'],
    ['a where holding a lone surrogate', { where: 'x\uDC00' }, 'where', 'unstorable-field', 'lone UTF-16 surrogate'],
  ] as const)('refuses an entry with %s alone, writing the rest', (_label, overrides, field, reason, why) => {
    const root = freshRoot('entry-refused');
    const staleDocs = [
      staleDoc({ what: 'kept before' }),
      staleDoc({ ...overrides }),
      staleDoc({ what: 'kept after' }),
    ];

    const result = writeStaleDocs(root, writeOf({ staleDocs }), seams(`entry-refused-${String(planted)}`));

    expect(counts(result)).toEqual(countsOf(2, 0, [1]));
    expect(result.rejected[0]).toMatchObject({ index: 1, reason, field });
    expect(result.rejected[0]?.text).toStartWith(`stale_docs[1].${field} `);
    expect(result.rejected[0]?.text).toContain(why);
    expect(result.rejected[0]?.text).toEndWith('; not written');
    expect(columnOf(root, 'what')).toEqual(['kept before', 'kept after']);
  });

  it('adds up: appended, skipped and rejected', () => {
    const root = freshRoot('sum');
    const staleDocs = [
      staleDoc(),
      staleDoc(),
      staleDoc({ what: '' }),
      staleDoc({ what: 'a line of its own' }),
      staleDoc({ where: ' ' }),
    ];

    const result = writeStaleDocs(root, writeOf({ staleDocs }), seams('sum'));

    expect(counts(result)).toEqual(countsOf(2, 1, [2, 4]));
    expect(result.appended + result.skipped + result.rejected.length).toBe(5);
  });

  it('creates no file and no directory when every entry is refused', () => {
    const root = freshRoot('all-refused');
    const staleDocs = [staleDoc({ what: '' }), staleDoc({ where: '' })];

    const result = writeStaleDocs(root, writeOf({ staleDocs }), seams('all-refused'));

    expect(counts(result)).toEqual(countsOf(0, 0, [0, 1]));
    expect(existsSync(root)).toBe(false);
  });

  it('creates no file and no directory for an empty list', () => {
    const root = freshRoot('empty');

    const result = writeStaleDocs(root, writeOf(), seams('empty'));

    expect(result).toEqual({ path: storeFile(root), appended: 0, skipped: 0, rejected: [] });
    expect(existsSync(root)).toBe(false);
  });
});

describe('whole-write refusals', () => {
  it.each([
    ['an empty session id', { dispatch: { ...DISPATCH, sessionId: '' } }, 'session id ""'],
    ['a null task line', { dispatch: { ...DISPATCH, taskLine: null as never } }, 'task line null'],
    ['a numeric plan stub', { dispatch: { ...DISPATCH, planStub: 7 as never } }, 'plan stub 7'],
    [
      'a lone surrogate in the session id',
      { dispatch: { ...DISPATCH, sessionId: 'x\uDC00' } },
      'session id holding a lone UTF-16 surrogate',
    ],
    ['an outcome outside the set', { outcome: 'green' as never }, 'outcome "green", not one of done, blocked, failed'],
    ['a kind outside the set', { kind: 'settled' as never }, 'kind "settled", not one of sighting, unsettled'],
    ['a null kind', { kind: null as never }, 'kind null, not one of sighting, unsettled'],
  ] as const)('refuses %s even with the list empty, creating nothing', (_label, overrides, why) => {
    const root = freshRoot('refused-write');

    const refusal = refusalOf(() => writeStaleDocs(root, writeOf(overrides)));

    expect(refusal).toStartWith('effort store: stale docs write has ');
    expect(refusal).toContain(why);
    expect(refusal).toEndWith('; nothing written');
    expect(existsSync(root)).toBe(false);
  });

  it('refuses a kind outside the set with an entry to write, creating nothing', () => {
    const root = freshRoot('refused-kind');
    const write = writeOf({ kind: 'settled' as never, staleDocs: [staleDoc()] });

    expect(() => writeStaleDocs(root, write, seams('refused-kind')))
      .toThrow('effort store: stale docs write has kind "settled"');
    expect(existsSync(root)).toBe(false);

    // The control: the same write under a kind of the set is stored, so
    // the refusal above was the kind and nothing else about the write.
    const taken = writeStaleDocs(root, { ...write, kind: 'unsettled' }, seams('refused-kind'));
    expect(counts(taken)).toEqual(countsOf(1, 0));
  });

  it('refuses before opening an existing store, changing no byte', () => {
    const root = freshRoot('refused-existing');
    writeStaleDocs(root, writeOf({ staleDocs: [staleDoc()] }), seams('refused-existing'));
    const before = readRaw(root);
    const dispatch = { ...DISPATCH, sessionId: '' };

    expect(() => writeStaleDocs(root, writeOf({ dispatch, staleDocs: [staleDoc({ where: null })] })))
      .toThrow('effort store: stale docs write has session id ""');
    expect(readRaw(root)).toEqual(before);
  });

  it('rolls the write back when a generated id repeats', () => {
    const root = freshRoot('id-repeat');
    writeStaleDocs(root, writeOf({ staleDocs: [staleDoc()] }), seams('id-repeat'));
    const before = readRaw(root);
    const staleDocs = [staleDoc({ what: 'a' }), staleDoc({ what: 'b' })];

    expect(() => writeStaleDocs(root, writeOf({ staleDocs }), { newId: () => 'same' }))
      .toThrow('UNIQUE constraint failed: stale_docs.id');
    expect(readRaw(root)).toEqual(before);
    expect(columnOf(root, 'id')).toEqual(['id-repeat-1']);
  });

  it('refuses a store past the version this rafa knows, an empty write included, bytes untouched', () => {
    const root = freshRoot('newer');
    writeStaleDocs(root, writeOf({ staleDocs: [staleDoc()] }), seams('newer'));
    const current = readRaw(root);

    // The control: an empty write on a current store opens it and changes
    // nothing, so the refusals below are the version and not the emptiness.
    expect(counts(writeStaleDocs(root, writeOf()))).toEqual(countsOf(0, 0));
    expect(readRaw(root)).toEqual(current);

    bumpPastThisRafa(root);
    const before = readRaw(root);

    expect(() => writeStaleDocs(root, writeOf({ staleDocs: [staleDoc({ where: null })] }), seams('newer-2')))
      .toThrow(PAST_THIS_RAFA);
    expect(() => writeStaleDocs(root, writeOf())).toThrow(PAST_THIS_RAFA);
    expect(() => writeStaleDocs(root, writeOf({ staleDocs: [staleDoc({ what: '' })] }))).toThrow(PAST_THIS_RAFA);
    expect(readRaw(root)).toEqual(before);
  });
});

describe('readStaleDocsForPlan', () => {
  const stub = 'rafa-1072-spec-loop-files-no';

  /** Writes `whats` as one report of `sessionId` under `planStub`, each entry naming no place. */
  function report(
    root: string,
    sessionId: string,
    planStub: string | null,
    whats: readonly string[],
    over: Partial<StaleDocsWrite> = {},
    writeSeams: FindingsWriterSeams = seams(`${sessionId}-${String(planted)}`),
  ): void {
    writeStaleDocs(root, {
      dispatch: { sessionId, planStub, taskLine: `Task of ${sessionId}` },
      outcome: 'done',
      kind: 'sighting',
      staleDocs: whats.map((what) => staleDoc({ where: null, what })),
      ...over,
    }, writeSeams);
  }

  /** What the reader answers under `planStub`, each row as its `what`. */
  function whatsOf(root: string, planStub: string | null): string[] {
    return readStaleDocsForPlan(root, planStub).map(({ what }) => what);
  }

  it('answers every row under the stub, in append order, and no other stub\'s', () => {
    const root = freshRoot('by-stub');
    report(root, 's-1', stub, ['first', 'second']);
    report(root, 's-2', 'rafa-20-pr-commands', ['another plan']);
    report(root, 's-3', null, ['no plan at all']);
    report(root, 's-4', stub, ['third']);

    // The control: all four writes landed, so a reader answering only the
    // stub's three is filtering rather than missing rows.
    expect(columnOf(root, 'what')).toEqual(['first', 'second', 'another plan', 'no plan at all', 'third']);
    expect(whatsOf(root, stub)).toEqual(['first', 'second', 'third']);
    expect(whatsOf(root, 'rafa-20-pr-commands')).toEqual(['another plan']);
  });

  it('answers the rows written under no plan for the null stub, and only those', () => {
    const root = freshRoot('null-stub');
    report(root, 's-1', stub, ['under a stub']);
    report(root, 's-2', null, ['under none', 'under none too']);

    // The control: the store holds both the stub's row and the two under
    // NULL, so the two answered below were picked out of three.
    expect(columnOf(root, 'plan_stub')).toEqual([stub, null, null]);
    expect(whatsOf(root, null)).toEqual(['under none', 'under none too']);
    expect(readStaleDocsForPlan(root, null).map(({ planStub }) => planStub)).toEqual([null, null]);
  });

  it('answers each row whole, of both kinds', () => {
    const root = freshRoot('fields');
    const dispatch = { sessionId: 'aaaa-1111', planStub: stub, taskLine: 'Add the reader' };
    writeStaleDocs(root, {
      dispatch,
      outcome: 'done',
      kind: 'sighting',
      staleDocs: [staleDoc(), staleDoc({ where: null, what: 'the README names the old command' })],
    }, seams('fields-sighting'));
    writeStaleDocs(root, {
      dispatch: { ...dispatch, sessionId: 'bbbb-2222', taskLine: 'Repair the docs' },
      outcome: 'blocked',
      kind: 'unsettled',
      staleDocs: [staleDoc()],
    }, { now: () => new Date('2026-10-14T12:00:00.000Z'), newId: () => 'fields-unsettled-1' });

    const expected: StaleDocRow[] = [
      {
        id: 'fields-sighting-1',
        sessionId: 'aaaa-1111',
        planStub: stub,
        taskLine: 'Add the reader',
        kind: 'sighting',
        where: 'context/triage.md:12',
        what: 'says triage has three channels',
        outcome: 'done',
        collectedAt: '2026-10-14T10:00:00.000Z',
      },
      {
        id: 'fields-sighting-2',
        sessionId: 'aaaa-1111',
        planStub: stub,
        taskLine: 'Add the reader',
        kind: 'sighting',
        where: null,
        what: 'the README names the old command',
        outcome: 'done',
        collectedAt: '2026-10-14T10:00:00.000Z',
      },
      {
        id: 'fields-unsettled-1',
        sessionId: 'bbbb-2222',
        planStub: stub,
        taskLine: 'Repair the docs',
        kind: 'unsettled',
        where: 'context/triage.md:12',
        what: 'says triage has three channels',
        outcome: 'blocked',
        collectedAt: '2026-10-14T12:00:00.000Z',
      },
    ];
    expect(readStaleDocsForPlan(root, stub)).toEqual(expected);
  });

  it('keeps one write in the order the report listed its entries, times tied', () => {
    const root = freshRoot('tied-times');
    const whats = ['zebra last alphabetically', 'alpha first alphabetically', 'middle one'];
    report(root, 's-1', stub, whats);

    // The control: every row carries the one write's time, so the order
    // below cannot have come from the clock.
    expect(new Set(columnOf(root, 'collected_at')).size).toBe(1);
    expect(whatsOf(root, stub)).toEqual(whats);
  });

  it('orders by the stamp, not the local seq, when a clock goes backwards', () => {
    const root = freshRoot('backwards-clock');
    report(root, 's-1', stub, ['written first'], {}, { now: () => new Date('2026-10-14T11:00:00.000Z'), newId: () => 'backwards-1' });
    report(root, 's-2', stub, ['written second'], {}, { now: () => new Date('2026-10-14T09:00:00.000Z'), newId: () => 'backwards-2' });

    // The control: the stamps disagree with `seq` here, so the order
    // below is `collected_at` and cannot be `seq`.
    expect(columnOf(root, 'what')).toEqual(['written first', 'written second']);
    expect(columnOf(root, 'collected_at')).toEqual(['2026-10-14T11:00:00.000Z', '2026-10-14T09:00:00.000Z']);
    expect(whatsOf(root, stub)).toEqual(['written second', 'written first']);
  });

  it('answers none for a store that does not exist, creating nothing', () => {
    const root = freshRoot('no-store');

    expect(readStaleDocsForPlan(root, stub)).toEqual([]);
    expect(readStaleDocsForPlan(root, null)).toEqual([]);
    expect(existsSync(root)).toBe(false);

    // The control: the same root, once written, answers the row, so the
    // emptiness above was the missing store and not the query.
    report(root, 's-1', stub, ['now it exists']);
    expect(whatsOf(root, stub)).toEqual(['now it exists']);
  });

  it('answers none for a stub the store holds no row under', () => {
    const root = freshRoot('unknown-stub');
    report(root, 's-1', stub, ['the only row']);

    expect(readStaleDocsForPlan(root, 'rafa-99-nothing-here')).toEqual([]);
    expect(readStaleDocsForPlan(root, null)).toEqual([]);
  });

  it('refuses a store past the version this rafa knows, bytes untouched', () => {
    const root = freshRoot('read-newer');
    report(root, 's-1', stub, ['stored before the bump']);

    // The control: the read works at this version, so the refusal below
    // is the version and nothing else about the store.
    expect(readStaleDocsForPlan(root, stub)).toHaveLength(1);

    bumpPastThisRafa(root);
    const before = readRaw(root);

    expect(() => readStaleDocsForPlan(root, stub)).toThrow(PAST_THIS_RAFA);
    expect(readRaw(root)).toEqual(before);
  });

  it('answers none over a store left before the stale-docs migration, the table just made', () => {
    const root = freshRoot('read-older');
    const path = storeFile(root);
    const beforeEntry = SQLITE_MIGRATIONS.slice(0, SQLITE_MIGRATIONS.findIndex(({ id }) => id === 'stale-docs'));
    mkdirSync(dirname(path), { recursive: true });
    const db = new Database(path, { readwrite: true, create: true });
    try {
      bringForward(db, path, 'write', 'open', { migrations: beforeEntry });
    } finally {
      db.close();
    }
    const tables = 'SELECT name FROM sqlite_master WHERE type = \'table\' AND name = \'stale_docs\'';

    // The control: the planted store has no such table, so a reader that
    // opened it without bringing it forward would throw.
    expect(beforeEntry.length).toBeGreaterThan(0);
    expect(rawQuery(root, tables)).toEqual([]);

    expect(readStaleDocsForPlan(root, stub)).toEqual([]);
    expect(rawQuery(root, tables)).toEqual([{ name: 'stale_docs' }]);
  });
});

describe('readStaleDocsForPlan over a merged store', () => {
  const stub = 'rafa-322-effort-stores-two-devices';

  /** Writes `whats` as one report of `sessionId` on `device`, stamped `at`. */
  function report(device: Device, sessionId: string, at: string, whats: readonly string[]): void {
    let count = 0;
    writeStaleDocs(device.root, {
      dispatch: { sessionId, planStub: stub, taskLine: `Task of ${sessionId}` },
      outcome: 'done',
      kind: 'sighting',
      staleDocs: whats.map((what) => staleDoc({ what })),
    }, {
      now: () => new Date(at),
      newId: () => {
        count += 1;
        return `${device.origin}-${sessionId}-${String(count)}`;
      },
    });
  }

  /**
   * Device b starts as a copy of device a, and each then writes on its
   * own, b's second report stamped the same minute as a's so only the
   * origin pair can order the two.
   */
  function twoDevices(): MergedBothWays {
    const scope = realpathSync(mkdtempSync(join(tempBase, 'merged-')));
    const a = freshDevice(scope, 'store-a');
    report(a, 's-1', '2026-09-29T09:00:00.000Z', ['shared before the copy']);
    const b = copyDevice(scope, a, 'store-b');
    report(a, 's-2', '2026-09-29T10:00:00.000Z', ['zebra from a', 'alpha from a', 'middle from a']);
    report(b, 's-3', '2026-09-29T09:30:00.000Z', ['half past nine on b']);
    report(b, 's-4', '2026-09-29T10:00:00.000Z', ['yak from b', 'beta from b']);
    return mergeBothWays(scope, a, b);
  }

  /** The `what` of the plan's rows at `root` in `seq` order, module uninvolved. */
  function bySeq(root: string): unknown[] {
    const sql = 'SELECT what FROM stale_docs WHERE plan_stub IS ? ORDER BY seq';
    return rawQuery<{ what: string }>(root, sql, stub).map(({ what }) => what);
  }

  it('answers one order whichever side ran the merge', () => {
    const merged = twoDevices();

    // The control: the two merged stores hold the same seven rows under
    // different local `seq` values, so a reader by `seq` alone would
    // answer two orders and this case could fail.
    const seqOrders = [bySeq(merged.firstRanIt), bySeq(merged.secondRanIt)];
    expect(seqOrders[0]).toHaveLength(7);
    expect(new Set(seqOrders[0])).toEqual(new Set(seqOrders[1]));
    expect(seqOrders[0]).not.toEqual(seqOrders[1]);

    expect(readStaleDocsForPlan(merged.firstRanIt, stub).map(({ what }) => what)).toEqual([
      'shared before the copy',
      'half past nine on b',
      'zebra from a',
      'alpha from a',
      'middle from a',
      'yak from b',
      'beta from b',
    ]);
    expect(readStaleDocsForPlan(merged.secondRanIt, stub)).toEqual(readStaleDocsForPlan(merged.firstRanIt, stub));
  });
});
