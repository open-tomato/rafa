/**
 * The OAuth login: the {@link HubLogin} adapter `hub.auth.login.mode:
 * oauth` picks, handing the sign-in to the provider `hub.auth.login.oauth`
 * names through the authorization-code flow, and keeping who signed in
 * in an in-memory session behind a cookie.
 *
 * ## The flow
 *
 *   1. **Start** ({@link OAuthLogin.start}): a fresh state of
 *      {@link OAUTH_STATE_BYTES} random bytes in base64url is held as
 *      pending, and the person is sent to `authorizeUrl` with the client
 *      id, the callback URL as `redirect_uri`, the state and, when
 *      written, the scope.
 *   2. **Callback** ({@link OAuthLogin.callback}): the state is checked
 *      first, before anything else the request carries is read and
 *      before the provider is asked. A state is used once, whatever its
 *      callback then answers, and expires {@link OAUTH_STATE_TTL_MS}
 *      (ten minutes) after its start. Then the code is exchanged at
 *      `tokenUrl` (a form `POST` holding the client id and secret, and the
 *      same `redirect_uri`), the token's user is looked up at `userUrl`
 *      (`Authorization: Bearer`), and the user's id is checked against
 *      `allowed`. An allowed user gets a session and its cookie.
 *   3. **Check** ({@link OAuthLogin.check}, the port's call): a request
 *      carrying a live session's cookie is served as its user.
 *   4. **Logout** ({@link OAuthLogin.logout}): the session ends and the
 *      cookie is cleared.
 *
 * ## Readings the spec leaves to this module
 *
 *   - **The user id** is the user lookup's `id` (GitHub's field), or its
 *     `sub` (OpenID Connect's) when it holds no `id`: text with no white
 *     space at either end, or a whole number read as its decimal digits,
 *     as `allowed` reads one.
 *   - **The client secret** is read once, at open, from the variable
 *     `clientSecretVariable` names; open throws, naming the variable and
 *     never a value, when it is unset or empty, so a hub that cannot
 *     finish a login does not start.
 *   - **The callback URL** is `callbackUrl` when the opener passes one,
 *     then `hub.auth.login.oauth.callbackUrl` when written, and otherwise
 *     {@link OAUTH_CALLBACK_PATH} on the start request's origin. The
 *     provider checks it against the client's registered callback, so a
 *     hub behind a reverse proxy or a TLS terminator, whose start
 *     requests carry the proxy's internal origin, writes the public one
 *     in its config; that is also what makes its cookie `Secure`.
 *   - **Pending states** are held by their SHA-256 digest, at most
 *     {@link MAX_PENDING_OAUTH_STATES} at once: an expired one is dropped
 *     at the next start, and the oldest one when the cap is reached, so
 *     starts sent by anyone cannot grow the hub's memory without bound.
 *     A state dropped so is refused as unknown rather than as expired.
 *   - **Sessions** are held by their digest too, for
 *     {@link DEFAULT_OAUTH_SESSION_TTL_MS} (eight hours) unless the opener
 *     passes another, in memory alone: a restart signs everyone out. The
 *     cookie is {@link OAUTH_SESSION_COOKIE}, `Path=/; HttpOnly;
 *     SameSite=Strict` with a `Max-Age` of the session's life, and
 *     `Secure` when the callback URL is `https:`.
 *   - **Provider calls** send `Accept: application/json`, follow no
 *     redirect and give up after `timeoutMs`
 *     ({@link DEFAULT_OAUTH_TIMEOUT_MS} by default).
 *
 * ## What the callback refuses
 *
 *   - **`unauthenticated`:** no state, an unknown or used one, an
 *     expired one, a provider that answered `error` (the person refused
 *     the grant), no code, or a code the provider did not accept: a
 *     token answer of `400` or `401`, or a `2xx` holding `error`, as
 *     GitHub answers a bad code.
 *   - **`forbidden`:** a user whose id `allowed` does not list; the
 *     message names the id, so whoever runs the hub can add it.
 *   - **`unavailable`:** a provider that did not answer, answered a
 *     status other than the ones above, refused the hub's client id or
 *     secret (`invalid_client`), or answered a body naming no token or no
 *     user id.
 *
 * No message repeats the state, the code, the token, the secret, the
 * session or any text the provider answered; a status is named by its
 * number alone. `check` refuses `unauthenticated`, with no headers, a
 * request carrying no live session.
 */
import type { HubLogin, LoginAnswer, LoginRefusalReason } from './basic.js';
import type { HubLoginOAuth } from '../config-login.js';

import { createHash, randomBytes } from 'node:crypto';

/** How many random bytes a state and a session id hold. */
export const OAUTH_STATE_BYTES: number = 32;

/** How long a state is accepted after its start: ten minutes. */
export const OAUTH_STATE_TTL_MS: number = 600_000;

/** How many states may be pending at once. */
export const MAX_PENDING_OAUTH_STATES: number = 1024;

/** How long a session lasts when `sessionTtlMs` is left out: eight hours. */
export const DEFAULT_OAUTH_SESSION_TTL_MS: number = 28_800_000;

/** How long one provider call may take when `timeoutMs` is left out. */
export const DEFAULT_OAUTH_TIMEOUT_MS: number = 10_000;

/** The session cookie's name. */
export const OAUTH_SESSION_COOKIE: string = 'rafa_hub_login';

/** The callback's path, on the start request's origin when no `callbackUrl` is passed or written. */
export const OAUTH_CALLBACK_PATH: string = '/login/oauth/callback';

/** What {@link openOAuthLogin} is opened with. */
export interface OAuthLoginOptions {
  /** The provider, as `hub.auth.login.oauth` resolved. */
  readonly config: HubLoginOAuth;
  /** Where the client secret's variable is read; `process.env` when left out. */
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** The callback URL sent as `redirect_uri`, over `config.callbackUrl`; derived from each start request when both are left out. */
  readonly callbackUrl?: string;
  /** The clock, in milliseconds; `Date.now` when left out. */
  readonly now?: () => number;
  /** How long a session lasts, in milliseconds. */
  readonly sessionTtlMs?: number;
  /** How long one provider call may take, in milliseconds. */
  readonly timeoutMs?: number;
}

/** Where {@link OAuthLogin.start} sends the person. */
export interface OAuthStarted {
  /** The provider's authorize URL, holding the client id, callback, state and scope. */
  readonly location: string;
}

/** Why a callback was refused; the route answers 401, 403 and 503 in this order. */
export type OAuthCallbackRefusalReason = LoginRefusalReason | 'forbidden';

/** A refused callback. */
export interface OAuthCallbackRefusal {
  readonly reason: OAuthCallbackRefusalReason;
  /** One line a person can act on, repeating nothing the request or the provider sent. */
  readonly message: string;
}

/** What {@link OAuthLogin.callback} answers. */
export type OAuthCallbackAnswer =
  | { readonly served: true; readonly user: string; readonly headers: Readonly<Record<string, string>> }
  | { readonly served: false; readonly refusal: OAuthCallbackRefusal };

/** What {@link OAuthLogin.logout} answers: the headers clearing the cookie. */
export interface OAuthLoggedOut {
  readonly headers: Readonly<Record<string, string>>;
}

/** The OAuth login: the port's `check`, and the three steps its routes call. */
export interface OAuthLogin extends HubLogin {
  readonly mode: 'oauth';
  /** Starts a flow, holding a fresh state, and answers where to send the person. */
  readonly start: (request: Request) => OAuthStarted;
  /** Finishes the flow `request` returns from, answering the session cookie or a refusal. */
  readonly callback: (request: Request) => Promise<OAuthCallbackAnswer>;
  /** Ends the session `request` carries, if any, and answers the cleared cookie. */
  readonly logout: (request: Request) => OAuthLoggedOut;
}

/** A state started and not yet used. */
interface Pending {
  readonly startedAt: number;
  readonly callbackUrl: string;
}

/** A session: who signed in, and until when. */
interface Session {
  readonly user: string;
  readonly expiresAt: number;
}

/** What one provider call answered, or why it did not. */
type Asked =
  | { readonly answered: true; readonly status: number; readonly body: unknown }
  | { readonly answered: false; readonly detail: string };

/** A state or session id as minted: base64url of {@link OAUTH_STATE_BYTES} bytes. */
const TOKEN = /^[A-Za-z0-9_-]{43}$/;

/** How every `unauthenticated` callback refusal ends. */
const RESTART = 'start again at /login.';
const STATE_UNKNOWN = `This sign-in is not one the hub started, or was finished already; ${RESTART}`;
const STATE_EXPIRED = `This sign-in was started more than ten minutes ago; ${RESTART}`;
const DENIED = `The provider did not grant the sign-in; ${RESTART}`;
const NO_CODE = `The provider sent back no code; ${RESTART}`;
const CODE_REFUSED = `The provider did not accept the sign-in code; ${RESTART}`;

/** What `check` answers a request carrying no live session. */
const NO_SESSION_ANSWER: LoginAnswer = Object.freeze({
  served: false,
  refusal: Object.freeze({ reason: 'unauthenticated', message: 'Sign in at /login through the hub\'s OAuth provider.', headers: Object.freeze({}) }),
});

/** The SHA-256 digest a state or session is held by. */
function digestOf(token: string): string {
  return createHash('sha256')
    .update(token)
    .digest('hex');
}

/** A fresh state or session id. */
function mintToken(): string {
  return randomBytes(OAUTH_STATE_BYTES).toString('base64url');
}

/** Whether `raw` is a JSON object. */
function isRecord(raw: unknown): raw is Readonly<Record<string, unknown>> {
  return typeof raw === 'object' && raw !== null && !Array.isArray(raw);
}

/** A user id as `allowed` reads one, or undefined when `raw` is none. */
function idOf(raw: unknown): string | undefined {
  if (typeof raw === 'string' && raw !== '' && raw.trim() === raw) return raw;
  return typeof raw === 'number' && Number.isSafeInteger(raw) && raw >= 0
    ? String(raw)
    : undefined;
}

/** The user id a user lookup's body names: its `id`, else its `sub`. */
function userIdOf(body: unknown): string | undefined {
  if (!isRecord(body)) return undefined;
  return idOf(body['id']) ?? idOf(body['sub']);
}

/** The value of cookie `name` in a `Cookie` header, or undefined. */
function cookieOf(header: string | null, name: string): string | undefined {
  for (const part of (header ?? '').split(';')) {
    const pair = part.trim();
    if (pair.startsWith(`${name}=`)) return pair.slice(name.length + 1);
  }
  return undefined;
}

/** A refused callback. */
function refused(reason: OAuthCallbackRefusalReason, message: string): OAuthCallbackAnswer {
  return { served: false, refusal: { reason, message } };
}

/** The `unavailable` refusal of a provider `step` for `detail`. */
function unavailable(step: string, detail: string): OAuthCallbackAnswer {
  return refused('unavailable', `The OAuth provider did not answer the ${step}: ${detail}; try again, and tell whoever runs the hub if it goes on.`);
}

/** Reads the client secret from `env`, throwing a message naming the variable alone. */
function clientSecretOf(config: HubLoginOAuth, env: Readonly<Record<string, string | undefined>>): string {
  const secret = env[config.clientSecretVariable];
  if (secret === undefined || secret === '') {
    throw new Error(`hub.auth.login.oauth.clientSecretVariable names ${config.clientSecretVariable}, which is not set; set it to the client secret the provider issued the hub.`);
  }
  return secret;
}

/** What a token answer means: the access token, or the refusal. */
function tokenOf(asked: Asked): string | OAuthCallbackAnswer {
  if (!asked.answered) return unavailable('code exchange', asked.detail);

  const error = isRecord(asked.body)
    ? asked.body['error']
    : undefined;
  if (error === 'invalid_client') return unavailable('code exchange', 'it did not accept the hub\'s client id or secret');
  if (asked.status === 400 || asked.status === 401) return refused('unauthenticated', CODE_REFUSED);
  if (asked.status < 200 || asked.status >= 300) return unavailable('code exchange', `HTTP ${String(asked.status)}`);
  if (typeof error === 'string') return refused('unauthenticated', CODE_REFUSED);

  const token = isRecord(asked.body)
    ? asked.body['access_token']
    : undefined;
  return typeof token === 'string' && token !== ''
    ? token
    : unavailable('code exchange', 'its answer held no access token');
}

/** What a user answer means: the user id, or the refusal. */
function userOf(asked: Asked): string | OAuthCallbackAnswer {
  if (!asked.answered) return unavailable('user lookup', asked.detail);
  if (asked.status < 200 || asked.status >= 300) return unavailable('user lookup', `HTTP ${String(asked.status)}`);
  return userIdOf(asked.body) ?? unavailable('user lookup', 'its answer named no user id');
}

/**
 * Opens the OAuth login over `options.config`, reading the client
 * secret now and throwing when its variable is unset. States and
 * sessions live in this login alone, so two logins opened over the same
 * provider share neither.
 */
export function openOAuthLogin(options: OAuthLoginOptions): OAuthLogin {
  const { config } = options;
  const clientSecret = clientSecretOf(config, options.env ?? process.env);
  const now = options.now ?? Date.now;
  const sessionTtlMs = options.sessionTtlMs ?? DEFAULT_OAUTH_SESSION_TTL_MS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_OAUTH_TIMEOUT_MS;
  const pending = new Map<string, Pending>();
  const sessions = new Map<string, Session>();

  /** Sends one provider call, never rejecting. */
  const ask = async (url: string, init: RequestInit): Promise<Asked> => {
    try {
      const response = await fetch(url, { ...init, redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) });
      const text = await response.text();
      let body: unknown;
      try {
        body = JSON.parse(text);
      } catch {
        body = undefined;
      }
      return { answered: true, status: response.status, body };
    } catch (error) {
      const timedOut = error instanceof Error && error.name === 'TimeoutError';
      return {
        answered: false,
        detail: timedOut
          ? `no answer within ${String(timeoutMs)}ms`
          : 'it could not be reached',
      };
    }
  };

  /** Drops expired states from the front, then the oldest while the cap is reached. */
  const prunePending = (at: number): void => {
    for (const [digest, entry] of pending) {
      if (at - entry.startedAt < OAUTH_STATE_TTL_MS && pending.size < MAX_PENDING_OAUTH_STATES) break;
      pending.delete(digest);
    }
  };

  /** The cookie header value for `sessionId`, lasting `maxAgeMs`. */
  const cookieFor = (sessionId: string, maxAgeMs: number, secure: boolean): string => [
    `${OAUTH_SESSION_COOKIE}=${sessionId}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    `Max-Age=${String(Math.floor(maxAgeMs / 1000))}`,
    ...(secure
      ? ['Secure']
      : []),
  ].join('; ');

  const start = (request: Request): OAuthStarted => {
    const at = now();
    prunePending(at);
    const state = mintToken();
    const callbackUrl = options.callbackUrl ?? config.callbackUrl ?? new URL(OAUTH_CALLBACK_PATH, request.url).href;
    pending.set(digestOf(state), { startedAt: at, callbackUrl });

    const location = new URL(config.authorizeUrl);
    location.searchParams.set('response_type', 'code');
    location.searchParams.set('client_id', config.clientId);
    location.searchParams.set('redirect_uri', callbackUrl);
    location.searchParams.set('state', state);
    if (config.scope !== null) location.searchParams.set('scope', config.scope);
    return { location: location.href };
  };

  /** Takes the state `params` carries out of the pending ones: its entry, or the refusal. */
  const takeState = (params: URLSearchParams): Pending | OAuthCallbackAnswer => {
    const state = params.get('state') ?? '';
    const digest = digestOf(state);
    const entry = TOKEN.test(state)
      ? pending.get(digest)
      : undefined;
    if (entry === undefined) return refused('unauthenticated', STATE_UNKNOWN);
    pending.delete(digest);
    return now() - entry.startedAt >= OAUTH_STATE_TTL_MS
      ? refused('unauthenticated', STATE_EXPIRED)
      : entry;
  };

  const callback = async (request: Request): Promise<OAuthCallbackAnswer> => {
    const params = new URL(request.url).searchParams;
    const flow = takeState(params);
    if ('served' in flow) return flow;
    if (params.has('error')) return refused('unauthenticated', DENIED);
    const code = params.get('code') ?? '';
    if (code === '') return refused('unauthenticated', NO_CODE);

    const token = tokenOf(await ask(config.tokenUrl, {
      method: 'POST',
      headers: { 'accept': 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: flow.callbackUrl,
        client_id: config.clientId,
        client_secret: clientSecret,
      }).toString(),
    }));
    if (typeof token !== 'string') return token;

    const user = userOf(await ask(config.userUrl, {
      headers: { accept: 'application/json', authorization: `Bearer ${token}` },
    }));
    if (typeof user !== 'string') return user;
    if (!config.allowed.includes(user)) {
      return refused('forbidden', `The provider's user ${JSON.stringify(user)} may not sign in to this hub; whoever runs it can add the id to hub.auth.login.oauth.allowed.`);
    }

    const at = now();
    for (const [digest, session] of sessions) {
      if (session.expiresAt <= at) sessions.delete(digest);
    }
    const sessionId = mintToken();
    sessions.set(digestOf(sessionId), { user, expiresAt: at + sessionTtlMs });
    const secure = new URL(flow.callbackUrl).protocol === 'https:';
    return { served: true, user, headers: { 'Set-Cookie': cookieFor(sessionId, sessionTtlMs, secure) } };
  };

  /** The digest of the session id `request`'s cookie carries, or undefined. */
  const sessionDigestOf = (request: Request): string | undefined => {
    const sessionId = cookieOf(request.headers.get('cookie'), OAUTH_SESSION_COOKIE);
    return sessionId !== undefined && TOKEN.test(sessionId)
      ? digestOf(sessionId)
      : undefined;
  };

  /** Who the session `request` carries signed in as, dropping it once expired. */
  const answerFor = (request: Request): LoginAnswer => {
    const digest = sessionDigestOf(request);
    const session = digest === undefined
      ? undefined
      : sessions.get(digest);
    if (digest === undefined || session === undefined) return NO_SESSION_ANSWER;
    if (session.expiresAt <= now()) {
      sessions.delete(digest);
      return NO_SESSION_ANSWER;
    }
    return { served: true, user: session.user };
  };

  const check = (request: Request): Promise<LoginAnswer> => Promise.resolve(answerFor(request));

  const logout = (request: Request): OAuthLoggedOut => {
    const digest = sessionDigestOf(request);
    if (digest !== undefined) sessions.delete(digest);
    const secure = new URL(request.url).protocol === 'https:';
    return { headers: { 'Set-Cookie': cookieFor('', 0, secure) } };
  };

  return { mode: 'oauth', check, start, callback, logout };
}
