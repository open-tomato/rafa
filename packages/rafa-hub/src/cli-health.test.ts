/**
 * Unit tests for `rafa-hub health` (`cli-health.ts`): the config read
 * through `readHubConfig` in both forms, the URL asked of a `Bun.serve`
 * stand-in on a free port, the exit code for `200` and for every other
 * answer, and the one line each failure prints. Every case writes its
 * config under its own temporary directory; no real hub or store runs.
 */
import type { Server } from 'bun';

import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { healthUrl, isHealthCommand, runHealth } from './cli-health.js';
import { HUB_CONFIG_ENV } from './config.js';

const REPOSITORY = 'open-tomato/rafa';

let root = '';
let standIn: Server<undefined> | null = null;
let asked: string[] = [];

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-hub-health-')));
  asked = [];
});

afterEach(async () => {
  await standIn?.stop(true);
  standIn = null;
  rmSync(root, { recursive: true, force: true });
});

/** Starts the stand-in hub on a free port of `127.0.0.1`, answering each request with `answer`; answers its port. */
function serveStandIn(answer: () => Response | Promise<Response>): number {
  standIn = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    fetch: (request) => {
      asked.push(request.url);
      return answer();
    },
  });
  if (standIn.port === undefined) throw new Error('the stand-in hub has no port');
  return standIn.port;
}

/** A port nothing listens on: one the system handed a server that is stopped again. */
async function closedPort(): Promise<number> {
  const server = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: () => new Response('') });
  const { port } = server;
  await server.stop(true);
  if (port === undefined) throw new Error('the probe server has no port');
  return port;
}

/** Writes a `rafa-hub.yaml` naming `port`; answers the environment naming it. */
function yamlEnv(port: number): Record<string, string> {
  const path = join(root, 'rafa-hub.yaml');
  writeFileSync(path, `hub:\n  repository: ${REPOSITORY}\n  port: ${String(port)}\n`);
  return { [HUB_CONFIG_ENV]: path };
}

/** Writes a `rafa-hub.config.ts` naming `port`; answers the environment naming it. */
function moduleEnv(port: number): Record<string, string> {
  const path = join(root, 'rafa-hub.config.ts');
  writeFileSync(path, `export default { hub: { repository: '${REPOSITORY}', port: ${String(port)} } };\n`);
  return { [HUB_CONFIG_ENV]: path };
}

/** One run's exit code and the lines it printed on standard error. */
interface Ran {
  readonly code: number;
  readonly err: readonly string[];
}

/** Runs `rafa-hub health` over `env`, collecting its lines. */
async function health(env: Readonly<Record<string, string | undefined>>, timeoutMs?: number): Promise<Ran> {
  const err: string[] = [];
  const options = timeoutMs === undefined
    ? { err: (line: string) => err.push(line) }
    : { err: (line: string) => err.push(line), timeoutMs };
  const code = await runHealth(env, options);
  return { code, err };
}

describe('isHealthCommand', () => {
  it('takes no arguments past health', () => {
    expect(isHealthCommand([])).toBe(true);
    expect(isHealthCommand(['now'])).toBe(false);
    expect(isHealthCommand(['--port=7373'])).toBe(false);
  });
});

describe('healthUrl', () => {
  it('asks /health on 127.0.0.1 at the port', () => {
    expect(healthUrl(7373)).toBe('http://127.0.0.1:7373/health');
  });
});

describe('runHealth', () => {
  it('exits 0 and prints nothing when the hub at the YAML file\'s port answers 200', async () => {
    const port = serveStandIn(() => Response.json({ status: 'ok' }));

    const ran = await health(yamlEnv(port));

    expect(ran).toEqual({ code: 0, err: [] });
    expect(asked).toEqual([`http://127.0.0.1:${String(port)}/health`]);
  });

  it('reads a .ts config file through the same reader and exits 0 on 200', async () => {
    const port = serveStandIn(() => new Response('ok'));

    const ran = await health(moduleEnv(port));

    expect(ran).toEqual({ code: 0, err: [] });
    expect(asked).toEqual([`http://127.0.0.1:${String(port)}/health`]);
  });

  it('exits 1 naming the status when the hub answers 503', async () => {
    const port = serveStandIn(() => new Response('store unavailable', { status: 503 }));

    const ran = await health(yamlEnv(port));

    expect(ran).toEqual({ code: 1, err: [`rafa-hub health: the hub at http://127.0.0.1:${String(port)}/health answered 503, expected 200`] });
    expect(asked).toHaveLength(1);
  });

  it('exits 1 on a redirect, which it does not follow', async () => {
    const port = serveStandIn(() => new Response(null, { status: 302, headers: { location: '/v1/status' } }));

    const ran = await health(yamlEnv(port));

    expect(ran.code).toBe(1);
    expect(ran.err).toEqual([`rafa-hub health: the hub at http://127.0.0.1:${String(port)}/health answered 302, expected 200`]);
    expect(asked).toHaveLength(1);
  });

  it('exits 1 with one line naming the URL when nothing listens on the port', async () => {
    const port = await closedPort();

    const ran = await health(yamlEnv(port));

    expect(ran.code).toBe(1);
    expect(ran.err).toHaveLength(1);
    expect(ran.err[0]).toStartWith(`rafa-hub health: the hub at http://127.0.0.1:${String(port)}/health was not reached: `);
  });

  it('exits 1 when the hub does not answer within the timeout', async () => {
    const port = serveStandIn(() => new Promise<Response>(() => undefined));

    const ran = await health(yamlEnv(port), 100);

    expect(ran.code).toBe(1);
    expect(ran.err).toHaveLength(1);
    expect(ran.err[0]).toStartWith(`rafa-hub health: the hub at http://127.0.0.1:${String(port)}/health was not reached: `);
    expect(asked).toHaveLength(1);
  });

  it('exits 1 naming the variable when RAFA_HUB_CONFIG is unset, asking no hub', async () => {
    serveStandIn(() => new Response('ok'));

    const ran = await health({});

    expect(ran.code).toBe(1);
    expect(ran.err).toHaveLength(1);
    expect(ran.err[0]).toStartWith(`rafa-hub health: the config was refused: ${HUB_CONFIG_ENV} is not set`);
    expect(asked).toEqual([]);
  });

  it('exits 1 with the reader\'s problems when the config is refused, asking no hub', async () => {
    const port = serveStandIn(() => new Response('ok'));
    const path = join(root, 'rafa-hub.yaml');
    writeFileSync(path, `hub:\n  repository: ${REPOSITORY}\n  port: ${String(port)}\n  colour: red\n`);

    const ran = await health({ [HUB_CONFIG_ENV]: path });

    expect(ran.code).toBe(1);
    expect(ran.err).toHaveLength(1);
    expect(ran.err[0]).toStartWith('rafa-hub health: the config was refused: ');
    expect(ran.err[0]).toContain('colour');
    expect(asked).toEqual([]);
  });
});
