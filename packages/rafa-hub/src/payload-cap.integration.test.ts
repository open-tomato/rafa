/**
 * The payload cap across the whole chain (#1429): a hub capped at
 * {@link CAP} by `dangerous.hub.maxPayloadRows` and a device holding
 * {@link CAP} plus one rows. `config-dangerous.test.ts`,
 * `server-effort.test.ts` and core's `contact-pages.test.ts` cover each
 * half over stand-ins; this file is the seam between the config key, the
 * hub's two routes, the contact's split push and paged pull, and the
 * `service` strategy's cursors.
 *
 * The hub is `runHub` (`bin.ts`) over a config file naming the key, so
 * the cap reaches the real SQLite connector the way an operator's does,
 * behind the repository-permission identity over a stand-in GitHub.
 * Each device is `bun src/rafa.ts` spawned as a real process over a
 * scratch git repository, as `two-devices.integration.test.ts` spawns
 * one and for the same reason: `Bun.spawn`, never `Bun.spawnSync`,
 * since the hub is a `Bun.serve` in this very process. The hub token
 * sits in a scratch secrets file named by `testdata/test-secrets.ts`,
 * never the system secret store.
 *
 * A device collects its rows, one per commit, under the default
 * `effort.sync`, which contacts no hub, and only then names the hub. So
 * the first device holds exactly {@link CAP} plus one rows, all waiting,
 * which the case reads off its own export before relying on it. How many
 * payloads and pages moved is read off the hub's `request` log lines,
 * one per request served.
 */
import type { StandInGitHub } from './identity/testdata/stand-in-github.js';
import type { HubLogEntry, HubServer } from './server.js';
import type { WirePayload } from '@open-tomato/rafa/store';

import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { encodeWirePayload, exportWirePayload, openSqliteStore, WIRE_CONTRACT_VERSION } from '@open-tomato/rafa/store';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { runHub } from './bin.js';
import { MAX_PAYLOAD_ROWS_KEY } from './config-dangerous.js';
import { HUB_CONFIG_ENV } from './config.js';
import { startStandInGitHub } from './identity/testdata/stand-in-github.js';
import { PAYLOAD_OVER_CAP_STATUS } from './server-effort.js';
import { HUB_ROUTES } from './server.js';
import { expectSameMergedTables, rowsOf } from './testdata/compare-merged-stores.js';
import { plantTestSecret, testSecretsChildEnv, testSecretsFileIn } from './testdata/test-secrets.js';

const REPOSITORY = 'open-tomato/rafa';
const WRITER = 'ghp_payload_cap_writer_0000001';

/** The hub's `dangerous.hub.maxPayloadRows`. */
const CAP = 3;

/** The rows the first device holds: one more than a payload may carry. */
const OVER_CAP = CAP + 1;

/** The origin of a device that pushes nothing, which the raw pull asks as. */
const ONLOOKER = 'cccccccc-0000-4000-8000-00000000000c';

/** The hub's store file, relative to its config file. */
const HUB_STORE = join('hub', 'rafa-hub.sqlite');

/** How long a spawned rafa command may take before it is killed. */
const RUN_TIMEOUT_MS = 30_000;

/** How long the whole case, four spawned commands, may take. */
const CASE_TIMEOUT_MS = 120_000;

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

/** One scratch device: its repository, a home of its own, and the secrets file holding the hub token. */
interface Device {
  readonly root: string;
  readonly home: string;
  readonly secretsFile: string;
}

/** A device's config while it contacts no hub: `effort.sync` at its default. */
const LOCAL_CONFIG = 'pr:\n  provider: none\n';

/** A device's config naming `effort.sync: service` over `hubUrl`, its token under `secretName`. */
function serviceConfig(hubUrl: string, secretName: string): string {
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

/** Writes `text` as `device`'s `.rafa/config.yaml`. */
function configure(device: Device, text: string): void {
  mkdirSync(join(device.root, '.rafa'), { recursive: true });
  writeFileSync(join(device.root, '.rafa', 'config.yaml'), text, 'utf8');
}

/**
 * A fresh git repository under `scope` named `name`, with `commits`
 * commits no other device holds, configured to contact no hub.
 */
function plantDevice(scope: string, name: string, commits: number): Device {
  const root = realpathSync(mkdtempSync(join(scope, `${name}-`)));
  const home = realpathSync(mkdtempSync(join(scope, `${name}-home-`)));

  git(root, 'init', '-q');
  writeFileSync(join(root, '.gitignore'), '.rafa/\n', 'utf8');
  git(root, 'add', '-A');
  const author = ['-c', `user.name=${name}`, '-c', `user.email=${name}@example.invalid`];
  for (let index = 1; index <= commits; index += 1) {
    const message = `${name} commit ${String(index)}`;
    git(root, ...author, 'commit', '-q', '--no-verify', '--allow-empty', '-m', message);
  }

  const device = { root, home, secretsFile: testSecretsFileIn(scope) };
  configure(device, LOCAL_CONFIG);
  return device;
}

/** What one rafa command answered: its exit code, and standard output and error together. */
interface Run {
  readonly exitCode: number | null;
  readonly output: string;
}

/** Spawns the real `rafa <words>` for `device`, against its own config. */
async function runRafa(device: Device, ...words: string[]): Promise<Run> {
  const child = Bun.spawn([process.execPath, RAFA_ENTRY, ...words], {
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
  return { exitCode, output: `${stdout}${stderr}` };
}

/** Collects `device`'s commits into its store, one row each. */
async function collect(device: Device): Promise<void> {
  const run = await runRafa(device, 'effort', 'collect', '--no-sessions');
  expect(run.exitCode, run.output).toBe(0);
}

/** Everything `device`'s store would push to a hub it has never contacted. */
function exported(device: Device): WirePayload {
  return exportWirePayload({ path: openSqliteStore(device.root).path('commits') });
}

/** The rows `payload` carries, across its tables. */
function rowsIn(payload: WirePayload): number {
  return Object.values(payload.tables).reduce((total, rows) => total + rows.length, 0);
}

/** The origin `device`'s store writes its commits under, which names it to the hub. */
function originOf(device: Device): string {
  const [row] = rowsOf(openSqliteStore(device.root).path('commits'), 'commits');
  const origin = row?.['origin_store'];
  if (typeof origin !== 'string') throw new Error(`the store of ${device.root} records no origin on its commits`);
  return origin;
}

/** The commit shas the store at `path` holds, sorted. */
function shasIn(path: string): string[] {
  return rowsOf(path, 'commits')
    .map((row) => String(row['sha']))
    .sort();
}

/** A port nothing listens on: `hub.port` refuses `0`, so the config names one found free. */
async function freePort(): Promise<number> {
  const probe = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: () => new Response() });
  const port = probe.port ?? 0;
  await probe.stop(true);
  return port;
}

describe('a hub capped by dangerous.hub.maxPayloadRows, and a device holding the cap plus one rows', () => {
  let scope = '';
  let github: StandInGitHub;
  let hub: HubServer;
  let logged: HubLogEntry[] = [];
  const secretName = `hub-token-${randomUUID()}`;

  beforeEach(async () => {
    scope = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-hub-payload-cap-')));
    github = startStandInGitHub({ [WRITER]: { login: 'writer', roles: { [REPOSITORY]: 'write' } } });
    logged = [];
    mkdirSync(join(scope, dirname(HUB_STORE)), { recursive: true });
    const config = join(scope, 'hub.yaml');
    writeFileSync(config, [
      'hub:',
      `  repository: ${REPOSITORY}`,
      `  port: ${String(await freePort())}`,
      `  storePath: ${HUB_STORE}`,
      '  index:',
      '    rebuildAfterPush: false',
      'dangerous:',
      '  hub:',
      `    maxPayloadRows: ${String(CAP)}`,
      '',
    ].join('\n'), 'utf8');
    const started = await runHub({ [HUB_CONFIG_ENV]: config }, {
      githubApi: github.url,
      hostname: '127.0.0.1',
      log: (entry) => {
        logged = [...logged, entry];
      },
    });
    if (started === null) throw new Error(`the hub refused its config: ${JSON.stringify(logged)}`);
    hub = started;
    plantTestSecret(scope, secretName, WRITER);
  });

  afterEach(async () => {
    await hub.stop();
    await github.stop();
    rmSync(scope, { recursive: true, force: true });
  });

  /** The hub's log lines for the requests served on `path` for `device`, in order. */
  const requests = (path: string, device: string): HubLogEntry[] => logged
    .filter((entry) => entry.event === 'request' && entry['path'] === path && entry['device'] === device);

  /** Sends `init` to `route` with `query`, under the writer's token. */
  const send = (route: string, query: Readonly<Record<string, string>>, init: RequestInit = {}): Promise<Response> => {
    const search = new URLSearchParams({ ...query, contractVersion: String(WIRE_CONTRACT_VERSION) });
    return fetch(`${hub.url}${route}?${search.toString()}`, { ...init, headers: { authorization: `Bearer ${WRITER}` } });
  };

  it('refuses a raw push one row over the cap, takes the contact\'s push in two payloads and answers a second device every row across pages', async () => {
    const first = plantDevice(scope, 'device-a', OVER_CAP);
    const second = plantDevice(scope, 'device-b', 1);
    await collect(first);
    await collect(second);
    const waiting = exported(first);
    expect(rowsIn(waiting)).toBe(OVER_CAP);
    const [origin, otherOrigin] = [originOf(first), originOf(second)];
    expect(logged.filter((entry) => entry.event === 'request')).toEqual([]);
    for (const device of [first, second]) configure(device, serviceConfig(hub.url, secretName));

    // The raw push: the device's whole export, with nothing splitting it.
    const refused = await send(HUB_ROUTES.push, { device: origin }, { method: 'POST', body: encodeWirePayload(waiting) });
    expect(refused.status).toBe(PAYLOAD_OVER_CAP_STATUS);
    const refusal = (await refused.json()) as { readonly success: boolean; readonly error: string };
    expect(refusal.success).toBe(false);
    expect(refusal.error).toContain(`${String(OVER_CAP)} rows`);
    expect(refusal.error).toContain(`${MAX_PAYLOAD_ROWS_KEY} of ${String(CAP)}`);
    const looked = await send(HUB_ROUTES.pull, { device: ONLOOKER });
    expect(looked.status).toBe(200);
    expect(rowsIn(((await looked.json()) as { readonly data: WirePayload }).data)).toBe(0);

    // The contact's push of the same rows: a payload of the cap, then the one row left.
    const pushed = await runRafa(first, 'effort', 'sync');
    expect(pushed.exitCode, pushed.output).toBe(0);
    expect(requests(HUB_ROUTES.push, origin).map((entry) => [entry['status'], entry['received'], entry['added']])).toEqual([
      [200, CAP, CAP],
      [200, 1, 1],
    ]);
    // A refused push's line names no device, so every push line is read: only the raw one was refused.
    const statuses = logged
      .filter((entry) => entry.event === 'request' && entry['path'] === HUB_ROUTES.push)
      .map((entry) => entry['status']);
    expect(statuses).toEqual([PAYLOAD_OVER_CAP_STATUS, 200, 200]);

    // The second device: its pull is repeated while the page came back full.
    const pulled = await runRafa(second, 'effort', 'sync');
    expect(pulled.exitCode, pulled.output).toBe(0);
    expect(pulled.output).toContain(`pulled ${String(OVER_CAP)} rows`);
    expect(requests(HUB_ROUTES.pull, otherOrigin).map((entry) => [entry['status'], entry['rows']])).toEqual([
      [200, CAP],
      [200, 1],
    ]);

    const firstPath = openSqliteStore(first.root).path('commits');
    const secondPath = openSqliteStore(second.root).path('commits');
    const hubPath = join(scope, HUB_STORE);
    expect(shasIn(secondPath)).toEqual(expect.arrayContaining(shasIn(firstPath)));
    expect(shasIn(secondPath)).toHaveLength(OVER_CAP + 1);
    expectSameMergedTables([secondPath, hubPath]);
  }, CASE_TIMEOUT_MS);

});
