/**
 * Tests for `toExpressHandler` over a fake request and response shaped as
 * Express hands them over: every route the fetch handler serves, run
 * through the real handler; a 404; a handler that throws, answered 500
 * without its message; the request it hands over (headers, query, a parsed
 * or a streamed body); and the two body faults it answers itself.
 */
import type { ExpressLikeRequest, ExpressLikeResponse } from './express.js';
import type { AtlasHandler } from './handler.js';
import type { AtlasRequest } from './request.js';

import {
  ATLAS_CONTRACT_VERSION,
  DataSourceDescriptorSchema,
  envelopeSchema,
  MetricDefinitionSchema,
  QueryResultSchema,
} from '@open-tomato/atlas-data/contract';
import { describe, expect, it } from 'bun:test';

import { toExpressHandler } from './express.js';
import { createAtlasHandler } from './handler.js';
import {
  ARCH_METRIC,
  DAILY_DESCRIPTOR,
  PM_METRIC,
  stubRegistry,
  TASKS_DESCRIPTOR,
  TASKS_RESULT,
} from './testdata/registry.fixture.js';

const ANY_ENVELOPE = envelopeSchema(QueryResultSchema.nullable().or(DataSourceDescriptorSchema)
  .or(DataSourceDescriptorSchema.array())
  .or(MetricDefinitionSchema)
  .or(MetricDefinitionSchema.array()));

/** What the fake response was handed, read back as the wire would carry it. */
interface Written {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: unknown;
  readonly ends: number;
}

function fakeResponse(): { readonly response: ExpressLikeResponse; written(): Written } {
  const headers: Record<string, string> = {};
  const chunks: string[] = [];
  const response: ExpressLikeResponse = {
    statusCode: 200,
    setHeader: (name, value) => {
      headers[name.toLowerCase()] = value;
    },
    end: (chunk) => {
      chunks.push(chunk);
    },
  };
  return {
    response,
    written: () => ({
      status: response.statusCode,
      headers: { ...headers },
      body: chunks.length === 1
        ? JSON.parse(chunks[0] ?? '') as unknown
        : undefined,
      ends: chunks.length,
    }),
  };
}

function fakeRequest(method: string, path: string, extra: Partial<ExpressLikeRequest> = {}): ExpressLikeRequest {
  return { method, path, query: {}, headers: {}, ...extra };
}

/** A request whose body is an unread stream of `chunks`, as Node hands one over with no parser. */
function streamedRequest(path: string, chunks: readonly (string | Uint8Array)[], headers: ExpressLikeRequest['headers'] = {}): ExpressLikeRequest {
  return {
    method: 'POST',
    path,
    query: {},
    headers,
    async* [Symbol.asyncIterator]() {
      for (const chunk of chunks) yield chunk;
    },
  };
}

async function run(handler: AtlasHandler, request: ExpressLikeRequest, onError?: (error: unknown) => void): Promise<Written> {
  const { response, written } = fakeResponse();
  let nextCalls = 0;
  const options = onError === undefined
    ? {}
    : { onError };
  await toExpressHandler(handler, options)(request, response, () => {
    nextCalls += 1;
  });

  expect(nextCalls).toBe(0);

  return written();
}

/** A handler that records every request it is handed and answers an ok envelope. */
function recorder(): { readonly handler: AtlasHandler; readonly seen: readonly AtlasRequest[] } {
  const seen: AtlasRequest[] = [];
  return {
    seen,
    handler: async (request) => {
      seen.push(request);
      return {
        status: 200,
        headers: {},
        body: { status: 'ok', data: null, error: null, meta: { asOf: null, version: ATLAS_CONTRACT_VERSION, elapsedMs: 0 } },
      };
    },
  };
}

function expectAdapterError(written: Written, status: number, code: string, message: string): void {
  expect(written.status).toBe(status);
  expect(written.headers['content-type']).toBe('application/json; charset=utf-8');
  expect(ANY_ENVELOPE.safeParse(written.body).success).toBe(true);
  expect(written.body).toEqual({
    status: 'error',
    data: null,
    error: { code, message },
    meta: { asOf: null, version: ATLAS_CONTRACT_VERSION, elapsedMs: 0 },
  });
}

describe('toExpressHandler, every route the fetch handler serves', () => {
  const real = (): AtlasHandler => createAtlasHandler(stubRegistry());

  it.each([
    ['GET /sources', fakeRequest('GET', '/sources'), [TASKS_DESCRIPTOR, DAILY_DESCRIPTOR]],
    ['GET /sources/:id', fakeRequest('GET', '/sources/local.tasks'), TASKS_DESCRIPTOR],
    ['POST /sources/:id/query', fakeRequest('POST', '/sources/local.tasks/query', { body: { grain: 'day' } }), TASKS_RESULT],
    ['GET /metrics', fakeRequest('GET', '/metrics'), [PM_METRIC, ARCH_METRIC]],
    ['GET /metrics?lens=', fakeRequest('GET', '/metrics', { query: { lens: 'pm' } }), [PM_METRIC]],
    ['GET /metrics/:id', fakeRequest('GET', '/metrics/arch.tokens-by-model'), ARCH_METRIC],
  ])('%s answers its data in an ok envelope, with the handler\'s headers', async (_, request, data) => {
    const written = await run(real(), request);

    expect(written.status).toBe(200);
    expect(written.ends).toBe(1);
    expect(written.headers).toEqual({ 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    expect(ANY_ENVELOPE.safeParse(written.body).success).toBe(true);
    expect(written.body).toMatchObject({ status: 'ok', data, error: null });
  });

  it('answers an unknown route 404 unknown_route through the handler, never calling next', async () => {
    const written = await run(real(), fakeRequest('GET', '/elsewhere'));

    expect(written.status).toBe(404);
    expect(ANY_ENVELOPE.safeParse(written.body).success).toBe(true);
    expect(written.body).toMatchObject({ status: 'error', data: null, error: { code: 'unknown_route' } });
  });

  it('keeps a 405\'s allow header through the adapter', async () => {
    const written = await run(real(), fakeRequest('GET', '/sources/local.tasks/query'));

    expect(written.status).toBe(405);
    expect(written.headers.allow).toBe('POST');
  });
});

describe('toExpressHandler, a handler that throws', () => {
  const SECRET = '/srv/atlas/replica.db: SELECT * FROM secrets';

  it('answers 500 internal without the thrown message, handing the error to onError', async () => {
    const thrown = new Error(SECRET);
    const errors: unknown[] = [];
    const written = await run(async () => {
      throw thrown;
    }, fakeRequest('GET', '/sources'), (error) => errors.push(error));

    expectAdapterError(written, 500, 'internal', 'internal error');
    expect(written.headers['cache-control']).toBe('no-store');
    expect(JSON.stringify(written.body)).not.toContain('secrets');
    expect(JSON.stringify(written.body)).not.toContain('replica.db');
    expect(errors).toEqual([thrown]);
  });

  it('answers 500 with no onError handed, and never rejects itself', async () => {
    const written = await run(async () => {
      throw new Error(SECRET);
    }, fakeRequest('GET', '/sources'));

    expectAdapterError(written, 500, 'internal', 'internal error');
    expect(written.ends).toBe(1);
  });

  it('control: hands onError nothing when the handler answers', async () => {
    const errors: unknown[] = [];
    const written = await run(createAtlasHandler(stubRegistry()), fakeRequest('GET', '/sources'), (error) => errors.push(error));

    expect(written.status).toBe(200);
    expect(errors).toEqual([]);
  });
});

describe('toExpressHandler, the request it hands over', () => {
  it('upper-cases the method, lower-cases the header keys and joins a repeated header', async () => {
    const { handler, seen } = recorder();
    await run(handler, fakeRequest('get', '/metrics', {
      headers: { 'X-Atlas-Contract': '1', 'accept': ['a', 'b'], 'x-missing': undefined },
    }));

    expect(seen[0]?.method).toBe('GET');
    expect(seen[0]?.path).toBe('/metrics');
    expect(seen[0]?.headers).toEqual({ 'x-atlas-contract': '1', 'accept': 'a, b' });
  });

  it('hands an empty path over as /', async () => {
    const { handler, seen } = recorder();
    await run(handler, fakeRequest('GET', ''));

    expect(seen[0]?.path).toBe('/');
  });

  it('reads a repeated query value as its last string, and drops a nested one', async () => {
    const { handler, seen } = recorder();
    await run(handler, fakeRequest('GET', '/metrics', { query: { lens: ['pm', 'architect'], x: '1', deep: { a: '1' } } }));

    expect(seen[0]?.query).toEqual({ lens: 'architect', x: '1' });
  });

  it('hands a body a parser left over as it is, without reading the stream', async () => {
    const { handler, seen } = recorder();
    const request: ExpressLikeRequest = {
      ...streamedRequest('/sources/local.tasks/query', ['not json']),
      body: { grain: 'day' },
    };
    await run(handler, request);

    expect(seen[0]?.body).toEqual({ grain: 'day' });
  });

  it('reads and parses a streamed body when no parser ran, across chunks of strings and bytes', async () => {
    const { handler, seen } = recorder();
    await run(handler, streamedRequest('/sources/local.tasks/query', ['{"grain":', new TextEncoder().encode('"day"}')]));

    expect(seen[0]?.body).toEqual({ grain: 'day' });
  });

  it.each([
    ['an empty stream', []],
    ['a blank stream', [' \n\t ']],
  ])('hands %s over as undefined', async (_, chunks) => {
    const { handler, seen } = recorder();
    await run(handler, streamedRequest('/sources/local.tasks/query', chunks));

    expect(seen).toHaveLength(1);
    expect(seen[0]?.body).toBeUndefined();
  });

  it('leaves the stream of a GET unread', async () => {
    const { handler, seen } = recorder();
    await run(handler, { ...streamedRequest('/sources', ['{bad']), method: 'GET' });

    expect(seen[0]?.body).toBeUndefined();
  });
});

describe('toExpressHandler, the body faults it answers itself', () => {
  it('refuses a streamed body that is not JSON as invalid_body, without calling the handler', async () => {
    const { handler, seen } = recorder();
    const written = await run(handler, streamedRequest('/sources/local.tasks/query', ['{grain: day']));

    expectAdapterError(written, 400, 'invalid_body', 'the body is not JSON');
    expect(seen).toEqual([]);
  });

  it('refuses a declared content-length over the limit before reading', async () => {
    const { handler, seen } = recorder();
    const written = await run(handler, streamedRequest('/sources/local.tasks/query', ['{}'], { 'content-length': String(64 * 1024 + 1) }));

    expectAdapterError(written, 400, 'invalid_body', 'the body is too large');
    expect(seen).toEqual([]);
  });

  it('counts the limit in bytes: refuses a body of fewer characters than the limit but more bytes', async () => {
    const { handler, seen } = recorder();
    const text = JSON.stringify({ note: 'é'.repeat(30) });
    const { response, written } = fakeResponse();
    await toExpressHandler(handler, { maxBodyBytes: 50 })(streamedRequest('/sources/local.tasks/query', [text]), response);

    expect(text.length).toBeLessThan(50);
    expectAdapterError(written(), 400, 'invalid_body', 'the body is too large');
    expect(seen).toEqual([]);
  });

  it('control: hands over a streamed body of exactly the limit', async () => {
    const { handler, seen } = recorder();
    const text = JSON.stringify({ note: 'x'.repeat(40) });
    const { response, written } = fakeResponse();
    await toExpressHandler(handler, { maxBodyBytes: text.length })(streamedRequest('/sources/local.tasks/query', [text]), response);

    expect(written().status).toBe(200);
    expect(seen[0]?.body).toEqual({ note: 'x'.repeat(40) });
  });
});
