/**
 * The cross-module case of the `postgres` connector (#1429), the first
 * half of epic #1424's third criterion: two devices, each on `bun:sqlite`
 * with `effort.sync: service`, sync through one `rafa-hub` server whose
 * store is Postgres, by the wire contract alone. Each pulls the commit
 * row the other collected, and the hub's search answers both rows.
 * `two-devices.integration.test.ts` holds the same convergence over the
 * `sqlite` connector, table by table with the hub's own file.
 *
 * The hub is `runHub` (`bin.ts`) over a config file naming
 * `hub.store.engine: postgres`, so the URL is read from `POSTGRES_URL`
 * the way an operator's hub reads it. Its `connectPostgres` option calls
 * the real `connectPostgresHub` and adds a schema prefix no other case or
 * run holds, which no config key sets; the case keeps the connector it
 * answered, since no route serves a search, and drops only the schemas
 * under that prefix, with the index build they serve. A caller is
 * identified by `hub.auth.adapter: api-key`, so no GitHub stand-in runs.
 *
 * Each device is `bun src/rafa.ts` spawned as a real process over a
 * scratch git repository, as `two-devices.integration.test.ts` spawns
 * one and for the same reason: `Bun.spawn`, never `Bun.spawnSync`, since
 * the hub is a `Bun.serve` in this very process. A device's environment
 * is written out whole and names no `POSTGRES_URL`, so it reaches the
 * rows over HTTP or not at all. The hub key sits in a scratch secrets
 * file named by `testdata/test-secrets.ts`, never the system secret
 * store.
 *
 * Gated on `POSTGRES_URL`, a Postgres with `pg_search` and `pgvector`:
 * unset or empty, the case is skipped.
 */
import type { HubConnected, HubLogEntry, HubServer } from './server.js';
import type { HubStoreStatus } from './store/port.js';

import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { openSqliteStore } from '@open-tomato/rafa/store';
import { connectPostgresHub } from '@open-tomato/rafa-hub-postgres';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { runHub } from './bin.js';
import { HUB_CONFIG_ENV } from './config.js';
import { HUB_ROUTES } from './server.js';
import { dropSchemas, POSTGRES_GATE, postgresGate } from './store/testdata/postgres-gate.js';
import { expectSameMergedTables, rowsOf } from './testdata/compare-merged-stores.js';
import { plantTestSecret, testSecretsChildEnv, testSecretsFileIn } from './testdata/test-secrets.js';

const REPOSITORY = 'open-tomato/rafa';

/** The variable `hub.auth.apiKeys` names, holding the key both devices send. */
const KEY_VARIABLE = 'RAFA_HUB_PG_DEVICES_KEY';

/** The hub's store file under `sqlite`, which a hub on `postgres` never makes. */
const HUB_STORE = join('hub', 'rafa-hub.sqlite');

/** The word each device's commit subject holds alone, and the one both hold. */
const AXOLOTL = 'axolotl';
const QUOKKA = 'quokka';
const SHARED = 'sighted';

/** A word no commit holds. */
const ABSENT = 'zebrafish';

/** How long a spawned `effort collect` may take before it is killed. */
const RUN_TIMEOUT_MS = 30_000;

/** How long the hub may take to log the rebuild that covers both rows. */
const REBUILD_WITHIN_MS = 30_000;

/** How long opening the hub, or dropping its schemas, may take. */
const HOOK_TIMEOUT_MS = 60_000;

/** How long the case, four spawned commands and a rebuild, may take. */
const CASE_TIMEOUT_MS = 180_000;

/** The real rafa CLI entry, spawned as a process; never imported. */
const RAFA_ENTRY = fileURLToPath(new URL('../../../src/rafa.ts', import.meta.url));

/** The real `rafa-sync-service` package, named by path in each device's `modules:`; never imported. */
const SYNC_SERVICE_PACKAGE = fileURLToPath(new URL('../../rafa-sync-service', import.meta.url));

/** The `name` the package's `package.json` carries, and `allowList:` must match. */
const SYNC_SERVICE_NAME = '@open-tomato/rafa-sync-service';

const gitBinary = Bun.which('git');
if (gitBinary === null) throw new Error('git is not on the PATH this suite runs under');
const GIT_DIR = dirname(gitBinary);

/** The environment this process runs `git` fixture steps under: its own, with no `GIT_*` variable reaching it. */
function gitEnv(): Record<string, string> {
  return Object.fromEntries(Object.entries(process.env)
    .filter((entry): entry is [string, string] => !entry[0].startsWith('GIT_') && entry[1] !== undefined));
}

/** Runs `git` in `cwd` as a fixture step, throwing what it said on the way out when it failed. */
function git(cwd: string, ...args: string[]): void {
  const ran = Bun.spawnSync(['git', ...args], { cwd, env: gitEnv() });
  if (ran.exitCode !== 0) throw new Error(`git ${args.join(' ')} in ${cwd} failed: ${ran.stderr.toString()}`);
}

/** One scratch device: its repository, a home of its own, and the secrets file holding the hub key. */
interface Device {
  readonly root: string;
  readonly home: string;
  readonly secretsFile: string;
}

/** A device's config naming `effort.sync: service` over `hubUrl`, its key under `secretName`. */
function deviceConfig(hubUrl: string, secretName: string): string {
  return [
    'pr:',
    '  provider: none',
    'effort:',
    '  sync: service',
    'hub:',
    `  url: ${hubUrl}`,
    `  tokenSecret: ${secretName}`,
    'modules:',
    `  - path: ${SYNC_SERVICE_PACKAGE}`,
    'allowList:',
    `  - "${SYNC_SERVICE_NAME}"`,
    '',
  ].join('\n');
}

/**
 * A fresh git repository under `scope` named `name`, with one commit
 * whose subject holds `word`, the row this device writes apart, then
 * `.rafa/config.yaml` naming `hubUrl` and `secretName`.
 */
function plantDevice(scope: string, name: string, word: string, hubUrl: string, secretName: string): Device {
  const root = realpathSync(mkdtempSync(join(scope, `${name}-`)));
  const home = realpathSync(mkdtempSync(join(scope, `${name}-home-`)));

  git(root, 'init', '-q');
  writeFileSync(join(root, '.gitignore'), '.rafa/\n', 'utf8');
  git(root, 'add', '-A');
  git(root, '-c', `user.name=${name}`, '-c', `user.email=${name}@example.invalid`, 'commit', '-q', '--no-verify', '-m', `${word} ${SHARED}`);

  mkdirSync(join(root, '.rafa'), { recursive: true });
  writeFileSync(join(root, '.rafa', 'config.yaml'), deviceConfig(hubUrl, secretName), 'utf8');
  return { root, home, secretsFile: testSecretsFileIn(scope) };
}

/** Spawns `rafa effort collect --no-sessions` for `device`, which collects, pushes and pulls; fails on a failed sync. */
async function collect(device: Device): Promise<void> {
  const child = Bun.spawn([process.execPath, RAFA_ENTRY, 'effort', 'collect', '--no-sessions'], {
    cwd: device.root,
    env: {
      TMPDIR: tmpdir(),
      RAFA_TEST: '1',
      PATH: GIT_DIR,
      ...testSecretsChildEnv(device.home, device.secretsFile),
    },
    stdout: 'pipe',
    stderr: 'pipe',
    timeout: RUN_TIMEOUT_MS,
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  const output = `${stdout}${stderr}`;
  expect(exitCode, output).toBe(0);
  expect(output).not.toContain('effort sync:');
}

/** The `commits` file of `device`'s own SQLite store. */
function storeOf(device: Device): string {
  return openSqliteStore(device.root).path('commits');
}

/** A row's identity across stores, as `<origin>#<seq>`. */
function pairOf(originStore: unknown, originSeq: unknown): string {
  return `${String(originStore)}#${String(originSeq)}`;
}

/** One commit a store holds: its origin store, its pair and its stored row. */
interface HeldCommit {
  readonly origin: string;
  readonly pair: string;
  readonly rowJson: string;
}

/** Every commit the store at `path` holds. */
function commitsIn(path: string): HeldCommit[] {
  return rowsOf(path, 'commits').map((row) => ({
    origin: String(row['origin_store']),
    pair: pairOf(row['origin_store'], row['origin_seq']),
    rowJson: String(row['row_json']),
  }));
}

/** The one commit `device` holds before its first sync, its own. */
function ownCommit(device: Device): HeldCommit {
  const held = commitsIn(storeOf(device));
  const [own] = held;
  if (own === undefined || held.length !== 1) throw new Error(`${device.root} holds ${String(held.length)} commits, expected its own one`);
  return own;
}

/** A port nothing listens on: `hub.port` refuses `0`, so the config names one found free. */
async function freePort(): Promise<number> {
  const probe = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: () => new Response() });
  const port = probe.port ?? 0;
  await probe.stop(true);
  return port;
}

/** The hub's config: the `postgres` engine, one `api-key` variable, the index rebuilt after a push by default. */
function hubConfig(port: number): string {
  return [
    'hub:',
    `  repository: ${REPOSITORY}`,
    `  port: ${String(port)}`,
    `  storePath: ${HUB_STORE}`,
    '  store:',
    '    engine: postgres',
    '  auth:',
    '    adapter: api-key',
    '    apiKeys:',
    `      - ${KEY_VARIABLE}`,
    '',
  ].join('\n');
}

const gate = postgresGate(process.env);
const url = gate.open
  ? gate.url
  : '';

describe.skipIf(!gate.open)(`two sqlite devices syncing through a hub on postgres, live on ${POSTGRES_GATE}`, () => {
  let scope = '';
  let schemaPrefix = '';
  let key = '';
  let secretName = '';
  let hub: HubServer | null = null;
  let held: HubConnected | null = null;
  let logged: HubLogEntry[] = [];

  beforeEach(async () => {
    scope = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-hub-postgres-devices-')));
    schemaPrefix = `test_two_${randomUUID()
      .replaceAll('-', '')
      .slice(0, 8)}`;
    key = `key-${randomUUID()}`;
    secretName = `hub-token-${randomUUID()}`;
    held = null;
    logged = [];
    const config = join(scope, 'hub.yaml');
    writeFileSync(config, hubConfig(await freePort()), 'utf8');
    hub = await runHub({ [HUB_CONFIG_ENV]: config, [KEY_VARIABLE]: key, [POSTGRES_GATE]: url }, {
      hostname: '127.0.0.1',
      connectPostgres: async (context, options) => {
        held = await connectPostgresHub(context, { ...options, schemaPrefix });
        return held;
      },
      log: (entry) => {
        logged = [...logged, entry];
      },
    });
    // The events alone: a refused database's line may repeat the URL, password and all.
    if (hub === null) throw new Error(`the hub did not start on ${POSTGRES_GATE}: ${logged.map((entry) => entry.event).join(', ')}`);
    plantTestSecret(scope, secretName, key);
  }, HOOK_TIMEOUT_MS);

  afterEach(async () => {
    try {
      // Stopping awaits a running rebuild, so no build is made after the drop.
      await hub?.stop();
    } finally {
      hub = null;
      rmSync(scope, { recursive: true, force: true });
      await dropSchemas(url, schemaPrefix);
    }
  }, HOOK_TIMEOUT_MS);

  /** The pairs the hub's full-text search finds for `query`, each with its table, sorted. */
  async function found(query: string): Promise<string[]> {
    if (held === null) throw new Error('the hub has not opened its connector');
    const { hits } = await held.index.search({ mode: 'fts', query });
    return hits
      .map((hit) => `${hit.table} ${pairOf(hit.origin.originStore, hit.origin.originSeq)}`)
      .sort();
  }

  /** Waits for a rebuild that indexed `rows` rows, failing at once on a failed rebuild. */
  async function waitForRebuildOf(rows: number): Promise<void> {
    const deadline = Date.now() + REBUILD_WITHIN_MS;
    while (Date.now() < deadline) {
      const failed = logged.filter((entry) => entry.event === 'index.rebuild-failed');
      if (failed.length > 0) throw new Error(`a rebuild failed: ${JSON.stringify(failed)}`);
      if (logged.some((entry) => entry.event === 'index.rebuilt' && entry['rows'] === rows)) return;
      await Bun.sleep(25);
    }
    throw new Error(`no rebuild of ${String(rows)} rows was logged within ${String(REBUILD_WITHIN_MS)}ms`);
  }

  /** The rows each pull `device` made was answered with, in order, off the hub's request lines. */
  function pulledBy(device: string): unknown[] {
    return logged
      .filter((entry) => entry.event === 'request' && entry['path'] === HUB_ROUTES.pull && entry['device'] === device)
      .map((entry) => entry['rows']);
  }

  /** What `GET /v1/status` answers under the devices' key. */
  async function status(): Promise<HubStoreStatus> {
    if (hub === null) throw new Error('the hub is not running');
    const response = await fetch(`${hub.url}${HUB_ROUTES.status}`, { headers: { authorization: `Bearer ${key}` } });
    expect(response.status).toBe(200);
    return ((await response.json()) as { readonly data: HubStoreStatus }).data;
  }

  it('hands each device the other\'s row, and answers a search with both rows', async () => {
    if (hub === null) throw new Error('the hub is not running');
    const a = plantDevice(scope, 'device-a', AXOLOTL, hub.url, secretName);
    const b = plantDevice(scope, 'device-b', QUOKKA, hub.url, secretName);

    // Before any push the index the open built is empty.
    expect(await found(SHARED)).toEqual([]);

    // Round 1: A pushes its row and finds nothing to pull; B pushes its own and pulls A's.
    await collect(a);
    const fromA = ownCommit(a);
    await collect(b);
    // Round 2: A pulls B's; B has nothing left to pull.
    await collect(a);
    await collect(b);

    const onA = commitsIn(storeOf(a));
    const fromB = onA.find((commit) => commit.origin !== fromA.origin);
    if (fromB === undefined) throw new Error('device A holds no commit of another origin');
    expect(fromA.rowJson).toContain(AXOLOTL);
    expect(fromB.rowJson).toContain(QUOKKA);
    const both = [fromA.pair, fromB.pair].sort();
    expect(onA.map((commit) => commit.pair).sort()).toEqual(both);
    expect(commitsIn(storeOf(b)).map((commit) => commit.pair)
      .sort()).toEqual(both);
    expectSameMergedTables([storeOf(a), storeOf(b)]);
    expect(pulledBy(fromA.origin)).toEqual([0, 1]);
    expect(pulledBy(fromB.origin)).toEqual([1, 0]);

    // The hub holds the two rows in Postgres: no SQLite store file stands behind it.
    const answered = await status();
    expect(answered.rows['commits']).toBe(2);
    expect(answered.devices.map(({ device }) => device)).toEqual([fromA.origin, fromB.origin].sort());
    expect(existsSync(join(scope, HUB_STORE))).toBe(false);

    await waitForRebuildOf(2);
    expect(await found(AXOLOTL)).toEqual([`commits ${fromA.pair}`]);
    expect(await found(QUOKKA)).toEqual([`commits ${fromB.pair}`]);
    expect(await found(SHARED)).toEqual(both.map((pair) => `commits ${pair}`));
    expect(await found(ABSENT)).toEqual([]);
  }, CASE_TIMEOUT_MS);
});
