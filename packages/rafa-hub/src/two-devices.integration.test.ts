/**
 * The #325 distributed-acceptance case: two scratch devices, each with
 * `effort.sync: service`, write a row apart and converge through one
 * hub the test starts, exactly as an operator's fleet would.
 *
 * The hub is the real SQLite store behind the real repository-permission
 * identity, served by the real hub server (`server.ts`,
 * `identity/github.ts`, `store/sqlite.ts`), over a stand-in GitHub
 * (`identity/testdata/stand-in-github.ts`) with `Bun.serve` on a free
 * port, exactly as `hub.integration.test.ts` starts it — this file adds
 * two real devices to that same hub.
 *
 * Each device is `bun src/rafa.ts` (`RAFA_ENTRY`) spawned as a real
 * process over a scratch git repository of its own, never dispatched
 * in-process: `effort.sync: service` is read from `.rafa/config.yaml`,
 * `modules:` names the real `packages/rafa-sync-service` package by its
 * filesystem path (never imported here, exactly as
 * `sync-service-package-integration.test.ts` names it for `loadModules`),
 * and `allowList:` trusts it. That package's `create` always reads the
 * hub token through `Bun.secrets` (`token.ts`'s `bunSecretReader`) with
 * no seam this acceptance test could override, so the suite stores a
 * real credential under service `rafa` before each case and removes it
 * after, skipping whole when this machine's `Bun.secrets` cannot be
 * reached at all (`SECRETS_OK`), rather than fail on a machine with no
 * secret-service backend. On Linux, `Bun.secrets` reaches the desktop
 * secret service over `DBUS_SESSION_BUS_ADDRESS`, which the child process
 * does not inherit unless it is named in its own environment, so
 * `secretsEnv()` carries it (and `XDG_RUNTIME_DIR`) from this process's
 * into the spawned CLI's.
 *
 * A device "writes a row apart" by committing a file of its own under a
 * fresh git repository, so `rafa effort collect --no-sessions` finds one
 * commit row no other device holds. Each device runs `effort collect`
 * twice, interleaved so the round converges (device A's own row, then
 * device B's own row and A's pulled in, then device A pulls B's in):
 * after that, every merged table — read straight off each SQLite file
 * with no row-count shortcut, through `testdata/compare-merged-stores.js`,
 * which `hub-unreachable.integration.test.ts` reads the same tables
 * through — holds the same rows on both devices and the hub. A third,
 * repeated round then changes nothing: every table's content, read
 * again, is identical to what it held right after convergence.
 */
import type { StandInGitHub } from './identity/testdata/stand-in-github.js';
import type { HubServer } from './server.js';

import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { openSqliteStore } from '@open-tomato/rafa/store';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { DEFAULT_STORE_FILE } from './config.js';
import { openGitHubIdentity } from './identity/github.js';
import { startStandInGitHub } from './identity/testdata/stand-in-github.js';
import { startHubServer } from './server.js';
import { openSqliteHubStore } from './store/sqlite.js';
import { expectSameMergedTables, mergedTableNames, sortedContent } from './testdata/compare-merged-stores.js';
import { scratchHomeEnv } from './testdata/scratch-home-env.js';

const VERSION = '0.0.0-two-devices';
const REPOSITORY = 'open-tomato/rafa';
const WRITER = 'ghp_two_devices_writer_0000001';

/** How long a spawned `effort collect` may take before it is killed. */
const RUN_TIMEOUT_MS = 30_000;

/** How long the whole convergence, three rounds of two devices, may take. */
const CASE_TIMEOUT_MS = 120_000;

/** Where every rafa secret lives (`packages/rafa-sync-service/src/token.ts`'s `SECRET_SERVICE`). */
const SECRET_SERVICE = 'rafa';

/** The real rafa CLI entry, spawned as a process; never imported. */
const RAFA_ENTRY = fileURLToPath(new URL('../../../src/rafa.ts', import.meta.url));

/** The real `rafa-sync-service` package, named by path in each device's `modules:`; never imported. */
const SYNC_SERVICE_PACKAGE = fileURLToPath(new URL('../../rafa-sync-service', import.meta.url));

/** The `name` the package's `package.json` carries, and `allowList:` must match. */
const SYNC_SERVICE_NAME = '@open-tomato/rafa-sync-service';

/** The environment variables a libsecret-backed `Bun.secrets` reaches its session bus through; carried into the spawned CLI only when this process itself has them. */
const SECRET_BUS_ENV = ['DBUS_SESSION_BUS_ADDRESS', 'XDG_RUNTIME_DIR'] as const;

/** The reason this suite skips, when it does. */
const SKIP_REASON = 'Bun.secrets could not store and read a credential on this machine';

/** Whether `Bun.secrets` can round-trip a credential here, probed once at load. */
async function probeSecrets(): Promise<boolean> {
  const probe = { service: SECRET_SERVICE, name: `two-devices-probe-${randomUUID()}` };
  try {
    await Bun.secrets.set({ ...probe, value: 'probe' });
    await Bun.secrets.delete(probe);
    return true;
  } catch {
    return false;
  }
}

const SECRETS_OK = await probeSecrets();

/** `DBUS_SESSION_BUS_ADDRESS` and `XDG_RUNTIME_DIR`, carried from this process's own environment when it has them. */
function secretsEnv(): Readonly<Record<string, string>> {
  return Object.fromEntries(SECRET_BUS_ENV
    .map((name): readonly [string, string | undefined] => [name, process.env[name]])
    .filter((entry): entry is readonly [string, string] => entry[1] !== undefined));
}

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

/** One scratch device: its repository, a home of its own, and its name. */
interface Device {
  readonly name: string;
  readonly root: string;
  readonly home: string;
}

/** A device's config naming `effort.sync: service` over `hubUrl`, its token under `secretName`. */
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
 * A fresh git repository under `scope` named `name`, with a git identity
 * of its own and one commit over a file no other device holds — the row
 * `name` writes apart — then `.rafa/config.yaml` naming `hubUrl` and
 * `secretName`.
 */
function plantDevice(scope: string, name: string, hubUrl: string, secretName: string): Device {
  const root = realpathSync(mkdtempSync(join(scope, `${name}-`)));
  const home = realpathSync(mkdtempSync(join(scope, `${name}-home-`)));

  git(root, 'init', '-q');
  writeFileSync(join(root, '.gitignore'), '.rafa/\n', 'utf8');
  writeFileSync(join(root, `${name}.txt`), `${name}'s own row\n`, 'utf8');
  git(root, 'add', '-A');
  git(root, '-c', `user.name=${name}`, '-c', `user.email=${name}@example.invalid`, 'commit', '-q', '--no-verify', '-m', `${name} seed`);

  mkdirSync(join(root, '.rafa'), { recursive: true });
  writeFileSync(join(root, '.rafa', 'config.yaml'), deviceConfig(hubUrl, secretName), 'utf8');
  return { name, root, home };
}

/** What one `effort collect` run answered: its exit code, and standard output and error together. */
interface CollectRun {
  readonly exitCode: number | null;
  readonly output: string;
}

const gitBinary = Bun.which('git');
if (gitBinary === null) throw new Error('git is not on the PATH this suite runs under');
const GIT_DIR = dirname(gitBinary);

/**
 * Spawns the real `rafa effort collect --no-sessions` for `device`,
 * against its own configured hub. `Bun.spawn`, never `Bun.spawnSync`:
 * the hub this file starts is a `Bun.serve` in this very process, so a
 * synchronous spawn would block the event loop its `fetch` callback
 * needs to answer the child's push and pull, each waiting on the other.
 */
async function runCollect(device: Device): Promise<CollectRun> {
  const child = Bun.spawn([process.execPath, RAFA_ENTRY, 'effort', 'collect', '--no-sessions'], {
    cwd: device.root,
    env: {
      RAFA_TEST: '1',
      TMPDIR: tmpdir(),
      PATH: GIT_DIR,
      ...scratchHomeEnv(device.home),
      ...secretsEnv(),
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
}

describe.skipIf(!SECRETS_OK)(`two devices converge through a hub the test starts (skipped when: ${SKIP_REASON})`, () => {
  let scope = '';
  let hubDir = '';
  let github: StandInGitHub;
  let hub: HubServer;
  let secretName = '';

  beforeEach(async () => {
    scope = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-hub-two-devices-')));
    hubDir = realpathSync(mkdtempSync(join(scope, 'hub-')));
    github = startStandInGitHub({ [WRITER]: { login: 'writer', roles: { [REPOSITORY]: 'write' } } });
    hub = startHubServer({
      port: 0,
      hostname: '127.0.0.1',
      version: VERSION,
      identity: openGitHubIdentity({ repository: REPOSITORY, cacheForMs: null, apiBase: github.url }),
      openStore: () => openSqliteHubStore({ directory: hubDir, now: () => new Date() }),
    });
    secretName = `hub-token-${randomUUID()}`;
    await Bun.secrets.set({ service: SECRET_SERVICE, name: secretName, value: WRITER });
  });

  afterEach(async () => {
    await Bun.secrets.delete({ service: SECRET_SERVICE, name: secretName });
    await hub.stop();
    await github.stop();
    rmSync(scope, { recursive: true, force: true });
  });

  it('holds every merged table identical on both devices and the hub, and a repeated sync changes nothing', async () => {
    const a = plantDevice(scope, 'device-a', hub.url, secretName);
    const b = plantDevice(scope, 'device-b', hub.url, secretName);

    // Round 1: each device pushes its own row; neither has pulled the other's yet.
    for (const device of [a, b]) {
      const run = await runCollect(device);
      expect(run.exitCode).toBe(0);
      expect(run.output).toContain('+1 rows');
      expect(run.output).not.toContain('effort sync:');
    }

    // Round 2, "each runs rafa effort collect twice": device A's second run pulls B's
    // row in, and device B's second run finds nothing left to pull. The two rounds
    // together converge all three stores.
    for (const device of [a, b]) {
      const run = await runCollect(device);
      expect(run.exitCode).toBe(0);
      expect(run.output).toContain('+0 rows');
      expect(run.output).not.toContain('effort sync:');
    }

    const aPath = openSqliteStore(a.root).path('commits');
    const bPath = openSqliteStore(b.root).path('commits');
    const hubPath = join(hubDir, DEFAULT_STORE_FILE);
    expectSameMergedTables([aPath, bPath, hubPath]);

    const beforeRepeat = mergedTableNames(hubPath).map((table) => sortedContent(hubPath, table));

    // A repeated sync: neither device wrote a new row, so pushing and pulling again moves nothing.
    for (const device of [a, b]) {
      const run = await runCollect(device);
      expect(run.exitCode).toBe(0);
      expect(run.output).toContain('+0 rows');
      expect(run.output).not.toContain('effort sync:');
    }

    expectSameMergedTables([aPath, bPath, hubPath]);
    expect(mergedTableNames(hubPath).map((table) => sortedContent(hubPath, table))).toEqual(beforeRepeat);
  }, CASE_TIMEOUT_MS);
});
