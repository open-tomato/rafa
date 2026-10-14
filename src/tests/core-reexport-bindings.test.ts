import { describe, expect, test } from 'bun:test';

import * as trust from '../board/trust.js';
import * as coreConfig from '../core/config/index.js';
import * as coreRuntime from '../core/runtime/index.js';
import * as attribution from '../effort/attribution.js';
import * as commits from '../effort/commits.js';
import * as checkRows from '../effort/store/check-rows.js';
import * as commitStats from '../effort/store/commit-stats.js';
import * as effortLevels from '../effort/store/effort-levels.js';
import * as storeBarrel from '../effort/store/index.js';
import * as machineFault from '../effort/store/machine-fault.js';
import * as ndjson from '../effort/store/ndjson-files.js';
import * as planStubs from '../effort/store/plan-stubs.js';
import * as trustedPermissions from '../effort/store/trusted-permissions.js';
import * as store from '../effort/store.js';
import * as checks from '../pr/checks.js';
import * as scope from '../project/scope.js';
import * as identity from '../runtime/identity.js';
import * as triageFault from '../triage/machine-fault.js';
import * as declaration from '../utils/declaration.js';

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

  test('project/scope.ts', () => {
    expectSameBindings(scope, coreConfig, ['SCOPE_DIR']);
  });

  test('triage/machine-fault.ts', () => {
    expectSameBindings(triageFault, machineFault, [
      'BUILD_FAILURE',
      'isMachineFault',
      'machineFaultSentence',
      'readMachineFault',
      'SHAPES',
    ]);
  });

  test('pr/checks.ts', () => {
    expectSameBindings(checks, checkRows, ['failingRows', 'verdictOf']);
  });

  test('utils/declaration.ts', () => {
    expectSameBindings(declaration, effortLevels, ['EFFORT_LEVELS']);
  });

  test('board/trust.ts', () => {
    expectSameBindings(trust, trustedPermissions, ['TRUSTED_PERMISSIONS']);
  });

  // preflight/run.ts re-exports types only; the compiler checks them.

  test('the store barrel exports the same runtime names', () => {
    expect(Object.keys(storeBarrel).sort()).toEqual([
      'EFFORT_KEY_PROJECTIONS',
      'STORE_BACKENDS',
      'TRUSTED_PERMISSIONS',
      'WIRE_FORMAT',
      'WIRE_VERSION',
      'WireExportRefusal',
      'WireFormatError',
      'decodeWirePayload',
      'encodeWirePayload',
      'exportWirePayload',
      'materialiseWirePayload',
      'mergeStore',
      'openNdjsonStore',
      'openSqliteStore',
      'selectEffortStore',
    ]);
  });
});
