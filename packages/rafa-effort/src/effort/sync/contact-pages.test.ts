/**
 * Tests for the payload cap a hub contact keeps: {@link splitPush},
 * {@link pagedPull} and {@link capOf} (`contact-pages.ts` and
 * `contact-facts.ts` beside this file), and the same split and paging
 * through {@link createHubContact}'s `pushThenPull()` and `sync()`.
 *
 * A stand-in `service` strategy keeps a real push cursor over the rows
 * it holds: a push asked with a `limit` sends at most that many past the
 * cursor and moves the cursor past them, `pendingPush()` counts the rows
 * past it, and every payload's size is recorded, so "lands in two
 * payloads" is read off the sizes sent rather than off the calls. Its
 * pulls answer the pages a case lists, each saying the rows it carried.
 *
 * Each claim sits beside a control that could have failed it: a push of
 * the cap plus one split in two beside a push of exactly the cap sent
 * whole and the same rows over a hub naming no cap sent whole; a full
 * page pulled again beside a page one row short pulled once, a dry run
 * never repeated and a hub naming no cap; and a strategy whose cursor
 * does not move stopped after one push beside one that ignores the
 * limit and sends everything. A push leaving out conflicted rows sums
 * the count over its payloads beside the same split asked without it,
 * which carries no such field and answers none.
 *
 * The file makes a registry of its own the active one for its contact
 * cases, holding core's `local` and `file` sync strategies, and puts back
 * the one it found after them, as `contact-status.test.ts` does. Every
 * root is a path under a temporary directory of this file's own that is
 * never made.
 */
import type { HubContactSeams } from './contact.js';
import type { AdapterContext, AdapterRegistry, AnyAdapter } from '@open-tomato/rafa/core/adapters';
import type { ResolvedConfig } from '@open-tomato/rafa/core/config';
import type { Sync, SyncPullRequest, SyncPullResult, SyncPushRequest, SyncPushResult } from '@open-tomato/rafa/ports';

import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { activeAdapterRegistry, createAdapterRegistry, PORT_VERSIONS, restoreAdapters } from '@open-tomato/rafa/core/adapters';
import { parseConfigText, resolveConfig } from '@open-tomato/rafa/core/config';
import { WIRE_CONTRACT_VERSION } from '@open-tomato/rafa/store';
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';

import { capOf, conflictedOf } from './contact-facts.js';
import { MAX_PULL_PAGES, pagedPull, splitPush } from './contact-pages.js';
import { createHubContact, HUB_UNREACHABLE } from './contact.js';
import { createFileSync } from './file.js';
import { createLocalSync } from './select.js';

const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-contact-pages-')));

/** Core's two sync strategies, as `src/adapter-registry.ts` registers them, so a contact knows `local` and `file` as core's. */
const CORE_SYNCS: readonly AnyAdapter[] = Object.freeze([
  { port: 'sync', kind: 'local', portVersion: PORT_VERSIONS.sync, create: () => createLocalSync() },
  { port: 'sync', kind: 'file', portVersion: PORT_VERSIONS.sync, create: ({ repoRoot }: AdapterContext) => createFileSync({ repoRoot, backend: 'sqlite' }) },
]);

/** The active registry before this file's own, put back after its last case. */
let previous: AdapterRegistry | null = null;

beforeAll(() => {
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

/** A project naming `service` and the hub, under the default `effort.syncMerge: ff-only`. */
const SERVICE = `effort:\n  sync: service\nhub:\n  url: ${HUB_URL}\n`;

/** The same project under `effort.syncMerge: merge`, whose `pushThenPull()` pushes first. */
const SERVICE_MERGE = `effort:\n  sync: service\n  syncMerge: merge\nhub:\n  url: ${HUB_URL}\n`;

/** The migration ids this file's contacts know, and its stand-in hub holds, so the skew check passes. */
const KNOWN: readonly string[] = Object.freeze(['init']);

/** The cap this file's capped hub answers. */
const CAP = 5;

/** The line a page's notice says. */
const PAGE_NOTICE = 'effort sync: refilled 2 rows held back since 2026-11-01';

/** The merge a `pulled` answer carries. */
type Merge = Extract<SyncPullResult, { readonly status: 'pulled' }>['merge'];

/** A merge that added `rowsAdded` rows. */
function merged(rowsAdded: number): Merge {
  return {
    path: join(ROOT, '.rafa', 'effort.sqlite'),
    otherPath: join(ROOT, 'scratch.sqlite'),
    status: 'merged',
    mergeId: `merge-${String(rowsAdded)}`,
    otherStore: null,
    otherBroughtForward: [],
    tables: [],
    rowsAdded,
    rowsSkipped: 1,
    rowsInConflict: 0,
    rowsHeld: 0,
    rowsRefilled: 0,
    gapsRewritten: 0,
    backupPath: null,
  };
}

/** How the stand-in strategy behaves. */
interface StandInOptions {
  /** The rows waiting past the push cursor at the start. */
  readonly rows: number;
  /** The `maxPayloadRows` its hub status names; left out, the status names none. */
  readonly cap?: unknown;
  /** Whether it carries `hubStatus`; true when left out. */
  readonly hubStatus?: boolean;
  /** A rejection its `hubStatus` answers instead of the status. */
  readonly statusError?: Error;
  /** Whether it carries `pendingPush`; true when left out. */
  readonly pendingPush?: boolean;
  /** Whether a push honours its `limit`; true when left out. */
  readonly honoursLimit?: boolean;
  /** Whether a push moves the cursor past the rows it sent; true when left out. */
  readonly movesCursor?: boolean;
  /** The rows the pull's page at `index` carries, from 0; no page carries any when left out. */
  readonly page?: (index: number) => number;
  /** Whether a page leaves out its `rows` count. */
  readonly pageCountsNone?: boolean;
  /** Whether each page answers {@link PAGE_NOTICE}. */
  readonly notice?: boolean;
  /** The conflicted rows the push at `index`, from 0, answers it left out when asked `leaveOutConflicted`; none when left out. */
  readonly conflicted?: (index: number) => number;
}

/** The stand-in strategy, what it was asked and the payloads it sent. */
interface StandIn {
  readonly sync: Sync;
  readonly calls: string[];
  /** The rows each push sent, in order. */
  readonly payloads: number[];
}

/** The answer a page of `rows` gets. */
function pageAnswer(rows: number, options: StandInOptions): SyncPullResult {
  if (rows === 0) return { status: 'nothing-to-sync' };
  return {
    status: 'pulled',
    merge: merged(rows),
    ...options.pageCountsNone === true
      ? {}
      : { rows },
    ...options.notice === true
      ? { notice: PAGE_NOTICE }
      : {},
  } as SyncPullResult;
}

/** A stand-in `service` strategy keeping a real push cursor; see the file note. */
function standIn(options: StandInOptions): StandIn {
  const calls: string[] = [];
  const payloads: number[] = [];
  let cursor = 0;
  let pages = 0;
  const push = (request: SyncPushRequest): Promise<SyncPushResult> => {
    calls.push(`push ${JSON.stringify(request)}`);
    const waiting = options.rows - cursor;
    const { limit, leaveOutConflicted } = request as { readonly limit?: number; readonly leaveOutConflicted?: boolean };
    const sent = limit === undefined || options.honoursLimit === false
      ? waiting
      : Math.min(waiting, limit);
    const conflicted = leaveOutConflicted === true
      ? { conflicted: options.conflicted?.(payloads.length) ?? 0 }
      : {};
    payloads.push(sent);
    if (options.movesCursor !== false) cursor += sent;
    return Promise.resolve({ status: 'pushed', path: null, ...conflicted } as SyncPushResult);
  };
  const pull = (request: SyncPullRequest): Promise<SyncPullResult> => {
    calls.push(`pull ${JSON.stringify(request)}`);
    const rows = options.page?.(pages) ?? 0;
    pages += 1;
    return Promise.resolve(pageAnswer(rows, options));
  };
  const hubStatus = (): Promise<unknown> => {
    calls.push('hubStatus');
    if (options.statusError !== undefined) return Promise.reject(options.statusError);
    const named = 'cap' in options
      ? { maxPayloadRows: options.cap }
      : {};
    return Promise.resolve({ contractVersion: WIRE_CONTRACT_VERSION, projectId: 'p1', projectName: 'rafa', migrations: KNOWN, ...named });
  };
  const pendingPush = (): Promise<number> => {
    calls.push('pendingPush');
    return Promise.resolve(options.rows - cursor);
  };
  const sync = {
    kind: 'service',
    push,
    pull,
    ...options.hubStatus === false
      ? {}
      : { hubStatus },
    ...options.pendingPush === false
      ? {}
      : { pendingPush },
  } as Sync;
  return { sync, calls, payloads };
}

/** A pull as a contact naming no session asks it. */
const PULL: SyncPullRequest = Object.freeze({ from: null, dryRun: false });

/** A notice writer that records each page's notice. */
function noticing(): { readonly lines: string[]; readonly notice: (result: SyncPullResult) => void } {
  const lines: string[] = [];
  return {
    lines,
    notice: (result) => {
      if ('notice' in result) lines.push(String(result.notice));
    },
  };
}

describe('splitPush', () => {
  it('sends a push of exactly the cap in one payload, bounded at the cap', async () => {
    const strategy = standIn({ rows: CAP });

    const result = await splitPush(strategy.sync, CAP);

    expect(result).toEqual({ status: 'pushed', path: null });
    expect(strategy.payloads).toEqual([CAP]);
    expect(strategy.calls).toEqual(['pendingPush', `push {"to":null,"limit":${String(CAP)}}`, 'pendingPush']);
  });

  it('sends the cap plus one in two payloads, the cap then the one row, by the cursor', async () => {
    const strategy = standIn({ rows: CAP + 1 });

    await splitPush(strategy.sync, CAP);

    expect(strategy.payloads).toEqual([CAP, 1]);
    expect(strategy.calls.filter((call) => call.startsWith('push '))).toEqual([
      `push {"to":null,"limit":${String(CAP)}}`,
      `push {"to":null,"limit":${String(CAP)}}`,
    ]);
  });

  it('sends every payload under the cap for a push many times over it', async () => {
    const strategy = standIn({ rows: (CAP * 3) + 2 });

    await splitPush(strategy.sync, CAP);

    expect(strategy.payloads).toEqual([CAP, CAP, CAP, 2]);
  });

  it('sends the cap plus one whole, unbounded, when the hub answers no cap, the control', async () => {
    const strategy = standIn({ rows: CAP + 1 });

    await splitPush(strategy.sync, null);

    expect(strategy.payloads).toEqual([CAP + 1]);
    expect(strategy.calls).toEqual(['push {"to":null}']);
  });

  it('asks the cap only once rows wait, and pushes whole when none do', async () => {
    const strategy = standIn({ rows: 0 });
    let asked = 0;

    await splitPush(strategy.sync, () => {
      asked += 1;
      return Promise.resolve(CAP);
    });

    expect(asked).toBe(0);
    expect(strategy.calls).toEqual(['pendingPush', 'push {"to":null}']);
  });

  it('pushes whole, asking no count, for a strategy with no pendingPush', async () => {
    const strategy = standIn({ rows: CAP + 1, pendingPush: false });

    await splitPush(strategy.sync, CAP);

    expect(strategy.calls).toEqual(['push {"to":null}']);
  });

  it('stops after one payload for a strategy ignoring the limit, which sent everything', async () => {
    const strategy = standIn({ rows: CAP + 1, honoursLimit: false });

    await splitPush(strategy.sync, CAP);

    expect(strategy.payloads).toEqual([CAP + 1]);
  });

  it('asks every payload to leave out the conflicted rows and sums what they left out', async () => {
    const strategy = standIn({ rows: (CAP * 2) + 1, conflicted: (index) => [1, 0, 2][index] ?? 0 });

    const result = await splitPush(strategy.sync, CAP, true);

    expect(strategy.payloads).toEqual([CAP, CAP, 1]);
    expect(strategy.calls.filter((call) => call.startsWith('push '))).toEqual([
      `push {"to":null,"leaveOutConflicted":true,"limit":${String(CAP)}}`,
      `push {"to":null,"leaveOutConflicted":true,"limit":${String(CAP)}}`,
      `push {"to":null,"leaveOutConflicted":true,"limit":${String(CAP)}}`,
    ]);
    expect(result as unknown).toEqual({ status: 'pushed', path: null, conflicted: 3 });
  });

  it('asks a whole push to leave them out too, answering its count as it stands', async () => {
    const strategy = standIn({ rows: CAP + 1, conflicted: () => 1 });

    const result = await splitPush(strategy.sync, null, true);

    expect(strategy.calls).toEqual(['push {"to":null,"leaveOutConflicted":true}']);
    expect(result as unknown).toEqual({ status: 'pushed', path: null, conflicted: 1 });
  });

  it('while the same split asked without it names no field and answers no count, the control', async () => {
    const strategy = standIn({ rows: (CAP * 2) + 1, conflicted: () => 1 });

    const result = await splitPush(strategy.sync, CAP);

    expect(strategy.calls.filter((call) => call.includes('leaveOutConflicted'))).toEqual([]);
    expect(result).toEqual({ status: 'pushed', path: null });
  });

  it('rejects after one push, naming the rows still waiting, for a strategy whose cursor did not move', async () => {
    const strategy = standIn({ rows: CAP + 1, movesCursor: false });

    const pushing = splitPush(strategy.sync, CAP);

    await expect(pushing).rejects.toThrow(`the strategy still counts ${String(CAP + 1)} rows to push after a payload of at most ${String(CAP)}`);
    expect(strategy.payloads).toEqual([CAP]);
  });
});

describe('pagedPull', () => {
  it('pulls again after a full page, summing the merge counts and answering the last page', async () => {
    const strategy = standIn({ rows: 0, page: (index) => [CAP, 1][index] ?? 0 });
    const { notice } = noticing();

    const result = await pagedPull(strategy.sync, PULL, CAP, notice);

    expect(strategy.calls).toEqual(['pull {"from":null,"dryRun":false}', 'pull {"from":null,"dryRun":false}']);
    expect(result).toMatchObject({ status: 'pulled', rows: 1, merge: { rowsAdded: CAP + 1, rowsSkipped: 2, mergeId: 'merge-1' } });
  });

  it('pulls once for a page one row short of the cap, the control', async () => {
    const strategy = standIn({ rows: 0, page: (index) => [CAP - 1, 1][index] ?? 0 });

    const result = await pagedPull(strategy.sync, PULL, CAP, noticing().notice);

    expect(strategy.calls).toHaveLength(1);
    expect(result).toMatchObject({ merge: { rowsAdded: CAP - 1 } });
  });

  it('answers the full page when the page after it was empty', async () => {
    const strategy = standIn({ rows: 0, page: (index) => [CAP][index] ?? 0 });

    const result = await pagedPull(strategy.sync, PULL, CAP, noticing().notice);

    expect(strategy.calls).toHaveLength(2);
    expect(result).toMatchObject({ status: 'pulled', merge: { rowsAdded: CAP } });
  });

  it('pulls once when the hub answers no cap, however many rows the page carried', async () => {
    const strategy = standIn({ rows: 0, page: () => CAP });

    await pagedPull(strategy.sync, PULL, null, noticing().notice);

    expect(strategy.calls).toHaveLength(1);
  });

  it('never repeats a dry run, whose cursor does not move', async () => {
    const strategy = standIn({ rows: 0, page: () => CAP });

    await pagedPull(strategy.sync, { ...PULL, dryRun: true }, CAP, noticing().notice);

    expect(strategy.calls).toEqual(['pull {"from":null,"dryRun":true}']);
  });

  it('pulls once, asking no cap, for a page that counts no rows', async () => {
    const strategy = standIn({ rows: 0, page: () => CAP, pageCountsNone: true });
    let asked = 0;

    await pagedPull(strategy.sync, PULL, () => {
      asked += 1;
      return Promise.resolve(CAP);
    }, noticing().notice);

    expect(strategy.calls).toHaveLength(1);
    expect(asked).toBe(0);
  });

  it('hands every page\'s answer to the notice writer, once each', async () => {
    const strategy = standIn({ rows: 0, page: (index) => [CAP, 2][index] ?? 0, notice: true });
    const { lines, notice } = noticing();

    await pagedPull(strategy.sync, PULL, CAP, notice);

    expect(lines).toEqual([PAGE_NOTICE, PAGE_NOTICE]);
  });

  it(`rejects once ${String(MAX_PULL_PAGES)} pages came back full, having pulled no more`, async () => {
    const strategy = standIn({ rows: 0, page: () => CAP });

    const pulling = pagedPull(strategy.sync, PULL, CAP, noticing().notice);

    await expect(pulling).rejects.toThrow(`the hub answered ${String(MAX_PULL_PAGES)} full pages to one pull`);
    expect(strategy.calls).toHaveLength(MAX_PULL_PAGES);
  });
});

describe('conflictedOf', () => {
  it('reads a whole number of rows off the push answer\'s conflicted', () => {
    expect(conflictedOf({ status: 'pushed', path: null, conflicted: 2 } as SyncPushResult)).toBe(2);
    expect(conflictedOf({ status: 'pushed', path: null, conflicted: 0 } as SyncPushResult)).toBe(0);
  });

  it.each([
    ['an answer naming none', { status: 'pushed', path: null }],
    ['nothing to sync', { status: 'nothing-to-sync' }],
    ['a negative count', { status: 'pushed', path: null, conflicted: -1 }],
    ['a fractional count', { status: 'pushed', path: null, conflicted: 1.5 }],
    ['a count spelled as text', { status: 'pushed', path: null, conflicted: '1' }],
  ] as const)('reads %s as 0', (_case, answer) => {
    expect(conflictedOf(answer as SyncPushResult)).toBe(0);
  });
});

describe('capOf', () => {
  it('reads a whole number above zero as the cap', () => {
    expect(capOf({ maxPayloadRows: CAP })).toBe(CAP);
  });

  it.each([
    ['an answer naming none', {}],
    ['a null cap', { maxPayloadRows: null }],
    ['a zero cap', { maxPayloadRows: 0 }],
    ['a negative cap', { maxPayloadRows: -1 }],
    ['a fractional cap', { maxPayloadRows: 2.5 }],
    ['a cap spelled as text', { maxPayloadRows: '5' }],
    ['an answer that is no object', null],
  ] as const)('reads %s as no cap', (_case, answer) => {
    expect(capOf(answer)).toBeNull();
  });
});

/** A config as it resolves from a project file holding `text`. */
function resolving(text: string): ResolvedConfig {
  return resolveConfig({ cli: {}, file: parseConfigText(text, join(ROOT, '.rafa', 'config.yaml')), user: null });
}

/** The seams that make `strategy` the selected `service` strategy. */
function selecting(strategy: StandIn): HubContactSeams {
  const adapter: AnyAdapter = { port: 'sync', kind: 'service', portVersion: PORT_VERSIONS.sync, create: () => strategy.sync };
  const adapters = createAdapterRegistry([...CORE_SYNCS, adapter]);
  return { modules: { adapters, manifest: { rafaVersion: '0.1.0', portVersions: PORT_VERSIONS } }, migrations: KNOWN };
}

/** A contact over the service config `text` selecting `strategy`, its written lines captured. */
function contacting(strategy: StandIn, text = SERVICE): { readonly lines: string[]; readonly contact: ReturnType<typeof createHubContact> } {
  const lines: string[] = [];
  const warn = (line: string): void => {
    lines.push(line);
  };
  return { lines, contact: createHubContact({ root: ROOT, home: HOME, resolved: resolving(text), warn }, selecting(strategy)) };
}

/** The held line for `count` conflicted rows, spelled out as the spec words it. */
function heldLine(count: number): string {
  return `effort sync: ${String(count)} rows held: they differ from the hub's copy (merge_conflicts); the rest was pushed`;
}

describe('a contact\'s pushThenPull() under ff-only and the hub\'s cap', () => {
  it('pulls first, then splits the push leaving out the conflicted rows, and writes one held line for the summed count', async () => {
    const strategy = standIn({ rows: CAP + 1, cap: CAP, conflicted: (index) => [1, 1][index] ?? 0 });
    const { contact, lines } = contacting(strategy);

    const reading = await contact.pushThenPull();

    expect(strategy.calls[0]).toBe('pull {"from":null,"dryRun":false}');
    expect(strategy.payloads).toEqual([CAP, 1]);
    expect(reading).toMatchObject({ push: { outcome: 'done', result: { conflicted: 2 } }, pull: { outcome: 'done' } });
    expect(lines).toEqual([heldLine(2)]);
  });
});

describe('a contact\'s pushThenPull() under merge and the hub\'s cap', () => {
  it('lands the cap plus one in two payloads, reading the cap off one status read, and pulls each full page', async () => {
    const strategy = standIn({ rows: CAP + 1, cap: CAP, page: (index) => [CAP, 1][index] ?? 0 });
    const { contact, lines } = contacting(strategy, SERVICE_MERGE);

    const reading = await contact.pushThenPull();

    expect(strategy.payloads).toEqual([CAP, 1]);
    expect(strategy.calls.filter((call) => call === 'hubStatus')).toEqual(['hubStatus']);
    expect(strategy.calls.filter((call) => call.startsWith('pull '))).toHaveLength(2);
    expect(reading).toMatchObject({ state: 'contacted', push: { outcome: 'done' }, pull: { outcome: 'done', result: { merge: { rowsAdded: CAP + 1 } } } });
    expect(lines).toEqual([]);
  });

  it('lands exactly the cap in one payload', async () => {
    const strategy = standIn({ rows: CAP, cap: CAP });

    await contacting(strategy, SERVICE_MERGE).contact.pushThenPull();

    expect(strategy.payloads).toEqual([CAP]);
  });

  it('lands the cap plus one in one unbounded payload when the hub answers no cap, the control', async () => {
    const strategy = standIn({ rows: CAP + 1, page: () => CAP });

    await contacting(strategy, SERVICE_MERGE).contact.pushThenPull();

    expect(strategy.payloads).toEqual([CAP + 1]);
    expect(strategy.calls.filter((call) => call.startsWith('push '))).toEqual(['push {"to":null}']);
    expect(strategy.calls.filter((call) => call.startsWith('pull '))).toHaveLength(1);
  });

  it('asks no hub status when nothing waits to push and no page counts its rows', async () => {
    const strategy = standIn({ rows: 0, cap: CAP });

    await contacting(strategy, SERVICE_MERGE).contact.pushThenPull();

    expect(strategy.calls).toEqual(['pendingPush', 'push {"to":null}', 'pull {"from":null,"dryRun":false}']);
  });

  it('writes a status read that found the hub unreachable as the push\'s one line, and skips the pull', async () => {
    const unreachable = Object.assign(new Error('connect ECONNREFUSED on status'), { name: HUB_UNREACHABLE });
    const strategy = standIn({ rows: CAP + 1, statusError: unreachable });
    const { contact, lines } = contacting(strategy, SERVICE_MERGE);

    const reading = await contact.pushThenPull();

    expect(reading).toMatchObject({ push: { outcome: 'unreachable' }, pull: { outcome: 'skipped' } });
    expect(strategy.payloads).toEqual([]);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain(`the hub at ${HUB_URL} is unreachable (connect ECONNREFUSED on status)`);
  });
});

describe('a contact\'s sync() under the hub\'s cap', () => {
  it('splits the push by the cap its status step read, asking no second status', async () => {
    const strategy = standIn({ rows: CAP + 1, cap: CAP });

    const reading = await contacting(strategy).contact.sync();

    expect(strategy.payloads).toEqual([CAP, 1]);
    expect(strategy.calls.filter((call) => call === 'hubStatus')).toEqual(['hubStatus']);
    expect(reading).toMatchObject({ refusal: null, push: { outcome: 'done' }, pull: { outcome: 'done' } });
  });

  it('pushes whole, counting nothing, when the status step names no cap, the control', async () => {
    const strategy = standIn({ rows: CAP + 1 });

    await contacting(strategy).contact.sync();

    expect(strategy.calls).toEqual(['hubStatus', 'pull {"from":null,"dryRun":false}', 'push {"to":null,"leaveOutConflicted":true}']);
  });

  it('sends one dry-run push under the cap, splitting nothing', async () => {
    const strategy = standIn({ rows: CAP + 1, cap: CAP });

    await contacting(strategy).contact.sync({ stop: 'dry-run' });

    expect(strategy.calls).toEqual(['hubStatus', 'pull {"from":null,"dryRun":true}', 'push {"to":null,"dryRun":true,"leaveOutConflicted":true}']);
  });
});
