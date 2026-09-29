/**
 * `MERGE_RULES` against the schema every migration builds and against
 * every production edit under `src/`.
 *
 * The schema is read from a real store under `tmpdir()`, brought through
 * `bringForward` with the migrations as its seam, so a scratch migration
 * is added to that one store and never to `SQLITE_MIGRATIONS`. Each check
 * has a planted control beside it that makes it fail, so a clean reading
 * of the real schema cannot come from a check that finds nothing.
 *
 * The edits are read from source, as `origins.test.ts` reads the inserts:
 * every `UPDATE <table> SET <columns>` in a production module, spelled in
 * upper-case SQL with a lower-case table name as every statement under
 * `src/` is. An `UPDATE` whose table or columns the scan cannot read, and
 * any upsert's `DO UPDATE`, is a fault of its own rather than a pass.
 */
import type { MergeRule } from './merge-rules.js';
import type { SqliteMigration } from './migrations.js';

import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';

import { Database } from 'bun:sqlite';
import { afterAll, describe, expect, it } from 'bun:test';

import { bringForward } from './bring-forward.js';
import { MERGE_RULES, SET_ONCE } from './merge-rules.js';
import { SQLITE_MIGRATIONS } from './migrations.js';
import { ORIGIN_TABLES } from './origins.js';

const scope = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-merge-rules-')));
afterAll(() => {
  rmSync(scope, { recursive: true, force: true });
});

/** The `src/` directory whose production modules the edit scan reads. */
const SOURCE_ROOT = join(import.meta.dir, '..', '..');

/** The clock and version every store here is logged under. */
const OPENED = { appliedBy: '0.25.0', now: () => new Date('2026-09-29T10:00:00.000Z') };

/** The pair every merged table carries, in index order. */
const ORIGIN_COLUMNS = ['origin_store', 'origin_seq'];

/** The condition the origin index covers, as `row-origins` spells it. */
const ORIGIN_INDEX_WHERE = 'WHERE origin_store IS NOT NULL';

/** One index of a table, as the store describes it. */
interface LiveIndex {
  readonly name: string;
  readonly unique: boolean;
  readonly partial: boolean;
  readonly columns: readonly string[];
  readonly sql: string | null;
}

/** One table of a store: its columns and its indexes. */
interface LiveTable {
  readonly columns: readonly string[];
  readonly indexes: readonly LiveIndex[];
}

/** A store's tables by name, without SQLite's own. */
type LiveSchema = Readonly<Record<string, LiveTable>>;

let planted = 0;

/** A store brought through `migrations` under a path of its own, handed to `use`. */
function withStore<T>(migrations: readonly SqliteMigration[], use: (db: Database) => T): T {
  planted += 1;
  const path = join(scope, `${String(planted)}.sqlite`);
  const db = new Database(path, { readwrite: true, create: true });
  try {
    bringForward(db, path, 'write', 'open', { ...OPENED, migrations });
    return use(db);
  } finally {
    db.close();
  }
}

/** The indexes of `table`, with their columns in order and the SQL that made them. */
function indexesOf(db: Database, table: string): LiveIndex[] {
  const listed = db
    .query<{ name: string; unique: number; partial: number }, []>(`PRAGMA index_list(${table})`)
    .all();
  return listed.map(({ name, unique, partial }) => ({
    name,
    unique: unique === 1,
    partial: partial === 1,
    columns: db
      .query<{ seqno: number; name: string | null }, []>(`PRAGMA index_info(${name})`)
      .all()
      .sort((left, right) => left.seqno - right.seqno)
      .map((column) => column.name ?? '<expression>'),
    sql: db
      .query<{ sql: string | null }, [string]>('SELECT sql FROM sqlite_master WHERE type = \'index\' AND name = ?')
      .get(name)?.sql ?? null,
  }));
}

/** Every table of the store open on `db`, with its columns and indexes. */
function liveSchema(db: Database): LiveSchema {
  const tables = db
    .query<{ name: string }, []>('SELECT name FROM sqlite_master WHERE type = \'table\' AND name NOT LIKE \'sqlite_%\'')
    .all()
    .map(({ name }) => name);
  return Object.fromEntries(tables.map((table) => [table, {
    columns: db
      .query<{ name: string }, []>(`PRAGMA table_info(${table})`)
      .all()
      .map(({ name }) => name),
    indexes: indexesOf(db, table),
  }]));
}

/** Whether `index` is the partial unique index `row-origins` gives a merged table. */
function isOriginIndex(index: LiveIndex): boolean {
  const where = (index.sql ?? '').replaceAll(/\s+/g, ' ').trim();
  return index.unique
    && index.partial
    && index.columns.join(',') === ORIGIN_COLUMNS.join(',')
    && where.endsWith(ORIGIN_INDEX_WHERE);
}

/** What is wrong with one merged table's entry against the table it names. */
function mergedTableFaults(name: string, table: LiveTable, rule: MergeRule): string[] {
  if (rule.scope === 'local') return [];

  const has = new Set(table.columns);
  const missingOrigin = ORIGIN_COLUMNS
    .filter((column) => !has.has(column))
    .map((column) => `${name}: merged without ${column}`);
  const index = table.indexes.some(isOriginIndex)
    ? []
    : [`${name}: merged without a unique index on (origin_store, origin_seq) ${ORIGIN_INDEX_WHERE}`];
  const identity = rule.identity
    .filter((column) => !has.has(column))
    .map((column) => `${name}: identity column ${column} is not a column`);
  const edited = Object.keys(rule.edited)
    .filter((column) => !has.has(column))
    .map((column) => `${name}: edited column ${column} is not a column`);
  return [...missingOrigin, ...index, ...identity, ...edited];
}

/** Every way `schema` and `rules` disagree, one line each, sorted. */
function schemaFaults(schema: LiveSchema, rules: Readonly<Record<string, MergeRule>>): string[] {
  const fromSchema = Object.entries(schema).flatMap(([name, table]) => {
    const rule = rules[name];
    return rule === undefined
      ? [`${name}: no MERGE_RULES entry`]
      : mergedTableFaults(name, table, rule);
  });
  const fromRules = Object.keys(rules)
    .filter((name) => !Object.hasOwn(schema, name))
    .map((name) => `${name}: MERGE_RULES entry with no table`);
  return [...fromSchema, ...fromRules].sort();
}

/** One production edit found in source. */
interface FoundEdit {
  readonly file: string;
  readonly table: string;
  readonly column: string;
}

/** What a source scan found: the edits it read, and the ones it could not. */
interface ScannedEdits {
  readonly edits: readonly FoundEdit[];
  readonly unreadable: readonly string[];
}

/** An `UPDATE`, its table, and the rest of its statement up to a quote or `;`. */
const UPDATE_STATEMENT = /\bUPDATE\s+([a-z_]\w*|\$\{[^}]*\})([^`'";]*)/g;

/** The `SET` clause of an `UPDATE`'s rest, up to its `WHERE`, `FROM` or `RETURNING`. */
const SET_CLAUSE = /^\s+SET\s+([\s\S]*?)(?:\s+(?:WHERE|FROM|RETURNING)\b|$)/;

/** One `SET` assignment's column. */
const ASSIGNED_COLUMN = /^\s*([a-z_]\w*)\s*=/;

/** An upsert's edit, whose table the scan does not read. */
const UPSERT_EDIT = /\bDO\s+UPDATE\b/g;

/** Every edit `source` makes, read as the module note says. */
function editsIn(file: string, source: string): ScannedEdits {
  const statements = [...source.matchAll(UPDATE_STATEMENT)].map((match) => {
    const table = match[1] ?? '';
    const assignments = SET_CLAUSE.exec(match[2] ?? '')?.[1] ?? '';
    const columns = assignments.split(',').flatMap((part) => {
      const column = ASSIGNED_COLUMN.exec(part)?.[1];
      return column === undefined
        ? []
        : [column];
    });
    return { table, columns, text: match[0].trim() };
  });
  const readable = statements.filter(({ table, columns }) => !table.startsWith('$') && columns.length > 0);
  const unreadable = [
    ...statements.filter((statement) => !readable.includes(statement)).map(({ text }) => `${file}: ${text}`),
    ...[...source.matchAll(UPSERT_EDIT)].map((match) => `${file}: ${match[0]}`),
  ];
  return {
    edits: readable.flatMap(({ table, columns }) => columns.map((column) => ({ file, table, column }))),
    unreadable,
  };
}

/** Every edit with no rule, and every edit the scan could not read, one line each, sorted. */
function editFaults(scanned: ScannedEdits, rules: Readonly<Record<string, MergeRule>>): string[] {
  const unruled = scanned.edits.flatMap(({ file, table, column }) => {
    const rule = rules[table];
    if (rule === undefined) return [`${file}: UPDATE ${table} has no MERGE_RULES entry`];
    if (rule.scope === 'local' || Object.hasOwn(rule.edited, column)) return [];
    return [`${file}: UPDATE ${table} SET ${column} has no rule`];
  });
  const unread = scanned.unreadable.map((text) => `unreadable edit in ${text}`);
  return [...unruled, ...unread].sort();
}

/** Every production module under `src/`, relative to it, and its source. */
function productionSources(): { readonly file: string; readonly source: string }[] {
  return [...new Bun.Glob('**/*.ts').scanSync({ cwd: SOURCE_ROOT })]
    .filter((file) => !file.endsWith('.test.ts'))
    .sort()
    .map((file) => ({ file, source: readFileSync(join(SOURCE_ROOT, file), 'utf8') }));
}

/** The edits every production module makes, read from source. */
function productionEdits(): ScannedEdits {
  const scans = productionSources().map(({ file, source }) => editsIn(file, source));
  return {
    edits: scans.flatMap(({ edits }) => edits),
    unreadable: scans.flatMap(({ unreadable }) => unreadable),
  };
}

/** A scratch migration adding the table `scratch_notes` with `columns` and then `extra`. */
function scratchTable(columns: string, extra = ''): SqliteMigration {
  return {
    id: 'scratch-notes',
    breaks: [],
    sql: `CREATE TABLE scratch_notes (seq INTEGER PRIMARY KEY, id TEXT NOT NULL UNIQUE, note TEXT${columns});${extra}`,
  };
}

/** The origin pair's columns, as `row-origins` adds them. */
const WITH_ORIGIN = ', origin_store TEXT, origin_seq INTEGER';

/** The origin index `row-origins` gives each merged table, for `scratch_notes`. */
const ORIGIN_INDEX = `
  CREATE UNIQUE INDEX scratch_notes_by_origin
    ON scratch_notes (origin_store, origin_seq)
    WHERE origin_store IS NOT NULL;`;

/** The registry with `scratch_notes` merged by `id`, never edited. */
const WITH_SCRATCH: Readonly<Record<string, MergeRule>> = {
  ...MERGE_RULES,
  scratch_notes: { scope: 'merged', identity: ['id'], edited: {} },
};

/** The faults of a store brought through every migration and then `scratch`. */
function scratchFaults(scratch: SqliteMigration, rules: Readonly<Record<string, MergeRule>>): string[] {
  return withStore([...SQLITE_MIGRATIONS, scratch], (db) => schemaFaults(liveSchema(db), rules));
}

describe('MERGE_RULES against the schema every migration builds', () => {
  const schema = withStore(SQLITE_MIGRATIONS, liveSchema);

  it('reads the sixteen tables the migrations create', () => {
    expect(Object.keys(schema).sort()).toEqual([
      'blockers', 'changes', 'commits', 'dispatches', 'findings', 'merge_conflicts', 'merges',
      'out_of_scope_bugs', 'plan_ci', 'preflight', 'report_absences', 'schema_migrations',
      'sessions', 'skill_invocations', 'store_meta', 'task_reports',
    ]);
  });

  it('gives every table an entry, and every merged table its origin pair, its index and its columns', () => {
    expect(schemaFaults(schema, MERGE_RULES)).toEqual([]);
  });

  it('merges exactly the tables every production insert stamps an origin on', () => {
    const merged = Object.entries(MERGE_RULES)
      .filter(([, rule]) => rule.scope === 'merged')
      .map(([name]) => name);

    expect(merged.sort()).toEqual([...ORIGIN_TABLES].sort());
  });

  it('fails on a scratch migration adding a table with no entry (control)', () => {
    expect(scratchFaults(scratchTable(WITH_ORIGIN, ORIGIN_INDEX), MERGE_RULES))
      .toEqual(['scratch_notes: no MERGE_RULES entry']);
  });

  it('passes the same scratch table once it has its entry (control)', () => {
    expect(scratchFaults(scratchTable(WITH_ORIGIN, ORIGIN_INDEX), WITH_SCRATCH)).toEqual([]);
  });

  it('fails on a merged table without either origin column or its index (control)', () => {
    expect(scratchFaults(scratchTable(''), WITH_SCRATCH)).toEqual([
      `scratch_notes: merged without a unique index on (origin_store, origin_seq) ${ORIGIN_INDEX_WHERE}`,
      'scratch_notes: merged without origin_seq',
      'scratch_notes: merged without origin_store',
    ]);
  });

  it('fails on a merged table with both origin columns and no index over them (control)', () => {
    expect(scratchFaults(scratchTable(WITH_ORIGIN), WITH_SCRATCH)).toEqual([
      `scratch_notes: merged without a unique index on (origin_store, origin_seq) ${ORIGIN_INDEX_WHERE}`,
    ]);
  });

  it('fails on an origin index that is unique but not partial (control)', () => {
    const whole = '\n  CREATE UNIQUE INDEX scratch_notes_by_origin ON scratch_notes (origin_store, origin_seq);';

    expect(scratchFaults(scratchTable(WITH_ORIGIN, whole), WITH_SCRATCH)).toEqual([
      `scratch_notes: merged without a unique index on (origin_store, origin_seq) ${ORIGIN_INDEX_WHERE}`,
    ]);
  });

  it('fails on an origin index that is partial but not unique (control)', () => {
    const plain = ORIGIN_INDEX.replace('CREATE UNIQUE INDEX', 'CREATE INDEX');

    expect(scratchFaults(scratchTable(WITH_ORIGIN, plain), WITH_SCRATCH)).toEqual([
      `scratch_notes: merged without a unique index on (origin_store, origin_seq) ${ORIGIN_INDEX_WHERE}`,
    ]);
  });

  it('fails on an entry naming an identity or edited column the table lacks (control)', () => {
    const rules = {
      ...MERGE_RULES,
      scratch_notes: { scope: 'merged', identity: ['uuid'], edited: { status: SET_ONCE } },
    } as const;

    expect(scratchFaults(scratchTable(WITH_ORIGIN, ORIGIN_INDEX), rules)).toEqual([
      'scratch_notes: edited column status is not a column',
      'scratch_notes: identity column uuid is not a column',
    ]);
  });

  it('fails on an entry whose table no migration creates (control)', () => {
    const rules = { ...MERGE_RULES, ref_links: { scope: 'local' } } as const;

    expect(schemaFaults(schema, rules)).toEqual(['ref_links: MERGE_RULES entry with no table']);
  });
});

describe('MERGE_RULES against every production edit under src/', () => {
  const scanned = productionEdits();

  it('reads every source module under src/', () => {
    const files = productionSources().map(({ file }) => file);

    expect(files).toContain(relative(SOURCE_ROOT, join(import.meta.dir, 'tracker-refs.ts')));
    expect(files).toContain('rafa.ts');
  });

  it('finds the one edit a production module makes, and it has a rule', () => {
    expect(scanned.edits).toEqual([
      { file: 'effort/store/tracker-refs.ts', table: 'findings', column: 'tracker_ref' },
    ]);
    expect(editFaults(scanned, MERGE_RULES)).toEqual([]);
  });

  it('fails on a planted edit of a merged column with no rule (control)', () => {
    const planted = editsIn('planted.ts', 'const SQL = \'UPDATE findings SET outcome = ? WHERE seq = ?\';');

    expect(editFaults(planted, MERGE_RULES)).toEqual(['planted.ts: UPDATE findings SET outcome has no rule']);
  });

  it('reads every column of a planted edit that sets two (control)', () => {
    const source = 'const SQL = `UPDATE findings\n  SET tracker_ref = ?,\n      outcome = ?\n  WHERE seq = ?`;';

    expect(editFaults(editsIn('planted.ts', source), MERGE_RULES))
      .toEqual(['planted.ts: UPDATE findings SET outcome has no rule']);
  });

  it('fails on a planted edit of a table with no entry (control)', () => {
    const planted = editsIn('planted.ts', 'const SQL = \'UPDATE scratch_notes SET note = ?\';');

    expect(editFaults(planted, MERGE_RULES)).toEqual(['planted.ts: UPDATE scratch_notes has no MERGE_RULES entry']);
  });

  it('passes a planted edit of a local table (control)', () => {
    const planted = editsIn('planted.ts', 'const SQL = \'UPDATE merges SET rows_added = ? WHERE id = ?\';');

    expect(planted.edits).toEqual([{ file: 'planted.ts', table: 'merges', column: 'rows_added' }]);
    expect(editFaults(planted, MERGE_RULES)).toEqual([]);
  });

  it('fails on an edit whose table or columns it cannot read, and on an upsert (control)', () => {
    const source = [
      'const A = `UPDATE ${table} SET note = ?`;',
      'const B = `INSERT INTO findings (id) VALUES (?) ON CONFLICT (id) DO UPDATE SET outcome = excluded.outcome`;',
    ].join('\n');

    expect(editFaults(editsIn('planted.ts', source), MERGE_RULES)).toEqual([
      'unreadable edit in planted.ts: DO UPDATE',
      'unreadable edit in planted.ts: UPDATE ${table} SET note = ?',
    ]);
  });
});
