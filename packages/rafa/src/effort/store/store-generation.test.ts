/**
 * `store-generation.ts`: the side record's path beside a store file, its
 * read (null when the file is absent or empty) and its write through a
 * temporary file and a rename. Every file is a real one under
 * `tmpdir()`, so an absent file, a replaced inode and a failed rename are
 * the filesystem's own.
 */
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import {
  readStoreGeneration,
  storeGenerationPath,
  writeStoreGeneration,
} from './store-generation.js';

const scope = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-store-generation-')));
afterAll(() => {
  rmSync(scope, { recursive: true, force: true });
});

/** A store path in a fresh directory of its own. The store file itself is not written. */
function freshStorePath(name: string): string {
  return join(realpathSync(mkdtempSync(join(scope, `${name}-`))), 'effort.sqlite');
}

describe('storeGenerationPath', () => {
  it('names a file beside the store, the store file name with .generation appended', () => {
    const store = freshStorePath('path');

    const sideRecord = storeGenerationPath(store);

    expect(sideRecord).toBe(`${store}.generation`);
    expect(dirname(sideRecord)).toBe(dirname(store));
    expect(basename(sideRecord)).toBe('effort.sqlite.generation');
  });
});

describe('readStoreGeneration', () => {
  it('answers null when the side record is absent', () => {
    const store = freshStorePath('absent');

    expect(readStoreGeneration(store)).toBeNull();
  });

  it('answers null when the side record is empty', () => {
    const store = freshStorePath('empty');
    writeFileSync(storeGenerationPath(store), '', 'utf8');

    expect(readStoreGeneration(store)).toBeNull();
  });

  it('answers null when the side record holds only whitespace', () => {
    const store = freshStorePath('blank');
    writeFileSync(storeGenerationPath(store), ' \n', 'utf8');

    expect(readStoreGeneration(store)).toBeNull();
  });

  it('answers the generation without its trailing newline', () => {
    const store = freshStorePath('present');
    writeFileSync(storeGenerationPath(store), 'gen-1\n', 'utf8');

    expect(readStoreGeneration(store)).toBe('gen-1');
  });

  it('throws the filesystem error when the side record cannot be read', () => {
    const store = freshStorePath('unreadable');
    mkdirSync(storeGenerationPath(store));

    expect(() => readStoreGeneration(store)).toThrow(/EISDIR/);
  });
});

describe('writeStoreGeneration', () => {
  it('writes a generation the read answers back', () => {
    const store = freshStorePath('round-trip');

    writeStoreGeneration(store, 'gen-1');

    expect(readStoreGeneration(store)).toBe('gen-1');
    expect(readFileSync(storeGenerationPath(store), 'utf8')).toBe('gen-1\n');
  });

  it('replaces an earlier generation with the new one', () => {
    const store = freshStorePath('rotate');
    writeStoreGeneration(store, 'gen-1');

    writeStoreGeneration(store, 'gen-2');

    expect(readStoreGeneration(store)).toBe('gen-2');
  });

  it('replaces the side record through a rename, so the record is a new inode', () => {
    const store = freshStorePath('rename');
    writeStoreGeneration(store, 'gen-1');
    const before = statSync(storeGenerationPath(store), { bigint: true }).ino;

    writeStoreGeneration(store, 'gen-2');

    const after = statSync(storeGenerationPath(store), { bigint: true }).ino;
    expect(after).not.toBe(before);
  });

  it('leaves only the side record in the directory, with no temporary file', () => {
    const store = freshStorePath('tidy');

    writeStoreGeneration(store, 'gen-1');
    writeStoreGeneration(store, 'gen-2');

    expect(readdirSync(dirname(store))).toEqual(['effort.sqlite.generation']);
  });

  it('removes its temporary file and throws when the rename fails', () => {
    const store = freshStorePath('failed-rename');
    mkdirSync(storeGenerationPath(store));

    expect(() => {
      writeStoreGeneration(store, 'gen-1');
    }).toThrow();

    expect(readdirSync(dirname(store))).toEqual(['effort.sqlite.generation']);
  });

  it.each([
    ['empty', ''],
    ['blank', '  '],
    ['padded', ' gen-1 '],
    ['multi-line', 'gen-1\ngen-2'],
  ])('refuses a %s generation and writes nothing', (_title, generation) => {
    const store = freshStorePath('refused');

    expect(() => {
      writeStoreGeneration(store, generation);
    }).toThrow(/generation/);

    expect(readdirSync(dirname(store))).toEqual([]);
  });
});
