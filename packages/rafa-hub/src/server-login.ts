/**
 * The hub's login routes: the key page a person manages keys from, and
 * the three routes of the OAuth flow. {@link openLoginRoutes} answers
 * them; `server.ts` hands it every request whose path
 * {@link isLoginPath} claims.
 *
 * ## Routes
 *
 *   - `GET /login`: the key page, once the {@link HubLogin} serves the
 *     request. One page listing every key, deleted ones included, with
 *     its name, who created it, when, its last use ("never" when it has
 *     none) and its state, a form creating a key and, per key, a pause
 *     button (an active key) and a delete button (any key not deleted).
 *     The actions are the page's own script calling the key routes
 *     (`server-keys.ts`) with `fetch`, so they meet the same-origin and
 *     JSON-body checks as the CLI does; a created key's plain value is
 *     written into the page as text, never as markup, and is kept
 *     nowhere. Signed out, the page answers the login's refusal: `401`
 *     with its challenge under `basic`, so the browser asks for the user
 *     and password, and a link to `/login/oauth/start` under `oauth`;
 *     `503` for an `unavailable` login.
 *   - `GET /login/oauth/start`: `303` to the provider's authorize URL
 *     ({@link OAuthLogin.start}).
 *   - `GET /login/oauth/callback`: finishes the flow
 *     ({@link OAuthLogin.callback}). Served, it answers `200`, the
 *     session cookie and a small page linking to `/login`, rather than a
 *     redirect: the cookie is `SameSite=Strict`, and a browser does not
 *     send it on a redirect that is still part of the provider's
 *     cross-site navigation, so the next request has to start on the
 *     hub's own page. Refused, it answers `401`, `403` or `503` with the
 *     refusal's message and a link to start again.
 *   - `POST /login/logout`: ends the OAuth session and clears its cookie
 *     ({@link OAuthLogin.logout}), answering `303` to `/login`. Refused
 *     `403` when its `Origin` is not the hub's own, by the key routes'
 *     rule.
 *
 * The three OAuth routes answer `404` under `basic`, which keeps no
 * session for the hub to end: a browser forgets basic credentials when
 * it is closed. A path below `/login/` no route serves answers `404`, a
 * route asked with another method `405` with `Allow`, and a query
 * parameter on any route but the callback `400`; the callback reads the
 * provider's own.
 *
 * ## What every answer carries
 *
 * Every answer is HTML with `Cache-Control: no-store`, `Referrer-Policy:
 * no-referrer` (the callback's URL holds the code and state) and a
 * `Content-Security-Policy` allowing nothing but the page's own script
 * and style, by a nonce minted per answer, and fetches to the hub
 * itself; no other site may frame the page. Every string the page
 * writes from the store, the login or a refusal (a key name, a user, a
 * message) is HTML-escaped by {@link escapeHtml}.
 *
 * ## Logs
 *
 * A served callback logs `login.signed-in` with the user and a refused
 * one `login.refused` with the reason; a logout logs `login.signed-out`.
 * No line holds a state, a code, a cookie, a password or a key.
 */
import type { HubKey, HubKeyStore } from './identity/key-store.js';
import type { IdentityRefusalReason } from './identity/port.js';
import type { HubLogin, LoginRefusalReason } from './login/basic.js';
import type { OAuthCallbackRefusalReason, OAuthLogin } from './login/oauth.js';
import type { HubLog } from './server.js';

import { randomBytes } from 'node:crypto';

import { originsOf, sameOrigin } from './server-keys.js';
import { checkQuery, RequestRefused } from './server-query.js';

/** The key page's path; the OAuth routes sit below it. */
export const LOGIN_ROUTE = '/login';

/** Where the OAuth flow starts. */
export const OAUTH_START_ROUTE = '/login/oauth/start';

/** Where the provider sends the person back. */
export const OAUTH_CALLBACK_ROUTE = '/login/oauth/callback';

/** Where an OAuth session ends. */
export const LOGOUT_ROUTE = '/login/logout';

/** The method each route answers. */
const ROUTE_METHODS: Readonly<Record<string, string>> = Object.freeze({
  [LOGIN_ROUTE]: 'GET',
  [OAUTH_START_ROUTE]: 'GET',
  [OAUTH_CALLBACK_ROUTE]: 'GET',
  [LOGOUT_ROUTE]: 'POST',
});

/** The routes only an OAuth login serves. */
const OAUTH_ROUTES: ReadonlySet<string> = new Set([OAUTH_START_ROUTE, OAUTH_CALLBACK_ROUTE, LOGOUT_ROUTE]);

/** The status each login refusal is answered with. */
const LOGIN_STATUS: Readonly<Record<LoginRefusalReason, number>> = Object.freeze({
  unauthenticated: 401,
  unavailable: 503,
});

/** The status each callback refusal is answered with. */
const CALLBACK_STATUS: Readonly<Record<OAuthCallbackRefusalReason, number>> = Object.freeze({
  unauthenticated: 401,
  forbidden: 403,
  unavailable: 503,
});

/** How many random bytes a page's nonce holds. */
const NONCE_BYTES = 16;

/** What a cross-site logout is told. */
const CROSS_ORIGIN = 'The logout answers the hub\'s own page only; this request came from another site.';

/** The page's style. */
const STYLE = [
  'body { font-family: system-ui, sans-serif; margin: 2rem; max-width: 60rem; }',
  'table { border-collapse: collapse; width: 100%; }',
  'th, td { text-align: left; padding: 0.3rem 0.6rem; border-bottom: 1px solid #ccc; }',
  '#plain { font-family: monospace; word-break: break-all; }',
].join('\n');

/**
 * The page's script: the create form and the pause and delete buttons
 * call the key routes, and every answer is written as text.
 */
const SCRIPT = [
  'const said = document.getElementById(\'said\');',
  'const send = async (method, path, body) => {',
  '  const response = await fetch(path, { method, credentials: \'same-origin\', headers: { \'content-type\': \'application/json\' }, body: JSON.stringify(body) });',
  '  return response.json().catch(() => ({ success: false, error: \'The hub answered \' + response.status + \'.\' }));',
  '};',
  'document.getElementById(\'create\').addEventListener(\'submit\', async (event) => {',
  '  event.preventDefault();',
  '  said.textContent = \'\';',
  '  const answer = await send(\'POST\', \'/v1/keys\', { name: event.target.elements.name.value });',
  '  if (!answer.success) { said.textContent = answer.error; return; }',
  '  document.getElementById(\'plain\').textContent = answer.data.plain;',
  '  document.getElementById(\'created\').hidden = false;',
  '});',
  'for (const button of document.querySelectorAll(\'button[data-action]\')) {',
  '  button.addEventListener(\'click\', async () => {',
  '    const { action, name } = button.dataset;',
  '    if (action === \'delete\' && !confirm(\'Delete the key \' + name + \'? A deleted key is never served again.\')) return;',
  '    const path = \'/v1/keys/\' + encodeURIComponent(name) + (action === \'pause\' ? \'/pause\' : \'\');',
  '    const answer = await send(action === \'pause\' ? \'POST\' : \'DELETE\', path, {});',
  '    if (!answer.success) { said.textContent = answer.error; return; }',
  '    location.reload();',
  '  });',
  '}',
].join('\n');

/** What {@link openLoginRoutes} is opened with. */
export interface LoginRoutesOptions {
  /** Who may see the page; an {@link OAuthLogin} also serves the three OAuth routes. */
  readonly login: HubLogin;
  /** The keys the page lists. */
  readonly store: HubKeyStore;
  /** Where `login.signed-in`, `login.refused` and `login.signed-out` go. */
  readonly log: HubLog;
  /** Origins the hub is reached at beyond each request's own, as the key routes take them. */
  readonly origins?: readonly string[];
}

/** One login route's answer, with what the server's `request` line adds. */
export interface LoginRouteAnswer {
  readonly response: Response;
  /** The login's user, once the login served the request. */
  readonly user?: string;
  /** Why the request was refused: by the login, or `forbidden`. */
  readonly refusal?: IdentityRefusalReason;
  /** The log fields the route adds, such as the error a `4xx` answered. */
  readonly fields?: Readonly<Record<string, unknown>>;
}

/** The login routes, opened. */
export interface HubLoginRoutes {
  /** Answers `request`, whose path {@link isLoginPath} claims; rejects on a store error. */
  readonly serve: (request: Request) => Promise<LoginRouteAnswer>;
}

/** Whether `pathname` is the login routes': {@link LOGIN_ROUTE} or below it. */
export function isLoginPath(pathname: string): boolean {
  return pathname === LOGIN_ROUTE || pathname.startsWith(`${LOGIN_ROUTE}/`);
}

/** `text` with `&`, `<`, `>`, `"` and `'` written as entities, safe in markup and in a quoted attribute. */
export function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll('\'', '&#39;');
}

/** Whether `login` is the OAuth login, serving the flow's routes. */
function isOAuthLogin(login: HubLogin): login is OAuthLogin {
  return login.mode === 'oauth' && typeof (login as Partial<OAuthLogin>).start === 'function';
}

/** The headers every answer carries, its CSP allowing the script and style `nonce` marks. */
function pageHeaders(nonce: string): Record<string, string> {
  return {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    'referrer-policy': 'no-referrer',
    'x-content-type-options': 'nosniff',
    'content-security-policy': [
      'default-src \'none\'',
      `script-src 'nonce-${nonce}'`,
      `style-src 'nonce-${nonce}'`,
      'connect-src \'self\'',
      'form-action \'self\'',
      'base-uri \'none\'',
      'frame-ancestors \'none\'',
    ].join('; '),
  };
}

/** A whole page titled `title`, `body` already escaped, answered with `status` and `headers`. */
function page(status: number, title: string, body: string, options: { readonly headers?: Readonly<Record<string, string>>; readonly script?: boolean } = {}): Response {
  const nonce = randomBytes(NONCE_BYTES).toString('base64');
  const script = options.script === true
    ? `<script nonce="${nonce}">\n${SCRIPT}\n</script>\n`
    : '';
  const html = [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    `<title>${escapeHtml(title)}</title>`,
    `<style nonce="${nonce}">\n${STYLE}\n</style>`,
    '</head>',
    '<body>',
    `<h1>${escapeHtml(title)}</h1>`,
    body,
    `${script}</body>`,
    '</html>',
    '',
  ].join('\n');
  return new Response(html, { status, headers: { ...pageHeaders(nonce), ...options.headers } });
}

/** A page of `status` saying `message`, with a link to `href` named `link`. */
function notice(status: number, title: string, message: string, link?: { readonly href: string; readonly text: string }, headers: Readonly<Record<string, string>> = {}): Response {
  const linked = link === undefined
    ? ''
    : `\n<p><a href="${escapeHtml(link.href)}">${escapeHtml(link.text)}</a></p>`;
  return page(status, title, `<p>${escapeHtml(message)}</p>${linked}`, { headers });
}

/** The refused answer of `status` saying `error`, its error logged beside it. */
function refusedWith(status: number, error: string, extra: Omit<LoginRouteAnswer, 'response'> = {}): LoginRouteAnswer {
  return { ...extra, response: notice(status, 'rafa-hub', error), fields: { ...extra.fields, error } };
}

/** What a key's state reads as on the page. */
function stateOf(key: HubKey): string {
  if (key.deleted) return 'deleted';
  return key.paused
    ? 'paused'
    : 'active';
}

/** A time cell: the ISO time in a `<time>`, or "never". */
function timeCell(iso: string | null): string {
  return iso === null
    ? '<td>never</td>'
    : `<td><time datetime="${escapeHtml(iso)}">${escapeHtml(iso)}</time></td>`;
}

/** The action buttons of `key`: pause when active, delete when not deleted. */
function actionsOf(key: HubKey): string {
  const name = escapeHtml(key.name);
  const pause = !key.deleted && !key.paused
    ? `<button type="button" data-action="pause" data-name="${name}">Pause</button> `
    : '';
  const remove = key.deleted
    ? ''
    : `<button type="button" data-action="delete" data-name="${name}">Delete</button>`;
  return `<td>${pause}${remove}</td>`;
}

/** One table row for `key`. */
function rowOf(key: HubKey): string {
  return [
    '<tr>',
    `<td>${escapeHtml(key.name)}</td>`,
    `<td>${escapeHtml(key.createdBy)}</td>`,
    timeCell(key.createdAt),
    timeCell(key.lastUsedAt),
    `<td>${stateOf(key)}</td>`,
    actionsOf(key),
    '</tr>',
  ].join('');
}

/** The key page's body for `user` over `keys`, with a logout form when `canLogOut`. */
function keyPageBody(user: string, keys: readonly HubKey[], canLogOut: boolean): string {
  const logout = canLogOut
    ? `\n<form method="post" action="${LOGOUT_ROUTE}"><button type="submit">Sign out</button></form>`
    : '';
  const rows = keys.length === 0
    ? '<tr><td colspan="6">No key yet.</td></tr>'
    : keys.map(rowOf).join('\n');
  return [
    `<p>Signed in as <strong>${escapeHtml(user)}</strong>.</p>${logout}`,
    '<h2>Keys</h2>',
    '<table>',
    '<thead><tr><th>Name</th><th>Created by</th><th>Created at</th><th>Last used</th><th>State</th><th>Actions</th></tr></thead>',
    `<tbody>\n${rows}\n</tbody>`,
    '</table>',
    '<p id="said" role="alert"></p>',
    '<h2>Create a key</h2>',
    '<form id="create">',
    '<label>Name <input name="name" required maxlength="64" pattern="[a-z0-9][a-z0-9._\\-]{0,63}"></label>',
    '<button type="submit">Create</button>',
    '</form>',
    '<div id="created" hidden>',
    '<p>The new key, shown this once; copy it now:</p>',
    '<p id="plain"></p>',
    `<p><a href="${LOGIN_ROUTE}">Reload the list</a></p>`,
    '</div>',
  ].join('\n');
}

/**
 * Opens the login routes over `options`; see the module note. Throws a
 * `TypeError` for an entry of `origins` that is not a URL.
 */
export function openLoginRoutes(options: LoginRoutesOptions): HubLoginRoutes {
  const { login, store, log } = options;
  const origins = originsOf(options.origins ?? []);
  const oauth = isOAuthLogin(login)
    ? login
    : undefined;

  /** The key page, or the login's refusal. */
  const keyPage = async (request: Request): Promise<LoginRouteAnswer> => {
    const checked = await login.check(request);
    if (!checked.served) {
      const { reason, message, headers } = checked.refusal;
      const link = oauth !== undefined && reason === 'unauthenticated'
        ? { href: OAUTH_START_ROUTE, text: 'Sign in' }
        : undefined;
      return { response: notice(LOGIN_STATUS[reason], 'Sign in to rafa-hub', message, link, headers), refusal: reason };
    }
    const keys = await store.list();
    const body = keyPageBody(checked.user, keys, oauth !== undefined);
    return { response: page(200, 'rafa-hub keys', body, { script: true }), user: checked.user };
  };

  /** The callback's answer: the cookie and a link to the page, or the refusal. */
  const callback = async (flow: OAuthLogin, request: Request): Promise<LoginRouteAnswer> => {
    const answered = await flow.callback(request);
    if (!answered.served) {
      const { reason, message } = answered.refusal;
      log({ level: 'warn', event: 'login.refused', reason });
      const response = notice(CALLBACK_STATUS[reason], 'Sign-in refused', message, { href: OAUTH_START_ROUTE, text: 'Start again' });
      return { response, refusal: reason, fields: { error: message } };
    }
    log({ level: 'info', event: 'login.signed-in', user: answered.user });
    const body = `<p>Signed in as <strong>${escapeHtml(answered.user)}</strong>.</p>\n<p><a href="${LOGIN_ROUTE}">Continue to the keys</a></p>`;
    return { response: page(200, 'Signed in', body, { headers: answered.headers }), user: answered.user };
  };

  /** The logout: the session ended and its cookie cleared, or refused for another site. */
  const logout = async (flow: OAuthLogin, request: Request): Promise<LoginRouteAnswer> => {
    if (!sameOrigin(request, origins)) return refusedWith(403, CROSS_ORIGIN, { refusal: 'forbidden' });
    const checked = await flow.check(request);
    const { headers } = flow.logout(request);
    const user = checked.served
      ? checked.user
      : undefined;
    log({ level: 'info', event: 'login.signed-out', ...user === undefined
      ? {}
      : { user } });
    const response = new Response(null, { status: 303, headers: { 'cache-control': 'no-store', 'location': LOGIN_ROUTE, ...headers } });
    return user === undefined
      ? { response }
      : { response, user };
  };

  const serve = async (request: Request): Promise<LoginRouteAnswer> => {
    const url = new URL(request.url);
    const method = ROUTE_METHODS[url.pathname];
    if (method === undefined || (oauth === undefined && OAUTH_ROUTES.has(url.pathname))) {
      return refusedWith(404, `No route serves ${url.pathname}.`);
    }
    if (request.method !== method) {
      const response = notice(405, 'rafa-hub', `${url.pathname} answers ${method} only.`, undefined, { allow: method });
      return { response };
    }
    if (url.pathname !== OAUTH_CALLBACK_ROUTE) {
      try {
        checkQuery(url, []);
      } catch (error) {
        if (error instanceof RequestRefused) return refusedWith(error.status, error.message);
        throw error;
      }
    }

    if (oauth === undefined || url.pathname === LOGIN_ROUTE) return await keyPage(request);
    if (url.pathname === OAUTH_START_ROUTE) {
      const { location } = oauth.start(request);
      return { response: new Response(null, { status: 303, headers: { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', location } }) };
    }
    return url.pathname === OAUTH_CALLBACK_ROUTE
      ? await callback(oauth, request)
      : await logout(oauth, request);
  };

  return { serve };
}
