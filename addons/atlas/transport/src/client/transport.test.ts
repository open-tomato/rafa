/**
 * Tests for the two transports: `fetchTransport` builds the URL, method,
 * headers and JSON body from a plain request and reads the answer back,
 * wraps a network failure in `AtlasTransportError` and rethrows an abort
 * as it was raised; `localTransport` calls the handler in-process with
 * both bodies passed through JSON and refuses an aborted signal. One case
 * runs the client, `fetchTransport` and the fetch adapter end to end.
 */
import type { AtlasRequest } from '../server/request.js';

import { ATLAS_CONTRACT_VERSION } from '@open-tomato/atlas-data/contract';
import { describe, expect, it } from 'bun:test';

import { toFetchHandler } from '../server/fetch.js';
import { createAtlasHandler } from '../server/handler.js';
import { stubRegistry, TASKS_DESCRIPTOR } from '../server/testdata/registry.fixture.js';

import { createAtlasClient } from './client.js';
import { AtlasRequestError, AtlasResponseInvalid, AtlasTransportError } from './errors.js';
import { fetchTransport, localTransport } from './transport.js';

const BASE_URL = 'http://atlas.test/api/atlas';

/**
 * The spec's one-second bound on a crafted base URL: the old trailing-slash
 * trim took about 2.2 s on the 50,000-character shape below, and grows with
 * its square.
 */
const REDOS_BOUND_MS = 1000;

/** Slashes in the crafted base URL's run, about the 50,000 characters of the plan's slow shape. */
const CRAFTED_SLASHES = 50_000;

/** A `fetch` stand-in answering through `answer`, recording each Request; `fetchTransport` hands it a string URL. */
function fakeFetch(answer: (request: Request) => Promise<Response>): { readonly fetch: typeof fetch; readonly seen: readonly Request[] } {
  const seen: Request[] = [];
  const call = async (input: string, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init);
    seen.push(request);
    return answer(request);
  };
  return { seen, fetch: call as typeof fetch };
}

const QUERY_REQUEST: AtlasRequest = {
  method: 'POST',
  path: '/sources/local.tasks/query',
  query: { lens: 'pm' },
  body: { grain: 'day' },
  headers: { 'x-atlas-contract': '1' },
};

describe('fetchTransport', () => {
  it('sends the method, URL, headers and JSON body of the request', async () => {
    const { fetch, seen } = fakeFetch(async () => Response.json({ answered: true }, { status: 201 }));
    const transport = fetchTransport({ baseUrl: `${BASE_URL}/`, fetch, headers: { authorization: 'Bearer t', 'x-atlas-contract': 'x' } });

    const response = await transport.send(QUERY_REQUEST);

    expect(response).toEqual({ status: 201, body: { answered: true } });
    const [sent] = seen;
    expect(sent?.method).toBe('POST');
    expect(sent?.url).toBe(`${BASE_URL}/sources/local.tasks/query?lens=pm`);
    expect(sent?.headers.get('authorization')).toBe('Bearer t');
    expect(sent?.headers.get('x-atlas-contract')).toBe('1');
    expect(sent?.headers.get('content-type')).toBe('application/json');
    expect(await sent?.json()).toEqual({ grain: 'day' });
  });

  it('sends no body and no query string for a GET without them', async () => {
    const { fetch, seen } = fakeFetch(async () => new Response(''));

    const response = await fetchTransport({ baseUrl: BASE_URL, fetch })
      .send({ method: 'GET', path: '/sources', query: {}, body: undefined, headers: {} });

    expect(response).toEqual({ status: 200, body: undefined });
    expect(seen[0]?.url).toBe(`${BASE_URL}/sources`);
    expect(seen[0]?.headers.get('content-type')).toBeNull();
  });

  it('answers a body that is not JSON as its text, which the client refuses as AtlasResponseInvalid', async () => {
    const { fetch } = fakeFetch(async () => new Response('<html>proxy error</html>', { status: 502 }));
    const transport = fetchTransport({ baseUrl: BASE_URL, fetch });

    expect(await transport.send(QUERY_REQUEST)).toEqual({ status: 502, body: '<html>proxy error</html>' });
    const error: unknown = await createAtlasClient({ baseUrl: BASE_URL, transport })
      .listSources()
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AtlasResponseInvalid);
    expect(error).toMatchObject({ status: 502 });
  });

  it('wraps a network failure in AtlasTransportError, keeping it as the cause', async () => {
    const failure = new TypeError('fetch failed');
    const { fetch } = fakeFetch(async () => {
      throw failure;
    });

    const error: unknown = await fetchTransport({ baseUrl: BASE_URL, fetch })
      .send(QUERY_REQUEST)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AtlasTransportError);
    expect(error).toMatchObject({ code: 'transport_error', cause: failure });
  });

  it('rethrows an abort as fetch raised it, not as AtlasTransportError', async () => {
    const controller = new AbortController();
    const { fetch } = fakeFetch(async (request) => {
      controller.abort();
      throw request.signal.reason;
    });

    const error: unknown = await fetchTransport({ baseUrl: BASE_URL, fetch })
      .send(QUERY_REQUEST, controller.signal)
      .catch((caught: unknown) => caught);

    expect(error).not.toBeInstanceOf(AtlasTransportError);
    expect(error).toBe(controller.signal.reason);
  });

  it('carries the client through the fetch adapter to the handler, end to end', async () => {
    const adapter = toFetchHandler(createAtlasHandler(stubRegistry()), { basePath: '/api/atlas' });
    const { fetch } = fakeFetch(adapter);
    const client = createAtlasClient({ baseUrl: BASE_URL, transport: fetchTransport({ baseUrl: BASE_URL, fetch }) });

    expect(await client.describeSource('local.tasks')).toEqual(TASKS_DESCRIPTOR);
  });

  it('reads the adapter\'s own 404, whose version is empty, as AtlasRequestError and not a mismatch', async () => {
    const adapter = toFetchHandler(createAtlasHandler(stubRegistry()), { basePath: '/api/atlas' });
    const { fetch } = fakeFetch(adapter);
    const transport = fetchTransport({ baseUrl: 'http://atlas.test/elsewhere', fetch });

    const error: unknown = await createAtlasClient({ baseUrl: BASE_URL, transport })
      .listSources()
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AtlasRequestError);
    expect(error).toMatchObject({ code: 'unknown_route', status: 404 });
  });
});

describe('localTransport', () => {
  it('hands the handler the request and answers its status and body, both through JSON', async () => {
    const seen: AtlasRequest[] = [];
    const transport = localTransport(async (request) => {
      seen.push(request);
      return {
        status: 200,
        headers: {},
        body: { status: 'ok', data: { kept: 1, dropped: undefined }, error: null, meta: { asOf: null, version: ATLAS_CONTRACT_VERSION, elapsedMs: 0 } },
      };
    });

    const response = await transport.send({ ...QUERY_REQUEST, body: { grain: 'day', limit: undefined } });

    expect(seen[0]?.body).toStrictEqual({ grain: 'day' });
    expect(response.status).toBe(200);
    expect(response.body).toStrictEqual({
      status: 'ok',
      data: { kept: 1 },
      error: null,
      meta: { asOf: null, version: ATLAS_CONTRACT_VERSION, elapsedMs: 0 },
    });
  });

  it('raises the reason of an aborted signal without calling the handler', async () => {
    let called = false;
    const transport = localTransport(async () => {
      called = true;
      throw new Error('not reached');
    });
    const controller = new AbortController();
    controller.abort();

    const error: unknown = await transport.send(QUERY_REQUEST, controller.signal).catch((caught: unknown) => caught);

    expect(error).toBe(controller.signal.reason);
    expect(called).toBe(false);
  });
});

describe('fetchTransport, a crafted base URL', () => {
  it('trims no slash off a base URL whose slash run is not at its end, within REDOS_BOUND_MS', async () => {
    const baseUrl = `http://h${'/'.repeat(CRAFTED_SLASHES)}x`;
    const sent: string[] = [];
    const call = async (input: string): Promise<Response> => {
      sent.push(input);
      return new Response('');
    };

    const started = performance.now();
    const transport = fetchTransport({ baseUrl, fetch: call as typeof fetch });
    const elapsed = performance.now() - started;
    await transport.send({ method: 'GET', path: '/sources', query: {}, body: undefined, headers: {} });

    expect(elapsed).toBeLessThan(REDOS_BOUND_MS);
    expect(sent).toEqual([`${baseUrl}/sources`]);
  });
});
