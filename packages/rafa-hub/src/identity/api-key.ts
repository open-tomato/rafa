/**
 * The API-key identity adapter: the {@link HubIdentity} `hub.auth.adapter:
 * api-key` picks, for a hub a solo developer runs beside their own
 * checkout, or any hub whose callers hold a key rather than a GitHub
 * login. It asks nothing outside the process but the key store it may
 * be opened with.
 *
 * ## Where the keys come from
 *
 * Two places, asked in this order:
 *
 *   - **The bootstrap keys.** `hub.auth.apiKeys` names environment
 *     variables, never values (the config reader refuses a value that is
 *     no variable name). The adapter reads each named variable once,
 *     when it is opened, and keeps only the SHA-256 digest of its value:
 *     a variable changed or unset after that changes nothing until the
 *     hub is started again. A named variable that is unset, or set to
 *     the empty string, refuses the open with a {@link HubConfigError}
 *     naming the variable and never its value, so the hub does not start
 *     serving a key list shorter than its config.
 *   - **The key store.** When opened with a {@link HubKeyStore}, a
 *     bearer no bootstrap key equals is looked up in it by its digest
 *     ({@link keyDigest}) on every request, never cached, so a key
 *     created, paused or deleted is answered so from the next request on.
 *
 * ## What it serves
 *
 * A request whose `Authorization` is `Bearer <key>` (the scheme word in
 * any case) is served with every hub action when `<key>` equals the
 * value of one named variable, the caller named by that variable, or
 * the key of a store row neither paused nor deleted, the caller named
 * by the row's name. A served store key is stamped as used
 * ({@link HubKeyStore.stampUse}) before the answer, once per request; a
 * bootstrap key has no row and is stamped nowhere.
 *
 * ## What it refuses
 *
 *   - **`forbidden`:** a paused store key, the message naming the key's
 *     name, so its holder knows which key to ask about. It is not stamped.
 *   - **`unauthenticated`:** every other request: no header, another
 *     scheme, a deleted store key, or a bearer equal to no key, a prefix
 *     of one or one with a character more included. Its message is the
 *     same whatever the request carried, so a deleted key reads as an
 *     unknown one.
 *   - **`unavailable`:** a store lookup or stamp that rejected, since the
 *     adapter could not decide the request; the message names the store
 *     and nothing the request carried. Without a store nothing it is
 *     asked can be `unavailable`.
 *
 * ## How it compares
 *
 * A bootstrap key is never compared with `===`, which returns at the
 * first byte that differs and so tells a caller timing it how much of a
 * key they hold. The bearer's SHA-256 digest is compared with every
 * key's by `timingSafeEqual`, two buffers of the same 32 bytes whatever
 * the bearer's length, and every key is compared whichever matches, so
 * neither the length of a guess nor its position in the list shows in
 * the time taken. A store lookup goes by the digest alone, which leaks
 * no prefix of any key: how much of a stored digest a guess's digest
 * shares tells nothing of the key, since the digest of a random key
 * tells nothing about the key.
 *
 * ## What it never does
 *
 * It never reads the request's body, and no refusal message repeats the
 * bearer, a key or a digest: the `unauthenticated` one names
 * `hub.auth.apiKeys` (and the key list, under a store), the `forbidden`
 * one the key's name alone.
 */
import type { HubKeyStore } from './key-store.js';
import type { HubAction, HubIdentity, IdentityAnswer, IdentityRefusalReason } from './port.js';

import { createHash, timingSafeEqual } from 'node:crypto';

import { HubConfigError } from '../config.js';

import { keyDigest } from './key-store.js';
import { HUB_ACTIONS } from './port.js';

/** The provider a served caller is named under, as `hub.auth.adapter` spells it. */
export const API_KEY_PROVIDER = 'api-key';

/** How a key is written in `Authorization`: `Bearer`, in any case, then the key. */
const BEARER = /^bearer +(.+)$/i;

/** A served caller may take every hub action. */
const EVERY_ACTION: readonly HubAction[] = Object.freeze([...HUB_ACTIONS]);

/** What a refused request is told when no store is open, the same whatever it carried. */
const UNAUTHENTICATED = 'Send a key that a variable named by hub.auth.apiKeys holds, as Authorization: Bearer.';

/** What a refused request is told under a store, the same whatever it carried. */
const UNAUTHENTICATED_UNDER_STORE = 'Send a key that a variable named by hub.auth.apiKeys holds, or one the hub\'s key list holds and has not deleted, as Authorization: Bearer.';

/** What a request is told when the key store did not answer. */
const STORE_UNAVAILABLE = 'The hub\'s key store did not answer; try again, and tell whoever runs the hub if it goes on.';

/** What {@link openApiKeyIdentity} is opened with. */
export interface ApiKeyIdentityOptions {
  /** `hub.auth.apiKeys`: the environment variables holding the keys, at least one. */
  readonly variables: readonly string[];
  /** The environment the variables are read from, once; `process.env` when left out. */
  readonly env?: Readonly<Record<string, string | undefined>>;
  /**
   * The key store a bearer no bootstrap key equals is looked up in, on
   * every request; left out, the bootstrap keys are the only keys.
   */
  readonly store?: HubKeyStore;
}

/** One key the adapter serves: the variable that held it, and its digest. */
interface HeldKey {
  readonly variable: string;
  readonly digest: Buffer;
}

/** The SHA-256 digest of `text`, 32 bytes whatever its length. */
function digestOf(text: string): Buffer {
  return createHash('sha256')
    .update(text)
    .digest();
}

/**
 * The key a variable holds, or the problem that refuses the open: one
 * sentence opening with the variable, never repeating a value.
 */
function readKey(variable: string, env: Readonly<Record<string, string | undefined>>): HeldKey | string {
  const value = env[variable];
  if (value === undefined) return `${variable} is unset; hub.auth.apiKeys names it, so set it to a key before starting the hub`;
  if (value === '') return `${variable} is empty; hub.auth.apiKeys names it, so set it to a key before starting the hub`;
  return { variable, digest: digestOf(value) };
}

/**
 * The variable whose key `bearer` equals, or undefined. Every key is
 * compared, whichever matches, so the time taken does not tell which.
 */
function matchOf(keys: readonly HeldKey[], bearer: string): string | undefined {
  const digest = digestOf(bearer);
  let matched: string | undefined;
  for (const key of keys) {
    const equal = timingSafeEqual(digest, key.digest);
    if (equal && matched === undefined) matched = key.variable;
  }
  return matched;
}

/** A refusal answer. */
function refused(reason: IdentityRefusalReason, message: string): IdentityAnswer {
  return { served: false, refusal: { reason, message } };
}

/** A served answer, naming `id` under {@link API_KEY_PROVIDER}. */
function served(id: string): IdentityAnswer {
  return { served: true, caller: { id, provider: API_KEY_PROVIDER }, may: EVERY_ACTION };
}

/**
 * The answer `store` gives for `bearer`: served and stamped for a live
 * key, `forbidden` naming a paused one, `unauthenticated` for a deleted
 * or unknown one, and `unavailable` when the store rejected.
 */
async function storeAnswer(store: HubKeyStore, bearer: string): Promise<IdentityAnswer> {
  try {
    const key = await store.findByDigest(keyDigest(bearer));
    if (key === undefined || key.deleted) return refused('unauthenticated', UNAUTHENTICATED_UNDER_STORE);
    if (key.paused) {
      return refused('forbidden', `Key ${key.name} is paused, so the hub serves nothing it sends; create another key, or ask whoever runs the hub.`);
    }
    await store.stampUse(key.name);
    return served(key.name);
  } catch {
    return refused('unavailable', STORE_UNAVAILABLE);
  }
}

/**
 * Opens the API-key adapter, reading every variable `options.variables`
 * names now and never again, and asking `options.store`, when given, on
 * every request no bootstrap key serves.
 *
 * @throws {HubConfigError} When `variables` is empty, or when a variable
 *   it names is unset or empty, with one problem per such variable.
 */
export function openApiKeyIdentity(options: ApiKeyIdentityOptions): HubIdentity {
  const env = options.env ?? process.env;
  if (options.variables.length === 0) {
    throw new HubConfigError(['hub.auth.apiKeys: names no variable; expected at least one environment variable name']);
  }
  const read = options.variables.map((variable) => readKey(variable, env));
  const problems = read.filter((entry): entry is string => typeof entry === 'string');
  if (problems.length > 0) throw new HubConfigError(problems);

  const keys = Object.freeze(read.filter((entry): entry is HeldKey => typeof entry !== 'string'));
  const { store } = options;
  const unauthenticated = store === undefined
    ? UNAUTHENTICATED
    : UNAUTHENTICATED_UNDER_STORE;

  const identify = async (request: Request): Promise<IdentityAnswer> => {
    const bearer = BEARER.exec(request.headers.get('authorization') ?? '')?.[1];
    if (bearer === undefined) return refused('unauthenticated', unauthenticated);
    const variable = matchOf(keys, bearer);
    if (variable !== undefined) return served(variable);
    if (store === undefined) return refused('unauthenticated', unauthenticated);
    return await storeAnswer(store, bearer);
  };

  return { identify };
}
