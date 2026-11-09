#!/usr/bin/env bun
/**
 * The `rafa-hub` command, the package's `bin`: reads the hub's config
 * from the file `RAFA_HUB_CONFIG` names (`config.ts`), then starts the
 * server (`server.ts`) over the repository-permission identity
 * (`identity/github.ts`, asking GitHub's public API about
 * `hub.repository`) and the `sqlite` connector (`connectSqliteHub` in
 * `store/sqlite.ts`), which opens the store at the file `hub.storePath`
 * names and the index beside it, the loader handed
 * `hub.store.sqliteLibrary`. The server rebuilds the index after a push
 * that added rows unless `hub.index.rebuildAfterPush` is `false`, the
 * project a rebuild records being `hub.repository`. Logs are JSON lines
 * on standard output.
 *
 * A config the reader refuses is logged as one `config.refused` line
 * holding every problem, and the command exits 1 without listening. A
 * store that does not open is no reason to exit: the server answers
 * `503` on `/health` until it opens, which is what an operator reads.
 * `SIGINT` and `SIGTERM` stop the server, close the store and exit 0.
 *
 * ## `rafa-hub index rebuild`
 *
 * Reads the same config, opens the same connector, runs one
 * `index.rebuild({ project: hub.repository })`, prints one line with
 * its counts on standard output and exits 0. A refused config, a
 * connector that does not open and a rebuild that fails each print one
 * line on standard error, and the command exits 1; so do arguments
 * naming neither the server nor this entry. The rebuild swaps a new
 * index file in, and a server already running over the same store picks
 * it up by its inode on its following query, so the two need no
 * signal between them.
 *
 * {@link runHub} and {@link runIndexRebuild} are the whole command but
 * the process's exit, so a test runs them in process; importing this
 * file starts nothing.
 */
import type { HubConfig } from './config.js';
import type { HubConnected, HubLog, HubServer } from './server.js';
import type { IndexRebuildResult } from './store/port.js';

import { basename, dirname } from 'node:path';

import packageJson from '../package.json';

import { HubConfigError, readHubConfig } from './config.js';
import { GITHUB_API, openGitHubIdentity } from './identity/github.js';
import { jsonLineLog, startHubServer } from './server.js';
import { connectSqliteHub } from './store/sqlite.js';

/** The hub's version, as its `package.json` names it. */
export const HUB_VERSION: string = packageJson.version;

/** The signals that stop the hub. */
const STOP_SIGNALS = ['SIGINT', 'SIGTERM'] as const;

/** The arguments that run `rafa-hub index rebuild`. */
export const INDEX_REBUILD_ARGS: readonly string[] = Object.freeze(['index', 'rebuild']);

/** What `rafa-hub` takes, as a refused argument list says it. */
export const HUB_USAGE = 'usage: rafa-hub (serves the hub) or rafa-hub index rebuild';

/** What one run of `rafa-hub` does, by its arguments. */
export type HubCommand = 'serve' | 'index-rebuild';

/** What {@link runHub} may vary beyond the environment. */
export interface RunHubOptions {
  /** Where log lines go; standard output when left out. */
  readonly log?: HubLog;
  /** GitHub's API root; {@link GITHUB_API} when left out. */
  readonly githubApi?: string;
}

/**
 * Reads the config `env` names and starts the hub over it, answering
 * the running server, or null when the config was refused, which is
 * logged. Never exits the process.
 */
export async function runHub(env: Readonly<Record<string, string | undefined>>, options: RunHubOptions = {}): Promise<HubServer | null> {
  const log = options.log ?? jsonLineLog();
  let config;
  try {
    config = await readHubConfig(env);
  } catch (error) {
    if (!(error instanceof HubConfigError)) throw error;

    log({ level: 'error', event: 'config.refused', problems: error.problems });
    return null;
  }

  const { repository, port, cacheForMs, rebuildAfterPush } = config;
  return startHubServer({
    port,
    version: HUB_VERSION,
    identity: openGitHubIdentity({ repository, cacheForMs, apiBase: options.githubApi ?? GITHUB_API }),
    openConnected: () => connectHub(config),
    rebuildAfterPush,
    project: repository,
    log,
  });
}

/** Opens the `sqlite` connector over `config`'s store, index and library. */
function connectHub(config: HubConfig): Promise<HubConnected> {
  const { storePath, sqliteLibrary, repository } = config;
  return connectSqliteHub(
    { directory: dirname(storePath), now: () => new Date() },
    { fileName: basename(storePath), loader: { library: sqliteLibrary }, project: repository },
  );
}

/** The command `args` (the process's arguments past the script) name, or null for any other. */
export function hubCommandOf(args: readonly string[]): HubCommand | null {
  if (args.length === 0) return 'serve';

  const isRebuild = args.length === INDEX_REBUILD_ARGS.length
    && args.every((arg, at) => arg === INDEX_REBUILD_ARGS[at]);
  return isRebuild
    ? 'index-rebuild'
    : null;
}

/** What {@link runIndexRebuild} may vary beyond the environment. */
export interface RunIndexRebuildOptions {
  /** Where the counts line goes; standard output when left out. */
  readonly out?: (line: string) => void;
  /** Where a refusal's line goes; standard error when left out. */
  readonly err?: (line: string) => void;
}

/** The prefix every line of `rafa-hub index rebuild` opens with. */
const REBUILD_PREFIX = 'rafa-hub index rebuild';

/** One thrown value's message, on one line. */
function oneLine(error: unknown): string {
  const message = error instanceof Error
    ? error.message
    : String(error);
  return message.replace(/\s*\n\s*/g, '; ');
}

/** The line a rebuild that swapped its index in prints, with its counts. */
export function rebuiltLine(result: IndexRebuildResult): string {
  const tables = result.tables
    .map((table) => `${table.table} ${String(table.rows)}`)
    .join(', ');
  const vector = result.vector
    ? 'vector on'
    : `vector off: ${result.why ?? 'no reason given'}`;
  return `${REBUILD_PREFIX}: ${result.project} rebuilt at ${result.stamp}: ${String(result.rows)} rows, ${String(result.vectors)} vectors (${tables}); ${vector}`;
}

/**
 * Reads the config `env` names, opens its connector, runs one rebuild
 * of `hub.repository`'s index and closes the store, answering the exit
 * code: 0 with the counts line on `out`, or 1 with one line on `err`
 * for a refused config, a connector that did not open or a rebuild that
 * failed. Never exits the process.
 */
export async function runIndexRebuild(env: Readonly<Record<string, string | undefined>>, options: RunIndexRebuildOptions = {}): Promise<number> {
  const out = options.out ?? ((line: string) => process.stdout.write(`${line}\n`));
  const err = options.err ?? ((line: string) => process.stderr.write(`${line}\n`));
  let config;
  try {
    config = await readHubConfig(env);
  } catch (error) {
    if (!(error instanceof HubConfigError)) throw error;

    err(`${REBUILD_PREFIX}: the config was refused: ${error.problems.join('; ')}`);
    return 1;
  }

  let connected;
  try {
    connected = await connectHub(config);
  } catch (error) {
    err(`${REBUILD_PREFIX}: the store at ${config.storePath} did not open: ${oneLine(error)}`);
    return 1;
  }
  try {
    out(rebuiltLine(await connected.index.rebuild({ project: config.repository })));
    return 0;
  } catch (error) {
    err(`${REBUILD_PREFIX}: the rebuild failed, and the live index is as it was: ${oneLine(error)}`);
    return 1;
  } finally {
    await connected.store.close();
  }
}

/** Serves the hub until a stop signal, exiting 1 when its config is refused. */
async function serve(): Promise<void> {
  const server = await runHub(process.env);
  if (server === null) process.exit(1);

  for (const signal of STOP_SIGNALS) {
    process.once(signal, () => {
      void server.stop().then(() => process.exit(0));
    });
  }
}

if (import.meta.main) {
  const command = hubCommandOf(process.argv.slice(2));
  if (command === null) {
    process.stderr.write(`rafa-hub: ${process.argv.slice(2).join(' ')} is not a command; ${HUB_USAGE}\n`);
    process.exit(1);
  }
  if (command === 'index-rebuild') process.exit(await runIndexRebuild(process.env));

  await serve();
}
