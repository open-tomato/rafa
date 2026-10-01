/**
 * The `hub` section of the config schema: the three keys a device reads
 * to reach a `rafa-hub` under `effort.sync: service`, each with its
 * field, its default, its spec and its reader, the one refusal that
 * reads two settings at once, and the {@link HubContext} an adapter is
 * handed. `config-schema.ts`'s `RafaConfig` extends {@link HubSettings},
 * and its `CONFIG_DEFAULTS` and `SETTINGS` spread {@link HUB_DEFAULTS}
 * and {@link HUB_SETTINGS} right after `effort.sync`, the setting they
 * serve, as `config-schema-release.ts`'s sections are spread.
 *
 * The section sits in a module of its own, readers included, for the
 * reason `config-schema-release.ts` and `config-readers.ts` give: measured
 * with `wc -l` when it was added, `config-schema.ts` stood at 554 lines
 * and `config-sections.ts` at 699, so the value rules here would have
 * pushed the second against the 800-line cap of `context/source.md`.
 * Every rule `config-schema.ts` states about a KEY holds here, as every
 * rule `config-sections.ts` states about a VALUE does: nothing is
 * coerced, and a string spelled like a number is refused.
 *
 * ## The keys
 *
 * `.rafa/specs/rafa-325-rafa-hub.md` names them: `hub.url` (required with
 * `effort.sync: service`), `hub.tokenSecret` (the secret store name of
 * the token, never the token) and `hub.timeout` (default `3s`, from `1s`
 * to `30s`, `0` and negative values refused). The server's keys,
 * `hub.repository`, `hub.port`, `hub.storePath` and `hub.auth.cacheFor`,
 * are read by `packages/rafa-hub/` from its own file and are not keys
 * here: in a project's file they are unknown keys, warned about and
 * acted on by nothing. Five readings the spec leaves to this module:
 *
 *   - `hub.url` and `hub.tokenSecret` default to NULL, meaning "nobody
 *     has said", as `pr.base` does: no default address or secret name
 *     is one this module could spell for every team.
 *   - `hub.url` is an absolute `http:` or `https:` URL, kept as written,
 *     and one carrying a user name or password is refused: a token
 *     written into the URL is a token in the config, which the spec
 *     forbids, and it would reach every log line naming the hub.
 *   - `hub.tokenSecret` is any name holding a character other than
 *     whitespace. Whether the secret store holds it is the `service`
 *     module's question when it reads the token, not the config's.
 *   - `hub.timeout` is whole digits then `s`, as `claims.staleAfter` is
 *     whole digits then a unit: `2.5s`, `3000ms`, `3S`, ` 3s` and the
 *     bare number `3`, which names no unit, are refused, and so are
 *     `0s`, anything below `1s` and anything above `30s`. It is kept as
 *     written, and {@link hubTimeoutMs} answers the milliseconds it
 *     spells.
 *   - None is a `CommandLineSetting`, for the reason the `pr` section
 *     gives in `config-schema-release.ts`.
 *
 * ## The refusal across two settings
 *
 * A missing `hub.url` is refused only under `effort.sync: service`, and
 * the two may come from different files: a user scope naming the hub
 * for every project and a project choosing `service` is the layout the
 * spec's README section describes. So no single file can be refused for
 * it, and `resolveConfig` asks {@link hubUrlProblems} once every setting
 * is ranked, naming the file that chose `service`. Every other
 * strategy reads no `hub` key, so a `hub.url` beside `local` is kept and
 * never refused: switching strategy is then a one-line edit.
 *
 * ## The adapter's context
 *
 * {@link hubContextOf} turns the resolved settings into the
 * {@link HubContext} `selectSync` hands a `sync` adapter as
 * `AdapterContext.hub`, the timeout already in milliseconds. It answers
 * undefined with no `hub.url`, since a hub with no address is none an
 * adapter could reach; the refusal above keeps that from happening
 * under `service`.
 */
import type { SettingSpec } from './config-schema.js';
import type { Reader, SyncStrategy } from './config-sections.js';
import type { ConfigSource } from './config.js';

import { describeValue, refused, text } from './config-sections.js';

/** The shortest `hub.timeout` accepted, in seconds. */
export const HUB_TIMEOUT_MIN_SECONDS = 1;

/** The longest `hub.timeout` accepted, in seconds. */
export const HUB_TIMEOUT_MAX_SECONDS = 30;

/** Milliseconds in one second. */
const MS_PER_SECOND = 1000;

/** What `hub.timeout` takes: whole seconds, spelled as written (`3s`). */
export type HubTimeout = `${number}s`;

/** A hub timeout as written: whole digits, then `s`. */
const HUB_TIMEOUT = /^(\d+)s$/;

/** The URL schemes `hub.url` accepts. */
const HUB_URL_PROTOCOLS: readonly string[] = Object.freeze(['http:', 'https:']);

/** The `hub` section's settings, resolved. */
export interface HubSettings {
  /**
   * The address of the hub a `service` sync reaches, or null when
   * nobody has said. `hub.url`.
   */
  hubUrl: string | null;
  /**
   * The name the hub token is stored under in the secret store, never
   * the token, or null when nobody has said. `hub.tokenSecret`.
   */
  hubTokenSecret: string | null;
  /** How long one request to the hub may take. `hub.timeout`. */
  hubTimeout: HubTimeout;
}

/** The `hub` section's defaults. */
export const HUB_DEFAULTS: Readonly<HubSettings> = Object.freeze({
  hubUrl: null,
  hubTokenSecret: null,
  hubTimeout: '3s',
});

/**
 * The milliseconds a `hub.timeout` spells (`3s` → 3000), or null for
 * anything else, `0s` and a value outside the range included.
 */
export function hubTimeoutMs(raw: unknown): number | null {
  const match = typeof raw === 'string'
    ? HUB_TIMEOUT.exec(raw)
    : null;
  if (match === null) return null;

  const seconds = Number(match[1]);
  return seconds >= HUB_TIMEOUT_MIN_SECONDS && seconds <= HUB_TIMEOUT_MAX_SECONDS
    ? seconds * MS_PER_SECOND
    : null;
}

/** Accepts a hub timeout of whole seconds in range, kept as written; see the module note. */
export const hubTimeout: Reader<HubTimeout> = (raw, at) => hubTimeoutMs(raw) === null
  ? refused(at, raw, `a duration of whole seconds from ${String(HUB_TIMEOUT_MIN_SECONDS)}s to ${String(HUB_TIMEOUT_MAX_SECONDS)}s, such as 3s`)
  : { value: raw as HubTimeout, problems: [], extras: [] };

/** Whether `raw` is an `http:` or `https:` URL carrying no user name or password. */
function isHubUrl(raw: unknown): raw is string {
  if (typeof raw !== 'string' || raw.trim() !== raw) return false;

  const url = URL.parse(raw);
  return url !== null
    && HUB_URL_PROTOCOLS.includes(url.protocol)
    && url.username === ''
    && url.password === '';
}

/** Accepts the hub's address, kept as written; see the module note. */
export const hubUrl: Reader<string> = (raw, at) => isHubUrl(raw)
  ? { value: raw, problems: [], extras: [] }
  : refused(at, raw, 'an http or https URL with no user name or password, such as https://hub.example.org');

/** The `hub` section's specs, spread into `SETTINGS`. */
export const HUB_SETTINGS: { readonly [K in keyof HubSettings]: SettingSpec<K> } = {
  hubUrl: { key: 'hub.url', read: hubUrl, cli: false },
  hubTokenSecret: { key: 'hub.tokenSecret', read: text('a secret store name'), cli: false },
  hubTimeout: { key: 'hub.timeout', read: hubTimeout, cli: false },
};

/** The strategy that reads the `hub` section. */
const HUB_STRATEGY: SyncStrategy = 'service';

/** What {@link hubUrlProblems} reads: the two settings, and where `effort.sync` came from. */
export interface HubUrlInput {
  /** The resolved `effort.sync`. */
  readonly effortSync: SyncStrategy;
  /** The resolved `hub.url`. */
  readonly hubUrl: string | null;
  /** The layer that answered `effort.sync`. */
  readonly effortSyncSource: ConfigSource;
  /** The file each file layer was read from, null when there was none. */
  readonly paths: { readonly file: string | null; readonly user: string | null };
}

/** The label a refusal opens with: the file that chose the strategy. */
function labelOf(input: HubUrlInput): string {
  const path = input.effortSyncSource === 'user'
    ? input.paths.user
    : input.paths.file;
  return path ?? input.effortSyncSource;
}

/**
 * The refusal of a `service` sync with no `hub.url` in any layer, as a
 * list of one sentence, or an empty list; see the module note.
 */
export function hubUrlProblems(input: HubUrlInput): readonly string[] {
  if (input.effortSync !== HUB_STRATEGY || input.hubUrl !== null) return [];

  return [
    `${labelOf(input)}: effort.sync is ${describeValue(HUB_STRATEGY)} and no config file names hub.url;`
      + ' expected hub.url, the address of the hub, such as https://hub.example.org',
  ];
}

/** The hub a `sync` adapter reaches, as `AdapterContext.hub` carries it. */
export interface HubContext {
  /** The hub's address: the resolved `hub.url`. */
  readonly url: string;
  /** The secret store name of the token, or null: the resolved `hub.tokenSecret`. */
  readonly tokenSecret: string | null;
  /** How long one request may take, in milliseconds: the resolved `hub.timeout`. */
  readonly timeoutMs: number;
}

/**
 * The {@link HubContext} the resolved settings name, frozen, or
 * undefined when `hub.url` is null or left out. A `hub.timeout` left out
 * is read as its default, and one the reader would refuse throws a
 * `TypeError`: only a config built by hand can carry one.
 */
export function hubContextOf(config: Partial<HubSettings>): HubContext | undefined {
  const url = config.hubUrl ?? null;
  if (url === null) return undefined;

  const timeout = config.hubTimeout ?? HUB_DEFAULTS.hubTimeout;
  const timeoutMs = hubTimeoutMs(timeout);
  if (timeoutMs === null) {
    throw new TypeError(`hub.timeout is ${describeValue(timeout)}, which no config accepts`);
  }
  return Object.freeze({ url, tokenSecret: config.hubTokenSecret ?? null, timeoutMs });
}
