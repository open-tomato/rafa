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
 * server builds nothing: it mounts no API and prints the rafa-atlas
 * `build` line that writes the replica, `BUILD_LINE`. The build copies the
 * live store with core's `vacuumInto` and reads only the copy.
 */
import type { Server } from 'bun';

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { createAtlasHandler, toFetchHandler } from '@open-tomato/atlas-transport/server';
import { effortStorePathOf, replicaPathOf } from '@open-tomato/rafa-atlas/build';
import { openAtlasRegistry } from '@open-tomato/rafa-atlas/registry';

import { LIVE_API_BASE } from './data/live.js';
import index from './index.html';

/** The port, unless `PORT` or the caller names another; 0 picks a free one. */
export const DEFAULT_PORT = 4319;

/** Loopback only: the API serves a project's effort data with no auth. */
const HOSTNAME = '127.0.0.1';

/** The line that writes the replica, as rafa-atlas's `build` command names it. */
export const BUILD_LINE = 'rafa module exec @open-tomato/rafa-atlas build';

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
  /** The fetch adapter, mounted at `/api/atlas`. */
  readonly fetch: (request: Request) => Promise<Response>;
  /** Closes the replica reader. */
  close(): void;
}

/** Why the API is not mounted: no effort store, or a store with no replica built yet. */
export interface MountAbsence {
  readonly reason: 'no-store' | 'no-replica';
  readonly projectRoot: string;
  readonly storePath: string;
  readonly replicaPath: string;
}

export interface MountOptions {
  readonly projectRoot: string;
  /** Read for `RAFA_EFFORT_DIR`. */
  readonly env: ServerEnvironment;
  /** Hears every error the handler answers as a 500. */
  readonly onError?: (error: unknown) => void;
}

/**
 * The API over `options.projectRoot`, or the absence that keeps it
 * unmounted: no effort store there, or no replica built from it. Builds
 * nothing; throws when `RAFA_EFFORT_DIR` is set but not usable, as
 * `effortStoreDir` does.
 */
export async function mountAtlas(options: MountOptions): Promise<AtlasMount | MountAbsence> {
  const { projectRoot, env } = options;
  const storePath = effortStorePathOf(projectRoot, env);
  const replicaPath = replicaPathOf(projectRoot);
  if (!existsSync(storePath)) return { reason: 'no-store', projectRoot, storePath, replicaPath };
  if (!existsSync(replicaPath)) return { reason: 'no-replica', projectRoot, storePath, replicaPath };
  const registry = await openAtlasRegistry({ projectRoot });
  const handler = createAtlasHandler(registry, options.onError === undefined
    ? {}
    : { onError: options.onError });
  return {
    projectRoot,
    storePath,
    replicaPath,
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

/** A started demo: the server, the API it mounted (null for none) or why not, and a stop for both. */
export interface DemoServer {
  readonly server: Server<undefined>;
  readonly projectRoot: string;
  readonly mount: AtlasMount | null;
  /** Why no API is mounted; null when one is. */
  readonly absence: MountAbsence | null;
  stop(): Promise<void>;
}

/** Starts the demo: the page at `/`, and the API under `/api/atlas` when a store resolves. */
export async function startDemoServer(options: DemoServerOptions): Promise<DemoServer> {
  const projectRoot = resolveProjectRoot(options.env, options.defaultRoot);
  const mounted = await mountAtlas({
    projectRoot,
    env: options.env,
    ...(options.onError === undefined
      ? {}
      : { onError: options.onError }),
  });
  const mount = 'fetch' in mounted
    ? mounted
    : null;
  const absence = 'fetch' in mounted
    ? null
    : mounted;
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
    absence,
    stop: async () => {
      await server.stop(true);
      mount?.close();
    },
  };
}

/** The line the server prints about the API: where it reads, or why it is not mounted. */
export function apiLine(demo: DemoServer): string {
  if (demo.absence?.reason === 'no-replica') {
    return `Atlas API not mounted: no replica at ${demo.absence.replicaPath}. Build it with`
      + ` ATLAS_PROJECT_ROOT=${demo.projectRoot} ${BUILD_LINE}, then start the demo again.`;
  }
  if (demo.mount === null) {
    return `Atlas API not mounted: no effort store under ${demo.projectRoot}. From a worktree, set`
      + ' ATLAS_PROJECT_ROOT to the main checkout; the page draws mock data without it.';
  }
  return `Atlas API at ${new URL(LIVE_API_BASE, demo.server.url).href} over ${demo.mount.replicaPath}; open the page with ?source=live.`;
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
