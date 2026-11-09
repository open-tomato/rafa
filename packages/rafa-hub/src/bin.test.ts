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
 * `rafa-hub index rebuild` runs over a store the `sqlite` connector made
 * under the case's root, seeded with one commit pushed from a real
 * export (`@open-tomato/rafa/store`), so the counts it prints are read
 * from rows rather than from an empty index.
 */
import type { HubLogEntry, HubServer } from './server.js';
import type { CommitEffortRow, WireRow } from '@open-tomato/rafa/store';

import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { exportWirePayload, openSqliteStore, WIRE_FORMAT, WIRE_VERSION } from '@open-tomato/rafa/store';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { hubCommandOf, HUB_VERSION, runHub, runIndexRebuild } from './bin.js';
import { HUB_CONFIG_ENV } from './config.js';
import { startStandInGitHub } from './identity/testdata/stand-in-github.js';
import { HUB_ROUTES } from './server.js';
import { connectSqliteHub } from './store/sqlite.js';

const BIN = join(import.meta.dir, 'bin.ts');
const REPOSITORY = 'open-tomato/rafa';
const WRITER = 'ghp_bin_writer_token_0000001';
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

describe('hubCommandOf', () => {
  it.each([
    [[], 'serve'],
    [['index', 'rebuild'], 'index-rebuild'],
    [['index'], null],
    [['rebuild', 'index'], null],
    [['index', 'rebuild', 'now'], null],
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
    expect(stderr).toBe('rafa-hub: index is not a command; usage: rafa-hub (serves the hub) or rafa-hub index rebuild\n');
  });
});
