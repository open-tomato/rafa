/**
 * Tests for {@link createHubContact} (`packages/rafa-effort/src/effort/sync/contact.ts`).
 *
 * A fixture `service` strategy is registered on a registry of this
 * file's own and handed to the loader as its base, so a config naming no
 * module still selects it through `loadModules`; one case loads the
 * `sync-fixture` module under `packages/rafa/src/modules/testdata/` through `modules:`
 * and `allowList:` instead. Every line a contact writes is captured, and
 * each case reads the lines whole, so "one unreachable line" is a count
 * of the lines written and not a search of them.
 *
 * Each claim sits beside a control that could have failed it: the one
 * line a contact writes beside a second contact writing its own, the
 * skipped pull beside a refused push that still pulls, and the core
 * strategies writing nothing beside the same config naming `service`,
 * and the mismatched push skipping its pull beside the refused one. A
 * skew refusal's line written as it stands sits beside the same line
 * under another name wrapped as a failure, and a pull's notice written
 * beside answers whose notice is absent, empty or misplaced.
 *
 * The cases written for the push-first order run under `effort.syncMerge:
 * merge` ({@link SERVICE}); `The order` runs the same fixture under the
 * default `ff-only` beside it, so a pull first is read off the calls
 * against a push first, a push skipped after a pull that did not answer
 * beside one pushed after a pull that did, and the held line at one
 * beside none at zero.
 *
 * Every root is a path under a temporary directory of this file's own
 * that is never made, and the core cases hold it absent after, but for
 * the {@link pullBeforeRead} cases: each makes a root of its own there,
 * holding the project config the helper reads.
 */
import type { AdapterContext } from '@open-tomato/rafa/core/adapters';
import type { ResolvedConfig } from '@open-tomato/rafa/core/config';
import type { Sync, SyncPullRequest, SyncPullResult, SyncPushRequest, SyncPushResult } from '@open-tomato/rafa/ports';
import type { HubContactSeams } from '@open-tomato/rafa-effort/effort/sync/contact';

import '../../../../config-registry.js';

import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'bun:test';

import { CORE_ADAPTER_REGISTRY, PORT_VERSIONS } from '@open-tomato/rafa/core/adapters';
import { ConfigError, parseConfigText, resolveConfig } from '@open-tomato/rafa/core/config';
import { loadConfig } from '@open-tomato/rafa/core/config/load';
import {
  createHubContact,
  HUB_CONTRACT_MISMATCH,
  HUB_UNREACHABLE,
  HUB_UPGRADE_REQUIRED,
  HubUnreachable,
  hubUnreachableLine,
  isHubContractMismatch,
  isHubUnreachable,
  isSkewRefusal,
  noticeOf,
  pullBeforeRead,
  RAFA_UPDATE_REQUIRED,
} from '@open-tomato/rafa-effort/effort/sync/contact';

const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-sync-contact-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** A root under the temporary directory, never made. */
const ROOT = join(tempBase, 'repo');

/** A home under the temporary directory, never made. */
const HOME = join(tempBase, 'home');

/** The hub the service configs name. */
const HUB_URL = 'http://127.0.0.1:7373';

/** The module whose `git` sync adapter one case loads through `modules:`. */
const FIXTURE_MODULE = fileURLToPath(new URL('../../../../../packages/rafa/src/modules/testdata/sync-fixture', import.meta.url));

/** The manifest seams the fixture module is held to. */
const MANIFEST_SEAMS = { rafaVersion: '0.1.0', portVersions: PORT_VERSIONS };

/** A config as it resolves from a project file holding `text`. */
function resolving(text: string): ResolvedConfig {
  return resolveConfig({ cli: {}, file: parseConfigText(text, join(ROOT, '.rafa', 'config.yaml')), user: null });
}

/** A project naming `service` and the hub, under `effort.syncMerge: merge`, whose `pushThenPull()` pushes first. */
const SERVICE = `effort:\n  sync: service\n  syncMerge: merge\nhub:\n  url: ${HUB_URL}\n`;

/** The same project naming no `effort.syncMerge`, so the default `ff-only`, whose `pushThenPull()` pulls first. */
const SERVICE_DEFAULT = `effort:\n  sync: service\nhub:\n  url: ${HUB_URL}\n`;

/** The same project naming `effort.syncMerge: ff-only`. */
const SERVICE_FF_ONLY = `effort:\n  sync: service\n  syncMerge: ff-only\nhub:\n  url: ${HUB_URL}\n`;

/** What one direction of the fixture does when called. */
type Behaviour =
  | 'answer'
  | 'unreachable'
  | 'renamed-unreachable'
  | 'mismatch'
  | 'hub-behind'
  | 'rafa-behind'
  | 'refuse'
  | 'throw-now'
  | 'throw-string';

/** The line the `service` strategy's `HubContractMismatch` carries for a hub one contract ahead. */
const MISMATCH_LINE = 'effort sync: the hub speaks contract 2, this rafa contract 1; nothing was sent. Next step: rafa self-update';

/** A contract mismatch as the `service` strategy throws it: an error of that name, its fields beside the line. */
function mismatch(): Error {
  return Object.assign(new Error(MISMATCH_LINE), { name: HUB_CONTRACT_MISMATCH, hubVersion: 2, rafaVersion: 1, nextStep: 'rafa self-update' });
}

/** The line the `service` strategy's `HubUpgradeRequired` carries for a hub lacking two migrations. */
const HUB_BEHIND_LINE = 'effort sync: the hub is behind this rafa (migration held-rows, extra); nothing was sent.'
  + ' Next step: upgrade the hub, then rafa effort sync';

/** The line the `service` strategy's `RafaUpdateRequired` carries for a hub ahead by one migration. */
const RAFA_BEHIND_LINE = 'effort sync: this rafa is behind the hub (migration held-rows); nothing was merged.'
  + ' Next step: rafa self-update, then rafa effort sync';

/** A skew refusal as the `service` strategy throws it: an error of `name`, its fields beside the line. */
function skewRefusal(name: string, line: string): Error {
  return Object.assign(new Error(line), { name, missing: ['held-rows'] });
}

/** A fixture `service` strategy and what it was asked. */
interface Fixture {
  readonly calls: string[];
  readonly contexts: AdapterContext[];
  readonly seams: HubContactSeams;
}

/** Acts out `behaviour` for one direction, answering `answer` when it answers. */
function actOut<Result>(behaviour: Behaviour, direction: string, answer: Result): Promise<Result> {
  switch (behaviour) {
    case 'answer': return Promise.resolve(answer);
    case 'unreachable': return Promise.reject(new HubUnreachable(`connect ECONNREFUSED on ${direction}`));
    case 'renamed-unreachable': {
      return Promise.reject(Object.assign(new Error(`timed out after 3000 ms on ${direction}\nsecond line`), { name: HUB_UNREACHABLE }));
    }
    case 'mismatch': return Promise.reject(mismatch());
    case 'hub-behind': return Promise.reject(skewRefusal(HUB_UPGRADE_REQUIRED, HUB_BEHIND_LINE));
    case 'rafa-behind': return Promise.reject(skewRefusal(RAFA_UPDATE_REQUIRED, RAFA_BEHIND_LINE));
    case 'refuse': return Promise.reject(new Error(`the hub refused the token on ${direction} (403)`));
    case 'throw-now': throw new Error(`thrown before any promise on ${direction}`);
    case 'throw-string': return Promise.reject(`a bare string on ${direction}`);
  }
}

/** Registers a fixture `service` whose push and pull behave as named, as the loader's base registry. */
function fixture(push: Behaviour, pull: Behaviour): Fixture {
  const calls: string[] = [];
  const contexts: AdapterContext[] = [];
  const create = (context: AdapterContext): Sync => {
    contexts.push(context);
    return {
      kind: 'service',
      push: (request: SyncPushRequest) => {
        calls.push(`push ${JSON.stringify(request)}`);
        return actOut(push, 'push', { status: 'pushed', path: null } as const);
      },
      pull: (request: SyncPullRequest) => {
        calls.push(`pull ${JSON.stringify(request)}`);
        return actOut(pull, 'pull', { status: 'nothing-to-sync' } as const);
      },
    };
  };
  const adapters = CORE_ADAPTER_REGISTRY.register({ port: 'sync', kind: 'service', portVersion: PORT_VERSIONS.sync, create });
  return { calls, contexts, seams: { modules: { adapters, manifest: MANIFEST_SEAMS } } };
}

/** A contact over `resolved` whose written lines are captured, naming `sessionId` when given. */
function contacting(resolved: ResolvedConfig, seams: HubContactSeams, sessionId?: string | null): {
  readonly lines: string[];
  readonly contact: ReturnType<typeof createHubContact>;
} {
  const lines: string[] = [];
  const warn = (line: string): void => {
    lines.push(line);
  };
  return { lines, contact: createHubContact({ root: ROOT, home: HOME, resolved, warn, sessionId }, seams) };
}

/** The lines that say the hub is unreachable. */
function unreachableLines(lines: readonly string[]): readonly string[] {
  return lines.filter((line) => line.includes('is unreachable'));
}

describe('the strategies core registers', () => {
  it.each([
    ['local', 'effort:\n  sync: local\n'],
    ['file', 'effort:\n  sync: file\n'],
    ['local, by default', ''],
  ])('%s is not contacted: nothing written, loaded, selected or made on disk', async (strategy, text) => {
    const service = fixture('unreachable', 'unreachable');
    const { lines, contact } = contacting(resolving(text), service.seams);

    expect(await contact.pushThenPull()).toEqual({ state: 'not-contacted', strategy: strategy.split(',')[0] ?? '' });
    expect(await contact.pull()).toMatchObject({ state: 'not-contacted' });
    expect(lines).toEqual([]);
    expect(service.contexts).toEqual([]);
    expect(existsSync(ROOT)).toBe(false);
  });

  it('while the same fixture under service is contacted, the control', async () => {
    const service = fixture('unreachable', 'unreachable');
    const { lines, contact } = contacting(resolving(SERVICE), service.seams);

    expect(await contact.pushThenPull()).toMatchObject({ state: 'contacted' });
    expect(unreachableLines(lines)).toHaveLength(1);
  });
});

describe('a contact that reaches the hub', () => {
  it('pushes then pulls, with no path in either request, and writes nothing', async () => {
    const service = fixture('answer', 'answer');
    const { lines, contact } = contacting(resolving(SERVICE), service.seams);

    expect(await contact.pushThenPull()).toEqual({
      state: 'contacted',
      strategy: 'service',
      push: { outcome: 'done', result: { status: 'pushed', path: null } },
      pull: { outcome: 'done', result: { status: 'nothing-to-sync' } },
    });
    expect(service.calls).toEqual(['push {"to":null}', 'pull {"from":null,"dryRun":false}']);
    expect(lines).toEqual([]);
  });

  it('pulls alone when asked for a pull', async () => {
    const service = fixture('answer', 'answer');
    const { contact } = contacting(resolving(SERVICE), service.seams);

    expect(await contact.pull()).toMatchObject({ state: 'contacted', push: null, pull: { outcome: 'done' } });
    expect(service.calls).toEqual(['pull {"from":null,"dryRun":false}']);
  });

  it('makes the strategy once per contact, with the root and the resolved hub', async () => {
    const service = fixture('answer', 'answer');
    const { contact } = contacting(resolving(SERVICE), service.seams);

    await contact.pushThenPull();
    await contact.pull();

    expect(service.contexts).toEqual([{ repoRoot: ROOT, store: 'sqlite', hub: { url: HUB_URL, tokenSecret: null, timeoutMs: 3000, syncSkew: 'refuse', project: null } }]);
    expect(service.calls).toHaveLength(3);
  });

  it('selects a module\'s strategy loaded through modules: and allowList:', async () => {
    const text = `effort:\n  sync: git\nmodules:\n  - path: ${FIXTURE_MODULE}\nallowList:\n  - sync-fixture\n`;
    const { lines, contact } = contacting(resolving(text), { modules: { manifest: MANIFEST_SEAMS } });

    expect(await contact.pushThenPull()).toEqual({
      state: 'contacted',
      strategy: 'git',
      push: { outcome: 'done', result: { status: 'pushed', path: null } },
      pull: { outcome: 'done', result: { status: 'nothing-to-sync' } },
    });
    expect(lines).toEqual([]);
  });
});

/** The held line a pull-first push writes for `count` conflicted rows, spelled out as the spec words it. */
function heldLine(count: number): string {
  return `effort sync: ${String(count)} rows held: they differ from the hub's copy (merge_conflicts); the rest was pushed`;
}

/** Registers a `service` whose pull answers and whose push answers it left out `conflicted` rows, recording each request. */
function conflicting(conflicted: number): { readonly calls: string[]; readonly seams: HubContactSeams } {
  const calls: string[] = [];
  const adapters = CORE_ADAPTER_REGISTRY.register({
    port: 'sync',
    kind: 'service',
    portVersion: PORT_VERSIONS.sync,
    create: (): Sync => ({
      kind: 'service',
      push: (request: SyncPushRequest) => {
        calls.push(`push ${JSON.stringify(request)}`);
        return Promise.resolve({ status: 'pushed', path: null, conflicted } as SyncPushResult);
      },
      pull: (request: SyncPullRequest) => {
        calls.push(`pull ${JSON.stringify(request)}`);
        return Promise.resolve({ status: 'nothing-to-sync' } as const);
      },
    }),
  });
  return { calls, seams: { modules: { adapters, manifest: MANIFEST_SEAMS } } };
}

/** The push a pull-first run asks, leaving out the conflicted rows. */
const PUSH_LEAVING_OUT = 'push {"to":null,"leaveOutConflicted":true}';

describe('the order under effort.syncMerge', () => {
  it.each([
    ['the default', SERVICE_DEFAULT],
    ['ff-only', SERVICE_FF_ONLY],
  ])('pulls first under %s, then pushes leaving out the conflicted rows', async (_label, text) => {
    const service = fixture('answer', 'answer');
    const { lines, contact } = contacting(resolving(text), service.seams);

    expect(await contact.pushThenPull()).toEqual({
      state: 'contacted',
      strategy: 'service',
      push: { outcome: 'done', result: { status: 'pushed', path: null } },
      pull: { outcome: 'done', result: { status: 'nothing-to-sync' } },
    });
    expect(service.calls).toEqual(['pull {"from":null,"dryRun":false}', PUSH_LEAVING_OUT]);
    expect(lines).toEqual([]);
  });

  it('while under merge it pushes first, asking nothing more, then pulls, the control', async () => {
    const service = fixture('answer', 'answer');
    const { contact } = contacting(resolving(SERVICE), service.seams);

    await contact.pushThenPull();

    expect(service.calls).toEqual(['push {"to":null}', 'pull {"from":null,"dryRun":false}']);
  });

  it.each([
    ['an unreachable pull', 'unreachable', 'unreachable'],
    ['a mismatched pull', 'mismatch', 'mismatch'],
    ['a pull refused for skew', 'rafa-behind', 'refused'],
    ['a failed pull', 'refuse', 'failed'],
  ] as const)('skips the push after %s, writing the pull\'s one line', async (_label, behaviour, outcome) => {
    const service = fixture('answer', behaviour);
    const { lines, contact } = contacting(resolving(SERVICE_DEFAULT), service.seams);

    expect(await contact.pushThenPull()).toMatchObject({ push: { outcome: 'skipped' }, pull: { outcome } });
    expect(service.calls).toEqual(['pull {"from":null,"dryRun":false}']);
    expect(lines).toHaveLength(1);
  });

  it('still pulls first and skips each push on later runs of the same contact, writing no second line', async () => {
    const service = fixture('answer', 'unreachable');
    const { lines, contact } = contacting(resolving(SERVICE_DEFAULT), service.seams);

    await contact.pushThenPull();
    await contact.pushThenPull();

    expect(service.calls).toEqual(['pull {"from":null,"dryRun":false}', 'pull {"from":null,"dryRun":false}']);
    expect(unreachableLines(lines)).toEqual(lines);
    expect(lines).toHaveLength(1);
  });

  it('writes no held line for a push that left out no row', async () => {
    const service = conflicting(0);
    const { lines, contact } = contacting(resolving(SERVICE_DEFAULT), service.seams);

    expect(await contact.pushThenPull()).toMatchObject({ push: { outcome: 'done', result: { conflicted: 0 } } });
    expect(service.calls).toEqual(['pull {"from":null,"dryRun":false}', PUSH_LEAVING_OUT]);
    expect(lines).toEqual([]);
  });

  it('writes the held line once for a push that left out one row', async () => {
    const service = conflicting(1);
    const { lines, contact } = contacting(resolving(SERVICE_DEFAULT), service.seams);

    expect(await contact.pushThenPull()).toMatchObject({ push: { outcome: 'done', result: { conflicted: 1 } } });
    expect(lines).toEqual([heldLine(1)]);
  });

  it('writes the held line after the pull\'s notice, the pull running first', async () => {
    const calls: string[] = [];
    const adapters = CORE_ADAPTER_REGISTRY.register({
      port: 'sync',
      kind: 'service',
      portVersion: PORT_VERSIONS.sync,
      create: (): Sync => ({
        kind: 'service',
        push: () => Promise.resolve({ status: 'pushed', path: null, conflicted: 1 } as SyncPushResult),
        pull: () => {
          calls.push('pull');
          return Promise.resolve({ status: 'pulled', merge: MERGED, notice: PROJECTED_LINE } as SyncPullResult);
        },
      }),
    });
    const { lines, contact } = contacting(resolving(SERVICE_DEFAULT), { modules: { adapters, manifest: MANIFEST_SEAMS } });

    await contact.pushThenPull();

    expect(lines).toEqual([PROJECTED_LINE, heldLine(1)]);
  });
});

describe('a contact naming its run\'s session id', () => {
  const sessionId = '11111111-2222-3333-4444-555555555555';

  it('carries the session id on every pull and on no push', async () => {
    const service = fixture('answer', 'answer');
    const { contact } = contacting(resolving(SERVICE), service.seams, sessionId);

    await contact.pushThenPull();
    await contact.pull();

    const pull = `pull {"from":null,"dryRun":false,"sessionId":"${sessionId}"}`;
    expect(service.calls).toEqual(['push {"to":null}', pull, pull]);
  });

  it.each([
    ['absent', undefined],
    ['null', null],
  ])('while one whose session id is %s carries none, the control', async (_label, absent) => {
    const service = fixture('answer', 'answer');
    const { contact } = contacting(resolving(SERVICE), service.seams, absent);

    await contact.pushThenPull();

    expect(service.calls).toEqual(['push {"to":null}', 'pull {"from":null,"dryRun":false}']);
  });
});

describe('a hub that is unreachable', () => {
  it('writes one line and skips the pull after an unreachable push', async () => {
    const service = fixture('unreachable', 'unreachable');
    const { lines, contact } = contacting(resolving(SERVICE), service.seams);

    expect(await contact.pushThenPull()).toEqual({
      state: 'contacted',
      strategy: 'service',
      push: { outcome: 'unreachable', problem: 'connect ECONNREFUSED on push' },
      pull: { outcome: 'skipped' },
    });
    expect(service.calls).toEqual(['push {"to":null}']);
    expect(lines).toEqual([
      `effort sync: the hub at ${HUB_URL} is unreachable (connect ECONNREFUSED on push);`
        + ' this command used the local store, and its rows sync on the next contact',
    ]);
  });

  it('writes one line for a pull alone', async () => {
    const service = fixture('answer', 'unreachable');
    const { lines, contact } = contacting(resolving(SERVICE), service.seams);

    expect(await contact.pull()).toMatchObject({ pull: { outcome: 'unreachable' } });
    expect(unreachableLines(lines)).toEqual(lines);
    expect(lines).toHaveLength(1);
  });

  it('writes one line when the push went through and the pull found the hub gone', async () => {
    const service = fixture('answer', 'unreachable');
    const { lines, contact } = contacting(resolving(SERVICE), service.seams);

    expect(await contact.pushThenPull()).toMatchObject({ push: { outcome: 'done' }, pull: { outcome: 'unreachable' } });
    expect(lines).toHaveLength(1);
  });

  it('writes no second line on later runs of the same contact, and still tries each', async () => {
    const service = fixture('unreachable', 'unreachable');
    const { lines, contact } = contacting(resolving(SERVICE), service.seams);

    await contact.pushThenPull();
    await contact.pushThenPull();
    await contact.pull();

    expect(lines).toHaveLength(1);
    expect(service.calls).toEqual(['push {"to":null}', 'push {"to":null}', 'pull {"from":null,"dryRun":false}']);
  });

  it('writes a line in each of two contacts, so the gate is the contact\'s and not the process\'s', async () => {
    const service = fixture('unreachable', 'unreachable');
    const first = contacting(resolving(SERVICE), service.seams);
    const second = contacting(resolving(SERVICE), service.seams);

    await first.contact.pushThenPull();
    await second.contact.pull();

    expect(first.lines).toHaveLength(1);
    expect(second.lines).toHaveLength(1);
  });

  it('knows an error by its name alone, as a module throws it, quoting its first line', async () => {
    const service = fixture('renamed-unreachable', 'answer');
    const { lines, contact } = contacting(resolving(SERVICE), service.seams);

    expect(await contact.pushThenPull()).toMatchObject({ push: { outcome: 'unreachable' }, pull: { outcome: 'skipped' } });
    expect(lines).toEqual([
      `effort sync: the hub at ${HUB_URL} is unreachable (timed out after 3000 ms on push);`
        + ' this command used the local store, and its rows sync on the next contact',
    ]);
  });
});

describe('a hub speaking another contract', () => {
  it('writes exactly the one mismatch line and skips the pull after a mismatched push', async () => {
    const service = fixture('mismatch', 'mismatch');
    const { lines, contact } = contacting(resolving(SERVICE), service.seams);

    expect(await contact.pushThenPull()).toEqual({
      state: 'contacted',
      strategy: 'service',
      push: { outcome: 'mismatch', problem: MISMATCH_LINE },
      pull: { outcome: 'skipped' },
    });
    expect(service.calls).toEqual(['push {"to":null}']);
    expect(lines).toEqual([MISMATCH_LINE]);
  });

  it('writes the one line for a pull alone', async () => {
    const service = fixture('answer', 'mismatch');
    const { lines, contact } = contacting(resolving(SERVICE), service.seams);

    expect(await contact.pull()).toMatchObject({ push: null, pull: { outcome: 'mismatch', problem: MISMATCH_LINE } });
    expect(lines).toEqual([MISMATCH_LINE]);
  });

  it('writes no second line on later runs of the same contact, and still tries each', async () => {
    const service = fixture('mismatch', 'mismatch');
    const { lines, contact } = contacting(resolving(SERVICE), service.seams);

    await contact.pushThenPull();
    await contact.pushThenPull();
    await contact.pull();

    expect(lines).toEqual([MISMATCH_LINE]);
    expect(service.calls).toEqual(['push {"to":null}', 'push {"to":null}', 'pull {"from":null,"dryRun":false}']);
  });

  it('writes the first line alone of a message holding more', async () => {
    const refusing = (): Promise<never> => Promise.reject(Object.assign(new Error(`${MISMATCH_LINE}\nsecond line`), { name: HUB_CONTRACT_MISMATCH }));
    const adapters = CORE_ADAPTER_REGISTRY.register({
      port: 'sync',
      kind: 'service',
      portVersion: PORT_VERSIONS.sync,
      create: (): Sync => ({ kind: 'service', push: refusing, pull: refusing }),
    });
    const { lines, contact } = contacting(resolving(SERVICE), { modules: { adapters } });

    expect(await contact.pull()).toMatchObject({ pull: { outcome: 'mismatch', problem: MISMATCH_LINE } });
    expect(lines).toEqual([MISMATCH_LINE]);
  });

  it('leaves process.exitCode at the value it found, zero or not', async () => {
    // Bun keeps a code once set when `undefined` is assigned, so the case restores the one it found, or 0.
    const before = process.exitCode ?? 0;
    try {
      for (const found of [0, 7]) {
        process.exitCode = found;
        const { lines, contact } = contacting(resolving(SERVICE), fixture('mismatch', 'mismatch').seams);

        await contact.pushThenPull();
        await contact.pull();

        expect(lines).toEqual([MISMATCH_LINE]);
        expect(process.exitCode).toBe(found);
      }
    } finally {
      process.exitCode = before;
    }
  });

  it('while a refused push writes the failure and still pulls, the control', async () => {
    const service = fixture('refuse', 'mismatch');
    const { lines, contact } = contacting(resolving(SERVICE), service.seams);

    expect(await contact.pushThenPull()).toMatchObject({ push: { outcome: 'failed' }, pull: { outcome: 'mismatch' } });
    expect(lines).toEqual(['effort sync: push over service failed: the hub refused the token on push (403)', MISMATCH_LINE]);
  });
});

describe('a skew refusal', () => {
  it('writes the hub-behind line unwrapped and still pulls', async () => {
    const service = fixture('hub-behind', 'answer');
    const { lines, contact } = contacting(resolving(SERVICE), service.seams);

    expect(await contact.pushThenPull()).toEqual({
      state: 'contacted',
      strategy: 'service',
      push: { outcome: 'refused', problem: HUB_BEHIND_LINE },
      pull: { outcome: 'done', result: { status: 'nothing-to-sync' } },
    });
    expect(service.calls).toEqual(['push {"to":null}', 'pull {"from":null,"dryRun":false}']);
    expect(lines).toEqual([HUB_BEHIND_LINE]);
  });

  it('writes the rafa-behind line unwrapped for a pull alone', async () => {
    const service = fixture('answer', 'rafa-behind');
    const { lines, contact } = contacting(resolving(SERVICE), service.seams);

    expect(await contact.pull()).toEqual({
      state: 'contacted',
      strategy: 'service',
      push: null,
      pull: { outcome: 'refused', problem: RAFA_BEHIND_LINE },
    });
    expect(lines).toEqual([RAFA_BEHIND_LINE]);
  });

  it('writes both lines when the push and the pull each meet one, neither inside the failed wrap', async () => {
    const service = fixture('hub-behind', 'rafa-behind');
    const { lines, contact } = contacting(resolving(SERVICE), service.seams);

    await contact.pushThenPull();

    expect(lines).toEqual([HUB_BEHIND_LINE, RAFA_BEHIND_LINE]);
    expect(lines.filter((line) => line.includes(' failed: '))).toEqual([]);
  });

  it('writes each line once per contact, and still tries each later run', async () => {
    const service = fixture('hub-behind', 'rafa-behind');
    const { lines, contact } = contacting(resolving(SERVICE), service.seams);

    await contact.pushThenPull();
    await contact.pushThenPull();
    await contact.pull();

    expect(lines).toEqual([HUB_BEHIND_LINE, RAFA_BEHIND_LINE]);
    expect(service.calls).toHaveLength(5);
  });

  it('writes the first line alone of a refusal holding more', async () => {
    const refusing = (): Promise<never> => Promise.reject(skewRefusal(RAFA_UPDATE_REQUIRED, `${RAFA_BEHIND_LINE}\nsecond line`));
    const adapters = CORE_ADAPTER_REGISTRY.register({
      port: 'sync',
      kind: 'service',
      portVersion: PORT_VERSIONS.sync,
      create: (): Sync => ({ kind: 'service', push: refusing, pull: refusing }),
    });
    const { lines, contact } = contacting(resolving(SERVICE), { modules: { adapters } });

    expect(await contact.pull()).toMatchObject({ pull: { outcome: 'refused', problem: RAFA_BEHIND_LINE } });
    expect(lines).toEqual([RAFA_BEHIND_LINE]);
  });

  it('while the same line under another name is wrapped as a failure, the control', async () => {
    const refusing = (): Promise<never> => Promise.reject(new Error(RAFA_BEHIND_LINE));
    const adapters = CORE_ADAPTER_REGISTRY.register({
      port: 'sync',
      kind: 'service',
      portVersion: PORT_VERSIONS.sync,
      create: (): Sync => ({ kind: 'service', push: refusing, pull: refusing }),
    });
    const { lines, contact } = contacting(resolving(SERVICE), { modules: { adapters } });

    expect(await contact.pull()).toMatchObject({ pull: { outcome: 'failed' } });
    expect(lines).toEqual([`effort sync: pull over service failed: ${RAFA_BEHIND_LINE}`]);
  });

  it('isSkewRefusal knows the two names on an error, and nothing else', () => {
    expect(isSkewRefusal(skewRefusal(HUB_UPGRADE_REQUIRED, HUB_BEHIND_LINE))).toBe(true);
    expect(isSkewRefusal(skewRefusal(RAFA_UPDATE_REQUIRED, RAFA_BEHIND_LINE))).toBe(true);
    expect(isSkewRefusal(new Error(RAFA_BEHIND_LINE))).toBe(false);
    expect(isSkewRefusal(mismatch())).toBe(false);
    expect(isSkewRefusal({ name: RAFA_UPDATE_REQUIRED, message: RAFA_BEHIND_LINE })).toBe(false);
    expect(isSkewRefusal(RAFA_UPDATE_REQUIRED)).toBe(false);
  });
});

/** The `pulled <n> rows projected` line the `service` strategy answers for a projected pull. */
const PROJECTED_LINE = 'effort sync: pulled 4 rows projected to this rafa\'s schema; 2 columns wait for rafa self-update';

/** The `refilled <n> rows` line the `service` strategy answers for a refill. */
const REFILLED_LINE = 'effort sync: refilled 3 rows held back since 2026-11-20';

/** A merge result standing in for the merge's own, which the contact never reads. */
const MERGED = Object.freeze({ dryRun: false }) as unknown as Extract<SyncPullResult, { readonly status: 'pulled' }>['merge'];

/** Registers a `service` whose push answers and whose every pull answers `answer`. */
function answering(answer: unknown): { readonly calls: string[]; readonly seams: HubContactSeams } {
  const calls: string[] = [];
  const adapters = CORE_ADAPTER_REGISTRY.register({
    port: 'sync',
    kind: 'service',
    portVersion: PORT_VERSIONS.sync,
    create: (): Sync => ({
      kind: 'service',
      push: () => Promise.resolve({ status: 'pushed', path: null } as const),
      pull: () => {
        calls.push('pull');
        return Promise.resolve(answer as SyncPullResult);
      },
    }),
  });
  return { calls, seams: { modules: { adapters, manifest: MANIFEST_SEAMS } } };
}

describe('a pull answering a notice', () => {
  it.each([
    ['the projected pull', PROJECTED_LINE],
    ['the refill', REFILLED_LINE],
  ])('writes %s\'s line as it stands, unwrapped', async (_label, notice) => {
    const service = answering({ status: 'pulled', merge: MERGED, notice });
    const { lines, contact } = contacting(resolving(SERVICE), service.seams);

    expect(await contact.pushThenPull()).toMatchObject({ push: { outcome: 'done' }, pull: { outcome: 'done' } });
    expect(lines).toEqual([notice]);
  });

  it('writes the line once for each pull that answers one', async () => {
    const service = answering({ status: 'pulled', merge: MERGED, notice: PROJECTED_LINE });
    const { lines, contact } = contacting(resolving(SERVICE), service.seams);

    await contact.pushThenPull();
    await contact.pull();

    expect(service.calls).toHaveLength(2);
    expect(lines).toEqual([PROJECTED_LINE, PROJECTED_LINE]);
  });

  it.each([
    ['a pulled answer naming no notice', { status: 'pulled', merge: MERGED }],
    ['an empty notice', { status: 'pulled', merge: MERGED, notice: '  ' }],
    ['a notice that is no string', { status: 'pulled', merge: MERGED, notice: 4 }],
    ['a notice beside nothing-to-sync', { status: 'nothing-to-sync', notice: PROJECTED_LINE }],
  ])('writes nothing for %s, the control', async (_label, answer) => {
    const service = answering(answer);
    const { lines, contact } = contacting(resolving(SERVICE), service.seams);

    expect(await contact.pull()).toMatchObject({ pull: { outcome: 'done' } });
    expect(lines).toEqual([]);
  });

  it('noticeOf reads the notice off a pulled answer alone', () => {
    expect(noticeOf({ status: 'pulled', merge: MERGED, notice: REFILLED_LINE } as SyncPullResult)).toBe(REFILLED_LINE);
    expect(noticeOf({ status: 'pulled', merge: MERGED })).toBeNull();
    expect(noticeOf({ status: 'nothing-to-sync' })).toBeNull();
  });
});

describe('a contact never throws', () => {
  it('writes a refused push and still pulls, with no unreachable line', async () => {
    const service = fixture('refuse', 'answer');
    const { lines, contact } = contacting(resolving(SERVICE), service.seams);

    expect(await contact.pushThenPull()).toMatchObject({
      push: { outcome: 'failed', problem: 'the hub refused the token on push (403)' },
      pull: { outcome: 'done' },
    });
    expect(lines).toEqual(['effort sync: push over service failed: the hub refused the token on push (403)']);
    expect(unreachableLines(lines)).toEqual([]);
  });

  it.each([
    ['a throw before any promise', 'throw-now', 'thrown before any promise on pull'],
    ['a rejection with a bare string', 'throw-string', 'a bare string on pull'],
  ] as const)('answers %s as a failed step', async (_label, behaviour, problem) => {
    const service = fixture('answer', behaviour);
    const { lines, contact } = contacting(resolving(SERVICE), service.seams);

    expect(await contact.pull()).toMatchObject({ pull: { outcome: 'failed', problem } });
    expect(lines).toEqual([`effort sync: pull over service failed: ${problem}`]);
  });

  it('writes SyncModuleMissing once when no module registers service, and contacts nothing', async () => {
    const { lines, contact } = contacting(resolving(SERVICE), { modules: { manifest: MANIFEST_SEAMS } });

    const first = await contact.pushThenPull();
    await contact.pull();

    expect(first).toMatchObject({ state: 'unselected', strategy: 'service' });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toStartWith('effort sync: effort.sync is "service", and no module registers a sync adapter');
    expect(lines[0]).toContain('\nallowList:\n');
    expect(unreachableLines(lines)).toEqual([]);
  });

  it('writes an adapter that refuses to be made as the problem it is', async () => {
    const create = (): Sync => {
      throw new Error('service: no token secret named');
    };
    const adapters = CORE_ADAPTER_REGISTRY.register({ port: 'sync', kind: 'service', portVersion: PORT_VERSIONS.sync, create });
    const { lines, contact } = contacting(resolving(SERVICE), { modules: { adapters } });

    expect(await contact.pull()).toEqual({ state: 'unselected', strategy: 'service', problem: 'service: no token secret named' });
    expect(lines).toEqual(['service: no token secret named']);
  });

  it('leaves process.exitCode as it found it through every failing run', async () => {
    const before = process.exitCode;
    const runs = [
      contacting(resolving(SERVICE), fixture('unreachable', 'unreachable').seams).contact.pushThenPull(),
      contacting(resolving(SERVICE), fixture('refuse', 'refuse').seams).contact.pushThenPull(),
      contacting(resolving(SERVICE), fixture('throw-now', 'throw-string').seams).contact.pushThenPull(),
      contacting(resolving(SERVICE), fixture('mismatch', 'mismatch').seams).contact.pushThenPull(),
      contacting(resolving(SERVICE), { modules: { manifest: MANIFEST_SEAMS } }).contact.pull(),
    ];

    const settled = await Promise.allSettled(runs);

    expect(settled.map((outcome) => outcome.status)).toEqual(['fulfilled', 'fulfilled', 'fulfilled', 'fulfilled', 'fulfilled']);
    expect(process.exitCode).toBe(before);
  });
});

describe('isHubContractMismatch', () => {
  it('knows any error of that name, and nothing else', () => {
    expect(isHubContractMismatch(mismatch())).toBe(true);
    expect(isHubContractMismatch(new Error(MISMATCH_LINE))).toBe(false);
    expect(isHubContractMismatch(new HubUnreachable('down'))).toBe(false);
    expect(isHubContractMismatch({ name: HUB_CONTRACT_MISMATCH, message: MISMATCH_LINE })).toBe(false);
    expect(isHubContractMismatch(HUB_CONTRACT_MISMATCH)).toBe(false);
    expect(isHubUnreachable(mismatch())).toBe(false);
  });
});

describe('isHubUnreachable and the line', () => {
  it('knows HubUnreachable and any error of that name, and nothing else', () => {
    expect(isHubUnreachable(new HubUnreachable('down'))).toBe(true);
    expect(isHubUnreachable(Object.assign(new Error('down'), { name: HUB_UNREACHABLE }))).toBe(true);
    expect(isHubUnreachable(new Error('HubUnreachable'))).toBe(false);
    expect(isHubUnreachable({ name: HUB_UNREACHABLE, message: 'down' })).toBe(false);
    expect(isHubUnreachable(HUB_UNREACHABLE)).toBe(false);
  });

  it('names the hub without a url when the config names none, on one line', () => {
    const line = hubUnreachableLine(null, new HubUnreachable('\n  refused  \nmore'));

    expect(line).toBe('effort sync: the hub is unreachable (refused); this command used the local store, and its rows sync on the next contact');
    expect(line).not.toContain('\n');
  });
});

/** A project root of its own under the temporary directory, its project config holding `text`. */
function projectHolding(text: string): string {
  const root = mkdtempSync(join(tempBase, 'project-'));
  mkdirSync(join(root, '.rafa'));
  writeFileSync(join(root, '.rafa', 'config.yaml'), text, 'utf8');
  return root;
}

/** A pull before a read under `root`, its written lines captured. */
async function pullingUnder(root: string, seams: HubContactSeams): Promise<{
  readonly lines: string[];
  readonly reading: Awaited<ReturnType<typeof pullBeforeRead>>;
}> {
  const lines: string[] = [];
  const reading = await pullBeforeRead({ roots: { root, home: HOME }, warn: (line) => lines.push(line) }, seams);
  return { lines, reading };
}

/** A key no section declares, which the config warns about. */
const UNKNOWN_KEY = 'nonsense:\n  key: 1\n';

describe('pullBeforeRead', () => {
  it('reads the project config and pulls alone, writing the one unreachable line and no config warning', async () => {
    const service = fixture('unreachable', 'unreachable');
    const root = projectHolding(`${SERVICE}${UNKNOWN_KEY}`);

    const { lines, reading } = await pullingUnder(root, service.seams);

    expect(reading).toMatchObject({ state: 'contacted', strategy: 'service', push: null, pull: { outcome: 'unreachable' } });
    expect(service.calls).toEqual(['pull {"from":null,"dryRun":false}']);
    expect(lines).toEqual([hubUnreachableLine(HUB_URL, new Error('connect ECONNREFUSED on pull'))]);
    expect(service.contexts[0]?.repoRoot).toBe(root);
  });

  it('while the same file read with a sink writes the config warning it kept back, the control', async () => {
    const root = projectHolding(`${SERVICE}${UNKNOWN_KEY}`);
    const warnings: string[] = [];

    await loadConfig({ root, home: HOME }, {}, (line) => warnings.push(line));

    expect(warnings).toHaveLength(1);
  });

  it('contacts nothing under a project with no sync setting, local by default', async () => {
    const service = fixture('unreachable', 'unreachable');
    const root = projectHolding('');

    const { lines, reading } = await pullingUnder(root, service.seams);

    expect(reading).toEqual({ state: 'not-contacted', strategy: 'local' });
    expect(lines).toEqual([]);
    expect(service.calls).toEqual([]);
  });

  it('answers null and contacts nothing for a config the command refuses itself', async () => {
    const service = fixture('unreachable', 'unreachable');
    const root = projectHolding('effort:\n  sync: service\n');

    const { lines, reading } = await pullingUnder(root, service.seams);

    expect(reading).toBeNull();
    expect(lines).toEqual([]);
    expect(service.calls).toEqual([]);
    await expect(loadConfig({ root, home: HOME }, {}, () => {})).rejects.toThrow(ConfigError);
  });
});
