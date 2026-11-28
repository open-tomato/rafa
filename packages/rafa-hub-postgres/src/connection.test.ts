/**
 * The connection opener: the URL is read from the configured variable,
 * an unset or empty one refuses naming the variable and never the value,
 * and a database missing `pg_search` or `pgvector` refuses naming each
 * missing one, with the client closed. The unit cases inject the
 * extension reader and a stand-in client; where `POSTGRES_URL` is set, a
 * live case opens on it and reads the real `pg_extension`.
 */
import type { SQL } from 'bun';

import { describe, expect, it } from 'bun:test';

import {
  REQUIRED_EXTENSIONS,
  missingExtensions,
  openPostgresConnection,
  readLoadedExtensions,
  readPostgresUrl,
} from './connection.js';

/** A URL holding a password, so a refusal repeating it would show. */
const SECRET_URL = 'postgres://hub:s3cret-pass@db.example:5432/hub';

/** A stand-in client that records its close and the URL it was opened on. */
function standInClient(): { readonly client: SQL; readonly opened: string[]; readonly closed: () => number } {
  const opened: string[] = [];
  let closes = 0;
  const client = { close: async () => { closes += 1; } } as unknown as SQL;
  return { client, opened, closed: () => closes };
}

/** The refusal an open rejects with, as an error. */
async function refusalOf(open: Promise<unknown>): Promise<Error> {
  try {
    await open;
  } catch (error) {
    if (error instanceof Error) return error;
    throw error;
  }
  throw new Error('the open did not refuse');
}

describe('readPostgresUrl', () => {
  it('answers the value of the configured variable', () => {
    expect(readPostgresUrl('HUB_DB', { HUB_DB: SECRET_URL })).toBe(SECRET_URL);
  });

  it('refuses an unset variable by its name', () => {
    expect(() => readPostgresUrl('HUB_DB', { POSTGRES_URL: SECRET_URL })).toThrow(
      'the environment variable HUB_DB is unset',
    );
  });

  it('refuses an empty or blank variable by its name', () => {
    expect(() => readPostgresUrl('HUB_DB', { HUB_DB: '' })).toThrow('the environment variable HUB_DB is empty');
    expect(() => readPostgresUrl('HUB_DB', { HUB_DB: '  ' })).toThrow('the environment variable HUB_DB is empty');
  });
});

describe('missingExtensions', () => {
  it('names nothing when both are loaded, whatever else is', () => {
    expect(missingExtensions(['plpgsql', 'vector', 'pg_search'])).toEqual([]);
  });

  it('names pgvector by its install name when only its extname, vector, is absent', () => {
    expect(missingExtensions(['pg_search', 'pgvector'])).toEqual(['pgvector']);
  });

  it('names each missing one, in refusal order', () => {
    expect(missingExtensions(['plpgsql'])).toEqual(REQUIRED_EXTENSIONS.map(({ name }) => name));
  });
});

describe('openPostgresConnection, over an injected extension reader', () => {
  it('opens on the variable\'s URL and answers the loaded extensions, sorted', async () => {
    const stand = standInClient();
    const connection = await openPostgresConnection({
      urlVariable: 'HUB_DB',
      env: { HUB_DB: SECRET_URL },
      connect: (url) => {
        stand.opened.push(url);
        return stand.client;
      },
      readExtensions: async () => ['vector', 'plpgsql', 'pg_search'],
    });
    expect(stand.opened).toEqual([SECRET_URL]);
    expect(connection.client).toBe(stand.client);
    expect(connection.extensions).toEqual(['pg_search', 'plpgsql', 'vector']);
    expect(stand.closed()).toBe(0);
  });

  it('refuses an unset variable before it connects, naming the variable', async () => {
    const error = await refusalOf(openPostgresConnection({
      urlVariable: 'HUB_DB',
      env: {},
      connect: () => { throw new Error('connected'); },
    }));
    expect(error.message).toContain('HUB_DB is unset');
  });

  it('refuses an empty variable before it connects, naming the variable', async () => {
    const error = await refusalOf(openPostgresConnection({
      urlVariable: 'HUB_DB',
      env: { HUB_DB: '' },
      connect: () => { throw new Error('connected'); },
    }));
    expect(error.message).toContain('HUB_DB is empty');
  });

  it('refuses a database missing pg_search alone, naming it and closing the client', async () => {
    const stand = standInClient();
    const error = await refusalOf(openPostgresConnection({
      urlVariable: 'HUB_DB',
      env: { HUB_DB: SECRET_URL },
      connect: () => stand.client,
      readExtensions: async () => ['plpgsql', 'vector'],
    }));
    expect(error.message).toContain('lacks the extension pg_search;');
    expect(error.message).not.toContain('pgvector');
    expect(error.message).not.toContain(SECRET_URL);
    expect(stand.closed()).toBe(1);
  });

  it('refuses a database missing pgvector alone, naming it', async () => {
    const stand = standInClient();
    const error = await refusalOf(openPostgresConnection({
      urlVariable: 'HUB_DB',
      env: { HUB_DB: SECRET_URL },
      connect: () => stand.client,
      readExtensions: async () => ['plpgsql', 'pg_search'],
    }));
    expect(error.message).toContain('lacks the extension pgvector;');
    expect(stand.closed()).toBe(1);
  });

  it('refuses a database missing both, naming each', async () => {
    const stand = standInClient();
    const error = await refusalOf(openPostgresConnection({
      urlVariable: 'HUB_DB',
      env: { HUB_DB: SECRET_URL },
      connect: () => stand.client,
      readExtensions: async () => ['plpgsql'],
    }));
    expect(error.message).toContain('lacks the extensions pg_search and pgvector;');
    expect(stand.closed()).toBe(1);
  });

  it('closes the client when the extension read fails, passing its error on', async () => {
    const stand = standInClient();
    const error = await refusalOf(openPostgresConnection({
      urlVariable: 'HUB_DB',
      env: { HUB_DB: SECRET_URL },
      connect: () => stand.client,
      readExtensions: async () => { throw new Error('read failed'); },
    }));
    expect(error.message).toBe('read failed');
    expect(stand.closed()).toBe(1);
  });
});

const url = process.env['POSTGRES_URL'];

describe.skipIf(url === undefined || url === '')('openPostgresConnection, live on POSTGRES_URL', () => {
  it('opens on the default variable and reads pg_extension', async () => {
    const connection = await openPostgresConnection({ urlVariable: 'POSTGRES_URL' });
    try {
      expect(connection.extensions).toContain('pg_search');
      expect(connection.extensions).toContain('vector');
      expect([...await readLoadedExtensions(connection.client)].sort()).toEqual([...connection.extensions]);
    } finally {
      await connection.client.close();
    }
  });

  it('refuses the live database when the reader drops an extension, so the check can fail', async () => {
    const error = await refusalOf(openPostgresConnection({
      urlVariable: 'POSTGRES_URL',
      readExtensions: async (client) => (await readLoadedExtensions(client)).filter((name) => name !== 'vector'),
    }));
    expect(error.message).toContain('lacks the extension pgvector;');
  });
});
