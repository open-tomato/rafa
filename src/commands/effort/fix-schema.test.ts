/**
 * `rafa effort fix-schema` dispatched in planted projects: the outcomes a
 * person reads, the json result, and the refusals the command adds to
 * `fixStoreSchema`'s own (a live loop, an argument).
 */
import type { FixSchemaCommandSeams } from './fix-schema.js';
import type { CapturedRun, PlantedProject } from '../../tests/cli-capture.js';

import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { Database } from 'bun:sqlite';
import { afterAll, describe, expect, it } from 'bun:test';

import { migrateSchema, sqliteStorePath, SQLITE_MIGRATIONS, SQLITE_SCHEMA_VERSION } from '../../effort/store/sqlite.js';
import { beginSession } from '../../loop/sessions.js';
import { dispatchInProject, eventsOf, plantProject } from '../../tests/cli-capture.js';

import { createFixSchemaCommand, fileStamp } from './fix-schema.js';

const scope = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-fix-schema-command-')));
afterAll(() => {
  rmSync(scope, { recursive: true, force: true });
});

const NOW = new Date('2026-09-26T10:15:00.000Z');

/** The subject the command sits under, declared for the registry the test dispatches over. */
const EFFORT_SUBJECT = { name: 'effort', summary: 'the effort store' };

/** A fresh project of its own. */
function plant(): PlantedProject {
  return plantProject(realpathSync(mkdtempSync(join(scope, 'case-'))));
}

/** Plants the project's store two versions past this rafa, holding one session row. */
function plantNewerStore(project: PlantedProject): string {
  const path = sqliteStorePath(project.root);
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path, { create: true, readwrite: true });
  try {
    migrateSchema(db, path, [...SQLITE_MIGRATIONS, 'ALTER TABLE sessions ADD COLUMN resolver TEXT;', 'CREATE TABLE extra (seq INTEGER PRIMARY KEY);']);
    db.run('INSERT INTO sessions (session_id, row_json) VALUES (\'s-1\', \'{}\')');
  } finally {
    db.close();
  }
  return path;
}

/** Plants a `running` loop record under the project, its pid read as alive by the seam. */
function plantLiveLoop(project: PlantedProject): void {
  beginSession(project.root, {
    sessionId: '11111111-2222-3333-4444-555555555555',
    planStub: 'rafa-23-demo',
    plan: '.rafa/plans/PLAN-rafa-23-demo.md',
    branch: 'feat/rafa-23-demo',
    pid: 424242,
    startedAt: '2026-09-26T09:00:00.000Z',
  }, { isAlive: () => true });
}

/** Dispatches `effort fix-schema` with `words` in `project`. */
async function run(project: PlantedProject, words: readonly string[], seams: FixSchemaCommandSeams = {}): Promise<CapturedRun> {
  return dispatchInProject(['effort', 'fix-schema', ...words], [EFFORT_SUBJECT], [createFixSchemaCommand({ now: () => NOW, ...seams })], project);
}

describe('fileStamp', () => {
  it('reads a clock as a stamp a file name can carry', () => {
    expect(fileStamp(NOW)).toBe('20260926T101500Z');
  });
});

describe('rafa effort fix-schema', () => {
  it('says there is nothing to repair when the project has no store, creating none', async () => {
    const project = plant();

    const outcome = await run(project, []);

    expect(outcome.exitCode).toBe(0);
    expect(outcome.stdout).toContain('No effort store at');
    expect(existsSync(sqliteStorePath(project.root))).toBe(false);
  });

  it('prints what a rebuild keeps and leaves behind under --dry-run, changing nothing', async () => {
    const project = plant();
    const path = plantNewerStore(project);
    const before = readFileSync(path);

    const outcome = await run(project, ['--dry-run']);

    expect(outcome.exitCode).toBe(0);
    expect(outcome.stdout).toContain(`past the ${String(SQLITE_SCHEMA_VERSION)} this rafa knows`);
    expect(outcome.stdout).toContain('table extra (0 rows); column sessions.resolver (0 values)');
    expect(outcome.stdout).toContain('Dry run');
    expect(readFileSync(path).equals(before)).toBe(true);
  });

  it('swaps the rebuild in and names the backup', async () => {
    const project = plant();
    const path = plantNewerStore(project);

    const outcome = await run(project, []);

    const backup = `${path}.v${String(SQLITE_SCHEMA_VERSION + 2)}-20260926T101500Z.bak`;
    expect(outcome.exitCode).toBe(0);
    expect(outcome.stdout).toContain(`kept whole at ${backup}`);
    expect(existsSync(backup)).toBe(true);
  });

  it('gives the outcome as the terminal result\'s data in json mode', async () => {
    const project = plant();
    plantNewerStore(project);

    const outcome = await run(project, ['--dry-run', '--output=json']);

    const result = eventsOf(outcome.stdout).find((event) => event.type === 'result') as unknown as { data: { status: string; knownVersion: number } };
    expect(result.data.status).toBe('would-rebuild');
    expect(result.data.knownVersion).toBe(SQLITE_SCHEMA_VERSION);
  });

  it('refuses the swap while a loop session is running, changing nothing', async () => {
    const project = plant();
    const path = plantNewerStore(project);
    plantLiveLoop(project);
    const before = readFileSync(path);

    const outcome = await run(project, [], { isAlive: () => true });

    expect(outcome.exitCode).toBe(1);
    expect(outcome.stderr).toContain('loop session 11111111-2222-3333-4444-555555555555 on feat/rafa-23-demo is running');
    expect(readFileSync(path).equals(before)).toBe(true);
  });

  it('still runs --dry-run beside a running loop session', async () => {
    const project = plant();
    plantNewerStore(project);
    plantLiveLoop(project);

    const outcome = await run(project, ['--dry-run'], { isAlive: () => true });

    expect(outcome.exitCode).toBe(0);
    expect(outcome.stdout).toContain('Dry run');
  });

  it('swaps once the loop session\'s pid is gone, its record reading stopped', async () => {
    const project = plant();
    plantNewerStore(project);
    plantLiveLoop(project);

    const outcome = await run(project, [], { isAlive: () => false });

    expect(outcome.exitCode).toBe(0);
    expect(outcome.stdout).toContain('Rebuilt at version');
  });

  it('refuses an argument', async () => {
    const outcome = await run(plant(), ['now']);

    expect(outcome.exitCode).toBe(1);
    expect(outcome.stderr).toContain('Usage: rafa effort fix-schema [--dry-run]');
  });
});
