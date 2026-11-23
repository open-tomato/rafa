/**
 * The `hub` section of the config schema: the four keys a device reads
 * to reach a `rafa-hub` under `effort.sync: service`, each with its
 * field, its default, its spec and its reader, the one refusal that
 * reads two settings at once, and the {@link HubContext} an adapter is
 * handed. {@link HUB_SECTION} hands them to core as one `ConfigSection`,
 * package `hub`, with {@link hubUrlProblems} as its check, and the
 * `declare module` below adds {@link HubSettings} to `RafaConfig`.
 * {@link HubShape} holds the keys a file writes, which
 * `src/config/shape.ts` composes into `ConfigShape`, the nested file shape.
 * `config-registry.ts`'s `CONFIG_DEFAULTS` and `SETTINGS`
 * spread {@link HUB_DEFAULTS} and {@link HUB_SETTINGS} right after
 * `effort.sync`, the setting they serve, as `config-schema-release.ts`'s
 * sections are spread.
 *
 * The section sits in a module of its own, readers included, for the
 * reason `config-schema-release.ts` and `config-readers.ts` give: measured
 * with `wc -l` when it was added, `config-schema.ts` stood at 554 lines
 * and `config-sections.ts` at 699, so the value rules here would have
 * pushed the second against the 800-line cap of `context/source.md`.
 * Every rule `config.ts` and `section.ts` state about a KEY holds here, as every
 * rule `config-sections.ts` states about a VALUE does: nothing is
 * coerced, and a string spelled like a number is refused.
 *
 * ## The keys
 *
 * `.rafa/specs/rafa-325-rafa-hub.md` names them: `hub.url` (required with
 * `effort.sync: service`), `hub.tokenSecret` (the secret store name of
 * the token, never the token) and `hub.timeout` (default `3s`, from `1s`
 * to `30s`, `0` and negative values refused). A fourth, `hub.project`,
 * names the project the device syncs on the hub; the port's project
 * otherwise defaults to the root commit sha of the repository holding
 * the store, and nobody is expected to set it. The server's keys,
 * `hub.repository`, `hub.port`, `hub.storePath`, `hub.auth.cacheFor`,
 * `hub.store.sqliteLibrary` and `hub.index.rebuildAfterPush`, are read by
 * `packages/rafa-hub/` from its own file and are not keys here: in a
 * project's file they are unknown keys, warned about and acted on by
 * nothing. Six readings the spec leaves to this module:
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
 *   - `hub.project` defaults to NULL, meaning "read the root commit",
 *     and is any text holding a character other than whitespace.
 *   - None is a `CommandLineSetting`, for the reason the `pr` section
 *     gives in `config-schema-release.ts`.
 *
 * ## The refusal across two settings
 *
 * A missing `hub.url` is refused only under `effort.sync: service`, and
 * the two may come from different files: a user scope naming the hub
 * for every project and a project choosing `service` is the layout the
 * spec's README section describes. So no single file can be refused for
 * it, and {@link hubUrlProblems} is the section's check: `resolveConfig`
 * asks it once every setting is ranked, and it names the file that chose
 * `service`, read off that setting's provenance: a scope's module file
 * and its YAML file, the local layer, are each named by their own path,
 * as are the user scope's two files, which both report `user`. Every other
 * strategy reads no `hub` key, so a `hub.url` beside `local` is kept and
 * never refused: switching strategy is then a one-line edit.
 *
 * ## The adapter's context
 *
 * {@link hubContextOf} turns the resolved settings into the
 * {@link HubContext} `selectSync` hands a `sync` adapter as
 * `AdapterContext.hub`, the timeout already in milliseconds and
 * `hub.project` carried as `project`, null when unset. It answers
 * undefined with no `hub.url`, since a hub with no address is none an
 * adapter could reach; the refusal above keeps that from happening
 * under `service`. It also carries core's `effortSyncSkew`, the
 * resolved `effort.syncSkew`, as `syncSkew`, read as `refuse` when the
 * config names none: the skew mode is read only under `service`, so it
 * travels with the hub an adapter reaches rather than on its own.
 */
import type {
  ConfigCheckInput,
  ConfigSection,
  SettingSpec,
} from './core/config/index.js';
import type {
  Reader,
  SyncSkewMode,
  SyncStrategy,
} from './core/config/sections.js';

import { describeValue, refused, text } from './core/config/sections.js';

declare module './core/config/config-schema.js' {
  /** The `hub` section's fields, added to core's. */
  interface RafaConfig extends HubSettings {}
}

/** The `hub` keys a file writes; `src/config/shape.ts` composes them into `ConfigShape`. */
export interface HubShape {
  readonly hub: {
    readonly url: string;
    readonly tokenSecret: string;
    readonly timeout: HubTimeout;
    readonly project: string;
  };
}

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
  /**
   * The project this device syncs on the hub, or null to read the
   * root commit of the store's repository. `hub.project`.
   */
  hubProject: string | null;
}

/** The `hub` section's defaults. */
export const HUB_DEFAULTS: Readonly<HubSettings> = Object.freeze({
  hubUrl: null,
  hubTokenSecret: null,
  hubTimeout: '3s',
  hubProject: null,
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
  hubProject: { key: 'hub.project', read: text('a project id'), cli: false },
};

/** The strategy that reads the `hub` section. */
const HUB_STRATEGY: SyncStrategy = 'service';

/**
 * The label a refusal opens with: the file that chose the strategy, read
 * off its provenance, so a scope's YAML file (source `local`, or `user`
 * for the user scope's) is named rather than its layer word; the layer
 * word itself where no file answered, the command line or a default.
 */
function labelOf(input: ConfigCheckInput): string {
  return input.provenance.effortSync?.file ?? input.sources.effortSync;
}

/**
 * The `hub` section's check: the refusal of a `service` sync with no
 * `hub.url` in any layer, as a list of one sentence, or an empty list;
 * see the module note.
 */
export function hubUrlProblems(input: ConfigCheckInput): readonly string[] {
  if (input.config.effortSync !== HUB_STRATEGY || input.config.hubUrl !== null) return [];

  return [
    `${labelOf(input)}: effort.sync is ${describeValue(HUB_STRATEGY)} and no config file names hub.url;`
      + ' expected hub.url, the address of the hub, such as https://hub.example.org',
  ];
}

/** The `hub` section: its four settings, their defaults, and {@link hubUrlProblems}. */
export const HUB_SECTION: ConfigSection = Object.freeze({
  package: 'hub',
  settings: Object.freeze(HUB_SETTINGS),
  defaults: HUB_DEFAULTS,
  checks: Object.freeze([hubUrlProblems]),
});

/** The hub a `sync` adapter reaches, as `AdapterContext.hub` carries it. */
export interface HubContext {
  /** The hub's address: the resolved `hub.url`. */
  readonly url: string;
  /** The secret store name of the token, or null: the resolved `hub.tokenSecret`. */
  readonly tokenSecret: string | null;
  /** How long one request may take, in milliseconds: the resolved `hub.timeout`. */
  readonly timeoutMs: number;
  /**
   * What a sync does when the device is behind its hub: the resolved
   * `effort.syncSkew`, `refuse` when the config names none.
   */
  readonly syncSkew: SyncSkewMode;
  /** The project synced on the hub, or null to read the root commit: the resolved `hub.project`. */
  readonly project: string | null;
}

/** The skew mode {@link hubContextOf} reads when the config names none. */
const DEFAULT_SYNC_SKEW: SyncSkewMode = 'refuse';

/** What {@link hubContextOf} reads: the `hub` settings and core's `effortSyncSkew`. */
export type HubContextInput = Partial<HubSettings> & { readonly effortSyncSkew?: SyncSkewMode };

/**
 * The {@link HubContext} the resolved settings name, frozen, or
 * undefined when `hub.url` is null or left out. A `hub.timeout` left out
 * is read as its default, an `effortSyncSkew` left out as `refuse`, and one the reader would refuse throws a
 * `TypeError`: only a config built by hand can carry one.
 */
export function hubContextOf(config: HubContextInput): HubContext | undefined {
  const url = config.hubUrl ?? null;
  if (url === null) return undefined;

  const timeout = config.hubTimeout ?? HUB_DEFAULTS.hubTimeout;
  const timeoutMs = hubTimeoutMs(timeout);
  if (timeoutMs === null) {
    throw new TypeError(`hub.timeout is ${describeValue(timeout)}, which no config accepts`);
  }
  return Object.freeze({
    url,
    tokenSecret: config.hubTokenSecret ?? null,
    timeoutMs,
    syncSkew: config.effortSyncSkew ?? DEFAULT_SYNC_SKEW,
    project: config.hubProject ?? null,
  });
}
