/**
 * Tests for the `service` sync strategy (`sync.ts`) and the package's
 * `rafa` manifest. Each device is a real effort store under a scratch
 * git repository of this file's temporary directory, opened through
 * core's `openSqliteStore`, so its origin is minted by core as on a
 * real device; each hub is the `Bun.serve` stand-in in
 * `testdata/stand-in-hub.ts`. The token reader is always a stand-in.
 * Every refusal and failure is paired with a control on the same
 * device or hub that proves the call could have gone through.
 */
import type { ServiceSyncOptions } from './sync.js';
import type { StandInHub } from './testdata/stand-in-hub.js';
import type { SyncPortVersion } from '@open-tomato/rafa/ports';
import type { CommitEffortRow, SqliteEffortStore } from '@open-tomato/rafa/store';

import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { exportWirePayload, openSqliteStore, readHeldMigrations, WIRE_CONTRACT_VERSION, WIRE_FORMAT, WIRE_VERSION } from '@open-tomato/rafa/store';
import { Database } from 'bun:sqlite';
import { afterAll, afterEach, describe, expect, it } from 'bun:test';

import { SYNC_STATE_FILE_NAME } from './state.js';
import create, {
  createServiceSync,
  HubContractMismatch,
  HubUpgradeRequired,
  MOVE_TO_SQLITE,
  RafaUpdateRequired,
  SELF_UPDATE,
  ServiceSyncRefusal,
  UPGRADE_HUB,
} from './sync.js';
import { startStandInHub } from './testdata/stand-in-hub.js';

const TOKEN = 'ghp_service_sync_test_token';
const TOKEN_SECRET = 'hub-token';

/** A migration id no rafa build has, as a hub a newer rafa brought forward names. */
const FUTURE_MIGRATION = '9999-from-a-newer-rafa';

/** A second id no rafa build has, for a refusal naming more than one. */
const SECOND_FUTURE_MIGRATION = '9999-also-from-a-newer-rafa';

/** Long enough for a local answer. */
const TIMEOUT_MS = 2000;

const PACKAGE_DIR = new URL('../', import.meta.url);
const ROOT = new URL('../../../', import.meta.url);

const scope = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-sync-service-')));

afterAll(() => {
  rmSync(scope, { recursive: true, force: true });
});

let hubs: StandInHub[] = [];

afterEach(async () => {
  await Promise.all(hubs.map((hub) => hub.stop()));
  hubs = [];
});

/** A stand-in hub, stopped after the case. */
function hub(): StandInHub {
  const started = startStandInHub();
  hubs = [...hubs, started];
  return started;
}

/** The environment a scratch git runs under: this process's, with no `GIT_*` variable reaching it. */
function gitEnv(): Record<string, string> {
  return Object.fromEntries(Object.entries(process.env)
    .filter((entry): entry is [string, string] => !entry[0].startsWith('GIT_') && entry[1] !== undefined));
}

/** Runs git in `cwd`, failing the case when it fails. */
function git(cwd: string, ...args: string[]): void {
  const ran = Bun.spawnSync(['git', '-c', 'user.name=rafa-test', '-c', 'user.email=rafa-test@example.invalid', ...args], { cwd, env: gitEnv() });
  if (ran.exitCode !== 0) throw new Error(`git ${args.join(' ')} failed: ${ran.stderr.toString()}`);
}

let roots = 0;

/** A fresh directory of this file's scope; a git repository with one commit unless `withGit` is false. */
function freshRoot(withGit = true): string {
  roots += 1;
  const root = realpathSync(mkdtempSync(join(scope, `device-${String(roots)}-`)));
  if (withGit) {
    git(root, 'init', '-q');
    git(root, 'commit', '-q', '--allow-empty', '--no-verify', '-m', 'root');
  }
  return root;
}

let commits = 0;

/** A commit row of its own sha. */
function commitRow(): CommitEffortRow {
  commits += 1;
  const sha = new Bun.CryptoHasher('sha1')
    .update(`commit-${String(commits)}`)
    .digest('hex');
  return { sha, timestamp: '2026-10-01T08:00:00.000Z' } as CommitEffortRow;
}

/** One device: its repository, its store, and the store's file. */
interface Device {
  readonly root: string;
  readonly store: SqliteEffortStore;
  readonly path: string;
}

/** A device whose store holds `rows` commits of its own, minted by core's first write. */
function device(rows = 1, withGit = true): Device {
  const root = freshRoot(withGit);
  const store = openSqliteStore(root);
  for (let written = 0; written < rows; written += 1) store.append('commits', [commitRow()]);
  return { root, store, path: store.path('commits') };
}

/** Reads `sql` off the store at `path`. */
function read<T>(path: string, sql: string): T[] {
  const db = new Database(path, { readonly: true });
  try {
    return db.query<T, []>(sql).all();
  } finally {
    db.close();
  }
}

/** The origin `device`'s store records now. */
function originOf(at: Device): string {
  const [row] = read<{ store_id: string }>(at.path, 'SELECT store_id FROM store_meta WHERE id = 1');
  if (row === undefined) throw new Error(`the store at ${at.path} records no origin`);
  return row.store_id;
}

/** The origin pairs of `device`'s commits, sorted. */
function commitPairs(at: Device): string[] {
  return read<{ pair: string }>(at.path, 'SELECT origin_store || \':\' || origin_seq AS pair FROM commits')
    .map(({ pair }) => pair)
    .sort();
}

/** The state file of `device`'s store. */
function statePathOf(at: Device): string {
  return join(dirname(at.path), SYNC_STATE_FILE_NAME);
}

/** The state file of `device`'s store, parsed. */
function stateOf(at: Device): {
  stores: Record<string, { hub: string; push: Record<string, number>; pull: Record<string, number>; heldBack?: unknown }>;
} {
  return JSON.parse(readFileSync(statePathOf(at), 'utf8')) as ReturnType<typeof stateOf>;
}

/** The `service` strategy over `device`'s store for `at`, with a stand-in token reader. */
function serviceOf(at: Device | string, over: StandInHub, options: Partial<ServiceSyncOptions> = {}): ReturnType<typeof createServiceSync> {
  return createServiceSync({
    repoRoot: typeof at === 'string'
      ? at
      : at.root,
    backend: 'sqlite',
    hub: { url: over.url, tokenSecret: TOKEN_SECRET, timeoutMs: TIMEOUT_MS },
    readSecret: async ({ service, name }) => (service === 'rafa' && name === TOKEN_SECRET
      ? TOKEN
      : null),
    ...options,
  });
}

/** The `service` strategy over `at`'s store for `over` under `effort.syncSkew: pull-projected`. */
function projectingOf(at: Device, over: StandInHub, options: Partial<ServiceSyncOptions> = {}): ReturnType<typeof createServiceSync> {
  return serviceOf(at, over, { hub: { url: over.url, tokenSecret: TOKEN_SECRET, timeoutMs: TIMEOUT_MS, syncSkew: 'pull-projected' }, ...options });
}

/**
 * Plants a `running` run record of this live process under `at`'s
 * project, in the shape core's `beginSession` writes to
 * `.rafa/runs/<sessionId>.json`, so the merge's live-loop guard reads a
 * live loop on the store.
 */
function plantLiveRun(at: Device, sessionId: string): void {
  const dir = join(at.root, '.rafa', 'runs');
  mkdirSync(dir, { recursive: true });
  const record = {
    sessionId,
    planStub: 'rafa-322-demo',
    plan: '.rafa/plans/PLAN-rafa-322-demo.md',
    branch: 'feat/rafa-322-demo',
    pid: process.pid,
    startedAt: '2026-10-01T08:00:00.000Z',
    state: 'running',
    task: null,
  };
  writeFileSync(join(dir, `${sessionId}.json`), `${JSON.stringify(record, null, 2)}\n`);
}

/** What `call` rejected with. */
async function rejectionOf(call: Promise<unknown>): Promise<Error> {
  try {
    await call;
  } catch (error) {
    if (error instanceof Error) return error;
    throw new Error(`rejected with a non-error: ${String(error)}`);
  }
  throw new Error('the call resolved');
}

describe('the package\'s rafa manifest', () => {
  it('provides the service sync strategy from src/sync.ts at sync port 1', async () => {
    const manifest = (await Bun.file(new URL('package.json', PACKAGE_DIR)).json() as { rafa: Record<string, unknown> }).rafa;
    const port: SyncPortVersion = 1;
    expect(manifest).toEqual({
      manifestVersion: 1,
      types: ['sync'],
      provides: { sync: { kind: 'service', entry: './src/sync.ts' } },
      requires: { rafa: '>=0.31 <1', ports: { sync: port } },
    });
  });

  it('names an entry whose default export is this module\'s create', async () => {
    const entry = await import(new URL('src/sync.ts', PACKAGE_DIR).href) as { default: unknown };
    expect(entry.default).toBe(create);
  });

  it('names a rafa range the root package\'s version satisfies, and one it would not', async () => {
    const { version } = await Bun.file(new URL('package.json', ROOT)).json() as { version: string };
    expect(Bun.semver.satisfies(version, '>=0.31 <1')).toBe(true);
    expect(Bun.semver.satisfies('0.30.9', '>=0.31 <1')).toBe(false);
  });
});

describe('create', () => {
  it('makes the service strategy from the context selectSync hands on', () => {
    const made = create({ repoRoot: freshRoot(), store: 'sqlite', hub: { url: 'http://127.0.0.1:1', tokenSecret: TOKEN_SECRET, timeoutMs: TIMEOUT_MS } });
    expect(made.kind).toBe('service');
  });

  it('refuses a context naming no hub', () => {
    expect(() => create({ repoRoot: freshRoot(), store: 'sqlite' }))
      .toThrow('effort sync (service): no hub was handed to the strategy; set hub.url in .rafa/config.yaml');
  });

  it('refuses a context naming no store backend, or one no backend opens', () => {
    const hubOf = { url: 'http://127.0.0.1:1', tokenSecret: TOKEN_SECRET, timeoutMs: TIMEOUT_MS };
    expect(() => create({ repoRoot: freshRoot(), hub: hubOf }))
      .toThrow('effort sync (service): the context names store undefined, expected one of: sqlite, ndjson');
    expect(() => create({ repoRoot: freshRoot(), hub: hubOf, store: 'csv' as 'sqlite' }))
      .toThrow('the context names store "csv"');
  });
});

describe('push', () => {
  it('sends every row under the store\'s origin with the bearer token, keeping the export\'s cursor under that origin', async () => {
    const over = hub();
    const a = device(2);
    const answer = await serviceOf(a, over).push({ to: null });
    expect(answer).toEqual({ status: 'pushed', path: null });
    expect(over.requests).toEqual([{ method: 'POST', path: '/v1/effort/push', device: originOf(a), since: null, authorization: `Bearer ${TOKEN}`, rows: 2, contractVersion: String(WIRE_CONTRACT_VERSION), migrations: null }]);
    expect(over.held('commits').map((row) => `${String(row['origin_store'])}:${String(row['origin_seq'])}`)).toEqual(commitPairs(a));
    const { stores } = stateOf(a);
    expect(Object.keys(stores)).toEqual([originOf(a)]);
    expect(stores[originOf(a)]).toMatchObject({ hub: over.url, push: { commits: 2 }, pull: {} });
  });

  it('sends only the rows written past the push cursor', async () => {
    const over = hub();
    const a = device(1);
    const service = serviceOf(a, over);
    await service.push({ to: null });
    await service.push({ to: null });
    a.store.append('commits', [commitRow()]);
    await service.push({ to: null });
    expect(over.requests.map(({ rows }) => rows)).toEqual([1, 0, 1]);
    expect(stateOf(a).stores[originOf(a)]?.push.commits).toBe(2);
  });

  it('starts again from zero for another hub.url', async () => {
    const first = hub();
    const second = hub();
    const a = device(2);
    await serviceOf(a, first).push({ to: null });
    await serviceOf(a, second).push({ to: null });
    expect(second.requests.map(({ rows }) => rows)).toEqual([2]);
    expect(stateOf(a).stores[originOf(a)]?.hub).toBe(second.url);
  });

  it('answers nothing-to-sync with no contact when the store is not there yet', async () => {
    const over = hub();
    const root = freshRoot();
    expect(await serviceOf(root, over).push({ to: null })).toEqual({ status: 'nothing-to-sync' });
    expect(await serviceOf(root, over).pull({ from: null, dryRun: false })).toEqual({ status: 'nothing-to-sync' });
    expect(over.requests).toEqual([]);
    expect(existsSync(join(root, '.rafa'))).toBe(false);
  });

  it('refuses a store that records no origin, sending nothing, where a minted one is sent', async () => {
    const over = hub();
    const unminted = device(1, false);
    const pushing = await rejectionOf(serviceOf(unminted, over).push({ to: null }));
    const pulling = await rejectionOf(serviceOf(unminted, over).pull({ from: null, dryRun: false }));
    expect(pushing).toBeInstanceOf(ServiceSyncRefusal);
    expect(pushing.message).toBe(
      `effort sync (service): the store at ${unminted.path} records no origin, so the hub could not tell its rows apart from another device's.`
        + ' Nothing was sent. A rafa command that writes the store inside the project\'s git repository mints one.',
    );
    expect(pulling).toBeInstanceOf(ServiceSyncRefusal);
    expect(over.requests).toEqual([]);
    await serviceOf(device(1), over).push({ to: null });
    expect(over.requests).toHaveLength(1);
  });

  it('refuses an NDJSON project naming the move to SQLite, sending nothing', async () => {
    const over = hub();
    const a = device(1);
    const refused = await rejectionOf(serviceOf(a, over, { backend: 'ndjson' }).push({ to: null }));
    expect(refused).toBeInstanceOf(ServiceSyncRefusal);
    expect(refused.message).toContain(`Next safe step: ${MOVE_TO_SQLITE}`);
    expect(await rejectionOf(serviceOf(a, over, { backend: 'ndjson' }).pull({ from: null, dryRun: false }))).toBeInstanceOf(ServiceSyncRefusal);
    expect(over.requests).toEqual([]);
  });

  it('refuses a request naming a path, since it reaches the hub itself', async () => {
    const over = hub();
    const service = serviceOf(device(1), over);
    expect((await rejectionOf(service.push({ to: '/tmp/elsewhere' }))).message)
      .toBe('effort sync (service): to is "/tmp/elsewhere", expected null: this strategy reaches the hub itself');
    expect((await rejectionOf(service.pull({ from: '/tmp/effort.sqlite', dryRun: false }))).message)
      .toContain('from is "/tmp/effort.sqlite", expected null');
    expect(over.requests).toEqual([]);
  });
});

describe('the push\'s dry run and pendingPush', () => {
  it('count the rows past the push cursor, sending no push and leaving the state file as it was, where the push after sends them', async () => {
    const over = hub();
    const a = device(2);
    const service = serviceOf(a, over);
    await service.push({ to: null });
    a.store.append('commits', [commitRow(), commitRow(), commitRow()]);
    const before = readFileSync(statePathOf(a), 'utf8');

    expect(await service.push({ to: null, dryRun: true })).toEqual({ status: 'pushed', path: null, dryRun: true, rows: 3 });
    expect(await service.pendingPush()).toBe(3);
    expect(over.requests.map(({ rows }) => rows)).toEqual([2]);
    expect(readFileSync(statePathOf(a), 'utf8')).toBe(before);

    expect(await service.push({ to: null })).toEqual({ status: 'pushed', path: null });
    expect(over.requests.map(({ rows }) => rows)).toEqual([2, 3]);
    expect(readFileSync(statePathOf(a), 'utf8')).not.toBe(before);
    expect(await service.pendingPush()).toBe(0);
    expect(await service.push({ to: null, dryRun: true })).toEqual({ status: 'pushed', path: null, dryRun: true, rows: 0 });
  });

  it('write no state file for a store never pushed, where its first push writes one', async () => {
    const over = hub();
    const a = device(2);
    const service = serviceOf(a, over);
    expect(await service.pendingPush()).toBe(2);
    expect(await service.push({ to: null, dryRun: true })).toMatchObject({ dryRun: true, rows: 2 });
    expect(existsSync(statePathOf(a))).toBe(false);
    expect(over.requests).toEqual([]);
    expect(await service.push({ to: null, dryRun: false })).toEqual({ status: 'pushed', path: null });
    expect(existsSync(statePathOf(a))).toBe(true);
    expect(over.requests.map(({ rows }) => rows)).toEqual([2]);
  });

  it('read the hub\'s status on a dry run alone, the route a push adds never called', async () => {
    const over = contractFetch(WIRE_CONTRACT_VERSION);
    const a = device(1);
    expect(await serviceThrough(a, over).push({ to: null, dryRun: true })).toMatchObject({ dryRun: true, rows: 1 });
    expect(over.paths()).toEqual(['/v1/status']);
    expect(await serviceThrough(a, over).push({ to: null })).toEqual({ status: 'pushed', path: null });
    expect(over.paths()).toEqual(['/v1/status', '/v1/status', '/v1/effort/push']);
  });

  it('refuse a hub speaking another contract on a dry run, as a push does, where pendingPush contacts no hub', async () => {
    const over = contractFetch(WIRE_CONTRACT_VERSION + 1);
    const a = device(1);
    const service = serviceThrough(a, over);
    expect(await rejectionOf(service.push({ to: null, dryRun: true }))).toBeInstanceOf(HubContractMismatch);
    expect(over.paths()).toEqual(['/v1/status']);
    expect(await serviceThrough(a, over).pendingPush()).toBe(1);
    expect(over.paths()).toEqual(['/v1/status']);
  });

  it('count with pendingPush and no token stored, where the push from the same strategy is refused for the token', async () => {
    const over = hub();
    const service = serviceOf(device(2), over, { readSecret: async () => null });
    expect(await service.pendingPush()).toBe(2);
    expect(over.statusReads()).toBe(0);
    expect((await rejectionOf(service.push({ to: null, dryRun: true }))).name).toBe('HubTokenError');
    expect(over.requests).toEqual([]);
  });

  it('cannot see the hub\'s 409 on a dry run, which only a sent push is answered with', async () => {
    const over = hub();
    const a = device(1);
    over.setFault(() => Response.json({ success: false, error: 'rafa-hub: upgrade the hub', missing: [FUTURE_MIGRATION] }, { status: 409 }));
    expect(await serviceOf(a, over).push({ to: null, dryRun: true })).toMatchObject({ dryRun: true, rows: 1 });
    expect(over.requests).toEqual([]);
    expect(await rejectionOf(serviceOf(a, over).push({ to: null }))).toBeInstanceOf(HubUpgradeRequired);
    expect(over.requests).toHaveLength(1);
  });

  it('answer nothing-to-sync and 0 with no contact when the store is not there yet', async () => {
    const over = hub();
    const root = freshRoot();
    expect(await serviceOf(root, over).push({ to: null, dryRun: true })).toEqual({ status: 'nothing-to-sync' });
    expect(await serviceOf(root, over).pendingPush()).toBe(0);
    expect(over.statusReads()).toBe(0);
    expect(over.requests).toEqual([]);
    expect(existsSync(join(root, '.rafa'))).toBe(false);
  });

  it('refuse an NDJSON project and a store with no origin as a push does, where a minted SQLite store counts', async () => {
    const over = hub();
    const a = device(1);
    expect(await rejectionOf(serviceOf(a, over, { backend: 'ndjson' }).pendingPush())).toBeInstanceOf(ServiceSyncRefusal);
    expect(await rejectionOf(serviceOf(a, over, { backend: 'ndjson' }).push({ to: null, dryRun: true }))).toBeInstanceOf(ServiceSyncRefusal);
    expect(await rejectionOf(serviceOf(device(1, false), over).pendingPush())).toBeInstanceOf(ServiceSyncRefusal);
    expect(await serviceOf(a, over).pendingPush()).toBe(1);
    expect(over.statusReads()).toBe(0);
  });
});

describe('pull', () => {
  it('merges the rows another device pushed through mergeStore, keeping the hub\'s cursor and no backup', async () => {
    const over = hub();
    const a = device(2);
    const b = device(1);
    await serviceOf(a, over).push({ to: null });
    const answer = await serviceOf(b, over).pull({ from: null, dryRun: false });
    if (answer.status !== 'pulled') throw new Error(`pull answered ${answer.status}`);
    expect(answer.merge).toMatchObject({ status: 'merged', path: b.path, rowsAdded: 2, backupPath: null });
    expect(commitPairs(b)).toEqual([...commitPairs(a), `${originOf(b)}:1`].sort());
    expect(over.requests.at(-1)).toMatchObject({ method: 'GET', path: '/v1/effort/pull', device: originOf(b), since: null });
    expect(stateOf(b).stores[originOf(b)]).toMatchObject({ hub: over.url, push: {}, pull: { commits: 2 } });
    expect(readdirSync(dirname(b.path)).filter((name) => name.includes('.before-merge-'))).toEqual([]);
  });

  it('asks past its cursor next time, and merges nothing when no row came', async () => {
    const over = hub();
    const a = device(1);
    const b = device(1);
    await serviceOf(a, over).push({ to: null });
    await serviceOf(b, over).pull({ from: null, dryRun: false });
    const merges = read<{ n: number }>(b.path, 'SELECT count(*) AS n FROM merges');
    const again = await serviceOf(b, over).pull({ from: null, dryRun: false });
    expect(again).toEqual({ status: 'nothing-to-sync' });
    expect(over.requests.at(-1)?.since).toMatchObject({ commits: 1 });
    expect(read<{ n: number }>(b.path, 'SELECT count(*) AS n FROM merges')).toEqual(merges);
  });

  it('is never answered its own rows, and still moves its cursor past them', async () => {
    const over = hub();
    const a = device(1);
    const service = serviceOf(a, over);
    await service.push({ to: null });
    expect(await service.pull({ from: null, dryRun: false })).toEqual({ status: 'nothing-to-sync' });
    expect(stateOf(a).stores[originOf(a)]).toMatchObject({ push: { commits: 1 }, pull: { commits: 1 } });
  });

  it('builds and deletes the merge under dryRun, moving no row and no cursor', async () => {
    const over = hub();
    const a = device(1);
    const b = device(1);
    await serviceOf(a, over).push({ to: null });
    const before = commitPairs(b);
    const answer = await serviceOf(b, over).pull({ from: null, dryRun: true });
    if (answer.status !== 'pulled') throw new Error(`pull answered ${answer.status}`);
    expect(answer.merge).toMatchObject({ status: 'would-merge', rowsAdded: 1, backupPath: null });
    expect(commitPairs(b)).toEqual(before);
    expect(existsSync(statePathOf(b))).toBe(false);
  });

  it('refuses a hub naming a migration this rafa lacks, naming rafa self-update, where the same hub without it merges', async () => {
    const over = hub();
    const a = device(1);
    const b = device(1);
    await serviceOf(a, over).push({ to: null });
    over.setExtraMigrations([FUTURE_MIGRATION]);
    const refused = await rejectionOf(serviceOf(b, over).pull({ from: null, dryRun: false }));
    expect(refused).toBeInstanceOf(RafaUpdateRequired);
    expect(refused.message).toBe(
      `effort sync: this rafa is behind the hub (migration ${FUTURE_MIGRATION}); nothing was merged.`
        + ' Next step: rafa self-update, then rafa effort sync',
    );
    expect((refused as RafaUpdateRequired).nextStep).toBe(SELF_UPDATE);
    expect((refused as RafaUpdateRequired).missing).toEqual([FUTURE_MIGRATION]);
    expect(commitPairs(b)).toEqual([`${originOf(b)}:1`]);
    expect(existsSync(statePathOf(b))).toBe(false);

    over.setExtraMigrations([]);
    expect((await serviceOf(b, over).pull({ from: null, dryRun: false })).status).toBe('pulled');
  });

  it('passes the request\'s session id to the merge, whose guard passes that run\'s live record and no other', async () => {
    const own = '11111111-2222-3333-4444-555555555555';
    const over = hub();
    const a = device(1);
    const b = device(1);
    await serviceOf(a, over).push({ to: null });
    plantLiveRun(b, own);
    const before = commitPairs(b);

    const unnamed = await rejectionOf(serviceOf(b, over).pull({ from: null, dryRun: false }));
    const other = await rejectionOf(serviceOf(b, over).pull({ from: null, dryRun: false, sessionId: '66666666-7777-8888-9999-000000000000' }));
    expect([unnamed, other]).toMatchObject([{ reason: 'live-loop' }, { reason: 'live-loop' }]);
    expect(commitPairs(b)).toEqual(before);
    expect(existsSync(statePathOf(b))).toBe(false);

    const answer = await serviceOf(b, over).pull({ from: null, dryRun: false, sessionId: own });
    expect(answer).toMatchObject({ status: 'pulled', merge: { status: 'merged', rowsAdded: 1 } });
    expect(commitPairs(b)).toEqual([...commitPairs(a), ...before].sort());
  });

  it('refuses a hub naming a migration this rafa lacks when it answers no row', async () => {
    const over = hub();
    over.setExtraMigrations([FUTURE_MIGRATION]);
    const refused = await rejectionOf(serviceOf(device(1), over).pull({ from: null, dryRun: false }));
    expect(refused).toBeInstanceOf(RafaUpdateRequired);
  });

  it('names every id the hub applied that this rafa lacks, in the hub\'s order', async () => {
    const over = hub();
    over.setExtraMigrations([FUTURE_MIGRATION, SECOND_FUTURE_MIGRATION]);
    const refused = await rejectionOf(serviceOf(device(1), over).pull({ from: null, dryRun: false }));
    expect(refused.message).toBe(
      `effort sync: this rafa is behind the hub (migration ${FUTURE_MIGRATION}, ${SECOND_FUTURE_MIGRATION});`
        + ' nothing was merged. Next step: rafa self-update, then rafa effort sync',
    );
  });
});

describe('the projected pull, under effort.syncSkew: pull-projected', () => {
  /** A clock answering `times` in turn, holding the last. */
  const clock = (...times: string[]): (() => Date) => {
    let calls = 0;
    return () => new Date(times[Math.min(calls++, times.length - 1)] ?? times[0] ?? '');
  };

  /** The migration ids `at`'s store applied, in apply order. */
  const migrationsOf = (at: Device): string => read<{ id: string }>(at.path, 'SELECT id FROM schema_migrations ORDER BY rowid')
    .map(({ id }) => id)
    .join(',');

  /** The columns the stand-in hub names as cut off `commits`: two, by the one id it projects. */
  const CUT_COLUMNS = { commits: ['future_a', 'future_b'] };

  /** A hub one migration ahead of this rafa, projecting `commits` of `columns` (null names none) and holding one row of `a`'s. */
  const aheadHub = async (a: Device, columns: typeof CUT_COLUMNS | null = CUT_COLUMNS): Promise<StandInHub> => {
    const over = hub();
    await serviceOf(a, over).push({ to: null });
    over.setExtraMigrations([FUTURE_MIGRATION]);
    over.setProjection({ commits: [FUTURE_MIGRATION] }, columns ?? undefined);
    return over;
  };

  it('sends this build\'s migrations, lists the cut rows in held_rows, keeps heldBack and answers the pulled line, where refuse is refused', async () => {
    const a = device(1);
    const b = device(1);
    const over = await aheadHub(a);
    const refused = await rejectionOf(serviceOf(b, over).pull({ from: null, dryRun: false }));
    expect(refused).toBeInstanceOf(RafaUpdateRequired);
    expect(over.requests.at(-1)?.migrations).toBeNull();

    const answer = await projectingOf(b, over, { now: clock('2026-11-01T10:00:00.000Z') }).pull({ from: null, dryRun: false });
    expect(over.requests.at(-1)?.migrations).toBe(migrationsOf(b));
    expect(answer).toMatchObject({
      status: 'pulled',
      merge: { status: 'merged', rowsAdded: 1, rowsHeld: 1 },
      notice: 'effort sync: pulled 1 rows projected to this rafa\'s schema; 2 columns wait for rafa self-update',
    });
    expect(commitPairs(b)).toEqual([...commitPairs(a), `${originOf(b)}:1`].sort());
    expect(read<{ pair: string }>(b.path, 'SELECT origin_store || \':\' || origin_seq AS pair FROM held_rows').map(({ pair }) => pair))
      .toEqual(commitPairs(a));
    expect(readHeldMigrations(b.path)).toEqual([FUTURE_MIGRATION]);
    expect(stateOf(b).stores[originOf(b)]).toMatchObject({ pull: { commits: 1 } });
    expect(stateOf(b).stores[originOf(b)]?.heldBack).toEqual({ cursor: {}, since: '2026-11-01T10:00:00.000Z' });
  });

  it('counts the columns the answer names as cut, not its lacking ids, and none when it names no cut column', async () => {
    const a = device(1);
    const named = await projectingOf(device(1), await aheadHub(a)).pull({ from: null, dryRun: false });
    const unnamed = await projectingOf(device(1), await aheadHub(a, null)).pull({ from: null, dryRun: false });
    expect(named).toMatchObject({ notice: 'effort sync: pulled 1 rows projected to this rafa\'s schema; 2 columns wait for rafa self-update' });
    expect(unnamed).toMatchObject({ notice: 'effort sync: pulled 1 rows projected to this rafa\'s schema; 0 columns wait for rafa self-update' });
  });

  it('keeps heldBack at the first projected contact, as a later one pulls past its cursor', async () => {
    const a = device(1);
    const b = device(1);
    const over = await aheadHub(a);
    await projectingOf(b, over, { now: clock('2026-11-01T10:00:00.000Z') }).pull({ from: null, dryRun: false });
    a.store.append('commits', [commitRow()]);
    await serviceOf(a, over).push({ to: null });
    const later = await projectingOf(b, over, { now: clock('2026-11-02T10:00:00.000Z') }).pull({ from: null, dryRun: false });
    expect(over.requests.at(-1)?.since).toMatchObject({ commits: 1 });
    expect(later).toMatchObject({ status: 'pulled', merge: { rowsAdded: 1, rowsHeld: 1 } });
    expect(stateOf(b).stores[originOf(b)]).toMatchObject({ pull: { commits: 2 } });
    expect(stateOf(b).stores[originOf(b)]?.heldBack).toEqual({ cursor: {}, since: '2026-11-01T10:00:00.000Z' });
    expect(read<{ n: number }>(b.path, 'SELECT count(*) AS n FROM held_rows')).toEqual([{ n: 2 }]);
  });

  it('keeps no heldBack and no listing under dryRun, where the same pull run keeps both', async () => {
    const a = device(1);
    const b = device(1);
    const over = await aheadHub(a);
    expect(await projectingOf(b, over).pull({ from: null, dryRun: true })).toMatchObject({ status: 'pulled', merge: { status: 'would-merge' } });
    expect(existsSync(statePathOf(b))).toBe(false);
    expect(readHeldMigrations(b.path)).toEqual([]);
    await projectingOf(b, over).pull({ from: null, dryRun: false });
    expect(stateOf(b).stores[originOf(b)]).toHaveProperty('heldBack');
  });

  it('answers a whole pull with no notice and no heldBack, from a hub not ahead', async () => {
    const a = device(1);
    const b = device(1);
    const over = hub();
    await serviceOf(a, over).push({ to: null });
    over.setProjection({ commits: [FUTURE_MIGRATION] });
    const answer = await projectingOf(b, over).pull({ from: null, dryRun: false });
    expect(over.requests.at(-1)?.migrations).toBe(migrationsOf(b));
    expect(answer).not.toHaveProperty('notice');
    expect(stateOf(b).stores[originOf(b)]).not.toHaveProperty('heldBack');
  });

  it('writes a pull 409 naming missing as the rafa self-update line, moving no cursor, and one naming none as the hub wrote it', async () => {
    const a = device(1);
    const b = device(1);
    const over = await aheadHub(a);
    over.setFault(() => Response.json({ success: false, error: 'rafa-hub: cannot project', missing: [FUTURE_MIGRATION] }, { status: 409 }));
    const refused = await rejectionOf(projectingOf(b, over).pull({ from: null, dryRun: false }));
    expect(refused).toBeInstanceOf(RafaUpdateRequired);
    expect(refused.message).toBe(
      `effort sync: this rafa is behind the hub (migration ${FUTURE_MIGRATION}); nothing was merged. Next step: rafa self-update, then rafa effort sync`,
    );
    expect(existsSync(statePathOf(b))).toBe(false);
    over.setFault(() => Response.json({ success: false, error: 'rafa-hub: cannot project' }, { status: 409 }));
    expect(await rejectionOf(projectingOf(b, over).pull({ from: null, dryRun: false }))).toMatchObject({ name: 'HubRefused', status: 409 });

    over.setFault(null);
    expect(await projectingOf(b, over).pull({ from: null, dryRun: false })).toMatchObject({ status: 'pulled' });
  });

  describe('the refill, from a build knowing every id held_rows lists', () => {
    /** When `b`'s first projected contact is taken, and the date the refilled line names. */
    const FIRST = '2026-11-01T10:00:00.000Z';

    /** The pairs `at`'s `held_rows` lists, sorted. */
    const heldPairs = (at: Device): string[] => read<{ pair: string }>(at.path, 'SELECT origin_store || \':\' || origin_seq AS pair FROM held_rows')
      .map(({ pair }) => pair)
      .sort();

    /**
     * Rewrites every listing of `at`'s `held_rows` to name the newest
     * migration its store applied, as a build whose catalogue knows the
     * ids a projected contact listed finds them, and has `over` answer
     * whole from then on.
     */
    const catchUp = (at: Device, over: StandInHub): void => {
      const newest = migrationsOf(at)
        .split(',')
        .at(-1) ?? '';
      const db = new Database(at.path);
      try {
        db.query('UPDATE held_rows SET missing = json_array(?)').run(newest);
      } finally {
        db.close();
      }
      over.setExtraMigrations([]);
    };

    /** `b` after one projected contact with a hub ahead holding one row of `a`'s, its pull cursor past that row. */
    const heldDevice = async (): Promise<{ a: Device; b: Device; over: StandInHub }> => {
      const a = device(1);
      const b = device(1);
      const over = await aheadHub(a);
      await projectingOf(b, over, { now: clock(FIRST) }).pull({ from: null, dryRun: false });
      return { a, b, over };
    };

    it('pulls from heldBack, takes the held rows whole, clears heldBack and answers the refilled line, where a build lacking an id pulls projected past its cursor', async () => {
      const { a, b, over } = await heldDevice();
      a.store.append('commits', [commitRow()]);
      await serviceOf(a, over).push({ to: null });
      const behind = await projectingOf(b, over).pull({ from: null, dryRun: false });
      expect(over.requests.at(-1)?.since).toMatchObject({ commits: 1 });
      expect(behind).toMatchObject({ notice: 'effort sync: pulled 1 rows projected to this rafa\'s schema; 2 columns wait for rafa self-update' });
      expect(stateOf(b).stores[originOf(b)]?.heldBack).toEqual({ cursor: {}, since: FIRST });

      catchUp(b, over);
      a.store.append('commits', [commitRow()]);
      await serviceOf(a, over).push({ to: null });
      const refilled = await projectingOf(b, over).pull({ from: null, dryRun: false });
      expect(over.requests.at(-1)?.since).toBeNull();
      expect(refilled).toMatchObject({
        status: 'pulled',
        merge: { status: 'merged', rowsAdded: 1, rowsHeld: 0, rowsRefilled: 2, rowsInConflict: 0 },
        notice: 'effort sync: refilled 2 rows held back since 2026-11-01',
      });
      expect(heldPairs(b)).toEqual([]);
      expect(commitPairs(b)).toEqual([...commitPairs(a), `${originOf(b)}:1`].sort());
      expect(stateOf(b).stores[originOf(b)]).toMatchObject({ pull: { commits: 3 } });
      expect(stateOf(b).stores[originOf(b)]).not.toHaveProperty('heldBack');

      a.store.append('commits', [commitRow()]);
      await serviceOf(a, over).push({ to: null });
      const after = await projectingOf(b, over).pull({ from: null, dryRun: false });
      expect(over.requests.at(-1)?.since).toMatchObject({ commits: 3 });
      expect(after).toMatchObject({ status: 'pulled', merge: { rowsAdded: 1, rowsRefilled: 0 } });
      expect(after).not.toHaveProperty('notice');
    });

    it('refills under effort.syncSkew: refuse too, sending no migrations', async () => {
      const { b, over } = await heldDevice();
      catchUp(b, over);
      const refilled = await serviceOf(b, over).pull({ from: null, dryRun: false });
      expect(over.requests.at(-1)).toMatchObject({ since: null, migrations: null });
      expect(refilled).toMatchObject({ merge: { rowsRefilled: 1 }, notice: 'effort sync: refilled 1 rows held back since 2026-11-01' });
      expect(stateOf(b).stores[originOf(b)]).not.toHaveProperty('heldBack');
    });

    it('keeps heldBack, the listings and the cursor under dryRun, where the same refill run clears them', async () => {
      const { a, b, over } = await heldDevice();
      catchUp(b, over);
      const state = readFileSync(statePathOf(b), 'utf8');
      const dry = await projectingOf(b, over).pull({ from: null, dryRun: true });
      expect(dry).toMatchObject({ merge: { status: 'would-merge' }, notice: 'effort sync: refilled 1 rows held back since 2026-11-01' });
      expect(readFileSync(statePathOf(b), 'utf8')).toBe(state);
      expect(heldPairs(b)).toEqual(commitPairs(a));

      await projectingOf(b, over).pull({ from: null, dryRun: false });
      expect(heldPairs(b)).toEqual([]);
      expect(stateOf(b).stores[originOf(b)]).not.toHaveProperty('heldBack');
    });

    it('keeps heldBack and lists the rows again when the refill is answered projected, by a hub gone further ahead', async () => {
      const { a, b, over } = await heldDevice();
      catchUp(b, over);
      over.setExtraMigrations([SECOND_FUTURE_MIGRATION]);
      over.setProjection({ commits: [SECOND_FUTURE_MIGRATION] });
      const answer = await projectingOf(b, over).pull({ from: null, dryRun: false });
      expect(over.requests.at(-1)?.since).toBeNull();
      expect(answer).toMatchObject({
        merge: { rowsRefilled: 0 },
        notice: 'effort sync: pulled 1 rows projected to this rafa\'s schema; 0 columns wait for rafa self-update',
      });
      expect(heldPairs(b)).toEqual(commitPairs(a));
      expect(readHeldMigrations(b.path)).toContain(SECOND_FUTURE_MIGRATION);
      expect(stateOf(b).stores[originOf(b)]?.heldBack).toEqual({ cursor: {}, since: FIRST });
    });

    it('takes a heldBack with nothing listed for no refill, pulling past its cursor and clearing it at the first whole answer', async () => {
      const a = device(1);
      const b = device(1);
      const over = await aheadHub(a);
      over.setProjection({});
      await projectingOf(b, over, { now: clock(FIRST) }).pull({ from: null, dryRun: false });
      expect(heldPairs(b)).toEqual([]);
      expect(stateOf(b).stores[originOf(b)]?.heldBack).toEqual({ cursor: {}, since: FIRST });

      const behind = await projectingOf(b, over).pull({ from: null, dryRun: false });
      expect(over.requests.at(-1)?.since).toMatchObject({ commits: 1 });
      expect(behind).toEqual({ status: 'nothing-to-sync' });
      expect(stateOf(b).stores[originOf(b)]?.heldBack).toEqual({ cursor: {}, since: FIRST });

      over.setExtraMigrations([]);
      const whole = await projectingOf(b, over).pull({ from: null, dryRun: false });
      expect(over.requests.at(-1)?.since).toMatchObject({ commits: 1 });
      expect(whole).toEqual({ status: 'nothing-to-sync' });
      expect(stateOf(b).stores[originOf(b)]).not.toHaveProperty('heldBack');
    });
  });
});

describe('keyed by origin_store', () => {
  it('keeps a merged store\'s origin across the pull and one write, so its cursors carry on', async () => {
    const over = hub();
    const a = device(1);
    const b = device(1);
    await serviceOf(a, over).push({ to: null });
    await serviceOf(b, over).push({ to: null });
    const before = originOf(b);
    await serviceOf(b, over).pull({ from: null, dryRun: false });

    b.store.append('commits', [commitRow()]);
    await serviceOf(b, over).push({ to: null });

    expect(originOf(b)).toBe(before);
    expect(over.requests.at(-1)).toMatchObject({ device: before });
    expect(Object.keys(stateOf(b).stores)).toEqual([before]);
  });

  it('mints a new origin for a copy renamed over the store, which the cursors then start from zero', async () => {
    const over = hub();
    const b = device(1);
    await serviceOf(b, over).push({ to: null });
    const before = originOf(b);
    const copy = `${b.path}.copy`;
    copyFileSync(b.path, copy);
    renameSync(copy, b.path);

    openSqliteStore(b.root).append('commits', [commitRow()]);
    const minted = originOf(b);
    await serviceOf(b, over).push({ to: null });

    expect(minted).not.toBe(before);
    expect(over.requests.at(-1)).toMatchObject({ device: minted });
    expect(Object.keys(stateOf(b).stores)).toEqual([minted]);
  });

  it('keeps a store\'s cursors across write opens that mint nothing', async () => {
    const over = hub();
    const a = device(1);
    await serviceOf(a, over).push({ to: null });
    const origin = originOf(a);
    a.store.append('commits', [commitRow()]);
    await serviceOf(a, over).push({ to: null });
    expect(originOf(a)).toBe(origin);
    expect(over.requests.map(({ rows }) => rows)).toEqual([1, 1]);
  });
});

describe('when the hub cannot be reached or refuses', () => {
  it('rejects as HubUnreachable once the hub stops listening, moving no cursor', async () => {
    const over = hub();
    const a = device(1);
    await serviceOf(a, over).push({ to: null });
    const kept = readFileSync(statePathOf(a), 'utf8');
    a.store.append('commits', [commitRow()]);
    await over.stop();
    const pushing = await rejectionOf(serviceOf(a, over).push({ to: null }));
    const pulling = await rejectionOf(serviceOf(a, over).pull({ from: null, dryRun: false }));
    expect([pushing.name, pulling.name]).toEqual(['HubUnreachable', 'HubUnreachable']);
    expect(readFileSync(statePathOf(a), 'utf8')).toBe(kept);
  });

  it('passes a 401 on as HubRefused, not unreachable, and a 409 with the hub\'s own line', async () => {
    const over = hub();
    const a = device(1);
    over.setFault(() => Response.json({ success: false, error: 'the token is not valid' }, { status: 401 }));
    const unauthorised = await rejectionOf(serviceOf(a, over).push({ to: null }));
    over.setFault(() => Response.json({ success: false, error: 'rafa-hub: upgrade the hub' }, { status: 409 }));
    const upgrade = await rejectionOf(serviceOf(a, over).push({ to: null }));
    expect([unauthorised.name, upgrade.name]).toEqual(['HubRefused', 'HubRefused']);
    expect(unauthorised.message).toBe('the hub refused push: HTTP 401: the token is not valid');
    expect(upgrade.message).toBe('the hub refused push: HTTP 409: rafa-hub: upgrade the hub');
    expect(existsSync(statePathOf(a))).toBe(false);

    over.setFault(null);
    expect(await serviceOf(a, over).push({ to: null })).toEqual({ status: 'pushed', path: null });
  });

  it('writes a 409 naming missing as the hub-behind line, moving no cursor, where the same hub taking it pushes', async () => {
    const over = hub();
    const a = device(1);
    over.setFault(() => Response.json(
      { success: false, error: 'rafa-hub: upgrade the hub', missing: [FUTURE_MIGRATION, SECOND_FUTURE_MIGRATION] },
      { status: 409 },
    ));
    const refused = await rejectionOf(serviceOf(a, over).push({ to: null }));
    expect(refused).toBeInstanceOf(HubUpgradeRequired);
    expect(refused.message).toBe(
      `effort sync: the hub is behind this rafa (migration ${FUTURE_MIGRATION}, ${SECOND_FUTURE_MIGRATION});`
        + ' nothing was sent. Next step: upgrade the hub, then rafa effort sync',
    );
    expect((refused as HubUpgradeRequired).missing).toEqual([FUTURE_MIGRATION, SECOND_FUTURE_MIGRATION]);
    expect((refused as HubUpgradeRequired).nextStep).toBe(UPGRADE_HUB);
    expect(existsSync(statePathOf(a))).toBe(false);

    over.setFault(null);
    expect(await serviceOf(a, over).push({ to: null })).toEqual({ status: 'pushed', path: null });
  });

  it('keeps a 409 naming an empty missing as the hub\'s own line', async () => {
    const over = hub();
    over.setFault(() => Response.json({ success: false, error: 'rafa-hub: upgrade the hub', missing: [] }, { status: 409 }));
    const refused = await rejectionOf(serviceOf(device(1), over).push({ to: null }));
    expect(refused.name).toBe('HubRefused');
    expect(refused.message).toBe('the hub refused push: HTTP 409: rafa-hub: upgrade the hub');
  });

  it('rejects with the token reader\'s refusal before any contact when no token is stored', async () => {
    const over = hub();
    const refused = await rejectionOf(serviceOf(device(1), over, { readSecret: async () => null }).push({ to: null }));
    expect(refused.name).toBe('HubTokenError');
    expect(refused.message).toContain(`no hub token is stored under service "rafa", name "${TOKEN_SECRET}"`);
    expect(over.requests).toEqual([]);
  });
});

/** What a fetch stand-in saw: the path of each call, in order. */
interface ContractFetch {
  readonly fetch: typeof fetch;
  readonly paths: () => readonly string[];
}

/** The address the fetch stand-in is reached under; nothing listens there. */
const STAND_IN_URL = 'http://hub.invalid';

/**
 * A fetch stand-in for a hub speaking contract `contractVersion`: it
 * answers `/v1/status` naming that version, a push as taken, and a pull
 * with no row, recording every path it was called for.
 */
function contractFetch(contractVersion: number): ContractFetch {
  const paths: string[] = [];
  const answer = (pathname: string): unknown => {
    if (pathname === '/v1/status') {
      return { version: '0.0.0-stand-in', migrations: [], rows: {}, devices: [], contractVersion, capabilities: {} };
    }
    if (pathname === '/v1/effort/push') return { received: 0, added: 0, at: '2026-10-01T09:00:00.000Z' };
    return { format: WIRE_FORMAT, version: WIRE_VERSION, migrations: [], tables: {}, cursor: {} };
  };
  const stand = async (input: string | URL | Request): Promise<Response> => {
    const { pathname } = new URL(input instanceof Request
      ? input.url
      : input);
    paths.push(pathname);
    return Response.json({ success: true, data: answer(pathname) });
  };
  return { fetch: stand as typeof fetch, paths: () => [...paths] };
}

/** The `service` strategy over `at`'s store, reaching the hub through `over`. */
function serviceThrough(at: Device, over: ContractFetch): ReturnType<typeof createServiceSync> {
  return createServiceSync({
    repoRoot: at.root,
    backend: 'sqlite',
    hub: { url: STAND_IN_URL, tokenSecret: TOKEN_SECRET, timeoutMs: TIMEOUT_MS },
    readSecret: async () => TOKEN,
    fetch: over.fetch,
  });
}

/** Writes a BLOB into one of `at`'s commit rows, which `exportWirePayload` refuses to read. */
function plantBlob(at: Device): void {
  const db = new Database(at.path);
  try {
    db.run('UPDATE commits SET row_json = X\'00\'');
  } finally {
    db.close();
  }
}

describe('a hub speaking another contract version', () => {
  it.each([
    [2, SELF_UPDATE],
    [0, `upgrade the hub at ${STAND_IN_URL} to a rafa-hub that speaks this rafa's contract`],
  ])('refuses a hub at contract %p with HubContractMismatch naming %p, calling neither the push nor the pull route', async (version, step) => {
    const over = contractFetch(version);
    const a = device(1);
    const service = serviceThrough(a, over);
    const pushing = await rejectionOf(service.push({ to: null }));
    const pulling = await rejectionOf(service.pull({ from: null, dryRun: false }));
    for (const refused of [pushing, pulling]) {
      expect(refused).toBeInstanceOf(HubContractMismatch);
      expect(refused).toMatchObject({ name: 'HubContractMismatch', hubVersion: version, rafaVersion: WIRE_CONTRACT_VERSION, nextStep: step });
      expect(refused.message).toBe(
        `effort sync: the hub speaks contract ${String(version)}, this rafa contract ${String(WIRE_CONTRACT_VERSION)}; nothing was sent. Next step: ${step}`,
      );
    }
    expect(over.paths()).toEqual(['/v1/status']);
    expect(existsSync(statePathOf(a))).toBe(false);
  });

  it('pushes and pulls through the same stand-in when it speaks this rafa\'s contract', async () => {
    const over = contractFetch(WIRE_CONTRACT_VERSION);
    const a = device(1);
    const service = serviceThrough(a, over);
    expect(await service.push({ to: null })).toEqual({ status: 'pushed', path: null });
    expect(await service.pull({ from: null, dryRun: false })).toEqual({ status: 'nothing-to-sync' });
    expect(over.paths()).toEqual(['/v1/status', '/v1/effort/push', '/v1/effort/pull']);
  });

  it('refuses before the export runs, where the same store under a matching hub reaches the export\'s refusal', async () => {
    const a = device(1);
    plantBlob(a);
    const ahead = contractFetch(WIRE_CONTRACT_VERSION + 1);
    const refused = await rejectionOf(serviceThrough(a, ahead).push({ to: null }));
    expect(refused.name).toBe('HubContractMismatch');
    expect(ahead.paths()).toEqual(['/v1/status']);

    const agreed = contractFetch(WIRE_CONTRACT_VERSION);
    const exported = await rejectionOf(serviceThrough(a, agreed).push({ to: null }));
    expect(exported.name).toBe('WireExportRefusal');
    expect(agreed.paths()).toEqual(['/v1/status']);
  });

  it('answers nothing-to-sync with no contact, the status read included, when the store is not there yet', async () => {
    const over = contractFetch(WIRE_CONTRACT_VERSION + 1);
    const root = freshRoot();
    const service = createServiceSync({
      repoRoot: root,
      backend: 'sqlite',
      hub: { url: STAND_IN_URL, tokenSecret: TOKEN_SECRET, timeoutMs: TIMEOUT_MS },
      readSecret: async () => TOKEN,
      fetch: over.fetch,
    });
    expect(await service.push({ to: null })).toEqual({ status: 'nothing-to-sync' });
    expect(await service.pull({ from: null, dryRun: false })).toEqual({ status: 'nothing-to-sync' });
    expect(over.paths()).toEqual([]);
  });
});

/**
 * A device whose store was minted in a repository with a commit, and
 * whose repository was then made again with no commit, so its store
 * records an origin and its repository has no root commit. A store
 * first written in a repository with no commit records no origin, and
 * is refused for that before its project is read.
 */
function uncommittedDevice(): Device {
  const at = device(1);
  rmSync(join(at.root, '.git'), { recursive: true, force: true });
  git(at.root, 'init', '-q');
  return at;
}

/** The root commit of the repository at `root`, as git prints it. */
function rootCommitOf(root: string): string {
  const ran = Bun.spawnSync(['git', 'rev-list', '--max-parents=0', 'HEAD'], { cwd: root, env: gitEnv() });
  return ran.stdout.toString().trim();
}

describe('the project', () => {
  const served = [{ id: 'some-project', name: 'some/project' }];

  it('names the repository\'s root commit on push and pull to a hub naming projects, and none to a hub naming none', async () => {
    const over = hub();
    over.setProjects(served);
    const a = device(1);
    await serviceOf(a, over).push({ to: null });
    await serviceOf(a, over).pull({ from: null, dryRun: false });
    expect(rootCommitOf(a.root)).toMatch(/^[0-9a-f]{40}$/);
    expect(over.projectQueries).toEqual([rootCommitOf(a.root), rootCommitOf(a.root)]);
    const behind = hub();
    await serviceOf(a, behind).push({ to: null });
    expect(behind.projectQueries).toEqual([null]);
  });

  it('names hub.project over the repository\'s root commit', async () => {
    const over = hub();
    over.setProjects(served);
    const a = device(1);
    const service = serviceOf(a, over, { hub: { url: over.url, tokenSecret: TOKEN_SECRET, timeoutMs: TIMEOUT_MS, project: 'some-project' } });
    await service.push({ to: null });
    await service.pull({ from: null, dryRun: false });
    expect(over.projectQueries).toEqual(['some-project', 'some-project']);
    expect(over.projectQueries).not.toContain(rootCommitOf(a.root));
  });

  it('refuses push and pull in a repository with no commit and no hub.project, sending nothing, where hub.project lets it sync', async () => {
    const over = hub();
    over.setProjects(served);
    const a = uncommittedDevice();
    expect(originOf(a)).not.toBe('');
    expect(rootCommitOf(a.root)).toBe('');
    const refusal = `effort sync (service): the repository at ${a.root} has no root commit and hub.project is not set,`
      + ' so the hub could not tell which project its rows belong to. Nothing was sent.'
      + ' Next safe step: commit once in the repository, or set hub.project in .rafa/config.yaml';
    const pushing = await rejectionOf(serviceOf(a, over).push({ to: null }));
    const pulling = await rejectionOf(serviceOf(a, over).pull({ from: null, dryRun: false }));
    expect(pushing).toBeInstanceOf(ServiceSyncRefusal);
    expect(pushing.message).toBe(refusal);
    expect(pulling).toBeInstanceOf(ServiceSyncRefusal);
    expect(pulling.message).toBe(refusal);
    expect(refusal).not.toContain('\n');
    expect([over.requests, over.statusReads()]).toEqual([[], 0]);
    expect(existsSync(statePathOf(a))).toBe(false);
    const named = serviceOf(a, over, { hub: { url: over.url, tokenSecret: TOKEN_SECRET, timeoutMs: TIMEOUT_MS, project: 'some-project' } });
    expect(await named.push({ to: null })).toEqual({ status: 'pushed', path: null });
    expect(over.projectQueries).toEqual(['some-project']);
  });
});

describe('hubStatus', () => {
  const served = [{ id: 'some-project', name: 'some/project' }, { id: 'other-project', name: 'other/project' }];

  it('answers the contract, the project and its name and the hub\'s migrations, reading /v1/status once across hubStatus, push and pull', async () => {
    const over = hub();
    over.setProjects(served);
    const a = device(1);
    await serviceOf(a, over).push({ to: null });
    const held = stateOf(a);
    expect(Object.keys(held.stores)).toHaveLength(1);
    const before = over.statusReads();
    const named = { url: over.url, tokenSecret: TOKEN_SECRET, timeoutMs: TIMEOUT_MS, project: 'other-project' };
    const service = serviceOf(device(1), over, { hub: named });
    const answer = await service.hubStatus();
    expect(answer).toEqual({
      contractVersion: WIRE_CONTRACT_VERSION,
      projectId: 'other-project',
      projectName: 'other/project',
      migrations: exportWirePayload({ path: a.path }).migrations,
      maxPayloadRows: null,
    });
    expect(answer.migrations.length).toBeGreaterThan(0);
    expect(await service.push({ to: null })).toEqual({ status: 'pushed', path: null });
    expect((await service.pull({ from: null, dryRun: false })).status).toBe('pulled');
    expect(await service.hubStatus()).toEqual(answer);
    expect(over.statusReads() - before).toBe(1);
    expect(over.requests.map(({ path }) => path)).toEqual(['/v1/effort/push', '/v1/effort/push', '/v1/effort/pull']);
  });

  it('reads /v1/status again for a second strategy, so the count of one could have read two', async () => {
    const over = hub();
    const a = device(1);
    await serviceOf(a, over).hubStatus();
    await serviceOf(a, over).hubStatus();
    expect(over.statusReads()).toBe(2);
  });

  it('names the repository\'s root commit, with no name from a hub naming no projects', async () => {
    const over = hub();
    const a = device(1);
    expect(await serviceOf(a, over).hubStatus()).toEqual({
      contractVersion: WIRE_CONTRACT_VERSION,
      projectId: rootCommitOf(a.root),
      projectName: null,
      migrations: [],
      maxPayloadRows: null,
    });
  });

  it('answers a hub speaking another contract without refusing it, where push still refuses it', async () => {
    const over = contractFetch(WIRE_CONTRACT_VERSION + 1);
    const a = device(1);
    const service = serviceThrough(a, over);
    expect(await service.hubStatus()).toMatchObject({ contractVersion: WIRE_CONTRACT_VERSION + 1, projectName: null, migrations: [] });
    expect(await rejectionOf(service.push({ to: null }))).toBeInstanceOf(HubContractMismatch);
    expect(over.paths()).toEqual(['/v1/status']);
  });

  it('answers with no store there yet', async () => {
    const over = hub();
    const root = freshRoot();
    expect(await serviceOf(root, over).hubStatus()).toMatchObject({ contractVersion: WIRE_CONTRACT_VERSION, projectId: rootCommitOf(root) });
    expect(existsSync(openSqliteStore(root).path('commits'))).toBe(false);
  });

  it('refuses in a repository with no commit and no hub.project, reading no status, where hub.project lets it answer', async () => {
    const over = hub();
    over.setProjects(served);
    const a = uncommittedDevice();
    expect(await rejectionOf(serviceOf(a, over).hubStatus())).toBeInstanceOf(ServiceSyncRefusal);
    expect(over.statusReads()).toBe(0);
    const named = serviceOf(a, over, { hub: { url: over.url, tokenSecret: TOKEN_SECRET, timeoutMs: TIMEOUT_MS, project: 'some-project' } });
    expect(await named.hubStatus()).toMatchObject({ projectId: 'some-project', projectName: 'some/project' });
    expect(over.statusReads()).toBe(1);
  });

  it('passes an unreachable hub through as HubUnreachable', async () => {
    const over = hub();
    const a = device(1);
    const service = serviceOf(a, over);
    await over.stop();
    expect((await rejectionOf(service.hubStatus())).name).toBe('HubUnreachable');
  });
});

describe('a bounded push and a pull\'s page', () => {
  it('answers the hub\'s maxPayloadRows on hubStatus, null from a hub naming none', async () => {
    const over = hub();
    const a = device(1);
    expect((await serviceOf(a, over).hubStatus()).maxPayloadRows).toBeNull();
    over.setMaxPayloadRows(2);
    expect((await serviceOf(a, over).hubStatus()).maxPayloadRows).toBe(2);
  });

  it('sends at most limit rows a push, moving the push cursor past them, where a whole push to the capped hub is refused', async () => {
    const over = hub();
    over.setMaxPayloadRows(2);
    const a = device(3);
    const service = serviceOf(a, over);
    expect((await rejectionOf(service.push({ to: null }))).name).toBe('HubRefused');
    expect(await service.pendingPush()).toBe(3);
    expect(await service.push({ to: null, limit: 2 })).toEqual({ status: 'pushed', path: null });
    expect(stateOf(a).stores[originOf(a)]?.push.commits).toBe(2);
    expect(await service.pendingPush()).toBe(1);
    await service.push({ to: null, limit: 2 });
    expect(await service.pendingPush()).toBe(0);
    expect(over.requests.map(({ rows }) => rows)).toEqual([3, 2, 1]);
    expect(over.held('commits').map((row) => `${String(row['origin_store'])}:${String(row['origin_seq'])}`)).toEqual(commitPairs(a));
  });

  it('sends every row when the limit reaches them, and counts the cut on a dry run', async () => {
    const over = hub();
    const a = device(3);
    const service = serviceOf(a, over);
    expect(await service.push({ to: null, dryRun: true, limit: 2 })).toMatchObject({ dryRun: true, rows: 2 });
    expect(await service.push({ to: null, dryRun: true })).toMatchObject({ dryRun: true, rows: 3 });
    await service.push({ to: null, limit: 3 });
    expect(over.requests.map(({ rows }) => rows)).toEqual([3]);
    expect(await service.pendingPush()).toBe(0);
  });

  it.each([0, -1, 1.5])('refuses a push limit of %p before any contact', async (limit) => {
    const over = hub();
    const a = device(1);
    expect(await rejectionOf(serviceOf(a, over).push({ to: null, limit }))).toBeInstanceOf(TypeError);
    expect(over.requests).toEqual([]);
    expect(over.statusReads()).toBe(0);
  });

  it('answers each pulled page\'s rows, so a page reaching the cap is pulled again until every row is merged', async () => {
    const over = hub();
    over.setMaxPayloadRows(2);
    const a = device(3);
    const pusher = serviceOf(a, over);
    await pusher.push({ to: null, limit: 2 });
    await pusher.push({ to: null, limit: 2 });
    const b = device(1);
    const puller = serviceOf(b, over);
    const first = await puller.pull({ from: null, dryRun: false });
    expect(first).toMatchObject({ status: 'pulled', rows: 2, merge: { rowsAdded: 2 } });
    const second = await puller.pull({ from: null, dryRun: false });
    expect(second).toMatchObject({ status: 'pulled', rows: 1, merge: { rowsAdded: 1 } });
    expect(await puller.pull({ from: null, dryRun: false })).toEqual({ status: 'nothing-to-sync' });
    expect(commitPairs(b)).toEqual([...commitPairs(a), `${originOf(b)}:1`].sort());
  });
});
