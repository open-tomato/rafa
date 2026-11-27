/**
 * Tests for `toFetchHandler`: the plain request it hands the handler (the
 * mount stripped, the method upper case, the header keys lower case, the
 * query read, the body parsed), the two faults it answers itself (a path
 * outside the mount, a body too large or not JSON) as envelopes of this
 * contract version, and the handler's answer written back as JSON. The
 * last case runs the real handler behind it end to end.
 */
import type { AtlasHandler } from './handler.js';
import type { AtlasRequest, AtlasResponse } from './request.js';

import { ATLAS_CONTRACT_VERSION, envelopeSchema, QueryResultSchema } from '@open-tomato/atlas-data/contract';
import { describe, expect, it } from 'bun:test';

import { toFetchHandler } from './fetch.js';
import { createAtlasHandler } from './handler.js';
import { stubRegistry, TASKS_RESULT } from './testdata/registry.fixture.js';

const ORIGIN = 'http://atlas.test';

/**
 * The spec's one-second bound on a crafted mount: the old trailing-slash
 * trim took about 2.2 s on the 50,000-character shape below, and grows with
 * its square.
 */
const REDOS_BOUND_MS = 1000;

/** Slashes in the crafted mount's run, about the 50,000 characters of the plan's slow shape. */
const CRAFTED_SLASHES = 50_000;

const ANSWER: AtlasResponse = {
  status: 201,
  headers: { 'content-type': 'application/json; charset=utf-8', 'x-answered': 'yes' },
  body: { status: 'ok', data: { answered: true }, error: null, meta: { asOf: null, version: ATLAS_CONTRACT_VERSION, elapsedMs: 3 } },
};

/** A handler that records every request it is handed and answers `ANSWER`. */
function recorder(): { readonly handler: AtlasHandler; readonly seen: readonly AtlasRequest[] } {
  const seen: AtlasRequest[] = [];
  return {
    seen,
    handler: async (request) => {
      seen.push(request);
      return ANSWER;
    },
  };
}

async function expectAdapterError(response: Response, status: number, code: string, message: string): Promise<void> {
  const body: unknown = await response.json();

  expect(response.status).toBe(status);
  expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8');
  expect(envelopeSchema(QueryResultSchema).safeParse(body).success).toBe(true);
  expect(body).toEqual({
    status: 'error',
    data: null,
    error: { code, message },
    meta: { asOf: null, version: ATLAS_CONTRACT_VERSION, elapsedMs: 0 },
  });
}

describe('toFetchHandler, the request it hands over', () => {
  it('strips the mount, upper-cases the method, lower-cases the headers and reads the query', async () => {
    const { handler, seen } = recorder();
    await toFetchHandler(handler, { basePath: '/api/atlas' })(new Request(`${ORIGIN}/api/atlas/metrics?lens=pm&x=1`, {
      method: 'get',
      headers: { 'X-Atlas-Contract': '1' },
    }));

    expect(seen).toHaveLength(1);
    expect(seen[0]?.method).toBe('GET');
    expect(seen[0]?.path).toBe('/metrics');
    expect(seen[0]?.query).toEqual({ lens: 'pm', x: '1' });
    expect(seen[0]?.headers['x-atlas-contract']).toBe('1');
    expect(seen[0]?.body).toBeUndefined();
  });

  it('drops a trailing slash of the mount, and hands the mount itself over as /', async () => {
    const { handler, seen } = recorder();
    const fetchHandler = toFetchHandler(handler, { basePath: '/api/atlas//' });
    await fetchHandler(new Request(`${ORIGIN}/api/atlas`));
    await fetchHandler(new Request(`${ORIGIN}/api/atlas/sources`));

    expect(seen.map((request) => request.path)).toEqual(['/', '/sources']);
  });

  it('hands the whole path over when no mount is named', async () => {
    const { handler, seen } = recorder();
    await toFetchHandler(handler)(new Request(`${ORIGIN}/sources/local.tasks`));

    expect(seen[0]?.path).toBe('/sources/local.tasks');
  });

  it('leaves the path percent-encoded, for the handler to decode', async () => {
    const { handler, seen } = recorder();
    await toFetchHandler(handler)(new Request(`${ORIGIN}/sources/local%2Etasks`));

    expect(seen[0]?.path).toBe('/sources/local%2Etasks');
  });

  it('parses a JSON body', async () => {
    const { handler, seen } = recorder();
    await toFetchHandler(handler)(new Request(`${ORIGIN}/sources/local.tasks/query`, {
      method: 'POST',
      body: JSON.stringify({ grain: 'day' }),
    }));

    expect(seen[0]?.body).toEqual({ grain: 'day' });
  });

  it.each([
    ['an empty body', ''],
    ['a blank body', ' \n\t '],
  ])('hands %s over as undefined', async (_, text) => {
    const { handler, seen } = recorder();
    await toFetchHandler(handler)(new Request(`${ORIGIN}/sources/local.tasks/query`, { method: 'POST', body: text }));

    expect(seen).toHaveLength(1);
    expect(seen[0]?.body).toBeUndefined();
  });
});

describe('toFetchHandler, the faults it answers itself', () => {
  it.each([
    ['another path', '/elsewhere/sources'],
    ['a longer word sharing the prefix', '/api/atlasx/sources'],
  ])('answers %s outside the mount as unknown_route, without calling the handler', async (_, path) => {
    const { handler, seen } = recorder();
    const response = await toFetchHandler(handler, { basePath: '/api/atlas' })(new Request(`${ORIGIN}${path}`));

    await expectAdapterError(response, 404, 'unknown_route', 'no such route');
    expect(seen).toEqual([]);
  });

  it('refuses a body that is not JSON as invalid_body', async () => {
    const { handler, seen } = recorder();
    const response = await toFetchHandler(handler)(new Request(`${ORIGIN}/sources/local.tasks/query`, {
      method: 'POST',
      body: '{grain: day',
    }));

    await expectAdapterError(response, 400, 'invalid_body', 'the body is not JSON');
    expect(seen).toEqual([]);
  });

  it('counts the limit in bytes: refuses a body of fewer characters than the limit but more bytes', async () => {
    const { handler, seen } = recorder();
    const text = JSON.stringify({ note: 'é'.repeat(30) });
    const response = await toFetchHandler(handler, { maxBodyBytes: 50 })(new Request(`${ORIGIN}/sources/local.tasks/query`, {
      method: 'POST',
      body: text,
    }));

    expect(text.length).toBeLessThan(50);
    expect(new TextEncoder().encode(text).byteLength).toBeGreaterThan(50);
    await expectAdapterError(response, 400, 'invalid_body', 'the body is too large');
    expect(seen).toEqual([]);
  });

  it('refuses a body over the 64 KiB default', async () => {
    const { handler, seen } = recorder();
    const response = await toFetchHandler(handler)(new Request(`${ORIGIN}/sources/local.tasks/query`, {
      method: 'POST',
      body: JSON.stringify({ note: 'x'.repeat(64 * 1024) }),
    }));

    await expectAdapterError(response, 400, 'invalid_body', 'the body is too large');
    expect(seen).toEqual([]);
  });

  it('control: hands over a body of exactly the limit', async () => {
    const { handler, seen } = recorder();
    const text = JSON.stringify({ note: 'x'.repeat(40) });
    const response = await toFetchHandler(handler, { maxBodyBytes: text.length })(new Request(`${ORIGIN}/sources/local.tasks/query`, {
      method: 'POST',
      body: text,
    }));

    expect(response.status).toBe(201);
    expect(seen[0]?.body).toEqual({ note: 'x'.repeat(40) });
  });
});

describe('toFetchHandler, the answer it writes', () => {
  it('writes the handler\'s status, headers and body as JSON', async () => {
    const { handler } = recorder();
    const response = await toFetchHandler(handler)(new Request(`${ORIGIN}/sources`));

    expect(response.status).toBe(201);
    expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(response.headers.get('x-answered')).toBe('yes');
    expect(await response.json()).toEqual(ANSWER.body);
  });

  it('runs the real handler end to end: a query under the mount answers the source result', async () => {
    const fetchHandler = toFetchHandler(createAtlasHandler(stubRegistry()), { basePath: '/api/atlas' });
    const response = await fetchHandler(new Request(`${ORIGIN}/api/atlas/sources/local.tasks/query`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-atlas-contract': '1' },
      body: JSON.stringify({ grain: 'day' }),
    }));
    const body: unknown = await response.json();
    const parsed = envelopeSchema(QueryResultSchema).safeParse(body);

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(parsed.success).toBe(true);
    expect(parsed.data?.data).toEqual(TASKS_RESULT);
  });

  it('runs the real handler end to end: a 405 keeps its allow header through the adapter', async () => {
    const fetchHandler = toFetchHandler(createAtlasHandler(stubRegistry()), { basePath: '/api/atlas' });
    const response = await fetchHandler(new Request(`${ORIGIN}/api/atlas/sources/local.tasks/query`));

    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('POST');
  });
});

describe('toFetchHandler, a crafted mount', () => {
  it('trims no slash off a mount whose slash run is not at its end, within REDOS_BOUND_MS', async () => {
    const basePath = `${'/'.repeat(CRAFTED_SLASHES)}x`;
    const { handler, seen } = recorder();

    const started = performance.now();
    const fetchHandler = toFetchHandler(handler, { basePath });
    const elapsed = performance.now() - started;
    await fetchHandler(new Request(`${ORIGIN}${basePath}/sources`));

    expect(elapsed).toBeLessThan(REDOS_BOUND_MS);
    expect(seen.map((request) => request.path)).toEqual(['/sources']);
  });
});
