/**
 * The wire contract version across the whole chain: the real `service`
 * strategy (`packages/rafa-sync-service`) and the real hub contact
 * (`packages/rafa-effort/src/effort/sync/contact.ts`), reached through a
 * real `rafa effort collect`, against the real hub server (`server.ts`)
 * over the real SQLite store, whose `contract()` is made to answer the
 * version the case names. `sync.test.ts` and `contact.test.ts` cover
 * each half over stand-ins; this file is the seam between them and the
 * hub's own `GET /v1/status`, reached only over HTTP.
 *
 * Two cases, one hub each, told apart by what the store's `contract()`
 * answers:
 *
 *   - **A hub ahead (`contractVersion: 2`).** The device reads the status
 *     once, refuses before it exports or sends anything, and so the push
 *     and pull routes are never called and the hub's store holds no row.
 *     The command writes the one mismatch line, naming `rafa self-update`,
 *     skips the pull after the refused push, and exits as it would have:
 *     with the code the control run below gives.
 *   - **A hub on this rafa's version (`contractVersion: 1`, the control).**
 *     The same command, device and config read the status once, push once
 *     and pull once, write no `effort sync:` line, and the hub holds the
 *     device's row: rows sync as they do without a contract check.
 *
 * Routes are counted off the hub's own `request` log lines (`log:`), one
 * per request the server answered, by path and status, so a route "never
 * called" is a path with no line, not a stub that was not reached.
 *
 * The device is `bun src/rafa.ts` spawned as a real process, never
 * dispatched in-process, exactly as `two-devices.integration.test.ts`
 * spawns one and for the same reason: `Bun.spawn`, never
 * `Bun.spawnSync`, since the hub is a `Bun.serve` in this very process.
 * The hub token sits in a scratch secrets file named by
 * `testdata/test-secrets.ts`, never the system secret store.
 */
import type { HubLogEntry, HubServer } from './server.js';

import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { openSqliteStore } from '@open-tomato/rafa/store';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { DEFAULT_STORE_FILE } from './config.js';
import { HUB_ACTIONS } from './identity/port.js';
import { openMemoryIdentity } from './identity/testdata/memory-identity.js';
import { HUB_ROUTES, startHubServer } from './server.js';
import { openSqliteHubStore } from './store/sqlite.js';
import { expectSameMergedTables, mergedTableNames, rowsOf } from './testdata/compare-merged-stores.js';
import { plantTestSecret, testSecretsChildEnv, testSecretsFileIn } from './testdata/test-secrets.js';

const VERSION = '0.0.0-contract-skew';
const TOKEN = 'memory-contract-skew-token-01';

/** The contract version this rafa speaks, as the control hub answers. */
const RAFA_CONTRACT = 1;

/** A contract version ahead of this rafa's, as a newer hub answers. */
const HUB_AHEAD_CONTRACT = 2;

/** How long a spawned `effort collect` may take before it is killed. */
const RUN_TIMEOUT_MS = 30_000;

/** How long one case may take. */
const CASE_TIMEOUT_MS = 60_000;

/** The real rafa CLI entry, spawned as a process; never imported. */
const RAFA_ENTRY = fileURLToPath(new URL('../../../src/rafa.ts', import.meta.url));

/** The real `rafa-sync-service` package, named by path in the device's `modules:`; never imported. */
const SYNC_SERVICE_PACKAGE = fileURLToPath(new URL('../../rafa-sync-service', import.meta.url));

/** The `name` the package's `package.json` carries, and `allowList:` must match. */
const SYNC_SERVICE_NAME = '@open-tomato/rafa-sync-service';

/** The line a device writes for a hub ahead of it, whole. */
const MISMATCH_LINE = `effort sync: the hub speaks contract ${String(HUB_AHEAD_CONTRACT)}, this rafa contract ${String(RAFA_CONTRACT)};`
  + ' nothing was sent. Next step: rafa self-update';

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

/** What one `effort collect` run answered: its exit code, and standard output and error together. */
interface CollectRun {
  readonly exitCode: number | null;
  readonly output: string;
}

/** How many `request` lines the hub logged for `path`, by status. */
function requestsTo(log: readonly HubLogEntry[], path: string): number[] {
  return log
    .filter((entry) => entry.event === 'request' && entry['path'] === path)
    .map((entry) => entry['status'] as number);
}

/** The lines of `output` that carry a sync warning, with the command's own `warn: ` prefix taken off. */
function syncLines(output: string): string[] {
  return output.split('\n')
    .map((line) => line.replace(/^warn: /, ''))
    .filter((line) => line.startsWith('effort sync:'));
}

describe('the service strategy and the hub contact against a real hub speaking a contract version', () => {
  let scope = '';
  let hubDir = '';
  let secretName = '';
  let hub: HubServer | undefined;
  let log: HubLogEntry[] = [];

  /** Starts the real hub over the real SQLite store, whose `contract()` answers `contractVersion`. */
  const startHub = (contractVersion: number): HubServer => {
    log = [];
    const server = startHubServer({
      port: 0,
      hostname: '127.0.0.1',
      version: VERSION,
      identity: openMemoryIdentity({ [TOKEN]: { id: 'skew-writer', may: HUB_ACTIONS } }),
      openStore: async () => {
        const store = await openSqliteHubStore({ directory: hubDir, now: () => new Date() });
        return { ...store, contract: () => ({ ...store.contract(), contractVersion }) };
      },
      log: (entry) => {
        log = [...log, entry];
      },
    });
    hub = server;
    return server;
  };

  /** A git repository of its own with one commit, the row the device writes, naming `hubUrl` as its `service` hub. */
  const plantDevice = (hubUrl: string): string => {
    const root = realpathSync(mkdtempSync(join(scope, 'device-')));
    git(root, 'init', '-q');
    writeFileSync(join(root, '.gitignore'), '.rafa/\n', 'utf8');
    writeFileSync(join(root, 'device.txt'), 'the device\'s own row\n', 'utf8');
    git(root, 'add', '-A');
    git(root, '-c', 'user.name=device', '-c', 'user.email=device@example.invalid', 'commit', '-q', '--no-verify', '-m', 'seed');
    mkdirSync(join(root, '.rafa'), { recursive: true });
    writeFileSync(join(root, '.rafa', 'config.yaml'), [
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
    ].join('\n'), 'utf8');
    return root;
  };

  /** Spawns the real `rafa effort collect --no-sessions` in `root`. */
  const runCollect = async (root: string): Promise<CollectRun> => {
    const home = realpathSync(mkdtempSync(join(scope, 'home-')));
    const child = Bun.spawn([process.execPath, RAFA_ENTRY, 'effort', 'collect', '--no-sessions'], {
      cwd: root,
      env: {
        TMPDIR: tmpdir(),
        RAFA_TEST: '1',
        PATH: GIT_DIR,
        ...testSecretsChildEnv(home, testSecretsFileIn(scope)),
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
    return { exitCode, output: `${stdout}${stderr}` };
  };

  beforeEach(() => {
    scope = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-hub-contract-skew-')));
    hubDir = realpathSync(mkdtempSync(join(scope, 'hub-')));
    secretName = `hub-token-${randomUUID()}`;
    plantTestSecret(scope, secretName, TOKEN);
  });

  afterEach(async () => {
    await hub?.stop();
    hub = undefined;
    rmSync(scope, { recursive: true, force: true });
  });

  it('syncs rows as before against a hub on this rafa\'s contract version', async () => {
    const server = startHub(RAFA_CONTRACT);
    const root = plantDevice(server.url);

    const run = await runCollect(root);

    expect(run.exitCode).toBe(0);
    expect(run.output).toContain('+1 rows');
    expect(syncLines(run.output)).toEqual([]);
    expect(requestsTo(log, HUB_ROUTES.status)).toEqual([200]);
    expect(requestsTo(log, HUB_ROUTES.push)).toEqual([200]);
    expect(requestsTo(log, HUB_ROUTES.pull)).toEqual([200]);
    const hubPath = join(hubDir, DEFAULT_STORE_FILE);
    expect(mergedTableNames(hubPath).some((table) => rowsOf(hubPath, table).length > 0)).toBe(true);
    expectSameMergedTables([openSqliteStore(root).path('commits'), hubPath]);
  }, CASE_TIMEOUT_MS);

  it('writes the one mismatch line and sends nothing to a hub ahead of this rafa, the exit code the command\'s own', async () => {
    const control = startHub(RAFA_CONTRACT);
    const controlRun = await runCollect(plantDevice(control.url));
    await control.stop();
    rmSync(hubDir, { recursive: true, force: true });
    mkdirSync(hubDir);

    const server = startHub(HUB_AHEAD_CONTRACT);
    const root = plantDevice(server.url);

    const run = await runCollect(root);

    expect(run.exitCode).toBe(controlRun.exitCode);
    expect(run.exitCode).toBe(0);
    expect(syncLines(run.output)).toEqual([MISMATCH_LINE]);
    expect(requestsTo(log, HUB_ROUTES.status)).toEqual([200]);
    expect(requestsTo(log, HUB_ROUTES.push)).toEqual([]);
    expect(requestsTo(log, HUB_ROUTES.pull)).toEqual([]);
    const hubPath = join(hubDir, DEFAULT_STORE_FILE);
    expect(mergedTableNames(hubPath).flatMap((table) => rowsOf(hubPath, table))).toEqual([]);
  }, CASE_TIMEOUT_MS);
});
