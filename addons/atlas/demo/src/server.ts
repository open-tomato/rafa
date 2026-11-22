/**
 * The demo server: `Bun.serve` with an HTML import, so Bun bundles
 * `index.html`, its TSX and its Tailwind stylesheet on request. `bun run
 * dev` adds hot reload. It binds to loopback, since Atlas has no auth.
 *
 * The Atlas API mounts under `/api/atlas` only when the project root holds
 * an effort store (D7 of the data integration plan). `ATLAS_PROJECT_ROOT`
 * names the root, the repository this demo sits in otherwise, and
 * `RAFA_EFFORT_DIR` names the store and wins over both, as every store
 * reader finds it. A worktree holds no store, so a run from one without
 * `ATLAS_PROJECT_ROOT` serves the page alone and `/api/atlas` answers a
 * plain 404, which the live page shows as its error state.
 *
 * With a store and no replica at `<root>/.rafa/atlas/atlas.sqlite`, the
 * server builds the replica before it listens, until rafa-atlas's `build`
 * command takes that over. The build copies the live store with core's
 * `vacuumInto` and reads only the copy.
 */
import type { Server } from 'bun';

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { createAtlasHandler, toFetchHandler } from '@open-tomato/atlas-transport/server';
import { buildAtlas, effortStorePathOf, replicaPathOf } from '@open-tomato/rafa-atlas/build';
import { openAtlasRegistry } from '@open-tomato/rafa-atlas/registry';

import { LIVE_API_BASE } from './data/live.js';
import index from './index.html';

/** The port, unless `PORT` or the caller names another; 0 picks a free one. */
export const DEFAULT_PORT = 4319;

/** Loopback only: the API serves a project's effort data with no auth. */
const HOSTNAME = '127.0.0.1';

/** The repository this file sits in: src, demo, atlas, addons, then the root. */
const REPOSITORY_ROOT: string = resolve(import.meta.dir, '..', '..', '..', '..');

/** An environment, as `process.env` holds one. */
export type ServerEnvironment = Readonly<Record<string, string | undefined>>;

/** The project root the API reads: `ATLAS_PROJECT_ROOT` when set, `fallback` otherwise. */
export function resolveProjectRoot(env: ServerEnvironment, fallback: string = REPOSITORY_ROOT): string {
  const named = env['ATLAS_PROJECT_ROOT'];
  return named === undefined || named === ''
    ? fallback
    : resolve(named);
}

/** The API over one project root, as the server mounts it. */
export interface AtlasMount {
  readonly projectRoot: string;
  readonly storePath: string;
  readonly replicaPath: string;
  /** True when this start built the replica, which was not there. */
  readonly built: boolean;
  /** The fetch adapter, mounted at `/api/atlas`. */
  readonly fetch: (request: Request) => Promise<Response>;
  /** Closes the replica reader. */
  close(): void;
}

export interface MountOptions {
  readonly projectRoot: string;
  /** Read for `RAFA_EFFORT_DIR`. */
  readonly env: ServerEnvironment;
  /** Hears every error the handler answers as a 500. */
  readonly onError?: (error: unknown) => void;
}

/**
 * The API over `options.projectRoot`, or null when no effort store is
 * there. Builds the replica first when there is none; throws when
 * `RAFA_EFFORT_DIR` is set but not usable, as `effortStoreDir` does.
 */
export async function mountAtlas(options: MountOptions): Promise<AtlasMount | null> {
  const { projectRoot, env } = options;
  const storePath = effortStorePathOf(projectRoot, env);
  if (!existsSync(storePath)) return null;
  const replicaPath = replicaPathOf(projectRoot);
  const built = !existsSync(replicaPath);
  if (built) await buildAtlas({ projectRoot, env });
  const registry = await openAtlasRegistry({ projectRoot });
  const handler = createAtlasHandler(registry, options.onError === undefined
    ? {}
    : { onError: options.onError });
  return {
    projectRoot,
    storePath,
    replicaPath,
    built,
    fetch: toFetchHandler(handler, { basePath: LIVE_API_BASE }),
    close: () => {
      registry.close();
    },
  };
}

export interface DemoServerOptions {
  /** Read for `ATLAS_PROJECT_ROOT` and `RAFA_EFFORT_DIR`. */
  readonly env: ServerEnvironment;
  readonly port?: number;
  /** Hot reload and the browser console; off unless asked. */
  readonly development?: boolean;
  /** The root used when `ATLAS_PROJECT_ROOT` is not set; the repository this file sits in by default. */
  readonly defaultRoot?: string;
  readonly onError?: (error: unknown) => void;
}

/** A started demo: the server, the API it mounted (null for none), and a stop for both. */
export interface DemoServer {
  readonly server: Server<undefined>;
  readonly projectRoot: string;
  readonly mount: AtlasMount | null;
  stop(): Promise<void>;
}

/** Starts the demo: the page at `/`, and the API under `/api/atlas` when a store resolves. */
export async function startDemoServer(options: DemoServerOptions): Promise<DemoServer> {
  const projectRoot = resolveProjectRoot(options.env, options.defaultRoot);
  const mount = await mountAtlas({
    projectRoot,
    env: options.env,
    ...(options.onError === undefined
      ? {}
      : { onError: options.onError }),
  });
  const api = mount === null
    ? {}
    : { [`${LIVE_API_BASE}/*`]: (request: Request) => mount.fetch(request) };
  const server = Bun.serve({
    hostname: HOSTNAME,
    port: options.port ?? DEFAULT_PORT,
    routes: { '/': index, ...api },
    fetch: () => new Response('Not found', { status: 404 }),
    development: options.development === true
      ? { hmr: true, console: true }
      : false,
  });
  return {
    server,
    projectRoot,
    mount,
    stop: async () => {
      await server.stop(true);
      mount?.close();
    },
  };
}

/** The line the server prints about the API: where it reads, or why it is not mounted. */
export function apiLine(demo: DemoServer): string {
  if (demo.mount === null) {
    return `Atlas API not mounted: no effort store under ${demo.projectRoot}. From a worktree, set`
      + ' ATLAS_PROJECT_ROOT to the main checkout; the page draws mock data without it.';
  }
  const built = demo.mount.built
    ? ', built on this start'
    : '';
  return `Atlas API at ${new URL(LIVE_API_BASE, demo.server.url).href} over ${demo.mount.replicaPath}${built}; open the page with ?source=live.`;
}

if (import.meta.main) {
  const demo = await startDemoServer({
    env: process.env,
    port: Number(process.env['PORT'] ?? DEFAULT_PORT),
    development: true,
    onError: (error) => {
      console.error(`atlas: ${error instanceof Error
        ? error.stack ?? error.message
        : String(error)}`);
    },
  });
  console.info(`Atlas demo on ${demo.server.url}`);
  console.info(apiLine(demo));
}
