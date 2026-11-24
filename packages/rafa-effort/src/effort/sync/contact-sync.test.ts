/**
 * Tests for the `sync({ stop })` kind of {@link createHubContact}, and
 * for {@link skewCheck} and {@link refusalCauseOf} (`contact.ts` and
 * `contact-facts.ts` beside this file).
 *
 * A stub `service` strategy is registered on a registry of this file's
 * own and handed to the loader as its base, as `contact-status.test.ts`
 * does. The stub records every call it is asked, in order, so each stop
 * point is read as the calls a run made and the ones it did not, and
 * each refusal as the one line written and the steps left unrun.
 *
 * Each claim sits beside a control that could have failed it: a whole
 * sync pushing and pulling beside `status` and `dry-run` stopping short
 * of it; a dry-run push sent to a strategy with a dry run beside one
 * withheld from a strategy without; each refusal beside the same hub
 * answering with nothing to refuse; the rafa-behind refusal beside
 * `pull-projected` letting it through; and a token error refusing
 * `sync()` beside `pull()` writing the same error inside its failed
 * wrap.
 *
 * The file makes a registry of its own the active one for its cases,
 * holding core's `local` and `file` sync strategies, and puts back the
 * one it found after them, so the contact's test of which strategies
 * are core's reads the same registry under the package's preload and
 * the root's. Every root is a path under a temporary directory of this
 * file's own that is never made.
 */
import type { HubContactSeams, HubSyncContacted, HubSyncReading, HubSyncStatus } from './contact.js';
import type { AdapterContext, AdapterRegistry, AnyAdapter } from '@open-tomato/rafa/core/adapters';
import type { ResolvedConfig } from '@open-tomato/rafa/core/config';
import type { Sync, SyncPullRequest, SyncPullResult, SyncPushRequest, SyncPushResult } from '@open-tomato/rafa/ports';

import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { activeAdapterRegistry, createAdapterRegistry, PORT_VERSIONS, restoreAdapters } from '@open-tomato/rafa/core/adapters';
import { parseConfigText, resolveConfig } from '@open-tomato/rafa/core/config';
import { WIRE_CONTRACT_VERSION } from '@open-tomato/rafa/store';
import { SQLITE_MIGRATIONS } from '@open-tomato/rafa/store/migrations';
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';

import {
  createHubContact,
  HUB_CONTRACT_MISMATCH,
  HUB_PROJECT_NOT_SERVED,
  HUB_TOKEN_ERROR,
  HUB_UNREACHABLE,
  HUB_UPGRADE_REQUIRED,
  RAFA_UPDATE_REQUIRED,
  refusalCauseOf,
  skewCheck,
} from './contact.js';
import { createFileSync } from './file.js';
import { createLocalSync } from './select.js';

const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-contact-sync-')));

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

/** A root under the temporary directory, never made. */
const ROOT = join(tempBase, 'repo');

/** A home under the temporary directory, never made. */
const HOME = join(tempBase, 'home');

/** The hub the service config names. */
const HUB_URL = 'http://127.0.0.1:7373';

/** The manifest seams the loader is held to. */
const MANIFEST_SEAMS = { rafaVersion: '0.1.0', portVersions: PORT_VERSIONS };

/** A project naming `service` and the hub, under the default `effort.syncSkew: refuse`. */
const SERVICE = `effort:\n  sync: service\nhub:\n  url: ${HUB_URL}\n`;

/** The same project under `effort.syncSkew: pull-projected`. */
const SERVICE_PROJECTED = `effort:\n  sync: service\n  syncSkew: pull-projected\nhub:\n  url: ${HUB_URL}\n`;

/** The migration ids this file's contacts know, handed in as the contact's seam. */
const KNOWN: readonly string[] = Object.freeze(['init', 'held-rows', 'skill-use']);

/** The project id the stub's hub status names. */
const PROJECT_ID = '4f3421e0c0ffee';

/** A hub status as the `service` strategy answers it, holding the migrations this file's contacts know. */
const HUB_STATUS = Object.freeze({ contractVersion: WIRE_CONTRACT_VERSION, projectId: PROJECT_ID, projectName: 'rafa', migrations: KNOWN });

/** What the status read answers for {@link HUB_STATUS}. */
const STATUS_FACTS: HubSyncStatus = { contractVersion: WIRE_CONTRACT_VERSION, projectId: PROJECT_ID, projectName: 'rafa', migrations: KNOWN };

/** The rows the stub's dry-run push says it would send. */
const DRY_RUN_ROWS = 9;

/** The rows the stub's `pendingPush()` counts. */
const PENDING_ROWS = 4;

/** The line the hub-behind refusal writes when the hub lacks `skill-use`. */
const HUB_BEHIND_LINE = 'effort sync: the hub is behind this rafa (migration skill-use); nothing was sent.'
  + ' Next step: upgrade the hub, then rafa effort sync';

/** The line the rafa-behind refusal writes when the hub holds `wire-v2`. */
const RAFA_BEHIND_LINE = 'effort sync: this rafa is behind the hub (migration wire-v2); nothing was merged.'
  + ' Next step: rafa self-update, then rafa effort sync';

/** The hub's own refusal of an unserved project, as the client wraps it. */
const NOT_SERVED = `the hub refused push: HTTP 404: rafa-hub: project ${PROJECT_ID} is not served here; add it under hub.projects`;

/** The token reader's line when `hub.tokenSecret` is unset. */
const TOKEN_UNSET = 'hub.tokenSecret is not set: name the secret holding the hub token in .rafa/config.yaml';

/** A config as it resolves from a project file holding `text`. */
function resolving(text: string): ResolvedConfig {
  return resolveConfig({ cli: {}, file: parseConfigText(text, join(ROOT, '.rafa', 'config.yaml')), user: null });
}

/** The merge a `pulled` answer carries. */
type Merge = Extract<SyncPullResult, { readonly status: 'pulled' }>['merge'];

/** A merge that added `rowsAdded` rows, found `rowsInConflict` in conflict and held `rowsHeld` back. */
function merged(rowsAdded: number, rowsInConflict: number, rowsHeld = 0): Merge {
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
    rowsInConflict,
    rowsHeld,
    rowsRefilled: 0,
    gapsRewritten: 0,
    backupPath: null,
  };
}

/** A named error as a module throws it, importing no value from core. */
function named(name: string, message: string): Error {
  return Object.assign(new Error(message), { name });
}

/** How the stub's members behave; each left out answers as a `service` strategy over a hub that agrees would. */
interface StubParts {
  readonly hubStatus?: (() => Promise<unknown>) | 'absent';
  readonly pendingPush?: (() => Promise<unknown>) | 'absent';
  readonly push?: (request: SyncPushRequest) => Promise<SyncPushResult>;
  readonly pull?: (request: SyncPullRequest) => Promise<SyncPullResult>;
}

/** A stub `service` strategy and what it was asked. */
interface Stub {
  readonly calls: string[];
  readonly seams: HubContactSeams;
}

/** The push a `service` strategy answers: a dry run's counting its rows, any other's delivered. */
function servicePush(request: SyncPushRequest): Promise<SyncPushResult> {
  const { dryRun } = request as { readonly dryRun?: unknown };
  return Promise.resolve(dryRun === true
    ? { status: 'pushed', path: null, dryRun: true, rows: DRY_RUN_ROWS } as SyncPushResult
    : { status: 'pushed', path: null });
}

/** A pull that merged 312 rows, two of them in conflict. */
function servicePull(): Promise<SyncPullResult> {
  return Promise.resolve({ status: 'pulled', merge: merged(312, 2) });
}

/** The optional member `name` of the stub, recording each call, or none when it is absent. */
function member(name: 'hubStatus' | 'pendingPush', part: (() => Promise<unknown>) | 'absent', calls: string[]): Record<string, unknown> {
  if (part === 'absent') return {};
  return {
    [name]: () => {
      calls.push(name);
      return part();
    },
  };
}

/** Registers a stub `service` whose members behave as `parts` says, as the loader's base registry, knowing {@link KNOWN}. */
function stub(parts: StubParts = {}): Stub {
  const calls: string[] = [];
  const push = parts.push ?? servicePush;
  const pull = parts.pull ?? servicePull;
  const create = (): Sync => ({
    kind: 'service',
    push: (request: SyncPushRequest) => {
      calls.push(`push ${JSON.stringify(request)}`);
      return push(request);
    },
    pull: (request: SyncPullRequest) => {
      calls.push(`pull ${JSON.stringify(request)}`);
      return pull(request);
    },
    ...member('hubStatus', parts.hubStatus ?? (() => Promise.resolve(HUB_STATUS)), calls),
    ...member('pendingPush', parts.pendingPush ?? (() => Promise.resolve(PENDING_ROWS)), calls),
  });
  const adapters = createAdapterRegistry([...CORE_SYNCS, { port: 'sync', kind: 'service', portVersion: PORT_VERSIONS.sync, create }]);
  return { calls, seams: { modules: { adapters, manifest: MANIFEST_SEAMS }, migrations: KNOWN } };
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

/** The contacted reading, or a failure naming what was answered instead. */
function contacted(reading: HubSyncReading): HubSyncContacted {
  if (reading.state !== 'contacted') throw new Error(`not contacted: ${JSON.stringify(reading)}`);
  return reading;
}

/** The hub status answered with `fields` over {@link HUB_STATUS}. */
function statusWith(fields: Readonly<Record<string, unknown>>): () => Promise<unknown> {
  return () => Promise.resolve({ ...HUB_STATUS, ...fields });
}

/** A push or pull rejecting with `error`. */
function rejecting(error: Error): () => Promise<never> {
  return () => Promise.reject(error);
}

describe('sync() with no stop', () => {
  it('reads the status, pushes, then pulls, in order, and answers the hub line\'s facts with no second status read', async () => {
    const service = stub();
    const { lines, contact } = contacting(SERVICE, service.seams);

    const reading = await contact.sync();

    expect(service.calls).toEqual(['hubStatus', 'push {"to":null}', 'pull {"from":null,"dryRun":false}']);
    expect(reading).toEqual({
      state: 'contacted',
      strategy: 'service',
      stop: null,
      status: { outcome: 'done', result: STATUS_FACTS },
      refusal: null,
      pending: null,
      push: { outcome: 'done', result: { status: 'pushed', path: null } },
      pull: { outcome: 'done', result: { status: 'pulled', merge: merged(312, 2) } },
      hub: {
        outcome: 'done',
        result: { contractVersion: WIRE_CONTRACT_VERSION, projectId: PROJECT_ID, projectName: 'rafa', pulled: 312, heldBack: 0, conflicts: 2 },
      },
    });
    expect(lines).toEqual([]);
  });

  it('runs every step for an explicit null stop, as for none', async () => {
    const service = stub();
    const { contact } = contacting(SERVICE, service.seams);

    expect(contacted(await contact.sync({ stop: null })).stop).toBeNull();
    expect(service.calls).toEqual(['hubStatus', 'push {"to":null}', 'pull {"from":null,"dryRun":false}']);
  });

  it('pulls with the run\'s session id, as pull() does', async () => {
    const sessionId = '11111111-2222-3333-4444-555555555555';
    const service = stub();

    await contacting(SERVICE, service.seams, sessionId).contact.sync();

    expect(service.calls.at(-1)).toBe(`pull {"from":null,"dryRun":false,"sessionId":"${sessionId}"}`);
  });

  it('writes the pull\'s notice and carries the rows held back into the facts', async () => {
    const notice = 'effort sync: pulled 7 rows projected to this rafa\'s schema; 2 columns wait for rafa self-update';
    const service = stub({ pull: () => Promise.resolve({ status: 'pulled', merge: merged(7, 0, 4), notice } as SyncPullResult) });
    const { lines, contact } = contacting(SERVICE, service.seams);

    const { hub } = contacted(await contact.sync());

    expect(lines).toEqual([notice]);
    expect(hub).toMatchObject({ outcome: 'done', result: { pulled: 7, heldBack: 4, conflicts: 0 } });
  });

  it('answers every hub fact unknown for a strategy with no hubStatus, and still pushes and pulls', async () => {
    const service = stub({ hubStatus: 'absent' });
    const { lines, contact } = contacting(SERVICE, service.seams);

    const reading = contacted(await contact.sync());

    expect(reading.status).toEqual({ outcome: 'done', result: { contractVersion: null, projectId: null, projectName: null, migrations: null } });
    expect(reading.refusal).toBeNull();
    expect(service.calls).toEqual(['push {"to":null}', 'pull {"from":null,"dryRun":false}']);
    expect(lines).toEqual([]);
  });

  it('still pulls after a push that failed for another reason, refusing nothing', async () => {
    const service = stub({ push: rejecting(new Error('the hub refused push: HTTP 409')) });
    const { lines, contact } = contacting(SERVICE, service.seams);

    const reading = contacted(await contact.sync());

    expect(reading).toMatchObject({ refusal: null, push: { outcome: 'failed' }, pull: { outcome: 'done' }, hub: { outcome: 'done' } });
    expect(lines).toEqual(['effort sync: push over service failed: the hub refused push: HTTP 409']);
  });
});

describe('sync() stopping at status', () => {
  it('reads the status and counts the rows waiting, sending and merging nothing', async () => {
    const service = stub();
    const { lines, contact } = contacting(SERVICE, service.seams);

    const reading = await contact.sync({ stop: 'status' });

    expect(service.calls).toEqual(['hubStatus', 'pendingPush']);
    expect(reading).toEqual({
      state: 'contacted',
      strategy: 'service',
      stop: 'status',
      status: { outcome: 'done', result: STATUS_FACTS },
      refusal: null,
      pending: { outcome: 'done', result: PENDING_ROWS },
      push: null,
      pull: null,
      hub: { outcome: 'skipped' },
    });
    expect(lines).toEqual([]);
  });

  it('answers the rows waiting unknown for a strategy with no pendingPush', async () => {
    const service = stub({ pendingPush: 'absent' });
    const { contact } = contacting(SERVICE, service.seams);

    expect(contacted(await contact.sync({ stop: 'status' })).pending).toEqual({ outcome: 'done', result: null });
    expect(service.calls).toEqual(['hubStatus']);
  });

  it('writes a pendingPush that rejects as a failure, and still sends nothing', async () => {
    const service = stub({ pendingPush: rejecting(new Error('the store is NDJSON')) });
    const { lines, contact } = contacting(SERVICE, service.seams);

    const reading = contacted(await contact.sync({ stop: 'status' }));

    expect(reading.pending).toEqual({ outcome: 'failed', problem: 'the store is NDJSON' });
    expect(reading.refusal).toBeNull();
    expect(lines).toEqual(['effort sync: pending push over service failed: the store is NDJSON']);
    expect(service.calls).toEqual(['hubStatus', 'pendingPush']);
  });

  it('answers the skew refusal step 2 finds, and asks no count', async () => {
    const service = stub({ hubStatus: statusWith({ migrations: ['init', 'held-rows'] }) });
    const { lines, contact } = contacting(SERVICE, service.seams);

    const reading = contacted(await contact.sync({ stop: 'status' }));

    expect(reading.refusal).toEqual({ cause: 'skew', line: HUB_BEHIND_LINE });
    expect(reading.pending).toBeNull();
    expect(service.calls).toEqual(['hubStatus']);
    expect(lines).toEqual([HUB_BEHIND_LINE]);
  });
});

describe('sync() stopping at dry-run', () => {
  it('asks a dry-run push and a dry-run pull, answering the rows each would move and the conflicts', async () => {
    const service = stub();
    const { lines, contact } = contacting(SERVICE, service.seams);

    const reading = contacted(await contact.sync({ stop: 'dry-run' }));

    expect(service.calls).toEqual(['hubStatus', 'push {"to":null,"dryRun":true}', 'pull {"from":null,"dryRun":true}']);
    expect(reading).toMatchObject({
      stop: 'dry-run',
      refusal: null,
      pending: { outcome: 'done', result: DRY_RUN_ROWS },
      push: { outcome: 'done', result: { status: 'pushed', dryRun: true, rows: DRY_RUN_ROWS } },
      hub: { outcome: 'done', result: { pulled: 312, conflicts: 2 } },
    });
    expect(lines).toEqual([]);
  });

  it('answers 0 rows waiting for a dry-run push with no store to read', async () => {
    const service = stub({ push: () => Promise.resolve({ status: 'nothing-to-sync' }) });
    const { contact } = contacting(SERVICE, service.seams);

    expect(contacted(await contact.sync({ stop: 'dry-run' })).pending).toEqual({ outcome: 'done', result: 0 });
  });

  it('withholds the push from a strategy with no dry run, and still pulls without writing', async () => {
    const service = stub({ pendingPush: 'absent' });
    const { contact } = contacting(SERVICE, service.seams);

    const reading = contacted(await contact.sync({ stop: 'dry-run' }));

    expect(service.calls).toEqual(['hubStatus', 'pull {"from":null,"dryRun":true}']);
    expect(reading).toMatchObject({ push: { outcome: 'skipped' }, pending: { outcome: 'done', result: null }, hub: { outcome: 'done' } });
  });

  it('answers the rows waiting unknown when a dry-run push answers no count', async () => {
    const service = stub({ push: () => Promise.resolve({ status: 'pushed', path: null }) });
    const { contact } = contacting(SERVICE, service.seams);

    expect(contacted(await contact.sync({ stop: 'dry-run' })).pending).toEqual({ outcome: 'done', result: null });
  });
});

describe('sync() refused for skew', () => {
  it('refuses a hub lacking a migration this rafa knows at step 2, pushing and pulling nothing', async () => {
    const service = stub({ hubStatus: statusWith({ migrations: ['init', 'held-rows'] }) });
    const { lines, contact } = contacting(SERVICE, service.seams);

    const reading = contacted(await contact.sync());

    expect(reading).toMatchObject({ refusal: { cause: 'skew', line: HUB_BEHIND_LINE }, push: null, pull: null, hub: { outcome: 'skipped' } });
    expect(service.calls).toEqual(['hubStatus']);
    expect(lines).toEqual([HUB_BEHIND_LINE]);
  });

  it('refuses a hub holding a migration this rafa lacks under refuse', async () => {
    const service = stub({ hubStatus: statusWith({ migrations: [...KNOWN, 'wire-v2'] }) });
    const { lines, contact } = contacting(SERVICE, service.seams);

    expect(contacted(await contact.sync()).refusal).toEqual({ cause: 'skew', line: RAFA_BEHIND_LINE });
    expect(service.calls).toEqual(['hubStatus']);
    expect(lines).toEqual([RAFA_BEHIND_LINE]);
  });

  it('lets the same hub through under pull-projected, whose pull projects the rows, the control', async () => {
    const service = stub({ hubStatus: statusWith({ migrations: [...KNOWN, 'wire-v2'] }) });
    const { lines, contact } = contacting(SERVICE_PROJECTED, service.seams);

    expect(contacted(await contact.sync()).refusal).toBeNull();
    expect(service.calls).toEqual(['hubStatus', 'push {"to":null}', 'pull {"from":null,"dryRun":false}']);
    expect(lines).toEqual([]);
  });

  it('refuses a push the hub answered with HubUpgradeRequired, and skips the pull', async () => {
    const service = stub({ hubStatus: statusWith({ migrations: null }), push: rejecting(named(HUB_UPGRADE_REQUIRED, HUB_BEHIND_LINE)) });
    const { lines, contact } = contacting(SERVICE, service.seams);

    const reading = contacted(await contact.sync());

    expect(reading).toMatchObject({ refusal: { cause: 'skew', line: HUB_BEHIND_LINE }, push: { outcome: 'refused' }, pull: null });
    expect(service.calls).toEqual(['hubStatus', 'push {"to":null}']);
    expect(lines).toEqual([HUB_BEHIND_LINE]);
  });

  it('refuses a pull the hub answered with RafaUpdateRequired', async () => {
    const service = stub({ pull: rejecting(named(RAFA_UPDATE_REQUIRED, RAFA_BEHIND_LINE)) });
    const { lines, contact } = contacting(SERVICE, service.seams);

    const reading = contacted(await contact.sync());

    expect(reading).toMatchObject({ refusal: { cause: 'skew', line: RAFA_BEHIND_LINE }, pull: { outcome: 'refused' }, hub: { outcome: 'skipped' } });
    expect(lines).toEqual([RAFA_BEHIND_LINE]);
  });

  it('reads this rafa\'s side off core\'s catalogue when the seam names none', async () => {
    const catalogue = SQLITE_MIGRATIONS.map(({ id }) => id);
    const last = catalogue.at(-1) ?? '';
    const agreeing = stub({ hubStatus: statusWith({ migrations: catalogue }) });
    const lacking = stub({ hubStatus: statusWith({ migrations: catalogue.slice(0, -1) }) });

    const agreed = await contacting(SERVICE, { modules: agreeing.seams.modules }).contact.sync({ stop: 'status' });
    const lacked = await contacting(SERVICE, { modules: lacking.seams.modules }).contact.sync({ stop: 'status' });

    expect(contacted(agreed).refusal).toBeNull();
    expect(contacted(lacked).refusal?.line).toContain(`(migration ${last})`);
  });
});

describe('sync() refused for the contract', () => {
  it.each([
    ['ahead of', WIRE_CONTRACT_VERSION + 1, 'rafa self-update'],
    ['behind', WIRE_CONTRACT_VERSION - 1, `upgrade the hub at ${HUB_URL} to a rafa-hub that speaks this rafa's contract`],
  ])('refuses a hub %s this rafa\'s contract at step 2, naming the next step', async (_case, version, step) => {
    const service = stub({ hubStatus: statusWith({ contractVersion: version }) });
    const { lines, contact } = contacting(SERVICE, service.seams);
    const line = `effort sync: the hub speaks contract ${String(version)}, this rafa contract ${String(WIRE_CONTRACT_VERSION)};`
      + ` nothing was sent. Next step: ${step}`;

    const reading = contacted(await contact.sync());

    expect(reading).toMatchObject({ refusal: { cause: 'contract', line }, push: null, pull: null });
    expect(service.calls).toEqual(['hubStatus']);
    expect(lines).toEqual([line]);
  });

  it('refuses a push rejecting with HubContractMismatch, and skips the pull', async () => {
    const line = 'effort sync: the hub speaks contract 2, this rafa contract 1; nothing was sent. Next step: rafa self-update';
    const service = stub({ hubStatus: 'absent', push: rejecting(named(HUB_CONTRACT_MISMATCH, line)) });
    const { lines, contact } = contacting(SERVICE, service.seams);

    const reading = contacted(await contact.sync());

    expect(reading).toMatchObject({ refusal: { cause: 'contract', line }, push: { outcome: 'mismatch', problem: line }, pull: null });
    expect(lines).toEqual([line]);
  });
});

describe('sync() refused for the project', () => {
  it('refuses a push the hub answered with its unserved-project line, and skips the pull', async () => {
    const service = stub({ push: rejecting(new Error(NOT_SERVED)) });
    const { lines, contact } = contacting(SERVICE, service.seams);

    const reading = contacted(await contact.sync());

    expect(reading).toMatchObject({ refusal: { cause: 'project', line: `effort sync: ${NOT_SERVED}` }, push: { outcome: 'refused' }, pull: null });
    expect(service.calls).toEqual(['hubStatus', 'push {"to":null}']);
    expect(lines).toEqual([`effort sync: ${NOT_SERVED}`]);
  });

  it('refuses a pull rejecting with an error named HubProjectNotServed', async () => {
    const message = `rafa-hub: project ${PROJECT_ID} is not served here; add it under hub.projects`;
    const service = stub({ pull: rejecting(named(HUB_PROJECT_NOT_SERVED, message)) });
    const { lines, contact } = contacting(SERVICE, service.seams);

    expect(contacted(await contact.sync()).refusal).toEqual({ cause: 'project', line: `effort sync: ${message}` });
    expect(lines).toEqual([`effort sync: ${message}`]);
  });
});

describe('sync() refused for the token', () => {
  it('refuses a status read the token reader rejected, pushing and pulling nothing', async () => {
    const service = stub({ hubStatus: rejecting(named(HUB_TOKEN_ERROR, TOKEN_UNSET)) });
    const { lines, contact } = contacting(SERVICE, service.seams);

    const reading = contacted(await contact.sync());

    expect(reading).toMatchObject({
      refusal: { cause: 'token', line: `effort sync: ${TOKEN_UNSET}` },
      status: { outcome: 'refused' },
      push: null,
      pull: null,
      hub: { outcome: 'skipped' },
    });
    expect(service.calls).toEqual(['hubStatus']);
    expect(lines).toEqual([`effort sync: ${TOKEN_UNSET}`]);
  });

  it('writes the token line once across two runs of one contact, each reading refused', async () => {
    const service = stub({ hubStatus: rejecting(named(HUB_TOKEN_ERROR, TOKEN_UNSET)) });
    const { lines, contact } = contacting(SERVICE, service.seams);

    const first = contacted(await contact.sync());
    const second = contacted(await contact.sync({ stop: 'status' }));

    expect([first.refusal?.cause, second.refusal?.cause]).toEqual(['token', 'token']);
    expect(lines).toEqual([`effort sync: ${TOKEN_UNSET}`]);
  });

  it('while pull() writes the same error inside its failed wrap and refuses nothing, the control', async () => {
    const service = stub({ pull: rejecting(named(HUB_TOKEN_ERROR, TOKEN_UNSET)) });
    const { lines, contact } = contacting(SERVICE, service.seams);

    expect(await contact.pull()).toMatchObject({ pull: { outcome: 'failed', problem: TOKEN_UNSET } });
    expect(lines).toEqual([`effort sync: pull over service failed: ${TOKEN_UNSET}`]);
  });
});

describe('sync() over a hub that does not answer', () => {
  it('stops at an unreachable status read with the offline line and no refusal, never throwing', async () => {
    const service = stub({ hubStatus: rejecting(named(HUB_UNREACHABLE, 'connect ECONNREFUSED')) });
    const { lines, contact } = contacting(SERVICE, service.seams);
    const before = process.exitCode;

    const reading = contacted(await contact.sync());

    expect(reading).toMatchObject({ refusal: null, status: { outcome: 'unreachable' }, push: null, pull: null, hub: { outcome: 'skipped' } });
    expect(service.calls).toEqual(['hubStatus']);
    expect(lines).toEqual([`effort sync: the hub at ${HUB_URL} is unreachable (connect ECONNREFUSED);`
      + ' this command used the local store, and its rows sync on the next contact']);
    expect(process.exitCode).toBe(before);
  });

  it('stops at a status read that failed, writing its failure and refusing nothing', async () => {
    const service = stub({ hubStatus: rejecting(new Error('the hub\'s answer to status is not JSON')) });
    const { lines, contact } = contacting(SERVICE, service.seams);

    expect(contacted(await contact.sync())).toMatchObject({ refusal: null, status: { outcome: 'failed' }, push: null });
    expect(lines).toEqual(['effort sync: hub status over service failed: the hub\'s answer to status is not JSON']);
  });

  it('skips the pull after an unreachable push, refusing nothing', async () => {
    const service = stub({ push: rejecting(named(HUB_UNREACHABLE, 'timed out after 3000 ms')) });
    const { lines, contact } = contacting(SERVICE, service.seams);

    expect(contacted(await contact.sync())).toMatchObject({ refusal: null, push: { outcome: 'unreachable' }, pull: null });
    expect(service.calls).toEqual(['hubStatus', 'push {"to":null}']);
    expect(lines).toHaveLength(1);
  });
});

describe('sync() under a strategy that is not contacted', () => {
  it.each([
    ['local', 'effort:\n  sync: local\n'],
    ['file', 'effort:\n  sync: file\n'],
  ])('answers %s as not contacted, asking nothing and writing nothing', async (strategy, text) => {
    const service = stub();
    const { lines, contact } = contacting(text, service.seams);

    expect(await contact.sync()).toEqual({ state: 'not-contacted', strategy });
    expect(service.calls).toEqual([]);
    expect(lines).toEqual([]);
  });

  it('answers a strategy no module registers as unselected, writing the problem once', async () => {
    const { lines, contact } = contacting('effort:\n  sync: p2p\n', { modules: { manifest: MANIFEST_SEAMS } });

    expect(await contact.sync({ stop: 'status' })).toMatchObject({ state: 'unselected', strategy: 'p2p' });
    expect(lines).toHaveLength(1);
  });
});

describe('skewCheck', () => {
  const input = { status: STATUS_FACTS, migrations: KNOWN, syncSkew: 'refuse', hubUrl: HUB_URL };

  it('answers no refusal for a hub on this rafa\'s contract and migrations', () => {
    expect(skewCheck(input)).toBeNull();
  });

  it('checks the contract before the migrations', () => {
    const status = { ...STATUS_FACTS, contractVersion: WIRE_CONTRACT_VERSION + 1, migrations: ['init'] };

    expect(skewCheck({ ...input, status })?.cause).toBe('contract');
  });

  it('names the hub behind before this rafa behind when each lacks one', () => {
    const status = { ...STATUS_FACTS, migrations: ['init', 'held-rows', 'wire-v2'] };

    expect(skewCheck({ ...input, status })?.line).toBe(HUB_BEHIND_LINE);
  });

  it('checks nothing it was not told: an unknown contract and unknown migrations', () => {
    expect(skewCheck({ ...input, status: { ...STATUS_FACTS, contractVersion: null, migrations: null } })).toBeNull();
  });
});

describe('refusalCauseOf', () => {
  it.each([
    ['a contract mismatch', named(HUB_CONTRACT_MISMATCH, 'x'), 'contract'],
    ['a hub behind', named(HUB_UPGRADE_REQUIRED, 'x'), 'skew'],
    ['a rafa behind', named(RAFA_UPDATE_REQUIRED, 'x'), 'skew'],
    ['a token error', named(HUB_TOKEN_ERROR, 'x'), 'token'],
    ['the hub\'s project error', named(HUB_PROJECT_NOT_SERVED, 'x'), 'project'],
    ['the client\'s wrap of the project sentence', new Error(NOT_SERVED), 'project'],
    ['an unreachable hub', named(HUB_UNREACHABLE, 'x'), null],
    ['any other error', new Error('the hub refused push: HTTP 403'), null],
    ['a thrown string', 'project x is not served here', null],
  ] as const)('reads %s as %p', (_case, error, cause) => {
    expect(refusalCauseOf(error)).toBe(cause);
  });
});
