/**
 * The #1431 acceptance case: one hub serves two projects, listed under
 * `hub.projects`, and two real devices, one per project, push and pull
 * through it without ever seeing or touching the other's rows.
 *
 * The hub is `runHub` (`bin.ts`) over a config file the case writes: two
 * projects, each named by the root commit sha of a scratch git repository
 * of its own, each with its own store file, under `hub.auth.adapter:
 * api-key` so no GitHub stand-in is needed. Each device is `bun
 * src/rafa.ts` (`RAFA_ENTRY`) spawned as a real process over its scratch
 * repository, exactly as `two-devices.integration.test.ts` spawns it, with
 * the hub token planted in a scratch secrets file
 * (`testdata/test-secrets.ts`) so no case touches the system secret store.
 * The device sends no `project` of its own setting: it reads its
 * repository's root commit, which is what the hub lists.
 *
 * Each device collects twice (push of its own row, then a pull). After
 * that every project's hub store file holds that project's commit row
 * alone, each device's store holds its own project's row alone, the
 * sha256 of a project's hub store file is the same after the other
 * project's push as before it, and `/v1/status` names both projects by
 * id and name.
 */
import type { HubServer } from './server.js';

import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { openSqliteStore } from '@open-tomato/rafa/store';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { runHub } from './bin.js';
import { HUB_CONFIG_ENV } from './config.js';
import { HUB_ROUTES } from './server.js';
import { rowsOf } from './testdata/compare-merged-stores.js';
import { plantTestSecret, testSecretsChildEnv, testSecretsFileIn } from './testdata/test-secrets.js';

/** The environment variable naming the hub's one API key. */
const KEY_VARIABLE = 'RAFA_HUB_TWO_PROJECTS_KEY';

/** The API key the hub accepts and each device presents as its token. */
const API_KEY = 'two-projects-api-key-0000000001';

/** How long a spawned `effort collect` may take before it is killed. */
const RUN_TIMEOUT_MS = 30_000;

/** How long the whole case, two projects with two runs each, may take. */
const CASE_TIMEOUT_MS = 120_000;

/** The real rafa CLI entry, spawned as a process; never imported. */
const RAFA_ENTRY = fileURLToPath(new URL('../../../src/rafa.ts', import.meta.url));

/** The real `rafa-sync-service` package, named by path in each device's `modules:`; never imported. */
const SYNC_SERVICE_PACKAGE = fileURLToPath(new URL('../../rafa-sync-service', import.meta.url));

/** The `name` the package's `package.json` carries, and `allowList:` must match. */
const SYNC_SERVICE_NAME = '@open-tomato/rafa-sync-service';

/** Each project's hub store file, under the hub's directory. */
const STORE_PATHS: Readonly<Record<string, string>> = Object.freeze({
  alpha: 'alpha/rafa-hub.sqlite',
  beta: 'beta/rafa-hub.sqlite',
});

/** The environment this process runs `git` fixture steps under: its own, with no `GIT_*` variable reaching it. */
function gitEnv(): Record<string, string> {
  return Object.fromEntries(Object.entries(process.env)
    .filter((entry): entry is [string, string] => !entry[0].startsWith('GIT_') && entry[1] !== undefined));
}

/** Runs `git` in `cwd` as a fixture step, answering its trimmed standard output and throwing what it said when it failed. */
function git(cwd: string, ...args: string[]): string {
  const ran = Bun.spawnSync(['git', ...args], { cwd, env: gitEnv() });
  if (ran.exitCode !== 0) throw new Error(`git ${args.join(' ')} in ${cwd} failed: ${ran.stderr.toString()}`);
  return ran.stdout.toString().trim();
}

const gitBinary = Bun.which('git');
if (gitBinary === null) throw new Error('git is not on the PATH this suite runs under');
const GIT_DIR = dirname(gitBinary);

/** One scratch device: its repository, the root commit naming its project, a home of its own and its name. */
interface Device {
  readonly name: string;
  readonly root: string;
  readonly home: string;
  /** The root commit sha of `root`, the project's id on the hub. */
  readonly project: string;
  /** The secrets file under the case's scope, holding the hub token. */
  readonly secretsFile: string;
}

/** A fresh git repository `name` under `scope` with one commit of its own, answering the device, its config not yet written. */
function plantRepository(scope: string, name: string): Device {
  const root = realpathSync(mkdtempSync(join(scope, `${name}-`)));
  const home = realpathSync(mkdtempSync(join(scope, `${name}-home-`)));

  git(root, 'init', '-q');
  writeFileSync(join(root, '.gitignore'), '.rafa/\n', 'utf8');
  writeFileSync(join(root, `${name}.txt`), `${name}'s own row ${randomUUID()}\n`, 'utf8');
  git(root, 'add', '-A');
  git(root, '-c', `user.name=${name}`, '-c', `user.email=${name}@example.invalid`, 'commit', '-q', '--no-verify', '-m', `${name} seed`);

  const project = git(root, 'rev-list', '--max-parents=0', 'HEAD');
  return { name, root, home, project, secretsFile: testSecretsFileIn(scope) };
}

/** Writes `device`'s `.rafa/config.yaml` naming `effort.sync: service` over `hubUrl`, its token under `secretName`. */
function writeDeviceConfig(device: Device, hubUrl: string, secretName: string): void {
  mkdirSync(join(device.root, '.rafa'), { recursive: true });
  writeFileSync(join(device.root, '.rafa', 'config.yaml'), [
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
}

/** What one `effort collect` run answered: its exit code, and standard output and error together. */
interface CollectRun {
  readonly exitCode: number | null;
  readonly output: string;
}

/**
 * Spawns the real `rafa effort collect --no-sessions` for `device`.
 * `Bun.spawn`, never `Bun.spawnSync`: the hub is a `Bun.serve` in this
 * very process, so a synchronous spawn would block the event loop it
 * needs to answer the child.
 */
async function runCollect(device: Device): Promise<CollectRun> {
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
  return { exitCode, output: `${stdout}${stderr}` };
}

/** A port nothing listens on right now. */
async function freePort(): Promise<number> {
  const probe = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: () => new Response() });
  const port = probe.port ?? 0;
  await probe.stop(true);
  return port;
}

/** The sha256 of the file at `path`, or null when it does not exist. */
function sha256Of(path: string): string | null {
  if (!existsSync(path)) return null;
  return createHash('sha256').update(readFileSync(path))
    .digest('hex');
}

/** The commit rows of the store file at `path` as JSON text, none when the file does not exist. */
function commitRowsAt(path: string): string[] {
  if (!existsSync(path)) return [];
  return rowsOf(path, 'commits').map((row) => JSON.stringify(row));
}

/** How many rows of `commits` the store file at `path` holds, 0 when it does not exist. */
function commitCountAt(path: string): number {
  return commitRowsAt(path).length;
}

describe('two projects served by one hub the test starts', () => {
  let scope = '';
  let hubDir = '';
  let hub: HubServer;
  let secretName = '';
  let alpha: Device;
  let beta: Device;

  beforeEach(async () => {
    scope = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-hub-two-projects-')));
    hubDir = realpathSync(mkdtempSync(join(scope, 'hub-')));
    alpha = plantRepository(scope, 'alpha');
    beta = plantRepository(scope, 'beta');
    for (const path of Object.values(STORE_PATHS)) mkdirSync(join(hubDir, dirname(path)), { recursive: true });

    const entries = [[alpha, STORE_PATHS['alpha']], [beta, STORE_PATHS['beta']]].map(([device, storePath]) => {
      const { name, project } = device as Device;
      return `    - id: ${project}\n      name: ${name}\n      repository: open-tomato/${name}\n      storePath: ${String(storePath)}\n`;
    });
    const configPath = join(hubDir, 'hub.yaml');
    writeFileSync(configPath, [
      'hub:',
      `  port: ${String(await freePort())}`,
      '  projects:',
      ...entries.map((entry) => entry.trimEnd()),
      '  auth:',
      '    adapter: api-key',
      '    apiKeys:',
      `      - ${KEY_VARIABLE}`,
      '',
    ].join('\n'), 'utf8');

    const started = await runHub({ [HUB_CONFIG_ENV]: configPath, [KEY_VARIABLE]: API_KEY }, { log: () => undefined });
    if (started === null) throw new Error('the hub refused its config');
    hub = started;

    secretName = `hub-token-${randomUUID()}`;
    plantTestSecret(scope, secretName, API_KEY);
    writeDeviceConfig(alpha, hub.url, secretName);
    writeDeviceConfig(beta, hub.url, secretName);
  });

  afterEach(async () => {
    await hub.stop();
    rmSync(scope, { recursive: true, force: true });
  });

  it('keeps each project\'s rows, hub store file and device store to that project alone', async () => {
    const alphaFile = join(hubDir, STORE_PATHS['alpha'] ?? '');
    const betaFile = join(hubDir, STORE_PATHS['beta'] ?? '');
    expect(alpha.project).not.toBe(beta.project);

    // Alpha pushes its own row, then pulls: the hub holds alpha's row and no file of beta's exists yet.
    const alphaPush = await runCollect(alpha);
    expect(alphaPush.exitCode).toBe(0);
    expect(alphaPush.output).toContain('+1 rows');
    expect(alphaPush.output).not.toContain('effort sync:');
    const alphaSha = sha256Of(alphaFile);
    expect(alphaSha).not.toBeNull();
    expect(commitCountAt(alphaFile)).toBe(1);
    expect(commitCountAt(betaFile)).toBe(0);

    // Beta pushes its own row, then pulls: alpha's store file is byte for byte what it was.
    const betaPush = await runCollect(beta);
    expect(betaPush.exitCode).toBe(0);
    expect(betaPush.output).toContain('+1 rows');
    expect(betaPush.output).not.toContain('effort sync:');
    expect(sha256Of(alphaFile)).toBe(alphaSha);
    expect(commitCountAt(betaFile)).toBe(1);

    // The second run of each device pulls: nothing of the other project comes in.
    const betaSha = sha256Of(betaFile);
    for (const device of [alpha, beta]) {
      const run = await runCollect(device);
      expect(run.exitCode).toBe(0);
      expect(run.output).toContain('+0 rows');
      expect(run.output).not.toContain('effort sync:');
    }
    expect(sha256Of(alphaFile)).toBe(alphaSha);
    expect(sha256Of(betaFile)).toBe(betaSha);

    // Each device's own store holds its own repository's commit alone, as the hub's file for it does.
    const alphaStore = openSqliteStore(alpha.root).path('commits');
    const betaStore = openSqliteStore(beta.root).path('commits');
    expect(commitCountAt(alphaStore)).toBe(1);
    expect(commitCountAt(betaStore)).toBe(1);
    expect(commitRowsAt(alphaStore).join()).not.toContain(git(beta.root, 'rev-parse', 'HEAD'));
    expect(commitRowsAt(betaStore).join()).not.toContain(git(alpha.root, 'rev-parse', 'HEAD'));
    expect(commitRowsAt(alphaFile).join()).toContain(git(alpha.root, 'rev-parse', 'HEAD'));
    expect(commitRowsAt(betaFile).join()).toContain(git(beta.root, 'rev-parse', 'HEAD'));
    expect(commitRowsAt(alphaFile).join()).not.toContain(git(beta.root, 'rev-parse', 'HEAD'));
    expect(commitRowsAt(betaFile).join()).not.toContain(git(alpha.root, 'rev-parse', 'HEAD'));
  }, CASE_TIMEOUT_MS);

  it('names both projects by id and name on /v1/status', async () => {
    const response = await fetch(`${hub.url}${HUB_ROUTES.status}`, { headers: { authorization: `Bearer ${API_KEY}` } });
    const body = (await response.json()) as { success: boolean; data: { projects: { id: string; name: string }[] } };

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.projects).toEqual([
      { id: alpha.project, name: 'alpha' },
      { id: beta.project, name: 'beta' },
    ]);
  });
});
