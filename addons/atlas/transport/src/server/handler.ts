/**
 * `createAtlasHandler`: one pure function from a plain request to a plain
 * response, over the sources and metrics a registry holds.
 *
 * | Method | Path | Data |
 * |---|---|---|
 * | GET | `/sources` | `DataSourceDescriptor[]` |
 * | GET | `/sources/:id` | `DataSourceDescriptor` |
 * | POST | `/sources/:id/query` | `QueryResult`, for a `QueryParams` body |
 * | GET | `/metrics` | `MetricDefinition[]`, `?lens=` filters |
 * | GET | `/metrics/:id` | `MetricDefinition` |
 *
 * Every answer is an `Envelope`. The status is 400 for invalid input, 404
 * for an unknown route, source or metric, 405 for a wrong method (with an
 * `allow` header), 409 when the `x-atlas-contract` header names another
 * major, 503 when the replica is missing or of another major, and 500 for
 * anything else. A 500 never carries the thrown message, so paths and SQL
 * stay on the server; `onError` receives the error. A 503 does not carry
 * `ReplicaUnavailable`'s message either, since it may name the replica's
 * path.
 */
import type { AtlasRequest, AtlasResponse } from './request.js';
import type { AtlasErrorCode, MetricDefinition } from '@open-tomato/atlas-data/contract';
import type { DataSource } from '@open-tomato/atlas-data/source';

import {
  ATLAS_CONTRACT_VERSION,
  InvalidParams,
  LensSchema,
  QueryParamsSchema,
  ReplicaUnavailable,
  validateStandard,
} from '@open-tomato/atlas-data/contract';

/** The handler an adapter (fetch, Express, an in-process call) wraps. */
export type AtlasHandler = (request: AtlasRequest) => Promise<AtlasResponse>;

/** What the handler serves: the sources and the metrics by id, and the replica's build time. */
export interface AtlasRegistry {
  readonly sources: ReadonlyMap<string, DataSource>;
  readonly metrics: ReadonlyMap<string, MetricDefinition>;
  /** The replica's `built_at`; may throw `ReplicaUnavailable`. */
  asOf(): string | null;
}

export interface HandlerOptions {
  /** Receives every error answered as a 500. */
  readonly onError?: (error: unknown) => void;
  /** The clock `meta.elapsedMs` is measured with, in milliseconds; defaults to `Date.now`. */
  readonly now?: () => number;
}

const STATUS: Readonly<Record<AtlasErrorCode, number>> = {
  invalid_params: 400,
  invalid_body: 400,
  unknown_route: 404,
  unknown_source: 404,
  unknown_metric: 404,
  method_not_allowed: 405,
  contract_mismatch: 409,
  replica_unavailable: 503,
  internal: 500,
};

/** The major of the contract this server speaks, as the client sends it. */
const MAJOR = ATLAS_CONTRACT_VERSION.split('.')[0] ?? '1';

const JSON_HEADERS: Readonly<Record<string, string>> = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
};

/** The path's segments, decoded; null when one is not valid percent-encoding. */
function segmentsOf(path: string): readonly string[] | null {
  try {
    return path
      .split('/')
      .filter((part) => part !== '')
      .map(decodeURIComponent);
  } catch {
    return null;
  }
}

/** Builds the handler over `registry`; it never throws, every fault is an envelope. */
export function createAtlasHandler(registry: AtlasRegistry, options: HandlerOptions = {}): AtlasHandler {
  const now = options.now ?? Date.now;
  return async (request) => {
    const started = now();
    const meta = (asOf: string | null) => ({ asOf, version: ATLAS_CONTRACT_VERSION, elapsedMs: now() - started });
    const ok = (data: unknown, asOf: string | null = registry.asOf()): AtlasResponse => ({
      status: 200,
      headers: JSON_HEADERS,
      body: { status: 'ok', data, error: null, meta: meta(asOf) },
    });
    const fail = (code: AtlasErrorCode, message: string, details?: unknown): AtlasResponse => ({
      status: STATUS[code],
      headers: JSON_HEADERS,
      body: {
        status: 'error',
        data: null,
        error: details === undefined
          ? { code, message }
          : { code, message, details },
        meta: meta(null),
      },
    });
    const notAllowed = (allow: string): AtlasResponse => {
      const response = fail('method_not_allowed', `${allow} only`);
      return { ...response, headers: { ...response.headers, allow } };
    };
    try {
      const sent = request.headers['x-atlas-contract'];
      if (sent !== undefined && sent !== MAJOR) {
        return fail('contract_mismatch', `server speaks contract ${MAJOR}, request sent ${sent}`);
      }
      const parts = segmentsOf(request.path);
      if (parts === null) return fail('unknown_route', 'no such route');
      const [head, id, tail, ...rest] = parts;
      if (rest.length > 0 || (head !== 'sources' && head !== 'metrics')) return fail('unknown_route', 'no such route');
      if (head === 'metrics') {
        if (tail !== undefined) return fail('unknown_route', 'no such route');
        if (request.method !== 'GET') return notAllowed('GET');
        if (id !== undefined) {
          const metric = registry.metrics.get(id);
          return metric === undefined
            ? fail('unknown_metric', `no metric ${id}`)
            : ok(metric);
        }
        const lens = request.query['lens'];
        if (lens === undefined) return ok([...registry.metrics.values()]);
        const checked = await validateStandard(LensSchema, lens);
        if (!checked.ok) return fail('invalid_params', 'unknown lens', checked.issues);
        return ok([...registry.metrics.values()].filter((metric) => metric.lenses.includes(checked.value)));
      }
      if (id === undefined) {
        if (request.method !== 'GET') return notAllowed('GET');
        return ok(await Promise.all([...registry.sources.values()].map((source) => source.describe())));
      }
      const source = registry.sources.get(id);
      if (source === undefined) return fail('unknown_source', `no source ${id}`);
      if (tail === undefined) {
        if (request.method !== 'GET') return notAllowed('GET');
        const descriptor = await source.describe();
        return ok(descriptor, descriptor.asOf);
      }
      if (tail !== 'query') return fail('unknown_route', 'no such route');
      if (request.method !== 'POST') return notAllowed('POST');
      if (request.body === undefined) return fail('invalid_body', 'a JSON body with QueryParams is required');
      const params = await validateStandard(QueryParamsSchema, request.body);
      if (!params.ok) return fail('invalid_params', 'the query parameters do not match the contract', params.issues);
      const result = await source.query(params.value);
      return ok(result, result.meta.asOf);
    } catch (error: unknown) {
      if (error instanceof InvalidParams) return fail('invalid_params', error.message, error.details);
      if (error instanceof ReplicaUnavailable) {
        return fail('replica_unavailable', 'the replica is missing or out of date; run the build');
      }
      options.onError?.(error);
      return fail('internal', 'internal error');
    }
  };
}
