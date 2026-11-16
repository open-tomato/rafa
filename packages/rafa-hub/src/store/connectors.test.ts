/**
 * `HUB_CONNECTORS`: every entry opens a store and an index over a fresh
 * directory under the temporary directory, and closes cleanly, after which
 * both halves refuse a call naming the close.
 */
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'bun:test';

import { HUB_CONNECTORS } from './connectors.js';

const T0 = '2026-11-09T10:00:00.000Z';

describe('HUB_CONNECTORS', () => {
  const directories: string[] = [];

  afterEach(() => {
    for (const directory of directories.splice(0)) {
      rmSync(directory, { force: true, recursive: true });
    }
  });

  it('holds the sqlite connector by name, in a frozen record', () => {
    expect(Object.keys(HUB_CONNECTORS)).toEqual(['sqlite']);
    expect(Object.isFrozen(HUB_CONNECTORS)).toBe(true);
  });

  for (const [name, connector] of Object.entries(HUB_CONNECTORS)) {
    it(`${name}: answers { store, index } over a fresh directory and closes cleanly`, async () => {
      const directory = realpathSync(mkdtempSync(join(tmpdir(), `rafa-hub-connector-${name}-`)));
      directories.push(directory);

      const { store, index } = await connector({ directory, now: () => new Date(T0) });

      expect(typeof store.push).toBe('function');
      expect(typeof index.search).toBe('function');
      expect((await store.status()).devices).toEqual([]);
      expect(index.capabilities().projection).toBe(false);
      expect((await index.search({ mode: 'fts', query: 'x' })).hits).toEqual([]);

      await store.close();
      await expect(store.status()).rejects.toThrow('closed');
      await expect(index.search({ mode: 'fts', query: 'x' })).rejects.toThrow('closed');
    });
  }
});
