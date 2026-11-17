/**
 * The `rafa-hub` command (`bin.ts`): {@link runHub} in process over a
 * config file under the temporary directory, then the file itself
 * spawned, for what only a process shows: its exit code, its standard
 * output and its stop on `SIGTERM`.
 *
 * `hub.port` refuses `0`, so each case that listens takes a port the
 * system handed a probe server a moment before. The GitHub the served
 * case asks is a stand-in (`identity/testdata/stand-in-github.ts`); no
 * case reaches api.github.com.
 *
 * Under `hub.auth.adapter: api-key` the keys are variables of the
 * environment the case hands {@link runHub}, never the process's own,
 * and so are the login's user and password; the keys file and the
 * login it holds are made under the case's root.
 *
 * `rafa-hub index rebuild` runs over a store the `sqlite` connector made
 * under the case's root, seeded with one commit pushed from a real
 * export (`@open-tomato/rafa/store`), so the counts it prints are read
 * from rows rather than from an empty index.
 */
import type { HubLogEntry, HubServer } from './server.js';
import type { CommitEffortRow, WirePayload, WireRow } from '@open-tomato/rafa/store';

import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { encodeWirePayload, exportWirePayload, openSqliteStore, WIRE_FORMAT, WIRE_VERSION } from '@open-tomato/rafa/store';
import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { hubCommandOf, HUB_VERSION, isLoopbackHostname, runHub, runIndexRebuild } from './bin.js';
import { HUB_CONFIG_ENV } from './config.js';
import { keysFileName } from './identity/key-store.js';
import { LOGIN_PASSWORD_VARIABLE, LOGIN_USER_VARIABLE, openSqliteLoginStore } from './identity/login-store.js';
import { startStandInGitHub } from './identity/testdata/stand-in-github.js';
import { HUB_ROUTES } from './server.js';
import { connectSqliteHub } from './store/sqlite.js';

const BIN = join(import.meta.dir, 'bin.ts');
const REPOSITORY = 'open-tomato/rafa';
const WRITER = 'ghp_bin_writer_token_0000001';
const API_KEY = 'bin-api-key-value-0000000000000001';
const DEVICE = 'aaaaaaaa-0000-4000-8000-00000000000a';
const T0 = '2026-11-09T10:00:00.000Z';

/** How long a spawned hub may take to answer `/health`. */
const READY_WITHIN_MS = 15_000;

let root = '';
let running: HubServer[] = [];

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-hub-bin-')));
});

afterEach(async () => {
  await Promise.all(running.map((server) => server.stop()));
  running = [];
  rmSync(root, { recursive: true, force: true });
});

/** A port the system just handed out, free again. */
async function freePort(): Promise<number> {
  const probe = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: () => new Response() });
  const port = probe.port ?? 0;
  await probe.stop(true);
  return port;
}

/** Writes a hub config listening on `port` with its store under the case's root, plus `extra` lines; answers its path. */
function writeConfig(port: number, extra = ''): string {
  const path = join(root, 'hub.yaml');
  writeFileSync(path, `hub:\n  repository: ${REPOSITORY}\n  port: ${String(port)}\n  storePath: store/rafa-hub.sqlite\n${extra}`);
  return path;
}

/** A commit row from a real export of a fresh device store, its origin set to {@link DEVICE}. */
function exportedCommit(): { readonly migrations: readonly string[]; readonly commit: WireRow } {
  const device = join(root, 'device');
  mkdirSync(device, { recursive: true });
  const store = openSqliteStore(device);
  store.append('commits', [{ sha: 'f'.repeat(40), timestamp: T0 } as CommitEffortRow]);
  const exported = exportWirePayload({ path: store.path('commits') });
  const commit = exported.tables['commits']?.[0];
  if (commit === undefined) throw new Error('the device export holds no commit');
  return { migrations: exported.migrations, commit: { ...commit, origin_store: DEVICE, origin_seq: 1 } };
}

/** Makes the hub's store under the case's root through the connector and pushes one commit into it. */
async function seedStore(): Promise<void> {
  mkdirStore();
  const { migrations, commit } = exportedCommit();
  const hub = await connectSqliteHub({ directory: join(root, 'store'), now: () => new Date(T0) }, { fileName: 'rafa-hub.sqlite' });
  try {
    const pushed = await hub.store.push({
      device: DEVICE,
      payload: { format: WIRE_FORMAT, version: WIRE_VERSION, migrations, tables: { commits: [commit] }, cursor: {} },
    });
    if (pushed.added !== 1) throw new Error(`the seed push added ${String(pushed.added)} rows, not 1`);
  } finally {
    await hub.store.close();
  }
}

/** The two projects of {@link writeTwoProjectConfig}, each with its store file under the case's root. */
const TWO_PROJECTS = [
  { id: 'a'.repeat(40), name: 'alpha', repository: 'open-tomato/alpha', storePath: 'alpha/rafa-hub.sqlite' },
  { id: 'b'.repeat(40), name: 'beta', repository: 'open-tomato/beta', storePath: 'beta/rafa-hub.sqlite' },
] as const;

/** Writes a hub config listing {@link TWO_PROJECTS}, with their stores' directories made; answers its path. */
function writeTwoProjectConfig(): string {
  const entries = TWO_PROJECTS.map(({ id, name, repository, storePath }) => {
    mkdirSync(join(root, dirname(storePath)), { recursive: true });
    return `    - id: ${id}\n      name: ${name}\n      repository: ${repository}\n      storePath: ${storePath}\n`;
  });
  const path = join(root, 'hub.yaml');
  writeFileSync(path, `hub:\n  port: 7373\n  projects:\n${entries.join('')}`);
  return path;
}

/** Pushes one commit into the first of {@link TWO_PROJECTS} alone, through the connector over both. */
async function seedFirstOfTwo(): Promise<void> {
  const { migrations, commit } = exportedCommit();
  const hub = await connectSqliteHub(
    { directory: root, now: () => new Date(T0), projects: TWO_PROJECTS.map(({ id, name }) => ({ id, name })) },
    { storeFiles: TWO_PROJECTS.map(({ id, storePath }) => ({ id, storePath })) },
  );
  try {
    const pushed = await hub.store.push({
      device: DEVICE,
      project: TWO_PROJECTS[0].id,
      payload: { format: WIRE_FORMAT, version: WIRE_VERSION, migrations, tables: { commits: [commit] }, cursor: {} },
    });
    if (pushed.added !== 1) throw new Error(`the seed push added ${String(pushed.added)} rows, not 1`);
  } finally {
    await hub.store.close();
  }
}

/** A log collecting its entries. */
function collecting(): { readonly log: (entry: HubLogEntry) => void; readonly logged: HubLogEntry[] } {
  const logged: HubLogEntry[] = [];
  return {
    log: (entry) => {
      logged.push(entry);
    },
    logged,
  };
}

describe('runHub', () => {
  it('answers null and logs every problem when the config is refused, listening nowhere', async () => {
    const { log, logged } = collecting();

    const server = await runHub({}, { log });

    expect(server).toBeNull();
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({ level: 'error', event: 'config.refused' });
    expect(String(logged[0]?.['problems'])).toContain(`${HUB_CONFIG_ENV} is not set`);
  });

  it('answers null with a config.refused line naming the variable when hub.auth.apiKeys names an empty one', async () => {
    const { log, logged } = collecting();
    const config = writeConfig(await freePort(), '  auth:\n    adapter: api-key\n    apiKeys:\n      - RAFA_HUB_BIN_KEY\n');

    const server = await runHub({ [HUB_CONFIG_ENV]: config, RAFA_HUB_BIN_KEY: '' }, { log });

    expect(server).toBeNull();
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({ level: 'error', event: 'config.refused' });
    expect(String(logged[0]?.['problems'])).toContain('RAFA_HUB_BIN_KEY is empty');
  });

  it('serves a bearer equal to the named variable under hub.auth.adapter api-key, asking no GitHub', async () => {
    mkdirStore();
    const { log } = collecting();
    const config = writeConfig(await freePort(), '  auth:\n    adapter: api-key\n    apiKeys:\n      - RAFA_HUB_BIN_KEY\n');

    const server = await runHub({ [HUB_CONFIG_ENV]: config, RAFA_HUB_BIN_KEY: API_KEY }, { log, githubApi: 'http://127.0.0.1:9' });
    if (server === null) throw new Error('the hub refused its config');
    running = [...running, server];
    const served = await fetch(`${server.url}${HUB_ROUTES.status}`, { headers: { authorization: `Bearer ${API_KEY}` } });
    const refused = await fetch(`${server.url}${HUB_ROUTES.status}`, { headers: { authorization: `Bearer ${API_KEY}x` } });

    expect(served.status).toBe(200);
    expect(refused.status).toBe(401);
  });

  it('serves the SQLite store at hub.storePath behind GitHub\'s permission for hub.repository', async () => {
    mkdirStore();
    const github = startStandInGitHub({ [WRITER]: { login: 'writer', roles: { [REPOSITORY]: 'write' } } });
    const { log } = collecting();
    try {
      const server = await runHub({ [HUB_CONFIG_ENV]: writeConfig(await freePort()) }, { log, githubApi: github.url });
      if (server === null) throw new Error('the hub refused its config');
      running = [...running, server];

      const health = await fetch(`${server.url}${HUB_ROUTES.health}`);
      const anonymous = await fetch(`${server.url}${HUB_ROUTES.status}`);
      const status = await fetch(`${server.url}${HUB_ROUTES.status}`, { headers: { authorization: `Bearer ${WRITER}` } });
      const body = await status.json() as { readonly data: { readonly version: string; readonly migrations: readonly string[] } };

      expect(health.status).toBe(200);
      expect(anonymous.status).toBe(401);
      expect(status.status).toBe(200);
      expect(body.data.version).toBe(HUB_VERSION);
      expect(body.data.migrations.length).toBeGreaterThan(0);
      expect(github.asked().map((asked) => asked.path)).toEqual(['/user', `/repos/${REPOSITORY}`]);
      expect(await Bun.file(join(root, 'store', 'rafa-hub.sqlite')).exists()).toBe(true);
    } finally {
      await github.stop();
    }
  });

  it('answers 503 on /health when hub.storePath\'s directory is not there, and keeps serving', async () => {
    const { log, logged } = collecting();

    const server = await runHub({ [HUB_CONFIG_ENV]: writeConfig(await freePort()) }, { log, githubApi: 'http://127.0.0.1:9' });
    if (server === null) throw new Error('the hub refused its config');
    running = [...running, server];

    expect((await fetch(`${server.url}${HUB_ROUTES.health}`)).status).toBe(503);
    expect(logged.some((entry) => entry.event === 'store.unavailable')).toBe(true);
  });
});

/** `hub.auth` under `api-key`, naming `RAFA_HUB_BIN_KEY`, plus `login` lines indented under it. */
function apiKeyAuth(login = ''): string {
  return `  auth:\n    adapter: api-key\n    apiKeys:\n      - RAFA_HUB_BIN_KEY\n${login}`;
}

/** An OAuth login under {@link apiKeyAuth}, its secret in `RAFA_HUB_BIN_OAUTH_SECRET`; no case reaches the provider. */
const OAUTH_LOGIN = [
  '    login:',
  '      mode: oauth',
  '      oauth:',
  '        authorizeUrl: https://github.com/login/oauth/authorize',
  '        tokenUrl: https://github.com/login/oauth/access_token',
  '        userUrl: https://api.github.com/user',
  '        clientId: Iv1.8a61f9b3a7aba766',
  '        clientSecretVariable: RAFA_HUB_BIN_OAUTH_SECRET',
  '        allowed: [\'583231\']',
  '',
].join('\n');

const LOGIN_USER = 'ada';
const LOGIN_PASSWORD = 'bin start password 0001';

/** `Authorization: Basic` for `user` and `password`. */
function basic(user: string, password: string): string {
  return `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`;
}

/** The keys file beside the case's `hub.storePath`. */
function keysFile(): string {
  return keysFileName(join(root, 'store', 'rafa-hub.sqlite'));
}

describe('runHub under hub.auth.adapter api-key, with the keys file', () => {
  /** Starts the hub over `extra` config lines and `env`, listening on `hostname`; answers it and its log. */
  async function startKeyed(
    env: Readonly<Record<string, string>>,
    options: { readonly extra?: string; readonly hostname?: string } = {},
  ): Promise<{ readonly server: HubServer; readonly logged: HubLogEntry[] }> {
    const { log, logged } = collecting();
    const config = writeConfig(await freePort(), options.extra ?? apiKeyAuth());
    const server = await runHub(
      { [HUB_CONFIG_ENV]: config, RAFA_HUB_BIN_KEY: API_KEY, ...env },
      { log, githubApi: 'http://127.0.0.1:9', hostname: options.hostname ?? '127.0.0.1' },
    );
    if (server === null) throw new Error(`the hub refused its config: ${JSON.stringify(logged)}`);
    running = [...running, server];
    return { server, logged };
  }

  /** Creates the key `name` through the key routes with the login's basic credentials; answers the plain key. */
  async function createKey(server: HubServer, name: string): Promise<string> {
    const response = await fetch(`${server.url}/v1/keys`, {
      method: 'POST',
      headers: { authorization: basic(LOGIN_USER, LOGIN_PASSWORD), 'content-type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    const body = await response.json() as { readonly data: { readonly plain: string } };
    if (response.status !== 201) throw new Error(`the create answered ${String(response.status)}`);
    return body.data.plain;
  }

  it('sets the login from the environment, logging login.set with the user alone, and a key it creates serves a bearer', async () => {
    mkdirStore();
    const { server, logged } = await startKeyed({ [LOGIN_USER_VARIABLE]: LOGIN_USER, [LOGIN_PASSWORD_VARIABLE]: LOGIN_PASSWORD });

    const plain = await createKey(server, 'laptop');
    const status = await fetch(`${server.url}${HUB_ROUTES.status}`, { headers: { authorization: `Bearer ${plain}` } });
    const listed = await fetch(`${server.url}/v1/keys`, { headers: { authorization: basic(LOGIN_USER, LOGIN_PASSWORD) } });
    const body = await listed.json() as { readonly data: { readonly keys: readonly { readonly name: string; readonly lastUsedAt: string | null }[] } };

    expect(status.status).toBe(200);
    expect(body.data.keys.map((key) => key.name)).toEqual(['laptop']);
    expect(body.data.keys[0]?.lastUsedAt).not.toBeNull();
    expect(logged.filter((entry) => entry.event === 'login.set')).toEqual([{ level: 'info', event: 'login.set', user: LOGIN_USER }]);
    expect(existsSync(keysFile())).toBe(true);
    expect(JSON.stringify(logged)).not.toContain(LOGIN_PASSWORD);
    expect(JSON.stringify(logged)).not.toContain(plain);
  });

  it('keeps a login already set in the keys file, whatever the environment holds', async () => {
    mkdirStore();
    const store = openSqliteLoginStore({ path: keysFile() });
    try {
      await store.setLogin(LOGIN_USER, LOGIN_PASSWORD);
    } finally {
      store.close();
    }
    const { server, logged } = await startKeyed({ [LOGIN_USER_VARIABLE]: 'grace', [LOGIN_PASSWORD_VARIABLE]: 'another password 0002' });

    const kept = await fetch(`${server.url}/v1/keys`, { headers: { authorization: basic(LOGIN_USER, LOGIN_PASSWORD) } });
    const fromEnv = await fetch(`${server.url}/v1/keys`, { headers: { authorization: basic('grace', 'another password 0002') } });

    expect(kept.status).toBe(200);
    expect(fromEnv.status).toBe(401);
    expect(logged.some((entry) => entry.event === 'login.set')).toBe(false);
  });

  it('logs login.incomplete naming the empty variable when only the user is set, and sets no login', async () => {
    mkdirStore();
    const { server, logged } = await startKeyed({ [LOGIN_USER_VARIABLE]: LOGIN_USER, [LOGIN_PASSWORD_VARIABLE]: '' });

    const listed = await fetch(`${server.url}/v1/keys`, { headers: { authorization: basic(LOGIN_USER, '') } });

    expect(listed.status).toBe(401);
    expect(logged.filter((entry) => entry.event.startsWith('login.'))).toEqual([
      { level: 'warn', event: 'login.incomplete', missing: LOGIN_PASSWORD_VARIABLE },
    ]);
  });

  it('answers null with a config.refused line naming the variable when the login user holds a colon', async () => {
    mkdirStore();
    const { log, logged } = collecting();
    const config = writeConfig(await freePort(), apiKeyAuth());

    const server = await runHub(
      { [HUB_CONFIG_ENV]: config, RAFA_HUB_BIN_KEY: API_KEY, [LOGIN_USER_VARIABLE]: 'ada:lovelace', [LOGIN_PASSWORD_VARIABLE]: LOGIN_PASSWORD },
      { log, hostname: '127.0.0.1' },
    );

    expect(server).toBeNull();
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({ level: 'error', event: 'config.refused' });
    expect(String(logged[0]?.['problems'])).toContain(`${LOGIN_USER_VARIABLE}: `);
    expect(JSON.stringify(logged)).not.toContain(LOGIN_PASSWORD);
  });

  it('closes the keys file when the server stops, its write-ahead log gone with the last connection', async () => {
    mkdirStore();
    const { server } = await startKeyed({ [LOGIN_USER_VARIABLE]: LOGIN_USER, [LOGIN_PASSWORD_VARIABLE]: LOGIN_PASSWORD });
    const whileServing = existsSync(`${keysFile()}-wal`);

    await server.stop();
    running = running.filter((other) => other !== server);

    expect(whileServing).toBe(true);
    expect(existsSync(`${keysFile()}-wal`)).toBe(false);
  });

  it('logs one login.insecure warning under basic on every interface, and none on a loopback hostname', async () => {
    mkdirStore();
    const open = await startKeyed({}, { hostname: '0.0.0.0' });
    await open.server.stop();
    running = running.filter((other) => other !== open.server);
    const loopback = await startKeyed({}, { hostname: '127.0.0.1' });

    const insecure = open.logged.filter((entry) => entry.event === 'login.insecure');
    expect(insecure).toHaveLength(1);
    expect(insecure[0]).toMatchObject({ level: 'warn', hostname: '0.0.0.0' });
    expect(String(insecure[0]?.['message'])).toContain('TLS');
    expect(loopback.logged.some((entry) => entry.event === 'login.insecure')).toBe(false);
  });

  it('logs no login.insecure under oauth on every interface, and refuses the config when the client secret is unset', async () => {
    mkdirStore();
    const { log, logged } = collecting();
    const config = writeConfig(await freePort(), apiKeyAuth(OAUTH_LOGIN));

    const refused = await runHub({ [HUB_CONFIG_ENV]: config, RAFA_HUB_BIN_KEY: API_KEY }, { log, hostname: '0.0.0.0' });
    const { server, logged: served } = await startKeyed({ RAFA_HUB_BIN_OAUTH_SECRET: 'bin-oauth-secret-0001' }, { extra: apiKeyAuth(OAUTH_LOGIN), hostname: '0.0.0.0' });
    const page = await fetch(`${server.url}/login`);

    expect(refused).toBeNull();
    expect(logged).toHaveLength(1);
    expect(String(logged[0]?.['problems'])).toContain('RAFA_HUB_BIN_OAUTH_SECRET');
    expect(page.status).toBe(401);
    expect(await page.text()).toContain('/login/oauth/start');
    expect(served.some((entry) => entry.event === 'login.insecure')).toBe(false);
  });

  it('answers 404 on the key routes and the page under github, making no keys file', async () => {
    mkdirStore();
    const { log, logged } = collecting();

    const server = await runHub({ [HUB_CONFIG_ENV]: writeConfig(await freePort()) }, { log, githubApi: 'http://127.0.0.1:9', hostname: '0.0.0.0' });
    if (server === null) throw new Error('the hub refused its config');
    running = [...running, server];
    const keys = await fetch(`${server.url}/v1/keys`, { headers: { authorization: basic(LOGIN_USER, LOGIN_PASSWORD) } });
    const page = await fetch(`${server.url}/login`);

    expect(keys.status).toBe(404);
    expect(page.status).toBe(404);
    expect(existsSync(keysFile())).toBe(false);
    expect(logged.some((entry) => entry.event === 'login.insecure')).toBe(false);
  });
});

describe('isLoopbackHostname', () => {
  it('reads localhost, ::1 and every 127.x.x.x address as loopback', () => {
    for (const hostname of ['localhost', 'LOCALHOST', '::1', '[::1]', '127.0.0.1', '127.1.2.3']) {
      expect(isLoopbackHostname(hostname)).toBe(true);
    }
  });

  it('reads every interface, a LAN address and a name as reached from elsewhere', () => {
    for (const hostname of ['0.0.0.0', '::', '192.168.1.10', '128.0.0.1', 'hub.example.org', '127.0.0.1.example.org']) {
      expect(isLoopbackHostname(hostname)).toBe(false);
    }
  });
});

describe('runIndexRebuild', () => {
  it('answers 1 with one line naming every problem when the config is refused, writing nothing to out', async () => {
    const out: string[] = [];
    const err: string[] = [];

    const code = await runIndexRebuild({}, { out: (line) => out.push(line), err: (line) => err.push(line) });

    expect(code).toBe(1);
    expect(out).toEqual([]);
    expect(err).toHaveLength(1);
    expect(err[0]).toContain('the config was refused');
    expect(err[0]).toContain(`${HUB_CONFIG_ENV} is not set`);
  });

  it('answers 1 with one line when hub.storePath\'s directory is not there', async () => {
    const err: string[] = [];

    const code = await runIndexRebuild({ [HUB_CONFIG_ENV]: writeConfig(7373) }, { out: () => undefined, err: (line) => err.push(line) });

    expect(code).toBe(1);
    expect(err).toHaveLength(1);
    expect(err[0]).toContain(`the store at ${join(root, 'store', 'rafa-hub.sqlite')} did not open`);
  });
});

describe('runHub over two listed projects under hub.auth.adapter api-key', () => {
  const KEYED = { RAFA_HUB_BIN_KEY: API_KEY };

  /** Starts the hub over the two-project config, answers it. */
  async function startTwo(): Promise<HubServer> {
    const config = writeTwoProjectConfig();
    writeFileSync(config, `${readFileSync(config, 'utf8').replace('port: 7373', `port: ${String(await freePort())}`)}  auth:\n    adapter: api-key\n    apiKeys:\n      - RAFA_HUB_BIN_KEY\n`);
    const server = await runHub({ [HUB_CONFIG_ENV]: config, ...KEYED }, { log: () => undefined, githubApi: 'http://127.0.0.1:9' });
    if (server === null) throw new Error('the hub refused its config');
    running = [...running, server];
    return server;
  }

  function pushTo(server: HubServer, query: string, bearer: string): Promise<Response> {
    const { migrations, commit } = exportedCommit();
    const payload: WirePayload = { format: WIRE_FORMAT, version: WIRE_VERSION, migrations, tables: { commits: [commit] }, cursor: {} };
    return fetch(`${server.url}${HUB_ROUTES.push}?device=${DEVICE}${query}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${bearer}` },
      body: encodeWirePayload(payload),
    });
  }

  /** The commit rows in a project's store file; 0 when the file was never made, since the hub opens it on first use. */
  function commitsIn(storePath: string): number {
    if (!existsSync(join(root, storePath))) return 0;
    const db = new Database(join(root, storePath), { readonly: true });
    try {
      return (db.query('SELECT COUNT(*) AS n FROM commits').get() as { n: number }).n;
    } finally {
      db.close();
    }
  }

  it('answers a wrong bearer 401 on a push and on status, writing nothing', async () => {
    const server = await startTwo();

    const push = await pushTo(server, `&project=${TWO_PROJECTS[0].id}`, `${API_KEY}x`);
    const status = await fetch(`${server.url}${HUB_ROUTES.status}`, { headers: { authorization: `Bearer ${API_KEY.slice(1)}` } });

    expect(push.status).toBe(401);
    expect(status.status).toBe(401);
    expect(commitsIn(TWO_PROJECTS[0].storePath)).toBe(0);
  });

  it('lands the right bearer\'s push to each project in that project\'s store file alone', async () => {
    const server = await startTwo();

    const toAlpha = await pushTo(server, `&project=${TWO_PROJECTS[0].id}`, API_KEY);
    expect(toAlpha.status).toBe(200);
    expect(commitsIn(TWO_PROJECTS[0].storePath)).toBe(1);
    expect(commitsIn(TWO_PROJECTS[1].storePath)).toBe(0);

    const toBeta = await pushTo(server, `&project=${TWO_PROJECTS[1].id}`, API_KEY);
    expect(toBeta.status).toBe(200);
    expect(commitsIn(TWO_PROJECTS[0].storePath)).toBe(1);
    expect(commitsIn(TWO_PROJECTS[1].storePath)).toBe(1);
  });

  it('answers a push naming an unlisted project 404 with the line naming hub.projects', async () => {
    const server = await startTwo();
    const unlisted = 'c'.repeat(40);

    const response = await pushTo(server, `&project=${unlisted}`, API_KEY);
    const body = await response.json() as { readonly error: string };

    expect(response.status).toBe(404);
    expect(body.error).toBe(`rafa-hub: project ${unlisted} is not served here; add it under hub.projects`);
    expect(commitsIn(TWO_PROJECTS[0].storePath)).toBe(0);
    expect(commitsIn(TWO_PROJECTS[1].storePath)).toBe(0);
  });

  it('names both projects on GET /v1/status', async () => {
    const server = await startTwo();

    const response = await fetch(`${server.url}${HUB_ROUTES.status}`, { headers: { authorization: `Bearer ${API_KEY}` } });
    const body = await response.json() as { readonly data: { readonly projects: readonly { readonly id: string; readonly name: string }[] } };

    expect(response.status).toBe(200);
    expect(body.data.projects).toEqual(TWO_PROJECTS.map(({ id, name }) => ({ id, name })));
  });
});

describe('runIndexRebuild over two listed projects', () => {
  it('rebuilds each project\'s index from its own store, one counts line each in hub.projects order, and answers 0', async () => {
    const config = writeTwoProjectConfig();
    await seedFirstOfTwo();
    const out: string[] = [];
    const err: string[] = [];

    const code = await runIndexRebuild({ [HUB_CONFIG_ENV]: config }, { out: (line) => out.push(line), err: (line) => err.push(line) });

    expect(err).toEqual([]);
    expect(code).toBe(0);
    expect(out).toHaveLength(2);
    expect(out[0]).toContain(`rafa-hub index rebuild: ${TWO_PROJECTS[0].id} rebuilt at `);
    expect(out[0]).toContain(': 1 rows, 0 vectors');
    expect(out[1]).toContain(`rafa-hub index rebuild: ${TWO_PROJECTS[1].id} rebuilt at `);
    expect(out[1]).toContain(': 0 rows, 0 vectors');
    for (const { storePath } of TWO_PROJECTS) {
      expect(await Bun.file(join(root, dirname(storePath), 'rafa-hub.index.sqlite')).exists()).toBe(true);
    }
  });
});

describe('hubCommandOf', () => {
  it.each([
    [[], 'serve'],
    [['index', 'rebuild'], 'index-rebuild'],
    [['index'], null],
    [['rebuild', 'index'], null],
    [['index', 'rebuild', 'now'], null],
    [['login'], 'login'],
    [['login', 'ada'], null],
    [['keys', 'list'], 'keys'],
    [['keys', 'create', 'ci', '--hub=https://hub.example.org'], 'keys'],
    [['keys'], null],
    [['keys', 'create'], null],
  ] as const)('reads %p as %p', (args, command) => {
    expect(hubCommandOf(args)).toBe(command);
  });
});

/** Makes the directory `hub.storePath` names. */
function mkdirStore(): void {
  mkdirSync(join(root, 'store'), { recursive: true });
}

/** Polls `url` until it answers 200, failing after {@link READY_WITHIN_MS}. */
async function waitForHealth(url: string): Promise<void> {
  const deadline = Date.now() + READY_WITHIN_MS;
  while (Date.now() < deadline) {
    const answered = await fetch(url).then((response) => response.status, () => 0);
    if (answered === 200) return;
    await Bun.sleep(50);
  }
  throw new Error(`${url} did not answer 200 within ${String(READY_WITHIN_MS)}ms`);
}

/** Every line of `text`, parsed as JSON; throws on a line that is not. */
function jsonLines(text: string): Record<string, unknown>[] {
  return text
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

describe('bin.ts as a process', () => {
  it('exits 1 with one config.refused line on standard output when the config is refused', async () => {
    const env = { ...process.env, [HUB_CONFIG_ENV]: join(root, 'absent.yaml') };

    const child = Bun.spawn([process.execPath, BIN], { env, stdout: 'pipe', stderr: 'pipe' });
    const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);

    expect(code).toBe(1);
    expect(stderr).toBe('');
    const lines = jsonLines(stdout);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ level: 'error', event: 'config.refused' });
    expect(String(lines[0]?.['problems'])).toContain('could not be read');
  });

  it('exits 1 at start with one config.refused line naming hub.auth.apiKeys[0], not the key value written there', async () => {
    const env = { ...process.env, [HUB_CONFIG_ENV]: writeConfig(7373, `  auth:\n    adapter: api-key\n    apiKeys:\n      - ${API_KEY}\n`) };

    const child = Bun.spawn([process.execPath, BIN], { env, stdout: 'pipe', stderr: 'pipe' });
    const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);

    expect(code).toBe(1);
    expect(stderr).toBe('');
    const lines = jsonLines(stdout);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ level: 'error', event: 'config.refused' });
    expect(String(lines[0]?.['problems'])).toContain('hub.auth.apiKeys[0]');
    expect(stdout).not.toContain(API_KEY);
  });

  it('serves /health, then stops on SIGTERM and exits 0, every line of standard output JSON', async () => {
    mkdirStore();
    const port = await freePort();
    const env = { ...process.env, [HUB_CONFIG_ENV]: writeConfig(port) };

    const child = Bun.spawn([process.execPath, BIN], { env, stdout: 'pipe', stderr: 'pipe' });
    const output = new Response(child.stdout).text();
    try {
      await waitForHealth(`http://127.0.0.1:${String(port)}${HUB_ROUTES.health}`);
    } finally {
      child.kill('SIGTERM');
    }
    const code = await child.exited;

    expect(code).toBe(0);
    const events = jsonLines(await output).map((line) => line['event']);
    expect(events[0]).toBe('listening');
    expect(events).toContain('store.opened');
    expect(events).toContain('request');
    expect(events.at(-1)).toBe('stopped');
  }, READY_WITHIN_MS + 5_000);

  it('runs index rebuild over hub.storePath, printing one line with its counts and exiting 0', async () => {
    await seedStore();
    const env = { ...process.env, [HUB_CONFIG_ENV]: writeConfig(7373) };

    const child = Bun.spawn([process.execPath, BIN, 'index', 'rebuild'], { env, stdout: 'pipe', stderr: 'pipe' });
    const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);

    expect(stderr).toBe('');
    expect(code).toBe(0);
    const lines = stdout.split('\n').filter((line) => line !== '');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain(`rafa-hub index rebuild: ${REPOSITORY} rebuilt at `);
    expect(lines[0]).toContain(': 1 rows, 0 vectors');
    expect(await Bun.file(join(root, 'store', 'rafa-hub.index.sqlite')).exists()).toBe(true);
  }, READY_WITHIN_MS);

  it('exits 1 with one line naming hub.store.sqliteLibrary when it is relative, opening no store', async () => {
    mkdirStore();
    const env = { ...process.env, [HUB_CONFIG_ENV]: writeConfig(7373, '  store:\n    sqliteLibrary: lib/libsqlite3.dylib\n') };

    const child = Bun.spawn([process.execPath, BIN, 'index', 'rebuild'], { env, stdout: 'pipe', stderr: 'pipe' });
    const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);

    expect(code).toBe(1);
    expect(stdout).toBe('');
    const lines = stderr.split('\n').filter((line) => line !== '');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('hub.store.sqliteLibrary is "lib/libsqlite3.dylib", expected an absolute path');
    expect(await Bun.file(join(root, 'store', 'rafa-hub.sqlite')).exists()).toBe(false);
  }, READY_WITHIN_MS);

  it('exits 1 with the usage line for arguments naming no command', async () => {
    const child = Bun.spawn([process.execPath, BIN, 'index'], { env: process.env, stdout: 'pipe', stderr: 'pipe' });
    const [code, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]);

    expect(code).toBe(1);
    expect(stderr).toBe('rafa-hub: index is not a command; usage: rafa-hub (serves the hub), rafa-hub index rebuild, rafa-hub login, or rafa-hub keys <list | create <name> | pause <name> | delete <name>> [--hub=<url>]\n');
  });

  it('runs login over two lines of standard input, setting the login in the keys file beside hub.storePath', async () => {
    const env = { ...process.env, [HUB_CONFIG_ENV]: writeConfig(7373, '  auth:\n    adapter: api-key\n    apiKeys: [RAFA_HUB_BIN_KEY]\n') };
    const password = 'bin login password 0001';

    const child = Bun.spawn([process.execPath, BIN, 'login'], { env, stdin: new TextEncoder().encode(`ada\n${password}\n`), stdout: 'pipe', stderr: 'pipe' });
    const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);

    expect(stderr).toBe('');
    expect(code).toBe(0);
    const keys = keysFileName(join(root, 'store', 'rafa-hub.sqlite'));
    expect(stdout).toBe(`rafa-hub login: the login is set for ada, in ${keys}\n`);
    const store = openSqliteLoginStore({ path: keys });
    try {
      expect(await store.verifyLogin('ada', password)).toBe(true);
    } finally {
      store.close();
    }
  }, READY_WITHIN_MS);

  it('runs keys, exiting 1 with one line when no hub is named', async () => {
    const env = { ...process.env, RAFA_HUB_URL: '' };

    const child = Bun.spawn([process.execPath, BIN, 'keys', 'list'], { env, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' });
    const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);

    expect(code).toBe(1);
    expect(stdout).toBe('');
    expect(stderr).toBe('rafa-hub keys list: no hub to reach; pass --hub=<url> or set RAFA_HUB_URL\n');
  });
});
