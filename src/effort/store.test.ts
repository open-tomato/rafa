/**
 * Tests for the append-only effort store.
 *
 * Every fixture is PLANTED and every file is written under a fresh
 * temporary directory, so the suite touches no `.ralph/` anywhere and
 * runs on a machine that has never run the loop.
 *
 * The disk is real rather than mocked, on purpose: the three
 * properties this module exists for are all properties of a FILE —
 * that a second append adds nothing, that a partial last line is
 * separated instead of glued to, and that a batch refused for a
 * keyless row left the bytes alone. A mocked `node:fs` would let each
 * of those pass against a module that never wrote correctly.
 *
 * The rows are deliberately not `SessionStats`. The store is generic
 * over its row and knows nothing about the collector's shapes; typing
 * the fixtures to a real row would test the collector's schema here
 * and hide the fact that the key projection is the caller's.
 *
 * Eighteen module mutations were driven against this file and
 * SEVENTEEN reddened at least one case, with the restored module green
 * either side and byte-identical: never separating a partial line,
 * always writing that separator, dropping the within-batch dedupe,
 * dropping the disk dedupe, truncating instead of appending, creating
 * the file on an empty batch, validating keys after the append instead
 * of before it, accepting an empty-string key, treating a missing file
 * as an error, keeping the trailing newline's empty tail as a line,
 * popping every trailing blank instead of one, admitting arrays as
 * rows, admitting scalars as rows, binding the store's two key sets to
 * different projections, dropping the store directory from the path,
 * seeding a placeholder key for a keyless row, and reporting the batch
 * size as the appended count.
 *
 * The eighteenth stayed GREEN and is named rather than dropped:
 * splitting on the bare newline instead of `/\r?\n/`. It is not a hole
 * in the suite but a property of the module — `JSON.parse` tolerates
 * a trailing carriage return and a lone one trims to empty, so the two
 * splits are behaviourally identical here. The CRLF case below is
 * therefore a CHARACTERIZATION case, and calling it a guard would
 * overstate it.
 */
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import {
  appendRows,
  collectedKeys,
  EFFORT_STORE_DIR,
  effortStorePath,
  keysOfRows,
  openEffortStore,
  parseStoreText,
  readStoreRows,
} from './store.js';

/** A row shape of this suite's own, not one of the collector's. */
interface Row {
  id: string;
  turns: number;
}

/** The projection every case in this file deduplicates by. */
const keyOf = (row: Row): string => row.id;

const ROW_A: Row = { id: 'aaaa-1111', turns: 3 };
const ROW_B: Row = { id: 'bbbb-2222', turns: 7 };
const ROW_C: Row = { id: 'cccc-3333', turns: 1 };

const tempRoot = mkdtempSync(join(tmpdir(), 'ralph-store-'));
let planted = 0;

afterAll(() => {
  rmSync(tempRoot, { recursive: true, force: true });
});

/** A path in a directory of its own, so no case can see another's. */
function storePath(name: string): string {
  planted += 1;
  return join(tempRoot, `${planted}-${name}`, 'rows.ndjson');
}

/**
 * Writes a store file verbatim, including a partial last line.
 *
 * Built with `node:fs` directly rather than by appending first: a
 * plant that leaned on the module under test could not distinguish a
 * truncated store from one this module had written wrongly.
 */
function plantStore(name: string, text: string): string {
  const path = storePath(name);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text, 'utf8');
  return path;
}

/** The file's bytes, or null when nothing was ever written. */
function readRaw(path: string): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

describe('effortStorePath', () => {
  it('puts both kinds under one ignored directory', () => {
    const base = join('/repo', '.ralph', 'effort');

    expect(effortStorePath('/repo', 'sessions'))
      .toBe(join(base, 'sessions.ndjson'));
    expect(effortStorePath('/repo', 'commits'))
      .toBe(join(base, 'commits.ndjson'));
  });

  it('spells the ignored directory once', () => {
    expect(EFFORT_STORE_DIR).toBe(join('.ralph', 'effort'));
    expect(effortStorePath('/repo', 'sessions')).toContain(EFFORT_STORE_DIR);
  });
});

describe('parseStoreText', () => {
  it('reads no store and an empty store the same way', () => {
    expect(parseStoreText<Row>(null)).toEqual({
      rows: [],
      lineCount: 0,
      unparsedLineCount: 0,
    });
    expect(parseStoreText<Row>('')).toEqual({
      rows: [],
      lineCount: 0,
      unparsedLineCount: 0,
    });
  });

  it('drops the trailing newline tail and nothing else', () => {
    const text = `${JSON.stringify(ROW_A)}\n${JSON.stringify(ROW_B)}\n`;
    const result = parseStoreText<Row>(text);

    expect(result.rows).toEqual([ROW_A, ROW_B]);
    expect(result.lineCount).toBe(2);
    expect(result.unparsedLineCount).toBe(0);
  });

  it('counts a genuinely blank last line', () => {
    const result = parseStoreText<Row>(`${JSON.stringify(ROW_A)}\n\n`);

    expect(result.rows).toEqual([ROW_A]);
    expect(result.lineCount).toBe(2);
    expect(result.unparsedLineCount).toBe(1);
  });

  // Characterization, not a guard — see the header on the one
  // mutation this suite does not catch.
  it('reads a CRLF store as one row per line', () => {
    const text = `${JSON.stringify(ROW_A)}\r\n${JSON.stringify(ROW_B)}\r\n`;
    const result = parseStoreText<Row>(text);

    expect(result.rows).toEqual([ROW_A, ROW_B]);
    expect(result.lineCount).toBe(2);
  });

  it('counts a truncated last line instead of dropping it', () => {
    const text = `${JSON.stringify(ROW_A)}\n{"id":"bbbb-22`;
    const result = parseStoreText<Row>(text);

    expect(result.rows).toEqual([ROW_A]);
    expect(result.lineCount).toBe(2);
    expect(result.unparsedLineCount).toBe(1);
  });

  it('refuses a line that is valid JSON but not an object', () => {
    const text = ['12', '"aaaa-1111"', 'null', '[1,2]'].join('\n');
    const result = parseStoreText<Row>(text);

    expect(result.rows).toEqual([]);
    expect(result.unparsedLineCount).toBe(4);
  });

  it('keeps rows.length + unparsed === lineCount', () => {
    const text = ['{"id":"a","turns":1}', 'x', '', '[]', ''].join('\n');
    const result = parseStoreText<Row>(text);

    expect(result.rows).toHaveLength(1);
    expect(result.lineCount).toBe(4);
    expect(result.unparsedLineCount).toBe(3);
    expect(result.rows.length + result.unparsedLineCount)
      .toBe(result.lineCount);
  });

  it('answers rows in the order they were appended', () => {
    const text = [ROW_C, ROW_A, ROW_B]
      .map((row) => JSON.stringify(row))
      .join('\n');

    expect(parseStoreText<Row>(text).rows).toEqual([ROW_C, ROW_A, ROW_B]);
  });
});

describe('keysOfRows', () => {
  it('collapses a key seen twice', () => {
    expect([...keysOfRows([ROW_A, ROW_B, ROW_A], keyOf)])
      .toEqual(['aaaa-1111', 'bbbb-2222']);
  });

  it('contributes nothing for a key that is absent or empty', () => {
    const rows = [ROW_A, { id: '', turns: 0 }] as Row[];
    const missing = (row: Row): string | undefined => row.id || undefined;

    expect([...keysOfRows(rows, keyOf)]).toEqual(['aaaa-1111']);
    expect([...keysOfRows(rows, missing)]).toEqual(['aaaa-1111']);
  });
});

describe('appendRows on a store that does not exist yet', () => {
  it('creates the directory and writes one line per row', () => {
    const path = storePath('fresh');
    const result = appendRows(path, [ROW_A, ROW_B], keyOf);

    expect(result.appended).toBe(2);
    expect(result.skipped).toBe(0);
    expect(result.separatedPartialLine).toBe(false);
    expect(readRaw(path))
      .toBe(`${JSON.stringify(ROW_A)}\n${JSON.stringify(ROW_B)}\n`);
  });

  it('writes nothing at all for an empty batch', () => {
    const path = storePath('empty');
    const result = appendRows<Row>(path, [], keyOf);

    expect(result).toEqual({
      path,
      appended: 0,
      skipped: 0,
      separatedPartialLine: false,
    });
    expect(readRaw(path)).toBeNull();
  });

  it('reads a store that was never written as empty', () => {
    const path = storePath('absent');

    expect(readStoreRows<Row>(path).rows).toEqual([]);
    expect(collectedKeys<Row>(path, keyOf).size).toBe(0);
  });
});

describe('appendRows incrementality', () => {
  it('adds zero rows on a second identical append', () => {
    const path = storePath('rerun');
    const first = appendRows(path, [ROW_A, ROW_B], keyOf);
    const before = readRaw(path);
    const second = appendRows(path, [ROW_A, ROW_B], keyOf);

    expect(first.appended).toBe(2);
    expect(second.appended).toBe(0);
    expect(second.skipped).toBe(2);
    expect(readRaw(path)).toBe(before);
  });

  it('appends only the rows the store does not hold', () => {
    const path = storePath('partial');
    appendRows(path, [ROW_A], keyOf);
    const result = appendRows(path, [ROW_A, ROW_B, ROW_C], keyOf);

    expect(result.appended).toBe(2);
    expect(result.skipped).toBe(1);
    expect(readStoreRows<Row>(path).rows).toEqual([ROW_A, ROW_B, ROW_C]);
  });

  it('deduplicates within one batch, not just against disk', () => {
    const path = storePath('batch-dupe');
    const result = appendRows(path, [ROW_A, ROW_A, ROW_B], keyOf);

    expect(result.appended).toBe(2);
    expect(result.skipped).toBe(1);
    expect(readStoreRows<Row>(path).rows).toEqual([ROW_A, ROW_B]);
  });

  it('keys on the projection, not on the row body', () => {
    const path = storePath('same-key');
    appendRows(path, [ROW_A], keyOf);
    const changed: Row = { id: ROW_A.id, turns: 99 };
    const result = appendRows(path, [changed], keyOf);

    expect(result.appended).toBe(0);
    expect(readStoreRows<Row>(path).rows).toEqual([ROW_A]);
  });

  it('never rewrites a row it already holds', () => {
    const path = storePath('append-only');
    appendRows(path, [ROW_A, ROW_B], keyOf);
    appendRows(path, [ROW_C], keyOf);

    expect(readStoreRows<Row>(path).rows).toEqual([ROW_A, ROW_B, ROW_C]);
    expect(readRaw(path)).toContain(JSON.stringify(ROW_A));
  });

  it('collects a key set equal to what it appended', () => {
    const path = storePath('keyset');
    appendRows(path, [ROW_A, ROW_B, ROW_C], keyOf);

    expect([...collectedKeys<Row>(path, keyOf)].sort())
      .toEqual(['aaaa-1111', 'bbbb-2222', 'cccc-3333']);
  });
});

describe('appendRows onto a truncated store', () => {
  it('separates a partial last line and reports it', () => {
    const path = plantStore('partial', '{"id":"bbbb-22');
    const result = appendRows(path, [ROW_C], keyOf);

    expect(result.separatedPartialLine).toBe(true);
    expect(readRaw(path))
      .toBe(`{"id":"bbbb-22\n${JSON.stringify(ROW_C)}\n`);
  });

  it('leaves the partial line unparsed rather than repairing it', () => {
    const text = `${JSON.stringify(ROW_A)}\n{"id`;
    const path = plantStore('partial-read', text);
    appendRows(path, [ROW_C], keyOf);
    const result = readStoreRows<Row>(path);

    expect(result.rows).toEqual([ROW_A, ROW_C]);
    expect(result.unparsedLineCount).toBe(1);
  });

  it('re-collects the row the partial line half held', () => {
    const half = JSON.stringify(ROW_B).slice(0, 12);
    const text = `${JSON.stringify(ROW_A)}\n${half}`;
    const path = plantStore('recollect', text);
    appendRows(path, [ROW_A, ROW_B], keyOf);

    expect(readStoreRows<Row>(path).rows).toEqual([ROW_A, ROW_B]);
  });

  it('writes no leading newline onto a whole store', () => {
    const path = storePath('whole');
    appendRows(path, [ROW_A], keyOf);
    const result = appendRows(path, [ROW_B], keyOf);

    expect(result.separatedPartialLine).toBe(false);
    expect(readRaw(path)).not.toContain('\n\n');
  });
});

describe('appendRows refusals', () => {
  it('refuses the whole batch for a keyless row', () => {
    const path = storePath('keyless');
    const rows = [ROW_A, { id: '', turns: 2 }, ROW_B];

    expect(() => appendRows(path, rows, keyOf)).toThrow(/carries no key/);
    expect(readRaw(path)).toBeNull();
  });

  it('leaves an existing store byte-identical when it refuses', () => {
    const path = storePath('keyless-existing');
    appendRows(path, [ROW_A], keyOf);
    const before = readRaw(path);
    const rows = [ROW_B, { id: '', turns: 2 }];

    expect(() => appendRows(path, rows, keyOf)).toThrow();
    expect(readRaw(path)).toBe(before);
  });

  it('names the offending row in the refusal', () => {
    const path = storePath('keyless-named');
    const rows = [ROW_A, ROW_B, { id: '', turns: 2 }];

    expect(() => appendRows(path, rows, keyOf)).toThrow(/row 2 of 3/);
  });
});

describe('row content that could split a line', () => {
  it('escapes a newline inside a row rather than breaking it', () => {
    const path = storePath('newline');
    const row: Row = { id: 'nl\nid', turns: 1 };
    appendRows(path, [row], keyOf);
    const result = readStoreRows<Row>(path);

    expect(result.lineCount).toBe(1);
    expect(result.rows).toEqual([row]);
  });
});

describe('openEffortStore', () => {
  it('deduplicates by the projection it was bound to', () => {
    const path = storePath('bound');
    const store = openEffortStore<Row>(path, keyOf);
    store.append([ROW_A, ROW_B]);
    const again = store.append([ROW_A, ROW_C]);

    expect(again.appended).toBe(1);
    expect(again.skipped).toBe(1);
    expect(store.readRows().rows).toEqual([ROW_A, ROW_B, ROW_C]);
  });

  it('reports the same keys its append skipped by', () => {
    const path = storePath('bound-keys');
    const store = openEffortStore<Row>(path, keyOf);
    store.append([ROW_A, ROW_B]);

    expect([...store.collectedKeys()].sort())
      .toEqual(['aaaa-1111', 'bbbb-2222']);
    expect(store.append([ROW_A, ROW_B]).appended).toBe(0);
  });

  it('carries the path it was opened on', () => {
    const path = storePath('bound-path');

    expect(openEffortStore<Row>(path, keyOf).path).toBe(path);
  });
});
