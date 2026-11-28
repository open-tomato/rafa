/**
 * The hub HTTP client: the three calls the `service` sync strategy makes
 * to `rafa-hub` (`packages/rafa-hub/src/server.ts`), each request under
 * one `hub.timeout` abort and each call telling an unreachable hub apart
 * from one that answered and refused.
 *
 * ## The calls
 *
 *   - {@link HubClient.push}: `POST /v1/effort/push?device=<origin>`, the
 *     body a wire payload as core's `encodeWirePayload` writes it;
 *     answers what the hub received and added.
 *   - {@link HubClient.pull}: `GET /v1/effort/pull?device=<origin>`, with
 *     `since=<cursor as JSON>` unless the cursor is empty; answers the
 *     payload, checked whole by core's `decodeWirePayload`, its
 *     `projected` and `projectedColumns` maps included when the hub
 *     projected it.
 *   - {@link HubClient.status}: `GET /v1/status`; answers the hub's
 *     version, migrations, rows per table and each device's last push,
 *     with the wire contract it speaks, `contractVersion` and
 *     `capabilities`, the projects it serves, `projects`, and its
 *     payload cap, `maxPayloadRows` (`null` when it names none).
 *
 * ## The contract version
 *
 * A client reads `/v1/status` once and keeps the answer: a push or a
 * pull reads it first unless it is kept, and a later `status()` answers
 * the kept one. A read that fails is not kept, so the next call reads
 * again. A hub one release behind answers no `contractVersion` and no
 * `capabilities`; the answer then reads as version `1` with no
 * capability and {@link HubStatusAnswer.contractNamed} false, and push
 * and pull send no `contractVersion` field, since that hub refuses a
 * query name it does not read. A hub that names a version is sent this
 * rafa's own, core's `WIRE_CONTRACT_VERSION`, as `contractVersion=<n>`
 * on push and pull. Whether the two versions match is not this
 * client's to judge: it sends what it speaks, and the hub refuses
 * another with a `409`.
 *
 * ## The projected pull
 *
 * A caller asks for a projected pull by handing `pull` its store's
 * migration ids ({@link HubPullOptions.migrations}). They are sent as
 * `migrations=<ids>`, comma-separated, only to a hub whose status
 * answered `capabilities.projection: true`: a hub naming no such
 * capability, one release behind among them, is sent no such field, as
 * it is sent no `contractVersion`, and answers the pull whole. The
 * answer's `projected` field, each cut table's lacking migration ids,
 * and its `projectedColumns` field, each cut table's lost columns, are
 * read by core's codec with the rest of the payload; a table
 * `projected` leaves out came whole.
 * ## The project
 *
 * A hub that serves projects names them on `/v1/status` as `projects`,
 * each by `id` and `name`; a hub one release behind names none, which
 * reads as an empty list with {@link HubStatusAnswer.projectsNamed}
 * false, never as a malformed answer. Push and pull send the
 * {@link HubClientOptions.project} a client is made with as
 * `project=<id>` only when the kept status answer names `projects`, for
 * the same reason as `contractVersion`: that older hub refuses a query
 * name it does not read. A client made with no project sends none.
 * {@link HubClient.projectName} answers the name the kept status answer
 * gives the client's project, {@link projectNameOf} read over it: null
 * when that answer names no entry with the project's id, a hub naming
 * no `projects` and a client made with none among them. It reads no
 * second `/v1/status`.
 *
 * Every call sends the token as `Authorization: Bearer <token>` and
 * reads the hub's one envelope, `{ "success": true, "data": … }` or
 * `{ "success": false, "error": "…" }`. The routes are appended to
 * `hub.url` as written, so a hub served under a path prefix
 * (`https://host/rafa`) is reached under it.
 *
 * ## Unreachable and refused
 *
 * The stage's rule, which `packages/rafa-effort/src/effort/sync/contact.ts` reads by name:
 *
 *   - **{@link HubUnreachable}** (`name` `HubUnreachable`): a connect
 *     failure, the `hub.timeout` abort, or a `5xx`. The command then
 *     prints one line and uses the local store.
 *   - **{@link HubRefused}**: a `4xx`, a `401`/`403` token refusal and
 *     a `409` migration refusal among them, or a redirect. It is NOT
 *     unreachable: hiding it would leave the devices silently apart, so
 *     the caller reports it as the refusal it is, the hub's own error
 *     line quoted. A `409` whose envelope names `missing`, the
 *     migration ids the hub's refusal names (the ones the hub lacks for
 *     a push, the ones the device lacks for a pull the hub cannot
 *     project), carries them as {@link HubRefused.missing}; a `409`
 *     without it, from an older hub, carries none. The message is the
 *     same either way.
 *   - **{@link HubAnswerMalformed}**: a `2xx` whose body is not the
 *     envelope holding the shape the call expects. A hub that answered
 *     is not unreachable either.
 *
 * The abort covers the whole call, reading the answer's body included,
 * so a hub that sends headers and then stalls is still unreachable once
 * the timeout passes. Redirects are not followed (`redirect: 'manual'`):
 * following one would send the token to whatever address the answer
 * names, so a redirect is refused naming where it pointed. No message
 * any of the three errors carries holds the token.
 */
import type { WireCursor, WirePayload } from '@open-tomato/rafa/store';

import { decodeWirePayload, encodeWirePayload, WIRE_CONTRACT_VERSION, WireFormatError } from '@open-tomato/rafa/store';

/** The `name` core's contact matches an unreachable hub by. */
export const HUB_UNREACHABLE = 'HubUnreachable';

/** The path each call reaches, as the hub serves it. */
export const HUB_CLIENT_ROUTES: Readonly<{
  status: '/v1/status';
  push: '/v1/effort/push';
  pull: '/v1/effort/pull';
}> = Object.freeze({
  status: '/v1/status',
  push: '/v1/effort/push',
  pull: '/v1/effort/pull',
});

/** The contract version a status answer naming none is read as: the hub predates the field. */
export const UNNAMED_CONTRACT_VERSION = 1;

/** The lowest status a hub fault answers with. */
const SERVER_ERROR = 500;

/** The lowest status a refusal answers with. */
const CLIENT_ERROR = 400;

/** The status a migration refusal answers with. */
const CONFLICT = 409;

/** The lowest redirect status. */
const REDIRECT = 300;

/** The hub could not be reached: a connect failure, the timeout abort or a `5xx`. */
export class HubUnreachable extends Error {
  override readonly name: 'HubUnreachable' = HUB_UNREACHABLE;
}

/** The hub answered and refused the call: a `4xx` or a redirect. */
export class HubRefused extends Error {
  override readonly name = 'HubRefused';
  /** The status the hub answered with. */
  readonly status: number;
  /** The migration ids a `409` named in `missing`; undefined when it named none. */
  readonly missing?: readonly string[];

  constructor(status: number, message: string, missing?: readonly string[]) {
    super(message);
    this.status = status;
    if (missing !== undefined) this.missing = Object.freeze([...missing]);
  }
}

/** The hub answered `2xx` with a body this client cannot read. */
export class HubAnswerMalformed extends Error {
  override readonly name = 'HubAnswerMalformed';
}

/** What a push answers: the rows the hub received, how many it added, and when. */
export interface HubPushAnswer {
  readonly received: number;
  readonly added: number;
  readonly at: string;
}

/** One device the hub has taken a push from, and when its last push was. */
export interface HubDeviceAnswer {
  readonly device: string;
  readonly lastPushAt: string;
}

/** One project a hub serves, as `/v1/status` names it. */
export interface HubProjectAnswer {
  /** The project's id: its root commit sha, or `default` on a single-project hub. */
  readonly id: string;
  /** The project's name, as `hub.projects` lists it. */
  readonly name: string;
}

/** What a status call answers. */
export interface HubStatusAnswer {
  readonly version: string;
  readonly migrations: readonly string[];
  readonly rows: Readonly<Record<string, number>>;
  readonly devices: readonly HubDeviceAnswer[];
  /** The wire contract version the hub speaks; {@link UNNAMED_CONTRACT_VERSION} when it names none. */
  readonly contractVersion: number;
  /** Which capabilities the hub has, by name; empty when it names none. */
  readonly capabilities: Readonly<Record<string, boolean>>;
  /** Whether the hub named `contractVersion`; push and pull send the field only when it did. */
  readonly contractNamed: boolean;
  /** The projects the hub serves, in the order it names them; empty when it names none. */
  readonly projects: readonly HubProjectAnswer[];
  /** Whether the hub named `projects`; push and pull send `project` only when it did. */
  readonly projectsNamed: boolean;
  /**
   * The most rows the hub takes in one push payload and answers in one pull
   * page; `null` when it names none or answers `null` (no cap).
   */
  readonly maxPayloadRows: number | null;
}

/** What a client is made with. */
export interface HubClientOptions {
  /** The hub's address: the resolved `hub.url`. */
  readonly url: string;
  /** The GitHub token read by `readHubToken`. */
  readonly token: string;
  /** How long one call may take, in milliseconds: the resolved `hub.timeout`. */
  readonly timeoutMs: number;
  /**
   * The project push and pull name, sent as `project` only to a hub
   * whose status names `projects`; none is sent when left out.
   */
  readonly project?: string;
  /** The fetch to call; the global `fetch` when left out. */
  readonly fetch?: typeof fetch;
}

/** How a pull is asked for. */
export interface HubPullOptions {
  /**
   * The pulling store's migration ids, asking for a pull projected to
   * its schema; sent only to a hub whose status answered
   * `capabilities.projection: true`. Left out, the pull is whole.
   */
  readonly migrations?: readonly string[];
}

/** The three calls; see the module note. */
export interface HubClient {
  /** Pushes `payload` as `device`'s rows. */
  readonly push: (device: string, payload: WirePayload) => Promise<HubPushAnswer>;
  /** Pulls the rows other devices created past `since`, projected when `options` asks and the hub can. */
  readonly pull: (device: string, since: WireCursor, options?: HubPullOptions) => Promise<WirePayload>;
  /** The hub's status, read once per client and kept; see the module note. */
  readonly status: () => Promise<HubStatusAnswer>;
  /** The kept status answer's name for the client's project, or null when it names none; see the module note. */
  readonly projectName: () => Promise<string | null>;
}

/** One call to make: its method, path, query and body, and what it is called in a message. */
interface Call {
  readonly method: 'GET' | 'POST';
  readonly path: string;
  readonly query: Readonly<Record<string, string>>;
  readonly body?: string;
  readonly what: string;
}

/** `error`'s message, whatever was thrown. */
function messageOf(error: unknown): string {
  return error instanceof Error
    ? error.message
    : String(error);
}

/** Whether `value` is a plain object. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** `text` read as a JSON object, or undefined when it is none. */
function envelopeOf(text: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(text);
    return isRecord(parsed)
      ? parsed
      : undefined;
  } catch {
    return undefined;
  }
}

/** The `error` line an envelope holds, or undefined when the text is none. */
function envelopeError(text: string): string | undefined {
  const envelope = envelopeOf(text);
  return typeof envelope?.error === 'string'
    ? envelope.error
    : undefined;
}

/** Whether `value` is a list of migration ids: names, none of them empty. */
function isIdList(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((id) => typeof id === 'string' && id !== '');
}

/** The `missing` ids a refusal's envelope names, or undefined when it names no list of ids. */
function envelopeMissing(text: string): readonly string[] | undefined {
  const missing = envelopeOf(text)?.missing;
  return isIdList(missing)
    ? missing
    : undefined;
}

/** Why a call answering `response` with `text` failed, the hub's own line when it sent one. */
function reasonOf(response: Response, text: string): string {
  const said = envelopeError(text);
  return said === undefined
    ? `HTTP ${String(response.status)}`
    : `HTTP ${String(response.status)}: ${said}`;
}

/** The `data` of a success envelope, or a {@link HubAnswerMalformed}. */
function envelopeData(text: string, what: string): unknown {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new HubAnswerMalformed(`the hub's answer to ${what} is not JSON`);
  }
  if (!isRecord(parsed) || parsed.success !== true || !('data' in parsed)) {
    throw new HubAnswerMalformed(`the hub's answer to ${what} is not a success envelope`);
  }
  return parsed.data;
}

/** Whether `value` is a whole number no lower than zero. */
function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

/** `data` as a push answer, or a {@link HubAnswerMalformed}. */
function readPushAnswer(data: unknown): HubPushAnswer {
  if (!isRecord(data) || !isCount(data.received) || !isCount(data.added) || typeof data.at !== 'string') {
    throw new HubAnswerMalformed('the hub\'s answer to push holds no received, added and at');
  }
  return Object.freeze({ received: data.received, added: data.added, at: data.at });
}

/** Whether `value` is a device entry of a status answer. */
function isDevice(value: unknown): value is HubDeviceAnswer {
  return isRecord(value) && typeof value.device === 'string' && typeof value.lastPushAt === 'string';
}

/** Whether `value` names capabilities: an object of booleans. */
function isCapabilities(value: unknown): value is Readonly<Record<string, boolean>> {
  return isRecord(value) && Object.values(value).every((has) => typeof has === 'boolean');
}

/** The contract fields of a status answer's `data`, absent ones read as a hub one release behind. */
function readContract(data: Record<string, unknown>): Pick<HubStatusAnswer, 'contractVersion' | 'capabilities' | 'contractNamed'> {
  const contractNamed = data.contractVersion !== undefined;
  const valid = (!contractNamed || isCount(data.contractVersion))
    && (data.capabilities === undefined || isCapabilities(data.capabilities));
  if (!valid) {
    throw new HubAnswerMalformed('the hub\'s answer to status holds a contractVersion that is not a whole number or capabilities that are not booleans');
  }
  return {
    contractVersion: contractNamed
      ? data.contractVersion as number
      : UNNAMED_CONTRACT_VERSION,
    capabilities: Object.freeze({ ...data.capabilities as Readonly<Record<string, boolean>> | undefined }),
    contractNamed,
  };
}

/** Whether `value` is a project entry of a status answer: an id and a name, both text. */
function isProject(value: unknown): value is HubProjectAnswer {
  return isRecord(value) && typeof value.id === 'string' && typeof value.name === 'string';
}

/** The project fields of a status answer's `data`, absent ones read as a hub one release behind. */
function readProjects(data: Record<string, unknown>): Pick<HubStatusAnswer, 'projects' | 'projectsNamed'> {
  const projectsNamed = data.projects !== undefined;
  if (!projectsNamed) return { projects: Object.freeze([]), projectsNamed };
  if (!Array.isArray(data.projects) || !data.projects.every(isProject)) {
    throw new HubAnswerMalformed('the hub\'s answer to status holds projects that are not a list of id and name strings');
  }
  const projects = data.projects.map(({ id, name }) => Object.freeze({ id, name }));
  return { projects: Object.freeze(projects), projectsNamed };
}

/** The cap a status answer's `data` names: a whole number above zero, or `null` when absent or `null`. */
function readCap(data: Record<string, unknown>): Pick<HubStatusAnswer, 'maxPayloadRows'> {
  const cap = data.maxPayloadRows;
  if (cap === undefined || cap === null) return { maxPayloadRows: null };
  if (!isCount(cap) || cap === 0) {
    throw new HubAnswerMalformed('the hub\'s answer to status holds a maxPayloadRows that is not a whole number above zero');
  }
  return { maxPayloadRows: cap };
}

/** `data` as a status answer, or a {@link HubAnswerMalformed}. */
function readStatusAnswer(data: unknown): HubStatusAnswer {
  const valid = isRecord(data)
    && typeof data.version === 'string'
    && Array.isArray(data.migrations) && data.migrations.every((id) => typeof id === 'string')
    && isRecord(data.rows) && Object.values(data.rows).every(isCount)
    && Array.isArray(data.devices) && data.devices.every(isDevice);
  if (!valid) {
    throw new HubAnswerMalformed('the hub\'s answer to status holds no version, migrations, rows and devices');
  }
  const { version, migrations, rows, devices } = data as unknown as HubStatusAnswer;
  return Object.freeze({ version, migrations, rows, devices, ...readContract(data), ...readProjects(data), ...readCap(data) });
}

/**
 * The name `status` gives `project`: its `projects` entry whose id is
 * `project`, or null when it names no such entry or `project` is left out.
 */
export function projectNameOf(status: HubStatusAnswer, project: string | undefined): string | null {
  if (project === undefined) return null;
  return status.projects.find(({ id }) => id === project)?.name ?? null;
}

/** The `contractVersion` query a push or pull sends to the hub `status` answered: none when it named none. */
function contractQuery(status: HubStatusAnswer): Readonly<Record<string, string>> {
  return status.contractNamed
    ? { contractVersion: String(WIRE_CONTRACT_VERSION) }
    : {};
}

/**
 * The `migrations` query a pull sends: the ids `options` names, to a hub
 * whose status answered `projection: true` only; none otherwise.
 */
function projectionQuery(status: HubStatusAnswer, options: HubPullOptions | undefined): Readonly<Record<string, string>> {
  return options?.migrations !== undefined && status.capabilities.projection === true
    ? { migrations: options.migrations.join(',') }
    : {};
}

/** The `project` query a push or pull sends to the hub `status` answered: none when it named no projects or the client has none. */
function projectQuery(status: HubStatusAnswer, project: string | undefined): Readonly<Record<string, string>> {
  return status.projectsNamed && project !== undefined
    ? { project }
    : {};
}

/** The contract and project query a push or pull sends to the hub `status` answered. */
function syncQuery(status: HubStatusAnswer, options: HubClientOptions): Readonly<Record<string, string>> {
  return { ...projectQuery(status, options.project), ...contractQuery(status) };
}

/** `data` as a wire payload, checked whole by core's codec, or a {@link HubAnswerMalformed}. */
function readPullAnswer(data: unknown): WirePayload {
  try {
    return decodeWirePayload(JSON.stringify(data));
  } catch (error) {
    if (error instanceof WireFormatError) {
      throw new HubAnswerMalformed(`the hub's answer to pull is not a wire payload: ${error.message}`);
    }
    throw error;
  }
}

/** The URL `call` reaches under `base`, kept under any path `base` names. */
function urlOf(base: string, call: Call): string {
  const url = new URL(`${base.replace(/\/+$/, '')}${call.path}`);
  for (const [name, value] of Object.entries(call.query)) url.searchParams.set(name, value);
  return url.href;
}

/** Throws the error an answered `response` whose status is not `2xx` stands for. */
function refuseStatus(response: Response, text: string, call: Call): void {
  const { status } = response;
  if (status >= SERVER_ERROR) {
    throw new HubUnreachable(`the hub answered ${call.what} with ${reasonOf(response, text)}`);
  }
  if (status >= CLIENT_ERROR) {
    const missing = status === CONFLICT
      ? envelopeMissing(text)
      : undefined;
    throw new HubRefused(status, `the hub refused ${call.what}: ${reasonOf(response, text)}`, missing);
  }
  if (status >= REDIRECT) {
    const location = response.headers.get('location') ?? 'nowhere';
    throw new HubRefused(
      status,
      `the hub answered ${call.what} with a redirect (HTTP ${String(status)}) to ${location};`
      + ' set hub.url to the address the hub serves',
    );
  }
}

/** Makes `call`, answering the success envelope's `data`; see the module note. */
async function send(options: HubClientOptions, call: Call): Promise<unknown> {
  const url = urlOf(options.url, call);
  const signal = AbortSignal.timeout(options.timeoutMs);
  const headers: Record<string, string> = { authorization: `Bearer ${options.token}`, accept: 'application/json' };
  if (call.body !== undefined) headers['content-type'] = 'application/json';

  let response: Response;
  let text: string;
  try {
    response = await (options.fetch ?? fetch)(url, { method: call.method, headers, body: call.body, signal, redirect: 'manual' });
    text = await response.text();
  } catch (error) {
    if (signal.aborted) {
      throw new HubUnreachable(`the hub did not answer ${call.what} within ${String(options.timeoutMs)} ms`);
    }
    throw new HubUnreachable(`could not reach the hub for ${call.what}: ${messageOf(error)}`);
  }
  refuseStatus(response, text, call);
  return envelopeData(text, call.what);
}

/** The kept status read of a client: read on the first call, read again after one that failed. */
function keptStatus(options: HubClientOptions): () => Promise<HubStatusAnswer> {
  let kept: Promise<HubStatusAnswer> | undefined;
  return () => {
    kept ??= send(options, { method: 'GET', path: HUB_CLIENT_ROUTES.status, query: {}, what: 'status' })
      .then(readStatusAnswer)
      .catch((error: unknown) => {
        kept = undefined;
        throw error;
      });
    return kept;
  };
}

/** A client of the hub `options` names; see the module note. */
export function createHubClient(options: HubClientOptions): HubClient {
  const status = keptStatus(options);
  return Object.freeze({
    push: async (device: string, payload: WirePayload) => {
      const contract = syncQuery(await status(), options);
      return readPushAnswer(await send(options, {
        method: 'POST',
        path: HUB_CLIENT_ROUTES.push,
        query: { device, ...contract },
        body: encodeWirePayload(payload),
        what: 'push',
      }));
    },
    pull: async (device: string, since: WireCursor, pullOptions?: HubPullOptions) => {
      const answered = await status();
      const contract = { ...syncQuery(answered, options), ...projectionQuery(answered, pullOptions) };
      return readPullAnswer(await send(options, {
        method: 'GET',
        path: HUB_CLIENT_ROUTES.pull,
        query: Object.keys(since).length === 0
          ? { device, ...contract }
          : { device, since: JSON.stringify(since), ...contract },
        what: 'pull',
      }));
    },
    status,
    projectName: async () => projectNameOf(await status(), options.project),
  });
}
