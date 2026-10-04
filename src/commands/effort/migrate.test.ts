/**
 * `rafa effort migrate` dispatched in planted projects, and spawned
 * through `runRafa` as the real development build. In-process cases pass
 * an installed identity and a synthetic tail: an additive entry the
 * store already holds, then a breaking table rebuild pending, which
 * copies only rows whose note is not null. The same rebuild migrates a
 * store with no null note, and refuses one holding a null note on the
 * row count, so each case has a control that could have failed.
 */
import type { MigrateCommandSeams } from './migrate.js';
import type { SqliteMigration } from '../../effort/store/migrations.js';
import type { RuntimeIdentity } from '../../runtime/identity.js';
import type { CapturedRun, PlantedProject } from '../../tests/cli-capture.js';

import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { Database } from 'bun:sqlite';
import { afterAll, describe, expect, it } from 'bun:test';

import { RAFA_VERSION } from '../../cli/version.js';
import { bringForward } from '../../effort/store/bring-forward.js';
import { LEGACY_GATE_CLOSED, LEGACY_GATE_OPEN } from '../../effort/store/migrations.js';
import { migrateSchema, sqliteStorePath, SQLITE_MIGRATIONS } from '../../effort/store/sqlite.js';
import { storeRows } from '../../effort/store/testdata/store-rows.js';
import { beginSession } from '../../loop/sessions.js';
import { dispatchInProject, eventsOf, plantProject, plantScratchRepo, runRafa } from '../../tests/cli-capture.js';

import { createMigrateCommand } from './migrate.js';

const scope = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-effort-migrate-')));
afterAll(() => {
  rmSync(scope, { recursive: true, force: true });
});

const NOW = new Date('2026-09-26T10:15:00.000Z');

const STAMP = '20260926T101500Z';

const SPAWN_TIMEOUT = 60_000;

/** An installed runtime, which may swap a migrated store in. */
const INSTALLED: RuntimeIdentity = { kind: 'installed', entry: '/home/u/.rafa/runtime/0.24.1/cli.js' };

/** The subject the command sits under, declared for the registry the test dispatches over. */
const EFFORT_SUBJECT = { name: 'effort', summary: 'the effort store' };

/** An additive entry the planted store already holds. */
const NOTES: SqliteMigration = {
  id: 'synthetic-notes',
  breaks: [],
  sql: 'CREATE TABLE synthetic_notes (seq INTEGER PRIMARY KEY, note TEXT);',
};

/** A breaking table rebuild, pending, which copies only the rows whose note is not null. */
const NOTES_REBUILD: SqliteMigration = {
  id: 'synthetic-notes-rebuild',
  breaks: ['readers', 'writers'],
  contract: { expand: 'synthetic-notes', why: 'a synthetic breaking rebuild for the migrate command' },
  sql: 'CREATE TABLE synthetic_notes_next (seq INTEGER PRIMARY KEY, note TEXT NOT NULL);'
    + ' INSERT INTO synthetic_notes_next (seq, note) SELECT seq, note FROM synthetic_notes WHERE note IS NOT NULL;'
    + ' DROP TABLE synthetic_notes;'
    + ' ALTER TABLE synthetic_notes_next RENAME TO synthetic_notes;',
};

/** The catalogue the store is migrated to: this build's, the held tail, then the pending rebuild. */
const WITH_REBUILD: readonly SqliteMigration[] = [...SQLITE_MIGRATIONS, NOTES, NOTES_REBUILD];

const SESSION_ID = '11111111-2222-3333-4444-555555555555';

/** A fresh project of its own. */
function plant(): PlantedProject {
  return plantProject(realpathSync(mkdtempSync(join(scope, 'case-'))));
}

/** Plants the project's store logged through {@link NOTES}, holding a session and `notes` in `synthetic_notes`. */
function plantNotesStore(project: PlantedProject, notes: readonly (string | null)[]): string {
  const path = sqliteStorePath(project.root);
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path, { create: true, readwrite: true });
  try {
    bringForward(db, path, 'write', 'open', { migrations: [...SQLITE_MIGRATIONS, NOTES] });
    db.run('INSERT INTO sessions (session_id, row_json) VALUES (\'s-1\', \'{}\')');
    for (const note of notes) db.run('INSERT INTO synthetic_notes (note) VALUES (?)', [note]);
  } finally {
    db.close();
  }
  return path;
}

/** Plants a store a release before the log wrote in `dir`, holding the first twelve legacy entries: `plan-ci` and every entry after it pending. */
function plantPreLogAt12(dir: string): string {
  const path = join(dir, 'effort.sqlite');
  mkdirSync(dir, { recursive: true });
  const db = new Database(path, { create: true, readwrite: true });
  try {
    migrateSchema(db, path, SQLITE_MIGRATIONS.slice(0, 12));
  } finally {
    db.close();
  }
  return path;
}

/** The ids a store {@link plantPreLogAt12} planted has pending, in apply order. */
const PENDING_AT_12 = SQLITE_MIGRATIONS.slice(12).map(({ id }) => id);

/** Every file in `dir` by name, with its bytes. */
function snapshot(dir: string): ReadonlyMap<string, Buffer> {
  return new Map(readdirSync(dir).sort()
    .map((name) => [name, readFileSync(join(dir, name))]));
}

/** Whether two snapshots hold the same names with the same bytes. */
function sameFiles(before: ReadonlyMap<string, Buffer>, after: ReadonlyMap<string, Buffer>): boolean {
  return before.size === after.size
    && [...before].every(([name, bytes]) => after.get(name)?.equals(bytes) === true);
}

/** Plants a `running` loop record under the project, its pid read as alive by the seam. */
function plantLiveLoop(project: PlantedProject): void {
  beginSession(project.root, {
    sessionId: SESSION_ID,
    planStub: 'rafa-23-demo',
    plan: '.rafa/plans/PLAN-rafa-23-demo.md',
    branch: 'feat/rafa-23-demo',
    pid: 424242,
    startedAt: '2026-09-26T09:00:00.000Z',
  }, { isAlive: () => true });
}

/** A store's `user_version` and the ids its log holds. */
function readLog(path: string): { userVersion: number; log: { id: string; applied_by: string }[] } {
  const db = new Database(path, { readonly: true });
  try {
    const userVersion = db.query<{ user_version: number }, []>('PRAGMA user_version').get()?.user_version ?? 0;
    const log = db.query<{ id: string; applied_by: string }, []>('SELECT id, applied_by FROM schema_migrations ORDER BY seq').all();
    return { userVersion, log };
  } finally {
    db.close();
  }
}

/** Dispatches `effort migrate` with `words` in `project`, over the rebuild tail unless `seams` says otherwise. */
async function run(project: PlantedProject, words: readonly string[], seams: MigrateCommandSeams = {}): Promise<CapturedRun> {
  const command = createMigrateCommand({ now: () => NOW, identity: INSTALLED, migrations: WITH_REBUILD, ...seams });
  return dispatchInProject(['effort', 'migrate', ...words], [EFFORT_SUBJECT], [command], project);
}

describe('rafa effort migrate', () => {
  it('leaves the store directory byte-identical under --dry-run, having built and checked the migration', async () => {
    const project = plant();
    const path = plantNotesStore(project, ['kept', 'also kept']);
    const before = snapshot(dirname(path));

    const outcome = await run(project, ['--dry-run', '--output=json']);

    const result = eventsOf(outcome.stdout).find((event) => event.type === 'result') as unknown as {
      data: { status: string; applying: string[]; breaking: string[]; userVersion: number };
    };
    expect(outcome.exitCode).toBe(0);
    expect(result.data.status).toBe('would-migrate');
    expect(result.data.applying).toEqual(['synthetic-notes-rebuild']);
    expect(result.data.breaking).toEqual(['synthetic-notes-rebuild']);
    expect(result.data.userVersion).toBe(LEGACY_GATE_CLOSED);
    expect(sameFiles(before, snapshot(dirname(path)))).toBe(true);
  });

  it('prints what a dry run applied and how it checked', async () => {
    const project = plant();
    plantNotesStore(project, ['kept']);

    const outcome = await run(project, ['--dry-run']);

    expect(outcome.exitCode).toBe(0);
    expect(outcome.stdout).toContain('Applies synthetic-notes-rebuild to');
    expect(outcome.stdout).toContain('synthetic-notes-rebuild breaks older runtimes');
    expect(outcome.stdout).toContain(`schema version ${String(LEGACY_GATE_CLOSED)} after.`);
    expect(outcome.stdout).toContain('🔍 Dry run:');
  });

  it('refuses a migration that loses a row on the row count, leaving the live file untouched', async () => {
    const project = plant();
    const path = plantNotesStore(project, ['kept', null]);
    const before = snapshot(dirname(path));

    const outcome = await run(project, []);

    expect(outcome.exitCode).toBe(1);
    expect(outcome.stderr).toContain('the rebuilt synthetic_notes holds 1 rows, the store 2');
    expect(sameFiles(before, snapshot(dirname(path)))).toBe(true);
  });

  it('swaps the migrated store in behind effort.sqlite.before-<id>-<stamp>.bak, which holds every row of the original', async () => {
    const project = plant();
    const path = plantNotesStore(project, ['kept', 'also kept']);
    const original = storeRows(path);

    const outcome = await run(project, []);

    const backup = `${path}.before-synthetic-notes-rebuild-${STAMP}.bak`;
    expect(outcome.exitCode).toBe(0);
    expect(outcome.stdout).toContain(`✅ Migrated. The original is kept whole at ${backup}`);
    expect(outcome.stdout).toContain('The migrated store keeps the store\'s id; the backup is a copy, so renamed back'
      + ' it takes a new id on its next write.');
    expect(readdirSync(dirname(path)).sort()).toEqual(['effort.sqlite', `effort.sqlite.before-synthetic-notes-rebuild-${STAMP}.bak`]);
    expect(storeRows(backup)).toEqual(original);
    const { userVersion, log } = readLog(path);
    expect(userVersion).toBe(LEGACY_GATE_CLOSED);
    expect(log.at(-1)).toEqual({ id: 'synthetic-notes-rebuild', applied_by: RAFA_VERSION });
  });

  it('refuses a breaking migration beside a planted live loop, naming both and changing nothing', async () => {
    const project = plant();
    const path = plantNotesStore(project, ['kept']);
    plantLiveLoop(project);
    const before = snapshot(dirname(path));

    const outcome = await run(project, [], { isAlive: () => true });

    expect(outcome.exitCode).toBe(1);
    expect(outcome.stderr).toContain(`REFUSED — migration synthetic-notes-rebuild breaks older runtimes, and loop ${SESSION_ID}`
      + ' (pid 424242, plan rafa-23-demo) is running on this store. Nothing was migrated. Finish or stop that loop,'
      + ' then run it again.');
    expect(sameFiles(before, snapshot(dirname(path)))).toBe(true);
  });

  it('migrates beside the same loop record once its pid is gone', async () => {
    const project = plant();
    plantNotesStore(project, ['kept']);
    plantLiveLoop(project);

    const outcome = await run(project, [], { isAlive: () => false });

    expect(outcome.exitCode).toBe(0);
    expect(outcome.stdout).toContain('✅ Migrated.');
  });

  it('runs --dry-run beside a live loop', async () => {
    const project = plant();
    plantNotesStore(project, ['kept']);
    plantLiveLoop(project);

    const outcome = await run(project, ['--dry-run'], { isAlive: () => true });

    expect(outcome.exitCode).toBe(0);
    expect(outcome.stdout).toContain('🔍 Dry run:');
  });

  it('refuses an additive migration beside a live loop too, naming the writes a swap would lose', async () => {
    const project = plant();
    const path = plantNotesStore(project, []);
    plantLiveLoop(project);
    const before = snapshot(dirname(path));

    const outcome = await run(project, [], {
      isAlive: () => true,
      migrations: [...SQLITE_MIGRATIONS, NOTES, { id: 'synthetic-more', breaks: [], sql: 'CREATE TABLE synthetic_more (seq INTEGER PRIMARY KEY);' }],
    });

    expect(outcome.exitCode).toBe(1);
    expect(outcome.stderr).toContain(`REFUSED — loop ${SESSION_ID} (pid 424242, plan rafa-23-demo) is running on this store,`
      + ' and swapping the migrated store in under it would lose what it writes. Nothing was migrated.');
    expect(sameFiles(before, snapshot(dirname(path)))).toBe(true);
  });

  it('leaves a current store alone', async () => {
    const project = plant();
    const path = plantNotesStore(project, ['kept']);
    const before = snapshot(dirname(path));

    const outcome = await run(project, [], { migrations: [...SQLITE_MIGRATIONS, NOTES] });

    expect(outcome.exitCode).toBe(0);
    expect(outcome.stdout).toContain(`✅ ${path} is current: no migration is pending.`);
    expect(sameFiles(before, snapshot(dirname(path)))).toBe(true);
  });

  it('says there is nothing to migrate when the project has no store, creating none', async () => {
    const project = plant();

    const outcome = await run(project, []);

    expect(outcome.exitCode).toBe(0);
    expect(outcome.stdout).toContain('No effort store at');
    expect(existsSync(dirname(sqliteStorePath(project.root)))).toBe(false);
  });

  it('passes on a schema plan refusal with its next safe step, changing nothing', async () => {
    const project = plant();
    const path = plantNotesStore(project, ['kept']);
    const db = new Database(path, { readwrite: true });
    try {
      db.run(`UPDATE schema_migrations SET sha256 = '${'0'.repeat(64)}' WHERE id = 'findings'`);
    } finally {
      db.close();
    }
    const before = snapshot(dirname(path));

    const outcome = await run(project, []);

    expect(outcome.exitCode).toBe(1);
    expect(outcome.stderr).toContain('recorded migration findings as sha256');
    expect(outcome.stderr.trimEnd()).toEndWith('Next safe step: rafa effort fix-schema --dry-run');
    expect(sameFiles(before, snapshot(dirname(path)))).toBe(true);
  });

  it('refuses an argument', async () => {
    const outcome = await run(plant(), ['now']);

    expect(outcome.exitCode).toBe(1);
    expect(outcome.stderr).toContain('Usage: rafa effort migrate [--dry-run]');
  });
});

describe('rafa effort migrate spawned as a development build', () => {
  /** The child's environment: its temporary directory elsewhere, and no test process. */
  function childEnv(extra: Readonly<Record<string, string>> = {}): Record<string, string> {
    return { TMPDIR: realpathSync(mkdtempSync(join(scope, 'child-tmp-'))), RAFA_TEST: '', ...extra };
  }

  it('refuses outside a copy, naming the copy command and changing nothing', () => {
    const scratch = plantScratchRepo(scope);
    const path = plantPreLogAt12(dirname(sqliteStorePath(scratch.repo)));
    const before = snapshot(dirname(path));

    const outcome = runRafa(scratch, scratch.repo, ['effort', 'migrate'], childEnv());

    expect(outcome.exitCode).toBe(1);
    expect(outcome.stderr).toContain(`effort store: ${path} needs migration ${['schema_migrations', ...PENDING_AT_12].join(', ')}`
      + ' and this rafa is a development build (');
    expect(outcome.stderr).toContain('a development build migrates only a store under the temp directory or RAFA_EFFORT_DIR.'
      + ' Copy it with \'rafa effort copy\' and run this command with RAFA_EFFORT_DIR=<the copy>.');
    expect(sameFiles(before, snapshot(dirname(path)))).toBe(true);
  }, SPAWN_TIMEOUT);

  it('migrates a copy under RAFA_EFFORT_DIR, leaving the project\'s store as it was', () => {
    const scratch = plantScratchRepo(scope);
    const live = plantPreLogAt12(dirname(sqliteStorePath(scratch.repo)));
    const liveBefore = snapshot(dirname(live));
    const copyDir = realpathSync(mkdtempSync(join(scope, 'copy-')));
    const copy = plantPreLogAt12(copyDir);

    const outcome = runRafa(scratch, scratch.repo, ['effort', 'migrate'], childEnv({ RAFA_EFFORT_DIR: copyDir }));

    expect(outcome.stderr).toBe('');
    expect(outcome.exitCode).toBe(0);
    expect(outcome.stdout).toContain(`Applies ${['schema_migrations', ...PENDING_AT_12].join(', ')} to ${copy}`);
    expect(readdirSync(copyDir).filter((name) => name !== 'effort.sqlite')).toEqual([
      expect.stringMatching(/^effort\.sqlite\.before-plan-ci-\d{8}T\d{6}Z\.bak$/) as unknown as string,
    ]);
    const { userVersion, log } = readLog(copy);
    expect(userVersion).toBe(LEGACY_GATE_OPEN);
    expect(log.map(({ id }) => id)).toEqual(SQLITE_MIGRATIONS.map(({ id }) => id));
    expect(log.every(({ applied_by }) => applied_by.includes('+dev:'))).toBe(true);
    expect(sameFiles(liveBefore, snapshot(dirname(live)))).toBe(true);
  }, SPAWN_TIMEOUT);
});
