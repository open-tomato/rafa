/**
 * `moveToSqlite` over planted projects under the temp directory: NDJSON
 * rows appended through the port, the count check, and the one config
 * line it sets. Every store is the project's own under
 * `<root>/.rafa/effort/`, which the test guard allows under `tmpdir()`.
 *
 * The refusals each find the config's bytes and the SQLite file's
 * absence as they were; the first case finds both changed, so those
 * readings could have failed.
 */
import type { SqliteEffortStore } from './sqlite.js';
import type { EffortRow } from './types.js';

import { appendFileSync, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { parseConfigText } from '../../config.js';
import { projectConfigText } from '../../project/scaffold.js';
import { plantProject } from '../../tests/cli-capture.js';

import { MoveRefusal, moveToSqlite, withSqliteStoreSetting } from './move.js';
import { openNdjsonStore } from './ndjson.js';
import { openSqliteStore, sqliteStorePath } from './sqlite.js';

const scope = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-effort-move-')));
afterAll(() => {
  rmSync(scope, { recursive: true, force: true });
});

const NDJSON_CONFIG = 'version: 1\n# the backend\nstore: ndjson   # sqlite | ndjson\n';

/** A session row carrying its key and one counter. The cast is the plant. */
function sessionRow(sessionId: string): EffortRow<'sessions'> {
  return { sessionId, assistantRecordCount: 1 } as unknown as EffortRow<'sessions'>;
}

/** A commit row carrying its key and one counter. The cast is the plant. */
function commitRow(sha: string): EffortRow<'commits'> {
  return { sha, insertions: 1 } as unknown as EffortRow<'commits'>;
}

/** A project whose config is `text`, holding two sessions and one commit as NDJSON. */
function plantNdjsonProject(text: string = NDJSON_CONFIG): string {
  const { root } = plantProject(realpathSync(mkdtempSync(join(scope, 'case-'))), text);
  const ndjson = openNdjsonStore(root);
  ndjson.append('sessions', [sessionRow('s-1'), sessionRow('s-2')]);
  ndjson.append('commits', [commitRow('c-1')]);
  return root;
}

/** The project config's text. */
function configOf(root: string): string {
  return readFileSync(join(root, '.rafa', 'config.yaml'), 'utf8');
}

describe('moveToSqlite', () => {
  it('appends every NDJSON session and commit to the SQLite store, then sets store: sqlite', () => {
    const root = plantNdjsonProject();

    const result = moveToSqlite({ root });

    expect(result.kinds.map((move) => [move.kind, move.read, move.added, move.skipped])).toEqual([
      ['sessions', 2, 2, 0],
      ['commits', 1, 1, 0],
    ]);
    expect(result.to).toBe(sqliteStorePath(root));
    const sqlite = openSqliteStore(root);
    expect([...sqlite.keys('sessions')].sort()).toEqual(['s-1', 's-2']);
    expect([...sqlite.keys('commits')]).toEqual(['c-1']);
    expect(result.configChanged).toBe(true);
    expect(configOf(root)).toBe('version: 1\n# the backend\nstore: sqlite\n');
  });

  it('adds nothing and changes no config byte when run again', () => {
    const root = plantNdjsonProject();
    moveToSqlite({ root });
    const config = configOf(root);

    const again = moveToSqlite({ root });

    expect(again.kinds.map((move) => [move.kind, move.added, move.skipped])).toEqual([['sessions', 0, 2], ['commits', 0, 1]]);
    expect(again.configChanged).toBe(false);
    expect(configOf(root)).toBe(config);
    expect(openSqliteStore(root).read('sessions')).toHaveLength(2);
  });

  it('brings in a row appended to the NDJSON files after a move', () => {
    const root = plantNdjsonProject();
    moveToSqlite({ root });
    openNdjsonStore(root).append('sessions', [sessionRow('s-3')]);

    const again = moveToSqlite({ root });

    expect(again.kinds[0]?.added).toBe(1);
    expect([...openSqliteStore(root).keys('sessions')].sort()).toEqual(['s-1', 's-2', 's-3']);
  });

  it('uncomments the store line rafa init writes and keeps every other line', () => {
    const root = plantNdjsonProject(projectConfigText());
    const before = configOf(root).split('\n');

    moveToSqlite({ root });

    const after = configOf(root).split('\n');
    expect(after).toHaveLength(before.length);
    expect(after.filter((line, index) => line !== before[index])).toEqual(['store: sqlite']);
  });

  it('counts a keyless row and an unparsed line and moves neither', () => {
    const root = plantNdjsonProject();
    const ndjson = openNdjsonStore(root);
    appendFileSync(ndjson.path('sessions'), '{"assistantRecordCount":3}\nnot json\n');

    const result = moveToSqlite({ root });

    expect(result.kinds[0]).toMatchObject({ read: 2, added: 2, unkeyed: 1, unparsed: 1 });
    expect(openSqliteStore(root).read('sessions')).toHaveLength(2);
  });

  it('refuses a config spelling store in a shape it does not edit, before moving any row', () => {
    const text = 'version: 1\n"store": ndjson\n';
    const root = plantNdjsonProject(text);

    expect(() => moveToSqlite({ root })).toThrow(MoveRefusal);

    expect(configOf(root)).toBe(text);
    expect(existsSync(sqliteStorePath(root))).toBe(false);
  });

  it('refuses when the SQLite keys do not grow by the rows appended, leaving the config as it was', () => {
    const root = plantNdjsonProject();
    const real = openSqliteStore(root);
    const lying: SqliteEffortStore = { ...real, append: (kind, rows) => ({ path: real.path(kind), appended: rows.length, skipped: 0 }) };

    let refusal: unknown = null;
    try {
      moveToSqlite({ root, target: lying });
    } catch (error) {
      refusal = error;
    }

    expect(refusal).toBeInstanceOf(MoveRefusal);
    expect((refusal as MoveRefusal).reason).toBe('count');
    expect((refusal as MoveRefusal).message).toContain('the sessions check failed');
    expect(configOf(root)).toBe(NDJSON_CONFIG);
  });
});

describe('withSqliteStoreSetting', () => {
  it('appends the line to a file naming no store', () => {
    expect(withSqliteStoreSetting('version: 1\n')).toBe('version: 1\nstore: sqlite\n');
    expect(withSqliteStoreSetting('version: 1')).toBe('version: 1\nstore: sqlite\n');
  });

  it('replaces an uncommented store line in place', () => {
    const edited = withSqliteStoreSetting('version: 1\nstore: ndjson\nplan:\n  inject: full\n');

    expect(edited).toBe('version: 1\nstore: sqlite\nplan:\n  inject: full\n');
    expect(parseConfigText(edited ?? '', 'config.yaml').values.store).toBe('sqlite');
  });

  it('refuses a store key it does not recognise rather than add a second one', () => {
    expect(withSqliteStoreSetting('version: 1\n"store": ndjson\n')).toBeNull();
  });
});
