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

import { openSqliteStore } from '@open-tomato/rafa/store';
import { Database } from 'bun:sqlite';
import { afterAll, afterEach, describe, expect, it } from 'bun:test';

import { SYNC_STATE_FILE_NAME } from './state.js';
import create, { createServiceSync, MOVE_TO_SQLITE, RafaUpdateRequired, SELF_UPDATE, ServiceSyncRefusal } from './sync.js';
import { startStandInHub } from './testdata/stand-in-hub.js';

const TOKEN = 'ghp_service_sync_test_token';
const TOKEN_SECRET = 'hub-token';

/** A migration id no rafa build has, as a hub a newer rafa brought forward names. */
const FUTURE_MIGRATION = '9999-from-a-newer-rafa';

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
function stateOf(at: Device): { stores: Record<string, { hub: string; push: Record<string, number>; pull: Record<string, number> }> } {
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
    expect(over.requests).toEqual([{ method: 'POST', path: '/v1/effort/push', device: originOf(a), since: null, authorization: `Bearer ${TOKEN}`, rows: 2 }]);
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
      `effort sync (service): the hub's store has applied migration ${FUTURE_MIGRATION}, which this rafa does not know,`
        + ` so its rows cannot be merged here. Nothing was merged. Next step: ${SELF_UPDATE}, then sync again.`,
    );
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

  it('rejects with the token reader\'s refusal before any contact when no token is stored', async () => {
    const over = hub();
    const refused = await rejectionOf(serviceOf(device(1), over, { readSecret: async () => null }).push({ to: null }));
    expect(refused.name).toBe('HubTokenError');
    expect(refused.message).toContain(`no hub token is stored under service "rafa", name "${TOKEN_SECRET}"`);
    expect(over.requests).toEqual([]);
  });
});
