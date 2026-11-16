/**
 * The API-key identity adapter (`api-key.ts`): the port's contract
 * suite, registered with `{ forbids: false }` since every key the
 * adapter knows is served, then what is the adapter's own. That covers
 * a bearer near a key refused (a prefix, a character more), a second
 * listed key served, the variables read once when opened, and an open
 * refused over a variable unset or empty.
 *
 * Every case hands the adapter an environment of its own, a record
 * rather than `process.env`, so no case sets a variable another reads.
 */
import type { IdentityAnswer } from './port.js';

import { describe, expect, it } from 'bun:test';

import { HubConfigError } from '../config.js';

import { API_KEY_PROVIDER, openApiKeyIdentity } from './api-key.js';
import { identityContract } from './contract.js';
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
});
