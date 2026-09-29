/**
 * The `effort store schema` row of `rafa doctor`, read in-process over
 * stores planted under this file's temporary directory, and spawned as
 * `bun src/rafa.ts doctor` through `runRafa` in scratch projects: it
 * fails where `rafa effort schema --check` fails (the two run over the
 * same store and must agree), warns on an unknown additive migration and
 * on a development build's `applied_by` in the project's own store, not
 * in a copy, and leaves a store with a migration pending byte-identical.
 */
import type { CapturedRun, ScratchRepo } from '../tests/cli-capture.js';

import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Database } from 'bun:sqlite';
import { afterAll, describe, expect, it } from 'bun:test';

import { bringForward } from '../effort/store/bring-forward.js';
import { unknownAdditiveWarning } from '../effort/store/schema-report.js';
import { migrateSchema, SQLITE_MIGRATIONS } from '../effort/store/sqlite.js';
import { eventsOf, plantScratchRepo, runRafa } from '../tests/cli-capture.js';

import {
  developmentAppliedWarning,
  effortSchemaRefusal,
  readDoctorEffortSchema,
  renderDoctorEffortSchema,
} from './doctor-effort-schema.js';

const SPAWN_TIMEOUT = 60_000;

const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-doctor-effort-schema-')));
afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** The way out of a store a release past this one wrote. */
const FIX_SCHEMA_STEP = 'rafa effort fix-schema --dry-run';

/** The `applied_by` a development build logs, for a checkout that is not this one. */
const DEV_APPLIED_BY = '0.24.1+dev:/somewhere/else/rafa';

/** The store file under an effort directory. */
function storeIn(dir: string): string {
  return join(dir, 'effort.sqlite');
}

/** The project's own effort directory under `root`. */
function effortDir(root: string): string {
  return join(root, '.rafa', 'effort');
}

/** Plants a store this build brought forward in `dir`: logged, current, gate open. */
function plantCurrent(dir: string): string {
  mkdirSync(dir, { recursive: true });
  const path = storeIn(dir);
  const db = new Database(path, { create: true, readwrite: true });
  try {
    bringForward(db, path, 'write', 'open');
  } finally {
    db.close();
  }
  return path;
}

/** Plants a store a release before the log wrote in `dir`: `version` legacy entries, no log. */
function plantPreLog(dir: string, version: number): string {
  mkdirSync(dir, { recursive: true });
  const path = storeIn(dir);
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

/** A log row this build does not know, breaking `breaks`, applied by `by`. */
function unknownRow(id: string, breaks: readonly string[], by = '0.30.0'): string {
  return 'INSERT INTO schema_migrations (id, sha256, breaks, applied_at, applied_by)'
    + ` VALUES ('${id}', '${'a'.repeat(64)}', '${JSON.stringify(breaks)}', '2026-10-01T09:00:00.000Z', '${by}')`;
}

/** Marks every logged migration of the store at `path` as applied by a development build. */
function markDevelopment(path: string): void {
  tamper(path, [`UPDATE schema_migrations SET applied_by = '${DEV_APPLIED_BY}'`]);
}

/** A fresh directory under this file's temporary directory. */
function freshDir(prefix: string): string {
  return mkdtempSync(join(tempBase, `${prefix}-`));
}

describe('readDoctorEffortSchema', () => {
  it('is ok with no store, printing no line, and ok over a current one, with no warning and no refusal', () => {
    const root = freshDir('absent');
    const absent = readDoctorEffortSchema(root, {});
    expect([absent.outcome, absent.status, absent.warnings, effortSchemaRefusal(absent)]).toEqual(['ok', 'absent', [], null]);
    expect(renderDoctorEffortSchema(absent)).toEqual([]);

    plantCurrent(effortDir(root));
    const current = readDoctorEffortSchema(root, {});
    expect([current.outcome, current.status, current.live, current.warnings]).toEqual(['ok', 'current', true, []]);
  });

  it('warns on an unknown additive migration in the preflight\'s words, and fails on one that breaks writers', () => {
    const additiveRoot = freshDir('additive');
    tamper(plantCurrent(effortDir(additiveRoot)), [unknownRow('future-notes', [])]);
    const additive = readDoctorEffortSchema(additiveRoot, {});
    expect(additive.outcome).toBe('warn');
    expect(additive.status).toBe('current');
    expect(additive.warnings).toEqual([unknownAdditiveWarning({ id: 'future-notes', appliedBy: '0.30.0' })]);
    expect(effortSchemaRefusal(additive)).toBeNull();

    // The control: an unknown migration that breaks writers is refused, never warned about.
    const writersRoot = freshDir('writers');
    tamper(plantCurrent(effortDir(writersRoot)), [unknownRow('future-writers', ['writers'])]);
    const writers = readDoctorEffortSchema(writersRoot, {});
    expect([writers.outcome, writers.status, writers.warnings]).toEqual(['fail', 'unknown-breaks-writers', []]);
    expect(effortSchemaRefusal(writers)).toContain(`Next safe step: install a rafa that knows future-writers, or ${FIX_SCHEMA_STEP}`);
  });

  it('warns on a development build\'s applied_by in the project\'s own store, and not in a copy', () => {
    const root = freshDir('dev-live');
    const live = plantCurrent(effortDir(root));
    markDevelopment(live);
    const reading = readDoctorEffortSchema(root, {});
    expect(reading.outcome).toBe('warn');
    expect(reading.warnings).toHaveLength(SQLITE_MIGRATIONS.length);
    expect(reading.warnings[0]).toBe(developmentAppliedWarning(live, SQLITE_MIGRATIONS[0]?.id ?? '', DEV_APPLIED_BY));

    const copyDir = join(freshDir('dev-copy'), 'copy');
    markDevelopment(plantCurrent(copyDir));
    const copy = readDoctorEffortSchema(freshDir('dev-copy-root'), { RAFA_EFFORT_DIR: copyDir });
    expect([copy.outcome, copy.live, copy.warnings]).toEqual(['ok', false, []]);
  });

  it('fails a relative RAFA_EFFORT_DIR and a file that is no store, each naming why', () => {
    const relative = readDoctorEffortSchema(freshDir('relative'), { RAFA_EFFORT_DIR: 'copy' });
    expect([relative.outcome, relative.status, relative.path]).toEqual(['fail', 'unreadable', null]);
    expect(relative.problem).toContain('is not an absolute path');

    const root = freshDir('garbage');
    mkdirSync(effortDir(root), { recursive: true });
    Bun.write(storeIn(effortDir(root)), 'not a database at all, but long enough to be read as a header.\n'.repeat(4));
    const garbage = readDoctorEffortSchema(root, {});
    expect([garbage.outcome, garbage.status]).toEqual(['fail', 'unreadable']);
    expect(garbage.problem).toContain('cannot be read as an effort store');
    expect(renderDoctorEffortSchema(garbage)).toHaveLength(2);
  });
});

/** One scratch project whose own store `plant` writes, and the path it wrote. */
function scratchWith(plant: (dir: string) => string): { readonly scratch: ScratchRepo; readonly path: string } {
  const scratch = plantScratchRepo(tempBase);
  return { scratch, path: plant(effortDir(scratch.repo)) };
}

/** `rafa doctor` and `rafa effort schema --check` over the same project. */
function doctorAndCheck(scratch: ScratchRepo, env: Readonly<Record<string, string>> = {}): readonly [CapturedRun, CapturedRun] {
  return [
    runRafa(scratch, scratch.repo, ['doctor'], env),
    runRafa(scratch, scratch.repo, ['effort', 'schema', '--check'], env),
  ];
}

describe('rafa doctor, spawned', () => {
  it('fails where effort schema --check fails, naming the next safe step, and passes where it passes', () => {
    const refused = scratchWith((dir) => plantPreLog(dir, SQLITE_MIGRATIONS.length + 2));
    const [doctor, check] = doctorAndCheck(refused.scratch);
    expect(check.exitCode).toBe(1);
    expect(doctor.exitCode).toBe(1);
    expect(doctor.stdout).toContain(`Effort store schema: fail, pre-log-unreleased (${refused.path})`);
    expect(doctor.stderr).toContain(`rafa doctor: effort store schema: this rafa refuses ${refused.path} (pre-log-unreleased)`);
    expect(doctor.stderr).toContain(`Next safe step: ${FIX_SCHEMA_STEP}`);

    // The control: the same command over a current store, where --check passes.
    const current = scratchWith(plantCurrent);
    const [passed, passedCheck] = doctorAndCheck(current.scratch);
    expect(passedCheck.exitCode).toBe(0);
    expect(passed.exitCode).toBe(0);
    expect(passed.stdout).toContain(`Effort store schema: ok, current (${current.path})`);
  }, SPAWN_TIMEOUT);

  it('gives a failing row\'s next step in json mode as the command_exit message, and a passing row as data', () => {
    const refused = scratchWith((dir) => plantPreLog(dir, SQLITE_MIGRATIONS.length + 2));
    const failed = runRafa(refused.scratch, refused.scratch.repo, ['--output=json', 'doctor']);
    expect(failed.exitCode).toBe(1);
    const failure = JSON.stringify(eventsOf(failed.stdout).at(-1));
    expect(failure).toContain('command_exit');
    expect(failure).toContain(`Next safe step: ${FIX_SCHEMA_STEP}`);

    const current = scratchWith(plantCurrent);
    const passed = runRafa(current.scratch, current.scratch.repo, ['--output=json', 'doctor']);
    expect(passed.exitCode).toBe(0);
    const result = JSON.stringify(eventsOf(passed.stdout).at(-1));
    expect(result).toContain('"effortSchema":{"outcome":"ok"');
  }, SPAWN_TIMEOUT);

  it('warns on an unknown additive migration and exits 0, as --check does', () => {
    const additive = scratchWith((dir) => {
      const path = plantCurrent(dir);
      tamper(path, [unknownRow('future-notes', [])]);
      return path;
    });
    const [doctor, check] = doctorAndCheck(additive.scratch);
    expect(check.exitCode).toBe(0);
    expect(doctor.exitCode).toBe(0);
    expect(doctor.stdout).toContain(`Effort store schema: warn, current (${additive.path})`);
    expect(`${doctor.stdout}${doctor.stderr}`).toContain(unknownAdditiveWarning({ id: 'future-notes', appliedBy: '0.30.0' }));
  }, SPAWN_TIMEOUT);

  it('warns on a +dev applied_by in the live store, and not under RAFA_EFFORT_DIR over a copy holding the same rows', () => {
    const live = scratchWith((dir) => {
      const path = plantCurrent(dir);
      markDevelopment(path);
      return path;
    });
    const doctor = runRafa(live.scratch, live.scratch.repo, ['doctor']);
    expect(doctor.exitCode).toBe(0);
    expect(doctor.stdout).toContain(`Effort store schema: warn, current (${live.path})`);
    expect(`${doctor.stdout}${doctor.stderr}`).toContain(`applied by a development build (${DEV_APPLIED_BY})`);

    const copyDir = join(freshDir('spawned-copy'), 'copy');
    markDevelopment(plantCurrent(copyDir));
    const clean = plantScratchRepo(tempBase);
    const copied = runRafa(clean, clean.repo, ['doctor'], { RAFA_EFFORT_DIR: copyDir });
    expect(copied.exitCode).toBe(0);
    expect(copied.stdout).toContain(`Effort store schema: ok, current (${storeIn(copyDir)})`);
    expect(`${copied.stdout}${copied.stderr}`).not.toContain('applied by a development build');
  }, SPAWN_TIMEOUT);

  it('leaves a store with a migration pending byte-identical, reporting it behind', () => {
    const behind = scratchWith((dir) => plantPreLog(dir, SQLITE_MIGRATIONS.length - 1));
    const before = readFileSync(behind.path);
    const doctor = runRafa(behind.scratch, behind.scratch.repo, ['doctor']);
    expect(doctor.exitCode).toBe(0);
    expect(doctor.stdout).toContain(`Effort store schema: ok, behind (${behind.path})`);
    expect(readFileSync(behind.path).equals(before)).toBe(true);
  }, SPAWN_TIMEOUT);
});
