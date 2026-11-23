/**
 * `toExpressHandler`: the handler as an Express middleware, over structural
 * request and response types, so this package carries no `express`
 * dependency (D21). Node's own `IncomingMessage` and `ServerResponse` fit
 * the same types, and so does Nest on its Express platform.
 *
 * Mount it with `app.use('/api/atlas', toExpressHandler(handler))`: Express
 * strips the mount, so the adapter hands the handler `req.path` as it
 * finds it. The headers reach the handler with their keys lower case and a
 * repeated header joined with `, `; a query value repeated reaches it as
 * its last string, and a nested one not at all.
 *
 * The body is `req.body` when a parser ran before the adapter (Nest's
 * default, or `express.json()`). When none did, the adapter reads the
 * request stream itself and answers two faults as envelopes, as the fetch
 * adapter does: 400 `invalid_body` for a body over `maxBodyBytes` or one
 * that is not JSON. An empty body reaches the handler as `undefined`.
 *
 * Every answer is written whole, so `next` is never called. A handler that
 * throws, which `createAtlasHandler` never does, is answered 500
 * `internal` without its message; `onError` receives the error.
 */
import type { AtlasHandler } from './handler.js';
import type { AtlasErrorCode, Envelope } from '@open-tomato/atlas-data/contract';

import { ATLAS_CONTRACT_VERSION } from '@open-tomato/atlas-data/contract';

/** The request members the adapter reads; Express's `Request` has them all. */
export interface ExpressLikeRequest {
  readonly method: string;
  /** Relative to the mount, as Express sets it. */
  readonly path: string;
  readonly query?: Readonly<Record<string, unknown>>;
  readonly headers: Readonly<Record<string, string | readonly string[] | undefined>>;
  /** What a body parser left; `undefined` when none ran. */
  readonly body?: unknown;
  /** The unread body stream, read when no parser ran. */
  [Symbol.asyncIterator]?(): AsyncIterator<Uint8Array | string>;
}

/** The response members the adapter writes; Express's `Response` has them all. */
export interface ExpressLikeResponse {
  statusCode: number;
  setHeader(name: string, value: string): unknown;
  end(chunk: string): unknown;
}

/** An Express middleware; `next` is taken and never called. */
export type ExpressMiddleware = (
  request: ExpressLikeRequest,
  response: ExpressLikeResponse,
  next?: (error?: unknown) => void,
) => Promise<void>;

export interface ExpressAdapterOptions {
  /** The largest body read from the stream, in bytes; defaults to 64 KiB. */
  readonly maxBodyBytes?: number;
  /** Receives the error of a handler that threw, answered as a 500. */
  readonly onError?: (error: unknown) => void;
}

const DEFAULT_MAX_BODY = 64 * 1024;

const JSON_CONTENT_TYPE = 'application/json; charset=utf-8';

function write(
  response: ExpressLikeResponse,
  status: number,
  body: unknown,
  headers: Readonly<Record<string, string>> = {},
): void {
  response.statusCode = status;
  const all: Readonly<Record<string, string>> = { 'content-type': JSON_CONTENT_TYPE, ...headers };
  for (const [name, value] of Object.entries(all)) response.setHeader(name, value);
  response.end(JSON.stringify(body));
}

function plainError(code: AtlasErrorCode, message: string): Envelope<null> {
  return {
    status: 'error',
    data: null,
    error: { code, message },
    meta: { asOf: null, version: ATLAS_CONTRACT_VERSION, elapsedMs: 0 },
  };
}

type BodyRead =
  | { readonly ok: true; readonly body: unknown }
  | { readonly ok: false; readonly status: number; readonly error: Envelope<null> };

const TOO_LARGE: BodyRead = { ok: false, status: 400, error: plainError('invalid_body', 'the body is too large') };

/** The stream's bytes, or null once they pass `maxBody`. */
async function bytesOf(
  stream: AsyncIterable<Uint8Array | string>,
  maxBody: number,
): Promise<Uint8Array | null> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of stream) {
    const bytes = typeof chunk === 'string'
      ? new TextEncoder().encode(chunk)
      : chunk;
    total += bytes.byteLength;
    if (total > maxBody) return null;
    chunks.push(bytes);
  }
  const whole = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    whole.set(chunk, at);
    at += chunk.byteLength;
  }
  return whole;
}

async function readBody(request: ExpressLikeRequest, method: string, maxBody: number): Promise<BodyRead> {
  if (request.body !== undefined) return { ok: true, body: request.body };
  const iterate = request[Symbol.asyncIterator];
  if (method === 'GET' || method === 'HEAD' || iterate === undefined) return { ok: true, body: undefined };
  const declared = Number(headerOf(request.headers['content-length']) ?? '0');
  if (declared > maxBody) return TOO_LARGE;
  const bytes = await bytesOf({ [Symbol.asyncIterator]: () => iterate.call(request) }, maxBody);
  if (bytes === null) return TOO_LARGE;
  const text = new TextDecoder().decode(bytes);
  if (text.trim() === '') return { ok: true, body: undefined };
  try {
    return { ok: true, body: JSON.parse(text) as unknown };
  } catch {
    return { ok: false, status: 400, error: plainError('invalid_body', 'the body is not JSON') };
  }
}

function headerOf(value: string | readonly string[] | undefined): string | undefined {
  if (value === undefined || typeof value === 'string') return value;
  return value.join(', ');
}

function headersOf(headers: ExpressLikeRequest['headers']): Record<string, string> {
  const entries: [string, string][] = [];
  for (const [key, value] of Object.entries(headers)) {
    const joined = headerOf(value);
    if (joined !== undefined) entries.push([key.toLowerCase(), joined]);
  }
  return Object.fromEntries(entries);
}

/** A query value as one string: a list's last string, nothing for an object. */
function queryValueOf(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) return undefined;
  const strings = value.filter((item): item is string => typeof item === 'string');
  return strings[strings.length - 1];
}

function queryOf(query: ExpressLikeRequest['query']): Record<string, string> {
  const entries: [string, string][] = [];
  for (const [key, value] of Object.entries(query ?? {})) {
    const read = queryValueOf(value);
    if (read !== undefined) entries.push([key, read]);
  }
  return Object.fromEntries(entries);
}

/** Wraps `handler` as an Express middleware, for `app.use(<mount>, …)`. */
export function toExpressHandler(handler: AtlasHandler, options: ExpressAdapterOptions = {}): ExpressMiddleware {
  const maxBody = options.maxBodyBytes ?? DEFAULT_MAX_BODY;
  return async (request, response) => {
    const method = request.method.toUpperCase();
    try {
      const read = await readBody(request, method, maxBody);
      if (!read.ok) {
        write(response, read.status, read.error);
        return;
      }
      const answer = await handler({
        method,
        path: request.path === ''
          ? '/'
          : request.path,
        query: queryOf(request.query),
        body: read.body,
        headers: headersOf(request.headers),
      });
      write(response, answer.status, answer.body, answer.headers);
    } catch (error: unknown) {
      options.onError?.(error);
      write(response, 500, plainError('internal', 'internal error'), { 'cache-control': 'no-store' });
    }
  };
}
