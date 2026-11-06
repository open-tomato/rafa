/**
 * The envelope every Atlas response travels in, and the error inside a
 * failed one. The rest of the contract (descriptors, query params, query
 * results, metric definitions) joins this file as the design's section C
 * lands.
 */

/** The error codes a handler answers with; each maps to one HTTP status. */
export type AtlasErrorCode =
  | 'invalid_params'
  | 'invalid_body'
  | 'unknown_route'
  | 'unknown_source'
  | 'unknown_metric'
  | 'method_not_allowed'
  | 'contract_mismatch'
  | 'replica_unavailable'
  | 'internal';

export interface AtlasError {
  readonly code: AtlasErrorCode;
  readonly message: string;
  /** Field names and validation issues only; never a path or SQL text. */
  readonly details?: unknown;
}

export interface EnvelopeMeta {
  /** When the data was last true: the replica's build time, or the source's own stamp. */
  readonly asOf: string | null;
  /** The contract version the server speaks. */
  readonly version: string;
  readonly elapsedMs: number;
}

/** status/data/error/meta: `data` is null on an error, `error` is null on success. */
export interface Envelope<T> {
  readonly status: 'ok' | 'error';
  readonly data: T | null;
  readonly error: AtlasError | null;
  readonly meta: EnvelopeMeta;
}
