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
 *     ids its store holds, its rows per table and each device's last push,
 *     with the store's wire contract beside them: `contractVersion`,
 *     `migrations` (the same ids) and `capabilities`.
 *   - `POST /v1/effort/push?device=<origin>&contractVersion=<n>`
 *     (`effort.push`): the body is a wire payload as core's
 *     `encodeWirePayload` writes it, checked by core's
 *     `decodeWirePayload`; answers what the push received and added.
 *   - `GET /v1/effort/pull?device=<origin>&since=<cursor>&contractVersion=<n>`
 *     (`effort.pull`): the rows other origins created past `since`, a
 *     wire cursor as JSON text and read from the start when left out, as
 *     a wire payload.
 *
 * `device` is the calling store's origin, its rows' `origin_store`.
 * `contractVersion` is the wire contract version the caller speaks, a
 * whole number above zero written in digits, `1` when left out; the
 * hub speaks core's `WIRE_CONTRACT_VERSION` and serves no other. A
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
 *     `contractVersion` that is not a whole number above zero and a
 *     `WireFormatError` from the store included;
 *   - `409` with `"code": "contract-unsupported"` for a push or a pull
 *     naming a contract version the hub does not speak, its error naming
 *     both versions; refused once the query is read, before the body is
 *     decoded or the store is called;
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
 * The store is opened by `openConnected` when it is given, a connector
 * opening the store and its index (`store/port.ts`, `HubConnector`)
 * together, and by `openStore` otherwise, which opens a store with no
 * index behind it. One of the two must be given.
 *
 * ## The index
 *
 * With `rebuildAfterPush` set, a push whose answer has `added` above
 * zero starts one `index.rebuild({ project })` over the index
 * `openConnected` opened, `project` being the hub's repository. The
 * push is answered without awaiting it, and its status and body are the
 * same whatever the rebuild does. At most one rebuild runs at a time: a
 * push adding rows while one runs queues one more, which starts once it
 * ends, and further pushes during it queue nothing beyond that one, since
 * one rebuild reads every row the store holds when it starts. A push
 * adding nothing starts none. Each rebuild logs one `index.rebuilt` line
 * with its counts or one `index.rebuild-failed` line with its error; a
 * failed rebuild leaves the live index as it was and the next push adding
 * rows starts another. `stop` awaits a running rebuild before closing the
 * store, and drops a queued one, which the next start's first push adding
 * rows or `rafa-hub index rebuild` makes up. `rebuildAfterPush` without
 * `openConnected` or `project` is refused when the server starts, since
 * there is no index to rebuild or no project to name.
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
 * An index rebuild logs `index.rebuilt` at `info`, holding its project,
 * `rows`, `vectors`, `vector`, its `tables` with their rows and its
 * milliseconds, or `index.rebuild-failed` at `error`, holding its project,
 * the error's message and its milliseconds.
 */
import type { HubAction, HubCaller, HubIdentity, IdentityRefusal, IdentityRefusalReason } from './identity/port.js';
import type { HubIndex, HubStore } from './store/port.js';
import type { WireCursor } from '@open-tomato/rafa/store';

import { decodeWirePayload, WIRE_CONTRACT_VERSION, WIRE_FORMAT, WIRE_VERSION, WireFormatError } from '@open-tomato/rafa/store';

import { HubUpgradeRequired } from './store/sqlite.js';

/** The path each route answers on. */
export const HUB_ROUTES: Readonly<{
  health: '/health';
  status: '/v1/status';
  push: '/v1/effort/push';
  pull: '/v1/effort/pull';
}> = Object.freeze({
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

/** The `code` a `409` carries for a contract version the hub does not speak. */
export const CONTRACT_UNSUPPORTED = 'contract-unsupported';

/** A `contractVersion` as the query spells it: a whole number above zero, in digits with no leading zero. */
const CONTRACT_VERSION = /^[1-9][0-9]*$/;

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
  /** Opens a store with no index behind it; may throw, or reject, when it cannot. Unused when `openConnected` is given. */
  readonly openStore?: () => HubStore | Promise<HubStore>;
  /** Opens the store and its index together, as a connector does; used instead of `openStore` when given. */
  readonly openConnected?: () => Promise<HubConnected>;
  /** Whether a push that added rows starts an index rebuild; see the module note. `false` when left out. */
  readonly rebuildAfterPush?: boolean;
  /** The project a rebuild records, the hub's repository; required with `rebuildAfterPush`. */
  readonly project?: string;
  /** Where log lines go; {@link jsonLineLog} to standard output when left out. */
  readonly log?: HubLog;
}

/** What `openConnected` opens: the store and the index over its rows. */
export interface HubConnected {
  readonly store: HubStore;
  readonly index: HubIndex;
}

/** A running hub. */
export interface HubServer {
  /** The URL it answers on, with no trailing slash. */
  readonly url: string;
  /** The port it listens on. */
  readonly port: number;
  /** Stops answering, closing open connections, then awaits a running index rebuild and closes the store. */
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

/** A push or a pull naming a contract version the hub does not speak: `409`, with {@link CONTRACT_UNSUPPORTED}. */
class ContractUnsupported extends Error {
  override readonly name = 'ContractUnsupported';

  constructor(asked: number) {
    super(`The request speaks wire contract version ${String(asked)}; this hub speaks version ${String(WIRE_CONTRACT_VERSION)}.`);
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
  /** Starts an index rebuild, or queues one; a no-op when the hub rebuilds nothing after a push. Never throws. */
  readonly rebuild: () => void;
}

/** A route behind the identity port. */
interface Route {
  readonly method: 'GET' | 'POST';
  readonly action: HubAction;
  /** The query parameters it reads; any other is refused. */
  readonly query: readonly string[];
  readonly handle: (context: RouteContext) => Promise<Omit<Served, 'caller'>>;
}

/** The open store, with the rebuild a push adding rows starts. */
interface Held {
  readonly store: HubStore;
  readonly rebuild: () => void;
}

/** The store, opened once and opened again after a failed attempt. */
interface StoreHolder {
  /** The open store, or null when this attempt to open it failed. */
  readonly acquire: () => Promise<Held | null>;
  /** Awaits a running rebuild, then closes the store if it opened. */
  readonly close: () => Promise<void>;
}

/** Index rebuilds, one at a time with one queued. */
interface Rebuilds {
  /** Starts a rebuild, or queues one while one runs. */
  readonly request: () => void;
  /** Drops a queued rebuild and awaits the running one. */
  readonly settle: () => Promise<void>;
}

/** What a hub that rebuilds nothing after a push holds. */
const NO_REBUILDS: Rebuilds = Object.freeze({
  request: () => undefined,
  settle: () => Promise.resolve(),
});

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

/** A `409` refusing a contract version, with its `code`. */
function contractRefusal(error: ContractUnsupported): Response {
  return answer(409, { success: false, error: error.message, code: CONTRACT_UNSUPPORTED });
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

/**
 * Refuses the contract version the query names unless it is the hub's,
 * `1` when left out: `400` for a value that is not a whole number above
 * zero, {@link ContractUnsupported} for another version.
 */
function checkContractVersion(url: URL): void {
  const spelt = url.searchParams.get('contractVersion');
  if (spelt === null) return;

  const asked = Number(spelt);
  if (!CONTRACT_VERSION.test(spelt) || !Number.isSafeInteger(asked)) {
    throw new RequestRefused(400, `contractVersion is ${JSON.stringify(spelt)}; expected a whole number above zero, such as ${String(WIRE_CONTRACT_VERSION)}.`);
  }
  if (asked !== WIRE_CONTRACT_VERSION) throw new ContractUnsupported(asked);
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
    handle: async ({ store, version }) => ({ response: success({ version, ...await store.status(), ...store.contract() }) }),
  },
  [HUB_ROUTES.push]: {
    method: 'POST',
    action: 'effort.push',
    query: ['device', 'contractVersion'],
    handle: async ({ url, request, store, rebuild }) => {
      checkContractVersion(url);
      const device = readDevice(url);
      const payload = decodeWirePayload(await request.text());
      const pushed = await store.push({ device, payload });
      if (pushed.added > 0) rebuild();
      return { response: success(pushed), fields: { device, received: pushed.received, added: pushed.added } };
    },
  },
  [HUB_ROUTES.pull]: {
    method: 'GET',
    action: 'effort.pull',
    query: ['device', 'since', 'contractVersion'],
    handle: async ({ url, store }) => {
      checkContractVersion(url);
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
  if (error instanceof ContractUnsupported) return contractRefusal(error);
  if (error instanceof WireFormatError) return failure(400, error.message);
  if (error instanceof HubUpgradeRequired) return failure(409, error.message);
  return undefined;
}

/**
 * Rebuilds of `index` recording `project`, each logged; see the module
 * note. A rebuild that throws, synchronously or not, is logged and never
 * reaches the caller of `request`.
 */
function rebuildsOf(index: HubIndex, project: string, log: HubLog): Rebuilds {
  let running: Promise<void> | null = null;
  let queued = false;

  const run = async (): Promise<void> => {
    const started = performance.now();
    try {
      const built = await index.rebuild({ project });
      const tables = built.tables.map(({ table, rows }) => ({ table, rows }));
      log({ level: 'info', event: 'index.rebuilt', project, rows: built.rows, vectors: built.vectors, vector: built.vector, tables, ms: Math.round(performance.now() - started) });
    } catch (error) {
      log({ level: 'error', event: 'index.rebuild-failed', project, error: messageOf(error), ms: Math.round(performance.now() - started) });
    }
  };

  const begin = (): void => {
    running = run().then(() => {
      running = null;
      if (!queued) return;

      queued = false;
      begin();
    });
  };

  const request = (): void => {
    if (running === null) {
      begin();
      return;
    }
    queued = true;
  };

  const settle = async (): Promise<void> => {
    queued = false;
    if (running !== null) await running;
  };

  return { request, settle };
}

/** What {@link holdStore} opens with. */
interface Opening {
  /** Opens the store, with its index when the hub was given a connector. */
  readonly open: () => Promise<{ readonly store: HubStore; readonly index: HubIndex | null }>;
  /** The project rebuilds record, or null when a push starts none. */
  readonly rebuildFor: string | null;
}

/** Holds the store `opening` opens, logging each attempt's outcome. */
function holdStore(opening: Opening, log: HubLog): StoreHolder {
  let held: Held | null = null;
  let rebuilds: Rebuilds = NO_REBUILDS;
  let attempting: Promise<Held | null> | null = null;

  const attempt = async (): Promise<Held | null> => {
    try {
      const { store, index } = await opening.open();
      if (index !== null && opening.rebuildFor !== null) rebuilds = rebuildsOf(index, opening.rebuildFor, log);
      held = { store, rebuild: rebuilds.request };
      log({ level: 'info', event: 'store.opened' });
      return held;
    } catch (error) {
      log({ level: 'error', event: 'store.unavailable', error: messageOf(error) });
      return null;
    }
  };

  const acquire = (): Promise<Held | null> => {
    if (held !== null) return Promise.resolve(held);

    attempting ??= attempt().then((opened) => {
      attempting = null;
      return opened;
    });
    return attempting;
  };

  const close = async (): Promise<void> => {
    if (attempting !== null) await attempting;
    await rebuilds.settle();
    if (held !== null) await held.store.close();
  };

  return { acquire, close };
}

/**
 * How `options` opens the store, refusing options that open none, or
 * that rebuild after a push with no index or no project to name.
 */
function openingOf(options: HubServerOptions): Opening {
  const { openStore, openConnected, rebuildAfterPush = false, project } = options;
  if (rebuildAfterPush && openConnected === undefined) {
    throw new TypeError('rebuildAfterPush needs openConnected: a store opened by openStore has no index to rebuild.');
  }
  if (rebuildAfterPush && (project === undefined || project === '')) {
    throw new TypeError('rebuildAfterPush needs project, the repository a rebuild records.');
  }
  const rebuildFor = rebuildAfterPush
    ? project ?? null
    : null;
  if (openConnected !== undefined) return { open: openConnected, rebuildFor };
  if (openStore === undefined) throw new TypeError('startHubServer needs openStore or openConnected to open its store.');

  return { open: async () => ({ store: await openStore(), index: null }), rebuildFor };
}

/** Everything a request is served with. */
interface Deps {
  readonly identity: HubIdentity;
  readonly holder: StoreHolder;
  readonly version: string;
}

/** `GET /health`: whether the store is open, asking no identity. */
async function health(holder: StoreHolder, version: string): Promise<Served> {
  const held = await holder.acquire();
  return held === null
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
  const held = await deps.holder.acquire();
  if (held === null) return { response: failure(503, STORE_UNAVAILABLE), caller };

  try {
    checkQuery(url, route.query);
    return { ...await route.handle({ url, request, store: held.store, rebuild: held.rebuild, version: deps.version }), caller };
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
 * store opens. Throws a `TypeError`, before listening, for options
 * opening no store or rebuilding after a push with no index or project.
 */
export function startHubServer(options: HubServerOptions): HubServer {
  const log = options.log ?? jsonLineLog();
  const holder = holdStore(openingOf(options), log);
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
