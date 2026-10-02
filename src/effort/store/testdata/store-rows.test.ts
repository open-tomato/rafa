/**
 * `storeRows` over SQLite files planted under a temp directory: a
 * `VACUUM INTO` snapshot whose bytes differ compares equal, rows planted
 * in another order compare equal, and a file differing in one row or in
 * `user_version` does not, so an equality it answers could have failed.
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Database } from 'bun:sqlite';
import { afterAll, describe, expect, it } from 'bun:test';

import { storeRows } from './store-rows.js';

const scope = mkdtempSync(join(tmpdir(), 'rafa-store-rows-'));
afterAll(() => {
  rmSync(scope, { recursive: true, force: true });
});

let made = 0;

/** A fresh file path under the temp directory, not yet created. */
function freshPath(): string {
  made += 1;
  return join(scope, `store-${String(made)}.sqlite`);
}

/** Plants a file at `path` holding `bodies` in `notes`, a keyless `tags` table, and `userVersion`. */
function plant(path: string, bodies: readonly string[], userVersion = 3): void {
  const db = new Database(path, { create: true, readwrite: true });
  try {
    db.run('CREATE TABLE notes (seq INTEGER PRIMARY KEY, body TEXT)');
    db.run('CREATE TABLE tags (name TEXT)');
    for (const body of bodies) {
      db.run('INSERT INTO notes (body) VALUES (?)', [body]);
      db.run('INSERT INTO tags (name) VALUES (?)', [`tag ${body}`]);
    }
    db.run(`PRAGMA user_version = ${String(userVersion)}`);
  } finally {
    db.close();
  }
}

describe('storeRows', () => {
  it('answers the user_version and every table\'s rows as sorted JSON, by table name', () => {
    const path = freshPath();
    plant(path, ['b', 'a']);

    expect(storeRows(path)).toEqual({
      userVersion: 3,
      tables: {
        notes: ['{"seq":1,"body":"b"}', '{"seq":2,"body":"a"}'],
        tags: ['{"name":"tag a"}', '{"name":"tag b"}'],
      },
    });
  });

  it('finds a VACUUM INTO snapshot equal to its source although their bytes differ', () => {
    const path = freshPath();
    plant(path, ['a', 'b', 'c'].map((body) => body.repeat(2000)));
    const db = new Database(path, { readwrite: true });
    try {
      db.run('DELETE FROM notes WHERE seq = 2');
      db.run('DELETE FROM tags WHERE rowid = 2');
    } finally {
      db.close();
    }
    const snapshot = freshPath();
    const source = new Database(path, { readonly: true });
    try {
      source.run('VACUUM INTO ?', [snapshot]);
    } finally {
      source.close();
    }

    expect(readFileSync(snapshot).equals(readFileSync(path))).toBe(false);
    expect(storeRows(snapshot)).toEqual(storeRows(path));
  });

  it('finds rows planted in another order equal, and a file differing in one row or in user_version unequal', () => {
    const path = freshPath();
    plant(path, ['a', 'b']);
    const reordered = freshPath();
    const tagsFirst = new Database(reordered, { create: true, readwrite: true });
    try {
      tagsFirst.run('CREATE TABLE notes (seq INTEGER PRIMARY KEY, body TEXT)');
      tagsFirst.run('CREATE TABLE tags (name TEXT)');
      tagsFirst.run('INSERT INTO tags (name) VALUES (\'tag b\'), (\'tag a\')');
      tagsFirst.run('INSERT INTO notes (seq, body) VALUES (2, \'b\'), (1, \'a\')');
      tagsFirst.run('PRAGMA user_version = 3');
    } finally {
      tagsFirst.close();
    }
    const otherRow = freshPath();
    plant(otherRow, ['a', 'c']);
    const otherVersion = freshPath();
    plant(otherVersion, ['a', 'b'], 4);

    expect(storeRows(reordered)).toEqual(storeRows(path));
    expect(storeRows(otherRow)).not.toEqual(storeRows(path));
    expect(storeRows(otherVersion)).not.toEqual(storeRows(path));
  });
});
