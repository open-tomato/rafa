/**
 * The hub and its index together: a real hub server (`server.ts`) over
 * the real `sqlite` connector (`connectSqliteHub` in `store/sqlite.ts`
 * and the index half in `store/sqlite-index.ts`, built on
 * `packages/rafa-index`), behind the real repository-permission identity
 * over a stand-in GitHub (`identity/testdata/stand-in-github.ts`).
 *
 * Two fixture devices push over HTTP, each a store made under the
 * temporary directory through `@open-tomato/rafa/store` and exported as
 * a device would, its rows given the device's origin. After each push,
 * which merges the rows into a new store file and renames it over the
 * old one, the index file is still attached and `fts` answers, first
 * straight after the push and then once the rebuild the push started has
 * swapped its own file in. The connector is opened with the extension
 * held off (a macOS platform and no library, which `prepareSqlite`
 * answers `vector: false` to), so `vector` is `false`, a vector search
 * is refused naming `fts`, and the rebuild log line says so.
 *
 * The last case is what the two files being replaced by a rename lets
 * the server do: a row pushed into the store without the server (so no
 * rebuild starts) is not found by the running server's search, then
 * `rafa-hub index rebuild` runs in a child process (`bin.ts`, spawned,
 * never imported), prints its one counts line with `vector off` and its
 * why, and the server's following search finds the row with no signal
 * between them.
 */
import type { StandInGitHub } from './identity/testdata/stand-in-github.js';
import type { HubLogEntry, HubServer } from './server.js';
import type { HubIndex, HubStore } from './store/port.js';
import type { WirePayload, WireRow } from '@open-tomato/rafa/store';

import { mkdirSync, mkdtempSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { encodeWirePayload, exportWirePayload, openSqliteStore, WIRE_FORMAT, WIRE_VERSION } from '@open-tomato/rafa/store';
import { createLoaderState } from '@open-tomato/rafa-index/loader';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { HUB_CONFIG_ENV } from './config.js';
import { openGitHubIdentity } from './identity/github.js';
import { startStandInGitHub } from './identity/testdata/stand-in-github.js';
import { HUB_ROUTES, startHubServer } from './server.js';
import { connectSqliteHub, indexFileName } from './store/sqlite.js';

const BIN = join(import.meta.dir, 'bin.ts');
const REPOSITORY = 'open-tomato/rafa';
const WRITER = 'ghp_hub_index_writer_000001';
const VERSION = '0.0.0-hub-index';
const STORE_FILE = 'rafa-hub.sqlite';
const DEVICE_A = 'aaaaaaaa-0000-4000-8000-00000000000a';
const DEVICE_B = 'bbbbbbbb-0000-4000-8000-00000000000b';
const CONTRACT_VERSION = 1;

/** How long a rebuild, or the spawned command, may take. */
const REBUILD_WITHIN_MS = 15_000;

/** The case's own timeout: two pushes, their rebuilds and a child. */
const CASE_TIMEOUT_MS = 60_000;

/** The words each fixture row carries in its `row_json`, one apiece. */
const ZEBRAFISH = 'zebrafish';
const QUOKKA = 'quokka';
const AXOLOTL = 'axolotl';

let root = '';
let hubDirectory = '';
let github: StandInGitHub;
let hub: HubServer | null = null;
let logged: HubLogEntry[] = [];
let held: { store: HubStore; index: HubIndex } | null = null;

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-hub-index-')));
  hubDirectory = join(root, 'hub');
  mkdirSync(hubDirectory);
  logged = [];
  held = null;
  github = startStandInGitHub({ [WRITER]: { login: 'writer', roles: { [REPOSITORY]: 'write' } } });
});

afterEach(async () => {
  await hub?.stop();
  hub = null;
  await github.stop();
  rmSync(root, { recursive: true, force: true });
});

/** Starts the hub over the `sqlite` connector, its vector extension held off, rebuilding after each push that adds rows. */
function startHub(): HubServer {
  const server = startHubServer({
    port: 0,
    hostname: '127.0.0.1',
    version: VERSION,
    identity: openGitHubIdentity({ repository: REPOSITORY, cacheForMs: null, apiBase: github.url }),
    openConnected: async () => {
      const connected = await connectSqliteHub(
        { directory: hubDirectory, now: () => new Date() },
        { fileName: STORE_FILE, loader: { platform: 'darwin', library: null, state: createLoaderState() }, project: REPOSITORY },
      );
      held = connected;
      return connected;
    },
    rebuildAfterPush: true,
    project: REPOSITORY,
    log: (entry) => {
      logged.push(entry);
    },
  });
  hub = server;
  return server;
}

/** The hub's store and index, once the server opened them. */
function connected(): { readonly store: HubStore; readonly index: HubIndex } {
  if (held === null) throw new Error('the hub has not opened its store yet');
  return held;
}

/**
 * A fixture device's export: a fresh store under `root` holding one
 * commit per word, exported as the device would push it, every row given
 * `origin` and its place in the list as its origin sequence.
 */
function devicePayload(origin: string, words: readonly string[]): WirePayload {
  const directory = mkdtempSync(join(root, 'device-'));
  const store = openSqliteStore(directory);
  store.append('commits', words.map((word) => ({
    sha: new Bun.CryptoHasher('sha1').update(word)
      .digest('hex'),
    timestamp: '2026-11-09T10:00:00.000Z',
    subject: `${word} sighted`,
  }) as never));
  const exported = exportWirePayload({ path: store.path('commits') });
  const rows = (exported.tables['commits'] ?? []).map((row, at): WireRow => ({ ...row, origin_store: origin, origin_seq: at + 1 }));
  return { format: WIRE_FORMAT, version: WIRE_VERSION, migrations: exported.migrations, tables: { commits: rows }, cursor: {} };
}

/** Pushes `payload` over HTTP as `device`, answering how many rows it added. */
async function pushOverHttp(server: HubServer, device: string, payload: WirePayload): Promise<number> {
  const response = await fetch(`${server.url}${HUB_ROUTES.push}?device=${device}&contractVersion=${String(CONTRACT_VERSION)}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${WRITER}` },
    body: encodeWirePayload(payload),
  });
  const body = await response.json() as { readonly success: boolean; readonly data?: { readonly added: number } };
  expect(response.status).toBe(200);
  return body.data?.added ?? -1;
}

/** The entries of one event, in the order logged. */
function eventsOf(event: string): HubLogEntry[] {
  return logged.filter((entry) => entry.event === event);
}

/** Waits until `count` rebuilds have been logged as done, failing at once on a failed one. */
async function waitForRebuilds(count: number): Promise<void> {
  const deadline = Date.now() + REBUILD_WITHIN_MS;
  while (Date.now() < deadline) {
    if (eventsOf('index.rebuild-failed').length > 0) {
      throw new Error(`a rebuild failed: ${JSON.stringify(eventsOf('index.rebuild-failed'))}`);
    }
    if (eventsOf('index.rebuilt').length >= count) return;
    await Bun.sleep(25);
  }
  throw new Error(`${String(count)} rebuilds were not logged within ${String(REBUILD_WITHIN_MS)}ms: ${JSON.stringify(logged)}`);
}

/** A file's device and inode, as one string. */
function inodeOf(path: string): string {
  const stats = statSync(path);
  return `${String(stats.dev)}:${String(stats.ino)}`;
}

/** The origin pairs `query` finds under `fts`, as `<origin>#<seq>`, sorted. */
async function found(query: string): Promise<string[]> {
  const answered = await connected().index.search({ mode: 'fts', query });
  return answered.hits
    .map((hit) => `${hit.origin.originStore}#${String(hit.origin.originSeq)}`)
    .sort();
}

/** What one `rafa-hub index rebuild` child answered. */
interface RebuildRun {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

/** Spawns `rafa-hub index rebuild` over the case's config; async, as the server shares this process's event loop. */
async function runRebuildChild(): Promise<RebuildRun> {
  const config = join(root, 'hub.yaml');
  writeFileSync(config, `hub:\n  repository: ${REPOSITORY}\n  port: 7373\n  storePath: hub/${STORE_FILE}\n`);
  const child = Bun.spawn([process.execPath, BIN, 'index', 'rebuild'], {
    env: { ...process.env, [HUB_CONFIG_ENV]: config },
    stdout: 'pipe',
    stderr: 'pipe',
    timeout: REBUILD_WITHIN_MS,
  });
  const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  return { code, stdout, stderr };
}

describe('the hub server over the sqlite connector and its index', () => {
  it('keeps the index attached and fts answering after each of two pushes, vector held off', async () => {
    const server = startHub();
    const storePath = join(hubDirectory, STORE_FILE);
    const indexPath = join(hubDirectory, indexFileName(STORE_FILE));

    // Wait for the store and its index to open: /status answers once they have.
    const opened = await fetch(`${server.url}${HUB_ROUTES.status}`, { headers: { authorization: `Bearer ${WRITER}` } });
    expect(opened.status).toBe(200);
    expect(connected().index.capabilities()).toEqual({ fts: true, vector: false, graph: false, projection: false });
    const storeAtOpen = inodeOf(storePath);
    const indexAtOpen = inodeOf(indexPath);

    // Push 1: device A's row. The merge swaps the store file.
    expect(await pushOverHttp(server, DEVICE_A, devicePayload(DEVICE_A, [ZEBRAFISH]))).toBe(1);
    expect(inodeOf(storePath)).not.toBe(storeAtOpen);
    await expect(connected().index.search({ mode: 'fts', query: ZEBRAFISH })).resolves.toBeDefined();
    await waitForRebuilds(1);
    expect(inodeOf(indexPath)).not.toBe(indexAtOpen);
    expect(await found(ZEBRAFISH)).toEqual([`${DEVICE_A}#1`]);

    // Push 2: device B's row. A second swap of the store, a second rebuild.
    const storeAfterFirst = inodeOf(storePath);
    const indexAfterFirst = inodeOf(indexPath);
    expect(await pushOverHttp(server, DEVICE_B, devicePayload(DEVICE_B, [QUOKKA]))).toBe(1);
    expect(inodeOf(storePath)).not.toBe(storeAfterFirst);
    await expect(connected().index.search({ mode: 'fts', query: QUOKKA })).resolves.toBeDefined();
    await waitForRebuilds(2);
    expect(inodeOf(indexPath)).not.toBe(indexAfterFirst);
    expect(await found(QUOKKA)).toEqual([`${DEVICE_B}#1`]);
    expect(await found(ZEBRAFISH)).toEqual([`${DEVICE_A}#1`]);

    // The extension held off: the rebuilds say so, and a vector search is refused naming fts.
    expect(eventsOf('index.rebuilt').map((entry) => entry['vector'])).toEqual([false, false]);
    const refusal = await connected().index.search({ mode: 'vector', query: QUOKKA }).then(() => '', (error: unknown) => (error as Error).message);
    expect(refusal).toContain('\'fts\'');
    expect(refusal).toContain('no SQLite library is named');
  }, CASE_TIMEOUT_MS);

  it('finds a row pushed past the server\'s rebuild once rafa-hub index rebuild ran in a child process', async () => {
    const server = startHub();
    await fetch(`${server.url}${HUB_ROUTES.status}`, { headers: { authorization: `Bearer ${WRITER}` } });
    const indexPath = join(hubDirectory, indexFileName(STORE_FILE));
    expect(await pushOverHttp(server, DEVICE_A, devicePayload(DEVICE_A, [ZEBRAFISH]))).toBe(1);
    await waitForRebuilds(1);

    // A row the server's own push route never saw: the store swaps, no rebuild starts, the index is stale.
    const added = await connected().store.push({ device: DEVICE_A, payload: devicePayload(DEVICE_A, [ZEBRAFISH, AXOLOTL]) });
    expect(added.added).toBe(1);
    expect(await found(AXOLOTL)).toEqual([]);
    expect(await found(ZEBRAFISH)).toEqual([`${DEVICE_A}#1`]);
    expect(eventsOf('index.rebuilt')).toHaveLength(1);
    const indexBefore = inodeOf(indexPath);

    // The command, in a process of its own, over the same store.
    const run = await runRebuildChild();

    expect(run.stderr).toBe('');
    expect(run.code).toBe(0);
    const lines = run.stdout.split('\n').filter((line) => line !== '');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain(`rafa-hub index rebuild: ${REPOSITORY} rebuilt at `);
    expect(lines[0]).toContain(': 2 rows, 0 vectors');
    expect(lines[0]).toContain('vector off: no embedder configured');
    expect(inodeOf(indexPath)).not.toBe(indexBefore);

    // The running server's following search reads the swapped file by its inode.
    expect(await found(AXOLOTL)).toEqual([`${DEVICE_A}#2`]);
    expect(await found(ZEBRAFISH)).toEqual([`${DEVICE_A}#1`]);
    expect(eventsOf('index.rebuilt')).toHaveLength(1);
  }, CASE_TIMEOUT_MS);
});
