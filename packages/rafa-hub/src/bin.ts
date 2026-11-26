#!/usr/bin/env bun
/**
 * The `rafa-hub` command, the package's `bin`: reads the hub's config
 * from the file `RAFA_HUB_CONFIG` names (`config.ts`), then starts the
 * server (`server.ts`) over the identity adapter `hub.auth.adapter`
 * picks and the `sqlite` connector (`connectSqliteHub` in
 * `store/sqlite.ts`), handed the listed projects (`hub.projects`, or
 * the one default project of `hub.repository` in `hub.storePath`), each
 * project's store at the file its `storePath` names and its index
 * beside it, the loader handed `hub.store.sqliteLibrary`. The server
 * rebuilds the pushed project's index after a push that added rows
 * unless `hub.index.rebuildAfterPush` is `false`. Logs are JSON lines on
 * standard output.
 *
 * ## The identity adapter
 *
 * Under `github` (the default) the repository-permission identity
 * (`identity/github.ts`) asks GitHub's API about each listed project's
 * repository, a push or a pull naming a project by `project` checked
 * against that project's and every other request against the first
 * listed project's (`projectRepositoryResolver`). Under `api-key` the
 * API-key identity (`identity/api-key.ts`) reads the variables
 * `hub.auth.apiKeys` names from the command's environment, once, at
 * start, and looks every other bearer up in the key store.
 *
 * ## The keys file, the login and its routes, under `api-key`
 *
 * At start, under `api-key` alone, `runHub` opens the key store and the
 * login store in the keys file beside `hub.storePath` (`keysFileName`,
 * the first listed project's under `hub.projects`), creating its
 * directory as `rafa-hub login` does, no key taking a name
 * `hub.auth.apiKeys` holds. It hands the key store to the identity and
 * opens the login `hub.auth.login.mode` picks: under `basic` the login
 * store's, first set from `RAFA_HUB_LOGIN_USER` and
 * `RAFA_HUB_LOGIN_PASSWORD` when no login is set (`bootstrapLoginFromEnv`,
 * which keeps a set one), logging `login.set` with the user, or
 * `login.incomplete` naming the variable left empty; under `oauth` the
 * provider's, its client secret read now. The key routes and the key
 * page are opened over that login and handed to the server, which
 * answers them `404` under `github`. Stopping the server closes both
 * stores.
 *
 * The hub serves plain HTTP, so under `basic`, listening on a hostname
 * that is not loopback (`0.0.0.0` unless {@link RunHubOptions.hostname}
 * says), it logs one `login.insecure` warning once it listens: the
 * login's password crosses the network in clear unless TLS fronts it.
 *
 * ## The payload cap
 *
 * Once it listens, a hub whose `dangerous.hub.maxPayloadRows` is
 * `unlimited` or above its default (`config-dangerous.ts`) logs one
 * `config.dangerous` warning naming the key and its value: a push or
 * pull page that large holds the hub's memory and its request for its
 * whole length. The default and any smaller cap log nothing.
 *
 * A config the reader refuses is logged as one `config.refused` line
 * holding every problem, and the command exits 1 without listening; so
 * is an `api-key` hub whose named variable is unset or empty, the line
 * naming the variable and never a value, a keys file that does not
 * open, an OAuth client secret's variable left unset, and a
 * `RAFA_HUB_LOGIN_USER` no basic login can carry. A store that does not open is
 * no reason to exit: the server answers `503` on `/health` until it
 * opens, which is what an operator reads. `SIGINT` and `SIGTERM` stop
 * the server, close the store and exit 0.
 *
 * ## `rafa-hub index rebuild`
 *
 * Reads the same config, opens the same connector and runs one
 * `index.rebuild` per listed project, in `hub.projects` order: the
 * default project's records `hub.repository`, a listed project's its
 * id. Each rebuild prints one line, its counts on standard output or
 * its failure on standard error, and a failed one does not stop the
 * next. The command exits 0 when every rebuild swapped its index in and
 * 1 otherwise. A refused config and a connector that does not open each
 * print one line on standard error, and the command exits 1; so do
 * arguments naming no command, the line holding {@link HUB_USAGE}. A
 * rebuild swaps a new index file in, and a server already running over
 * the same store picks it up by its inode on its following query, so
 * the two need no signal between them.
 *
 * ## `rafa-hub login` and `rafa-hub keys`
 *
 * `rafa-hub login` sets the hub's login in the keys file beside
 * `hub.storePath`, and `rafa-hub keys create|list|pause|delete` drives
 * a hub's key routes at `--hub=<url>` or `RAFA_HUB_URL`; both live in
 * `cli-keys.ts`, whose module note says what each asks and prints.
 *
 * {@link runHub} and {@link runIndexRebuild}, like `cli-keys.ts`'s
 * `runLogin` and `runKeys`, are the whole command but the process's
 * exit, so a test runs them in process; importing this file starts
 * nothing.
 */
import type { HubConfig } from './config.js';
import type { HubKeyStore } from './identity/key-store.js';
import type { HubLoginStore } from './identity/login-store.js';
import type { HubIdentity } from './identity/port.js';
import type { HubLogin } from './login/basic.js';
import type { HubKeyRoutes } from './server-keys.js';
import type { HubLoginRoutes } from './server-login.js';
import type { HubConnected, HubLog, HubServer } from './server.js';
import type { HubServedProject, IndexRebuildResult } from './store/port.js';

import { mkdirSync } from 'node:fs';
import { basename, dirname } from 'node:path';

import packageJson from '../package.json';

import { isLoginCommand, keysCommandOf, KEYS_USAGE, runKeys, runLogin } from './cli-keys.js';
import { DEFAULT_MAX_PAYLOAD_ROWS, isDangerousPayloadCap, MAX_PAYLOAD_ROWS_KEY } from './config-dangerous.js';
import { HubConfigError, readHubConfig } from './config.js';
import { openApiKeyIdentity } from './identity/api-key.js';
import { GITHUB_API, openGitHubIdentity, projectRepositoryResolver } from './identity/github.js';
import { keysFileName, openSqliteKeyStore } from './identity/key-store.js';
import { bootstrapLoginFromEnv, LOGIN_USER_VARIABLE, openSqliteLoginStore } from './identity/login-store.js';
import { openBasicLogin } from './login/basic.js';
import { openOAuthLogin } from './login/oauth.js';
import { openKeyRoutes } from './server-keys.js';
import { openLoginRoutes } from './server-login.js';
import { DEFAULT_HOSTNAME, jsonLineLog, startHubServer } from './server.js';
import { connectSqliteHub, servesOneProject } from './store/sqlite.js';

/** The hub's version, as its `package.json` names it. */
export const HUB_VERSION: string = packageJson.version;

/** The signals that stop the hub. */
const STOP_SIGNALS = ['SIGINT', 'SIGTERM'] as const;

/** The arguments that run `rafa-hub index rebuild`. */
export const INDEX_REBUILD_ARGS: readonly string[] = Object.freeze(['index', 'rebuild']);

/** What `rafa-hub` takes, as a refused argument list says it. */
export const HUB_USAGE: string = `usage: rafa-hub (serves the hub), rafa-hub index rebuild, rafa-hub login, or ${KEYS_USAGE}`;

/** What one run of `rafa-hub` does, by its arguments. */
export type HubCommand = 'serve' | 'index-rebuild' | 'login' | 'keys';

/** What {@link runHub} may vary beyond the environment. */
export interface RunHubOptions {
  /** Where log lines go; standard output when left out. */
  readonly log?: HubLog;
  /** GitHub's API root; {@link GITHUB_API} when left out. */
  readonly githubApi?: string;
  /** The hostname to listen on; {@link DEFAULT_HOSTNAME}, every interface, when left out. */
  readonly hostname?: string;
}

/** The hostnames no other machine reaches the hub at, beside every `127.x.x.x` address. */
const LOOPBACK_HOSTNAMES: ReadonlySet<string> = new Set(['localhost', '::1', '[::1]']);

/** An IPv4 address in `127.0.0.0/8`. */
const LOOPBACK_IPV4 = /^127(?:\.\d{1,3}){3}$/;

/** Whether a hub listening on `hostname` is reached from this machine alone. */
export function isLoopbackHostname(hostname: string): boolean {
  return LOOPBACK_HOSTNAMES.has(hostname.toLowerCase()) || LOOPBACK_IPV4.test(hostname);
}

/** The login and the key and login routes over it, opened at start under `api-key`. */
interface OpenedLogin {
  readonly login: HubLogin;
  readonly routes: { readonly login: HubLoginRoutes; readonly keys: HubKeyRoutes };
}

/** One thrown value as a {@link HubConfigError}, its message the problem `what` opens. */
function refusalOf(what: string, error: unknown): HubConfigError {
  return error instanceof HubConfigError
    ? error
    : new HubConfigError([`${what}: ${oneLine(error)}`]);
}

/**
 * Opens the key store in the keys file beside `config.storePath`,
 * creating its directory as `rafa-hub login` does, no key taking a name
 * `hub.auth.apiKeys` holds.
 *
 * @throws {HubConfigError} When the file does not open.
 */
function openKeyStore(config: HubConfig): HubKeyStore {
  const path = keysFileName(config.storePath);
  try {
    mkdirSync(dirname(path), { recursive: true });
    return openSqliteKeyStore({ path, reservedNames: config.apiKeys });
  } catch (error) {
    throw refusalOf(`the keys file at ${path} did not open`, error);
  }
}

/**
 * The login `hub.auth.login` picks, opened over the keys file: under
 * `oauth` the provider's, its client secret read from `env` now; under
 * `basic` the login store's, its login set from `env` when none is set
 * (`bootstrapLoginFromEnv`), which logs `login.set` naming the user, or
 * `login.incomplete` naming the variable left empty.
 *
 * @throws {HubConfigError} When the client secret's variable is unset,
 *   or the bootstrap's user name is one no login can carry.
 */
async function openLogin(config: HubConfig, env: Readonly<Record<string, string | undefined>>, log: HubLog, onStore: (store: HubLoginStore) => void): Promise<HubLogin> {
  const oauth = config.login?.oauth ?? null;
  if (config.login?.mode === 'oauth' && oauth !== null) {
    try {
      return openOAuthLogin({ config: oauth, env });
    } catch (error) {
      throw refusalOf('hub.auth.login.oauth', error);
    }
  }

  const path = keysFileName(config.storePath);
  let store: HubLoginStore;
  try {
    store = openSqliteLoginStore({ path });
  } catch (error) {
    throw refusalOf(`the keys file at ${path} did not open`, error);
  }
  onStore(store);
  let bootstrap;
  try {
    bootstrap = await bootstrapLoginFromEnv(store, env);
  } catch (error) {
    throw refusalOf(LOGIN_USER_VARIABLE, error);
  }
  if (bootstrap.outcome === 'set') log({ level: 'info', event: 'login.set', user: bootstrap.login.user });
  if (bootstrap.outcome === 'incomplete') log({ level: 'warn', event: 'login.incomplete', missing: bootstrap.missing });
  return openBasicLogin({ store });
}

/**
 * Opens the login over the keys file, then the key and login routes
 * over it and `store`, both answering `hub.auth.login.oauth.callbackUrl`'s
 * origin beside each request's own. The login store it opens is handed
 * to `onStore`, for the caller to close.
 *
 * @throws {HubConfigError} When the file does not open, or the login refuses.
 */
async function openLoginRoutesOver(
  config: HubConfig,
  env: Readonly<Record<string, string | undefined>>,
  log: HubLog,
  store: HubKeyStore,
  onStore: (store: HubLoginStore) => void,
): Promise<OpenedLogin> {
  const login = await openLogin(config, env, log, onStore);
  const callbackUrl = config.login?.oauth?.callbackUrl ?? null;
  const origins = callbackUrl === null
    ? []
    : [callbackUrl];
  return {
    login,
    routes: {
      login: openLoginRoutes({ login, store, log, origins }),
      keys: openKeyRoutes({ login, store, log, origins }),
    },
  };
}

/**
 * Logs one `login.insecure` warning when the login is `basic` and the
 * hub listens on `hostname`, not a loopback one: it serves plain HTTP,
 * so the login's password crosses the network in clear unless TLS
 * fronts the hub.
 */
function warnInsecureLogin(login: HubLogin | undefined, hostname: string, log: HubLog): void {
  if (login?.mode !== 'basic' || isLoopbackHostname(hostname)) return;

  log({
    level: 'warn',
    event: 'login.insecure',
    hostname,
    message: `hub.auth.login.mode is basic and the hub listens on ${hostname} over plain HTTP, so the login's password crosses the network in clear; serve it behind TLS, or listen on a loopback address`,
  });
}

/**
 * Logs one `config.dangerous` warning when `maxPayloadRows` (null for
 * `unlimited`) is no cap or one above {@link DEFAULT_MAX_PAYLOAD_ROWS},
 * and nothing otherwise.
 */
function warnDangerousPayloadCap(maxPayloadRows: number | null, log: HubLog): void {
  if (!isDangerousPayloadCap(maxPayloadRows)) return;

  const value = maxPayloadRows === null
    ? 'unlimited'
    : String(maxPayloadRows);
  log({
    level: 'warn',
    event: 'config.dangerous',
    key: MAX_PAYLOAD_ROWS_KEY,
    value,
    message: `${MAX_PAYLOAD_ROWS_KEY} is ${value}, above the default ${String(DEFAULT_MAX_PAYLOAD_ROWS)}, so one push or pull page may hold the hub's memory and its request for as long as it runs`,
  });
}

/**
 * Reads the config `env` names and starts the hub over it, answering
 * the running server, or null when the config was refused, which is
 * logged. Under `api-key` it opens the key and login stores in the keys
 * file first, bootstraps the login from `env`, and closes both when the
 * server stops. Never exits the process.
 */
export async function runHub(env: Readonly<Record<string, string | undefined>>, options: RunHubOptions = {}): Promise<HubServer | null> {
  const log = options.log ?? jsonLineLog();
  const hostname = options.hostname ?? DEFAULT_HOSTNAME;
  const opened: { close: () => void }[] = [];
  const closeOpened = (): void => {
    for (const file of opened.splice(0).reverse()) file.close();
  };
  let config;
  let identity;
  let keyLogin: OpenedLogin | undefined;
  try {
    config = await readHubConfig(env);
    const store = config.authAdapter === 'api-key'
      ? openKeyStore(config)
      : undefined;
    if (store !== undefined) opened.push(store);
    identity = openIdentity(config, env, options.githubApi ?? GITHUB_API, store);
    if (store !== undefined) {
      keyLogin = await openLoginRoutesOver(config, env, log, store, (loginStore) => opened.push(loginStore));
    }
  } catch (error) {
    closeOpened();
    if (!(error instanceof HubConfigError)) throw error;

    log({ level: 'error', event: 'config.refused', problems: error.problems });
    return null;
  }

  const { repository, port, rebuildAfterPush } = config;
  let server;
  try {
    server = startHubServer({
      port,
      hostname,
      version: HUB_VERSION,
      identity,
      openConnected: () => connectHub(config),
      rebuildAfterPush,
      project: repository,
      projects: servedProjects(config),
      log,
      ...keyLogin?.routes,
    });
  } catch (error) {
    closeOpened();
    throw error;
  }
  warnInsecureLogin(keyLogin?.login, hostname, log);
  warnDangerousPayloadCap(config.maxPayloadRows, log);
  return opened.length === 0
    ? server
    : closingOnStop(server, closeOpened);
}

/** `server`, whose stop also runs `close` once the server has stopped. */
function closingOnStop(server: HubServer, close: () => void): HubServer {
  return {
    url: server.url,
    port: server.port,
    stop: async () => {
      try {
        await server.stop();
      } finally {
        close();
      }
    },
  };
}

/**
 * The identity adapter `hub.auth.adapter` picks: `api-key` over the
 * variables `hub.auth.apiKeys` names, read from `env` now, and over
 * `store`, asked on every request; or `github` asking `apiBase` about
 * each listed project's repository.
 *
 * @throws {HubConfigError} Under `api-key`, when a named variable is unset or empty.
 */
function openIdentity(config: HubConfig, env: Readonly<Record<string, string | undefined>>, apiBase: string, store: HubKeyStore | undefined): HubIdentity {
  if (config.authAdapter === 'api-key') {
    return openApiKeyIdentity({ variables: config.apiKeys, env, ...store === undefined
      ? {}
      : { store } });
  }

  return openGitHubIdentity({ repository: projectRepositoryResolver(config.projects), cacheForMs: config.cacheForMs, apiBase });
}

/** The projects `config` lists, by `id` and `name` alone, as the port and `/v1/status` know them. */
function servedProjects(config: HubConfig): readonly HubServedProject[] {
  return config.projects.map(({ id, name }) => Object.freeze({ id, name }));
}

/** Opens the `sqlite` connector over `config`'s projects, their stores and indexes, and its library. */
function connectHub(config: HubConfig): Promise<HubConnected> {
  const { storePath, sqliteLibrary, repository, projects } = config;
  return connectSqliteHub(
    { directory: dirname(storePath), now: () => new Date(), projects: servedProjects(config) },
    {
      fileName: basename(storePath),
      storeFiles: projects.map(({ id, storePath: file }) => ({ id, storePath: file })),
      loader: { library: sqliteLibrary },
      project: repository,
    },
  );
}

/**
 * The project each listed project's rebuild names: `hub.repository` for
 * the one default project, which the index records, and each listed
 * project's id otherwise, which routes the rebuild to its index.
 */
function rebuildProjects(config: HubConfig): readonly string[] {
  return servesOneProject(config.projects)
    ? [config.repository]
    : config.projects.map(({ id }) => id);
}

/** The command `args` (the process's arguments past the script) name, or null for any other. */
export function hubCommandOf(args: readonly string[]): HubCommand | null {
  if (args.length === 0) return 'serve';
  if (isLoginCommand(args)) return 'login';
  if (args[0] === 'keys') {
    return keysCommandOf(args.slice(1)) === null
      ? null
      : 'keys';
  }

  const isRebuild = args.length === INDEX_REBUILD_ARGS.length
    && args.every((arg, at) => arg === INDEX_REBUILD_ARGS[at]);
  return isRebuild
    ? 'index-rebuild'
    : null;
}

/** What {@link runIndexRebuild} may vary beyond the environment. */
export interface RunIndexRebuildOptions {
  /** Where the counts line goes; standard output when left out. */
  readonly out?: (line: string) => void;
  /** Where a refusal's line goes; standard error when left out. */
  readonly err?: (line: string) => void;
}

/** The prefix every line of `rafa-hub index rebuild` opens with. */
const REBUILD_PREFIX = 'rafa-hub index rebuild';

/** One thrown value's message, on one line. */
function oneLine(error: unknown): string {
  const message = error instanceof Error
    ? error.message
    : String(error);
  return message.replace(/\s*\n\s*/g, '; ');
}

/** The line a rebuild that swapped its index in prints, with its counts. */
export function rebuiltLine(result: IndexRebuildResult): string {
  const tables = result.tables
    .map((table) => `${table.table} ${String(table.rows)}`)
    .join(', ');
  const vector = result.vector
    ? 'vector on'
    : `vector off: ${result.why ?? 'no reason given'}`;
  return `${REBUILD_PREFIX}: ${result.project} rebuilt at ${result.stamp}: ${String(result.rows)} rows, ${String(result.vectors)} vectors (${tables}); ${vector}`;
}

/**
 * Reads the config `env` names, opens its connector, runs one rebuild
 * of each listed project's index in turn and closes the store,
 * answering the exit code: 0 when every rebuild swapped its index in,
 * each printing its counts line on `out`, or 1 when one failed, its line
 * on `err`, the others still run. A refused config and a connector that
 * did not open answer 1 with one line on `err` and run no rebuild.
 * Never exits the process.
 */
export async function runIndexRebuild(env: Readonly<Record<string, string | undefined>>, options: RunIndexRebuildOptions = {}): Promise<number> {
  const out = options.out ?? ((line: string) => process.stdout.write(`${line}\n`));
  const err = options.err ?? ((line: string) => process.stderr.write(`${line}\n`));
  let config;
  try {
    config = await readHubConfig(env);
  } catch (error) {
    if (!(error instanceof HubConfigError)) throw error;

    err(`${REBUILD_PREFIX}: the config was refused: ${error.problems.join('; ')}`);
    return 1;
  }

  let connected;
  try {
    connected = await connectHub(config);
  } catch (error) {
    err(`${REBUILD_PREFIX}: the store at ${config.storePath} did not open: ${oneLine(error)}`);
    return 1;
  }
  let code = 0;
  try {
    for (const project of rebuildProjects(config)) {
      try {
        out(rebuiltLine(await connected.index.rebuild({ project })));
      } catch (error) {
        err(`${REBUILD_PREFIX}: ${project}'s rebuild failed, and its live index is as it was: ${oneLine(error)}`);
        code = 1;
      }
    }
    return code;
  } finally {
    await connected.store.close();
  }
}

/** Serves the hub until a stop signal, exiting 1 when its config is refused. */
async function serve(): Promise<void> {
  const server = await runHub(process.env);
  if (server === null) process.exit(1);

  for (const signal of STOP_SIGNALS) {
    process.once(signal, () => {
      void server.stop().then(() => process.exit(0));
    });
  }
}

if (import.meta.main) {
  const command = hubCommandOf(process.argv.slice(2));
  if (command === null) {
    process.stderr.write(`rafa-hub: ${process.argv.slice(2).join(' ')} is not a command; ${HUB_USAGE}\n`);
    process.exit(1);
  }
  if (command === 'index-rebuild') process.exit(await runIndexRebuild(process.env));
  if (command === 'login') process.exit(await runLogin(process.env));
  if (command === 'keys') process.exit(await runKeys(process.argv.slice(3), process.env));

  await serve();
}
