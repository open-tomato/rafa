/**
 * The reader of `hub.auth.login`, the login that guards the hub's key
 * routes, resolved into a frozen {@link HubLoginConfig} for `config.ts`
 * to set on its `HubConfig`, or refused with every problem at once.
 *
 * ## The keys
 *
 * `hub.auth.login` holds `mode` and `oauth`:
 *
 *   - `mode` is `basic` (the default: a user name and password kept
 *     hashed in the hub's keys file) or `oauth` (the login handed to the
 *     provider `oauth` names), and nothing else.
 *   - `oauth` is required under `mode: oauth` and refused under `basic`,
 *     where nothing would read it. It holds `authorizeUrl`, `tokenUrl`,
 *     `userUrl`, `clientId`, `clientSecretVariable` and `allowed`, all
 *     required, and `scope` and `callbackUrl`, optional.
 *
 * ## Readings the spec leaves to this module
 *
 *   - The login exists only under `hub.auth.adapter: api-key`, since
 *     only that adapter reads the keys the login creates. Under `github`
 *     a written `hub.auth.login` is refused, and the reading is null;
 *     left out under `api-key`, it is `{ mode: 'basic', oauth: null }`.
 *     With the adapter itself refused, nothing here is checked.
 *   - The three URLs are absolute `https:` URLs, or `http:` on a
 *     loopback host (`localhost`, `127.0.0.1`, `[::1]`), so a stand-in
 *     provider on the test machine is accepted and a provider reached in
 *     the clear over a network is not. A URL holding a user name or a
 *     password is refused, since its credentials would sit in the file.
 *   - `callbackUrl` is the hub's own public callback, sent to the
 *     provider as `redirect_uri`: the one a hub behind a reverse proxy or
 *     a TLS terminator writes, since the start request then carries the
 *     proxy's internal origin. It takes the provider URLs' rule and
 *     refuses a fragment as well, which a `redirect_uri` may not hold.
 *     Its path is not checked, so a proxy that mounts the hub under a
 *     prefix may name its own; the proxy forwards it to the hub's
 *     `/login/oauth/callback`. Left out, it is null, and the login builds
 *     the callback from each start request's origin.
 *   - `clientSecretVariable` names an environment variable, matching
 *     `^[A-Z_][A-Z0-9_]*$`, and never holds the secret itself: as
 *     `hub.auth.apiKeys` does, its refusal never repeats what was
 *     written, since a secret may have been pasted in place of its name.
 *   - `clientId` is non-empty text with no white space at either end.
 *     `scope` is the same when written, and null when left out.
 *   - `allowed` is a non-empty list of the provider's user ids, each
 *     non-empty text with no white space at either end, or a whole number
 *     no larger than `Number.MAX_SAFE_INTEGER`, read as its decimal
 *     digits: a provider's numeric id written bare in YAML reads as the
 *     id it spells, and one too large to be read exactly is refused. An
 *     id listed twice is refused, naming both positions.
 *   - A key under `hub.auth.login` or `hub.auth.login.oauth` that the hub
 *     does not read is refused, as under `hub.auth`.
 *
 * `config.ts` imports this module, so this one takes only a type from
 * it, never a value, and its few helpers are its own.
 */
import type { HubAuthAdapter } from './config.js';

/** How the login is checked: `hub.auth.login.mode`. */
export type HubLoginMode = 'basic' | 'oauth';

/** The modes `hub.auth.login.mode` takes, in the order a refusal names them. */
export const HUB_LOGIN_MODES: readonly HubLoginMode[] = Object.freeze(['basic', 'oauth']);

/** `hub.auth.login.mode` when it is left out. */
export const DEFAULT_LOGIN_MODE: HubLoginMode = 'basic';

/** The OAuth provider the login is handed to: `hub.auth.login.oauth`. */
export interface HubLoginOAuth {
  /** The provider's page the user is sent to, to grant the hub a code. */
  readonly authorizeUrl: string;
  /** The provider's endpoint the hub exchanges the code at for a token. */
  readonly tokenUrl: string;
  /** The provider's endpoint answering the user the token belongs to. */
  readonly userUrl: string;
  /** The hub's client id at the provider. */
  readonly clientId: string;
  /** The name of the environment variable holding the client secret, never its value. */
  readonly clientSecretVariable: string;
  /** The scope asked of the provider, or null to ask none. */
  readonly scope: string | null;
  /** The provider user ids who may log in, in the order listed, never empty. */
  readonly allowed: readonly string[];
  /** The hub's public callback URL sent as `redirect_uri`, or null to build it from each start request. */
  readonly callbackUrl: string | null;
}

/** The login guarding the key routes, resolved: `hub.auth.login`. */
export interface HubLoginConfig {
  /** How the login is checked. `hub.auth.login.mode`. */
  readonly mode: HubLoginMode;
  /** The provider under `oauth`, null under `basic`. `hub.auth.login.oauth`. */
  readonly oauth: HubLoginOAuth | null;
}

/** One reading: its value, or the problems that refused it. */
export interface LoginReading<T> {
  readonly value?: T;
  readonly problems: readonly string[];
}

/** The keys the hub reads under `hub.auth.login`. */
const LOGIN_KEYS: readonly string[] = Object.freeze(['mode', 'oauth']);

/** The keys the hub reads under `hub.auth.login.oauth`. */
const OAUTH_KEYS: readonly string[] = Object.freeze(['authorizeUrl', 'tokenUrl', 'userUrl', 'clientId', 'clientSecretVariable', 'scope', 'allowed', 'callbackUrl']);

/** The hosts an `http:` provider URL may name. */
const LOOPBACK_HOSTS: readonly string[] = Object.freeze(['localhost', '127.0.0.1', '[::1]']);

/** An environment variable name, as `clientSecretVariable` takes it. */
const ENV_NAME = /^[A-Z_][A-Z0-9_]*$/;

/** The key every refusal here opens under. */
const LOGIN = 'hub.auth.login';

/** The key the provider's settings sit under. */
const OAUTH = `${LOGIN}.oauth`;

/** What `hub.auth.login.mode` takes, as a refusal says it. */
const MODE_EXPECTED = 'expected basic or oauth';

/** What a provider URL takes, as a refusal says it. */
const URL_EXPECTED = 'expected an absolute https URL, or http on localhost, 127.0.0.1 or [::1], holding no user name or password';

/** What `callbackUrl` takes, as a refusal says it. */
const CALLBACK_EXPECTED = 'expected an absolute https URL, or http on localhost, 127.0.0.1 or [::1], holding no user name, password or fragment, such as https://hub.example.org/login/oauth/callback';

/** What `clientId` and `scope` take, as a refusal says it. */
const TEXT_EXPECTED = 'expected non-empty text with no white space at either end';

/** What `clientSecretVariable` takes, as a refusal says it. */
const SECRET_VARIABLE_EXPECTED = 'expected an environment variable name of A-Z, 0-9 and _, not opening with a digit, such as RAFA_HUB_OAUTH_SECRET; the value written is not repeated';

/** What `allowed` takes, as a refusal says it. */
const ALLOWED_EXPECTED = 'expected a non-empty list of the provider\'s user ids, such as [\'583231\']';

/** What an entry of `allowed` takes, as a refusal says it. */
const ALLOWED_ID_EXPECTED = 'expected a provider user id, as non-empty text with no white space at either end or a whole number';

/** How a refusal shows the value it refused. */
function describeValue(raw: unknown): string {
  return typeof raw === 'string'
    ? JSON.stringify(raw)
    : String(raw);
}

/** A refusal of `raw` at `key` in `path`, naming what was expected. */
function refusal<T>(path: string, key: string, raw: unknown, expected: string): LoginReading<T> {
  return { problems: [`${path}: ${key} is ${describeValue(raw)}, ${expected}`] };
}

/** Whether `raw` is a YAML mapping, rather than a list, a scalar or null. */
function isMapping(raw: unknown): raw is Readonly<Record<string, unknown>> {
  return typeof raw === 'object' && raw !== null && !Array.isArray(raw);
}

/** One problem per key of `section` outside `known`, named by `prefix`. */
function unknownKeys(path: string, prefix: string, section: Readonly<Record<string, unknown>>, known: readonly string[]): string[] {
  return Object.keys(section)
    .filter((key) => !known.includes(key))
    .map((key) => `${path}: ${prefix}.${key} is not a key the hub reads; expected one of ${known.map((name) => `${prefix}.${name}`).join(', ')}`);
}

/** Whether `raw` is non-empty text with no white space at either end. */
function isText(raw: unknown): raw is string {
  return typeof raw === 'string' && raw !== '' && raw.trim() === raw;
}

/** Whether `raw` is a provider URL the hub may be pointed at. */
function isProviderUrl(raw: unknown): raw is string {
  if (!isText(raw) || !URL.canParse(raw)) return false;

  const url = new URL(raw);
  if (url.username !== '' || url.password !== '') return false;
  return url.protocol === 'https:'
    || (url.protocol === 'http:' && LOOPBACK_HOSTS.includes(url.hostname));
}

/** Whether `raw` is a callback URL the provider may be sent: a provider URL holding no fragment. */
function isCallbackUrl(raw: unknown): raw is string {
  return isProviderUrl(raw) && !raw.includes('#');
}

/** Reads `hub.auth.login.mode`, {@link DEFAULT_LOGIN_MODE} when left out. */
function readMode(path: string, raw: unknown): LoginReading<HubLoginMode> {
  if (raw === undefined) return { value: DEFAULT_LOGIN_MODE, problems: [] };

  const mode = HUB_LOGIN_MODES.find((name) => name === raw);
  return mode === undefined
    ? refusal(path, `${LOGIN}.mode`, raw, MODE_EXPECTED)
    : { value: mode, problems: [] };
}

/** Reads the required field `name` of `oauth` through `read`, or the problem of it left out. */
function field<T>(path: string, oauth: Readonly<Record<string, unknown>>, name: string, expected: string, read: (key: string, raw: unknown) => LoginReading<T>): LoginReading<T> {
  const key = `${OAUTH}.${name}`;
  const raw = oauth[name];
  return raw === undefined
    ? { problems: [`${path}: ${key} is missing, ${expected}`] }
    : read(key, raw);
}

/** A reader accepting what `accepts` passes, and refusing the rest naming `expected`. */
function checked(path: string, accepts: (raw: unknown) => raw is string, expected: string): (key: string, raw: unknown) => LoginReading<string> {
  return (key, raw) => accepts(raw)
    ? { value: raw, problems: [] }
    : refusal(path, key, raw, expected);
}

/** Reads `clientSecretVariable` at `key`, never repeating a value it refuses. */
function readSecretVariable(path: string, key: string, raw: unknown): LoginReading<string> {
  return typeof raw === 'string' && ENV_NAME.test(raw)
    ? { value: raw, problems: [] }
    : { problems: [`${path}: ${key} is not an environment variable name, ${SECRET_VARIABLE_EXPECTED}`] };
}

/** An entry of `allowed` as the id it spells, or undefined when it is none. */
function userId(raw: unknown): string | undefined {
  if (isText(raw)) return raw;
  return typeof raw === 'number' && Number.isSafeInteger(raw) && raw >= 0
    ? String(raw)
    : undefined;
}

/** Reads `allowed` at `key`: a non-empty list of user ids, none listed twice. */
function readAllowed(path: string, key: string, raw: unknown): LoginReading<readonly string[]> {
  if (Array.isArray(raw) && raw.length === 0) return { problems: [`${path}: ${key} is an empty list, ${ALLOWED_EXPECTED}`] };
  if (isMapping(raw)) return { problems: [`${path}: ${key} is a mapping, ${ALLOWED_EXPECTED}`] };
  if (!Array.isArray(raw)) return refusal(path, key, raw, ALLOWED_EXPECTED);

  const firstAt = new Map<string, number>();
  const problems = raw.flatMap((entry: unknown, position) => {
    const at = `${key}[${String(position)}]`;
    const id = userId(entry);
    if (id === undefined) return refusal(path, at, entry, ALLOWED_ID_EXPECTED).problems;

    const earlier = firstAt.get(id);
    if (earlier === undefined) {
      firstAt.set(id, position);
      return [];
    }
    return [`${path}: ${at} is ${JSON.stringify(id)}, as ${key}[${String(earlier)}] is; expected each user id listed once`];
  });
  return problems.length > 0
    ? { problems }
    : { value: Object.freeze([...firstAt.keys()]), problems: [] };
}

/** Reads `hub.auth.login.oauth`, every problem of it at once. */
function readOAuth(path: string, raw: unknown): LoginReading<HubLoginOAuth> {
  if (raw === undefined) return { problems: [`${path}: ${OAUTH} is missing, expected a mapping holding ${OAUTH_KEYS.join(', ')} under ${LOGIN}.mode: oauth`] };
  if (!isMapping(raw)) return refusal(path, OAUTH, raw, `expected a mapping holding ${OAUTH_KEYS.join(', ')}`);

  const url = checked(path, isProviderUrl, URL_EXPECTED);
  const text = checked(path, isText, TEXT_EXPECTED);
  const authorizeUrl = field(path, raw, 'authorizeUrl', URL_EXPECTED, url);
  const tokenUrl = field(path, raw, 'tokenUrl', URL_EXPECTED, url);
  const userUrl = field(path, raw, 'userUrl', URL_EXPECTED, url);
  const clientId = field(path, raw, 'clientId', TEXT_EXPECTED, text);
  const clientSecretVariable = field(path, raw, 'clientSecretVariable', SECRET_VARIABLE_EXPECTED, (key, value) => readSecretVariable(path, key, value));
  const scope: LoginReading<string | null> = raw['scope'] === undefined
    ? { value: null, problems: [] }
    : text(`${OAUTH}.scope`, raw['scope']);
  const allowed = field(path, raw, 'allowed', ALLOWED_EXPECTED, (key, value) => readAllowed(path, key, value));
  const callbackUrl: LoginReading<string | null> = raw['callbackUrl'] === undefined
    ? { value: null, problems: [] }
    : checked(path, isCallbackUrl, CALLBACK_EXPECTED)(`${OAUTH}.callbackUrl`, raw['callbackUrl']);

  const problems = [
    ...unknownKeys(path, OAUTH, raw, OAUTH_KEYS),
    ...authorizeUrl.problems,
    ...tokenUrl.problems,
    ...userUrl.problems,
    ...clientId.problems,
    ...clientSecretVariable.problems,
    ...scope.problems,
    ...allowed.problems,
    ...callbackUrl.problems,
  ];
  if (problems.length > 0) return { problems };

  return {
    value: Object.freeze({
      authorizeUrl: authorizeUrl.value as string,
      tokenUrl: tokenUrl.value as string,
      userUrl: userUrl.value as string,
      clientId: clientId.value as string,
      clientSecretVariable: clientSecretVariable.value as string,
      scope: scope.value as string | null,
      allowed: allowed.value as readonly string[],
      callbackUrl: callbackUrl.value as string | null,
    }),
    problems: [],
  };
}

/**
 * Reads `hub.auth.login`, written as `raw` in the file at `path`, under
 * the adapter `hub.auth.adapter` resolved to (undefined when it was
 * refused). Answers null under `github`, where no login exists, the
 * default `basic` login when left out under `api-key`, or every problem
 * found, each opening with `path`.
 */
export function readLoginConfig(path: string, adapter: HubAuthAdapter | undefined, raw: unknown): LoginReading<HubLoginConfig | null> {
  if (adapter !== 'api-key') {
    return raw === undefined || adapter === undefined
      ? { value: null, problems: [] }
      : { problems: [`${path}: ${LOGIN} is set while hub.auth.adapter is github; expected hub.auth.adapter: api-key beside it, or no ${LOGIN}`] };
  }
  if (raw === undefined) return { value: Object.freeze({ mode: DEFAULT_LOGIN_MODE, oauth: null }), problems: [] };
  if (!isMapping(raw)) return refusal(path, LOGIN, raw, `expected a mapping holding ${LOGIN_KEYS.join(', ')}`);

  const mode = readMode(path, raw['mode']);
  const oauth: LoginReading<HubLoginOAuth | null> = mode.value === 'oauth'
    ? readOAuth(path, raw['oauth'])
    : {
      value: null,
      problems: mode.value === 'basic' && raw['oauth'] !== undefined
        ? [`${path}: ${OAUTH} is set while ${LOGIN}.mode is basic; expected ${LOGIN}.mode: oauth beside it, or no ${OAUTH}`]
        : [],
    };

  const problems = [...unknownKeys(path, LOGIN, raw, LOGIN_KEYS), ...mode.problems, ...oauth.problems];
  return problems.length > 0
    ? { problems }
    : { value: Object.freeze({ mode: mode.value as HubLoginMode, oauth: oauth.value as HubLoginOAuth | null }), problems: [] };
}
