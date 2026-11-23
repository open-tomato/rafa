/**
 * `createAtlasClient`: the typed client over the Atlas routes. It knows the
 * contracts and only makes requests: every answer is read against the zod
 * envelope schema for its route's data, so a server of another shape fails
 * loudly at the edge rather than in a chart.
 *
 * Each request sends `x-atlas-contract` with the client's major. An answer
 * is read in this order: a 409, or a `meta.version` of another major, is
 * `AtlasContractMismatch`; a body failing the envelope schema is
 * `AtlasResponseInvalid`; an error envelope is `AtlasRequestError`; an ok
 * envelope without data, or on a status other than 2xx, is
 * `AtlasResponseInvalid` too. An empty `meta.version` names no major (the
 * fetch adapter's own 400 and 404 carry one), so it is not a mismatch.
 */
import type { Transport } from './transport.js';
import type { AtlasRequest } from '../server/request.js';
import type {
  DataSourceDescriptor,
  Lens,
  MetricDefinition,
  QueryParams,
  QueryResult,
  Window,
} from '@open-tomato/atlas-data/contract';

import {
  applyFormula,
  ATLAS_CONTRACT_VERSION,
  DataSourceDescriptorSchema,
  envelopeSchema,
  MetricDefinitionSchema,
  QueryResultSchema,
} from '@open-tomato/atlas-data/contract';

import {
  AtlasContractMismatch,
  AtlasRequestError,
  AtlasResponseInvalid,
} from './errors.js';
import { fetchTransport } from './transport.js';

export interface AtlasClientOptions {
  /** Absolute, as `fetchTransport` takes it; unused when `transport` is handed. */
  readonly baseUrl: string;
  /** Defaults to `fetchTransport({ baseUrl })`. */
  readonly transport?: Transport;
}

export interface AtlasClient {
  listSources(signal?: AbortSignal): Promise<readonly DataSourceDescriptor[]>;
  describeSource(id: string, signal?: AbortSignal): Promise<DataSourceDescriptor>;
  query(id: string, params: QueryParams, signal?: AbortSignal): Promise<QueryResult>;
  listMetrics(lens?: Lens, signal?: AbortSignal): Promise<readonly MetricDefinition[]>;
  describeMetric(id: string, signal?: AbortSignal): Promise<MetricDefinition>;
  /** Describes the metric, queries its source over `window` (its own window when left out) and applies its formula. */
  runMetric(id: string, window?: Window, signal?: AbortSignal): Promise<QueryResult>;
}

/** The contract major this client speaks. */
const MAJOR = ATLAS_CONTRACT_VERSION.split('.')[0] ?? '1';

/** The envelope schema for data `T`, typed off `envelopeSchema` so this package imports no zod. */
type EnvelopeSchema<T> = ReturnType<typeof envelopeSchema<T>>;

const SOURCES = envelopeSchema(DataSourceDescriptorSchema.array());
const SOURCE = envelopeSchema(DataSourceDescriptorSchema);
const RESULT = envelopeSchema(QueryResultSchema);
const METRICS = envelopeSchema(MetricDefinitionSchema.array());
const METRIC = envelopeSchema(MetricDefinitionSchema);

/** `meta.version` read loosely off a body of any shape; null when absent or empty. */
function statedVersion(body: unknown): string | null {
  if (typeof body !== 'object' || body === null || !('meta' in body)) return null;
  const meta: unknown = body.meta;
  if (typeof meta !== 'object' || meta === null || !('version' in meta)) return null;
  const version: unknown = meta.version;
  return typeof version === 'string' && version !== ''
    ? version
    : null;
}

/** The data of an ok envelope in `body`, or the client error the answer amounts to. */
function readAnswer<T>(status: number, body: unknown, schema: EnvelopeSchema<T>): T {
  const version = statedVersion(body);
  const serverMajor = version?.split('.')[0];
  if (serverMajor !== undefined && serverMajor !== MAJOR) {
    throw new AtlasContractMismatch(`client speaks contract ${MAJOR}, server answered ${version}`, version);
  }
  if (status === 409) {
    throw new AtlasContractMismatch(`client speaks contract ${MAJOR}, server refused it`, version);
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new AtlasResponseInvalid(`the answer (status ${status}) is not an Atlas envelope`, status, parsed.error.issues);
  }
  const envelope = parsed.data;
  if (envelope.error !== null) {
    throw new AtlasRequestError(envelope.error.code, status, envelope.error.message, envelope.error.details);
  }
  if (status < 200 || status > 299 || envelope.data === null) {
    throw new AtlasResponseInvalid(`an ok envelope without data, or on status ${status}`, status);
  }
  return envelope.data;
}

/** A request of this client's contract major, with no query and no body unless given. */
function requestOf(method: string, path: string, extra: Partial<Pick<AtlasRequest, 'body' | 'query'>> = {}): AtlasRequest {
  return {
    method,
    path,
    query: extra.query ?? {},
    body: extra.body,
    headers: { 'x-atlas-contract': MAJOR },
  };
}

/** Builds a client over `options.transport`, or over `fetch` to `options.baseUrl`. */
export function createAtlasClient(options: AtlasClientOptions): AtlasClient {
  const transport = options.transport ?? fetchTransport({ baseUrl: options.baseUrl });
  const call = async <T>(request: AtlasRequest, schema: EnvelopeSchema<T>, signal?: AbortSignal): Promise<T> => {
    const response = await transport.send(request, signal);
    return readAnswer(response.status, response.body, schema);
  };
  const client: AtlasClient = {
    listSources: (signal) => call(requestOf('GET', '/sources'), SOURCES, signal),
    describeSource: (id, signal) => call(requestOf('GET', `/sources/${encodeURIComponent(id)}`), SOURCE, signal),
    query: (id, params, signal) => call(
      requestOf('POST', `/sources/${encodeURIComponent(id)}/query`, { body: params }),
      RESULT,
      signal,
    ),
    listMetrics: (lens, signal) => call(
      requestOf('GET', '/metrics', lens === undefined
        ? {}
        : { query: { lens } }),
      METRICS,
      signal,
    ),
    describeMetric: (id, signal) => call(requestOf('GET', `/metrics/${encodeURIComponent(id)}`), METRIC, signal),
    runMetric: async (id, window, signal) => {
      const metric = await client.describeMetric(id, signal);
      const params: QueryParams = window === undefined
        ? metric.params
        : { ...metric.params, window };
      const result = await client.query(metric.sourceId, params, signal);
      return applyFormula(result, metric.formula);
    },
  };
  return client;
}
