/**
 * Tests for the `status()` kind of {@link createHubContact} and for
 * {@link hubLine} and {@link hubFactsOf} (`contact.ts` beside this file).
 *
 * A stub `service` strategy is registered on a registry of this file's
 * own and handed to the loader as its base, so a config naming no module
 * selects it through `loadModules`, as `contact.test.ts` under
 * `src/tests/effort-coupled/` does for the other kinds. The stub records
 * every call it is asked, in order, so "no second read" is a count of the
 * `hubStatus` calls a run makes and their place after the pull, and each
 * case reads the written lines whole.
 *
 * Each claim sits beside a control that could have failed it: the hub
 * status asked after an answered pull beside each failed pull that skips
 * it, `pull()` asking no hub status beside `status()` asking it once, the
 * held-back ending beside a pull that held nothing, and the facts a
 * strategy answers beside one answering none or answering the wrong types.
 *
 * The file makes a registry of its own the active one for its cases,
 * holding core's `local` and `file` sync strategies, and puts back the
 * one it found after them: the package's own preload registers no
 * adapter, and the root's registers core's, so the contact's test of
 * which strategies are core's reads the same registry under either. Every
 * root is a path under a temporary directory of this file's own that is
 * never made.
 */
import type { HubContactSeams, HubLineFacts } from './contact.js';
import type { AdapterContext, AdapterRegistry, AnyAdapter } from '@open-tomato/rafa/core/adapters';
import type { ResolvedConfig } from '@open-tomato/rafa/core/config';
import type { Sync, SyncPullRequest, SyncPullResult, SyncPushRequest } from '@open-tomato/rafa/ports';

import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { activeAdapterRegistry, createAdapterRegistry, PORT_VERSIONS, restoreAdapters } from '@open-tomato/rafa/core/adapters';
import { parseConfigText, resolveConfig } from '@open-tomato/rafa/core/config';
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';

import {
  createHubContact,
  HUB_CONTRACT_MISMATCH,
  HUB_UNREACHABLE,
  hubFactsOf,
  hubLine,
  RAFA_UPDATE_REQUIRED,
} from './contact.js';
import { createFileSync } from './file.js';
import { createLocalSync } from './select.js';

const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-contact-status-')));

/** Core's two sync strategies, as `src/adapter-registry.ts` registers them, so a contact knows `local` and `file` as core's. */
const CORE_SYNCS: readonly AnyAdapter[] = Object.freeze([
  { port: 'sync', kind: 'local', portVersion: PORT_VERSIONS.sync, create: () => createLocalSync() },
  { port: 'sync', kind: 'file', portVersion: PORT_VERSIONS.sync, create: ({ repoRoot }: AdapterContext) => createFileSync({ repoRoot, backend: 'sqlite' }) },
]);

/** The active registry before this file's own, put back after its last case. */
let previous: AdapterRegistry | null = null;

beforeAll(() => {
  // Under the package's preload no adapter is registered, and under the root's core's are: this file's own holds the same either way.
  previous = activeAdapterRegistry();
  restoreAdapters(createAdapterRegistry(CORE_SYNCS));
});

afterAll(() => {
  if (previous !== null) restoreAdapters(previous);
  rmSync(tempBase, { recursive: true, force: true });
});

/** A registry holding core's two sync strategies and `adapter`, the loader's base. */
function registryWith(adapter: AnyAdapter): AdapterRegistry {
  return createAdapterRegistry([...CORE_SYNCS, adapter]);
}

/** A root under the temporary directory, never made. */
const ROOT = join(tempBase, 'repo');

/** A home under the temporary directory, never made. */
const HOME = join(tempBase, 'home');

/** The hub the service config names. */
const HUB_URL = 'http://127.0.0.1:7373';

/** The manifest seams the loader is held to. */
const MANIFEST_SEAMS = { rafaVersion: '0.1.0', portVersions: PORT_VERSIONS };

/** A project naming `service` and the hub. */
const SERVICE = `effort:\n  sync: service\nhub:\n  url: ${HUB_URL}\n`;

/** The project id the stub's hub status names. */
const PROJECT_ID = '4f3421e0c0ffee';

/** A hub status as the `service` strategy answers it, naming the project `rafa`. */
const HUB_STATUS = Object.freeze({ contractVersion: 1, projectId: PROJECT_ID, projectName: 'rafa', migrations: ['init', 'held-rows'] });

/** The line a projected pull answers as its notice. */
const PROJECTED_NOTICE = 'effort sync: pulled 7 rows projected to this rafa\'s schema; 2 columns wait for rafa self-update';

/** The line a `RafaUpdateRequired` carries. */
const RAFA_BEHIND_LINE = 'effort sync: this rafa is behind the hub (migration held-rows); nothing was merged.'
  + ' Next step: rafa self-update, then rafa effort sync';

/** A config as it resolves from a project file holding `text`. */
function resolving(text: string): ResolvedConfig {
  return resolveConfig({ cli: {}, file: parseConfigText(text, join(ROOT, '.rafa', 'config.yaml')), user: null });
}

/** The merge a `pulled` answer carries. */
type Merge = Extract<SyncPullResult, { readonly status: 'pulled' }>['merge'];

/** A merge that added `rowsAdded` rows and held `rowsHeld` back. */
function merged(rowsAdded: number, rowsHeld: number): Merge {
  return {
    path: join(ROOT, '.rafa', 'effort.sqlite'),
    otherPath: join(ROOT, 'scratch.sqlite'),
    status: 'merged',
    mergeId: 'merge-1',
    otherStore: null,
    otherBroughtForward: [],
    tables: [],
    rowsAdded,
    rowsSkipped: 0,
    rowsInConflict: 0,
    rowsHeld,
    rowsRefilled: 0,
    gapsRewritten: 0,
    backupPath: null,
  };
}

/** What the stub's pull does when called. */
type PullBehaviour =
  | { readonly answer: SyncPullResult }
  | 'unreachable'
  | 'mismatch'
  | 'rafa-behind'
  | 'refuse';

/** What the stub's `hubStatus` is: absent, or a call answering, rejecting or throwing. */
type HubStatusBehaviour =
  | 'absent'
  | 'not-a-function'
  | { readonly answer: unknown }
  | 'unreachable'
  | 'reject'
  | 'throw-now';

/** A named error as a module throws it, importing no value from core. */
function named(name: string, message: string): Error {
  return Object.assign(new Error(message), { name });
}

/** Acts out the pull's behaviour. */
function pulling(behaviour: PullBehaviour): Promise<SyncPullResult> {
  if (typeof behaviour === 'object') return Promise.resolve(behaviour.answer);
  switch (behaviour) {
    case 'unreachable': return Promise.reject(named(HUB_UNREACHABLE, 'connect ECONNREFUSED on pull'));
    case 'mismatch': {
      return Promise.reject(named(HUB_CONTRACT_MISMATCH, 'effort sync: the hub speaks contract 2, this rafa contract 1; nothing was sent. Next step: rafa self-update'));
    }
    case 'rafa-behind': return Promise.reject(named(RAFA_UPDATE_REQUIRED, RAFA_BEHIND_LINE));
    case 'refuse': return Promise.reject(new Error('the hub refused the token on pull (403)'));
  }
}

/** The `hubStatus` member the stub carries for `behaviour`, recording each call. */
function hubStatusMember(behaviour: HubStatusBehaviour, calls: string[]): Record<string, unknown> {
  if (behaviour === 'absent') return {};
  if (behaviour === 'not-a-function') return { hubStatus: HUB_STATUS };
  const hubStatus = (): Promise<unknown> => {
    calls.push('hubStatus');
    if (typeof behaviour === 'object') return Promise.resolve(behaviour.answer);
    switch (behaviour) {
      case 'unreachable': return Promise.reject(named(HUB_UNREACHABLE, 'timed out after 3000 ms on status'));
      case 'reject': return Promise.reject(new Error('the status answer was not JSON'));
      case 'throw-now': throw new Error('thrown before any promise on hub status');
    }
  };
  return { hubStatus };
}

/** A stub `service` strategy and what it was asked. */
interface Stub {
  readonly calls: string[];
  readonly seams: HubContactSeams;
}

/** Registers a stub `service` whose pull and `hubStatus` behave as named, as the loader's base registry. */
function stub(pull: PullBehaviour, hubStatus: HubStatusBehaviour): Stub {
  const calls: string[] = [];
  const create = (): Sync => ({
    kind: 'service',
    push: (request: SyncPushRequest) => {
      calls.push(`push ${JSON.stringify(request)}`);
      return Promise.resolve({ status: 'pushed', path: null } as const);
    },
    pull: (request: SyncPullRequest) => {
      calls.push(`pull ${JSON.stringify(request)}`);
      return pulling(pull);
    },
    ...hubStatusMember(hubStatus, calls),
  });
  const adapters = registryWith({ port: 'sync', kind: 'service', portVersion: PORT_VERSIONS.sync, create });
  return { calls, seams: { modules: { adapters, manifest: MANIFEST_SEAMS } } };
}

/** A contact over `text` whose written lines are captured, naming `sessionId` when given. */
function contacting(text: string, seams: HubContactSeams, sessionId?: string): {
  readonly lines: string[];
  readonly contact: ReturnType<typeof createHubContact>;
} {
  const lines: string[] = [];
  const warn = (line: string): void => {
    lines.push(line);
  };
  return { lines, contact: createHubContact({ root: ROOT, home: HOME, resolved: resolving(text), warn, sessionId }, seams) };
}

/** A pull that merged `rowsAdded` rows, holding `rowsHeld` back. */
function pulledRows(rowsAdded: number, rowsHeld = 0): PullBehaviour {
  return { answer: { status: 'pulled', merge: merged(rowsAdded, rowsHeld) } };
}

/** The facts a `status()` run answered, or a failure naming what it answered instead. */
function factsOf(reading: Awaited<ReturnType<ReturnType<typeof createHubContact>['status']>>): HubLineFacts {
  if (reading.state !== 'contacted' || reading.hub.outcome !== 'done') {
    throw new Error(`no hub facts: ${JSON.stringify(reading)}`);
  }
  return reading.hub.result;
}

describe('status() over a hub that answers', () => {
  it('pulls, then asks the hub status once, and answers the line\'s facts, writing nothing', async () => {
    const service = stub(pulledRows(312), { answer: HUB_STATUS });
    const { lines, contact } = contacting(SERVICE, service.seams);

    const reading = await contact.status();

    expect(reading).toMatchObject({ state: 'contacted', strategy: 'service', push: null, pull: { outcome: 'done' } });
    expect(factsOf(reading)).toEqual({ contractVersion: 1, projectId: PROJECT_ID, projectName: 'rafa', pulled: 312, heldBack: 0 });
    expect(service.calls).toEqual(['pull {"from":null,"dryRun":false}', 'hubStatus']);
    expect(lines).toEqual([]);
    expect(hubLine(factsOf(reading))).toBe('hub: reachable, contract 1, project rafa; pulled 312 rows');
  });

  it('pulls with the request pull() sends, the run\'s session id included', async () => {
    const sessionId = '11111111-2222-3333-4444-555555555555';
    const asStatus = stub(pulledRows(1), { answer: HUB_STATUS });
    const asPull = stub(pulledRows(1), { answer: HUB_STATUS });

    await contacting(SERVICE, asStatus.seams, sessionId).contact.status();
    await contacting(SERVICE, asPull.seams, sessionId).contact.pull();

    const pulls = (calls: readonly string[]): readonly string[] => calls.filter((call) => call.startsWith('pull '));
    expect(pulls(asStatus.calls)).toEqual(pulls(asPull.calls));
    expect(pulls(asStatus.calls)).toEqual([`pull {"from":null,"dryRun":false,"sessionId":"${sessionId}"}`]);
  });

  it('asks the hub status once per status() run, while pull() and pushThenPull() never ask it, the control', async () => {
    const service = stub(pulledRows(0), { answer: HUB_STATUS });
    const { contact } = contacting(SERVICE, service.seams);

    await contact.pull();
    await contact.pushThenPull();
    expect(service.calls.filter((call) => call === 'hubStatus')).toEqual([]);

    await contact.status();
    await contact.status();
    expect(service.calls.slice(3)).toEqual([
      'pull {"from":null,"dryRun":false}',
      'hubStatus',
      'pull {"from":null,"dryRun":false}',
      'hubStatus',
    ]);
  });

  it('answers 0 rows pulled for a pull with nothing to merge', async () => {
    const service = stub({ answer: { status: 'nothing-to-sync' } }, { answer: HUB_STATUS });
    const { contact } = contacting(SERVICE, service.seams);

    const facts = factsOf(await contact.status());

    expect(facts).toMatchObject({ pulled: 0, heldBack: 0 });
    expect(hubLine(facts)).toBe('hub: reachable, contract 1, project rafa; pulled 0 rows');
  });

  it('writes the pull\'s notice first and answers the rows held back, which end the line', async () => {
    const answer = { status: 'pulled', merge: merged(7, 4), notice: PROJECTED_NOTICE } as const;
    const service = stub({ answer }, { answer: HUB_STATUS });
    const { lines, contact } = contacting(SERVICE, service.seams);

    const facts = factsOf(await contact.status());

    expect(lines).toEqual([PROJECTED_NOTICE]);
    expect(facts).toMatchObject({ pulled: 7, heldBack: 4 });
    expect(hubLine(facts)).toBe('hub: reachable, contract 1, project rafa; pulled 7 rows; 4 rows held back');
  });

  it('calls a hubStatus that reads this off its strategy with the strategy as this', async () => {
    const calls: string[] = [];
    class Strategy implements Sync {
      readonly kind = 'service';
      readonly name = 'from this';
      push(): Promise<{ readonly status: 'nothing-to-sync' }> {
        return Promise.resolve({ status: 'nothing-to-sync' });
      }
      pull(): Promise<{ readonly status: 'nothing-to-sync' }> {
        calls.push('pull');
        return Promise.resolve({ status: 'nothing-to-sync' });
      }
      hubStatus(): Promise<unknown> {
        calls.push('hubStatus');
        return Promise.resolve({ ...HUB_STATUS, projectName: this.name });
      }
    }
    const create = (): Sync => new Strategy();
    const adapters = registryWith({ port: 'sync', kind: 'service', portVersion: PORT_VERSIONS.sync, create });
    const { contact } = contacting(SERVICE, { modules: { adapters, manifest: MANIFEST_SEAMS } });

    expect(factsOf(await contact.status()).projectName).toBe('from this');
    expect(calls).toEqual(['pull', 'hubStatus']);
  });
});

describe('status() after a pull that did not answer', () => {
  it.each([
    ['unreachable', 'unreachable', 'effort sync: the hub at http://127.0.0.1:7373 is unreachable (connect ECONNREFUSED on pull);'
      + ' this command used the local store, and its rows sync on the next contact'],
    ['mismatch', 'mismatch', 'effort sync: the hub speaks contract 2, this rafa contract 1; nothing was sent. Next step: rafa self-update'],
    ['refused', 'rafa-behind', RAFA_BEHIND_LINE],
    ['failed', 'refuse', 'effort sync: pull over service failed: the hub refused the token on pull (403)'],
  ] as const)('skips the hub status after a pull that came to %s, its own line the only one', async (outcome, behaviour, line) => {
    const service = stub(behaviour, { answer: HUB_STATUS });
    const { lines, contact } = contacting(SERVICE, service.seams);

    const reading = await contact.status();

    expect(reading).toMatchObject({ state: 'contacted', pull: { outcome }, hub: { outcome: 'skipped' } });
    expect(service.calls).toEqual(['pull {"from":null,"dryRun":false}']);
    expect(lines).toEqual([line]);
  });

  it('writes the unreachable line once across two runs of one contact, and asks no hub status in either', async () => {
    const service = stub('unreachable', { answer: HUB_STATUS });
    const { lines, contact } = contacting(SERVICE, service.seams);

    await contact.status();
    await contact.status();

    expect(lines).toHaveLength(1);
    expect(service.calls.filter((call) => call === 'hubStatus')).toEqual([]);
  });
});

describe('status() over a strategy whose hub status answers nothing usable', () => {
  it.each([
    ['has no hubStatus', 'absent'],
    ['has a hubStatus that is no function', 'not-a-function'],
    ['answers no object', { answer: 'contract 1' }],
    ['answers null', { answer: null }],
  ] as const)('answers every hub fact unknown when the strategy %s, and writes nothing', async (_case, behaviour) => {
    const service = stub(pulledRows(3), behaviour);
    const { lines, contact } = contacting(SERVICE, service.seams);

    const facts = factsOf(await contact.status());

    expect(facts).toEqual({ contractVersion: null, projectId: null, projectName: null, pulled: 3, heldBack: 0 });
    expect(hubLine(facts)).toBe('hub: reachable, contract unknown, project unknown; pulled 3 rows');
    expect(lines).toEqual([]);
  });

  it('names the project by its id when the hub names it nothing', async () => {
    const service = stub(pulledRows(2), { answer: { ...HUB_STATUS, projectName: null } });
    const { contact } = contacting(SERVICE, service.seams);

    expect(hubLine(factsOf(await contact.status()))).toBe(`hub: reachable, contract 1, project ${PROJECT_ID}; pulled 2 rows`);
  });

  it.each([
    ['rejects', 'reject', 'failed', 'effort sync: hub status over service failed: the status answer was not JSON'],
    ['throws before any promise', 'throw-now', 'failed', 'effort sync: hub status over service failed: thrown before any promise on hub status'],
    ['finds the hub unreachable', 'unreachable', 'unreachable', 'effort sync: the hub at http://127.0.0.1:7373 is unreachable'
      + ' (timed out after 3000 ms on status); this command used the local store, and its rows sync on the next contact'],
  ] as const)('writes the one line in the hub line\'s place when hubStatus %s, and never throws', async (_case, behaviour, outcome, line) => {
    const service = stub(pulledRows(5), behaviour);
    const { lines, contact } = contacting(SERVICE, service.seams);
    const before = process.exitCode;

    const reading = await contact.status();

    expect(reading).toMatchObject({ state: 'contacted', pull: { outcome: 'done' }, hub: { outcome } });
    expect(lines).toEqual([line]);
    expect(process.exitCode).toBe(before);
  });
});

describe('status() under a strategy that is not contacted', () => {
  it.each([
    ['local', 'effort:\n  sync: local\n'],
    ['file', 'effort:\n  sync: file\n'],
  ])('answers %s as not contacted, with no hub step, asking nothing and writing nothing', async (strategy, text) => {
    const service = stub(pulledRows(1), { answer: HUB_STATUS });
    const { lines, contact } = contacting(text, service.seams);

    expect(await contact.status()).toEqual({ state: 'not-contacted', strategy });
    expect(service.calls).toEqual([]);
    expect(lines).toEqual([]);
  });

  it('answers a strategy no module registers as unselected, with no hub step, writing the problem once', async () => {
    const { lines, contact } = contacting('effort:\n  sync: p2p\n', { modules: { manifest: MANIFEST_SEAMS } });

    const reading = await contact.status();

    expect(reading).toMatchObject({ state: 'unselected', strategy: 'p2p' });
    expect('hub' in reading).toBe(false);
    expect(lines).toHaveLength(1);
  });
});

describe('hubFactsOf', () => {
  it('reads the three facts off a service hub status, leaving its migrations', () => {
    expect(hubFactsOf(HUB_STATUS)).toEqual({ contractVersion: 1, projectId: PROJECT_ID, projectName: 'rafa' });
  });

  it.each([
    ['a contract version that is no integer', { ...HUB_STATUS, contractVersion: 1.5 }, { contractVersion: null }],
    ['a contract version given as a string', { ...HUB_STATUS, contractVersion: '1' }, { contractVersion: null }],
    ['an empty project id', { ...HUB_STATUS, projectId: '  ' }, { projectId: null }],
    ['a project name that is no string', { ...HUB_STATUS, projectName: 7 }, { projectName: null }],
  ])('answers null for %s, and the other facts as they are', (_case, answer, unknown) => {
    expect(hubFactsOf(answer)).toEqual({ contractVersion: 1, projectId: PROJECT_ID, projectName: 'rafa', ...unknown });
  });
});

describe('hubLine', () => {
  const facts: HubLineFacts = { contractVersion: 2, projectId: PROJECT_ID, projectName: 'rafa', pulled: 1, heldBack: 0 };

  it('names the contract, the project and the rows pulled, ending with no held-back count when none were', () => {
    expect(hubLine(facts)).toBe('hub: reachable, contract 2, project rafa; pulled 1 rows');
  });

  it('ends with the rows held back when some were', () => {
    expect(hubLine({ ...facts, heldBack: 12 })).toBe('hub: reachable, contract 2, project rafa; pulled 1 rows; 12 rows held back');
  });

  it('is one line', () => {
    expect(hubLine({ ...facts, heldBack: 3 }).split('\n')).toHaveLength(1);
  });
});
