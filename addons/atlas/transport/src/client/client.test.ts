/**
 * Tests for `createAtlasClient`: a round trip over every route through
 * `localTransport` to the real handler over an in-memory registry, the
 * error envelope read as `AtlasRequestError`, a body off the envelope
 * schema read as `AtlasResponseInvalid` and another contract major read as
 * `AtlasContractMismatch`, each next to a control the same check passes.
 */
import type { Transport, TransportResponse } from './transport.js';
import type { AtlasRequest } from '../server/request.js';
import type { QueryParams } from '@open-tomato/atlas-data/contract';

import { ATLAS_CONTRACT_VERSION } from '@open-tomato/atlas-data/contract';
import { describe, expect, it } from 'bun:test';

import { createAtlasHandler } from '../server/handler.js';
import {
  ARCH_METRIC,
  DAILY_DESCRIPTOR,
  PM_METRIC,
  stubRegistry,
  stubSource,
  TASKS_DESCRIPTOR,
  TASKS_RESULT,
} from '../server/testdata/registry.fixture.js';

import { createAtlasClient } from './client.js';
import {
  AtlasContractMismatch,
  AtlasRequestError,
  AtlasResponseInvalid,
} from './errors.js';
import { localTransport } from './transport.js';

const BASE_URL = 'http://atlas.test/api/atlas';

/** A client over the real handler, with the tasks source it queries. */
function localClient() {
  const tasks = stubSource(TASKS_DESCRIPTOR);
  const transport = localTransport(createAtlasHandler(stubRegistry({ tasks })));
  return { client: createAtlasClient({ baseUrl: BASE_URL, transport }), tasks };
}

/** A transport answering `answer` to every request, recording each one. */
function answering(answer: TransportResponse): { readonly transport: Transport; readonly sent: readonly AtlasRequest[] } {
  const sent: AtlasRequest[] = [];
  return {
    sent,
    transport: {
      send: async (request) => {
        sent.push(request);
        return answer;
      },
    },
  };
}

function okEnvelope(data: unknown, version: string = ATLAS_CONTRACT_VERSION): unknown {
  return { status: 'ok', data, error: null, meta: { asOf: null, version, elapsedMs: 1 } };
}

const MAJOR = ATLAS_CONTRACT_VERSION.split('.')[0] ?? '1';

describe('createAtlasClient over localTransport, a round trip', () => {
  it('lists and describes the sources the registry holds', async () => {
    const { client } = localClient();

    expect(await client.listSources()).toEqual([TASKS_DESCRIPTOR, DAILY_DESCRIPTOR]);
    expect(await client.describeSource('local.daily')).toEqual(DAILY_DESCRIPTOR);
  });

  it('posts the params to the source and answers its result', async () => {
    const { client, tasks } = localClient();
    const params: QueryParams = { grain: 'day', measures: [{ field: 'tokens', agg: 'sum' }] };

    const result = await client.query('local.tasks', params);

    expect(result).toEqual(TASKS_RESULT);
    expect(tasks.queried).toEqual([params]);
  });

  it('lists the metrics, filtered by lens, and describes one', async () => {
    const { client } = localClient();

    expect(await client.listMetrics()).toEqual([PM_METRIC, ARCH_METRIC]);
    expect(await client.listMetrics('architect')).toEqual([ARCH_METRIC]);
    expect(await client.describeMetric('pm.tokens-per-day')).toEqual(PM_METRIC);
  });

  it('runs a metric on its source, with the window handed in place of its own', async () => {
    const { client, tasks } = localClient();

    const result = await client.runMetric('arch.tokens-by-model', { last: '7d' });

    expect(result).toEqual(TASKS_RESULT);
    expect(tasks.queried).toEqual([{ ...ARCH_METRIC.params, window: { last: '7d' } }]);
  });

  it('sends its contract major on every request', async () => {
    const { transport, sent } = answering({ status: 200, body: okEnvelope([]) });

    await createAtlasClient({ baseUrl: BASE_URL, transport }).listMetrics('pm');

    expect(sent).toEqual([
      { method: 'GET', path: '/metrics', query: { lens: 'pm' }, body: undefined, headers: { 'x-atlas-contract': MAJOR } },
    ]);
  });
});

describe('createAtlasClient, an error envelope', () => {
  it('raises AtlasRequestError with the code, status and message the server sent', async () => {
    const { client } = localClient();

    const error: unknown = await client.describeSource('local.none').catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AtlasRequestError);
    expect(error).toMatchObject({ code: 'unknown_source', status: 404, message: 'no source local.none' });
  });

  it('carries the details of an invalid_params answer', async () => {
    const { client } = localClient();

    const error: unknown = await client
      .query('local.tasks', { grain: 'fortnight' } as unknown as QueryParams)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AtlasRequestError);
    expect(error).toMatchObject({ code: 'invalid_params', status: 400 });
    expect((error as AtlasRequestError).details).toBeArray();
  });
});

describe('createAtlasClient, a bad envelope', () => {
  it('raises AtlasResponseInvalid for a body off the envelope schema', async () => {
    const { transport } = answering({ status: 200, body: { data: [TASKS_DESCRIPTOR] } });

    const error: unknown = await createAtlasClient({ baseUrl: BASE_URL, transport })
      .listSources()
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AtlasResponseInvalid);
    expect(error).toMatchObject({ code: 'response_invalid', status: 200 });
    expect((error as AtlasResponseInvalid).issues.length).toBeGreaterThan(0);
  });

  it('raises AtlasResponseInvalid for an envelope whose data is not the route\'s', async () => {
    const { transport } = answering({ status: 200, body: okEnvelope({ id: 'local.tasks' }) });

    const error: unknown = await createAtlasClient({ baseUrl: BASE_URL, transport })
      .describeSource('local.tasks')
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AtlasResponseInvalid);
  });

  it('raises AtlasResponseInvalid for an ok envelope with null data or a non-2xx status', async () => {
    const nullData = answering({ status: 200, body: okEnvelope(null) });
    const wrongStatus = answering({ status: 500, body: okEnvelope(TASKS_DESCRIPTOR) });

    const errors = await Promise.all([nullData, wrongStatus].map(({ transport }) => createAtlasClient({ baseUrl: BASE_URL, transport })
      .describeSource('local.tasks')
      .catch((caught: unknown) => caught)));

    expect(errors[0]).toBeInstanceOf(AtlasResponseInvalid);
    expect(errors[1]).toBeInstanceOf(AtlasResponseInvalid);
  });

  it('control: answers the data of the same route\'s valid envelope', async () => {
    const { transport } = answering({ status: 200, body: okEnvelope(TASKS_DESCRIPTOR) });

    expect(await createAtlasClient({ baseUrl: BASE_URL, transport }).describeSource('local.tasks')).toEqual(TASKS_DESCRIPTOR);
  });
});

describe('createAtlasClient, a contract major mismatch', () => {
  it('raises AtlasContractMismatch when meta.version names another major', async () => {
    const { transport } = answering({ status: 200, body: okEnvelope([TASKS_DESCRIPTOR], '2.0.0') });

    const error: unknown = await createAtlasClient({ baseUrl: BASE_URL, transport })
      .listSources()
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AtlasContractMismatch);
    expect(error).toMatchObject({ code: 'contract_mismatch', serverVersion: '2.0.0' });
  });

  it('raises AtlasContractMismatch, not AtlasResponseInvalid, for another major\'s body of another shape', async () => {
    const { transport } = answering({ status: 200, body: { items: [], meta: { version: '2.1.0' } } });

    const error: unknown = await createAtlasClient({ baseUrl: BASE_URL, transport })
      .listSources()
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AtlasContractMismatch);
  });

  it('raises AtlasContractMismatch for the handler\'s 409', async () => {
    const handler = createAtlasHandler(stubRegistry());
    const otherMajor: Transport = {
      send: async (request) => {
        const response = await localTransport(handler).send({ ...request, headers: { 'x-atlas-contract': '99' } });
        expect(response.status).toBe(409);
        return response;
      },
    };

    const error: unknown = await createAtlasClient({ baseUrl: BASE_URL, transport: otherMajor })
      .listSources()
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AtlasContractMismatch);
  });

  it('control: takes another minor of the same major', async () => {
    const { transport } = answering({ status: 200, body: okEnvelope([TASKS_DESCRIPTOR], `${MAJOR}.9.3`) });

    expect(await createAtlasClient({ baseUrl: BASE_URL, transport }).listSources()).toEqual([TASKS_DESCRIPTOR]);
  });
});
