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
 *     `migrations` (the same ids), `capabilities` and `maxPayloadRows`,
 *     the payload cap (`null` for none). The rows, devices
 *     and migrations are the first served project's, and `projects`
 *     names every project the store serves, each by `id` and `name` in
 *     the order listed, as the store's `status()` answers them; a store
 *     answering none leaves `projects` out.
 *   - `POST /v1/effort/push?device=<origin>&project=<id>&contractVersion=<n>`
 *     (`effort.push`): the body is a wire payload as core's
 *     `encodeWirePayload` writes it, checked by core's
 *     `decodeWirePayload`; answers what the push received and added. A
 *     payload carrying more rows than the cap is refused.
 *   - `GET /v1/effort/pull?device=<origin>&project=<id>&since=<cursor>&contractVersion=<n>&migrations=<ids>`
 *     (`effort.pull`): the rows other origins created past `since`, a
 *     wire cursor as JSON text and read from the start when left out, as
 *     a wire payload. `migrations` is the pulling store's migration ids,
 *     comma-separated: a pull naming them is answered projected to that
 *     schema when the store holds an id they leave out, and whole when
 *     they name every id it holds; left out, the pull is answered whole.
 *     Under a cap the answer is one page of at most the cap rows, its
 *     cursor past the last row answered.
 *
 * The two effort routes are served by `server-effort.ts`, whose module
 * note gives the cap: the store's `contract().maxPayloadRows`, as
 * `dangerous.hub.maxPayloadRows` set it, so the status answer and the
 * routes read one number.
 *
 * `device` is the calling store's origin, its rows' `origin_store`.
 * `project` is the project the rows are for, its root commit sha as 40
 * lowercase hex characters; a request naming none is the first listed
 * project's, as the store reads it. On a hub handed no
 * {@link HubServerOptions.projects}, or the one `default` project alone,
 * every project a request names is served, in the one project of a
 * single-project hub. `contractVersion` is the wire contract version the caller speaks, a
 * whole number above zero written in digits, `1` when left out; the
 * hub speaks core's `WIRE_CONTRACT_VERSION` and serves no other. A
 * route takes no query parameter it does not name, so a misspelt one
 * (`cursor=` for `since=`) is refused rather than read as absent. `GET
 * /v1/settings/locked` is the second plan's, and answers `404` here.
 *
 * ## The login and the key routes
 *
 * Handed {@link HubServerOptions.keys}, the server answers every path
 * `isKeyPath` claims (`/v1/keys` and below it, `server-keys.ts`) through
 * it, and handed {@link HubServerOptions.login} every path `isLoginPath`
 * claims (`/login` and below it, `server-login.ts`); left out, those
 * paths answer `404`. Neither asks the identity port nor opens the
 * project store: each is behind the login it was opened with, which in
 * turn is asked on no other route, so a login's basic credentials or
 * cookie sent to `/v1/status`, `/v1/effort/push` or `/v1/effort/pull`
 * reach the identity port alone, which refuses them `unauthenticated`.
 * Their answers keep their own envelope and headers; the `request` line
 * names the login's `user` in place of a caller.
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
 *     `contractVersion` that is not a whole number above zero, a
 *     `project` that is not a root commit sha and a `WireFormatError`
 *     from the store included;
 *   - `404` for a push or a pull naming a project the hub does not
 *     serve, its error the store's `HubProjectNotServed` line,
 *     `rafa-hub: project <id> is not served here; add it under
 *     hub.projects`: refused once the query is read, before the body is
 *     read, when the project is not among
 *     {@link HubServerOptions.projects}, and by the store's own refusal
 *     otherwise;
 *   - `409` with `"code": "contract-unsupported"` for a push or a pull
 *     naming a contract version the hub does not speak, its error naming
 *     both versions; refused once the query is read, before the body is
 *     decoded or the store is called;
 *   - `413` for a push carrying more rows than the cap, its error naming
 *     the rows, the cap and `dangerous.hub.maxPayloadRows`, refused once
 *     the body is decoded, before the store is called;
 *   - `409` with `missing`, the migrations the device lacks, for a pull
 *     whose `migrations` leave out an id the store holds when the store's
 *     `capabilities.projection` is `false`, refused before the store is
 *     called: such a store is never handed a pull naming `migrations`;
 *   - `409` with `missing`, the migrations the hub lacks, for a push the
 *     store refuses with `HubUpgradeRequired`: its message names them and
 *     the upgrade to run;
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
 * `openConnected` opened, for the pushed project's index: `project` is
 * the project the push named, or the first listed project's id for a
 * push naming none, and on a single-project hub always
 * {@link HubServerOptions.project}, the hub's repository, whatever the
 * push named. The push is answered without awaiting it, and its status
 * and body are the same whatever the rebuild does. At most one rebuild
 * of a project runs at a time: a push to it adding rows while one runs
 * queues one more, which starts once it ends, and further pushes to it
 * during it queue nothing beyond that one, since one rebuild reads every
 * row the project's store holds when it starts. Two projects' rebuilds
 * run side by side, each over its own index. A push adding nothing
 * starts none. Each rebuild logs one `index.rebuilt` line
 * with its counts or one `index.rebuild-failed` line with its error; a
 * failed rebuild leaves the live index as it was and the next push adding
 * rows starts another. `stop` awaits every running rebuild before closing
 * the store, and drops every queued one, which the next start's first push
 * adding rows or `rafa-hub index rebuild` makes up. `rebuildAfterPush`
 * without `openConnected`, or on a single-project hub without `project`,
 * is refused when the server starts, since there is no index to rebuild
 * or no project to name.
 *
 * ## Logs
 *
 * One JSON object per line on standard output, never a file, through
 * {@link jsonLineLog}: `time`, `level`, `event`, then the event's fields.
 * Every request logs one `request` line holding its method, path,
 * status and milliseconds, the caller when the identity port named one,
 * the refusal reason when it refused, the device with its row counts
 * for a push or a pull, the project when the request named one, and
 * the error a `4xx` from the route answered.
 * A line never holds a request's headers or its query, so no token
 * reaches the log; of a body it holds only what a wire refusal quotes.
 * An index rebuild logs `index.rebuilt` at `info`, holding its project,
 * `rows`, `vectors`, `vector`, its `tables` with their rows and its
 * milliseconds, or `index.rebuild-failed` at `error`, holding its project,
 * the error's message and its milliseconds.
 */
import type { HubAction, HubCaller, HubIdentity, IdentityRefusal, IdentityRefusalReason } from './identity/port.js';
import type { EffortRouteContext, EffortServed } from './server-effort.js';
import type { HubKeyRoutes } from './server-keys.js';
import type { HubLoginRoutes } from './server-login.js';
import type { HubIndex, HubServedProject, HubStore } from './store/port.js';

import { WireFormatError } from '@open-tomato/rafa/store';

import { ProjectionUnsupported, PULL_QUERY, PUSH_QUERY, servePull, servePush } from './server-effort.js';
import { isKeyPath } from './server-keys.js';
import { isLoginPath } from './server-login.js';
import { checkQuery, ContractUnsupported, RequestRefused } from './server-query.js';
import { HubProjectNotServed, HubUpgradeRequired, servesOneProject } from './store/sqlite.js';

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
  /** The project a rebuild records on a single-project hub, the hub's repository; required there with `rebuildAfterPush`. */
  readonly project?: string;
  /**
   * The projects the store serves, as the connector was handed them, in
   * `hub.projects` order: a push or a pull naming another is refused
   * `404` before its body is read, and a rebuild after a push names the
   * pushed project. Left out, empty, or the one `default` project alone,
   * the hub is single-project; see the module note.
   */
  readonly projects?: readonly HubServedProject[];
  /** Where log lines go; {@link jsonLineLog} to standard output when left out. */
  readonly log?: HubLog;
  /** The key page and the OAuth routes, answering `/login` and below it; `404` there when left out. */
  readonly login?: HubLoginRoutes;
  /** The key routes, answering `/v1/keys` and below it; `404` there when left out. */
  readonly keys?: HubKeyRoutes;
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

/** A request's answer, with what its log line adds. */
interface Served {
  readonly response: Response;
  readonly caller?: HubCaller;
  /** The login's user, on a login or key route the login served. */
  readonly user?: string;
  readonly refusal?: IdentityRefusalReason;
  readonly fields?: Readonly<Record<string, unknown>>;
}

/** What a route's handler is handed once the caller is served and the store is open: an effort route's context, with the hub's version. */
interface RouteContext extends EffortRouteContext {
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

/** The open store, with the rebuild a push adding rows starts. */
interface Held {
  readonly store: HubStore;
  readonly rebuild: (project: string | undefined) => void;
}

/** The store, opened once and opened again after a failed attempt. */
interface StoreHolder {
  /** The open store, or null when this attempt to open it failed. */
  readonly acquire: () => Promise<Held | null>;
  /** Awaits a running rebuild, then closes the store if it opened. */
  readonly close: () => Promise<void>;
}

/** Index rebuilds, one at a time per project with one queued. */
interface Rebuilds {
  /** Starts a rebuild of `project`'s index, or queues one while one of it runs. */
  readonly request: (project: string) => void;
  /** Drops every queued rebuild and awaits every running one. */
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

/** An effort route's answer: its data in a success envelope, with its log fields. */
function servedOf({ data, fields }: EffortServed): Omit<Served, 'caller'> {
  return { response: success(data), fields };
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
    query: PUSH_QUERY,
    handle: async (context) => servedOf(await servePush(context)),
  },
  [HUB_ROUTES.pull]: {
    method: 'GET',
    action: 'effort.pull',
    query: PULL_QUERY,
    handle: async (context) => servedOf(await servePull(context)),
  },
});

/** The answer to a request a route refused, or undefined for an error no route expects. */
function refusedOf(error: unknown): Response | undefined {
  if (error instanceof RequestRefused) return failure(error.status, error.message);
  if (error instanceof ContractUnsupported) return contractRefusal(error);
  if (error instanceof HubProjectNotServed) return failure(404, error.message);
  if (error instanceof WireFormatError) return failure(400, error.message);
  if (error instanceof ProjectionUnsupported || error instanceof HubUpgradeRequired) {
    return answer(409, { success: false, error: error.message, missing: error.missing });
  }
  return undefined;
}

/**
 * Rebuilds of `index`, each logged with the project it records; see the
 * module note. A rebuild that throws, synchronously or not, is logged
 * and never reaches the caller of `request`.
 */
function rebuildsOf(index: HubIndex, log: HubLog): Rebuilds {
  const running = new Map<string, Promise<void>>();
  const queued = new Set<string>();

  const run = async (project: string): Promise<void> => {
    const started = performance.now();
    try {
      const built = await index.rebuild({ project });
      const tables = built.tables.map(({ table, rows }) => ({ table, rows }));
      log({ level: 'info', event: 'index.rebuilt', project, rows: built.rows, vectors: built.vectors, vector: built.vector, tables, ms: Math.round(performance.now() - started) });
    } catch (error) {
      log({ level: 'error', event: 'index.rebuild-failed', project, error: messageOf(error), ms: Math.round(performance.now() - started) });
    }
  };

  const begin = (project: string): void => {
    running.set(project, run(project).then(() => {
      running.delete(project);
      if (queued.delete(project)) begin(project);
    }));
  };

  const request = (project: string): void => {
    if (running.has(project)) {
      queued.add(project);
      return;
    }
    begin(project);
  };

  const settle = async (): Promise<void> => {
    queued.clear();
    await Promise.all(running.values());
  };

  return { request, settle };
}

/** What {@link holdStore} opens with. */
interface Opening {
  /** Opens the store, with its index when the hub was given a connector. */
  readonly open: () => Promise<{ readonly store: HubStore; readonly index: HubIndex | null }>;
  /** The project a rebuild after a push naming `project` records, or null when a push starts none. */
  readonly rebuildFor: ((project: string | undefined) => string) | null;
}

/** Holds the store `opening` opens, logging each attempt's outcome. */
function holdStore(opening: Opening, log: HubLog): StoreHolder {
  let held: Held | null = null;
  let rebuilds: Rebuilds = NO_REBUILDS;
  let attempting: Promise<Held | null> | null = null;

  const attempt = async (): Promise<Held | null> => {
    try {
      const { store, index } = await opening.open();
      const { rebuildFor } = opening;
      if (index !== null && rebuildFor !== null) rebuilds = rebuildsOf(index, log);
      held = {
        store,
        rebuild: (project) => {
          if (rebuildFor !== null) rebuilds.request(rebuildFor(project));
        },
      };
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

/** The projects `options` lists, or null for a single-project hub; see the module note. */
function listedOf(options: HubServerOptions): readonly HubServedProject[] | null {
  const listed = options.projects ?? [];
  return servesOneProject(listed)
    ? null
    : listed;
}

/**
 * The project a rebuild after a push records: on a single-project hub
 * `project`, the hub's repository, whatever the push named; otherwise
 * the pushed project, the first listed one's for a push naming none.
 * Null when `project` is needed and not given.
 */
function rebuildTargetOf(listed: readonly HubServedProject[] | null, project: string | undefined): ((pushed: string | undefined) => string) | null {
  if (listed === null) {
    return project === undefined || project === ''
      ? null
      : () => project;
  }
  const [first] = listed as [HubServedProject, ...HubServedProject[]];
  return (pushed) => pushed ?? first.id;
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
  const target = rebuildTargetOf(listedOf(options), project);
  if (rebuildAfterPush && target === null) {
    throw new TypeError('rebuildAfterPush needs project on a single-project hub, the repository a rebuild records.');
  }
  const rebuildFor = rebuildAfterPush
    ? target
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
  readonly listed: readonly HubServedProject[] | null;
  readonly login: HubLoginRoutes | undefined;
  readonly keys: HubKeyRoutes | undefined;
}

/** The login or key routes that serve `pathname`, or undefined when none were handed the server. */
function loginRoutesOf(pathname: string, deps: Deps): HubLoginRoutes | HubKeyRoutes | undefined {
  if (isKeyPath(pathname)) return deps.keys;
  return isLoginPath(pathname)
    ? deps.login
    : undefined;
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
    return { ...await route.handle({ url, request, store: held.store, rebuild: held.rebuild, version: deps.version, listed: deps.listed }), caller };
  } catch (error) {
    const refused = refusedOf(error);
    if (refused === undefined) throw error;
    return { response: refused, caller, fields: { error: messageOf(error) } };
  }
}

/** Serves `request`: the route its path and method name, or `404` and `405`. */
function dispatch(request: Request, deps: Deps): Promise<Served> {
  const url = new URL(request.url);
  const behindLogin = loginRoutesOf(url.pathname, deps);
  if (behindLogin !== undefined) return behindLogin.serve(request);
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
  const { response, caller, user, refusal, fields } = served;
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
    ...user === undefined
      ? {}
      : { user },
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
 * opening no store, or rebuilding after a push with no index, or on a
 * single-project hub with no project.
 */
export function startHubServer(options: HubServerOptions): HubServer {
  const log = options.log ?? jsonLineLog();
  const holder = holdStore(openingOf(options), log);
  const deps: Deps = { identity: options.identity, holder, version: options.version, listed: listedOf(options), login: options.login, keys: options.keys };

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
