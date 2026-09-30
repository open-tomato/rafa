/**
 * Tests for the token reader (`token.ts`): the secret is read under
 * service `rafa` with the configured name, and a missing name or secret
 * is refused naming how to store it. The reader is always a stand-in,
 * never the real keychain.
 */
import type { SecretReader } from './token.js';

import { describe, expect, it } from 'bun:test';

import { HubTokenError, readHubToken } from './token.js';

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
