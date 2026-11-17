/**
 * The login that guards the hub's key routes: {@link HubLogin} is the
 * port those routes ask, and {@link openBasicLogin} its `basic` adapter,
 * the one `hub.auth.login.mode: basic` (the default) picks, checking
 * `Authorization: Basic` against the {@link HubLoginStore}.
 *
 * ## The port
 *
 * A login is handed the whole `Request`, as an identity adapter is, so
 * a login reading a cookie (the OAuth one beside this file) fits the
 * same port, and answers from it alone:
 *
 *   - **Served:** `{ served: true, user }`, the user who signed in.
 *   - **Refused:** a {@link LoginRefusal}, whose reason tells a request
 *     that proved nothing (`unauthenticated`) from one the login could
 *     not decide because its store did not answer (`unavailable`). Its
 *     `headers` are what the route answers beside its 401 or 503, such
 *     as a challenge; its message is safe to show and to log and never
 *     repeats a credential the request carried.
 *
 * The key routes ask the login; the identity port never does, so a
 * login never serves `/v1/status` or the sync routes. A login reads the
 * request's headers, never its body, and `check` resolves with a
 * refusal rather than rejecting.
 *
 * ## What the basic login serves
 *
 * A request whose `Authorization` is `Basic <base64 of user:password>`
 * (the scheme word in any case, RFC 7617) when a login is set and
 * {@link HubLoginStore.verifyLogin} answers true for the pair. The pair
 * splits at its first colon, so a password may hold one and a user name
 * may not; the bytes decode as UTF-8.
 *
 * ## What it refuses
 *
 *   - **`unauthenticated`, with the challenge:** no login set, no
 *     header, another scheme, a value that is not base64 or not UTF-8,
 *     a pair with no colon or an empty half, and credentials the store
 *     does not verify. Each answers {@link BASIC_CHALLENGE} as
 *     `WWW-Authenticate`, so a browser asks for the login again. With
 *     no login set, the message says how to set one and the store is
 *     not asked to verify; otherwise it is the same whatever the
 *     request carried, so a wrong user name reads as a wrong password.
 *   - **`unavailable`, with no challenge:** a store call that rejected,
 *     since asking the person again would not help; the message names
 *     the store and nothing the request carried.
 */
import type { HubLoginMode } from '../config-login.js';
import type { HubLoginStore } from '../identity/login-store.js';

import { LOGIN_PASSWORD_VARIABLE, LOGIN_USER_VARIABLE } from '../identity/login-store.js';

/** The challenge a refused basic login answers as `WWW-Authenticate`. */
export const BASIC_CHALLENGE = 'Basic realm="rafa-hub login"';

/** Why a login refused a request; the route answers 401 and 503 in this order. */
export type LoginRefusalReason = 'unauthenticated' | 'unavailable';

/** A refused login. */
export interface LoginRefusal {
  readonly reason: LoginRefusalReason;
  /** One line a person can act on, never repeating the request's credential. */
  readonly message: string;
  /** The headers the route answers beside the refusal, such as `WWW-Authenticate`; often none. */
  readonly headers: Readonly<Record<string, string>>;
}

/** A served login: the user who signed in. */
export interface LoginServed {
  readonly served: true;
  /** The user name, or the provider's user id under OAuth. */
  readonly user: string;
}

/** A refused login, holding no user. */
export interface LoginRefused {
  readonly served: false;
  readonly refusal: LoginRefusal;
}

/** What a login answers for one request. */
export type LoginAnswer = LoginServed | LoginRefused;

/** The login port the key routes ask; the identity port never does. */
export interface HubLogin {
  /** How this login is checked, as `hub.auth.login.mode` spells it. */
  readonly mode: HubLoginMode;
  /** Answers who signed in with `request`, or why they are refused. */
  readonly check: (request: Request) => Promise<LoginAnswer>;
}

/** What {@link openBasicLogin} is opened with. */
export interface BasicLoginOptions {
  /** The store the login's user name and password hash are kept in. */
  readonly store: HubLoginStore;
}

/** How a pair is written in `Authorization`: `Basic`, in any case, then the base64 token. */
const BASIC = /^basic +(\S+) *$/i;

/** A base64 token: the standard alphabet, padded to a whole number of quads. */
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

/** What a refused request is told when a login is set, the same whatever it carried. */
const UNAUTHENTICATED = 'Sign in with the hub\'s login user name and password, as Authorization: Basic.';

/** What a request is told when no login is set yet. */
const NO_LOGIN = `No login is set on this hub; set one with rafa-hub login, or with ${LOGIN_USER_VARIABLE} and ${LOGIN_PASSWORD_VARIABLE} at start.`;

/** What a request is told when the login store did not answer. */
const STORE_UNAVAILABLE = 'The hub\'s login store did not answer; try again, and tell whoever runs the hub if it goes on.';

/** The headers every `unauthenticated` refusal of the basic login answers. */
const CHALLENGE_HEADERS: Readonly<Record<string, string>> = Object.freeze({ 'WWW-Authenticate': BASIC_CHALLENGE });

/** Decodes UTF-8, refusing bytes that are not. */
const UTF8 = new TextDecoder('utf-8', { fatal: true });

/** A user name and password read from a request. */
interface Pair {
  readonly user: string;
  readonly password: string;
}

/** A refusal answer. */
function refused(reason: LoginRefusalReason, message: string, headers: Readonly<Record<string, string>>): LoginAnswer {
  return { served: false, refusal: { reason, message, headers } };
}

/** The `unauthenticated` refusal, with the challenge. */
function challenged(message: string): LoginAnswer {
  return refused('unauthenticated', message, CHALLENGE_HEADERS);
}

/** The text a base64 token spells, or undefined when it is not base64 of UTF-8. */
function decodeToken(token: string): string | undefined {
  if (!BASE64.test(token)) return undefined;
  try {
    return UTF8.decode(Buffer.from(token, 'base64'));
  } catch {
    return undefined;
  }
}

/** The pair `header` carries, or undefined when it carries none the login reads. */
function pairOf(header: string | null): Pair | undefined {
  const token = BASIC.exec(header ?? '')?.[1];
  if (token === undefined) return undefined;
  const text = decodeToken(token);
  if (text === undefined) return undefined;
  const colon = text.indexOf(':');
  if (colon <= 0 || colon === text.length - 1) return undefined;
  return { user: text.slice(0, colon), password: text.slice(colon + 1) };
}

/**
 * Opens the basic login over `options.store`, asked on every request,
 * never cached, so a login set or changed is checked so from the next
 * request on.
 */
export function openBasicLogin(options: BasicLoginOptions): HubLogin {
  const { store } = options;

  const check = async (request: Request): Promise<LoginAnswer> => {
    const pair = pairOf(request.headers.get('authorization'));
    try {
      if (!(await store.hasLogin())) return challenged(NO_LOGIN);
      if (pair === undefined) return challenged(UNAUTHENTICATED);
      const verified = await store.verifyLogin(pair.user, pair.password);
      return verified
        ? { served: true, user: pair.user }
        : challenged(UNAUTHENTICATED);
    } catch {
      return refused('unavailable', STORE_UNAVAILABLE, {});
    }
  };

  return { mode: 'basic', check };
}
