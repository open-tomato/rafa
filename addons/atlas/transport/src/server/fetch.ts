/**
 * `toFetchHandler`: the handler as a `(Request) => Promise<Response>`, for
 * `Bun.serve`, Hono or a Next route handler.
 *
 * The adapter strips `basePath`, lower-cases the header keys, reads the
 * query string and parses a JSON body, then writes the handler's answer
 * back as JSON. It answers two faults itself, as envelopes of the same
 * contract version: 404 `unknown_route` for a path outside `basePath`, and
 * 400 `invalid_body` for a body over `maxBodyBytes` or one that is not
 * JSON. An empty body reaches the handler as `undefined`.
 */
import type { AtlasHandler } from './handler.js';
import type { AtlasErrorCode, Envelope } from '@open-tomato/atlas-data/contract';

import { ATLAS_CONTRACT_VERSION } from '@open-tomato/atlas-data/contract';

export interface FetchAdapterOptions {
  /** The mount point, such as `/api/atlas`; a trailing slash is dropped. */
  readonly basePath?: string;
  /** The largest body read, in bytes; defaults to 64 KiB. */
  readonly maxBodyBytes?: number;
}

const DEFAULT_MAX_BODY = 64 * 1024;

const JSON_CONTENT_TYPE = 'application/json; charset=utf-8';

function reply(status: number, body: unknown, headers: Readonly<Record<string, string>> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': JSON_CONTENT_TYPE, ...headers } });
}

function plainError(status: number, code: AtlasErrorCode, message: string): Response {
  const body: Envelope<null> = {
    status: 'error',
    data: null,
    error: { code, message },
    meta: { asOf: null, version: ATLAS_CONTRACT_VERSION, elapsedMs: 0 },
  };
  return reply(status, body);
}

type BodyRead = { readonly ok: true; readonly body: unknown } | { readonly ok: false; readonly response: Response };

async function readBody(request: Request, maxBody: number): Promise<BodyRead> {
  if (request.method === 'GET' || request.method === 'HEAD') return { ok: true, body: undefined };
  const declared = Number(request.headers.get('content-length') ?? '0');
  const tooLarge = { ok: false, response: plainError(400, 'invalid_body', 'the body is too large') } as const;
  if (declared > maxBody) return tooLarge;
  const bytes = await request.arrayBuffer();
  if (bytes.byteLength > maxBody) return tooLarge;
  const text = new TextDecoder().decode(bytes);
  if (text.trim() === '') return { ok: true, body: undefined };
  try {
    return { ok: true, body: JSON.parse(text) as unknown };
  } catch {
    return { ok: false, response: plainError(400, 'invalid_body', 'the body is not JSON') };
  }
}

/** A plain record of `pairs`, its keys through `keyOf`; a later duplicate wins. */
function entriesOf(
  pairs: { forEach(visit: (value: string, key: string) => void): void },
  keyOf: (key: string) => string,
): Record<string, string> {
  const entries: [string, string][] = [];
  pairs.forEach((value, key) => {
    entries.push([keyOf(key), value]);
  });
  return Object.fromEntries(entries);
}

/** Wraps `handler` as a fetch handler mounted at `options.basePath`. */
export function toFetchHandler(
  handler: AtlasHandler,
  options: FetchAdapterOptions = {},
): (request: Request) => Promise<Response> {
  const base = (options.basePath ?? '').replace(/\/+$/, '');
  const maxBody = options.maxBodyBytes ?? DEFAULT_MAX_BODY;
  return async (request) => {
    const url = new URL(request.url);
    if (base !== '' && url.pathname !== base && !url.pathname.startsWith(`${base}/`)) {
      return plainError(404, 'unknown_route', 'no such route');
    }
    const read = await readBody(request, maxBody);
    if (!read.ok) return read.response;
    const response = await handler({
      method: request.method.toUpperCase(),
      path: url.pathname.slice(base.length) || '/',
      query: entriesOf(url.searchParams, (key) => key),
      body: read.body,
      headers: entriesOf(request.headers, (key) => key.toLowerCase()),
    });
    return reply(response.status, response.body, response.headers);
  };
}
