/**
 * `rafa effort copy` spawned in scratch projects through `runRafa`, and
 * dispatched in-process where a case needs the clock or json mode: the
 * copy taken beside a reader, what survives in it, the live store's
 * bytes, and each refusal and failure with what it leaves on disk.
 */
import type { CapturedRun, ScratchRepo } from '../../tests/cli-capture.js';

import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Database } from 'bun:sqlite';
import { afterAll, describe, expect, it } from 'bun:test';

import { migrateSchema, SQLITE_MIGRATIONS, withSqliteStore } from '../../effort/store/sqlite.js';
import { dispatchInProject, eventsOf, expectExit, plantProject, plantScratchRepo, runRafa } from '../../tests/cli-capture.js';

import { createCopyCommand } from './copy.js';

const SPAWN_TIMEOUT = 60_000;

const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-effort-copy-')));
afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** The subject the command sits under, declared for the registry an in-process case dispatches over. */
const EFFORT_SUBJECT = { name: 'effort', summary: 'the effort store' };

/** The live store directory under a project root. */
function liveDir(root: string): string {
  return join(root, '.rafa', 'effort');
}

/** Plants a live SQLite store brought forward by this build, holding two session rows. */
function plantStore(root: string): string {
  const path = join(liveDir(root), 'effort.sqlite');
  withSqliteStore(path, 'write', true, (db) => {
    db.run('INSERT INTO sessions (session_id, row_json) VALUES (?, ?), (?, ?)', ['s-1', '{"sessionId":"s-1"}', 's-2', '{"sessionId":"s-2"}']);
  });
  return path;
}

/** Spawns `rafa effort copy` with `words` after it, at the scratch repository's root. */
function copy(scratch: ScratchRepo, words: readonly string[] = [], env: Readonly<Record<string, string>> = {}): CapturedRun {
  return runRafa(scratch, scratch.repo, ['effort', 'copy', ...words], env);
}

/** What one SQLite file holds that a copy must keep. */
function readStore(path: string): { version: number; migrations: string[]; sessions: string[] } {
  const db = new Database(path, { readonly: true });
  try {
    return {
      version: (db.query('PRAGMA user_version').get() as { user_version: number }).user_version,
      migrations: (db.query('SELECT id FROM schema_migrations ORDER BY rowid').all() as { id: string }[]).map((row) => row.id),
      sessions: (db.query('SELECT session_id FROM sessions ORDER BY seq').all() as { session_id: string }[]).map((row) => row.session_id),
    };
  } finally {
    db.close();
  }
}

/**
 * SQLite's refusal of a write under a held read. Which of the two messages a
 * locked-out writer sees depends on the SQLite build: macOS Bun links the
 * system SQLite, and #397 saw `disk I/O error` on Linux in a worktree. Any
 * other message, or none, is not that refusal.
 */
const LOCKED_OUT_WRITE = /\b(?:database is locked|disk I\/O error)\b/;

/** Whether `message` is SQLite refusing a write because another connection holds a read. */
function isLockedOutWrite(message: string): boolean {
  return LOCKED_OUT_WRITE.test(message);
}

describe('the locked-out writer matcher', () => {
  it('accepts both refusal messages and rejects any other SQLite message or none', () => {
    expect(isLockedOutWrite('SQLiteError: database is locked')).toBe(true);
    expect(isLockedOutWrite('SQLiteError: disk I/O error')).toBe(true);
    expect(isLockedOutWrite('SQLiteError: attempt to write a readonly database')).toBe(false);
    expect(isLockedOutWrite('')).toBe(false);
  });
});

describe('rafa effort copy over a live store', () => {
  it('copies while another connection holds a read transaction, keeping user_version, schema_migrations and every row', () => {
    const scratch = plantScratchRepo(tempBase);
    const live = plantStore(scratch.repo);
    writeFileSync(join(liveDir(scratch.repo), 'sessions.ndjson'), '{"sessionId":"n-1"}\n', 'utf8');
    const before = readFileSync(live);
    const target = join(scratch.repo, '.rafa', 'scratch', 'copy-under-read');

    const reader = new Database(live, { readonly: true });
    let run: CapturedRun;
    let lockedOut = '';
    try {
      reader.run('BEGIN');
      reader.query('SELECT count(*) FROM sessions').get();
      run = copy(scratch, [`--to=${target}`]);
      // Control: the reader's lock was held across the copy, so a writer is shut out now.
      const writer = new Database(live, { readwrite: true });
      try {
        writer.run('BEGIN EXCLUSIVE');
      } catch (error) {
        lockedOut = String(error);
      } finally {
        writer.close();
      }
      reader.run('COMMIT');
    } finally {
      reader.close();
    }

    // Either refusal message, by SQLite build; see LOCKED_OUT_WRITE.
    expect(isLockedOutWrite(lockedOut), `writer was not locked out: ${JSON.stringify(lockedOut)}`).toBe(true);
    expect(run.stderr).toBe('');
    expectExit(run, 0, scratch);
    expect(run.stdout).toContain(`✅ Copied effort.sqlite, sessions.ndjson from ${liveDir(scratch.repo)} to ${target}.`);
    expect(run.stdout.trimEnd().split('\n')
      .at(-1)).toBe(`RAFA_EFFORT_DIR=${target}`);
    expect(readdirSync(target).sort()).toEqual(['effort.sqlite', 'sessions.ndjson']);
    expect(readFileSync(join(target, 'sessions.ndjson'), 'utf8')).toBe('{"sessionId":"n-1"}\n');
    const held = readStore(live);
    expect(held.version).toBeGreaterThan(0);
    expect(held.migrations).toEqual(SQLITE_MIGRATIONS.map((migration) => migration.id));
    expect(held.sessions).toEqual(['s-1', 's-2']);
    expect(readStore(join(target, 'effort.sqlite'))).toEqual(held);
    expect(Buffer.compare(readFileSync(live), before)).toBe(0);
  }, SPAWN_TIMEOUT);

  it('copies a pre-log store as it stands: no log adopted in the copy, and not a byte of the live store written', () => {
    const scratch = plantScratchRepo(tempBase);
    const live = join(liveDir(scratch.repo), 'effort.sqlite');
    mkdirSync(liveDir(scratch.repo), { recursive: true });
    const db = new Database(live, { create: true, readwrite: true });
    try {
      migrateSchema(db, live, SQLITE_MIGRATIONS);
    } finally {
      db.close();
    }
    const before = readFileSync(live);
    const target = join(scratch.repo, '.rafa', 'scratch', 'pre-log');

    const run = copy(scratch, [`--to=${target}`]);

    const copied = new Database(join(target, 'effort.sqlite'), { readonly: true });
    try {
      expectExit(run, 0, scratch);
      expect(copied.query('PRAGMA user_version').get()).toEqual({ user_version: SQLITE_MIGRATIONS.length });
      expect(copied.query('SELECT name FROM sqlite_master WHERE name = \'schema_migrations\'').all()).toEqual([]);
    } finally {
      copied.close();
    }
    expect(Buffer.compare(readFileSync(live), before)).toBe(0);
  }, SPAWN_TIMEOUT);

  it('copies into .rafa/scratch/effort-<stamp>/ by default and prints the RAFA_EFFORT_DIR= line for it', () => {
    const scratch = plantScratchRepo(tempBase);
    const live = plantStore(scratch.repo);
    const before = readFileSync(live);

    const run = copy(scratch);

    const made = readdirSync(join(scratch.repo, '.rafa', 'scratch'));
    expectExit(run, 0, scratch);
    expect(made).toHaveLength(1);
    expect(made[0]).toMatch(/^effort-\d{8}T\d{6}Z$/);
    const directory = join(scratch.repo, '.rafa', 'scratch', made[0] ?? '');
    expect(run.stdout.trimEnd().split('\n')
      .at(-1)).toBe(`RAFA_EFFORT_DIR=${directory}`);
    expect(readdirSync(directory)).toEqual(['effort.sqlite']);
    expect(Buffer.compare(readFileSync(live), before)).toBe(0);
  }, SPAWN_TIMEOUT);

  it('reads a relative --to from the project root', () => {
    const scratch = plantScratchRepo(tempBase);
    plantStore(scratch.repo);

    const run = copy(scratch, ['--to=.rafa/scratch/named']);

    expectExit(run, 0, scratch);
    expect(readdirSync(join(scratch.repo, '.rafa', 'scratch', 'named'))).toEqual(['effort.sqlite']);
  }, SPAWN_TIMEOUT);

  it('copies into a target that exists empty', () => {
    const scratch = plantScratchRepo(tempBase);
    plantStore(scratch.repo);
    const target = join(scratch.repo, 'empty');
    mkdirSync(target);

    const run = copy(scratch, [`--to=${target}`]);

    expectExit(run, 0, scratch);
    expect(readdirSync(target)).toEqual(['effort.sqlite']);
  }, SPAWN_TIMEOUT);
});

describe('rafa effort copy refusals, exit code 1', () => {
  it('refuses a non-empty target, leaving it as it was and the live store unchanged', () => {
    const scratch = plantScratchRepo(tempBase);
    const live = plantStore(scratch.repo);
    const before = readFileSync(live);
    const target = join(scratch.repo, 'used');
    mkdirSync(target);
    writeFileSync(join(target, 'keep.txt'), 'kept\n', 'utf8');

    const run = copy(scratch, [`--to=${target}`]);

    expectExit(run, 1, scratch);
    expect(run.stderr).toContain(`❌ rafa effort copy: ${target} is not empty (1 entries); nothing was copied.`);
    expect(readdirSync(target)).toEqual(['keep.txt']);
    expect(readFileSync(join(target, 'keep.txt'), 'utf8')).toBe('kept\n');
    expect(Buffer.compare(readFileSync(live), before)).toBe(0);
  }, SPAWN_TIMEOUT);

  it('refuses a target that is a file', () => {
    const scratch = plantScratchRepo(tempBase);
    plantStore(scratch.repo);
    const target = join(scratch.repo, 'a-file');
    writeFileSync(target, 'x', 'utf8');

    const run = copy(scratch, [`--to=${target}`]);

    expectExit(run, 1, scratch);
    expect(run.stderr).toContain(`${target} is a file, not a directory`);
    expect(readFileSync(target, 'utf8')).toBe('x');
  }, SPAWN_TIMEOUT);

  it('refuses a project with no store, making no directory at the default target or at --to', () => {
    const scratch = plantScratchRepo(tempBase);
    const target = join(scratch.repo, 'never-made');

    const byDefault = copy(scratch);
    const named = copy(scratch, [`--to=${target}`]);

    expectExit(byDefault, 1, scratch);
    expect(byDefault.stderr).toContain(`❌ rafa effort copy: no effort store at ${liveDir(scratch.repo)}`);
    expectExit(named, 1, scratch);
    expect(existsSync(join(scratch.repo, '.rafa', 'scratch'))).toBe(false);
    expect(existsSync(target)).toBe(false);
    expect(existsSync(liveDir(scratch.repo))).toBe(false);
  }, SPAWN_TIMEOUT);

  it('refuses while RAFA_EFFORT_DIR is set, making nothing', () => {
    const scratch = plantScratchRepo(tempBase);
    plantStore(scratch.repo);
    const elsewhere = realpathSync(mkdtempSync(join(tempBase, 'elsewhere-')));

    const run = copy(scratch, [], { RAFA_EFFORT_DIR: elsewhere });

    expectExit(run, 1, scratch);
    expect(run.stderr).toContain(`❌ rafa effort copy: RAFA_EFFORT_DIR is set (${elsewhere}); a copy is taken from the project's own store.`);
    expect(existsSync(join(scratch.repo, '.rafa', 'scratch'))).toBe(false);
    expect(readdirSync(elsewhere)).toEqual([]);
  }, SPAWN_TIMEOUT);

  it('refuses a bare --to and an argument', () => {
    const scratch = plantScratchRepo(tempBase);
    plantStore(scratch.repo);

    const bare = copy(scratch, ['--to']);
    const argument = copy(scratch, ['somewhere']);

    expect([bare.exitCode, argument.exitCode]).toEqual([1, 1]);
    expect(bare.stderr).toContain('--to takes a directory: --to=<dir>');
    expect(argument.stderr).toContain('Expected no argument, got 1: somewhere');
    expect(existsSync(join(scratch.repo, '.rafa', 'scratch'))).toBe(false);
  }, SPAWN_TIMEOUT);
});

describe('rafa effort copy failures, exit code 2', () => {
  it('fails a write under a path that cannot be a directory, making nothing', () => {
    const scratch = plantScratchRepo(tempBase);
    const live = plantStore(scratch.repo);
    const before = readFileSync(live);
    writeFileSync(join(scratch.repo, 'blocker'), 'x', 'utf8');
    const target = join(scratch.repo, 'blocker', 'copy');

    const run = copy(scratch, [`--to=${target}`]);

    expectExit(run, 2, scratch);
    expect(run.stderr).toContain(`❌ rafa effort copy: copying ${liveDir(scratch.repo)} to ${target} failed:`);
    expect(readFileSync(join(scratch.repo, 'blocker'), 'utf8')).toBe('x');
    expect(Buffer.compare(readFileSync(live), before)).toBe(0);
  }, SPAWN_TIMEOUT);

  it('fails a read of a file that is no SQLite store, removing the directory it made', () => {
    const scratch = plantScratchRepo(tempBase);
    mkdirSync(liveDir(scratch.repo), { recursive: true });
    writeFileSync(join(liveDir(scratch.repo), 'effort.sqlite'), 'not a database, long enough to be read as a header'.repeat(4), 'utf8');
    const target = join(scratch.repo, '.rafa', 'scratch', 'unreadable');

    const run = copy(scratch, [`--to=${target}`]);

    expectExit(run, 2, scratch);
    expect(run.stderr).toContain('file is not a database');
    expect(existsSync(join(scratch.repo, '.rafa', 'scratch'))).toBe(false);
  }, SPAWN_TIMEOUT);
});

describe('rafa effort copy dispatched in-process', () => {
  const now = new Date('2026-09-28T10:15:00.000Z');
  const command = createCopyCommand({ now: () => now });

  it('stamps the default directory from the clock and gives the copy and its env line as the json result', async () => {
    const project = plantProject(realpathSync(mkdtempSync(join(tempBase, 'json-'))));
    plantStore(project.root);
    const directory = join(project.root, '.rafa', 'scratch', 'effort-20260928T101500Z');

    const run = await dispatchInProject(['effort', 'copy', '--output=json'], [EFFORT_SUBJECT], [command], project);

    expect(run.exitCode).toBe(0);
    const result = eventsOf(run.stdout).find((event) => event.type === 'result');
    expect(result?.data).toEqual({
      source: liveDir(project.root),
      directory,
      files: ['effort.sqlite'],
      env: `RAFA_EFFORT_DIR=${directory}`,
    });
    expect(readdirSync(directory)).toEqual(['effort.sqlite']);
  });

  it('reads RAFA_EFFORT_DIR off the context environment', async () => {
    const project = plantProject(realpathSync(mkdtempSync(join(tempBase, 'env-'))));
    plantStore(project.root);

    const set = await dispatchInProject(['effort', 'copy'], [EFFORT_SUBJECT], [command], project, { RAFA_EFFORT_DIR: '/elsewhere' });
    const empty = await dispatchInProject(['effort', 'copy', '--to=.rafa/scratch/empty-var'], [EFFORT_SUBJECT], [command], project, { RAFA_EFFORT_DIR: '' });

    expect(set.exitCode).toBe(1);
    expect(empty.exitCode).toBe(0);
  });
});
