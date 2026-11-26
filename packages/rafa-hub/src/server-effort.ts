/**
 * The hub's two effort routes, `POST /v1/effort/push` and `GET
 * /v1/effort/pull`, as `server.ts` serves them once the caller is served
 * and the store is open: each reads its query, calls the store and
 * answers the data its success envelope holds with the fields its log
 * line adds. A request it cannot serve throws: `RequestRefused`
 * (`server-query.ts`) for a query or a payload it refuses,
 * {@link ProjectionUnsupported} for a pull the store cannot project, and
 * whatever the store or core's wire codec throws. `server.ts` answers
 * every one of them.
 *
 * ## The payload cap
 *
 * The cap is the store's `contract().maxPayloadRows`, the
 * `dangerous.hub.maxPayloadRows` the hub's config handed the store's
 * context, so `/v1/status`, which answers the contract, and the two
 * routes read one number. Under a cap (a whole number above zero):
 *
 *   - a push whose payload carries more rows than the cap, counted
 *     across every table, is refused `413` with
 *     {@link PAYLOAD_OVER_CAP_STATUS}, its error naming the rows it
 *     carried, the cap and `dangerous.hub.maxPayloadRows`, before the
 *     store is called, so nothing of it is taken; a payload of exactly
 *     the cap is served;
 *   - every pull asks the store for one page of at most the cap rows
 *     (`HubPullRequest.limit`), and its cursor resumes past the last row
 *     answered, so a device repeats a pull while its page came back full.
 *
 * A store answering `null` caps nothing: every push is served whole and
 * a pull asks for every row past its cursor, with no `limit`.
 *
 * @module
 */
import type { HubPullRequest, HubServedProject, HubStore } from './store/port.js';
import type { WireCursor } from '@open-tomato/rafa/store';

import { decodeWirePayload, WIRE_FORMAT, WIRE_VERSION } from '@open-tomato/rafa/store';

import { MAX_PAYLOAD_ROWS_KEY } from './config-dangerous.js';
import { checkContractVersion, readDevice, readProject, RequestRefused } from './server-query.js';

/** The query parameters the push route reads; any other is refused. */
export const PUSH_QUERY: readonly string[] = Object.freeze(['device', 'project', 'contractVersion']);

/** The query parameters the pull route reads; any other is refused. */
export const PULL_QUERY: readonly string[] = Object.freeze(['device', 'project', 'since', 'contractVersion', 'migrations']);

/** The status a push carrying more rows than the cap is refused with: `413 Content Too Large`. */
export const PAYLOAD_OVER_CAP_STATUS = 413;

/** One migration id in `migrations`: 1 to 200 printable ASCII characters but the comma that separates them. */
const MIGRATION_ID = /^[!-+\--~]{1,200}$/;

/** What an effort route is handed once the caller is served and the store is open. */
export interface EffortRouteContext {
  readonly url: URL;
  readonly request: Request;
  readonly store: HubStore;
  /** The projects the hub lists, or null on a single-project hub, which serves every project a request names. */
  readonly listed: readonly HubServedProject[] | null;
  /** Starts a rebuild of the index of the project a push named, or queues one; a no-op when the hub rebuilds nothing after a push. Never throws. */
  readonly rebuild: (project: string | undefined) => void;
}

/** What an effort route served: the data its success envelope holds and the fields its log line adds. */
export interface EffortServed {
  readonly data: unknown;
  readonly fields: Readonly<Record<string, unknown>>;
}

/** A pull the store cannot project, naming the migrations the device lacks: `409` with `missing`. */
export class ProjectionUnsupported extends Error {
  override readonly name = 'ProjectionUnsupported';
  /** The ids the store holds that the pulling device lacks, in the store's order. */
  readonly missing: readonly string[];

  constructor(missing: readonly string[]) {
    super(`The pulling store lacks migration ${missing.join(', ')}, and this hub's store cannot project a pull to its schema. Nothing was sent. Next step: rafa self-update, then rafa effort sync.`);
    this.missing = Object.freeze([...missing]);
  }
}

/** The refusal of a push carrying `rows` rows over `cap`, naming the key that sets it. */
export function payloadOverCapMessage(rows: number, cap: number): string {
  return `The push carries ${String(rows)} rows, more than this hub's ${MAX_PAYLOAD_ROWS_KEY} of ${String(cap)}; nothing was taken. Next step: push at most ${String(cap)} rows a payload.`;
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

/**
 * The migration ids `migrations` names, comma-separated, or undefined
 * when left out; refused when an id is empty, is not printable ASCII or
 * is named twice.
 */
function readMigrations(url: URL): readonly string[] | undefined {
  const spelt = url.searchParams.get('migrations');
  if (spelt === null) return undefined;

  const ids = spelt.split(',');
  const malformed = ids.find((id) => !MIGRATION_ID.test(id));
  if (malformed !== undefined) {
    throw new RequestRefused(400, `migrations names ${JSON.stringify(malformed)}; expected migration ids separated by commas, each 1 to 200 printable ASCII characters.`);
  }
  const twice = ids.find((id, index) => ids.indexOf(id) !== index);
  if (twice !== undefined) throw new RequestRefused(400, `migrations names ${twice} more than once.`);
  return ids;
}

/**
 * The pull `store` is handed for a device naming `migrations`: refused
 * with {@link ProjectionUnsupported} when the device lacks an id the
 * store holds and the store cannot project, and naming no `migrations`
 * when the store cannot project and the device lacks none, since such a
 * store is never handed them.
 */
function pullRequestOf(store: HubStore, request: HubPullRequest, migrations: readonly string[] | undefined): HubPullRequest {
  const { capabilities, migrations: held } = store.contract();
  if (migrations === undefined || capabilities.projection) {
    return migrations === undefined
      ? request
      : { ...request, migrations };
  }
  const missing = held.filter((id) => !migrations.includes(id));
  if (missing.length > 0) throw new ProjectionUnsupported(missing);
  return request;
}

/** The pull `limit` the store's cap asks for, none when it caps nothing. */
function limitOf(cap: number | null): Pick<HubPullRequest, 'limit'> {
  return cap === null
    ? {}
    : { limit: cap };
}

/** The log field naming `project`, none when the request named none. */
function projectField(project: string | undefined): Readonly<Record<string, string>> {
  return project === undefined
    ? {}
    : { project };
}

/** The rows across every table of `tables`. */
function rowCount(tables: Readonly<Record<string, readonly unknown[]>>): number {
  return Object.values(tables).reduce((total, rows) => total + rows.length, 0);
}

/**
 * `POST /v1/effort/push`: the device's payload, refused over the cap
 * before the store is called (see the module note), answered with what
 * the store received and added; a push adding rows starts a rebuild.
 */
export async function servePush({ url, request, store, listed, rebuild }: EffortRouteContext): Promise<EffortServed> {
  checkContractVersion(url);
  const device = readDevice(url);
  const project = readProject(url, listed);
  const payload = decodeWirePayload(await request.text());
  const cap = store.contract().maxPayloadRows;
  const carried = rowCount(payload.tables);
  if (cap !== null && carried > cap) throw new RequestRefused(PAYLOAD_OVER_CAP_STATUS, payloadOverCapMessage(carried, cap));

  const pushed = await store.push({ device, project, payload });
  if (pushed.added > 0) rebuild(project);
  return { data: pushed, fields: { device, ...projectField(project), received: pushed.received, added: pushed.added } };
}

/**
 * `GET /v1/effort/pull`: one page of at most the cap rows other origins
 * created past `since` (see the module note), projected as the device's
 * `migrations` and the store's capabilities say.
 */
export async function servePull({ url, store, listed }: EffortRouteContext): Promise<EffortServed> {
  checkContractVersion(url);
  const device = readDevice(url);
  const project = readProject(url, listed);
  const since = readCursor(url);
  const page = { device, project, since, ...limitOf(store.contract().maxPayloadRows) };
  const pulled = await store.pull(pullRequestOf(store, page, readMigrations(url)));
  return { data: pulled, fields: { device, ...projectField(project), rows: rowCount(pulled.tables) } };
}
