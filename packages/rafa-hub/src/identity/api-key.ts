/**
 * The API-key identity adapter: the {@link HubIdentity} `hub.auth.adapter:
 * api-key` picks, for a hub a solo developer runs beside their own
 * checkout, or any hub whose callers hold a key rather than a GitHub
 * login. It asks nothing outside the process.
 *
 * ## Where the keys come from
 *
 * `hub.auth.apiKeys` names environment variables, never values (the
 * config reader refuses a value that is no variable name). The adapter
 * reads each named variable once, when it is opened, and keeps only the
 * SHA-256 digest of its value: a variable changed or unset after that
 * changes nothing until the hub is started again. A named variable that
 * is unset, or set to the empty string, refuses the open with a
 * {@link HubConfigError} naming the variable and never its value, so
 * the hub does not start serving a key list shorter than its config.
 *
 * ## What it serves
 *
 * A request whose `Authorization` is `Bearer <key>` (the scheme word in
 * any case), with `<key>` equal to the value of one named variable, is
 * served with every hub action, the caller named by that variable. Any
 * other request, no header, another scheme, or a bearer equal to no
 * key, a prefix of one or one with a character more included, is
 * refused `unauthenticated`. The scheme knows no caller it refuses as
 * `forbidden`, and nothing it is asked can be `unavailable`.
 *
 * ## How it compares
 *
 * Never with `===`, which returns at the first byte that differs and so
 * tells a caller timing it how much of a key they hold. The bearer's
 * SHA-256 digest is compared with every key's by `timingSafeEqual`,
 * two buffers of the same 32 bytes whatever the bearer's length, and
 * every key is compared whichever matches, so neither the length of a
 * guess nor its position in the list shows in the time taken.
 *
 * ## What it never does
 *
 * It never reads the request's body, and no refusal message repeats the
 * bearer or a key: each one names `hub.auth.apiKeys` and nothing the
 * request carried.
 */
import type { HubAction, HubIdentity, IdentityAnswer } from './port.js';

import { createHash, timingSafeEqual } from 'node:crypto';

import { HubConfigError } from '../config.js';

import { HUB_ACTIONS } from './port.js';

/** The provider a served caller is named under, as `hub.auth.adapter` spells it. */
export const API_KEY_PROVIDER = 'api-key';

/** How a key is written in `Authorization`: `Bearer`, in any case, then the key. */
const BEARER = /^bearer +(.+)$/i;

/** A served caller may take every hub action. */
const EVERY_ACTION: readonly HubAction[] = Object.freeze([...HUB_ACTIONS]);

/** What a refused request is told, the same whatever it carried. */
const UNAUTHENTICATED = 'Send a key that a variable named by hub.auth.apiKeys holds, as Authorization: Bearer.';

/** What {@link openApiKeyIdentity} is opened with. */
export interface ApiKeyIdentityOptions {
  /** `hub.auth.apiKeys`: the environment variables holding the keys, at least one. */
  readonly variables: readonly string[];
  /** The environment the variables are read from, once; `process.env` when left out. */
  readonly env?: Readonly<Record<string, string | undefined>>;
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

/**
 * Opens the API-key adapter, reading every variable `options.variables`
 * names now and never again.
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

  const identify = (request: Request): Promise<IdentityAnswer> => {
    const bearer = BEARER.exec(request.headers.get('authorization') ?? '')?.[1];
    const variable = bearer === undefined
      ? undefined
      : matchOf(keys, bearer);
    const answer: IdentityAnswer = variable === undefined
      ? { served: false, refusal: { reason: 'unauthenticated', message: UNAUTHENTICATED } }
      : { served: true, caller: { id: variable, provider: API_KEY_PROVIDER }, may: EVERY_ACTION };
    return Promise.resolve(answer);
  };

  return { identify };
}
