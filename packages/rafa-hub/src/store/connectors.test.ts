/**
 * `HUB_CONNECTORS`: every entry that keeps its files in the context's
 * directory opens a store and an index over a fresh one under the
 * temporary directory, and closes cleanly, after which both halves refuse
 * a call naming the close. `postgres` keeps nothing there, so its entry is
 * held here to reading `POSTGRES_URL`; its store is the row suite's, in
 * `contract.test.ts`, and its open and close the connector package's own.
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

  it('holds the sqlite and postgres connectors by name, in a frozen record', () => {
    expect(Object.keys(HUB_CONNECTORS)).toEqual(['sqlite', 'postgres']);
    expect(Object.isFrozen(HUB_CONNECTORS)).toBe(true);
  });

  it('postgres: reads the URL from POSTGRES_URL, refusing it unset by name', async () => {
    const held = process.env['POSTGRES_URL'];
    delete process.env['POSTGRES_URL'];
    try {
      const opened = HUB_CONNECTORS['postgres']?.({ directory: '/nonexistent', now: () => new Date(T0) });

      await expect(opened).rejects.toThrow('the environment variable POSTGRES_URL is unset');
    } finally {
      if (held !== undefined) process.env['POSTGRES_URL'] = held;
    }
  });

  for (const [name, connector] of Object.entries(HUB_CONNECTORS).filter(([key]) => key !== 'postgres')) {
    it(`${name}: answers { store, index } over a fresh directory and closes cleanly`, async () => {
      const directory = realpathSync(mkdtempSync(join(tmpdir(), `rafa-hub-connector-${name}-`)));
      directories.push(directory);

      const { store, index } = await connector({ directory, now: () => new Date(T0) });

      expect(typeof store.push).toBe('function');
      expect(typeof index.search).toBe('function');
      expect((await store.status()).devices).toEqual([]);
      expect(store.contract().capabilities.projection).toBe(true);
      expect((await index.search({ mode: 'fts', query: 'x' })).hits).toEqual([]);

      await store.close();
      await expect(store.status()).rejects.toThrow('closed');
      await expect(index.search({ mode: 'fts', query: 'x' })).rejects.toThrow('closed');
    });
  }
});
