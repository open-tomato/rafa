/**
 * The hub HTTP client: the three calls the `service` sync strategy makes
 * to `rafa-hub` (`packages/rafa-hub/src/server.ts`), each under one
 * `hub.timeout` abort and each telling an unreachable hub apart from one
 * that answered and refused.
 *
 * ## The calls
 *
 *   - {@link HubClient.push}: `POST /v1/effort/push?device=<origin>`, the
 *     body a wire payload as core's `encodeWirePayload` writes it;
 *     answers what the hub received and added.
 *   - {@link HubClient.pull}: `GET /v1/effort/pull?device=<origin>`, with
 *     `since=<cursor as JSON>` unless the cursor is empty; answers the
 *     payload, checked whole by core's `decodeWirePayload`.
 *   - {@link HubClient.status}: `GET /v1/status`; answers the hub's
 *     version, migrations, rows per table and each device's last push.
 *
 * Every call sends the token as `Authorization: Bearer <token>` and
 * reads the hub's one envelope, `{ "success": true, "data": … }` or
 * `{ "success": false, "error": "…" }`. The routes are appended to
 * `hub.url` as written, so a hub served under a path prefix
 * (`https://host/rafa`) is reached under it.
 *
 * ## Unreachable and refused
 *
 * The stage's rule, which `src/effort/sync/contact.ts` reads by name:
 *
 *   - **{@link HubUnreachable}** (`name` `HubUnreachable`): a connect
 *     failure, the `hub.timeout` abort, or a `5xx`. The command then
 *     prints one line and uses the local store.
 *   - **{@link HubRefused}**: a `4xx`, a `401`/`403` token refusal and
 *     a `409` migration refusal among them, or a redirect. It is NOT
 *     unreachable: hiding it would leave the devices silently apart, so
 *     the caller reports it as the refusal it is, the hub's own error
 *     line quoted.
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

import { decodeWirePayload, encodeWirePayload, WireFormatError } from '@open-tomato/rafa/store';

/** The `name` core's contact matches an unreachable hub by. */
export const HUB_UNREACHABLE = 'HubUnreachable';

/** The path each call reaches, as the hub serves it. */
export const HUB_CLIENT_ROUTES = Object.freeze({
  status: '/v1/status',
  push: '/v1/effort/push',
  pull: '/v1/effort/pull',
});

/** The lowest status a hub fault answers with. */
const SERVER_ERROR = 500;

/** The lowest status a refusal answers with. */
const CLIENT_ERROR = 400;

/** The lowest redirect status. */
const REDIRECT = 300;

/** The hub could not be reached: a connect failure, the timeout abort or a `5xx`. */
export class HubUnreachable extends Error {
  override readonly name = HUB_UNREACHABLE;
}

/** The hub answered and refused the call: a `4xx` or a redirect. */
export class HubRefused extends Error {
  override readonly name = 'HubRefused';
  /** The status the hub answered with. */
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
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

/** What a status call answers. */
export interface HubStatusAnswer {
  readonly version: string;
  readonly migrations: readonly string[];
  readonly rows: Readonly<Record<string, number>>;
  readonly devices: readonly HubDeviceAnswer[];
}

/** What a client is made with. */
export interface HubClientOptions {
  /** The hub's address: the resolved `hub.url`. */
  readonly url: string;
  /** The GitHub token read by `readHubToken`. */
  readonly token: string;
  /** How long one call may take, in milliseconds: the resolved `hub.timeout`. */
  readonly timeoutMs: number;
  /** The fetch to call; the global `fetch` when left out. */
  readonly fetch?: typeof fetch;
}

/** The three calls; see the module note. */
export interface HubClient {
  /** Pushes `payload` as `device`'s rows. */
  readonly push: (device: string, payload: WirePayload) => Promise<HubPushAnswer>;
  /** Pulls the rows other devices created past `since`. */
  readonly pull: (device: string, since: WireCursor) => Promise<WirePayload>;
  /** Reads the hub's status. */
  readonly status: () => Promise<HubStatusAnswer>;
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

/** The `error` line an envelope holds, or undefined when the text is none. */
function envelopeError(text: string): string | undefined {
  try {
    const parsed: unknown = JSON.parse(text);
    return isRecord(parsed) && typeof parsed.error === 'string'
      ? parsed.error
      : undefined;
  } catch {
    return undefined;
  }
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
  return Object.freeze({ version, migrations, rows, devices });
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
    throw new HubRefused(status, `the hub refused ${call.what}: ${reasonOf(response, text)}`);
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

/** A client of the hub `options` names; see the module note. */
export function createHubClient(options: HubClientOptions): HubClient {
  return Object.freeze({
    push: async (device: string, payload: WirePayload) => readPushAnswer(await send(options, {
      method: 'POST',
      path: HUB_CLIENT_ROUTES.push,
      query: { device },
      body: encodeWirePayload(payload),
      what: 'push',
    })),
    pull: async (device: string, since: WireCursor) => readPullAnswer(await send(options, {
      method: 'GET',
      path: HUB_CLIENT_ROUTES.pull,
      query: Object.keys(since).length === 0
        ? { device }
        : { device, since: JSON.stringify(since) },
      what: 'pull',
    })),
    status: async () => readStatusAnswer(await send(options, {
      method: 'GET',
      path: HUB_CLIENT_ROUTES.status,
      query: {},
      what: 'status',
    })),
  });
}
