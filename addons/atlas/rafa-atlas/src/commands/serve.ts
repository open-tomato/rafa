/**
 * `serve`: the Atlas API over the project's replica, with no page: the
 * handler of `atlas-transport` behind `Bun.serve`, mounted at
 * `/api/atlas`, the base the demo's live source calls.
 *
 * It builds the replica first when there is none, as `build` does, then
 * opens the registry and lays the project's targets over its metrics
 * (`loadAtlasConfig`, `withAtlasTargets`). It binds to loopback only,
 * since the API serves a project's effort data with no auth. With
 * `--rebuild-every=<minutes>` above 0 it builds again on that period;
 * the replica reader reopens the file each build renames in, and a
 * failed rebuild prints an error line and keeps the replica it had.
 * `--github` is read by every build the command makes, the first and each
 * rebuild, as `build` reads it.
 *
 * The command runs until its context's signal aborts, and the process
 * ends with it; a test aborts the signal to stop the server.
 */
import type { AtlasProjectConfig } from '../config.js';
import type { AtlasRegistry } from '../registry.js';
import type { GhRunner } from '@open-tomato/rafa-board';
import type { RafaCommand, RafaContext, RafaFlagSpec } from '@open-tomato/rafa-core/core/command';
import type { Server } from 'bun';

import { existsSync } from 'node:fs';

import { createAtlasHandler, toFetchHandler } from '@open-tomato/atlas-transport/server';

import { buildAtlas, replicaPathOf } from '../build/index.js';
import { loadAtlasConfig, withAtlasTargets } from '../config.js';
import { openAtlasRegistry } from '../registry.js';

import { runBuild } from './build.js';
import { buildOptionsOf, execLine, GITHUB_FLAG, projectRootOf, refusing, SUBJECT, wholeFlag } from './shared.js';

/** The port `serve` listens on unless `--port` names another; 0 picks a free one. */
export const DEFAULT_SERVE_PORT = 4317;

/** Where the API mounts: the base the demo's live source calls. */
export const API_BASE = '/api/atlas';

/** Loopback only: the API serves a project's effort data with no auth. */
const HOSTNAME = '127.0.0.1';

/** The highest port number. */
const MAX_PORT = 65_535;

/** Milliseconds in a minute, for `--rebuild-every`. */
const MINUTE_MS = 60_000;

/** A running API, as `startAtlasServer` answers it. */
export interface AtlasServer {
  readonly server: Server<undefined>;
  /** The API's base URL: the server's URL and `/api/atlas`. */
  readonly apiUrl: string;
  /** True when this start built the replica, which was not there. */
  readonly built: boolean;
  /** Builds the replica again; the registry reads the new file at its next call. */
  rebuild(): Promise<void>;
  /** Stops the server, the rebuild timer and the replica reader. */
  stop(): Promise<void>;
}

/** What one start is handed. */
export interface ServeOptions {
  readonly context: RafaContext;
  readonly port: number;
  /** Minutes between builds; 0 builds only when there is no replica. */
  readonly rebuildEveryMinutes: number;
  /** Stands in for `gh` in every build under `--github` (a test's stub); never asked without the flag. */
  readonly gh?: GhRunner;
}

/** The registry the handler serves: the replica's sources, and the metrics with the project's targets. */
function servedRegistry(registry: AtlasRegistry, config: AtlasProjectConfig): AtlasRegistry {
  return { ...registry, metrics: withAtlasTargets(registry.metrics, config) };
}

/** Starts the API over the context's project root; see the module note. */
export async function startAtlasServer(options: ServeOptions): Promise<AtlasServer> {
  const { context } = options;
  const buildOptions = buildOptionsOf(context, options.gh);
  const { projectRoot } = buildOptions;
  const config = await loadAtlasConfig(projectRoot);
  const built = !existsSync(replicaPathOf(projectRoot));
  if (built) await runBuild(context, options.gh);
  const registry = await openAtlasRegistry({ projectRoot });
  const handler = createAtlasHandler(servedRegistry(registry, config), {
    onError: (error) => {
      context.output.error(`atlas: ${error instanceof Error
        ? error.message
        : String(error)}`);
    },
  });
  let server: Server<undefined>;
  try {
    server = Bun.serve({
      hostname: HOSTNAME,
      port: options.port,
      routes: { [`${API_BASE}/*`]: toFetchHandler(handler, { basePath: API_BASE }) },
      fetch: () => new Response('Not found', { status: 404 }),
    });
  } catch (error) {
    registry.close();
    throw error;
  }

  let building: Promise<void> | null = null;
  const rebuild = (): Promise<void> => {
    building ??= buildAtlas(buildOptions)
      .then((summary) => {
        context.output.info(`atlas: rebuilt ${summary.replicaPath} (build ${summary.buildId})`);
      }, (error: unknown) => {
        context.output.error(`atlas: rebuild failed, still serving the last replica: ${error instanceof Error
          ? error.message
          : String(error)}`);
      })
      .finally(() => {
        building = null;
      });
    return building;
  };
  const timer = options.rebuildEveryMinutes > 0
    ? setInterval(() => {
      void rebuild();
    }, options.rebuildEveryMinutes * MINUTE_MS)
    : null;

  return {
    server,
    apiUrl: new URL(API_BASE, server.url).href,
    built,
    rebuild,
    stop: async () => {
      if (timer !== null) clearInterval(timer);
      await server.stop(true);
      await building;
      registry.close();
    },
  };
}

/** Resolves once `signal` aborts. */
function untilAborted(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    signal.addEventListener('abort', () => {
      resolve();
    }, { once: true });
  });
}

const FLAGS: RafaFlagSpec[] = [
  { name: 'port', description: `the port to listen on, from 0 (a free one) to ${MAX_PORT}; ${DEFAULT_SERVE_PORT} when left out`, type: 'number' },
  { name: 'rebuild-every', description: 'minutes between builds while serving; 0, the default, builds only when there is no replica', type: 'number' },
  GITHUB_FLAG,
];

export const serveCommand: RafaCommand = {
  name: 'atlas serve',
  subject: SUBJECT,
  action: 'serve',
  summary: 'serve the Atlas API over the replica, on loopback',
  description: `Builds the replica when there is none, then serves the Atlas API at ${API_BASE} on 127.0.0.1, with the targets of <root>/.rafa/atlas/config.json laid over the metrics. Each build calls no gh unless --github is given. Serves no page. Runs until stopped; exits 1 with an error line when there is no store to build from or the config does not read.`,
  args: [],
  flags: FLAGS,
  examples: [
    { cmd: execLine('serve'), note: `serves the API on port ${DEFAULT_SERVE_PORT}` },
    { cmd: execLine('serve', '--port=4400 --rebuild-every=30'), note: 'serves on port 4400 and builds again every 30 minutes' },
  ],
  outputs: ['text'],
  needsProject: false,
  run: (context) => refusing(context, async () => {
    const port = wholeFlag(context, 'port', DEFAULT_SERVE_PORT, 0);
    if (port > MAX_PORT) throw new Error(`--port is ${port}, expected a port from 0 to ${MAX_PORT}`);
    const rebuildEveryMinutes = wholeFlag(context, 'rebuild-every', 0, 0);
    const atlas = await startAtlasServer({ context, port, rebuildEveryMinutes });
    context.output.info(`atlas: API at ${atlas.apiUrl} over ${replicaPathOf(projectRootOf(context))}${atlas.built
      ? ', built on this start'
      : ''}`);
    await untilAborted(context.signal);
    await atlas.stop();
  }),
};
