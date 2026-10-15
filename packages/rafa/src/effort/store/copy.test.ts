/**
 * `copyEffortStore` called directly: the file names it copies, the test
 * guard on both paths, and what a failed copy leaves in a target that
 * existed empty. The command's spawned cases are in
 * `src/commands/effort/copy.test.ts`.
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Database } from 'bun:sqlite';
import { afterAll, afterEach, describe, expect, it } from 'bun:test';

import { copyEffortStore, EFFORT_COPY_FILE_NAMES, EffortCopyFailure, EffortCopyRefusal } from './copy.js';

const scope = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-store-copy-')));
const savedTmpdir = process.env.TMPDIR;
afterEach(() => {
  if (savedTmpdir === undefined) delete process.env.TMPDIR;
  else process.env.TMPDIR = savedTmpdir;
});
afterAll(() => {
  rmSync(scope, { recursive: true, force: true });
});

/** A fresh directory of its own under the suite's scope. */
function fresh(name: string): string {
  return realpathSync(mkdtempSync(join(scope, `${name}-`)));
}

describe('copyEffortStore', () => {
  it('copies the SQLite file and both NDJSON files, in that order', () => {
    expect(EFFORT_COPY_FILE_NAMES).toEqual(['effort.sqlite', 'sessions.ndjson', 'commits.ndjson']);
  });

  it('copies NDJSON files alone when the directory holds no SQLite file', () => {
    const source = fresh('ndjson');
    writeFileSync(join(source, 'commits.ndjson'), '{"sha":"a"}\n', 'utf8');
    const target = join(fresh('target'), 'copy');

    const result = copyEffortStore({ source, target });

    expect(result).toEqual({ source, directory: target, files: ['commits.ndjson'] });
    expect(readdirSync(target)).toEqual(['commits.ndjson']);
  });

  it('refuses, through the test guard, a target outside the temporary directory before making anything', () => {
    const source = fresh('guarded');
    writeFileSync(join(source, 'sessions.ndjson'), '{}\n', 'utf8');
    const target = join(fresh('outside'), 'copy');
    process.env.TMPDIR = fresh('narrow');

    expect(() => copyEffortStore({ source, target })).toThrow('a test opens stores under tmpdir() only');
    expect(existsSync(target)).toBe(false);
  });

  it('refuses a directory holding no store file as a refusal, not a failure', () => {
    const source = fresh('empty-store');
    const target = join(fresh('target'), 'copy');

    expect(() => copyEffortStore({ source, target })).toThrow(EffortCopyRefusal);
    expect(existsSync(target)).toBe(false);
  });

  it('removes each file it wrote from a target that existed empty, and keeps the directory', () => {
    const source = fresh('half');
    const db = new Database(join(source, 'effort.sqlite'), { create: true, readwrite: true });
    db.run('CREATE TABLE t (x)');
    db.close();
    // A directory under an NDJSON name: the SQLite file copies, then this read fails.
    mkdirSync(join(source, 'sessions.ndjson'));
    const target = fresh('existing');

    expect(() => copyEffortStore({ source, target })).toThrow(EffortCopyFailure);
    expect(existsSync(target)).toBe(true);
    expect(readdirSync(target)).toEqual([]);
  });
});
