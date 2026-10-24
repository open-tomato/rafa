/**
 * Tests for the composition root `src/service-registry.ts`: the services
 * core registers, read off `activeServices()` once `registerCoreServices`
 * has been called. The preload (`src/tests/preload.ts`) makes the call
 * once for the test process; importing the root registers nothing.
 *
 * The registration case starts from an empty registry and asserts a
 * function under every key of `SERVICE_REASONS`, so a key the root
 * misses fails here as well as in `tsc`. The second-call case holds a
 * set of stubs and asserts the call registers nothing over it. The
 * spawned case runs the real entry in a child, which runs no preload,
 * and reads that `--help` exits 0 with no registry refusal on either
 * stream. Each in-process case puts back the set it found in a `finally`.
 */
import type { RafaServices } from '@open-tomato/rafa/core/services';

import { describe, expect, it } from 'bun:test';

import { activeServices, registerServices, restoreServices, SERVICE_REASONS } from '@open-tomato/rafa/core/services';

import { CORE_SERVICES, registerCoreServices } from './service-registry.js';
import { expectExit } from './tests/cli-capture.js';

const REFUSAL_PREFIX = 'service registry:';
const SERVICE_KEYS = Object.keys(SERVICE_REASONS).sort();

/** Runs `body` with the active set replaced by `start` (null for none), then puts the found set back. */
function over(start: RafaServices | null, body: () => void): void {
  const found = registerServices(CORE_SERVICES);
  try {
    restoreServices(start);
    body();
  } finally {
    restoreServices(found);
  }
}

describe('registerCoreServices', () => {
  it('registers a function under every key of SERVICE_REASONS, from an empty registry', () => {
    over(null, () => {
      const facade = registerCoreServices();

      expect(Object.keys(CORE_SERVICES).sort()).toEqual(SERVICE_KEYS);
      for (const key of SERVICE_KEYS) {
        expect(typeof activeServices()[key as keyof RafaServices]).toBe('function');
        expect(typeof facade[key as keyof RafaServices]).toBe('function');
      }
    });
  });

  it('registers nothing on a second call, leaving the held set active', () => {
    const calls: string[] = [];
    const stubs = {
      addStaleDocLine: async () => { calls.push('addStaleDocLine'); return {} as never; },
      endWithNextStep: async () => { calls.push('endWithNextStep'); },
      readStaleDocsVersion: () => { calls.push('readStaleDocsVersion'); return 'stub'; },
      triageReport: async () => { calls.push('triageReport'); return {} as never; },
    } satisfies RafaServices;
    over(null, () => {
      registerCoreServices();
      const again = registerCoreServices();
      expect(again).toBe(activeServices());

      restoreServices(stubs);
      const third = registerCoreServices();

      expect(third).toBe(activeServices());
      expect(third.readStaleDocsVersion({} as never)).toBe('stub');
      expect(calls).toEqual(['readStaleDocsVersion']);
    });
  });

  it('exits 0 with no registry refusal when the real entry prints --help', () => {
    const spawned = Bun.spawnSync([process.execPath, 'src/rafa.ts', '--help'], { cwd: import.meta.dir + '/..' });
    const child = { exitCode: spawned.exitCode, stdout: spawned.stdout.toString(), stderr: spawned.stderr.toString() };

    expectExit(child, 0);
    expect(child.stdout).not.toContain(REFUSAL_PREFIX);
    expect(child.stderr).not.toContain(REFUSAL_PREFIX);
  });
});
