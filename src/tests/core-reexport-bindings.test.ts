import { describe, expect, test } from 'bun:test';

import * as coreRuntime from '../core/runtime/index.js';
import * as attribution from '../effort/attribution.js';
import * as commits from '../effort/commits.js';
import * as commitStats from '../effort/store/commit-stats.js';
import * as ndjson from '../effort/store/ndjson-files.js';
import * as planStubs from '../effort/store/plan-stubs.js';
import * as store from '../effort/store.js';
import * as identity from '../runtime/identity.js';

// classify.ts and session-log.ts re-export types only, which leave no
// runtime binding to compare; the compiler checks them.

function expectSameBindings(
  oldModule: Record<string, unknown>,
  newModule: Record<string, unknown>,
  names: readonly string[],
): void {
  for (const name of names) {
    expect(newModule[name]).toBeDefined();
    expect(oldModule[name]).toBe(newModule[name]);
  }
}

describe('re-exports are the same binding as at the new path', () => {
  test('runtime/identity.ts', () => {
    expectSameBindings(identity, coreRuntime, ['readRuntimeIdentity']);
  });

  test('effort/store.ts', () => {
    expectSameBindings(store, ndjson, [
      'appendRows',
      'collectedKeys',
      'EFFORT_STORE_DIR',
      'effortStoreFileName',
      'effortStorePath',
      'keysOfRows',
      'openEffortStore',
      'parseStoreText',
      'readStoreRows',
    ]);
  });

  test('effort/commits.ts', () => {
    expectSameBindings(commits, commitStats, ['minutesBetween']);
  });

  test('effort/attribution.ts', () => {
    expectSameBindings(attribution, planStubs, [
      'attributeBranch',
      'planStubsFromFileNames',
      'queueIdOf',
      'resolvePlanStub',
    ]);
  });
});
