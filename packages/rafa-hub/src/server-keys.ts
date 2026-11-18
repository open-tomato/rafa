/**
 * The hub's key routes: the four routes a login drives the
 * {@link HubKeyStore} through, behind a {@link HubLogin} and never the
 * identity port, so a key never manages keys and a login never syncs.
 * {@link openKeyRoutes} answers them; `server.ts` hands it every request
 * whose path {@link isKeyPath} claims.
 *
 * ## Routes
 *
 *   - `GET /v1/keys`: every key, deleted ones included, oldest first,
 *     each as its name, `createdBy`, `createdAt`, `lastUsedAt` (null when
 *     never used), `paused` and `deleted`, as `{ keys: [...] }`.
 *   - `POST /v1/keys`, body `{ "name": "<key name>" }`: mints a key
 *     created by the login's user and answers `201` with `{ key, plain }`,
 *     the plain key this once; no other answer holds it.
 *   - `POST /v1/keys/<name>/pause`, body `{}`: pauses the key, answering
 *     `{ key }`.
 *   - `DELETE /v1/keys/<name>`, body `{}`: marks the key deleted, keeping
 *     its name and last use, answering `{ key }`.
 *
 * Every answer is the server's envelope, `{ "success": true, "data": … }`
 * or `{ "success": false, "error": "<one line>" }`, with `Cache-Control:
 * no-store`, so neither a key list nor a plain key is kept by a cache.
 * No route takes a query parameter.
 *
 * ## The checks, in order
 *
 *   1. `404` for a path under `/v1/keys/` no route serves, and `405` with
 *      `Allow` for a route asked with another method.
 *   2. A mutating route (`POST`, `DELETE`) is refused `403` when its
 *      `Origin` is not the hub's own: the request's origin or one of
 *      {@link KeyRoutesOptions.origins}, such as the public origin of
 *      `hub.auth.login.oauth.callbackUrl` behind a proxy. A request with
 *      no `Origin`, as the CLI sends, passes unless its `Sec-Fetch-Site`
 *      says another site sent it. Then `415` unless its `Content-Type` is
 *      `application/json`, which a form on another site cannot send
 *      without a preflight the hub never answers. Both are read before
 *      the login, so a page on another site cannot drive them with a
 *      browser's cached basic credentials or cookie, nor make the hub
 *      verify a password.
 *   3. `400` for any query parameter.
 *   4. `401` with the login's headers (its challenge) for an
 *      `unauthenticated` login, `503` for an `unavailable` one.
 *   5. `400` for a body that is not a JSON object of the route's fields,
 *      or over {@link MAX_KEY_BODY_BYTES}, and for a name off `KEY_NAME`,
 *      whose refusal never repeats the name, since a person may have
 *      pasted a key into it.
 *   6. The store's {@link HubKeyRefused}: `400` for `invalid-name` (a
 *      reserved name), `409` for `name-taken` and `deleted`, `404` for
 *      `unknown`. Any other store error rejects, for the server to log
 *      and answer `500`.
 *
 * ## Logs
 *
 * A create, pause and delete each log one line, `key.created`,
 * `key.paused` and `key.deleted`, holding the key's name and the login's
 * user alone; never a key, a digest, a password or a cookie. The
 * server's own `request` line is the caller's: {@link KeyRouteAnswer}
 * holds the user, the refusal and the fields it adds.
 */
import type { HubKey, HubKeyRefusalReason, HubKeyStore } from './identity/key-store.js';
import type { IdentityRefusalReason } from './identity/port.js';
import type { HubLogin, LoginRefusalReason } from './login/basic.js';
import type { HubLog } from './server.js';

import { HubKeyRefused, KEY_NAME } from './identity/key-store.js';
import { checkQuery, RequestRefused } from './server-query.js';

/** The path the key list and the create route answer on; a key's routes sit below it. */
export const KEYS_ROUTE = '/v1/keys';

/** The largest body a key route reads, in bytes. */
export const MAX_KEY_BODY_BYTES = 4096;

/** The headers every key route answers beside its own. */
const NO_STORE: Readonly<Record<string, string>> = Object.freeze({ 'cache-control': 'no-store' });

/** A key's own route: `/v1/keys/<name>` or `/v1/keys/<name>/pause`, its name one path segment. */
const KEY_PATH = /^\/v1\/keys\/([^/]+)(\/pause)?$/;

/** The `Sec-Fetch-Site` values a request with no `Origin` may carry: none, or the hub's own page. */
const OWN_FETCH_SITES: ReadonlySet<string> = new Set(['same-origin', 'none']);

/** The status each login refusal is answered with. */
const LOGIN_STATUS: Readonly<Record<LoginRefusalReason, number>> = Object.freeze({
  unauthenticated: 401,
  unavailable: 503,
});

/** The status each store refusal is answered with. */
const STORE_STATUS: Readonly<Record<HubKeyRefusalReason, number>> = Object.freeze({
  'invalid-name': 400,
  'name-taken': 409,
  unknown: 404,
  deleted: 409,
});

/** What a name off `KEY_NAME` is told, repeating nothing it sent. */
const INVALID_NAME = 'A key name is a lower-case letter or digit, then up to 63 of those, ".", "_" or "-".';

/** What a cross-site request is told. */
const CROSS_ORIGIN = 'The key routes answer the hub\'s own page and the CLI only; this request came from another site.';

/** What {@link openKeyRoutes} is opened with. */
export interface KeyRoutesOptions {
  /** Who may drive the routes; asked on every request reaching one. */
  readonly login: HubLogin;
  /** The keys the routes list, create, pause and delete. */
  readonly store: HubKeyStore;
  /** Where `key.created`, `key.paused` and `key.deleted` go. */
  readonly log: HubLog;
  /**
   * Origins the hub is reached at beyond each request's own, each a URL
   * whose origin is read, such as `hub.auth.login.oauth.callbackUrl`
   * behind a reverse proxy, whose requests carry its internal origin.
   */
  readonly origins?: readonly string[];
}

/** One key route's answer, with what the server's `request` line adds. */
export interface KeyRouteAnswer {
  readonly response: Response;
  /** The login's user, once the login served the request. */
  readonly user?: string;
  /** Why the request was refused before a store call: by the login, or `forbidden` for another site. */
  readonly refusal?: IdentityRefusalReason;
  /** The log fields the route adds: the key's name, and the error a `4xx` answered. */
  readonly fields?: Readonly<Record<string, unknown>>;
}

/** The key routes, opened. */
export interface HubKeyRoutes {
  /** Answers `request`, whose path {@link isKeyPath} claims; rejects on a store error no route expects. */
  readonly serve: (request: Request) => Promise<KeyRouteAnswer>;
}

/** A key route, as its path and method name it. */
type KeyRoute =
  | { readonly kind: 'list' }
  | { readonly kind: 'create' }
  | { readonly kind: 'pause'; readonly name: string }
  | { readonly kind: 'delete'; readonly name: string };

/** Whether `pathname` is the key routes': {@link KEYS_ROUTE} or below it. */
export function isKeyPath(pathname: string): boolean {
  return pathname === KEYS_ROUTE || pathname.startsWith(`${KEYS_ROUTE}/`);
}

/** A JSON answer of `status`, never cached. */
function answer(status: number, body: unknown, headers: Readonly<Record<string, string>> = {}): Response {
  return Response.json(body, { status, headers: { ...NO_STORE, ...headers } });
}

/** A failure envelope of `status` saying `error`. */
function failure(status: number, error: string, headers: Readonly<Record<string, string>> = {}): Response {
  return answer(status, { success: false, error }, headers);
}

/** The refused answer of `status`, its error logged beside it. */
function refusedWith(status: number, error: string, extra: Omit<KeyRouteAnswer, 'response'> = {}): KeyRouteAnswer {
  return { ...extra, response: failure(status, error), fields: { ...extra.fields, error } };
}

/** The methods the route at `pathname` answers, or undefined for a path no route serves. */
function methodsOf(pathname: string): readonly string[] | undefined {
  if (pathname === KEYS_ROUTE) return ['GET', 'POST'];
  const own = KEY_PATH.exec(pathname);
  if (own === null) return undefined;
  return own[2] === undefined
    ? ['DELETE']
    : ['POST'];
}

/** The route `method` on `pathname` names; both were checked by {@link methodsOf}. */
function routeOf(pathname: string, method: string): KeyRoute {
  if (pathname === KEYS_ROUTE) {
    return method === 'GET'
      ? { kind: 'list' }
      : { kind: 'create' };
  }
  const [, segment = '', pause] = KEY_PATH.exec(pathname) ?? [];
  let name: string;
  try {
    name = decodeURIComponent(segment);
  } catch {
    name = '';
  }
  return pause === undefined
    ? { kind: 'delete', name }
    : { kind: 'pause', name };
}

/** The origins `extra` names, each read as a URL; throws a `TypeError` for one that is not. */
export function originsOf(extra: readonly string[]): ReadonlySet<string> {
  return new Set(extra.map((written) => {
    if (!URL.canParse(written)) throw new TypeError(`openKeyRoutes: origin ${JSON.stringify(written)} is not a URL.`);
    return new URL(written).origin;
  }));
}

/** Whether `request` came from the hub's own page, the CLI or `origins`; see the module note. */
export function sameOrigin(request: Request, origins: ReadonlySet<string>): boolean {
  const origin = request.headers.get('origin');
  if (origin === null) {
    const site = request.headers.get('sec-fetch-site');
    return site === null || OWN_FETCH_SITES.has(site.toLowerCase());
  }
  return origin === new URL(request.url).origin || origins.has(origin);
}

/** Whether `request` says its body is JSON: `application/json`, with or without parameters. */
function saysJson(request: Request): boolean {
  const type = request.headers.get('content-type') ?? '';
  const [essence = ''] = type.split(';');
  return essence.trim().toLowerCase() === 'application/json';
}

/** The JSON object `request` carries, holding none but `fields`; refused `400` otherwise. */
async function readBody(request: Request, fields: readonly string[]): Promise<Readonly<Record<string, unknown>>> {
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (declared > MAX_KEY_BODY_BYTES) throw new RequestRefused(400, `The body is over ${String(MAX_KEY_BODY_BYTES)} bytes.`);
  const bytes = await request.arrayBuffer();
  if (bytes.byteLength > MAX_KEY_BODY_BYTES) throw new RequestRefused(400, `The body is over ${String(MAX_KEY_BODY_BYTES)} bytes.`);

  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new RequestRefused(400, 'The body is not JSON; expected a JSON object.');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new RequestRefused(400, 'The body is not a JSON object.');
  }
  const unknown = Object.keys(parsed).find((field) => !fields.includes(field));
  if (unknown !== undefined) {
    const expected = fields.length === 0
      ? 'this route takes {}'
      : `expected ${fields.join(', ')}`;
    throw new RequestRefused(400, `The body names ${JSON.stringify(unknown)}; ${expected}.`);
  }
  return parsed as Readonly<Record<string, unknown>>;
}

/** Refuses `name` off `KEY_NAME`, repeating nothing of it. */
function checkName(name: unknown): string {
  if (typeof name !== 'string' || !KEY_NAME.test(name)) throw new RequestRefused(400, INVALID_NAME);
  return name;
}

/**
 * Opens the key routes over `options`; see the module note. Throws a
 * `TypeError` for an entry of `origins` that is not a URL.
 */
export function openKeyRoutes(options: KeyRoutesOptions): HubKeyRoutes {
  const { login, store, log } = options;
  const origins = originsOf(options.origins ?? []);

  /** Runs the route, the login having served `user`. */
  const run = async (route: KeyRoute, request: Request, user: string): Promise<KeyRouteAnswer> => {
    if (route.kind === 'list') {
      const keys: readonly HubKey[] = await store.list();
      return { response: answer(200, { success: true, data: { keys } }), user };
    }
    if (route.kind === 'create') {
      const name = checkName((await readBody(request, ['name'])).name);
      const created = await store.create(name, user);
      log({ level: 'info', event: 'key.created', name, user });
      return { response: answer(201, { success: true, data: { key: created.key, plain: created.plain } }), user, fields: { name } };
    }
    await readBody(request, []);
    const name = checkName(route.name);
    const key = route.kind === 'pause'
      ? await store.pause(name)
      : await store.delete(name);
    const event = route.kind === 'pause'
      ? 'key.paused'
      : 'key.deleted';
    log({ level: 'info', event, name, user });
    return { response: answer(200, { success: true, data: { key } }), user, fields: { name } };
  };

  const serve = async (request: Request): Promise<KeyRouteAnswer> => {
    const url = new URL(request.url);
    const methods = methodsOf(url.pathname);
    if (methods === undefined) return refusedWith(404, `No route serves ${url.pathname}.`);
    if (!methods.includes(request.method)) {
      const allow = methods.join(', ');
      return { response: failure(405, `${url.pathname} answers ${allow} only.`, { allow }) };
    }
    const route = routeOf(url.pathname, request.method);
    if (route.kind !== 'list') {
      if (!sameOrigin(request, origins)) return refusedWith(403, CROSS_ORIGIN, { refusal: 'forbidden' });
      if (!saysJson(request)) return refusedWith(415, 'The body must be sent as Content-Type: application/json.');
    }

    try {
      checkQuery(url, []);
    } catch (error) {
      if (error instanceof RequestRefused) return refusedWith(error.status, error.message);
      throw error;
    }

    const checked = await login.check(request);
    if (!checked.served) {
      const { reason, message, headers } = checked.refusal;
      return { response: failure(LOGIN_STATUS[reason], message, headers), refusal: reason };
    }
    const { user } = checked;
    try {
      return await run(route, request, user);
    } catch (error) {
      if (error instanceof RequestRefused) return refusedWith(error.status, error.message, { user });
      if (error instanceof HubKeyRefused) return refusedWith(STORE_STATUS[error.reason], error.message, { user, fields: { name: error.keyName } });
      throw error;
    }
  };

  return { serve };
}
