/**
 * The filter every `api` entry passes before anything is written
 * (#950). An exchange is metadata about one request and its response,
 * and metadata still carries secrets in three places, each handled here:
 *
 *   - **The URL's user info** (`https://user:pass@host`) is dropped.
 *   - **A query value under a sensitive name** is replaced by
 *     {@link REDACTED}. The name is matched loosely
 *     ({@link SENSITIVE_NAME}), so `access_token`, `api_key` and
 *     `X-Signature` are all caught; a harmless name that matches by
 *     accident loses its value, which is the cheap side to be wrong on.
 *   - **Headers** are cut to {@link API_HEADER_ALLOW_LIST}. An allow-list,
 *     never a deny-list: a service can invent a new secret header, and
 *     it must not be written until somebody adds it here on purpose.
 *
 * The fragment is dropped too, since an OAuth redirect carries its token
 * there. A string that is not an http or https URL is answered as
 * {@link UNREADABLE_URL} and never echoed: what cannot be parsed cannot
 * be filtered.
 *
 * An `ApiExchange` has no field for a body, so none can be written.
 */
import type { ApiExchange } from '../../ports/index.js';

/** What a filtered value is written as. */
export const REDACTED = '[redacted]';

/** What a string that is no http or https URL is written as. */
export const UNREADABLE_URL = '[unreadable url]';

/** The response headers that are written, lower-cased. */
export const API_HEADER_ALLOW_LIST: readonly string[] = Object.freeze([
  'content-type',
  'content-length',
  'retry-after',
  'x-request-id',
  'x-ratelimit-limit',
  'x-ratelimit-remaining',
  'x-ratelimit-reset',
]);

/** A query parameter name whose value is never written. */
const SENSITIVE_NAME = /token|key|secret|signature|password|auth|code/i;

/** The protocols a URL is read under. */
const READ_PROTOCOLS: readonly string[] = ['http:', 'https:'];

/** One `name=value` part of a query, its value redacted when the name is sensitive. */
function filterQueryPart(part: string): string {
  const equals = part.indexOf('=');
  if (equals === -1) return part;
  const name = part.slice(0, equals);
  return SENSITIVE_NAME.test(name)
    ? `${name}=${REDACTED}`
    : part;
}

/** `url` with its user info and fragment dropped and its sensitive query values redacted. */
export function filterUrl(url: string): string {
  if (!URL.canParse(url)) return UNREADABLE_URL;
  const parsed = new URL(url);
  if (!READ_PROTOCOLS.includes(parsed.protocol)) return UNREADABLE_URL;
  const parts = parsed.search.slice(1)
    .split('&')
    .map(filterQueryPart);
  const query = parsed.search === ''
    ? ''
    : `?${parts.join('&')}`;
  return `${parsed.protocol}//${parsed.host}${parsed.pathname}${query}`;
}

/** `headers` cut to the allow-list, each name lower-cased. */
function filterHeaders(headers: Readonly<Record<string, string>>): Readonly<Record<string, string>> {
  return Object.freeze(Object.fromEntries(
    Object.entries(headers)
      .map(([name, value]): [string, string] => [name.toLowerCase(), value])
      .filter(([name]) => API_HEADER_ALLOW_LIST.includes(name)),
  ));
}

/** `exchange` as it may be written: its URL and its headers filtered, the rest as given. */
export function filterExchange(exchange: ApiExchange): ApiExchange {
  const { headers, ...rest } = exchange;
  return Object.freeze({
    ...rest,
    url: filterUrl(exchange.url),
    ...headers === undefined
      ? {}
      : { headers: filterHeaders(headers) },
  });
}

/** The one line `exchange` reads as, its URL filtered. */
export function exchangeLine(exchange: ApiExchange): string {
  const outcome = exchange.status === undefined
    ? 'no response'
    : String(exchange.status);
  const took = exchange.durationMs === undefined
    ? ''
    : ` in ${Math.round(exchange.durationMs)} ms`;
  return `${exchange.service} ${exchange.method.toUpperCase()} ${filterUrl(exchange.url)} → ${outcome}${took}`;
}
