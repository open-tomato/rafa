/**
 * The hub server: `Bun.serve` with no web framework, answering the four
 * routes of the first plan for #325 over the two ports, the store
 * (`store/port.ts`) and the identity (`identity/port.ts`), whichever
 * adapters it is handed. `bin.ts` hands it the SQLite store and the
 * repository-permission identity; the tests hand it stand-ins.
 *
 * ## Routes
 *
 *   - `GET /health`: `200` once the store has opened, `503` while it has
 *     not. The one route that never asks the identity port, so a
 *     container's `HEALTHCHECK` needs no token.
 *   - `GET /v1/status` (`status.read`): the hub's version, the migration
 *     ids its store holds, its rows per table and each device's last push.
 *   - `POST /v1/effort/push?device=<origin>` (`effort.push`): the body is
 *     a wire payload as core's `encodeWirePayload` writes it, checked by
 *     core's `decodeWirePayload`; answers what the push received and added.
 *   - `GET /v1/effort/pull?device=<origin>&since=<cursor>` (`effort.pull`):
 *     the rows other origins created past `since`, a wire cursor as JSON
 *     text and read from the start when left out, as a wire payload.
 *
 * `device` is the calling store's origin, its rows' `origin_store`. A
 * route takes no query parameter it does not name, so a misspelt one
 * (`cursor=` for `since=`) is refused rather than read as absent. `GET
 * /v1/settings/locked` is the second plan's, and answers `404` here.
 *
 * ## Answers
 *
 * Every answer is JSON in one envelope: `{ "success": true, "data": … }`
 * or `{ "success": false, "error": "<one line>" }`. In the order a
 * request is checked:
 *
 *   - `404` for a path no route serves, `405` with `Allow` for a route
 *     asked with another method, neither asking the identity port;
 *   - `401` (with `WWW-Authenticate`), `403` and `503` for an identity
 *     refusal of reason `unauthenticated`, `forbidden` and `unavailable`,
 *     its message as the error; `403` too for a served caller whose
 *     actions leave out the route's;
 *   - `503` while the store has not opened;
 *   - `400` for a query or body the route cannot read, a
 *     `WireFormatError` from the store included;
 *   - `409` for a push the store refuses with `HubUpgradeRequired`: its
 *     message names the migrations the hub lacks and the upgrade to run;
 *   - `500` for anything else, which is logged and never described to
 *     the caller.
 *
 * ## The store
 *
 * The server starts whether or not the store opens: a hub whose store
 * does not open still answers `/health`, with `503`, which is what tells
 * an operator. Opening is tried at start and again on the next request
 * needing the store once an attempt has failed, one attempt at a time,
 * so a volume mounted late is picked up without a restart. `stop` closes
 * the store once the server has stopped.
 *
 * ## Logs
 *
 * One JSON object per line on standard output, never a file, through
 * {@link jsonLineLog}: `time`, `level`, `event`, then the event's fields.
 * Every request logs one `request` line holding its method, path,
 * status and milliseconds, the caller when the identity port named one,
 * the refusal reason when it refused, the device with its row counts
 * for a push or a pull, and the error a `4xx` from the route answered.
 * A line never holds a request's headers or its query, so no token
 * reaches the log; of a body it holds only what a wire refusal quotes.
 */
import type { HubAction, HubCaller, HubIdentity, IdentityRefusal, IdentityRefusalReason } from './identity/port.js';
import type { HubStore } from './store/port.js';
import type { WireCursor } from '@open-tomato/rafa/store';

import { decodeWirePayload, WIRE_FORMAT, WIRE_VERSION, WireFormatError } from '@open-tomato/rafa/store';

import { HubUpgradeRequired } from './store/sqlite.js';

/** The path each route answers on. */
export const HUB_ROUTES = Object.freeze({
  health: '/health',
  status: '/v1/status',
  push: '/v1/effort/push',
  pull: '/v1/effort/pull',
});

/** The hostname the hub listens on when none is given: every interface, as a container needs. */
export const DEFAULT_HOSTNAME = '0.0.0.0';

/** The `WWW-Authenticate` challenge a `401` carries. */
export const AUTH_CHALLENGE = 'Bearer realm="rafa-hub"';

/** The error a `503` answers while the store has not opened. */
export const STORE_UNAVAILABLE = 'The hub\'s store did not open; the hub\'s log says why.';

/** The error a `500` answers; the log holds the cause. */
export const INTERNAL_ERROR = 'The hub failed to serve this request; the hub\'s log says why.';

/** A device, as `device` names it: 1 to 200 printable ASCII characters, as a store's origin is. */
const DEVICE = /^[!-~]{1,200}$/;

/** The status each identity refusal is answered with. */
const REFUSAL_STATUS: Readonly<Record<IdentityRefusalReason, number>> = Object.freeze({
  unauthenticated: 401,
  forbidden: 403,
  unavailable: 503,
});

/** How loud a log line is. */
export type HubLogLevel = 'info' | 'warn' | 'error';

/** One log line before it is stamped: its level, its event and the event's fields. */
export interface HubLogEntry {
  readonly level: HubLogLevel;
  readonly event: string;
  readonly [field: string]: unknown;
}

/** Where the hub's log lines go. */
export type HubLog = (entry: HubLogEntry) => void;

/**
 * A {@link HubLog} writing each entry as one JSON line, stamped `time`
 * first from `now`, to `write`: standard output unless a test says.
 * `JSON.stringify` escapes a line break inside a field, so one entry is
 * always one line.
 */
export function jsonLineLog(
  write: (line: string) => void = (line) => {
    process.stdout.write(line);
  },
  now: () => Date = () => new Date(),
): HubLog {
  return (entry) => {
    write(`${JSON.stringify({ time: now().toISOString(), ...entry })}\n`);
  };
}

/** What {@link startHubServer} is started with. */
export interface HubServerOptions {
  /** The port to listen on; `0` asks the system for a free one, as the tests do. */
  readonly port: number;
  /** The hostname to listen on; {@link DEFAULT_HOSTNAME} when left out. */
  readonly hostname?: string;
  /** The hub's version, answered by `GET /v1/status`. */
  readonly version: string;
  /** Who is calling each route but `/health`. */
  readonly identity: HubIdentity;
  /** Opens the store; may throw, or reject, when it cannot. */
  readonly openStore: () => HubStore | Promise<HubStore>;
  /** Where log lines go; {@link jsonLineLog} to standard output when left out. */
  readonly log?: HubLog;
}

/** A running hub. */
export interface HubServer {
  /** The URL it answers on, with no trailing slash. */
  readonly url: string;
  /** The port it listens on. */
  readonly port: number;
  /** Stops answering, closing open connections, then closes the store. */
  readonly stop: () => Promise<void>;
}

/** A request the route cannot read, answered with its status and one line. */
class RequestRefused extends Error {
  override readonly name = 'RequestRefused';
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** A request's answer, with what its log line adds. */
interface Served {
  readonly response: Response;
  readonly caller?: HubCaller;
  readonly refusal?: IdentityRefusalReason;
  readonly fields?: Readonly<Record<string, unknown>>;
}

/** What a route's handler is handed once the caller is served and the store is open. */
interface RouteContext {
  readonly url: URL;
  readonly request: Request;
  readonly store: HubStore;
  readonly version: string;
}

/** A route behind the identity port. */
interface Route {
  readonly method: 'GET' | 'POST';
  readonly action: HubAction;
  /** The query parameters it reads; any other is refused. */
  readonly query: readonly string[];
  readonly handle: (context: RouteContext) => Promise<Omit<Served, 'caller'>>;
}

/** The store, opened once and opened again after a failed attempt. */
interface StoreHolder {
  /** The open store, or null when this attempt to open it failed. */
  readonly acquire: () => Promise<HubStore | null>;
  /** Closes the store if it opened. */
  readonly close: () => Promise<void>;
}

/** `error`'s message, whatever was thrown. */
function messageOf(error: unknown): string {
  return error instanceof Error
    ? error.message
    : String(error);
}

/** A JSON answer of `status` holding `body`. */
function answer(status: number, body: unknown, headers: Readonly<Record<string, string>> = {}): Response {
  return Response.json(body, { status, headers });
}

/** A success envelope holding `data`. */
function success(data: unknown): Response {
  return answer(200, { success: true, data });
}

/** A failure envelope of `status` saying `error`. */
function failure(status: number, error: string, headers: Readonly<Record<string, string>> = {}): Response {
  return answer(status, { success: false, error }, headers);
}

/** The answer to an identity refusal. */
function refusalResponse(refusal: IdentityRefusal): Response {
  const status = REFUSAL_STATUS[refusal.reason];
  const headers: Record<string, string> = status === 401
    ? { 'www-authenticate': AUTH_CHALLENGE }
    : {};
  return failure(status, refusal.message, headers);
}

/** Refuses a query parameter `route` does not read, or one given twice. */
function checkQuery(url: URL, allowed: readonly string[]): void {
  const names = [...url.searchParams.keys()];
  const unknown = names.find((name) => !allowed.includes(name));
  if (unknown !== undefined) {
    const expected = allowed.length === 0
      ? 'this route takes none'
      : `expected ${allowed.join(', ')}`;
    throw new RequestRefused(400, `The query names ${JSON.stringify(unknown)}; ${expected}.`);
  }
  const twice = names.find((name, index) => names.indexOf(name) !== index);
  if (twice !== undefined) throw new RequestRefused(400, `The query names ${twice} more than once.`);
}

/** The `device` the query names, refused when absent or not an origin. */
function readDevice(url: URL): string {
  const device = url.searchParams.get('device');
  if (device === null) throw new RequestRefused(400, 'The query names no device; expected device=<the store\'s origin>.');
  if (!DEVICE.test(device)) throw new RequestRefused(400, 'device is not a store origin; expected 1 to 200 printable ASCII characters.');
  return device;
}

/** The cursor `since` spells, `{}` when left out, checked by core's wire codec. */
function readCursor(url: URL): WireCursor {
  const since = url.searchParams.get('since');
  if (since === null) return {};

  let parsed: unknown;
  try {
    parsed = JSON.parse(since);
  } catch {
    throw new RequestRefused(400, 'since is not JSON; expected a cursor such as {"commits":12}.');
  }
  const probe = { format: WIRE_FORMAT, version: WIRE_VERSION, migrations: [], tables: {}, cursor: parsed };
  return decodeWirePayload(JSON.stringify(probe)).cursor;
}

/** The rows across every table of `tables`. */
function rowCount(tables: Readonly<Record<string, readonly unknown[]>>): number {
  return Object.values(tables).reduce((total, rows) => total + rows.length, 0);
}

/** Every route behind the identity port, by path. */
const ROUTES: Readonly<Record<string, Route>> = Object.freeze({
  [HUB_ROUTES.status]: {
    method: 'GET',
    action: 'status.read',
    query: [],
    handle: async ({ store, version }) => ({ response: success({ version, ...await store.status() }) }),
  },
  [HUB_ROUTES.push]: {
    method: 'POST',
    action: 'effort.push',
    query: ['device'],
    handle: async ({ url, request, store }) => {
      const device = readDevice(url);
      const payload = decodeWirePayload(await request.text());
      const pushed = await store.push({ device, payload });
      return { response: success(pushed), fields: { device, received: pushed.received, added: pushed.added } };
    },
  },
  [HUB_ROUTES.pull]: {
    method: 'GET',
    action: 'effort.pull',
    query: ['device', 'since'],
    handle: async ({ url, store }) => {
      const device = readDevice(url);
      const since = readCursor(url);
      const pulled = await store.pull({ device, since });
      return { response: success(pulled), fields: { device, rows: rowCount(pulled.tables) } };
    },
  },
});

/** The answer to a request a route refused, or undefined for an error no route expects. */
function refusedOf(error: unknown): Response | undefined {
  if (error instanceof RequestRefused) return failure(error.status, error.message);
  if (error instanceof WireFormatError) return failure(400, error.message);
  if (error instanceof HubUpgradeRequired) return failure(409, error.message);
  return undefined;
}

/** Holds the store `open` opens, logging each attempt's outcome. */
function holdStore(open: HubServerOptions['openStore'], log: HubLog): StoreHolder {
  let store: HubStore | null = null;
  let opening: Promise<HubStore | null> | null = null;

  const attempt = async (): Promise<HubStore | null> => {
    try {
      store = await open();
      log({ level: 'info', event: 'store.opened' });
      return store;
    } catch (error) {
      log({ level: 'error', event: 'store.unavailable', error: messageOf(error) });
      return null;
    }
  };

  const acquire = (): Promise<HubStore | null> => {
    if (store !== null) return Promise.resolve(store);

    opening ??= attempt().then((opened) => {
      opening = null;
      return opened;
    });
    return opening;
  };

  const close = async (): Promise<void> => {
    if (opening !== null) await opening;
    if (store !== null) await store.close();
  };

  return { acquire, close };
}

/** Everything a request is served with. */
interface Deps {
  readonly identity: HubIdentity;
  readonly holder: StoreHolder;
  readonly version: string;
}

/** `GET /health`: whether the store is open, asking no identity. */
async function health(holder: StoreHolder, version: string): Promise<Served> {
  const store = await holder.acquire();
  return store === null
    ? { response: failure(503, STORE_UNAVAILABLE) }
    : { response: success({ status: 'ok', version }) };
}

/** Serves `request` behind the identity port, once its route and method are known. */
async function serveRoute(request: Request, url: URL, route: Route, deps: Deps): Promise<Served> {
  const identified = await deps.identity.identify(request);
  if (!identified.served) return { response: refusalResponse(identified.refusal), refusal: identified.refusal.reason };

  const { caller } = identified;
  if (!identified.may.includes(route.action)) {
    return { response: failure(403, `${caller.id} may not take ${route.action} on this hub.`), caller, refusal: 'forbidden' };
  }
  const store = await deps.holder.acquire();
  if (store === null) return { response: failure(503, STORE_UNAVAILABLE), caller };

  try {
    checkQuery(url, route.query);
    return { ...await route.handle({ url, request, store, version: deps.version }), caller };
  } catch (error) {
    const refused = refusedOf(error);
    if (refused === undefined) throw error;
    return { response: refused, caller, fields: { error: messageOf(error) } };
  }
}

/** Serves `request`: the route its path and method name, or `404` and `405`. */
function dispatch(request: Request, deps: Deps): Promise<Served> {
  const url = new URL(request.url);
  const isHealth = url.pathname === HUB_ROUTES.health;
  const route = isHealth
    ? undefined
    : ROUTES[url.pathname];
  const method = isHealth
    ? 'GET'
    : route?.method;
  if (method === undefined) return Promise.resolve({ response: failure(404, `No route serves ${url.pathname}.`) });
  if (request.method !== method) {
    return Promise.resolve({ response: failure(405, `${url.pathname} answers ${method} only.`, { allow: method }) });
  }
  return route === undefined
    ? health(deps.holder, deps.version)
    : serveRoute(request, url, route, deps);
}

/** The level a request's line is logged at, by its status. */
function levelOf(status: number): HubLogLevel {
  if (status >= 500) return 'error';
  return status >= 400
    ? 'warn'
    : 'info';
}

/** The `request` log line for one served request. */
function requestLine(request: Request, served: Served, started: number): HubLogEntry {
  const { response, caller, refusal, fields } = served;
  return {
    level: levelOf(response.status),
    event: 'request',
    method: request.method,
    path: new URL(request.url).pathname,
    status: response.status,
    ms: Math.round(performance.now() - started),
    ...caller === undefined
      ? {}
      : { caller: caller.id, provider: caller.provider },
    ...refusal === undefined
      ? {}
      : { refusal },
    ...fields,
  };
}

/**
 * Starts the hub on `options.port` and starts opening the store; see
 * the module note. Returns once the server listens, whether or not the
 * store opens.
 */
export function startHubServer(options: HubServerOptions): HubServer {
  const log = options.log ?? jsonLineLog();
  const holder = holdStore(options.openStore, log);
  const deps: Deps = { identity: options.identity, holder, version: options.version };

  const fetch = async (request: Request): Promise<Response> => {
    const started = performance.now();
    let served: Served;
    try {
      served = await dispatch(request, deps);
    } catch (error) {
      log({ level: 'error', event: 'request.failed', path: new URL(request.url).pathname, error: messageOf(error) });
      served = { response: failure(500, INTERNAL_ERROR) };
    }
    log(requestLine(request, served, started));
    return served.response;
  };

  const server = Bun.serve({ port: options.port, hostname: options.hostname ?? DEFAULT_HOSTNAME, fetch });
  const port = server.port ?? options.port;
  log({ level: 'info', event: 'listening', port, version: options.version });
  void holder.acquire();

  return {
    url: server.url.href.replace(/\/$/, ''),
    port,
    stop: async () => {
      await server.stop(true);
      await holder.close();
      log({ level: 'info', event: 'stopped' });
    },
  };
}
