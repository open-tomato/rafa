import type { Envelope } from '@open-tomato/atlas-data/contract';

/** A request as any HTTP framework hands it over, framework-free. */
export interface AtlasRequest {
  /** Upper case. */
  readonly method: string;
  /** Relative to the mount point: `/sources/local.tasks/query`. */
  readonly path: string;
  readonly query: Readonly<Record<string, string>>;
  /** Parsed JSON, or undefined. */
  readonly body: unknown;
  /** Keys lower case. */
  readonly headers: Readonly<Record<string, string>>;
}

/** What the handler answers; an adapter writes it to its framework. */
export interface AtlasResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: Envelope<unknown>;
}
