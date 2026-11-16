/**
 * The identity port's contract suite: the cases every {@link HubIdentity}
 * adapter passes, exported as one function a test calls with a name and
 * a factory, so an adapter written outside this package (hub roles,
 * OAuth, SAML) runs exactly the cases the repository-permission one does.
 *
 * ```ts
 * import { identityContract } from './contract.js';
 *
 * // `openOAuthSubject` stands for any adapter's factory.
 * identityContract('oauth', () => openOAuthSubject());
 * ```
 *
 * ## What a factory hands the suite
 *
 * The suite cannot mint a credential for a scheme it does not know, so a
 * factory answers an {@link IdentityContractSubject}: the adapter, and
 * the headers of three callers, one it serves, one it knows and refuses
 * as forbidden, and one it does not recognise. An adapter asking a
 * provider (GitHub) starts a stand-in for it here and stops it in
 * `close`.
 *
 * ## A scheme with no forbidden caller
 *
 * A scheme that serves every credential it knows, as `api-key` serves
 * every key `hub.auth.apiKeys` names, has no caller to refuse as
 * forbidden. It registers with `{ forbids: false }` and its subject
 * names no `forbidden` headers; the forbidden case is then not
 * registered, so the run lists it neither passed nor failed, and the
 * cases mixing callers mix the other two. A subject at odds with its
 * registration, forbidden headers under `forbids: false` or none
 * without it, fails each case naming the mismatch.
 *
 * ## What it covers
 *
 * The rules `port.ts` lists: a request with no credential or an
 * unrecognised one refused as `unauthenticated`, a known one lacking
 * permission as `forbidden` (under `forbids`), a served one naming a caller and at least
 * one known action, each once. Each request answered from its own
 * credential, whatever was served before and on whichever hub route,
 * its body left unread, and no refusal message repeating the credential.
 * How long a served answer is kept, and what an `unavailable` provider
 * looks like, are the adapter's own and its own suite's.
 *
 * ## Each case's world
 *
 * A fresh subject per case, closed after the case whatever it did.
 */
import type { HubAction, HubIdentity, IdentityAnswer, IdentityRefusalReason } from './port.js';

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { HUB_ACTIONS } from './port.js';

/** Request headers by name, as a subject spells a caller's credential. */
export type CredentialHeaders = Readonly<Record<string, string>>;

/** One adapter under the suite, and the callers it knows. */
export interface IdentityContractSubject {
  readonly identity: HubIdentity;
  /** Headers carrying a credential the adapter serves. */
  readonly served: CredentialHeaders;
  /**
   * Headers carrying a credential the adapter knows and refuses as
   * forbidden; left out by a scheme registered with `forbids: false`.
   */
  readonly forbidden?: CredentialHeaders;
  /** Headers carrying a well-formed credential the adapter does not recognise. */
  readonly unrecognised: CredentialHeaders;
  /** Stops whatever the subject started; the subject is not used after. */
  readonly close?: () => Promise<void>;
}

/** Makes one fresh subject per case. */
export type IdentityContractFactory = () => IdentityContractSubject | Promise<IdentityContractSubject>;

/** How one adapter registers with the suite. */
export interface IdentityContractOptions {
  /**
   * Whether the scheme knows a caller it refuses as forbidden, and so
   * whether its subject names `forbidden` headers; true when left out.
   */
  readonly forbids?: boolean;
}

/** The host every case's requests are sent to; no case opens a connection. */
const HUB = 'http://hub.test';

/** The path and method of each hub route an identity guards. */
const ROUTES: readonly (readonly [string, string])[] = [
  ['GET', '/v1/status'],
  ['POST', '/v1/effort/push'],
  ['GET', '/v1/effort/pull?since=%7B%7D'],
  ['GET', '/v1/settings/locked'],
];

/** The body a push case sends, which identifying must leave unread. */
const PUSH_BODY = JSON.stringify({ device: 'contract-device', payload: {} });

/**
 * The shortest piece of a header value held secret. A credential
 * shorter than this is not looked for in a refusal message, so a
 * scheme word (`Bearer`, `token`) a message may name is not mistaken
 * for one.
 */
const SECRET_MIN_LENGTH = 12;

/** A GET request to `path` carrying `headers`. */
function get(path: string, headers: CredentialHeaders = {}): Request {
  return new Request(`${HUB}${path}`, { headers });
}

/** A push carrying `headers` and {@link PUSH_BODY}. */
function push(headers: CredentialHeaders = {}): Request {
  return new Request(`${HUB}/v1/effort/push`, { method: 'POST', headers, body: PUSH_BODY });
}

/** The reason `answer` was refused for, or `served`. */
function outcomeOf(answer: IdentityAnswer): IdentityRefusalReason | 'served' {
  return answer.served
    ? 'served'
    : answer.refusal.reason;
}

/** The pieces of each header value long enough to be held secret. */
function secretsIn(headers: CredentialHeaders): string[] {
  return Object.values(headers)
    .flatMap((value) => value.split(/[\s;=,]+/))
    .filter((piece) => piece.length >= SECRET_MIN_LENGTH);
}

/** The refusal message of `answer`, failing the case when it was served. */
function messageOf(answer: IdentityAnswer): string {
  if (answer.served) throw new Error('identity contract: expected a refusal and the request was served');
  return answer.refusal.message;
}

/** Why `subject` is at odds with `forbids`, or null when it is not. */
function mismatchOf(subject: IdentityContractSubject, forbids: boolean): string | null {
  if (forbids && subject.forbidden === undefined) {
    return 'identity contract: the subject names no forbidden headers; register with { forbids: false } or name them';
  }
  if (!forbids && subject.forbidden !== undefined) {
    return 'identity contract: the subject names forbidden headers under { forbids: false }; leave them out or drop the option';
  }
  return null;
}

/**
 * Registers the contract's cases for one adapter, under a `describe`
 * naming it. Call it from a test file, once per adapter.
 */
export function identityContract(name: string, factory: IdentityContractFactory, options: IdentityContractOptions = {}): void {
  const forbids = options.forbids ?? true;
  describe(`the identity contract: ${name}`, () => {
    let subject: IdentityContractSubject | undefined;
    const open = (): IdentityContractSubject => {
      if (subject === undefined) throw new Error('identity contract: no subject is open');
      const mismatch = mismatchOf(subject, forbids);
      if (mismatch !== null) throw new Error(mismatch);
      return subject;
    };
    const identify = (request: Request): Promise<IdentityAnswer> => open().identity.identify(request);
    /** The forbidden headers, under `forbids`, where `open` has held they are named. */
    const forbiddenOf = (): CredentialHeaders => open().forbidden ?? {};

    beforeEach(async () => {
      subject = await factory();
    });
    afterEach(async () => {
      const closing = subject;
      subject = undefined;
      await closing?.close?.();
    });

    describe('a refused request', () => {
      it('refuses a request carrying no credential as unauthenticated', async () => {
        const answer = await identify(get('/v1/status'));

        expect(outcomeOf(answer)).toBe('unauthenticated');
      });

      it('refuses a credential it does not recognise as unauthenticated', async () => {
        const answer = await identify(get('/v1/status', open().unrecognised));

        expect(outcomeOf(answer)).toBe('unauthenticated');
      });

      if (forbids) {
        it('refuses a known credential lacking permission as forbidden', async () => {
          const answer = await identify(get('/v1/status', forbiddenOf()));

          expect(outcomeOf(answer)).toBe('forbidden');
        });
      }

      it('says why in one line naming no credential the request carried', async () => {
        const { unrecognised } = open();
        const callers: readonly CredentialHeaders[] = forbids
          ? [{}, unrecognised, forbiddenOf()]
          : [{}, unrecognised];
        for (const headers of callers) {
          const message = messageOf(await identify(get('/v1/status', headers)));
          expect(message.trim()).not.toBe('');
          expect(message).not.toContain('\n');
          expect(secretsIn(headers).filter((secret) => message.includes(secret))).toEqual([]);
        }
      });
    });

    describe('a served request', () => {
      it('names a caller and the hub actions it may take, at least one, each once', async () => {
        const answer = await identify(get('/v1/status', open().served));
        if (!answer.served) throw new Error(`identity contract: the served credential was refused: ${answer.refusal.message}`);
        const known: readonly string[] = HUB_ACTIONS;

        expect(answer.caller.id.trim()).not.toBe('');
        expect(answer.caller.provider.trim()).not.toBe('');
        expect(answer.may.length).toBeGreaterThan(0);
        expect(answer.may.filter((action) => !known.includes(action))).toEqual([]);
        expect(new Set<HubAction>(answer.may).size).toBe(answer.may.length);
      });

      it('answers the same caller and actions each time it is asked', async () => {
        const first = await identify(get('/v1/status', open().served));
        const second = await identify(get('/v1/status', open().served));

        expect(second).toEqual(first);
      });

      it('answers the same on every hub route and method', async () => {
        const { served } = open();
        const answers = await Promise.all(ROUTES.map(([method, path]) => identify(method === 'POST'
          ? push(served)
          : get(path, served))));

        expect(answers.map(outcomeOf)).toEqual(ROUTES.map(() => 'served'));
        expect(answers.filter((answer) => JSON.stringify(answer) !== JSON.stringify(answers[0]))).toEqual([]);
      });
    });

    describe('one request, one answer', () => {
      it('answers each request from its own credential, whatever was served before', async () => {
        const { served, unrecognised } = open();
        const callers: readonly (readonly [CredentialHeaders, IdentityRefusalReason | 'served'])[] = [
          [served, 'served'],
          [{}, 'unauthenticated'],
          [served, 'served'],
          [unrecognised, 'unauthenticated'],
          [served, 'served'],
          ...(forbids
            ? [[forbiddenOf(), 'forbidden'], [served, 'served']] as const
            : []),
        ];
        const outcomes: (IdentityRefusalReason | 'served')[] = [];
        for (const [headers] of callers) {
          outcomes.push(outcomeOf(await identify(get('/v1/status', headers))));
        }

        expect(outcomes).toEqual(callers.map(([, outcome]) => outcome));
      });

      it('leaves the request body unread, served or refused', async () => {
        const { served, unrecognised } = open();
        const requests = forbids
          ? [push(served), push(forbiddenOf()), push()]
          : [push(served), push(unrecognised), push()];
        for (const request of requests) await identify(request);

        expect(requests.map((request) => request.bodyUsed)).toEqual([false, false, false]);
        expect(await Promise.all(requests.map((request) => request.text()))).toEqual([PUSH_BODY, PUSH_BODY, PUSH_BODY]);
      });
    });
  });
}
