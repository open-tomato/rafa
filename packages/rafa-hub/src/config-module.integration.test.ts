/**
 * The hub's `.ts` config over the real command: `bin.ts` run as the
 * image's `rafa-hub` runs it, serving from a `rafa-hub.config.ts` and asked
 * by `rafa-hub health` in a second process (#1659). `config-file.test.ts`
 * and `cli-health.test.ts` cover the loader and the command in process; this
 * file is the seam between them, in processes that run no preload and load
 * the config as an operator's hub does.
 *
 * Each case writes its config under a temporary root with no `node_modules`
 * above it, so no package resolves from the file's directory, the hub's own
 * included. The starting case imports `HubConfigFile` from that package as a
 * type alone and serves, since the import is erased before the file runs.
 * The refused cases import a value, from that same package and from another,
 * and each is refused naming the specifier.
 *
 * Bun asks a registry for a package it cannot find from a directory with no
 * `node_modules` above it. Every command's registry is therefore a stand-in
 * in this process that answers `404`, beside a scratch `HOME` and install
 * cache, so nothing leaves the machine and nothing cached answers. The
 * stand-in is also why the commands run through `Bun.spawn`, never
 * `Bun.spawnSync`, which would block the process that has to answer them.
 *
 * `hub.port` refuses `0`, so each config names a port the system handed a
 * probe server a moment before, which is never the default.
 */
import type { HubLogEntry } from './server.js';
import type { Server, Subprocess } from 'bun';

import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { HUB_CONFIG_ENV } from './config.js';
import { scratchHomeEnv } from './testdata/scratch-home-env.js';

const BIN = join(import.meta.dir, 'bin.ts');
const REPOSITORY = 'open-tomato/rafa';
const CONFIG_FILE = 'rafa-hub.config.ts';
const STORE_FILE = 'rafa-hub.sqlite';

/** The port a config naming none listens on. */
const DEFAULT_PORT = 7373;

/** How long one spawned command may run before it is killed, so a hub that never answers ends its case. */
const COMMAND_TIMEOUT_MS = 30_000;

/** How long a case may take: at most one serving hub and a few commands. */
const CASE_TIMEOUT_MS = 90_000;

let root = '';
let registry: Server<undefined> | null = null;
let spawned: Subprocess[] = [];

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-hub-config-module-')));
  mkdirSync(join(root, 'etc'));
  mkdirSync(join(root, 'home'));
  registry = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: () => new Response('{}', { status: 404 }) });
});

afterEach(async () => {
  for (const child of spawned.splice(0)) {
    child.kill('SIGKILL');
    await child.exited;
  }
  await registry?.stop(true);
  registry = null;
  rmSync(root, { recursive: true, force: true });
});

/** The case's config file, in the one directory the hub reads and writes. */
function configPath(): string {
  return join(root, 'etc', CONFIG_FILE);
}

/** A port the system just handed out on every interface, as the command listens, free again. */
async function freePort(): Promise<number> {
  const probe = Bun.serve({ port: 0, hostname: '0.0.0.0', fetch: () => new Response() });
  const { port } = probe;
  await probe.stop(true);
  if (port === undefined) throw new Error('the probe server has no port');
  return port;
}

/** Writes the case's config: `importing`, its one import line, then the `hub` section holding `port`, an expression. */
function writeConfig(importing: string, port: string, satisfies = ''): void {
  writeFileSync(configPath(), [
    importing,
    '',
    'export default {',
    `  hub: { repository: '${REPOSITORY}', port: ${port} },`,
    `}${satisfies};`,
    '',
  ].join('\n'));
}

/** Spawns `rafa-hub` with `args` over the case's config, with nothing of this process's environment but its `PATH`. */
function rafaHub(args: readonly string[]) {
  const child = Bun.spawn([process.execPath, BIN, ...args], {
    cwd: root,
    env: {
      PATH: process.env['PATH'] ?? '',
      ...scratchHomeEnv(join(root, 'home')),
      BUN_CONFIG_REGISTRY: String(registry?.url),
      [HUB_CONFIG_ENV]: configPath(),
    },
    stdout: 'pipe',
    stderr: 'pipe',
    timeout: COMMAND_TIMEOUT_MS,
  });
  spawned = [...spawned, child];
  return child;
}

/** What one finished command answered. */
interface Ran {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** Runs `rafa-hub` with `args` to its end. */
async function run(args: readonly string[]): Promise<Ran> {
  const child = rafaHub(args);
  const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  return { code, stdout, stderr };
}

/** The log entries of `text`, one per JSON line. */
function entriesOf(text: string): readonly HubLogEntry[] {
  return text
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => JSON.parse(line) as HubLogEntry);
}

/** A serving hub: the lines it logged up to its open store, and the stop that signals it. */
interface Serving {
  readonly logged: readonly HubLogEntry[];
  /** Sends `SIGTERM`, as `docker stop` does, and answers the exit code and standard error. */
  readonly stop: () => Promise<Omit<Ran, 'stdout'>>;
}

/**
 * Starts `rafa-hub` over the case's config and reads its log until the
 * `store.opened` line, from which `/health` answers `200`. A hub that ends
 * before that line fails the case with everything it printed.
 */
async function serve(): Promise<Serving> {
  const child = rafaHub([]);
  const stderr = new Response(child.stderr).text();
  const reader = child.stdout.getReader();
  const decoder = new TextDecoder();
  let text = '';
  while (!text.includes('"event":"store.opened"') || !text.endsWith('\n')) {
    const { done, value } = await reader.read();
    if (done) throw new Error(`the hub ended before its store opened, exit ${String(await child.exited)}:\n${text}${await stderr}`);
    text += decoder.decode(value, { stream: true });
  }
  return {
    logged: entriesOf(text),
    stop: async () => {
      child.kill('SIGTERM');
      // Drained so the hub's last lines have somewhere to go.
      while (!(await reader.read()).done);
      return { code: await child.exited, stderr: await stderr };
    },
  };
}

describe('rafa-hub over a rafa-hub.config.ts', () => {
  it('serves on the file\'s own port from a type-only import of HubConfigFile, and passes rafa-hub health', async () => {
    const port = await freePort();
    writeConfig('import type { HubConfigFile } from \'@open-tomato/rafa-hub\';', String(port), ' satisfies HubConfigFile');
    const url = `http://127.0.0.1:${String(port)}/health`;
    const before = await run(['health']);

    const hub = await serve();
    const healthy = await run(['health']);
    const stopped = await hub.stop();

    expect(port).not.toBe(DEFAULT_PORT);
    expect(before.code).toBe(1);
    expect(before.stderr).toStartWith(`rafa-hub health: the hub at ${url} was not reached: `);
    expect(hub.logged).toContainEqual(expect.objectContaining({ event: 'listening', port }));
    // The one warning of a start with no install record: none for YAML, and no refusal.
    expect(hub.logged.filter((entry) => entry.level !== 'info').map((entry) => entry.event)).toEqual(['install.missing']);
    expect(healthy).toEqual({ code: 0, stdout: '', stderr: '' });
    expect(stopped).toEqual({ code: 0, stderr: '' });
  }, CASE_TIMEOUT_MS);

  it.each([
    {
      specifier: '@open-tomato/rafa-hub',
      importing: 'import { defaultPort } from \'@open-tomato/rafa-hub\';',
      advice: '; the hub resolves it from this file\'s directory up, so install @open-tomato/rafa-hub there (bun add @open-tomato/rafa-hub), '
        + 'or import its types alone (import type { HubConfigFile } from \'@open-tomato/rafa-hub\'), which need nothing at run time',
    },
    {
      specifier: '@rafa-hub-fixture/ports/default',
      importing: 'import { defaultPort } from \'@rafa-hub-fixture/ports/default\';',
      advice: '; the hub resolves it from this file\'s directory up, so install @rafa-hub-fixture/ports there (bun add @rafa-hub-fixture/ports)',
    },
    {
      specifier: './ports.ts',
      importing: 'import { defaultPort } from \'./ports.ts\';',
      advice: '',
    },
  ])('refuses a value import of $specifier that does not resolve, in the start and in health, naming it', async ({ specifier, importing, advice }) => {
    writeConfig(importing, 'defaultPort');
    const problem = `${configPath()}: imports ${specifier}, which cannot be found from this file${advice}`;

    const start = await run([]);
    const health = await run(['health']);

    expect({ code: start.code, stderr: start.stderr }).toEqual({ code: 1, stderr: '' });
    expect(entriesOf(start.stdout)).toEqual([expect.objectContaining({ level: 'error', event: 'config.refused', problems: [problem] })]);
    expect(health).toEqual({ code: 1, stdout: '', stderr: `rafa-hub health: the config was refused: ${problem}\n` });
    expect(existsSync(join(root, 'etc', STORE_FILE))).toBe(false);
  }, CASE_TIMEOUT_MS);
});
