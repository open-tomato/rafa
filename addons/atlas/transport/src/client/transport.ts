/**
 * The `Transport` seam: how a client request reaches a handler. The client
 * builds a plain `AtlasRequest` and reads a plain status and body back, so
 * the HTTP mechanism is replaceable.
 *
 * - `fetchTransport` sends it over `fetch` to an absolute base URL
 *   (`${location.origin}/api/atlas`). A network failure is an
 *   `AtlasTransportError`; an abort is rethrown as `fetch` raised it. A
 *   body that is not JSON comes back as its text, for the client to refuse.
 * - `localTransport` calls a handler in-process (tests, MCP, SSR). Request
 *   and answer bodies pass through JSON on the way, so the client sees what
 *   the wire would carry and no more.
 */
import type { AtlasHandler } from '../server/handler.js';
import type { AtlasRequest } from '../server/request.js';

import { AtlasTransportError } from './errors.js';

export interface TransportResponse {
  readonly status: number;
  /** Parsed JSON; the raw text when it was not JSON, undefined when empty. */
  readonly body: unknown;
}

export interface Transport {
  send(request: AtlasRequest, signal?: AbortSignal): Promise<TransportResponse>;
}

export interface FetchTransportOptions {
  /** Absolute: `${location.origin}/api/atlas`. A trailing slash is dropped. */
  readonly baseUrl: string;
  /** Defaults to the global `fetch`. */
  readonly fetch?: typeof fetch;
  /** Sent on every request, under the request's own headers. */
  readonly headers?: Readonly<Record<string, string>>;
}

/** `text` parsed as JSON; the text itself when it is not JSON, undefined when empty. */
function parseBody(text: string): unknown {
  if (text.trim() === '') return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** The request's URL under `base`, its query in key order of the record. */
function urlOf(base: string, request: AtlasRequest): string {
  const query = new URLSearchParams(request.query).toString();
  return query === ''
    ? `${base}${request.path}`
    : `${base}${request.path}?${query}`;
}

/**
 * `text` without its trailing slashes, found by a scan back from the end:
 * linear in the length, where the regex `/\/+$/` was tried from every slash
 * of an inner run and took quadratic time on one (CodeQL js/polynomial-redos).
 */
function withoutTrailingSlashes(text: string): string {
  let end = text.length;
  while (end > 0 && text[end - 1] === '/') end -= 1;
  return text.slice(0, end);
}

/** A transport over `fetch` to `options.baseUrl`. */
export function fetchTransport(options: FetchTransportOptions): Transport {
  const base = withoutTrailingSlashes(options.baseUrl);
  const send = options.fetch ?? fetch;
  return {
    async send(request, signal) {
      const hasBody = request.body !== undefined;
      const init: RequestInit = {
        method: request.method,
        headers: {
          ...options.headers,
          ...request.headers,
          ...(hasBody
            ? { 'content-type': 'application/json' }
            : {}),
        },
        ...(hasBody
          ? { body: JSON.stringify(request.body) }
          : {}),
        ...(signal === undefined
          ? {}
          : { signal }),
      };
      try {
        const response = await send(urlOf(base, request), init);
        return { status: response.status, body: parseBody(await response.text()) };
      } catch (error: unknown) {
        if (signal?.aborted === true) throw error;
        throw new AtlasTransportError('the Atlas server could not be reached', { cause: error });
      }
    },
  };
}

/** `value` as JSON would carry it: undefined members dropped, undefined itself kept. */
function overTheWire(value: unknown): unknown {
  return value === undefined
    ? undefined
    : JSON.parse(JSON.stringify(value));
}

/** A transport calling `handler` in-process. An aborted signal raises its reason before and after the call. */
export function localTransport(handler: AtlasHandler): Transport {
  return {
    async send(request, signal) {
      signal?.throwIfAborted();
      const response = await handler({ ...request, body: overTheWire(request.body) });
      signal?.throwIfAborted();
      return { status: response.status, body: overTheWire(response.body) };
    },
  };
}
