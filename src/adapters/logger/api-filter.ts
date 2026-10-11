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
 *     The name is read through its percent-encoding (`%74oken`), a name
 *     that cannot be decoded is treated as sensitive, parts are split on
 *     `;` as well as `&`, and a part with no name at all is redacted
 *     whole, since a bare query is often the signature itself.
 *   - **Headers** are cut to {@link API_HEADER_ALLOW_LIST}. An allow-list,
 *     never a deny-list: a service can invent a new secret header, and
 *     it must not be written until somebody adds it here on purpose.
 *
 * The fragment is dropped too, since an OAuth redirect carries its token
 * there. A string that is not an http or https URL is answered as
 * {@link UNREADABLE_URL} and never echoed: what cannot be parsed cannot
 * be filtered.
 *
 * An `ApiExchange` has no field for a body, and {@link filterExchange}
 * answers the members the type names and no other, whatever the object
 * handed in holds: TypeScript checks extra members on a literal alone,
 * so a record built elsewhere could carry a `body` past the type.
 *
 * {@link scrubUrls} runs the same URL filter over free text, for the
 * message and the error of an `api` entry: a failed fetch's message
 * usually holds the URL it failed on.
 *
 * ## What the filter does not catch
 *
 * It reads names, so a secret that is part of the PATH
 * (`/v1/tokens/abc123`) passes, as does one a caller puts in `service`,
 * `method`, `requestId` or the entry's `data`. Those are the caller's to
 * keep clean.
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
const SENSITIVE_NAME = /token|key|secret|sig|passw|pwd|auth|code|jwt|session|credential/i;

/** What separates one query part from the next. */
const QUERY_SEPARATOR = /([&;])/;

/** A URL inside a text, up to the first character a URL does not hold unencoded. */
const URL_IN_TEXT = /https?:\/\/[^\s"'<>)]+/gi;

/** The protocols a URL is read under. */
const READ_PROTOCOLS: readonly string[] = ['http:', 'https:'];

/** `name` with its percent-encoding read, or null when it cannot be. */
function decodedName(name: string): string | null {
  try {
    return decodeURIComponent(name.replace(/\+/g, ' '));
  } catch {
    return null;
  }
}

/**
 * One part of a query: a separator as it is, a `name=value` with its
 * value redacted when the name is sensitive or unreadable, and a part
 * with no name redacted whole.
 */
function filterQueryPart(part: string): string {
  if (part === '' || QUERY_SEPARATOR.test(part)) return part;
  const equals = part.indexOf('=');
  if (equals === -1) return REDACTED;
  const name = part.slice(0, equals);
  const plain = decodedName(name);
  return plain === null || SENSITIVE_NAME.test(plain)
    ? `${name}=${REDACTED}`
    : part;
}

/** `url` with its user info and fragment dropped and its sensitive query values redacted. */
export function filterUrl(url: string): string {
  if (!URL.canParse(url)) return UNREADABLE_URL;
  const parsed = new URL(url);
  if (!READ_PROTOCOLS.includes(parsed.protocol)) return UNREADABLE_URL;
  const parts = parsed.search.slice(1)
    .split(QUERY_SEPARATOR)
    .map(filterQueryPart);
  const query = parsed.search === ''
    ? ''
    : `?${parts.join('')}`;
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

/** `text` with every URL it holds passed through {@link filterUrl}. */
export function scrubUrls(text: string): string {
  return text.replace(URL_IN_TEXT, (url) => filterUrl(url));
}

/**
 * `exchange` as it may be written: the members the type names and no
 * other, its URL and its headers filtered; see the module note.
 */
export function filterExchange(exchange: ApiExchange): ApiExchange {
  const optional = Object.fromEntries(Object.entries({
    status: exchange.status,
    durationMs: exchange.durationMs,
    requestBytes: exchange.requestBytes,
    responseBytes: exchange.responseBytes,
    requestId: exchange.requestId,
    headers: exchange.headers === undefined
      ? undefined
      : filterHeaders(exchange.headers),
  }).filter(([, value]) => value !== undefined));
  return Object.freeze({
    service: exchange.service,
    method: exchange.method,
    url: filterUrl(exchange.url),
    ...optional,
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
