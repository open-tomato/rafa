/**
 * `rafa effort fix-schema` dispatched in planted projects: the outcomes a
 * person reads, the json result, and the refusals the command adds to
 * `fixStoreSchema`'s own (a live loop, an argument). In-process cases
 * pass an installed identity wherever they swap, since the suite is a
 * development build. The development build's own refusal is spawned
 * through `runRafa` as the real thing: `bun src/rafa.ts` over a scratch
 * project outside the child's temporary directory.
 */
import type { FixSchemaCommandSeams } from './fix-schema.js';
import type { RuntimeIdentity } from '../../runtime/identity.js';
import type { CapturedRun, PlantedProject } from '../../tests/cli-capture.js';

import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { Database } from 'bun:sqlite';
import { afterAll, describe, expect, it } from 'bun:test';

import { fileStamp } from '../../effort/file-stamp.js';
import { bringForward } from '../../effort/store/bring-forward.js';
import { migrateSchema, sqliteStorePath, SQLITE_MIGRATIONS, SQLITE_SCHEMA_VERSION } from '../../effort/store/sqlite.js';
import { beginSession } from '../../loop/sessions.js';
import { dispatchInProject, eventsOf, expectExit, plantProject, plantScratchRepo, runRafa } from '../../tests/cli-capture.js';

import { createFixSchemaCommand } from './fix-schema.js';

const scope = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-fix-schema-command-')));
afterAll(() => {
  rmSync(scope, { recursive: true, force: true });
});

const NOW = new Date('2026-09-26T10:15:00.000Z');

const SPAWN_TIMEOUT = 60_000;

/** An installed runtime, which may swap a rebuild in. */
const INSTALLED: RuntimeIdentity = { kind: 'installed', entry: '/home/u/.rafa/runtime/0.24.1/cli.js' };

/** The subject the command sits under, declared for the registry the test dispatches over. */
const EFFORT_SUBJECT = { name: 'effort', summary: 'the effort store' };

/** A fresh project of its own. */
function plant(): PlantedProject {
  return plantProject(realpathSync(mkdtempSync(join(scope, 'case-'))));
}

/** Plants the store under `root` two versions past this rafa with no log, holding one session row. */
function plantNewerStore(root: string): string {
  const path = sqliteStorePath(root);
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path, { create: true, readwrite: true });
  try {
    migrateSchema(db, path, [
      ...SQLITE_MIGRATIONS,
      { id: 'sessions-resolver', breaks: [], sql: 'ALTER TABLE sessions ADD COLUMN resolver TEXT;' },
      { id: 'extra', breaks: [], sql: 'CREATE TABLE extra (seq INTEGER PRIMARY KEY);' },
    ]);
    db.run('INSERT INTO sessions (session_id, row_json) VALUES (\'s-1\', \'{}\')');
  } finally {
    db.close();
  }
  return path;
}

/** Plants the project's store logged by this build, with an unknown migration breaking `breaks` and the table it made. */
function plantLoggedWithUnknown(project: PlantedProject, breaks: readonly string[]): string {
  const path = sqliteStorePath(project.root);
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path, { create: true, readwrite: true });
  try {
    bringForward(db, path, 'write', 'open');
    db.run('CREATE TABLE future_notes (seq INTEGER PRIMARY KEY, note TEXT)');
    db.run('INSERT INTO schema_migrations (id, sha256, breaks, applied_at, applied_by)'
      + ` VALUES ('future-notes', '${'a'.repeat(64)}', '${JSON.stringify(breaks)}', '2026-10-01T09:00:00.000Z', '0.30.0')`);
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
  const command = createFixSchemaCommand({ now: () => NOW, identity: INSTALLED, ...seams });
  return dispatchInProject(['effort', 'fix-schema', ...words], [EFFORT_SUBJECT], [command], project);
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
    const path = plantNewerStore(project.root);
    const before = readFileSync(path);

    const outcome = await run(project, ['--dry-run']);

    expect(outcome.exitCode).toBe(0);
    expect(outcome.stdout).toContain(`Refused as pre-log-unreleased: effort store: ${path} is at schema version`
      + ` ${String(SQLITE_SCHEMA_VERSION + 2)} with no migration log`);
    expect(outcome.stdout).toContain(`Rebuilds it at the ${String(SQLITE_MIGRATIONS.length)} migrations this rafa knows`);
    expect(outcome.stdout).toContain('table extra (0 rows); column sessions.resolver (0 values)');
    expect(outcome.stdout).toContain('Dry run');
    expect(readFileSync(path).equals(before)).toBe(true);
  });

  it('swaps the rebuild in and names the backup', async () => {
    const project = plant();
    const path = plantNewerStore(project.root);

    const outcome = await run(project, []);

    const backup = `${path}.v${String(SQLITE_SCHEMA_VERSION + 2)}-20260926T101500Z.bak`;
    expect(outcome.exitCode).toBe(0);
    expect(outcome.stdout).toContain(`Every row the original held is copied to ${backup}.`);
    expect(outcome.stdout).toContain('The rebuild keeps the store\'s id; the backup is a copy, so renamed back it takes'
      + ' a new id on its next write.');
    expect(existsSync(backup)).toBe(true);
  });

  it('gives the outcome as the terminal result\'s data in json mode', async () => {
    const project = plant();
    plantNewerStore(project.root);

    const outcome = await run(project, ['--dry-run', '--output=json']);

    const result = eventsOf(outcome.stdout).find((event) => event.type === 'result') as unknown as { data: { status: string; reason: string; known: string[] } };
    expect(result.data.status).toBe('would-rebuild');
    expect(result.data.reason).toBe('pre-log-unreleased');
    expect(result.data.known).toEqual(SQLITE_MIGRATIONS.map(({ id }) => id));
  });

  it('refuses the swap while a loop session is running, changing nothing', async () => {
    const project = plant();
    const path = plantNewerStore(project.root);
    plantLiveLoop(project);
    const before = readFileSync(path);

    const outcome = await run(project, [], { isAlive: () => true });

    expect(outcome.exitCode).toBe(1);
    expect(outcome.stderr).toContain('loop session 11111111-2222-3333-4444-555555555555 on feat/rafa-23-demo is running');
    expect(readFileSync(path).equals(before)).toBe(true);
  });

  it('still runs --dry-run beside a running loop session', async () => {
    const project = plant();
    plantNewerStore(project.root);
    plantLiveLoop(project);

    const outcome = await run(project, ['--dry-run'], { isAlive: () => true });

    expect(outcome.exitCode).toBe(0);
    expect(outcome.stdout).toContain('Dry run');
  });

  it('swaps once the loop session\'s pid is gone, its record reading stopped', async () => {
    const project = plant();
    plantNewerStore(project.root);
    plantLiveLoop(project);

    const outcome = await run(project, [], { isAlive: () => false });

    expect(outcome.exitCode).toBe(0);
    expect(outcome.stdout).toContain('Rebuilt at this rafa\'s migrations.');
  });

  it('reports a logged store holding an unknown additive migration current, changing nothing', async () => {
    const project = plant();
    const path = plantLoggedWithUnknown(project, []);
    const before = readFileSync(path);

    const outcome = await run(project, []);

    expect(outcome.exitCode).toBe(0);
    expect(outcome.stdout).toContain(`✅ ${path} is current`);
    expect(outcome.stdout).toContain('It logs future-notes (applied by 0.30.0), which this rafa does not know; each is additive');
    expect(readFileSync(path).equals(before)).toBe(true);
  });

  it('rebuilds a logged store holding an unknown breaking migration, naming it and its table as left behind', async () => {
    const project = plant();
    plantLoggedWithUnknown(project, ['writers']);

    const outcome = await run(project, []);

    expect(outcome.exitCode).toBe(0);
    expect(outcome.stdout).toContain('Refused as unknown-breaks-writers:');
    expect(outcome.stdout).toContain('Leaves behind, kept only in the backup: migration future-notes (applied by 0.30.0); table future_notes (0 rows).');
    expect(outcome.stdout).toContain('A rafa that knows future-notes uses the store as it is');
    expect(outcome.stdout).toContain('Rebuilt at this rafa\'s migrations.');
  });

  it('refuses an argument', async () => {
    const outcome = await run(plant(), ['now']);

    expect(outcome.exitCode).toBe(1);
    expect(outcome.stderr).toContain('Usage: rafa effort fix-schema [--dry-run]');
  });
});

describe('rafa effort fix-schema spawned as a development build over a store it does not own', () => {
  /** A scratch project outside the child's temporary directory, holding a pre-log store past this rafa. */
  function plantUnowned(): { scratch: ReturnType<typeof plantScratchRepo>; path: string; env: Record<string, string> } {
    const scratch = plantScratchRepo(scope);
    const path = plantNewerStore(scratch.repo);
    // The child's own temporary directory is elsewhere and it is no test process, so the store is not one it owns.
    const env = { TMPDIR: realpathSync(mkdtempSync(join(scope, 'child-tmp-'))), RAFA_TEST: '' };
    return { scratch, path, env };
  }

  it('refuses the swap, changing nothing and naming the next step', () => {
    const { scratch, path, env } = plantUnowned();
    const before = readFileSync(path);

    const outcome = runRafa(scratch, scratch.repo, ['effort', 'fix-schema'], env);

    expectExit(outcome, 1, scratch);
    expect(outcome.stderr).toContain('this rafa is a development build (');
    expect(outcome.stderr.trimEnd()).toEndWith('Next safe step: rafa effort fix-schema');
    expect(readFileSync(path).equals(before)).toBe(true);
    expect(readdirSync(dirname(path))).toEqual(['effort.sqlite']);
  }, SPAWN_TIMEOUT);

  it('runs --dry-run, building and deleting the rebuild', () => {
    const { scratch, path, env } = plantUnowned();
    const before = readFileSync(path);

    const outcome = runRafa(scratch, scratch.repo, ['effort', 'fix-schema', '--dry-run'], env);

    expect(outcome.stderr).toBe('');
    expectExit(outcome, 0, scratch);
    expect(outcome.stdout).toContain('Refused as pre-log-unreleased:');
    expect(outcome.stdout).toContain('+dev:');
    expect(outcome.stdout).toContain('🔍 Dry run:');
    expect(readFileSync(path).equals(before)).toBe(true);
    expect(readdirSync(dirname(path))).toEqual(['effort.sqlite']);
  }, SPAWN_TIMEOUT);
});
