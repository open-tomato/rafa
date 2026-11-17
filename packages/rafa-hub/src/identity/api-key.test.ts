/**
 * The API-key identity adapter (`api-key.ts`): the port's contract
 * suite over the bootstrap keys alone, registered with
 * `{ forbids: false }` since every key a variable holds is served, then
 * what is the adapter's own. That covers a bearer near a key refused (a
 * prefix, a character more), a second listed key served, the variables
 * read once when opened, an open refused over a variable unset or
 * empty, and the key store: a live key served under its name and
 * stamped once per served request, a paused one `forbidden` naming it,
 * a deleted or unknown one `unauthenticated` naming nothing, each read
 * on every request, a bootstrap key served before the store is asked,
 * and a store that rejects answered `unavailable`.
 *
 * Every case hands the adapter an environment of its own, a record
 * rather than `process.env`, so no case sets a variable another reads,
 * and a store of its own in a scratch directory under the temp dir.
 */
import type { HubKey, HubKeyStore } from './key-store.js';
import type { IdentityAnswer } from './port.js';

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { HubConfigError } from '../config.js';

import { API_KEY_PROVIDER, openApiKeyIdentity } from './api-key.js';
import { identityContract } from './contract.js';
import { keysFileName, openSqliteKeyStore } from './key-store.js';
import { HUB_ACTIONS } from './port.js';

/** The variables `hub.auth.apiKeys` names in these cases. */
const FIRST = 'RAFA_HUB_TEST_KEY_FIRST';
const SECOND = 'RAFA_HUB_TEST_KEY_SECOND';

/** The keys those variables hold. */
const FIRST_KEY = 'rafa-hub-first-key-0000000001';
const SECOND_KEY = 'rafa-hub-second-key-000000002';

/** A well-formed key no variable holds. */
const UNKNOWN_KEY = 'rafa-hub-unknown-key-00000003';

/** The environment both keys are read from. */
const ENV: Readonly<Record<string, string>> = Object.freeze({ [FIRST]: FIRST_KEY, [SECOND]: SECOND_KEY });

identityContract('api-key', () => ({
  identity: openApiKeyIdentity({ variables: [FIRST], env: ENV }),
  served: { authorization: `Bearer ${FIRST_KEY}` },
  unrecognised: { authorization: `Bearer ${UNKNOWN_KEY}` },
}), { forbids: false });

/** Headers carrying `plain` as a bearer. */
function bearer(plain: string): Readonly<Record<string, string>> {
  return { authorization: `Bearer ${plain}` };
}

identityContract('api-key (store)', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'rafa-hub-api-key-contract-'));
  const store = openSqliteKeyStore({ path: keysFileName(join(directory, 'rafa.sqlite')), reservedNames: [FIRST] });
  const served = await store.create('contract-served', 'octocat');
  const forbidden = await store.create('contract-forbidden', 'octocat');
  await store.pause('contract-forbidden');
  return {
    identity: openApiKeyIdentity({ variables: [FIRST], env: ENV, store }),
    served: bearer(served.plain),
    forbidden: bearer(forbidden.plain),
    unrecognised: bearer(UNKNOWN_KEY),
    lifecycle: {
      create: async (name) => bearer((await store.create(name, 'octocat')).plain),
      pause: async (name) => {
        await store.pause(name);
      },
      delete: async (name) => {
        await store.delete(name);
      },
    },
    close: async () => {
      store.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}, { forbids: true, lifecycle: true });

/** A hub request carrying `authorization`, or none. */
function hubRequest(authorization?: string): Request {
  return new Request('http://hub.test/v1/status', {
    headers: authorization === undefined
      ? {}
      : { authorization },
  });
}

/** The reason `answer` was refused for, or `served`. */
function outcomeOf(answer: IdentityAnswer): string {
  return answer.served
    ? 'served'
    : answer.refusal.reason;
}

/** The problems the open threw, failing the case when it opened. */
function openProblems(variables: readonly string[], env: Readonly<Record<string, string | undefined>>): readonly string[] {
  try {
    openApiKeyIdentity({ variables, env });
  } catch (error) {
    if (error instanceof HubConfigError) return error.problems;
    throw error;
  }
  throw new Error('expected the open to be refused and it opened');
}

describe('the API-key identity adapter', () => {
  describe('a bearer near a key', () => {
    const identity = openApiKeyIdentity({ variables: [FIRST, SECOND], env: ENV });

    it('refuses a prefix of a key as unauthenticated', async () => {
      const answers = await Promise.all([FIRST_KEY.slice(0, -1), FIRST_KEY.slice(0, 1), SECOND_KEY.slice(0, 12)]
        .map((prefix) => identity.identify(hubRequest(`Bearer ${prefix}`))));

      expect(answers.map(outcomeOf)).toEqual(['unauthenticated', 'unauthenticated', 'unauthenticated']);
    });

    it('refuses a key with a trailing character as unauthenticated', async () => {
      const answers = await Promise.all([`${FIRST_KEY}x`, `${SECOND_KEY}0`, `${FIRST_KEY}${SECOND_KEY}`]
        .map((longer) => identity.identify(hubRequest(`Bearer ${longer}`))));

      expect(answers.map(outcomeOf)).toEqual(['unauthenticated', 'unauthenticated', 'unauthenticated']);
    });

    it('refuses a key sent under another scheme, or with no scheme, as unauthenticated', async () => {
      const answers = await Promise.all([`Basic ${FIRST_KEY}`, FIRST_KEY, `Bearer${FIRST_KEY}`]
        .map((header) => identity.identify(hubRequest(header))));

      expect(answers.map(outcomeOf)).toEqual(['unauthenticated', 'unauthenticated', 'unauthenticated']);
    });

    it('refuses a bearer far longer than any key without throwing', async () => {
      const answer = await identity.identify(hubRequest(`Bearer ${FIRST_KEY.repeat(400)}`));

      expect(outcomeOf(answer)).toBe('unauthenticated');
    });

    it('names no part of the bearer in a refusal', async () => {
      const prefix = FIRST_KEY.slice(0, -1);
      const answer = await identity.identify(hubRequest(`Bearer ${prefix}`));
      if (answer.served) throw new Error('expected a refusal and the request was served');

      expect(answer.refusal.message).not.toContain(prefix.slice(0, 12));
      expect(answer.refusal.message).toContain('hub.auth.apiKeys');
    });
  });

  describe('a listed key', () => {
    it('serves the second listed key with every hub action, named by its variable', async () => {
      const identity = openApiKeyIdentity({ variables: [FIRST, SECOND], env: ENV });

      const answer = await identity.identify(hubRequest(`Bearer ${SECOND_KEY}`));

      expect(answer).toEqual({ served: true, caller: { id: SECOND, provider: API_KEY_PROVIDER }, may: [...HUB_ACTIONS] });
    });

    it('serves the first listed key under its own variable', async () => {
      const identity = openApiKeyIdentity({ variables: [FIRST, SECOND], env: ENV });

      const answer = await identity.identify(hubRequest(`Bearer ${FIRST_KEY}`));

      expect(answer.served && answer.caller.id).toBe(FIRST);
    });

    it('reads the bearer scheme word in any case', async () => {
      const identity = openApiKeyIdentity({ variables: [FIRST], env: ENV });

      const answers = await Promise.all(['bearer', 'BEARER'].map((scheme) => identity.identify(hubRequest(`${scheme} ${FIRST_KEY}`))));

      expect(answers.map(outcomeOf)).toEqual(['served', 'served']);
    });

    it('refuses a key a variable holds that hub.auth.apiKeys does not name', async () => {
      const identity = openApiKeyIdentity({ variables: [FIRST], env: ENV });

      const answer = await identity.identify(hubRequest(`Bearer ${SECOND_KEY}`));

      expect(outcomeOf(answer)).toBe('unauthenticated');
    });
  });

  describe('the variables, read once', () => {
    it('serves the key held when opened, whatever the variable holds after', async () => {
      const env: Record<string, string | undefined> = { [FIRST]: FIRST_KEY };
      const identity = openApiKeyIdentity({ variables: [FIRST], env });
      env[FIRST] = SECOND_KEY;

      const answers = await Promise.all([FIRST_KEY, SECOND_KEY].map((key) => identity.identify(hubRequest(`Bearer ${key}`))));

      expect(answers.map(outcomeOf)).toEqual(['served', 'unauthenticated']);
    });

    it('reads process.env when no environment is handed it', async () => {
      const variable = 'RAFA_HUB_TEST_KEY_FROM_PROCESS';
      const before = process.env[variable];
      process.env[variable] = UNKNOWN_KEY;
      try {
        const identity = openApiKeyIdentity({ variables: [variable] });

        expect(outcomeOf(await identity.identify(hubRequest(`Bearer ${UNKNOWN_KEY}`)))).toBe('served');
      } finally {
        if (before === undefined) delete process.env[variable];
        else process.env[variable] = before;
      }
    });
  });

  describe('an open refused', () => {
    it('refuses to open over an unset variable, naming it and no key', () => {
      const problems = openProblems([FIRST, SECOND], { [FIRST]: FIRST_KEY });

      expect(problems).toHaveLength(1);
      expect(problems[0]).toStartWith(`${SECOND} is unset`);
      expect(problems.join('\n')).not.toContain(FIRST_KEY);
    });

    it('refuses to open over an empty variable, naming it', () => {
      const problems = openProblems([FIRST, SECOND], { [FIRST]: '', [SECOND]: SECOND_KEY });

      expect(problems).toHaveLength(1);
      expect(problems[0]).toStartWith(`${FIRST} is empty`);
    });

    it('names every variable it could not read, in the order listed', () => {
      const problems = openProblems([SECOND, FIRST], {});

      expect(problems.map((problem) => problem.split(' ')[0])).toEqual([SECOND, FIRST]);
    });

    it('refuses to open over no variable at all', () => {
      const problems = openProblems([], ENV);

      expect(problems).toEqual(['hub.auth.apiKeys: names no variable; expected at least one environment variable name']);
    });
  });

  describe('the key store', () => {
    /** The instant the store's clock answers, fixed, so a stamp reads as it. */
    const NOW = '2026-11-17T10:00:00.000Z';

    let directory = '';
    let store: HubKeyStore;

    beforeEach(() => {
      directory = mkdtempSync(join(tmpdir(), 'rafa-hub-api-key-'));
      store = openSqliteKeyStore({ path: keysFileName(join(directory, 'rafa.sqlite')), now: () => new Date(NOW), reservedNames: [FIRST] });
    });

    afterEach(() => {
      store.close();
      rmSync(directory, { recursive: true, force: true });
    });

    /** The adapter over the first variable and the case's store. */
    const openWithStore = () => openApiKeyIdentity({ variables: [FIRST], env: ENV, store });

    /** The row named `name`, failing the case when the store lists none. */
    async function rowOf(name: string): Promise<HubKey> {
      const row = (await store.list()).find((key) => key.name === name);
      if (row === undefined) throw new Error(`expected a key named ${name} and the store lists none`);
      return row;
    }

    it('serves a live store key with every hub action, named by its name', async () => {
      const { plain } = await store.create('ci-runner', 'octocat');

      const answer = await openWithStore().identify(hubRequest(`Bearer ${plain}`));

      expect(answer).toEqual({ served: true, caller: { id: 'ci-runner', provider: API_KEY_PROVIDER }, may: [...HUB_ACTIONS] });
    });

    it('serves a key created after the adapter was opened', async () => {
      const identity = openWithStore();
      const { plain } = await store.create('late', 'octocat');

      expect(outcomeOf(await identity.identify(hubRequest(`Bearer ${plain}`)))).toBe('served');
    });

    it('stamps a served key as used, at the store clock', async () => {
      const { plain } = await store.create('ci-runner', 'octocat');
      expect((await rowOf('ci-runner')).lastUsedAt).toBeNull();

      await openWithStore().identify(hubRequest(`Bearer ${plain}`));

      expect((await rowOf('ci-runner')).lastUsedAt).toBe(NOW);
    });

    it('stamps once per served request', async () => {
      const { plain } = await store.create('ci-runner', 'octocat');
      const stamped: string[] = [];
      const counting: HubKeyStore = { ...store, stampUse: async (name) => {
        stamped.push(name);
        await store.stampUse(name);
      } };
      const identity = openApiKeyIdentity({ variables: [FIRST], env: ENV, store: counting });

      await identity.identify(hubRequest(`Bearer ${plain}`));
      await identity.identify(hubRequest(`Bearer ${plain}`));
      await identity.identify(hubRequest(`Bearer ${UNKNOWN_KEY}`));

      expect(stamped).toEqual(['ci-runner', 'ci-runner']);
    });

    it('refuses a paused key as forbidden, naming the key and not the bearer', async () => {
      const { plain } = await store.create('ci-runner', 'octocat');
      const identity = openWithStore();
      expect(outcomeOf(await identity.identify(hubRequest(`Bearer ${plain}`)))).toBe('served');
      await store.pause('ci-runner');

      const answer = await identity.identify(hubRequest(`Bearer ${plain}`));
      if (answer.served) throw new Error('expected a refusal and the request was served');

      expect(answer.refusal.reason).toBe('forbidden');
      expect(answer.refusal.message).toContain('ci-runner');
      expect(answer.refusal.message).not.toContain(plain.slice(5, 17));
    });

    it('stamps no paused key', async () => {
      const { plain } = await store.create('ci-runner', 'octocat');
      await store.pause('ci-runner');

      await openWithStore().identify(hubRequest(`Bearer ${plain}`));

      expect((await rowOf('ci-runner')).lastUsedAt).toBeNull();
    });

    it('refuses a deleted key as unauthenticated, naming neither the key nor the bearer', async () => {
      const { plain } = await store.create('ci-runner', 'octocat');
      const identity = openWithStore();
      expect(outcomeOf(await identity.identify(hubRequest(`Bearer ${plain}`)))).toBe('served');
      await store.delete('ci-runner');

      const answer = await identity.identify(hubRequest(`Bearer ${plain}`));
      if (answer.served) throw new Error('expected a refusal and the request was served');

      expect(answer.refusal.reason).toBe('unauthenticated');
      expect(answer.refusal.message).not.toContain('ci-runner');
      expect(answer.refusal.message).not.toContain(plain.slice(5, 17));
    });

    it('refuses a deleted key with the message an unknown one gets', async () => {
      const { plain } = await store.create('ci-runner', 'octocat');
      await store.delete('ci-runner');
      const identity = openWithStore();

      const answers = await Promise.all([plain, UNKNOWN_KEY].map((key) => identity.identify(hubRequest(`Bearer ${key}`))));

      expect(answers.map(outcomeOf)).toEqual(['unauthenticated', 'unauthenticated']);
      expect(answers[0]).toEqual(answers[1]);
    });

    it('refuses a prefix of a store key as unauthenticated', async () => {
      const { plain } = await store.create('ci-runner', 'octocat');

      const answer = await openWithStore().identify(hubRequest(`Bearer ${plain.slice(0, -1)}`));

      expect(outcomeOf(answer)).toBe('unauthenticated');
    });

    it('names the key list as well as hub.auth.apiKeys in an unauthenticated refusal', async () => {
      const answer = await openWithStore().identify(hubRequest(`Bearer ${UNKNOWN_KEY}`));
      if (answer.served) throw new Error('expected a refusal and the request was served');

      expect(answer.refusal.message).toContain('hub.auth.apiKeys');
      expect(answer.refusal.message).toContain('key list');
    });

    it('serves a bootstrap key beside the store, under its variable, without asking the store', async () => {
      let asked = 0;
      const watched: HubKeyStore = { ...store, findByDigest: async (digest) => {
        asked += 1;
        return await store.findByDigest(digest);
      } };
      const identity = openApiKeyIdentity({ variables: [FIRST], env: ENV, store: watched });

      const answer = await identity.identify(hubRequest(`Bearer ${FIRST_KEY}`));

      expect(answer.served && answer.caller.id).toBe(FIRST);
      expect(asked).toBe(0);
    });

    it('asks the store for a bearer no bootstrap key equals, as a control on the case above', async () => {
      let asked = 0;
      const watched: HubKeyStore = { ...store, findByDigest: async (digest) => {
        asked += 1;
        return await store.findByDigest(digest);
      } };
      const identity = openApiKeyIdentity({ variables: [FIRST], env: ENV, store: watched });

      await identity.identify(hubRequest(`Bearer ${UNKNOWN_KEY}`));

      expect(asked).toBe(1);
    });

    it('answers unavailable, resolving, when the store rejects', async () => {
      const broken: HubKeyStore = { ...store, findByDigest: () => Promise.reject(new Error(`disk gone under ${UNKNOWN_KEY}`)) };
      const identity = openApiKeyIdentity({ variables: [FIRST], env: ENV, store: broken });

      const answer = await identity.identify(hubRequest(`Bearer ${UNKNOWN_KEY}`));
      if (answer.served) throw new Error('expected a refusal and the request was served');

      expect(answer.refusal.reason).toBe('unavailable');
      expect(answer.refusal.message).not.toContain(UNKNOWN_KEY);
    });

    it('answers unavailable when the stamp rejects', async () => {
      const { plain } = await store.create('ci-runner', 'octocat');
      const broken: HubKeyStore = { ...store, stampUse: () => Promise.reject(new Error('read-only file')) };
      const identity = openApiKeyIdentity({ variables: [FIRST], env: ENV, store: broken });

      expect(outcomeOf(await identity.identify(hubRequest(`Bearer ${plain}`)))).toBe('unavailable');
    });
  });
});
