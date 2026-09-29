/**
 * Three lint-shaped guards over the production sources under `src/`,
 * each a plain scan a linter could in principle run, none of them
 * wired into `eslint.config.mjs` today:
 *
 *   - No `SELECT *`. A wildcard select survives an additive column the
 *     writer that ran it never knew, and a reader across a store
 *     migration boundary has to read named columns to stay forward
 *     compatible (`row-fields.test.ts`, `forward-compat.test.ts`).
 *   - No `INSERT INTO <table> VALUES` or `INSERT INTO <table> SELECT`
 *     with no column list. Positional values drift silently when a
 *     column is added between the statement and the table it targets;
 *     every production `INSERT INTO` in this tree already names its
 *     columns (`changes.ts`, `dispatches.ts`, `findings.ts`,
 *     `triage.ts`, `absences.ts`, `preflight.ts`, `reports.ts`,
 *     `plan-ci.ts`, `skill-invocations.ts`, `tracker-refs.ts`,
 *     `sqlite.ts`'s row store, `bring-forward.ts`'s log insert).
 *   - No `new Database(` outside `sqlite.ts`, `fix-schema.ts`,
 *     `copy.ts`, `schema-report.ts`, `migrate.ts`, `merge-store.ts`,
 *     `fixture-extract.ts` and `testdata/merge-scenarios.ts`.
 *     Every other opener of a SQLite
 *     handle is expected to go through `withSqliteStore` (`sqlite.ts`)
 *     so every open runs the test guard, the busy timeout and
 *     `bringForward` alike; `fix-schema.ts` opens the store itself on
 *     purpose, by its own module note, and runs the guard directly
 *     before it does. So do `copy.ts`, whose read-only `VACUUM INTO`
 *     must never call `bringForward`: an open through `withSqliteStore`
 *     would adopt a pre-log store it copies, and `schema-report.ts`,
 *     whose read-only report must leave a store with a migration
 *     pending as it found it, and `migrate.ts`, which opens only the
 *     file it built beside the store, and must bring that file forward
 *     as the `migrate` caller, the one a breaking migration is applied
 *     for, rather than as the ordinary open `withSqliteStore` makes.
 *     `merge-store.ts` opens the other store `{ readonly: true }`,
 *     which no open through `withSqliteStore` is, and brings forward
 *     only files it built itself, with `builtAside`.
 *     `fixture-extract.ts` opens the two stores it extracts
 *     `{ readonly: true }` too, and builds a fixture store from an
 *     extract at the migrations the extract holds, which an open
 *     through `withSqliteStore` would bring forward; it runs the
 *     guard itself before either.
 *     `testdata/merge-scenarios.ts` builds the merge scenarios' stores
 *     under `tmpdir()`: one left at the `plan-ci` schema, which an open
 *     through `withSqliteStore` would bring forward, and every other
 *     with a `store_meta` row it plants, where a writing open would
 *     mint one from the real host id; it runs the guard itself first.
 *
 * A fourth guard reads `schema-plan.ts` alone: it imports neither
 * `bun:sqlite` nor `sqlite.ts`, which is `schema-plan.ts`'s own module
 * note — the compatibility decision is a pure function over plain
 * values, independent of the backend that holds the store.
 *
 * Each matcher is a plain function over source text, proved against a
 * PLANTED near-miss before it is trusted over the live tree: a snippet
 * built here, shaped exactly like the violation, that the matcher has
 * to catch. A guard that only ever answered zero over the real files
 * would look identical to a guard that never looked; the planted
 * control is what tells the two apart.
 *
 * Only `src/**\/*.ts` files that are not `*.test.ts` are scanned. Test
 * files plant `new Database(` calls and SQL text of every shape on
 * purpose, as fixtures and assertions, and are not production code.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'bun:test';

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const SRC_DIR = join(REPO_ROOT, 'src');

/** One production `.ts` file: its repo-relative path and its text. */
interface SourceFile {
  readonly path: string;
  readonly text: string;
}

/** Every `.ts` file under `src/` that is not a `*.test.ts` file. */
function findProductionSources(root: string): SourceFile[] {
  const entries = readdirSync(root, { recursive: true, encoding: 'utf8' });
  const files: SourceFile[] = [];
  for (const entry of entries) {
    if (!entry.endsWith('.ts') || entry.endsWith('.test.ts')) continue;
    const path = join(root, entry);
    files.push({ path: relative(REPO_ROOT, path), text: readFileSync(path, 'utf8') });
  }
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

const SOURCES = findProductionSources(SRC_DIR);

/** A `SELECT *`, spanning a line break between the two tokens. */
const SELECT_STAR = /SELECT\s*\*/i;

/**
 * `INSERT INTO <table>` running straight into `VALUES` or a bare
 * `SELECT`, with no `(column, ...)` list between the table and either
 * keyword. `INSERT INTO t (a, b) SELECT a, b FROM u`, a breaking-entry
 * table rebuild's shape, is not this: the column list sits between the
 * table and `SELECT`.
 */
const INSERT_NO_COLUMNS = /INSERT\s+INTO\s+[A-Za-z_][\w.$]*\s+(VALUES|SELECT)\b/i;

/** A raw `new Database(` construction, however it is spaced. */
const NEW_DATABASE = /new\s+Database\s*\(/;

/** The only production files allowed to construct `Database` directly. */
const DATABASE_OPENER_ALLOW_LIST: ReadonlySet<string> = new Set([
  'src/effort/store/sqlite.ts',
  'src/effort/store/fix-schema.ts',
  'src/effort/store/copy.ts',
  'src/effort/store/schema-report.ts',
  'src/effort/store/migrate.ts',
  'src/effort/store/merge-store.ts',
  'src/effort/store/fixture-extract.ts',
  'src/effort/store/testdata/merge-scenarios.ts',
]);

/** An `import … from 'bun:sqlite'` or from a `sqlite.{js,ts}` module. */
const SQLITE_IMPORT = /from\s+['"](bun:sqlite|(?:\.{1,2}\/)*sqlite\.(?:js|ts))['"]/;

describe('production sources under src/', () => {
  it('finds a non-empty source set including the store modules under test', () => {
    const paths = SOURCES.map((file) => file.path);
    expect(SOURCES.length).toBeGreaterThan(50);
    expect(paths).toContain('src/effort/store/sqlite.ts');
    expect(paths).toContain('src/effort/store/fix-schema.ts');
    expect(paths).toContain('src/effort/store/schema-plan.ts');
  });

  describe('no `SELECT *`', () => {
    it('matches a planted `SELECT * FROM table`', () => {
      expect(SELECT_STAR.test('const q = `SELECT * FROM changes`;')).toBe(true);
    });

    it('matches a planted wildcard select wrapped across a line break', () => {
      expect(SELECT_STAR.test('const q = `SELECT\n  *\nFROM changes`;')).toBe(true);
    });

    it('does not match a planted `COUNT(*)`, which is not a wildcard select', () => {
      expect(SELECT_STAR.test('const q = `SELECT COUNT(*) AS n FROM changes`;')).toBe(false);
    });

    it('finds no `SELECT *` in any production source', () => {
      const offenders = SOURCES.filter((file) => SELECT_STAR.test(file.text)).map((file) => file.path);
      expect(offenders).toEqual([]);
    });
  });

  describe('no unqualified `INSERT INTO`', () => {
    it('matches a planted `INSERT INTO table VALUES (...)`', () => {
      expect(INSERT_NO_COLUMNS.test('db.run(`INSERT INTO changes VALUES (?, ?, ?)`);')).toBe(true);
    });

    it('matches a planted `INSERT INTO table SELECT ...` with no column list', () => {
      expect(INSERT_NO_COLUMNS.test('db.run(`INSERT INTO changes SELECT * FROM staged`);')).toBe(true);
    });

    it('does not match a planted `INSERT INTO table (cols) VALUES (...)`', () => {
      expect(INSERT_NO_COLUMNS.test('db.run(`INSERT INTO changes (id, level) VALUES (?, ?)`);')).toBe(false);
    });

    it('does not match a planted breaking-entry table rebuild, column list then SELECT', () => {
      expect(INSERT_NO_COLUMNS.test('db.run(`INSERT INTO main.t (a, b) SELECT a, b FROM live.t`);')).toBe(false);
    });

    it('finds no unqualified `INSERT INTO` in any production source', () => {
      const offenders = SOURCES.filter((file) => INSERT_NO_COLUMNS.test(file.text)).map((file) => file.path);
      expect(offenders).toEqual([]);
    });
  });

  describe('no `new Database(` outside the allow-list', () => {
    it('matches a planted `new Database(path, opts)`', () => {
      expect(NEW_DATABASE.test('const db = new Database(path, { readwrite: true });')).toBe(true);
    });

    it('matches a planted construction spaced across a line break', () => {
      expect(NEW_DATABASE.test('const db = new Database\n  (path);')).toBe(true);
    });

    it('does not match a planted call to an unrelated `Database` factory', () => {
      expect(NEW_DATABASE.test('const db = openDatabase(path);')).toBe(false);
    });

    it('finds every production opener inside the allow-list, and no opener outside it', () => {
      const openers = SOURCES.filter((file) => NEW_DATABASE.test(file.text)).map((file) => file.path);
      expect(openers.length).toBeGreaterThan(0);
      const outside = openers.filter((path) => !DATABASE_OPENER_ALLOW_LIST.has(path));
      expect(outside).toEqual([]);
      for (const allowed of DATABASE_OPENER_ALLOW_LIST) expect(openers).toContain(allowed);
    });
  });

  describe('schema-plan.ts stays free of the SQLite backend', () => {
    it('matches a planted `bun:sqlite` import', () => {
      expect(SQLITE_IMPORT.test('import { Database } from \'bun:sqlite\';')).toBe(true);
    });

    it('matches a planted import of a relative `sqlite.js` module', () => {
      expect(SQLITE_IMPORT.test('import { withSqliteStore } from \'./sqlite.js\';')).toBe(true);
    });

    it('does not match a planted import of an unrelated module named alike', () => {
      expect(SQLITE_IMPORT.test('import { legacyGate } from \'./migrations.js\';')).toBe(false);
    });

    it('imports neither `bun:sqlite` nor `sqlite.ts` in the live schema-plan.ts', () => {
      const schemaPlan = SOURCES.find((file) => file.path === 'src/effort/store/schema-plan.ts');
      expect(schemaPlan).toBeDefined();
      expect(SQLITE_IMPORT.test(schemaPlan!.text)).toBe(false);
    });
  });
});
