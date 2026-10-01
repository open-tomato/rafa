/**
 * Tests for the hub HTTP client (`client.ts`), each against a
 * `Bun.serve` stand-in on a free port rather than the real hub: what
 * each call sends and reads, and which of unreachable, refused and
 * malformed each failure is. Every unreachable reading is paired with a
 * control on the same client that proves the call could have succeeded.
 */
import type { HubClient, HubClientOptions } from './client.js';
import type { WirePayload } from '@open-tomato/rafa/store';

import { WIRE_FORMAT, WIRE_VERSION } from '@open-tomato/rafa/store';
import { afterEach, describe, expect, it } from 'bun:test';

import { createHubClient, HUB_UNREACHABLE, HubAnswerMalformed, HubRefused, HubUnreachable } from './client.js';

const TOKEN = 'ghp_client_test_token';

/** Short enough to keep the suite quick, long enough for a local answer. */
const TIMEOUT_MS = 200;

const PAYLOAD: WirePayload = {
  format: WIRE_FORMAT,
  version: WIRE_VERSION,
  migrations: ['0001-init'],
  tables: { commits: [{ seq: 1, origin_store: 'dev-b', origin_seq: 1, row_json: '{}' }] },
  cursor: { commits: 1 },
};

const STATUS = {
  version: '0.0.0',
  migrations: ['0001-init'],
  rows: { commits: 3 },
  devices: [{ device: 'dev-a', lastPushAt: '2026-10-01T00:00:00.000Z' }],
};

/** One request a stand-in saw. */
interface Seen {
  readonly method: string;
  readonly path: string;
  readonly query: Record<string, string>;
  readonly authorization: string | null;
  readonly body: string;
}

/** A running stand-in, with the requests it saw. */
interface StandIn {
  readonly url: string;
  readonly seen: Seen[];
}

const servers: { stop: (force?: boolean) => unknown }[] = [];

afterEach(() => {
  for (const server of servers.splice(0)) void server.stop(true);
});

/** Starts a stand-in answering every request with `answer`, recording each. */
function standIn(answer: (request: Request) => Response | Promise<Response>): StandIn {
  const seen: Seen[] = [];
  const server = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    fetch: async (request) => {
      const url = new URL(request.url);
      seen.push({
        method: request.method,
        path: url.pathname,
        query: Object.fromEntries(url.searchParams),
        authorization: request.headers.get('authorization'),
        body: await request.text(),
      });
      return answer(request);
    },
  });
  servers.push(server);
  return { url: `http://127.0.0.1:${String(server.port)}`, seen };
}

/** A success envelope holding `data`. */
function success(data: unknown): Response {
  return Response.json({ success: true, data });
}

/** A failure envelope of `status` saying `error`. */
function failure(status: number, error: string): Response {
  return Response.json({ success: false, error }, { status });
}

/** A client of the hub at `url`. */
function clientOf(url: string, options: Partial<HubClientOptions> = {}): HubClient {
  return createHubClient({ url, token: TOKEN, timeoutMs: TIMEOUT_MS, ...options });
}

/** What `call` rejected with. */
async function rejectionOf(call: Promise<unknown>): Promise<Error> {
  try {
    await call;
  } catch (error) {
    if (error instanceof Error) return error;
    throw new Error(`rejected with a non-error: ${String(error)}`);
  }
  throw new Error('the call resolved');
}

/** A port nothing listens on: one a stand-in held and gave back. */
async function closedPort(): Promise<number> {
  const server = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: () => new Response() });
  const port = server.port ?? 0;
  await server.stop(true);
  return port;
}

describe('push', () => {
  it('posts the encoded payload under device with the bearer token, answering the push', async () => {
    const hub = standIn(() => success({ received: 1, added: 1, at: '2026-10-01T00:00:00.000Z' }));
    const answer = await clientOf(hub.url).push('dev-a', PAYLOAD);
    expect(answer).toEqual({ received: 1, added: 1, at: '2026-10-01T00:00:00.000Z' });
    expect(hub.seen).toEqual([{
      method: 'POST',
      path: '/v1/effort/push',
      query: { device: 'dev-a' },
      authorization: `Bearer ${TOKEN}`,
      body: JSON.stringify(PAYLOAD),
    }]);
  });

  it('refuses a push answer missing a count as malformed', async () => {
    const hub = standIn(() => success({ received: 1, at: 'now' }));
    const error = await rejectionOf(clientOf(hub.url).push('dev-a', PAYLOAD));
    expect(error).toBeInstanceOf(HubAnswerMalformed);
    expect(error.message).toBe('the hub\'s answer to push holds no received, added and at');
  });
});

describe('pull', () => {
  it('leaves since out for an empty cursor and answers the decoded payload', async () => {
    const hub = standIn(() => success(PAYLOAD));
    const payload = await clientOf(hub.url).pull('dev-a', {});
    expect(payload).toEqual(PAYLOAD);
    expect(hub.seen.map(({ method, path, query }) => ({ method, path, query })))
      .toEqual([{ method: 'GET', path: '/v1/effort/pull', query: { device: 'dev-a' } }]);
  });

  it('sends a cursor as JSON in since', async () => {
    const hub = standIn(() => success(PAYLOAD));
    await clientOf(hub.url).pull('dev-a', { commits: 12, sessions: 3 });
    expect(hub.seen[0]?.query).toEqual({ device: 'dev-a', since: '{"commits":12,"sessions":3}' });
  });

  it('refuses an answer the wire codec cannot read as malformed, naming the codec\'s fault', async () => {
    const hub = standIn(() => success({ ...PAYLOAD, version: 99 }));
    const error = await rejectionOf(clientOf(hub.url).pull('dev-a', {}));
    expect(error).toBeInstanceOf(HubAnswerMalformed);
    expect(error.message).toBe('the hub\'s answer to pull is not a wire payload: wire: version is 99; this rafa reads version 1');
  });
});

describe('status', () => {
  it('gets the status route and answers the hub\'s status', async () => {
    const hub = standIn(() => success(STATUS));
    expect(await clientOf(hub.url).status()).toEqual(STATUS);
    expect(hub.seen.map(({ method, path, query }) => ({ method, path, query })))
      .toEqual([{ method: 'GET', path: '/v1/status', query: {} }]);
  });

  it('refuses a status answer whose devices are not devices as malformed', async () => {
    const hub = standIn(() => success({ ...STATUS, devices: ['dev-a'] }));
    await expect(clientOf(hub.url).status()).rejects.toBeInstanceOf(HubAnswerMalformed);
  });
});

describe('the address', () => {
  it.each(['/rafa', '/rafa/'])('keeps the path prefix of a hub.url ending %s', async (suffix: string) => {
    const hub = standIn(() => success(STATUS));
    await clientOf(`${hub.url}${suffix}`).status();
    expect(hub.seen[0]?.path).toBe('/rafa/v1/status');
  });
});

describe('unreachable', () => {
  it('rejects a connect failure as HubUnreachable, where a listening hub on the same client answers', async () => {
    const port = await closedPort();
    const error = await rejectionOf(clientOf(`http://127.0.0.1:${String(port)}`).status());
    expect(error).toBeInstanceOf(HubUnreachable);
    expect(error.name).toBe(HUB_UNREACHABLE);
    expect(error.message).toStartWith('could not reach the hub for status: ');

    const hub = standIn(() => success(STATUS));
    expect(await clientOf(hub.url).status()).toEqual(STATUS);
  });

  it('aborts a hub that never answers once hub.timeout passes', async () => {
    const hub = standIn(() => new Promise<Response>(() => {}));
    const started = performance.now();
    const error = await rejectionOf(clientOf(hub.url).status());
    const elapsed = performance.now() - started;
    expect(error).toBeInstanceOf(HubUnreachable);
    expect(error.message).toBe(`the hub did not answer status within ${String(TIMEOUT_MS)} ms`);
    expect(elapsed).toBeGreaterThanOrEqual(TIMEOUT_MS - 5);
    expect(elapsed).toBeLessThan(TIMEOUT_MS * 10);
  });

  it('aborts a hub that sends its headers and then stalls the body', async () => {
    const stalled = new ReadableStream({ start: (controller) => controller.enqueue(new TextEncoder().encode('{"success":')) });
    const hub = standIn(() => new Response(stalled, { headers: { 'content-type': 'application/json' } }));
    const error = await rejectionOf(clientOf(hub.url).status());
    expect(error).toBeInstanceOf(HubUnreachable);
    expect(error.message).toBe(`the hub did not answer status within ${String(TIMEOUT_MS)} ms`);
  });

  it('lets a slow hub answer within a longer hub.timeout', async () => {
    const hub = standIn(async () => {
      await Bun.sleep(TIMEOUT_MS / 2);
      return success(STATUS);
    });
    expect(await clientOf(hub.url).status()).toEqual(STATUS);
  });

  it.each([500, 502, 503])('rejects a %i as HubUnreachable, quoting the hub\'s line', async (status: number) => {
    const hub = standIn(() => failure(status, 'The hub\'s store did not open.'));
    const error = await rejectionOf(clientOf(hub.url).push('dev-a', PAYLOAD));
    expect(error).toBeInstanceOf(HubUnreachable);
    expect(error.message).toBe(`the hub answered push with HTTP ${String(status)}: The hub's store did not open.`);
  });

  it('names the status alone for a 5xx with no envelope', async () => {
    const hub = standIn(() => new Response('Bad Gateway', { status: 502 }));
    const error = await rejectionOf(clientOf(hub.url).status());
    expect(error.message).toBe('the hub answered status with HTTP 502');
  });
});

describe('refused', () => {
  it.each([
    [401, 'Send a GitHub token as Authorization: Bearer.'],
    [403, 'octocat may not take effort.push on this hub.'],
    [409, 'The hub lacks migration 0002-x; upgrade the hub.'],
    [400, 'The query names "cursor"; expected device, since.'],
  ])('rejects a %i as HubRefused, never HubUnreachable, quoting the hub\'s line', async (status: number, said: string) => {
    const hub = standIn(() => failure(status, said));
    const error = await rejectionOf(clientOf(hub.url).push('dev-a', PAYLOAD));
    expect(error).toBeInstanceOf(HubRefused);
    expect(error.name).not.toBe(HUB_UNREACHABLE);
    expect((error as HubRefused).status).toBe(status);
    expect(error.message).toBe(`the hub refused push: HTTP ${String(status)}: ${said}`);
  });

  it('refuses a redirect without following it, so the token never reaches its target', async () => {
    const target = standIn(() => success(STATUS));
    const hub = standIn(() => new Response(null, { status: 307, headers: { location: `${target.url}/v1/status` } }));
    const error = await rejectionOf(clientOf(hub.url).status());
    expect(error).toBeInstanceOf(HubRefused);
    expect(error.message).toBe(`the hub answered status with a redirect (HTTP 307) to ${target.url}/v1/status;`
      + ' set hub.url to the address the hub serves');
    expect(target.seen).toEqual([]);

    await clientOf(target.url).status();
    expect(target.seen).toHaveLength(1);
  });
});

describe('malformed', () => {
  it.each([
    ['not JSON', () => new Response('<html>ok</html>'), 'the hub\'s answer to status is not JSON'],
    ['a failure envelope under 200', () => Response.json({ success: false, error: 'x' }), 'the hub\'s answer to status is not a success envelope'],
    ['an envelope with no data', () => Response.json({ success: true }), 'the hub\'s answer to status is not a success envelope'],
  ])('rejects %s as HubAnswerMalformed', async (_label: string, answer: () => Response, message: string) => {
    const hub = standIn(answer);
    const error = await rejectionOf(clientOf(hub.url).status());
    expect(error).toBeInstanceOf(HubAnswerMalformed);
    expect(error.message).toBe(message);
  });
});

describe('the token', () => {
  it('reaches no message of any failure', async () => {
    const port = await closedPort();
    const refusing = standIn(() => failure(401, 'no'));
    const failing = standIn(() => failure(503, 'down'));
    const errors = await Promise.all([
      rejectionOf(clientOf(`http://127.0.0.1:${String(port)}`).status()),
      rejectionOf(clientOf(refusing.url).status()),
      rejectionOf(clientOf(failing.url).status()),
    ]);
    expect(errors.map((error) => error.message.includes(TOKEN))).toEqual([false, false, false]);
    expect(refusing.seen[0]?.authorization).toBe(`Bearer ${TOKEN}`);
  });
});
