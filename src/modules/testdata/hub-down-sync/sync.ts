/**
 * The `sync` entry of the `hub-down-sync` module: a `service` strategy
 * whose hub is never reachable, which `src/tests/sync-contact-spawned.test.ts`
 * loads from this directory through `modules:` and `allowList:` to hold
 * what a command does when it cannot reach the hub.
 *
 * Its push and pull each append their direction, one line per call, to
 * `.rafa/sync-calls.log` under the repository the adapter is made for,
 * so a case counts the contacts a command made, then reject with an
 * error named `HubUnreachable`, as `src/effort/sync/contact.ts` reads
 * one. The error is a plain `Error` so renamed: a module imports no
 * value from core.
 */
import type { AdapterContext } from '../../../adapters/registry.js';
import type { Sync } from '../../../ports/index.js';

import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

/** Logs `direction` under `repoRoot`, then rejects as a hub that cannot be reached. */
function unreachable(repoRoot: string, direction: string): Promise<never> {
  const dir = join(repoRoot, '.rafa');
  mkdirSync(dir, { recursive: true });
  appendFileSync(join(dir, 'sync-calls.log'), `${direction}\n`, 'utf8');
  return Promise.reject(Object.assign(new Error(`connect ECONNREFUSED on ${direction}`), { name: 'HubUnreachable' }));
}

/** Makes the fixture's `service` strategy for the repository `context` names. */
export default function create(context: AdapterContext): Sync {
  return {
    kind: 'service',
    push: () => unreachable(context.repoRoot, 'push'),
    pull: () => unreachable(context.repoRoot, 'pull'),
  };
}
