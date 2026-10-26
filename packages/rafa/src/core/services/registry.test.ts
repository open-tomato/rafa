/**
 * Tests for the service registry's mechanics: the facade's refusal while
 * nothing is registered, what `registerServices` answers and refuses,
 * what `restoreServices` puts back, the call-time read of the facade,
 * and the reason every key carries.
 *
 * Every case runs over stub services built here, so this file imports
 * nothing above core. The real services are read in
 * `src/service-registry.test.ts`, beside the root that registers them.
 *
 * The active set is a module-level value, and bun runs every test file
 * in one process, where the preload may already have registered the real
 * set. So each case over it takes the set it found by registering stubs,
 * starts from none, and puts the found set back in a `finally`.
 *
 * Every refusal is spelled here in full, and each sits beside a call the
 * registry answers, so a registry refusing everything fails as surely as
 * one refusing nothing.
 */
import type { RafaServices } from './registry.js';
import type { StaleDocLineResult, TriageServiceResult } from './shapes.js';
import type { PullRequests } from '../../pr/types.js';
import type { RafaContext } from '../command/command.js';

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'bun:test';

import {
  activeServices,
  registerServices,
  restoreServices,
  SERVICE_REASONS,
} from './registry.js';

const ROOT = resolve(import.meta.dir, '../../../../..');

/** The five keys, sorted, spelled here so a reading that drifts fails. */
const KEYS = ['addStaleDocLine', 'endWithNextStep', 'pullRequestsIn', 'readStaleDocsVersion', 'triageReport'];

/** What a member of the facade throws while nothing is registered. */
function unregistered(key: string): string {
  return 'service registry: no service is registered: call registerCoreServices()'
    + ` from src/service-registry.ts before calling ${key}`;
}

/** A context no stub reads. */
const CONTEXT = {} as RafaContext;

/**
 * What a stub `pullRequestsIn` answers: the port cast over a tag, which
 * {@link answers} reads and no case calls a member of.
 */
interface TaggedPullRequests extends PullRequests {
  readonly tag: string;
}

/** A full set of stubs, each answering a value naming `tag`. */
function stubs(tag: string): RafaServices {
  const kept: StaleDocLineResult = { action: 'kept', title: tag, reason: tag };
  const triaged: TriageServiceResult = { bugs: [], staleDocs: [] };
  const provider = { tag } as TaggedPullRequests;
  return {
    addStaleDocLine: async () => kept,
    endWithNextStep: async () => tag,
    pullRequestsIn: () => provider,
    readStaleDocsVersion: () => tag,
    triageReport: async () => triaged,
  };
}

/** What each member of `services` answers, by key, awaited. */
async function answers(services: RafaServices): Promise<Record<string, unknown>> {
  const added = await services.addStaleDocLine({
    tracker: null,
    version: 'next',
    entry: { where: null, what: 'x' },
  });
  return {
    addStaleDocLine: added.title,
    endWithNextStep: await services.endWithNextStep(CONTEXT),
    pullRequestsIn: (services.pullRequestsIn('/nonexistent') as TaggedPullRequests).tag,
    readStaleDocsVersion: services.readStaleDocsVersion({
      repoRoot: '/nonexistent',
      checkout: '/nonexistent',
      config: {} as Parameters<RafaServices['readStaleDocsVersion']>[0]['config'],
    }),
    triageReport: (await services.triageReport({} as Parameters<RafaServices['triageReport']>[0])).bugs.length,
  };
}

/** Runs `body` with no service registered, then puts back the set it found. */
async function overNone(body: () => Promise<void> | void): Promise<void> {
  const found = registerServices(stubs('probe'));
  restoreServices(null);
  try {
    await body();
  } finally {
    restoreServices(found);
  }
}

describe('the facade while nothing is registered', () => {
  it('throws from each member, naming its key and src/service-registry.ts', async () => {
    await overNone(async () => {
      const services = activeServices();

      expect(() => services.addStaleDocLine({ tracker: null, version: 'next', entry: { where: null, what: 'x' } }))
        .toThrow(unregistered('addStaleDocLine'));
      expect(() => services.endWithNextStep(CONTEXT)).toThrow(unregistered('endWithNextStep'));
      expect(() => services.pullRequestsIn('/nonexistent')).toThrow(unregistered('pullRequestsIn'));
      expect(() => services.readStaleDocsVersion({} as Parameters<RafaServices['readStaleDocsVersion']>[0]))
        .toThrow(unregistered('readStaleDocsVersion'));
      expect(() => services.triageReport({} as Parameters<RafaServices['triageReport']>[0]))
        .toThrow(unregistered('triageReport'));

      // Control: a set registered, and each member answers.
      registerServices(stubs('one'));
      expect(await answers(activeServices())).toEqual({
        addStaleDocLine: 'one',
        endWithNextStep: 'one',
        pullRequestsIn: 'one',
        readStaleDocsVersion: 'one',
        triageReport: 0,
      });
    });
  });

  it('is answered by activeServices() without a throw', async () => {
    await overNone(() => {
      expect(() => activeServices()).not.toThrow();
      expect(Object.keys(activeServices()).sort()).toEqual(KEYS);
    });
  });
});

describe('registering and restoring a set', () => {
  it('answers null the first time and the set it replaced the second', async () => {
    await overNone(async () => {
      const first = stubs('first');

      expect(registerServices(first)).toBeNull();
      const replaced = registerServices(stubs('second'));

      expect(replaced).not.toBeNull();
      for (const key of KEYS) {
        expect([key, replaced?.[key as keyof RafaServices]]).toEqual([key, first[key as keyof RafaServices]]);
      }
      expect(await answers(activeServices())).toMatchObject({ endWithNextStep: 'second' });
    });
  });

  it('puts back the set restoreServices is handed, and none for null', async () => {
    await overNone(async () => {
      registerServices(stubs('first'));
      const previous = registerServices(stubs('second'));

      expect(await answers(activeServices())).toMatchObject({ readStaleDocsVersion: 'second' });
      restoreServices(previous);
      expect(await answers(activeServices())).toMatchObject({ readStaleDocsVersion: 'first' });
      restoreServices(null);
      expect(() => activeServices().readStaleDocsVersion({} as Parameters<RafaServices['readStaleDocsVersion']>[0]))
        .toThrow(unregistered('readStaleDocsVersion'));
    });
  });

  it('reads what was registered after activeServices() was taken hold of', async () => {
    await overNone(async () => {
      const taken = activeServices();
      registerServices(stubs('later'));

      expect(await taken.endWithNextStep(CONTEXT)).toBe('later');
      registerServices(stubs('latest'));
      expect(await taken.endWithNextStep(CONTEXT)).toBe('latest');
    });
  });

  it('holds a frozen copy, so a change to the set handed in reaches nothing', async () => {
    await overNone(async () => {
      const handed = { ...stubs('held') };
      registerServices(handed);
      handed.endWithNextStep = async () => 'swapped';

      expect(await activeServices().endWithNextStep(CONTEXT)).toBe('held');
      const previous = registerServices(stubs('next'));
      expect(Object.isFrozen(previous)).toBe(true);
    });
  });

  it('refuses a set missing a function, leaving the active set as it was', async () => {
    await overNone(async () => {
      registerServices(stubs('kept'));
      const missing = { ...stubs('refused'), triageReport: undefined } as unknown as RafaServices;
      const notFunction = { ...stubs('refused'), addStaleDocLine: 'no' } as unknown as RafaServices;

      expect(() => registerServices(missing))
        .toThrow('service registry: triageReport is undefined, expected a function');
      expect(() => registerServices(notFunction))
        .toThrow('service registry: addStaleDocLine is string, expected a function');
      expect(() => restoreServices(missing))
        .toThrow('service registry: triageReport is undefined, expected a function');
      expect(() => registerServices(null as unknown as RafaServices))
        .toThrow('service registry: a service set is null, expected a mapping');
      expect(await answers(activeServices())).toMatchObject({ endWithNextStep: 'kept' });
    });
  });

  it('refuses the facade as a set, which would call itself once held', async () => {
    await overNone(async () => {
      registerServices(stubs('kept'));
      const refusal = 'service registry: activeServices() reads the active set and cannot be held as one;'
        + ' hold what registerServices answered, or a set of functions';

      expect(() => registerServices(activeServices())).toThrow(TypeError);
      expect(() => registerServices(activeServices())).toThrow(refusal);
      expect(() => restoreServices(activeServices())).toThrow(refusal);
      expect(await answers(activeServices())).toMatchObject({ endWithNextStep: 'kept' });
    });
  });

  it('answers a frozen facade, so no caller swaps a member', () => {
    const facade = activeServices() as { endWithNextStep: unknown };

    expect(Object.isFrozen(activeServices())).toBe(true);
    expect(activeServices()).toBe(activeServices());
    expect(() => {
      facade.endWithNextStep = () => null;
    }).toThrow(TypeError);
  });
});

describe('SERVICE_REASONS', () => {
  it('holds the five keys, sorted', () => {
    expect(Object.keys(SERVICE_REASONS)).toEqual(KEYS);
  });

  it('names board or release as lower, run, pr or release as higher, a home under src/ and a reach above zero for every key', () => {
    for (const [key, reason] of Object.entries(SERVICE_REASONS)) {
      expect([key, ['board', 'release'].includes(reason.lower)]).toEqual([key, true]);
      expect([key, ['run', 'pr', 'release'].includes(reason.higher)]).toEqual([key, true]);
      expect([key, reason.home.startsWith('src/')]).toEqual([key, true]);
      expect([key, existsSync(resolve(ROOT, reason.home))]).toEqual([key, true]);
      expect([key, reason.reach > 0]).toEqual([key, true]);
      expect([key, reason.why.length > 0]).toEqual([key, true]);
    }
  });

  it('is frozen, each reason with it', () => {
    expect(Object.isFrozen(SERVICE_REASONS)).toBe(true);
    for (const reason of Object.values(SERVICE_REASONS)) expect(Object.isFrozen(reason)).toBe(true);
  });
});
