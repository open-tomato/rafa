/**
 * The install record wired into a hub's start, over fixture config
 * directories under a temporary root: `rafa-hub install`
 * ({@link runInstall}) writes the record, {@link runHub} reads it and
 * serves through the real `sqlite` connector, and the keys are driven
 * by `rafa-hub login` and `rafa-hub keys` over real HTTP.
 * `install-record.test.ts`, `cli-install.test.ts` and `bin.test.ts`
 * cover each half alone; this file is the seam between them.
 *
 * Each case lays its directory out as `etc/hub.yaml` (the config, with
 * the record beside it) and `store/` (the store `hub.storePath` names),
 * so the config's directory, the store's and a `dataDir` of its own are
 * three places and a file in one is never mistaken for one in another.
 *
 * Four cases:
 *
 *   - a record naming a `dataDir` puts the keys file there and nowhere
 *     else, and a key made in one run of the hub serves the next;
 *   - a record another hub version wrote refuses the start of the
 *     command itself: one `config.refused` line, exit 1, no keys file
 *     made and the record left as it was;
 *   - no record starts over the defaults, logging one `install.missing`
 *     warning, the keys file in the config's directory;
 *   - `hub.store.sqliteLibrary` starts the hub, logging one
 *     `config.deprecated` warning naming `rafa-hub install`.
 *
 * The library the last case names is a path that holds no file. Linux
 * names no custom library, so nothing reads it there, and macOS answers
 * vector search off for it and serves all the same.
 *
 * Each config is YAML, so every start logs the `config.yaml` warning
 * first, and each case's warnings open with it ({@link yamlWarning}).
 *
 * `hub.port` refuses `0`, so each hub listens on a port the system
 * handed a probe server a moment before.
 */
import type { HubLogEntry, HubServer } from './server.js';

import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { HUB_VERSION, runHub } from './bin.js';
import { runInstall } from './cli-install.js';
import { lineAnswers, runKeys, runLogin } from './cli-keys.js';
import { HUB_CONFIG_ENV } from './config.js';
import { KEYS_FILE } from './identity/key-store.js';
import { LOGIN_PASSWORD_VARIABLE, LOGIN_USER_VARIABLE } from './identity/login-store.js';
import { INSTALL_RECORD_FILE } from './install-record.js';
import { HUB_ROUTES } from './server.js';

const BIN = join(import.meta.dir, 'bin.ts');
const REPOSITORY = 'open-tomato/rafa';
const KEY_NAME = 'laptop';
const LOGIN_USER = 'ada';
const LOGIN_PASSWORD = 'install record integration password 0001';
const OTHER_VERSION = '0.0.0-other';

/** The variable `hub.auth.apiKeys` names, and the value the hub reads from it. */
const ENV_KEY_VARIABLE = 'RAFA_HUB_INSTALL_INTEGRATION_KEY';
const ENV_KEY_VALUE = 'hub-install-integration-env-key-000001';

/** How long a case may take: at most two hubs, a login hashed and verified, and a few commands. */
const CASE_TIMEOUT_MS = 60_000;

let root = '';
let running: HubServer[] = [];

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-hub-install-')));
  mkdirSync(join(root, 'etc'));
  mkdirSync(join(root, 'store'));
});

afterEach(async () => {
  for (const hub of running.splice(0)) await hub.stop();
  rmSync(root, { recursive: true, force: true });
});

/** The case's config directory, which holds `hub.yaml` and the record. */
function configDirectory(): string {
  return join(root, 'etc');
}

/** The case's install record path, beside its config file. */
function recordPath(): string {
  return join(configDirectory(), INSTALL_RECORD_FILE);
}

/** A port the system just handed out, free again. */
async function freePort(): Promise<number> {
  const probe = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: () => new Response() });
  const port = probe.port ?? 0;
  await probe.stop(true);
  return port;
}

/** Writes the case's `api-key` config, `store` its `hub.store` lines; answers the environment a hub starts in. */
function hubEnvironment(port: number, store: readonly string[] = []): Readonly<Record<string, string>> {
  const path = join(configDirectory(), 'hub.yaml');
  writeFileSync(path, [
    'hub:',
    `  repository: ${REPOSITORY}`,
    `  port: ${String(port)}`,
    '  storePath: ../store/rafa-hub.sqlite',
    '  auth:',
    '    adapter: api-key',
    '    apiKeys:',
    `      - ${ENV_KEY_VARIABLE}`,
    ...store,
    '',
  ].join('\n'));
  return { [HUB_CONFIG_ENV]: path, [ENV_KEY_VARIABLE]: ENV_KEY_VALUE };
}

/** The `config.yaml` warning a start over the case's `hub.yaml` logs before any other. */
function yamlWarning(): HubLogEntry {
  const path = join(configDirectory(), 'hub.yaml');
  return {
    level: 'warn',
    event: 'config.yaml',
    path,
    message: `${path}: the hub's config is read from YAML, which rafa 1.0.0 stops reading; `
      + `write what it holds to ${join(configDirectory(), 'rafa-hub.config.ts')} as its default export, remove hub.yaml, and name it in RAFA_HUB_CONFIG`,
  };
}

/** Which of the case's directories, `dataDir` included, hold a keys file. */
function keysFileHolders(dataDir: string): readonly string[] {
  return [dataDir, configDirectory(), join(root, 'store')]
    .filter((directory, at, all) => all.indexOf(directory) === at)
    .filter((directory) => existsSync(join(directory, KEYS_FILE)));
}

/** A hub the case started, with every line it logged. */
interface Started {
  readonly hub: HubServer;
  readonly logged: readonly HubLogEntry[];
}

/** Starts the hub in `env` on the loopback address and waits for its store to answer `/health`. */
async function start(env: Readonly<Record<string, string>>): Promise<Started> {
  const logged: HubLogEntry[] = [];
  const hub = await runHub(env, {
    log: (entry) => {
      logged.push(entry);
    },
    hostname: '127.0.0.1',
  });
  if (hub === null) throw new Error(`the hub refused its start: ${JSON.stringify(logged)}`);
  running = [...running, hub];

  expect((await fetch(`${hub.url}${HUB_ROUTES.health}`)).status).toBe(200);
  return { hub, logged };
}

/** Stops `hub` and forgets it, so the case's cleanup does not stop it again. */
async function stop(hub: HubServer): Promise<void> {
  running = running.filter((other) => other !== hub);
  await hub.stop();
}

/** The warning lines of `logged`, which a case compares whole so no other warning passes unseen. */
function warningsOf(logged: readonly HubLogEntry[]): readonly HubLogEntry[] {
  return logged.filter((entry) => entry.level === 'warn');
}

/** The status `GET /v1/status` answers `bearer` with. */
async function statusFor(hub: HubServer, bearer: string): Promise<number> {
  const response = await fetch(`${hub.url}${HUB_ROUTES.status}`, { headers: { authorization: `Bearer ${bearer}` } });
  await response.arrayBuffer();
  return response.status;
}

/** Runs `rafa-hub keys` with `args` against `hub`, signed in from the environment; answers its standard output. */
async function keys(hub: HubServer, args: readonly string[]): Promise<readonly string[]> {
  const out: string[] = [];
  const err: string[] = [];
  const env = { RAFA_HUB_URL: hub.url, [LOGIN_USER_VARIABLE]: LOGIN_USER, [LOGIN_PASSWORD_VARIABLE]: LOGIN_PASSWORD };
  const code = await runKeys(args, env, { out: (line) => out.push(line), err: (line) => err.push(line) });
  expect(code, err.join('\n')).toBe(0);
  return out;
}

describe('a hub started over a config directory and its install record', () => {
  it('keeps the keys file in the record\'s dataDir alone, where a key made in one run serves the next', async () => {
    const dataDir = join(root, 'data');
    const env = hubEnvironment(await freePort());
    const printed: string[] = [];
    const errors: string[] = [];
    const sinks = { out: (line: string) => printed.push(line), err: (line: string) => errors.push(line) };

    const installed = await runInstall([`--data-dir=${dataDir}`], env, HUB_VERSION, sinks);
    const loggedIn = await runLogin(env, HUB_VERSION, {
      ...sinks,
      answers: lineAnswers(() => Promise.resolve(`${LOGIN_USER}\n${LOGIN_PASSWORD}\n`)),
    });

    expect({ installed, loggedIn, errors }).toEqual({ installed: 0, loggedIn: 0, errors: [] });
    expect(keysFileHolders(dataDir)).toEqual([dataDir]);

    const first = await start(env);
    const created = await keys(first.hub, ['create', KEY_NAME]);
    const plain = created[0] ?? '';
    expect(await statusFor(first.hub, plain)).toBe(200);
    expect(warningsOf(first.logged)).toEqual([yamlWarning()]);
    await stop(first.hub);

    const second = await start(env);

    expect(await statusFor(second.hub, plain)).toBe(200);
    expect(await keys(second.hub, ['list'])).toEqual([expect.stringContaining(`${KEY_NAME}\tactive\t`)]);
    expect(warningsOf(second.logged)).toEqual([yamlWarning()]);
    // Asked after the warnings are read, since a refused request logs one of its own.
    expect(await statusFor(second.hub, `${plain}x`)).toBe(401);
    expect(keysFileHolders(dataDir)).toEqual([dataDir]);
  }, CASE_TIMEOUT_MS);

  it('refuses a record another hub version wrote: one config.refused line, exit 1, no keys file and the record untouched', async () => {
    const dataDir = join(root, 'data');
    const env = hubEnvironment(await freePort());
    const record = `${JSON.stringify({ installVersion: 1, hub: OTHER_VERSION, bun: Bun.version, dataDir, sqliteLibrary: null, models: [] })}\n`;
    writeFileSync(recordPath(), record);

    // The command itself, so the exit code is the process's; a hub that served instead is killed by the timeout.
    const child = Bun.spawn([process.execPath, BIN], { env: { ...process.env, ...env }, stdout: 'pipe', stderr: 'pipe', timeout: CASE_TIMEOUT_MS / 2 });
    const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);

    expect({ code, stderr }).toEqual({ code: 1, stderr: '' });
    const lines = stdout
      .split('\n')
      .filter((line) => line !== '')
      .map((line) => JSON.parse(line) as HubLogEntry);
    expect(lines).toEqual([expect.objectContaining({
      level: 'error',
      event: 'config.refused',
      problems: [`${recordPath()}: written by hub ${OTHER_VERSION}, and this hub is ${HUB_VERSION}; run rafa-hub install`],
    })]);
    expect(keysFileHolders(dataDir)).toEqual([]);
    expect(existsSync(dataDir)).toBe(false);
    expect(readFileSync(recordPath(), 'utf8')).toBe(record);
  }, CASE_TIMEOUT_MS);

  it('serves with no record over the defaults, logging one install.missing warning, the keys file beside the config', async () => {
    const { hub, logged } = await start(hubEnvironment(await freePort()));

    expect(warningsOf(logged)).toEqual([yamlWarning(), {
      level: 'warn',
      event: 'install.missing',
      path: recordPath(),
      message: `${recordPath()}: no install record; using the defaults (dataDir ${configDirectory()}, no SQLite library, no models); run rafa-hub install to write one`,
    }]);
    expect(keysFileHolders(configDirectory())).toEqual([configDirectory()]);
    expect(await statusFor(hub, ENV_KEY_VALUE)).toBe(200);
    expect(existsSync(recordPath())).toBe(false);
  }, CASE_TIMEOUT_MS);

  it('serves over hub.store.sqliteLibrary, logging one config.deprecated warning naming rafa-hub install', async () => {
    const library = join(root, 'lib', 'libsqlite3.so');
    const env = hubEnvironment(await freePort(), ['  store:', `    sqliteLibrary: ${library}`]);
    const errors: string[] = [];
    // A record naming no library, so the warning under test is the start's only one beside config.yaml.
    const installed = await runInstall([], env, HUB_VERSION, { out: () => undefined, err: (line) => errors.push(line) });
    expect({ installed, errors }).toEqual({ installed: 0, errors: [] });

    const { hub, logged } = await start(env);

    expect(warningsOf(logged)).toEqual([yamlWarning(), {
      level: 'warn',
      event: 'config.deprecated',
      key: 'hub.store.sqliteLibrary',
      message: `${env[HUB_CONFIG_ENV] ?? ''}: hub.store.sqliteLibrary is read for this release only; run rafa-hub install --sqlite-library=${library} to record it in ${recordPath()}, then remove the key`,
    }]);
    expect(await statusFor(hub, ENV_KEY_VALUE)).toBe(200);
  }, CASE_TIMEOUT_MS);
});
