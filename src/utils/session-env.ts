/**
 * The environment a Claude session is spawned with, now
 * `src/core/loop/session-env.ts` behind the loop barrel.
 *
 * Re-export kept for importers outside core; the third step of core's move
 * into its package (#1090) removes it.
 */
export type { SpawnEnv } from '../core/loop/index.js';

export { sessionPath, sessionSpawnEnv } from '../core/loop/index.js';
