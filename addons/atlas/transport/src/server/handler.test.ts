/**
 * Tests for `createAtlasHandler` over an in-memory registry: the five
 * routes with the data and freshness each answers, then every refusal by
 * status (400, 404, 405, 409, 503) and a 500 that carries neither the
 * thrown message nor anything of it, while `onError` receives the error.
 * Every answer is read through the contract's envelope schema, so a body
 * of another shape fails the case that produced it.
 */
import type { AtlasHandler, AtlasRegistry, HandlerOptions } from './handler.js';
import type { AtlasRequest, AtlasResponse } from './request.js';
import type { AtlasErrorCode, Envelope, QueryParams } from '@open-tomato/atlas-data/contract';

import {
  ATLAS_CONTRACT_VERSION,
  DataSourceDescriptorSchema,
  envelopeSchema,
  InvalidParams,
  MetricDefinitionSchema,
  QueryResultSchema,
  ReplicaUnavailable,
} from '@open-tomato/atlas-data/contract';
import { describe, expect, it } from 'bun:test';

import { createAtlasHandler } from './handler.js';
import {
  ARCH_METRIC,
  BUILT_AT,
  DAILY_DESCRIPTOR,
  PM_METRIC,
  RESULT_AS_OF,
  stubRegistry,
  stubSource,
  TASKS_AS_OF,
  TASKS_DESCRIPTOR,
  TASKS_RESULT,
} from './testdata/registry.fixture.js';

/** The envelope schema with data left unread: an error body and any ok body pass it. */
const ANY_ENVELOPE = envelopeSchema(QueryResultSchema.nullable().or(DataSourceDescriptorSchema)
  .or(DataSourceDescriptorSchema.array())
  .or(MetricDefinitionSchema)
  .or(MetricDefinitionSchema.array()));

function request(method: string, path: string, extra: Partial<AtlasRequest> = {}): AtlasRequest {
  return { method, path, query: {}, body: undefined, headers: {}, ...extra };
}

/** A clock that moves 7 ms on every reading, so `elapsedMs` is 7. */
function steppingClock(): () => number {
  let at = 1_000;
  return () => {
    at += 7;
    return at;
  };
}

function handlerOver(registry: AtlasRegistry = stubRegistry(), options: HandlerOptions = {}): AtlasHandler {
  return createAtlasHandler(registry, { now: steppingClock(), ...options });
}

/** Sends `sent` and checks the answer against the envelope schema before handing it back. */
async function send(handler: AtlasHandler, sent: AtlasRequest): Promise<AtlasResponse> {
  const response = await handler(sent);
  const parsed = ANY_ENVELOPE.safeParse(response.body);

  expect(parsed.success).toBe(true);

  return response;
}

function expectError(response: AtlasResponse, status: number, code: AtlasErrorCode): Envelope<unknown> {
  expect(response.status).toBe(status);
  expect(response.body.status).toBe('error');
  expect(response.body.data).toBeNull();
  expect(response.body.error?.code).toBe(code);
  expect(response.body.meta.asOf).toBeNull();
  expect(response.body.meta.version).toBe(ATLAS_CONTRACT_VERSION);

  return response.body;
}

describe('createAtlasHandler, the routes', () => {
  it('GET /sources answers every descriptor, stamped with the replica build time', async () => {
    const response = await send(handlerOver(), request('GET', '/sources'));

    expect(response.status).toBe(200);
    expect(response.headers).toEqual({ 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    expect(response.body).toEqual({
      status: 'ok',
      data: [TASKS_DESCRIPTOR, DAILY_DESCRIPTOR],
      error: null,
      meta: { asOf: BUILT_AT, version: ATLAS_CONTRACT_VERSION, elapsedMs: 7 },
    });
  });

  it('GET /sources/:id answers that descriptor, stamped with its own asOf', async () => {
    const response = await send(handlerOver(), request('GET', '/sources/local.tasks'));

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual(TASKS_DESCRIPTOR);
    expect(response.body.meta.asOf).toBe(TASKS_AS_OF);
  });

  it('decodes a percent-encoded id and ignores a trailing slash', async () => {
    const response = await send(handlerOver(), request('GET', '/sources/local%2Edaily/'));

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual(DAILY_DESCRIPTOR);
    expect(response.body.meta.asOf).toBeNull();
  });

  it('POST /sources/:id/query hands the parsed params to the source and answers its result', async () => {
    const tasks = stubSource(TASKS_DESCRIPTOR);
    const params: QueryParams = { window: { last: '7d' }, grain: 'day', measures: [{ field: 'tokens', agg: 'sum' }] };
    const response = await send(
      handlerOver(stubRegistry({ tasks })),
      request('POST', '/sources/local.tasks/query', { body: params }),
    );

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual(TASKS_RESULT);
    expect(response.body.meta.asOf).toBe(RESULT_AS_OF);
    expect(tasks.queried).toEqual([params]);
  });

  it('takes an empty params object as a query of the defaults', async () => {
    const tasks = stubSource(TASKS_DESCRIPTOR);
    const response = await send(
      handlerOver(stubRegistry({ tasks })),
      request('POST', '/sources/local.tasks/query', { body: {} }),
    );

    expect(response.status).toBe(200);
    expect(tasks.queried).toEqual([{}]);
  });

  it('GET /metrics answers every metric, stamped with the replica build time', async () => {
    const response = await send(handlerOver(), request('GET', '/metrics'));

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual([PM_METRIC, ARCH_METRIC]);
    expect(response.body.meta.asOf).toBe(BUILT_AT);
  });

  it('GET /metrics?lens= answers only the metrics of that lens', async () => {
    const handler = handlerOver();
    const architect = await send(handler, request('GET', '/metrics', { query: { lens: 'architect' } }));
    const qa = await send(handler, request('GET', '/metrics', { query: { lens: 'qa' } }));

    expect(architect.body.data).toEqual([ARCH_METRIC]);
    expect(qa.status).toBe(200);
    expect(qa.body.data).toEqual([]);
  });

  it('GET /metrics/:id answers that metric', async () => {
    const response = await send(handlerOver(), request('GET', '/metrics/pm.tokens-per-day'));

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual(PM_METRIC);
    expect(response.body.meta.asOf).toBe(BUILT_AT);
  });

  it('measures elapsedMs with the system clock when no clock is handed', async () => {
    const response = await send(createAtlasHandler(stubRegistry()), request('GET', '/sources'));

    expect(response.body.meta.elapsedMs).toBeGreaterThanOrEqual(0);
  });
});

describe('createAtlasHandler, 400', () => {
  it('refuses a lens outside the closed set as invalid_params, with the schema issues', async () => {
    const response = await send(handlerOver(), request('GET', '/metrics', { query: { lens: 'finance' } }));
    const body = expectError(response, 400, 'invalid_params');

    expect(body.error?.message).toBe('unknown lens');
    expect(Array.isArray(body.error?.details)).toBe(true);
    expect((body.error?.details as readonly unknown[]).length).toBeGreaterThan(0);
  });

  it('refuses a query with no body as invalid_body, before the source is asked', async () => {
    const tasks = stubSource(TASKS_DESCRIPTOR);
    const response = await send(handlerOver(stubRegistry({ tasks })), request('POST', '/sources/local.tasks/query'));

    expect(expectError(response, 400, 'invalid_body').error?.details).toBeUndefined();
    expect(tasks.queried).toEqual([]);
  });

  it('refuses params off the contract as invalid_params, naming the path of each issue', async () => {
    const tasks = stubSource(TASKS_DESCRIPTOR);
    const response = await send(
      handlerOver(stubRegistry({ tasks })),
      request('POST', '/sources/local.tasks/query', { body: { grain: 'hour', colour: 'red' } }),
    );
    const body = expectError(response, 400, 'invalid_params');
    const issues = body.error?.details as readonly { readonly path?: readonly PropertyKey[] }[];

    expect(issues.map((issue) => issue.path?.join('.') ?? '').sort()).toEqual(['', 'grain']);
    expect(tasks.queried).toEqual([]);
  });

  it('refuses a body that is not an object as invalid_params', async () => {
    const response = await send(handlerOver(), request('POST', '/sources/local.tasks/query', { body: 'grain=day' }));

    expectError(response, 400, 'invalid_params');
  });

  it('answers the engine\'s InvalidParams as invalid_params with its message and field names', async () => {
    const tasks = stubSource(TASKS_DESCRIPTOR, { query: new InvalidParams('no field colour', ['colour']) });
    const response = await send(
      handlerOver(stubRegistry({ tasks })),
      request('POST', '/sources/local.tasks/query', { body: {} }),
    );
    const body = expectError(response, 400, 'invalid_params');

    expect(body.error).toEqual({ code: 'invalid_params', message: 'no field colour', details: { fields: ['colour'] } });
  });
});

describe('createAtlasHandler, 404', () => {
  it.each([
    ['the root', '/'],
    ['an empty path', ''],
    ['another head', '/tables'],
    ['a fourth segment', '/sources/local.tasks/query/now'],
    ['another tail on a source', '/sources/local.tasks/rows'],
    ['a tail on a metric', '/metrics/pm.tokens-per-day/run'],
    ['a malformed percent-encoding', '/sources/local%E0%A4%A'],
  ])('answers %s as unknown_route', async (_, path) => {
    const response = await send(handlerOver(), request('GET', path));

    expect(expectError(response, 404, 'unknown_route').error?.message).toBe('no such route');
  });

  it('answers an unknown source as unknown_source, on describe and on query alike', async () => {
    const handler = handlerOver();
    const described = await send(handler, request('GET', '/sources/local.nothing'));
    const queried = await send(handler, request('POST', '/sources/local.nothing/query', { body: {} }));

    expect(expectError(described, 404, 'unknown_source').error?.message).toBe('no source local.nothing');
    expectError(queried, 404, 'unknown_source');
  });

  it('answers an unknown metric as unknown_metric', async () => {
    const response = await send(handlerOver(), request('GET', '/metrics/pm.nothing'));

    expect(expectError(response, 404, 'unknown_metric').error?.message).toBe('no metric pm.nothing');
  });
});

describe('createAtlasHandler, 405', () => {
  it.each([
    ['POST', '/sources', 'GET'],
    ['PUT', '/sources/local.tasks', 'GET'],
    ['GET', '/sources/local.tasks/query', 'POST'],
    ['DELETE', '/sources/local.tasks/query', 'POST'],
    ['POST', '/metrics', 'GET'],
    ['POST', '/metrics/pm.tokens-per-day', 'GET'],
  ])('answers %s %s as method_not_allowed, allowing %s', async (method, path, allow) => {
    const tasks = stubSource(TASKS_DESCRIPTOR);
    const response = await send(handlerOver(stubRegistry({ tasks })), request(method, path, { body: {} }));

    expect(expectError(response, 405, 'method_not_allowed').error?.message).toBe(`${allow} only`);
    expect(response.headers['allow']).toBe(allow);
    expect(response.headers['content-type']).toBe('application/json; charset=utf-8');
    expect(tasks.queried).toEqual([]);
  });

  it('control: carries no allow header on an answer that is not a 405', async () => {
    const response = await send(handlerOver(), request('GET', '/sources/local.nothing'));

    expect(response.headers['allow']).toBeUndefined();
  });
});

describe('createAtlasHandler, 409', () => {
  it('refuses a request naming another contract major, before the route is read', async () => {
    const handler = handlerOver();
    const known = await send(handler, request('GET', '/sources', { headers: { 'x-atlas-contract': '2' } }));
    const unknown = await send(handler, request('GET', '/tables', { headers: { 'x-atlas-contract': '0' } }));

    expect(expectError(known, 409, 'contract_mismatch').error?.message).toBe('server speaks contract 1, request sent 2');
    expectError(unknown, 409, 'contract_mismatch');
  });

  it('refuses a full version string, since the header carries the major alone', async () => {
    const response = await send(handlerOver(), request('GET', '/sources', { headers: { 'x-atlas-contract': '1.0.0' } }));

    expectError(response, 409, 'contract_mismatch');
  });

  it('control: answers a request naming this major, and one naming none', async () => {
    const handler = handlerOver();
    const same = await send(handler, request('GET', '/sources', { headers: { 'x-atlas-contract': '1' } }));
    const none = await send(handler, request('GET', '/sources'));

    expect(same.status).toBe(200);
    expect(none.status).toBe(200);
  });
});

describe('createAtlasHandler, 503', () => {
  const PATH_MESSAGE = 'no replica at /srv/project/.rafa/atlas/atlas.sqlite';

  it.each([
    ['describe', 'GET', '/sources/local.tasks', { tasks: stubSource(TASKS_DESCRIPTOR, { describe: new ReplicaUnavailable(PATH_MESSAGE) }) }],
    ['query', 'POST', '/sources/local.tasks/query', { tasks: stubSource(TASKS_DESCRIPTOR, { query: new ReplicaUnavailable(PATH_MESSAGE) }) }],
    ['the registry asOf', 'GET', '/metrics', { asOfFault: new ReplicaUnavailable(PATH_MESSAGE) }],
  ])('answers ReplicaUnavailable from %s as replica_unavailable, without its message', async (_, method, path, faults) => {
    const errors: unknown[] = [];
    const response = await send(
      handlerOver(stubRegistry(faults), { onError: (error) => errors.push(error) }),
      request(method, path, { body: {} }),
    );
    const body = expectError(response, 503, 'replica_unavailable');

    expect(body.error).toEqual({
      code: 'replica_unavailable',
      message: 'the replica is missing or out of date; run the build',
    });
    expect(JSON.stringify(response.body)).not.toContain('/srv/project');
    expect(errors).toEqual([]);
  });
});

describe('createAtlasHandler, 500', () => {
  const SECRET = 'SELECT tokens FROM task_facts WHERE file = \'/srv/project/.rafa/atlas/atlas.sqlite\'';

  it('answers an unexpected throw as internal, carrying nothing of the thrown message', async () => {
    const thrown = new Error(SECRET);
    const errors: unknown[] = [];
    const tasks = stubSource(TASKS_DESCRIPTOR, { query: thrown });
    const response = await send(
      handlerOver(stubRegistry({ tasks }), { onError: (error) => errors.push(error) }),
      request('POST', '/sources/local.tasks/query', { body: {} }),
    );
    const body = expectError(response, 500, 'internal');
    const text = JSON.stringify(response.body);

    expect(body.error).toEqual({ code: 'internal', message: 'internal error' });
    expect(text).not.toContain('SELECT');
    expect(text).not.toContain('/srv/project');
    expect(text).not.toContain('task_facts');
    expect(errors).toEqual([thrown]);
  });

  it('answers a thrown value that is not an Error as internal, handing it to onError', async () => {
    const errors: unknown[] = [];
    const daily = stubSource(DAILY_DESCRIPTOR, { describe: SECRET });
    const response = await send(
      handlerOver(stubRegistry({ daily }), { onError: (error) => errors.push(error) }),
      request('GET', '/sources'),
    );

    expectError(response, 500, 'internal');
    expect(JSON.stringify(response.body)).not.toContain('SELECT');
    expect(errors).toEqual([SECRET]);
  });

  it('answers internal with no onError handed, and never throws itself', async () => {
    const tasks = stubSource(TASKS_DESCRIPTOR, { describe: new TypeError(SECRET) });
    const response = await send(handlerOver(stubRegistry({ tasks })), request('GET', '/sources/local.tasks'));

    expect(expectError(response, 500, 'internal').error?.message).toBe('internal error');
  });

  it('control: hands onError nothing on a refusal it answers by its own code', async () => {
    const errors: unknown[] = [];
    const handler = handlerOver(stubRegistry(), { onError: (error) => errors.push(error) });
    await send(handler, request('GET', '/tables'));
    await send(handler, request('GET', '/metrics', { query: { lens: 'finance' } }));

    expect(errors).toEqual([]);
  });
});
