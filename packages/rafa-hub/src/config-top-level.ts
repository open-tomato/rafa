/**
 * The hub config file's top level, judged before any key under `hub` is
 * read: the refuse mode for the keys beside `hub`, the refusal of a
 * function value, and {@link HubConfigFile}, the shape an operator's
 * `rafa-hub.config.ts` writes. `config.ts` runs both on every document
 * through `readHubDocument`, a parsed `.yaml` file and a loaded `.ts`
 * module alike, so each rule has one home (#1659).
 *
 * ## The refuse mode at the top level
 *
 * The file holds exactly `hub` and `dangerous`, and `dangerous` holds
 * only `hub`. Any other key is refused with a problem naming where it
 * belongs, in the shape `config.ts` gives the `install` refusal:
 * `<path>: <key> is not a key of the hub's config; expected …`.
 *
 *   - A project key, one a project's `rafa.config.ts` reads at its top
 *     level or under its `dangerous` section ({@link PROJECT_KEYS},
 *     {@link PROJECT_DANGEROUS_KEYS}), points to that file: a project
 *     block pasted into the hub's file is the mistake it names.
 *   - A served-project key ({@link SERVED_PROJECT_KEYS}: `projects` and
 *     the four keys of one served project) points to `hub.projects`.
 *   - `install` at the top level points to `rafa-hub install`, as it did
 *     before this module, with {@link installRefusal}'s sentence, which
 *     `config.ts` gives `hub.install` too.
 *   - Any other key, a misspelt `dangerous` among them, names the two
 *     sections the file takes, and under `dangerous` the one it holds.
 *
 * ## The refusal of a function value
 *
 * No key of the hub's config is an extension point, so a function is
 * refused wherever it is written, naming its key path in the form
 * refusals already spell (`hub.projects[0].name`). Only a `.ts` module
 * can hold one; YAML never does, and the walk finds nothing there.
 *
 * ## Readings the spec leaves to this module
 *
 *   - The served-project keys hold `repository` and `storePath`, which
 *     are `hub` keys as well: written at the top level, either one is
 *     still a key the file holds only under `hub`, and the sentence names
 *     `hub.projects` beside the spelling of one project.
 *   - `store` is a project key (`store.backend`) and a hub key
 *     (`hub.store`); at the top level it is read as the project's, since
 *     the top level is where a project's file holds it.
 *   - The project keys are the top-level names of the settings the client
 *     registers, measured on 2026-11-27 by listing the first segment of
 *     every key `registeredSettings()` answers with every bundled section
 *     loaded, less `hub` and `dangerous`, which the hub's file holds too.
 *     The hub imports nothing of the client, so the list is written out
 *     here; a name it misses is still refused, by the last sentence.
 *   - The walk for functions skips what the refuse mode refused, so a
 *     key is refused once: by its name when the file holds no such key,
 *     by its value otherwise.
 *   - A function is left out of the {@link FunctionValues.document} the
 *     readers see, a list entry kept as undefined so later positions
 *     keep their index, and {@link FunctionValues.keys} lists each key
 *     path, so `config.ts` drops the reader's problem at that key (a
 *     required key read as missing) in favour of this one.
 *   - The walk descends plain mappings and lists only, each object once,
 *     so a `.ts` module's cyclic object ends the walk rather than the
 *     stack. A class instance is a value, kept as written.
 *
 * `config.ts` imports this module, so this one takes only types from
 * the readers, never a value, and its few helpers are its own, as
 * `config-dangerous.ts`'s are.
 */
import type { HubLoginMode } from './config-login.js';
import type { HubEmbeddingPrecision, HubStoreEngine } from './config-store.js';
import type { HubAuthAdapter } from './config.js';

/** The sections the hub's config file holds at its top level. */
export const TOP_LEVEL_KEYS: readonly string[] = Object.freeze(['hub', 'dangerous']);

/** The one key the hub's config file holds under `dangerous`. */
export const DANGEROUS_SECTION_KEYS: readonly string[] = Object.freeze(['hub']);

/** The key an install record holds, refused in the operator's config file. */
export const INSTALL_KEY = 'install';

/**
 * The top-level keys of a project's `rafa.config.ts`, less `hub` and
 * `dangerous`: the first segment of every setting the client registers,
 * measured on 2026-11-27.
 */
export const PROJECT_KEYS: readonly string[] = Object.freeze([
  'allowList', 'board', 'bugs', 'checks', 'claims', 'cleanup', 'collaborate', 'effort', 'errors', 'features',
  'hints', 'issues', 'learning', 'logger', 'loop', 'merge', 'modules', 'naming', 'output', 'plan', 'pr',
  'prerequisites', 'release', 'roadmap', 'routing', 'specs', 'status', 'store', 'task', 'templates', 'tests',
  'tiers', 'tracker', 'tracking', 'triage', 'version',
]);

/** The keys a project's `rafa.config.ts` reads under its `dangerous` section, measured on 2026-11-27. */
export const PROJECT_DANGEROUS_KEYS: readonly string[] = Object.freeze(['acceptStaleRefs', 'acceptVersionCollision', 'selfUpdateDuringLoop']);

/** The keys of the projects the hub serves, which the file holds under `hub.projects` alone. */
export const SERVED_PROJECT_KEYS: readonly string[] = Object.freeze(['projects', 'id', 'name', 'repository', 'storePath']);

/** Where a project key belongs, as a refusal says it. */
const PROJECT_EXPECTED = 'expected it in the project\'s rafa.config.ts, which the hub never reads';

/** Where a served-project key belongs, as a refusal says it. */
const SERVED_PROJECT_EXPECTED = 'expected the projects the hub serves under hub.projects, each holding id, name, repository and storePath';

/** Where the install's values belong, as a refusal says it. */
const INSTALL_EXPECTED = 'expected the install\'s values in the install record, written by rafa-hub install';

/** What the top level takes, as a refusal says it. */
const TOP_LEVEL_EXPECTED = 'expected only hub and dangerous at the top level';

/** What `dangerous` takes, as a refusal says it. */
const DANGEROUS_EXPECTED = 'expected only dangerous.hub under dangerous';

/** What a key holding a function takes, as a refusal says it. */
const FUNCTION_EXPECTED = 'expected a value written out; the hub\'s config declares no extension point, so it runs no function';

/** One served project, as `hub.projects` lists it. */
export interface HubConfigFileProject {
  /** The project's root commit sha, 40 lowercase hex characters. */
  readonly id: string;
  /** The name `/v1/status` answers for it. */
  readonly name: string;
  /** The `owner/name` whose permission decides who may sync it. */
  readonly repository: string;
  /** Its SQLite store, a relative path resolved against the config file's directory. */
  readonly storePath: string;
}

/** The OAuth provider the login is handed to: `hub.auth.login.oauth`. */
export interface HubConfigFileOAuth {
  readonly authorizeUrl: string;
  readonly tokenUrl: string;
  readonly userUrl: string;
  readonly clientId: string;
  /** The name of the environment variable holding the client secret, never the secret. */
  readonly clientSecretVariable: string;
  readonly scope?: string;
  /** The provider's user ids allowed to log in. */
  readonly allowed: readonly (string | number)[];
  readonly callbackUrl?: string;
}

/** `hub.auth`: how the hub identifies a caller. */
export interface HubConfigFileAuth {
  readonly adapter?: HubAuthAdapter;
  /** The names of the environment variables holding the keys, never the keys. */
  readonly apiKeys?: readonly string[];
  /** A duration of whole `s`, `m` or `h` from `1m` to `24h`, or false to ask GitHub on every request. */
  readonly cacheFor?: string | false;
  readonly login?: {
    readonly mode?: HubLoginMode;
    readonly oauth?: HubConfigFileOAuth;
  };
}

/** The `hub` section, as an operator writes it: every key optional where `config.ts` gives it a default. */
export interface HubConfigFileHub {
  readonly repository?: string;
  readonly port?: number;
  readonly storePath?: string;
  readonly projects?: readonly HubConfigFileProject[];
  readonly auth?: HubConfigFileAuth;
  readonly store?: {
    readonly engine?: HubStoreEngine;
    readonly sqliteLibrary?: string;
    readonly postgres?: { readonly urlVariable?: string };
  };
  readonly index?: {
    readonly rebuildAfterPush?: boolean;
    readonly embedding?: {
      readonly model?: string;
      readonly precision?: HubEmbeddingPrecision;
    };
  };
}

/**
 * The hub's config file as written: the object a `rafa-hub.config.ts`
 * exports, `export default { … } satisfies HubConfigFile`, and the
 * mapping a `rafa-hub.yaml` holds. `config.ts` reads it into a
 * `HubConfig`.
 */
export interface HubConfigFile {
  readonly hub: HubConfigFileHub;
  readonly dangerous?: {
    readonly hub?: {
      /** The most rows one push or pull page holds, a whole number from 1 up, or `unlimited`. */
      readonly maxPayloadRows?: number | 'unlimited';
    };
  };
}

/** A mapping, as a parsed document or a loaded module holds one. */
type Mapping = Readonly<Record<string, unknown>>;

/** The top level judged: the sections the readers take, and the problems of every key refused. */
export interface TopLevelReading {
  /**
   * The document's `hub` and `dangerous`, `dangerous` holding only its
   * `hub` when it is a mapping; empty for a document that is no mapping.
   */
  readonly sections: Mapping;
  readonly problems: readonly string[];
}

/** The function values of a document: the document without them, their key paths, and a problem each. */
export interface FunctionValues {
  /** The document with each function left out, a list entry kept as undefined. */
  readonly document: unknown;
  /** The key path of each function, such as `hub.projects[0].name`. */
  readonly keys: readonly string[];
  readonly problems: readonly string[];
}

/** Whether `raw` is a mapping, rather than a list, a scalar or null. */
function isMapping(raw: unknown): raw is Mapping {
  return typeof raw === 'object' && raw !== null && !Array.isArray(raw);
}

/** Whether `raw` is a mapping written as one, rather than a class instance. */
function isPlainMapping(raw: unknown): raw is Mapping {
  if (!isMapping(raw)) return false;

  const prototype: unknown = Object.getPrototypeOf(raw);
  return prototype === Object.prototype || prototype === null;
}

/** The refusal of the `install` key at `key` (`install`, `hub.install`), naming `rafa-hub install`. */
export function installRefusal(path: string, key: string): string {
  return `${path}: ${key} is not a key of the hub's config; ${INSTALL_EXPECTED}`;
}

/** The refusal of a top-level `key`, naming where it belongs. */
function topLevelRefusal(path: string, key: string): string {
  if (key === INSTALL_KEY) return installRefusal(path, key);

  const refuse = (expected: string): string => `${path}: ${key} is not a key of the hub's config; ${expected}`;
  if (PROJECT_KEYS.includes(key)) return refuse(PROJECT_EXPECTED);
  if (SERVED_PROJECT_KEYS.includes(key)) return refuse(SERVED_PROJECT_EXPECTED);
  return refuse(TOP_LEVEL_EXPECTED);
}

/** The refusal of `key` under `dangerous`, naming where it belongs. */
function dangerousRefusal(path: string, key: string): string {
  const expected = PROJECT_DANGEROUS_KEYS.includes(key)
    ? PROJECT_EXPECTED
    : DANGEROUS_EXPECTED;
  return `${path}: dangerous.${key} is not a key of the hub's config; ${expected}`;
}

/**
 * Judges the top level of `document`, read from `path`: one problem per
 * key other than `hub` and `dangerous`, and per key under `dangerous`
 * other than `hub`, in the order written. A `dangerous` that is no
 * mapping is kept as written, for its own reader to refuse.
 */
export function readTopLevel(path: string, document: unknown): TopLevelReading {
  if (!isMapping(document)) return { sections: Object.freeze({}), problems: [] };

  const refused = Object.keys(document).filter((key) => !TOP_LEVEL_KEYS.includes(key));
  const dangerous = document['dangerous'];
  const dangerousRefused = isMapping(dangerous)
    ? Object.keys(dangerous).filter((key) => !DANGEROUS_SECTION_KEYS.includes(key))
    : [];
  const kept = Object.fromEntries(Object.entries(document).filter(([key]) => TOP_LEVEL_KEYS.includes(key)));
  const sections = isMapping(dangerous)
    ? { ...kept, dangerous: Object.fromEntries(Object.entries(dangerous).filter(([key]) => DANGEROUS_SECTION_KEYS.includes(key))) }
    : kept;

  return {
    sections: Object.freeze(sections),
    problems: [
      ...refused.map((key) => topLevelRefusal(path, key)),
      ...dangerousRefused.map((key) => dangerousRefusal(path, key)),
    ],
  };
}

/** The walk's state: the key paths of the functions found, and the objects on the way down. */
interface Walk {
  readonly keys: string[];
  readonly seen: WeakSet<object>;
}

/**
 * `entry` at `at` without its functions, or undefined for a function
 * itself, each function's key path pushed onto `walk.keys`.
 */
function stripEntry(entry: unknown, at: string, walk: Walk): unknown {
  if (typeof entry !== 'function') return strip(entry, at, walk);

  walk.keys.push(at);
  return undefined;
}

/** `value` at `key` without its functions; a list keeps a function's place as undefined, a mapping leaves its key out. */
function strip(value: unknown, key: string, walk: Walk): unknown {
  if (Array.isArray(value)) {
    if (walk.seen.has(value)) return value;

    walk.seen.add(value);
    return value.map((entry: unknown, position) => stripEntry(entry, `${key}[${String(position)}]`, walk));
  }
  if (!isPlainMapping(value) || walk.seen.has(value)) return value;

  walk.seen.add(value);
  const entries = Object.entries(value).flatMap(([name, entry]): [string, unknown][] => {
    const at = key === ''
      ? name
      : `${key}.${name}`;
    const kept = stripEntry(entry, at, walk);
    return typeof entry === 'function'
      ? []
      : [[name, kept]];
  });
  return Object.fromEntries(entries);
}

/**
 * The function values of `document`, read from `path`, at any depth:
 * one problem per function naming its key path, and the document
 * without them for the readers to judge.
 */
export function readFunctionValues(path: string, document: unknown): FunctionValues {
  const walk: Walk = { keys: [], seen: new WeakSet() };
  const stripped = typeof document === 'function'
    ? undefined
    : strip(document, '', walk);
  const keys = typeof document === 'function'
    ? ['the top level']
    : walk.keys;
  return {
    document: stripped,
    keys: Object.freeze([...keys]),
    problems: keys.map((key) => `${path}: ${key} is a function, ${FUNCTION_EXPECTED}`),
  };
}
