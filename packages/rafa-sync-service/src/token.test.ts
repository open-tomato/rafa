/**
 * Tests for the token reader (`token.ts`): the secret is read under
 * service `rafa` with the configured name, and a missing name or secret
 * is refused naming how to store it. The reader is always a stand-in,
 * never the real keychain. The file reader and the default's choice
 * between it and `Bun.secrets` are read over scratch files.
 */
import type { SecretReader } from './token.js';

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { bunSecretReader, defaultSecretReader, fileSecretReader, HubTokenError, readHubToken } from './token.js';

/** A reader holding one secret, recording every lookup. */
function fakeReader(stored: Record<string, string>, calls: string[] = []): SecretReader {
  return async ({ service, name }) => {
    calls.push(`${service}/${name}`);
    return stored[`${service}/${name}`] ?? null;
  };
}

describe('readHubToken', () => {
  it('reads the named secret under service rafa', async () => {
    const calls: string[] = [];
    const token = await readHubToken('hub-token', fakeReader({ 'rafa/hub-token': 'ghp_x' }, calls));
    expect(token).toBe('ghp_x');
    expect(calls).toEqual(['rafa/hub-token']);
  });

  it('does not find a secret stored under another service', async () => {
    const reading = readHubToken('hub-token', fakeReader({ 'other/hub-token': 'ghp_x' }));
    await expect(reading).rejects.toBeInstanceOf(HubTokenError);
  });

  it('refuses a missing secret naming how to store it', async () => {
    const reading = readHubToken('hub-token', fakeReader({}));
    await expect(reading).rejects.toThrow(
      'no hub token is stored under service "rafa", name "hub-token": store one with '
      + 'bun -e \'await Bun.secrets.set({ service: "rafa", name: "hub-token", value: "<token>" })\'',
    );
  });

  it('refuses an empty secret', async () => {
    const reading = readHubToken('hub-token', fakeReader({ 'rafa/hub-token': '' }));
    await expect(reading).rejects.toThrow('store one with');
  });

  it('refuses an unset hub.tokenSecret without reading the store', async () => {
    const calls: string[] = [];
    const reading = readHubToken(null, fakeReader({}, calls));
    await expect(reading).rejects.toThrow('hub.tokenSecret is not set');
    expect(calls).toEqual([]);
  });
});

describe('fileSecretReader', () => {
  let scratch = '';

  beforeEach(() => {
    scratch = mkdtempSync(join(tmpdir(), 'rafa-token-file-'));
  });

  afterEach(() => {
    rmSync(scratch, { recursive: true, force: true });
  });

  /** Writes `text` as the secrets file and answers its path. */
  function planted(text: string): string {
    const path = join(scratch, 'secrets.json');
    writeFileSync(path, text, 'utf8');
    return path;
  }

  it('reads a secret by service and name, and answers null for one it does not hold', async () => {
    const read = fileSecretReader(planted(JSON.stringify({ rafa: { 'hub-token': 'ghp_x' } })));

    expect(await read({ service: 'rafa', name: 'hub-token' })).toBe('ghp_x');
    expect(await read({ service: 'rafa', name: 'other' })).toBeNull();
    expect(await read({ service: 'other', name: 'hub-token' })).toBeNull();
  });

  it('refuses a file that does not exist, naming it', async () => {
    const path = join(scratch, 'missing.json');

    await expect(fileSecretReader(path)({ service: 'rafa', name: 'hub-token' })).rejects.toThrow(path);
  });

  it('refuses a file that is not a service-to-name-to-string object, naming it', async () => {
    for (const text of ['not json', '[]', JSON.stringify({ rafa: 'flat' }), JSON.stringify({ rafa: { 'hub-token': 7 } })]) {
      const path = planted(text);
      await expect(fileSecretReader(path)({ service: 'rafa', name: 'hub-token' })).rejects.toThrow(path);
    }
  });
});

describe('defaultSecretReader', () => {
  it('answers Bun.secrets unless RAFA_TEST is 1 and RAFA_TEST_SECRETS_FILE is set', () => {
    expect(defaultSecretReader({})).toBe(bunSecretReader);
    expect(defaultSecretReader({ RAFA_TEST_SECRETS_FILE: '/scratch/secrets.json' })).toBe(bunSecretReader);
    expect(defaultSecretReader({ RAFA_TEST: '1' })).toBe(bunSecretReader);
    expect(defaultSecretReader({ RAFA_TEST: 'true', RAFA_TEST_SECRETS_FILE: '/scratch/secrets.json' })).toBe(bunSecretReader);
    expect(defaultSecretReader({ RAFA_TEST: '1', RAFA_TEST_SECRETS_FILE: '' })).toBe(bunSecretReader);
  });

  it('reads the named file in a test process', async () => {
    const scratch = mkdtempSync(join(tmpdir(), 'rafa-token-default-'));
    try {
      const path = join(scratch, 'secrets.json');
      writeFileSync(path, JSON.stringify({ rafa: { 'hub-token': 'ghp_file' } }), 'utf8');
      const read = defaultSecretReader({ RAFA_TEST: '1', RAFA_TEST_SECRETS_FILE: path });

      expect(read).not.toBe(bunSecretReader);
      expect(await read({ service: 'rafa', name: 'hub-token' })).toBe('ghp_file');
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });
});
