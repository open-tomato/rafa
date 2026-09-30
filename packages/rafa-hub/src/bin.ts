#!/usr/bin/env bun
/**
 * The `rafa-hub` command, the package's `bin`: reads the hub's config
 * from the file `RAFA_HUB_CONFIG` names (`config.ts`), then starts the
 * server (`server.ts`) over the repository-permission identity
 * (`identity/github.ts`, asking GitHub's public API about
 * `hub.repository`) and the SQLite store (`store/sqlite.ts`, the file
 * `hub.storePath` names). Logs are JSON lines on standard output.
 *
 * A config the reader refuses is logged as one `config.refused` line
 * holding every problem, and the command exits 1 without listening. A
 * store that does not open is no reason to exit: the server answers
 * `503` on `/health` until it opens, which is what an operator reads.
 * `SIGINT` and `SIGTERM` stop the server, close the store and exit 0.
 *
 * {@link runHub} is the whole command but the process's exit, so a test
 * runs it in process; importing this file starts nothing.
 */
import type { HubLog, HubServer } from './server.js';

import { basename, dirname } from 'node:path';

import packageJson from '../package.json';

import { HubConfigError, readHubConfig } from './config.js';
import { GITHUB_API, openGitHubIdentity } from './identity/github.js';
import { jsonLineLog, startHubServer } from './server.js';
import { openSqliteHubStore } from './store/sqlite.js';

/** The hub's version, as its `package.json` names it. */
export const HUB_VERSION: string = packageJson.version;

/** The signals that stop the hub. */
const STOP_SIGNALS = ['SIGINT', 'SIGTERM'] as const;

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

  const { repository, port, storePath, cacheForMs } = config;
  return startHubServer({
    port,
    version: HUB_VERSION,
    identity: openGitHubIdentity({ repository, cacheForMs, apiBase: options.githubApi ?? GITHUB_API }),
    openStore: () => openSqliteHubStore({ directory: dirname(storePath), now: () => new Date() }, { fileName: basename(storePath) }),
    log,
  });
}

if (import.meta.main) {
  const server = await runHub(process.env);
  if (server === null) process.exit(1);

  for (const signal of STOP_SIGNALS) {
    process.once(signal, () => {
      void server.stop().then(() => process.exit(0));
    });
  }
}
