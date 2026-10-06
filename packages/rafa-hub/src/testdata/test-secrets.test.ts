/**
 * Tests for `./test-secrets.js`: the planted file holds the token under
 * service `rafa`, and the child environment names that file beside
 * `RAFA_TEST=1` and the scratch HOME variables.
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { scratchHomeEnv } from './scratch-home-env.js';
import { plantTestSecret, testSecretsChildEnv, testSecretsFileIn } from './test-secrets.js';

describe('plantTestSecret', () => {
  let scratch = '';

  beforeEach(() => {
    scratch = mkdtempSync(join(tmpdir(), 'rafa-hub-test-secrets-'));
  });

  afterEach(() => {
    rmSync(scratch, { recursive: true, force: true });
  });

  it('writes the token under service rafa and the name, at the path it answers', () => {
    const path = plantTestSecret(scratch, 'hub-token-1', 'ghp_x');

    expect(path).toBe(testSecretsFileIn(scratch));
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({ rafa: { 'hub-token-1': 'ghp_x' } });
  });
});

describe('testSecretsChildEnv', () => {
  it('names the secrets file beside RAFA_TEST=1 and the scratch HOME variables', () => {
    const home = join('/scratch', 'device', 'home');

    expect(testSecretsChildEnv(home, '/scratch/test-secrets.json')).toEqual({
      ...scratchHomeEnv(home),
      RAFA_TEST: '1',
      RAFA_TEST_SECRETS_FILE: '/scratch/test-secrets.json',
    });
  });
});
