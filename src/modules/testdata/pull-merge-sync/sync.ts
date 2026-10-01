/**
 * The `sync` entry of the `pull-merge-sync` module: a `service` strategy
 * whose pull merges another device's store, which
 * `src/tests/loop-sync-pull-spawned.test.ts` loads from this directory
 * through `modules:` and `allowList:` to hold what the loop's end-of-task
 * pull does to the store it runs on.
 *
 * Its push moves nothing and answers `pushed` with no path. Its pull is
 * the `file` strategy's (`src/effort/sync/file.ts`), handed the request as
 * it came, `sessionId` included, and reading the other device's
 * `effort.sqlite` from the path the `RAFA_TEST_OTHER_STORE` variable
 * names: a hub has nothing to carry here, so the other device's file is
 * where the test left it. A merge the guard or any other rule refuses
 * rejects as the `file` strategy rejects it, and each pull's outcome
 * (`pulled:<status>:<rows added>`, or `refused`) is appended, one line per
 * call, to `.rafa/sync-calls.log` under the repository the adapter is
 * made for, so a case reads what each end-of-task pull did.
 */
import type { AdapterContext } from '../../../adapters/registry.js';
import type { Sync, SyncPullRequest, SyncPullResult } from '../../../ports/index.js';

import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { createFileSync } from '../../../effort/sync/file.js';

/** The variable naming the other device's `effort.sqlite`. */
const OTHER_STORE_VARIABLE = 'RAFA_TEST_OTHER_STORE';

/** Appends `line` to the call log under `repoRoot`. */
function logCall(repoRoot: string, line: string): void {
  const dir = join(repoRoot, '.rafa');
  mkdirSync(dir, { recursive: true });
  appendFileSync(join(dir, 'sync-calls.log'), `${line}\n`, 'utf8');
}

/** Makes the fixture's `service` strategy for the repository `context` names. */
export default function create(context: AdapterContext): Sync {
  const { repoRoot } = context;
  const file = createFileSync({ repoRoot, backend: 'sqlite' });

  const pull = async (request: SyncPullRequest): Promise<SyncPullResult> => {
    const from = process.env[OTHER_STORE_VARIABLE];
    if (from === undefined || from === '') throw new Error(`${OTHER_STORE_VARIABLE} names no store`);
    try {
      const result = await file.pull({ ...request, from });
      logCall(repoRoot, result.status === 'pulled'
        ? `pulled:${result.merge.status}:${String(result.merge.rowsAdded)}`
        : result.status);
      return result;
    } catch (error) {
      logCall(repoRoot, 'refused');
      throw error;
    }
  };

  return {
    kind: 'service',
    push: async () => ({ status: 'pushed', path: null }),
    pull,
  };
}
