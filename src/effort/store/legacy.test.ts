/**
 * Tests for `readLegacyStore` (`legacy.ts`): which store files each
 * effort directory holds, when the warning fires, and that the move it
 * names runs.
 *
 * Every case plants a project root under this file's own temporary
 * directory, and each warning case sits beside a control differing in the
 * one path the case is about, so each reading can come out the other way.
 * The move case runs the warning's own command through `/bin/sh` from
 * another directory, in a root holding a space and a quote, then reads
 * the root again.
 */
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { EFFORT_STORE_DIR, effortStorePath } from '../store.js';

import { LEGACY_EFFORT_STORE_DIR, readLegacyStore, shellQuoted, STORE_FILE_NAMES } from './legacy.js';
import { sqliteStorePath } from './sqlite.js';

/** A temporary directory of this file's own, its real path. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-legacy-store-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** A fresh project root under the temporary directory, named from `prefix`. */
function plantRoot(prefix = 'root-'): string {
  return mkdtempSync(join(tempBase, prefix));
}

/** Writes `text` to `name` under `dir` of `root`, making the directory; answers the file. */
function plantFile(root: string, dir: string, name: string, text = 'rows'): string {
  mkdirSync(join(root, dir), { recursive: true });
  const file = join(root, dir, name);
  writeFileSync(file, text, 'utf8');
  return file;
}

/** The command the warning ends with, after `move it: `, or null. */
function moveOf(warning: string | null): string | null {
  const at = warning?.indexOf('move it: ') ?? -1;
  return warning === null || at === -1
    ? null
    : warning.slice(at + 'move it: '.length);
}

describe('the store file names', () => {
  it('are the files the SQLite and NDJSON backends write, the SQLite one first', () => {
    const root = '/a/project';

    expect(STORE_FILE_NAMES).toEqual(['effort.sqlite', 'sessions.ndjson', 'commits.ndjson']);
    expect(STORE_FILE_NAMES.map((name) => join(root, EFFORT_STORE_DIR, name))).toEqual([
      sqliteStorePath(root),
      effortStorePath(root, 'sessions'),
      effortStorePath(root, 'commits'),
    ]);
  });

  it('spell the old directory as .ralph/effort, beside the .rafa/effort the backends write', () => {
    const reading = readLegacyStore(plantRoot());

    expect(LEGACY_EFFORT_STORE_DIR).toBe(join('.ralph', 'effort'));
    expect(EFFORT_STORE_DIR).toBe(join('.rafa', 'effort'));
    expect(reading.storeDir.endsWith(join('.rafa', 'effort'))).toBe(true);
    expect(reading.legacyDir.endsWith(join('.ralph', 'effort'))).toBe(true);
  });
});

describe('reading a project root', () => {
  it('warns for a store under .ralph/effort with no .rafa/effort, and creates nothing reading it', () => {
    const root = plantRoot();
    plantFile(root, LEGACY_EFFORT_STORE_DIR, 'effort.sqlite');

    const reading = readLegacyStore(root);

    expect(reading.legacyDir).toBe(join(root, '.ralph', 'effort'));
    expect(reading.storeDir).toBe(join(root, '.rafa', 'effort'));
    expect(reading.legacyFiles).toEqual(['effort.sqlite']);
    expect(reading.storeFiles).toEqual([]);
    expect(reading.warning).toStartWith(`${join(root, '.ralph', 'effort')} holds an effort store (effort.sqlite)`
      + ` and ${join(root, '.rafa', 'effort')} holds none;`);
    expect(existsSync(join(root, '.rafa'))).toBe(false);
  });

  it('says nothing once .rafa/effort holds a store file, whatever the old directory still holds', () => {
    const root = plantRoot();
    plantFile(root, LEGACY_EFFORT_STORE_DIR, 'effort.sqlite');
    plantFile(root, EFFORT_STORE_DIR, 'effort.sqlite');

    const reading = readLegacyStore(root);

    expect(reading.legacyFiles).toEqual(['effort.sqlite']);
    expect(reading.storeFiles).toEqual(['effort.sqlite']);
    expect(reading.warning).toBeNull();
  });

  it('warns under the empty .rafa/effort that rafa init writes, since a directory is no store', () => {
    const root = plantRoot();
    plantFile(root, LEGACY_EFFORT_STORE_DIR, 'sessions.ndjson');
    mkdirSync(join(root, EFFORT_STORE_DIR), { recursive: true });
    const control = plantRoot();
    plantFile(control, LEGACY_EFFORT_STORE_DIR, 'sessions.ndjson');
    plantFile(control, EFFORT_STORE_DIR, 'commits.ndjson');

    expect(readLegacyStore(root).warning).not.toBeNull();
    expect(readLegacyStore(control).warning).toBeNull();
    expect(readLegacyStore(control).storeFiles).toEqual(['commits.ndjson']);
  });

  it('names every store file the old directory holds, in store order, and no other file there', () => {
    const root = plantRoot();
    for (const name of ['commits.ndjson', 'notes.txt', 'effort.sqlite']) plantFile(root, LEGACY_EFFORT_STORE_DIR, name);

    const reading = readLegacyStore(root);

    expect(reading.legacyFiles).toEqual(['effort.sqlite', 'commits.ndjson']);
    expect(reading.warning).toContain('holds an effort store (effort.sqlite, commits.ndjson) and');
  });

  it('says nothing for a root with neither directory, or an old directory holding no store file', () => {
    const empty = plantRoot();
    const notes = plantRoot();
    plantFile(notes, LEGACY_EFFORT_STORE_DIR, 'notes.txt');
    const control = plantRoot();
    plantFile(control, LEGACY_EFFORT_STORE_DIR, 'notes.txt');
    plantFile(control, LEGACY_EFFORT_STORE_DIR, 'commits.ndjson');

    expect(readLegacyStore(empty)).toMatchObject({ legacyFiles: [], storeFiles: [], warning: null });
    expect(readLegacyStore(notes)).toMatchObject({ legacyFiles: [], storeFiles: [], warning: null });
    expect(readLegacyStore(control).warning).not.toBeNull();
  });

  it('holds no store in a directory spelled as a store file or a dangling link, and one in a link to a file', () => {
    const root = plantRoot();
    const legacy = join(root, LEGACY_EFFORT_STORE_DIR);
    mkdirSync(join(legacy, 'effort.sqlite'), { recursive: true });
    symlinkSync(join(root, 'nothing-here'), join(legacy, 'sessions.ndjson'));
    const control = plantRoot();
    const target = plantFile(control, 'elsewhere', 'rows.ndjson');
    mkdirSync(join(control, LEGACY_EFFORT_STORE_DIR), { recursive: true });
    symlinkSync(target, join(control, LEGACY_EFFORT_STORE_DIR, 'commits.ndjson'));

    expect(readLegacyStore(root)).toMatchObject({ legacyFiles: [], warning: null });
    expect(readLegacyStore(control).legacyFiles).toEqual(['commits.ndjson']);
    expect(readLegacyStore(control).warning).not.toBeNull();
  });

  it('reads an old directory that is a file as holding no store, where stat answers ENOTDIR', () => {
    const root = plantRoot();
    plantFile(root, '.ralph', 'effort');

    expect(readLegacyStore(root)).toMatchObject({ legacyFiles: [], storeFiles: [], warning: null });
  });

  it('throws naming the path for an old directory it cannot search, and reads it once it can', () => {
    const root = plantRoot();
    plantFile(root, LEGACY_EFFORT_STORE_DIR, 'effort.sqlite');
    const legacy = join(root, LEGACY_EFFORT_STORE_DIR);
    chmodSync(legacy, 0o000);
    try {
      expect(() => readLegacyStore(root)).toThrow(`${join(legacy, 'effort.sqlite')}: cannot be checked (`);
    } finally {
      chmodSync(legacy, 0o755);
    }

    expect(readLegacyStore(root).legacyFiles).toEqual(['effort.sqlite']);
  });
});

describe('the move the warning names', () => {
  it('moves the whole old directory into .rafa/effort run through sh from elsewhere, in a root holding a space and a quote', () => {
    const root = plantRoot('it\'s a root-');
    plantFile(root, LEGACY_EFFORT_STORE_DIR, 'effort.sqlite', 'the rows');
    plantFile(root, LEGACY_EFFORT_STORE_DIR, 'effort.sqlite-journal', 'a journal');
    plantFile(root, LEGACY_EFFORT_STORE_DIR, 'sessions.ndjson', '{}\n');
    const move = moveOf(readLegacyStore(root).warning);

    expect(move).toStartWith('mkdir -p \'');
    const run = Bun.spawnSync(['/bin/sh', '-c', move ?? 'exit 99'], { cwd: tempBase, stdin: 'ignore' });

    expect(run.stderr.toString()).toBe('');
    expect(run.exitCode).toBe(0);
    const after = readLegacyStore(root);
    expect(after).toMatchObject({ legacyFiles: [], storeFiles: ['effort.sqlite', 'sessions.ndjson'], warning: null });
    expect(readdirSync(join(root, EFFORT_STORE_DIR)).sort((a, b) => a.localeCompare(b))).toEqual([
      'effort.sqlite',
      'effort.sqlite-journal',
      'sessions.ndjson',
    ]);
    expect(readFileSync(join(root, EFFORT_STORE_DIR, 'effort.sqlite'), 'utf8')).toBe('the rows');
  });

  it('quotes a path holding a quote and a space as one sh word, where the path left bare is not one', () => {
    const path = '/tmp/it\'s a $HOME `root`';
    const quoted = Bun.spawnSync(['/bin/sh', '-c', `printf '%s' ${shellQuoted(path)}`], { stdin: 'ignore' });
    const bare = Bun.spawnSync(['/bin/sh', '-c', `printf '%s|' ${path.replaceAll('\'', '')}`], { stdin: 'ignore' });

    expect(quoted.exitCode).toBe(0);
    expect(quoted.stdout.toString()).toBe(path);
    expect(bare.stdout.toString()).not.toBe(`${path}|`);
  });
});
