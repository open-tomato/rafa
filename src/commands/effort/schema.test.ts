/**
 * `rafa effort schema [--check]` spawned in scratch projects through
 * `runRafa`, and dispatched in-process where a case needs a synthetic
 * catalogue, a development-build probe or json mode: one store per
 * `planSchema` refusal reason, a current store, a store with a
 * migration pending left byte-identical, and the list of reasons held
 * to the list of `nextStep` values.
 */
import type { SqliteMigration } from '../../effort/store/migrations.js';
import type { SchemaReport } from '../../effort/store/schema-report.js';
import type { CapturedRun, ScratchRepo } from '../../tests/cli-capture.js';

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Database } from 'bun:sqlite';
import { afterAll, describe, expect, it } from 'bun:test';

import { runningCommand } from '../../cli/running.js';
import { bringForward } from '../../effort/store/bring-forward.js';
import { REFUSAL_REASONS } from '../../effort/store/schema-plan.js';
import { migrateSchema, SQLITE_MIGRATIONS, withSqliteStore } from '../../effort/store/sqlite.js';
import { readStoreMeta } from '../../effort/store/store-meta.js';
import { dispatchInProject, eventsOf, expectExit, plantProject, plantScratchRepo, runRafa } from '../../tests/cli-capture.js';
import { gitIdentityEnv } from '../../tests/git-identity.js';

import { createSchemaCommand } from './schema.js';

const SPAWN_TIMEOUT = 60_000;

const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-effort-schema-')));
afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** The subject the command sits under, declared for the registry an in-process case dispatches over. */
const EFFORT_SUBJECT = { name: 'effort', summary: 'the effort store' };

/** The way out of every refusal a rebuild repairs. */
const FIX_SCHEMA_STEP = 'rafa effort fix-schema --dry-run';

/** An additive entry this build does not ship, appended to make a migration pending. */
const ADDITIVE_TAIL: SqliteMigration = {
  id: 'synthetic-notes',
  breaks: [],
  sql: 'CREATE TABLE synthetic_notes (seq INTEGER PRIMARY KEY, note TEXT);',
};

/** A breaking entry this build does not ship. */
const BREAKING_TAIL: SqliteMigration = {
  id: 'synthetic-drop-notes',
  breaks: ['readers', 'writers'],
  contract: { expand: null, why: 'a synthetic breaking migration for the schema report' },
  sql: 'DROP TABLE IF EXISTS synthetic_notes;',
};

/** The live store file under a project root. */
function storeFile(root: string): string {
  return join(root, '.rafa', 'effort', 'effort.sqlite');
}

/** Plants a store this build brought forward: logged, current, gate open. */
function plantCurrent(root: string, migrations: readonly SqliteMigration[] = SQLITE_MIGRATIONS): string {
  const path = storeFile(root);
  mkdirSync(join(root, '.rafa', 'effort'), { recursive: true });
  const db = new Database(path, { create: true, readwrite: true });
  try {
    bringForward(db, path, 'write', 'open', { migrations });
  } finally {
    db.close();
  }
  return path;
}

/** Plants a store a release before the log wrote: `version` legacy entries, no log. */
function plantPreLog(root: string, version: number): string {
  const path = storeFile(root);
  mkdirSync(join(root, '.rafa', 'effort'), { recursive: true });
  const db = new Database(path, { create: true, readwrite: true });
  try {
    migrateSchema(db, path, SQLITE_MIGRATIONS.slice(0, Math.min(version, SQLITE_MIGRATIONS.length)));
    db.run(`PRAGMA user_version = ${String(version)}`);
  } finally {
    db.close();
  }
  return path;
}

/** Runs `statements` on the store at `path`, as another rafa would have written it. */
function tamper(path: string, statements: readonly string[]): void {
  const db = new Database(path, { readwrite: true });
  try {
    for (const statement of statements) db.run(statement);
  } finally {
    db.close();
  }
}

/** A log row this build does not know, breaking `breaks`. */
function unknownRow(id: string, breaks: readonly string[]): string {
  return 'INSERT INTO schema_migrations (id, sha256, breaks, applied_at, applied_by)'
    + ` VALUES ('${id}', '${'a'.repeat(64)}', '${JSON.stringify(breaks)}', '2026-10-01T09:00:00.000Z', '0.30.0')`;
}

/** Gives the scratch repository a root commit, so a mint of a store in it can name its project. */
function commitRoot(scratch: ScratchRepo): void {
  execFileSync('git', ['-c', 'user.name=rafa-test', '-c', 'user.email=rafa-test@example.invalid', 'commit', '-q', '--allow-empty', '-m', 'root'], {
    cwd: scratch.repo,
    stdio: 'pipe',
    env: { ...process.env, HOME: scratch.home, GIT_CONFIG_GLOBAL: join(scratch.home, '.gitconfig'), GIT_CONFIG_NOSYSTEM: '1', ...gitIdentityEnv() },
  });
}

/** Every `store_meta` row of the store at `path`, read on a read-only connection. */
function storeMetaRows(path: string): unknown[] {
  const db = new Database(path, { readonly: true });
  try {
    return db.query('SELECT store_id FROM store_meta').all();
  } finally {
    db.close();
  }
}

/** One planted store per refusal a spawned run can meet, with the next step each names. */
const SPAWNED_REFUSALS: readonly {
  readonly reason: string;
  readonly plant: (root: string) => string;
  readonly nextStep: string;
}[] = [
  { reason: 'pre-log-unreleased', plant: (root) => plantPreLog(root, 15), nextStep: FIX_SCHEMA_STEP },
  {
    reason: 'gate-mismatch',
    plant: (root) => {
      const path = plantCurrent(root);
      tamper(path, ['PRAGMA user_version = 12']);
      return path;
    },
    nextStep: FIX_SCHEMA_STEP,
  },
  {
    reason: 'edited',
    plant: (root) => {
      const path = plantCurrent(root);
      tamper(path, [`UPDATE schema_migrations SET sha256 = '${'0'.repeat(64)}' WHERE id = 'findings'`]);
      return path;
    },
    nextStep: FIX_SCHEMA_STEP,
  },
  {
    reason: 'unknown-breaks-readers',
    plant: (root) => {
      const path = plantCurrent(root);
      tamper(path, [unknownRow('future-readers', ['readers'])]);
      return path;
    },
    nextStep: `install a rafa that knows future-readers, or ${FIX_SCHEMA_STEP}`,
  },
  {
    reason: 'unknown-breaks-writers',
    plant: (root) => {
      const path = plantCurrent(root);
      tamper(path, [unknownRow('future-writers', ['writers'])]);
      return path;
    },
    nextStep: `install a rafa that knows future-writers, or ${FIX_SCHEMA_STEP}`,
  },
];

/** The two refusals only a catalogue holding a breaking entry reaches, each with the catalogue it is read against. */
const CATALOGUE_REFUSALS: readonly {
  readonly reason: string;
  readonly plant: (root: string) => string;
  readonly migrations: readonly SqliteMigration[];
  readonly nextStep: string;
}[] = [
  {
    reason: 'breaking-out-of-order',
    // The store holds the additive entry the catalogue places after the breaking one.
    plant: (root) => plantCurrent(root, [...SQLITE_MIGRATIONS, ADDITIVE_TAIL]),
    migrations: [...SQLITE_MIGRATIONS, BREAKING_TAIL, ADDITIVE_TAIL],
    nextStep: 'rafa effort schema',
  },
  {
    reason: 'breaking-pending',
    plant: (root) => plantCurrent(root),
    migrations: [...SQLITE_MIGRATIONS, BREAKING_TAIL],
    nextStep: 'rafa effort migrate --dry-run',
  },
];

/** Spawns `rafa effort schema` with `words` after it, at the scratch repository's root. */
function schema(scratch: ScratchRepo, words: readonly string[] = [], env: Readonly<Record<string, string>> = {}): CapturedRun {
  return runRafa(scratch, scratch.repo, ['effort', 'schema', ...words], env);
}

/** The last line a run wrote to stdout. */
function lastLine(run: CapturedRun): string | undefined {
  return run.stdout.trimEnd().split('\n')
    .at(-1);
}

/** Dispatches `rafa effort schema --output=json` in-process over a fresh project and answers its report. */
async function jsonReport(
  plant: (root: string) => string,
  migrations: readonly SqliteMigration[] = SQLITE_MIGRATIONS,
): Promise<SchemaReport> {
  const project = plantProject(realpathSync(mkdtempSync(join(tempBase, 'json-'))));
  plant(project.root);
  const run = await dispatchInProject(['effort', 'schema', '--output=json'], [EFFORT_SUBJECT], [createSchemaCommand({ migrations })], project);
  expect(run.exitCode).toBe(0);
  const result = eventsOf(run.stdout).find((event) => event.type === 'result');
  return result?.data as SchemaReport;
}

describe('rafa effort schema over a store this rafa uses', () => {
  it('reports a current store: every migration applied, none pending, gate open, next step none, --check exits 0', () => {
    const scratch = plantScratchRepo(tempBase);
    const path = plantCurrent(scratch.repo);
    const before = readFileSync(path);

    const run = schema(scratch, ['--check']);

    expect(run.stderr).toBe('');
    expectExit(run, 0, scratch);
    expect(run.stdout).toContain(`Effort store: ${path}`);
    expect(run.stdout).toContain(`Applied (${String(SQLITE_MIGRATIONS.length)}): kind-tables (`);
    expect(run.stdout).toContain('Pending (0): none');
    expect(run.stdout).toContain('Unknown (0): none');
    expect(run.stdout).toContain('Edited (0): none');
    expect(run.stdout).toContain('Gate (user_version): 13 (open: a release before the migration log reads and writes the store)');
    expect(run.stdout).toContain('✅ Current: this rafa reads and writes the store as it is.');
    expect(lastLine(run)).toBe('Next safe step: none');
    expect(Buffer.compare(readFileSync(path), before)).toBe(0);
  }, SPAWN_TIMEOUT);

  it('leaves a pre-log store with plan-ci pending byte-identical, reporting it behind with no log made', () => {
    const scratch = plantScratchRepo(tempBase);
    const path = plantPreLog(scratch.repo, 12);
    const before = readFileSync(path);

    const run = schema(scratch, ['--check']);

    expectExit(run, 0, scratch);
    expect(run.stdout).toContain('Migration log: none; a release before the log wrote this store, and the next open adopts it.');
    expect(run.stdout).toContain('Gate (user_version): 12 (a count of legacy migrations: no log yet); 13 (open:');
    const pending = SQLITE_MIGRATIONS.slice(12).map(({ id }) => id);
    expect(run.stdout).toContain(`Pending (${String(pending.length)}): ${pending.join(', ')}\n`);
    expect(run.stdout).toContain('✅ Behind:');
    expect(lastLine(run)).toBe('Next safe step: none');
    expect(Buffer.compare(readFileSync(path), before)).toBe(0);
    const db = new Database(path, { readonly: true });
    try {
      expect(db.query('SELECT name FROM sqlite_master WHERE name = \'schema_migrations\'').all()).toEqual([]);
      expect(db.query('PRAGMA user_version').get()).toEqual({ user_version: 12 });
    } finally {
      db.close();
    }
  }, SPAWN_TIMEOUT);

  it('leaves a logged store with a synthetic migration pending byte-identical, listing it pending', async () => {
    const project = plantProject(realpathSync(mkdtempSync(join(tempBase, 'pending-'))));
    const path = plantCurrent(project.root);
    const before = readFileSync(path);
    const command = createSchemaCommand({ migrations: [...SQLITE_MIGRATIONS, ADDITIVE_TAIL] });

    const run = await dispatchInProject(['effort', 'schema', '--check'], [EFFORT_SUBJECT], [command], project);

    expect(run.exitCode).toBe(0);
    expect(run.stdout).toContain('Pending (1): synthetic-notes');
    expect(run.stdout).toContain('✅ Behind:');
    expect(Buffer.compare(readFileSync(path), before)).toBe(0);
    // Control: the same store opened through the log-aware open does apply it, so the read-only report could have.
    const db = new Database(path, { readwrite: true });
    try {
      bringForward(db, path, 'read', 'open', { migrations: [...SQLITE_MIGRATIONS, ADDITIVE_TAIL] });
    } finally {
      db.close();
    }
    expect(Buffer.compare(readFileSync(path), before)).not.toBe(0);
  });

  it('leaves an unminted store in a project with a root commit byte-identical, while a write open over it, the control, mints', () => {
    const scratch = plantScratchRepo(tempBase);
    commitRoot(scratch);
    const path = plantCurrent(scratch.repo);
    const before = readFileSync(path);

    const run = schema(scratch, ['--check']);

    expectExit(run, 0, scratch);
    expect(run.stdout).toContain('✅ Current:');
    expect(Buffer.compare(readFileSync(path), before)).toBe(0);
    expect(storeMetaRows(path)).toEqual([]);
    // Control: a write open of the same file mints from the project's own git, so the report could have written the row.
    const meta = withSqliteStore(path, 'write', false, (db) => readStoreMeta(db), { readHostId: () => 'host-control' });
    expect(meta?.hostId).toBe('host-control');
    expect(meta?.projectRootCommit).toMatch(/^[0-9a-f]{40}$/);
    expect(storeMetaRows(path)).toHaveLength(1);
    expect(Buffer.compare(readFileSync(path), before)).not.toBe(0);
  }, SPAWN_TIMEOUT);

  it('reports no store as absent with next step none, creating nothing', () => {
    const scratch = plantScratchRepo(tempBase);

    const run = schema(scratch, ['--check']);

    expectExit(run, 0, scratch);
    expect(run.stdout).toContain('No store yet');
    expect(lastLine(run)).toBe('Next safe step: none');
    expect(existsSync(join(scratch.repo, '.rafa', 'effort'))).toBe(false);
  }, SPAWN_TIMEOUT);

  it('reports an unknown additive migration and still uses the store', async () => {
    const report = await jsonReport((root) => {
      const path = plantCurrent(root);
      tamper(path, [unknownRow('future-additive', [])]);
      return path;
    });

    expect(report.status).toBe('current');
    expect(report.refused).toBe(false);
    expect(report.nextStep).toBe('none');
    expect(report.unknown.map(({ id, breaks }) => ({ id, breaks }))).toEqual([{ id: 'future-additive', breaks: [] }]);
  });
});

describe('rafa effort schema --check over a store this rafa refuses, one per reason', () => {
  for (const { reason, plant, nextStep } of SPAWNED_REFUSALS) {
    it(`exits 1 on ${reason}, ending with Next safe step: ${nextStep}, the store unchanged`, () => {
      const scratch = plantScratchRepo(tempBase);
      const path = plant(scratch.repo);
      const before = readFileSync(path);

      const checked = schema(scratch, ['--check']);
      const plain = schema(scratch);

      expectExit(checked, 1, scratch);
      expect(checked.stdout).toContain(`❌ Refused (${reason}): effort store: ${path} `);
      expect(lastLine(checked)).toBe(`Next safe step: ${nextStep}`);
      expect(checked.stderr).toContain(`❌ rafa effort schema --check: this rafa refuses ${path} (${reason}). Next safe step: ${nextStep}`);
      // Control: without --check the same report exits 0, so the 1 is --check's.
      expectExit(plain, 0, scratch);
      expect(lastLine(plain)).toBe(`Next safe step: ${nextStep}`);
      expect(Buffer.compare(readFileSync(path), before)).toBe(0);
    }, SPAWN_TIMEOUT);
  }

  it('lists the edited migration with both checksums', () => {
    const scratch = plantScratchRepo(tempBase);
    const edited = SPAWNED_REFUSALS.find(({ reason }) => reason === 'edited');
    edited?.plant(scratch.repo);

    const run = schema(scratch);

    expect(run.stdout).toContain(`Edited (1): findings (store ${'0'.repeat(64)}, this rafa `);
    expect(run.stdout).toContain(`Applied (${String(SQLITE_MIGRATIONS.length - 1)}): `);
  }, SPAWN_TIMEOUT);

  it('refuses an unknown migration that breaks writers while effort report still reads the store', () => {
    const scratch = plantScratchRepo(tempBase);
    const writers = SPAWNED_REFUSALS.find(({ reason }) => reason === 'unknown-breaks-writers');
    const path = writers?.plant(scratch.repo) ?? '';
    const before = readFileSync(path);

    const checked = schema(scratch, ['--check']);
    const report = runRafa(scratch, scratch.repo, ['effort', 'report']);

    expectExit(checked, 1, scratch);
    expect(checked.stdout).toContain('Unknown (1): future-writers (breaks writers; applied by 0.30.0 on 2026-10-01T09:00:00.000Z)');
    expectExit(report, 0, scratch);
    expect(Buffer.compare(readFileSync(path), before)).toBe(0);
  }, SPAWN_TIMEOUT);

  for (const { reason, plant, migrations, nextStep } of CATALOGUE_REFUSALS) {
    it(`exits 1 on ${reason} against a catalogue holding a breaking entry, ending with Next safe step: ${nextStep}`, async () => {
      const project = plantProject(realpathSync(mkdtempSync(join(tempBase, 'catalogue-'))));
      const path = plant(project.root);
      const before = readFileSync(path);
      const command = createSchemaCommand({ migrations });

      const run = await dispatchInProject(['effort', 'schema', '--check'], [EFFORT_SUBJECT], [command], project);

      expect(run.exitCode).toBe(1);
      expect(run.stdout).toContain(`❌ Refused (${reason}): effort store: ${path} `);
      expect(lastLine(run)).toBe(`Next safe step: ${nextStep}`);
      expect(Buffer.compare(readFileSync(path), before)).toBe(0);
    });
  }

  it('exits 1 for a development build that would bring an unowned store forward, naming rafa effort copy', async () => {
    const project = plantProject(realpathSync(mkdtempSync(join(tempBase, 'development-'))));
    const path = plantPreLog(project.root, 12);
    const before = readFileSync(path);
    const elsewhere = realpathSync(mkdtempSync(join(tempBase, 'other-tmp-')));
    const development = { identity: { kind: 'development', entry: '/checkout/src/rafa.ts', checkout: '/checkout' }, tempDir: elsewhere } as const;
    const refused = createSchemaCommand({ development });
    const owned = createSchemaCommand({ development: { ...development, tempDir: tmpdir() } });

    const run = await dispatchInProject(['effort', 'schema', '--check'], [EFFORT_SUBJECT], [refused], project);
    // Control: the same build over a store it owns reports it behind.
    const control = await dispatchInProject(['effort', 'schema', '--check'], [EFFORT_SUBJECT], [owned], project);

    expect(run.exitCode).toBe(1);
    expect(run.stdout).toContain(`❌ Refused (development-build): effort store: ${path} needs migration schema_migrations, plan-ci`);
    expect(lastLine(run)).toBe('Next safe step: rafa effort copy');
    expect(control.exitCode).toBe(0);
    expect(control.stdout).toContain('✅ Behind:');
    expect(Buffer.compare(readFileSync(path), before)).toBe(0);
  });
});

describe('the refusal reasons and their next steps', () => {
  it('gives each of planSchema\'s seven reasons, in order, the next step its refusal names', async () => {
    const cases = [
      ...SPAWNED_REFUSALS.map((entry) => ({ ...entry, migrations: SQLITE_MIGRATIONS })),
      ...CATALOGUE_REFUSALS,
    ];
    // One dispatch at a time: each records its command and puts back the
    // one it replaced (`src/cli/running.ts`), which holds only while
    // dispatches nest. Run together, they finished out of order and left
    // `effort schema` recorded for every later file in the process.
    const reports: SchemaReport[] = [];
    for (const { plant, migrations } of cases) {
      reports.push(await jsonReport(plant, migrations));
    }

    expect(reports.map(({ status }) => status)).toEqual([...REFUSAL_REASONS]);
    expect(reports.map(({ nextStep }) => nextStep)).toEqual([
      FIX_SCHEMA_STEP,
      FIX_SCHEMA_STEP,
      FIX_SCHEMA_STEP,
      `install a rafa that knows future-readers, or ${FIX_SCHEMA_STEP}`,
      `install a rafa that knows future-writers, or ${FIX_SCHEMA_STEP}`,
      'rafa effort schema',
      'rafa effort migrate --dry-run',
    ]);
    for (const report of reports) {
      expect(report.refused).toBe(true);
      expect(report.refusal?.startsWith(`effort store: ${report.path} `)).toBe(true);
      expect(report.refusal).not.toContain('Next safe step');
    }
    // Seven dispatches leave no command recorded for a later file to read.
    expect(runningCommand()).toBeNull();
  });

  it('gives a current store the next step none in json', async () => {
    const report = await jsonReport(plantCurrent);

    expect(report.status).toBe('current');
    expect(report.nextStep).toBe('none');
    expect(report.gate).toBe(13);
    expect(report.pending).toEqual([]);
    expect(report.applied.map(({ id }) => id)).toEqual(SQLITE_MIGRATIONS.map(({ id }) => id));
  });
});
