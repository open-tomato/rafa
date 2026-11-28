/**
 * `./sync.ts` dispatched in-process over a planted project: the line
 * each stop point adds after the contact's own, the data of the terminal
 * result in json mode, and the exit code each reading makes.
 *
 * Most cases hand the command a reading through its `contact` seam, the
 * seam writing the lines a contact would, so each case names what the
 * contact answered; what the contact does is `contact.ts`'s, with suites
 * of its own. One group runs the real contact over a stub `service`
 * strategy, so the readings the seam cases hand in are held to the shape
 * a real run answers. Two cases run the default seam under
 * `effort.sync: local` and `file`, which contact nothing.
 *
 * ## The controls
 *
 * - Each exit 1 sits beside a reading exiting 0 over the same seam: a
 *   refusal beside the same run with no refusal, a failed pull beside a
 *   pull that answered, so the 1 is the reading's and not a command that
 *   always refused.
 * - The unreachable run exits 0 and writes no line of the command's own
 *   beside the reachable run writing its hub line, so the one offline
 *   line is proved to be the only one.
 * - Both flags at once exit 1 with the seam never called, beside each
 *   flag alone handing the seam its stop.
 *
 * ## The fake hub
 *
 * The last group runs the real contact over the real `service` strategy
 * and the in-process `Bun.serve` stand-in the strategy's own tests use
 * (`packages/rafa-sync-service/src/testdata/stand-in-hub.ts`), the
 * device a real store under a scratch git repository. It holds each
 * flag's stop point by what the hub saw and what the device kept:
 * `--status` reads `/v1/status` and no route past it, `--dry-run` leaves
 * every file of the store's folder byte-identical and counts the
 * conflicts, and each exit code is read beside the run on the same hub
 * with nothing to refuse. Only the token reader is replaced. A hub
 * speaking another contract or holding a migration this rafa lacks is a
 * scripted hub answering the status alone, since the stand-in always
 * speaks this rafa's contract.
 */
import type { SyncCommandSeams, SyncContactInput } from './sync.js';
import type { StandInHub } from '../../../packages/rafa-sync-service/src/testdata/stand-in-hub.js';
import type { CapturedRun, PlantedProject } from '../../tests/cli-capture.js';
import type { Sync, SyncPullRequest, SyncPullResult, SyncPushRequest, SyncPushResult } from '@open-tomato/rafa/ports';
import type { CommitEffortRow } from '@open-tomato/rafa/store';
import type { HubSyncContacted, HubSyncReading, HubSyncStatus } from '@open-tomato/rafa-effort/effort/sync/contact';

import '../../config-registry.js';

import { mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, afterEach, describe, expect, it } from 'bun:test';

import { createAdapterRegistry, PORT_VERSIONS } from '@open-tomato/rafa/core/adapters';
import { parseConfigText, resolveConfig } from '@open-tomato/rafa/core/config';
import { openSqliteStore, WIRE_CONTRACT_VERSION } from '@open-tomato/rafa/store';
import { SQLITE_MIGRATIONS } from '@open-tomato/rafa/store/migrations';
import { conflictedLine, createHubContact, hubLine } from '@open-tomato/rafa-effort/effort/sync/contact';

import { SYNC_STATE_FILE_NAME } from '../../../packages/rafa-sync-service/src/state.js';
import { createServiceSync } from '../../../packages/rafa-sync-service/src/sync.js';
import { startStandInHub } from '../../../packages/rafa-sync-service/src/testdata/stand-in-hub.js';
import { dispatchInProject, eventsOf, plantProject } from '../../tests/cli-capture.js';

import syncCommand, { createSyncCommand, nothingToSyncLine, syncData, syncExitCode, SYNC_REFUSED_EXIT, SYNC_USAGE } from './sync.js';

const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-effort-sync-command-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** The subject the command sits under, declared for the registry the test dispatches over. */
const EFFORT_SUBJECT = { name: 'effort', summary: 'the effort store' };

let planted = 0;

/** A fresh project under this file's directory, its config `text` when a case names one. */
function plant(text?: string): PlantedProject {
  planted += 1;
  const scope = realpathSync(mkdtempSync(join(tempBase, `case-${String(planted)}-`)));
  return text === undefined
    ? plantProject(scope)
    : plantProject(scope, text);
}

/** The hub's status a reachable hub answers in the seam cases. */
const STATUS: HubSyncStatus = { contractVersion: 1, projectId: 'p-1', projectName: 'rafa', migrations: [] };

/** A contacted reading's steps none reached, for a case to fill. */
const AT: Omit<HubSyncContacted, 'status' | 'stop'> = {
  state: 'contacted',
  strategy: 'service',
  refusal: null,
  pending: null,
  push: null,
  pull: null,
  conflicted: null,
  hub: { outcome: 'skipped' },
};

/** A merge result counting `added`, `held` and `conflicts`, as a pull's merge answers it. */
function merge(added: number, held: number, conflicts: number): Extract<SyncPullResult, { status: 'pulled' }>['merge'] {
  return {
    path: '/store/effort.sqlite',
    otherPath: '/scratch/effort.sqlite',
    status: 'merged',
    mergeId: 'merge-1',
    otherStore: null,
    otherBroughtForward: [],
    tables: [],
    rowsAdded: added,
    rowsSkipped: 0,
    rowsInConflict: conflicts,
    rowsHeld: held,
    rowsRefilled: 0,
    gapsRewritten: 0,
    backupPath: null,
  };
}

/** A whole sync that pushed and pulled `pulled` rows, `held` held back, `conflicts` in conflict. */
function synced(pulled: number, held = 0, conflicts = 0): HubSyncContacted {
  return {
    ...AT,
    stop: null,
    status: { outcome: 'done', result: STATUS },
    push: { outcome: 'done', result: { status: 'pushed', path: null } },
    pull: { outcome: 'done', result: { status: 'pulled', merge: merge(pulled, held, conflicts) } },
    hub: { outcome: 'done', result: { contractVersion: 1, projectId: 'p-1', projectName: 'rafa', pulled, heldBack: held, conflicts } },
  };
}

/** What a seam case's contact was handed, once per call. */
interface Contacts {
  readonly inputs: SyncContactInput[];
}

/** Dispatches `rafa effort sync <words>` with a contact seam answering `reading`, writing `written` first. */
async function run(
  words: readonly string[],
  reading: HubSyncReading,
  written: readonly string[] = [],
  project: PlantedProject = plant(),
): Promise<CapturedRun & { readonly contacts: Contacts }> {
  const contacts: Contacts = { inputs: [] };
  const seams: SyncCommandSeams = {
    contact: (input) => {
      contacts.inputs.push(input);
      for (const line of written) input.warn(line);
      return Promise.resolve(reading);
    },
  };
  const outcome = await dispatchInProject(['effort', 'sync', ...words], [EFFORT_SUBJECT], [createSyncCommand(seams)], project);
  return { ...outcome, contacts };
}

/** A captured stream's lines, the empty last one left out. */
function lines(text: string): readonly string[] {
  return text.split('\n').filter((line) => line !== '');
}

/** The data of a json-mode run's terminal result. */
function resultOf(outcome: CapturedRun): Record<string, unknown> | undefined {
  return eventsOf(outcome.stdout).find((event) => event.type === 'result') as Record<string, unknown> | undefined;
}

const OFFLINE = 'effort sync: the hub at http://127.0.0.1:9 is unreachable (connect refused); this command used the local store, and its rows sync on the next contact';
const SKEW = 'effort sync: this rafa is behind the hub (migration 0099-new); nothing was merged. Next step: rafa self-update, then rafa effort sync';
const PROJECTED = 'effort sync: pulled 3 rows projected to this rafa\'s schema; 1 columns wait for rafa self-update';

describe('rafa effort sync, a whole sync', () => {
  it('prints the hub line after the contact and exits 0, handing the contact no stop', async () => {
    const outcome = await run([], synced(312));

    expect(outcome.exitCode).toBe(0);
    expect(lines(outcome.stdout)).toEqual(['hub: reachable, contract 1, project rafa; pulled 312 rows']);
    expect(outcome.contacts.inputs.map((input) => input.stop)).toEqual([null]);
  });

  it('prints the pull\'s own line first, then the hub line ending with the rows held back: two lines', async () => {
    const outcome = await run([], synced(3, 2), [PROJECTED]);

    expect(outcome.exitCode).toBe(0);
    expect(lines(outcome.stdout)).toEqual([
      `warn: ${PROJECTED}`,
      'hub: reachable, contract 1, project rafa; pulled 3 rows; 2 rows held back',
    ]);
  });

  it('prints the held line, then the hub line, after a push that left one conflicted row out, beside a push leaving none', async () => {
    const outcome = await run([], { ...synced(3), conflicted: 1 }, [PROJECTED]);

    expect(outcome.exitCode).toBe(0);
    expect(lines(outcome.stdout)).toEqual([
      `warn: ${PROJECTED}`,
      `warn: ${conflictedLine(1)}`,
      'hub: reachable, contract 1, project rafa; pulled 3 rows',
    ]);
    expect(conflictedLine(1)).toBe('effort sync: 1 rows held: they differ from the hub\'s copy (merge_conflicts); the rest was pushed');
    expect(lines((await run([], { ...synced(3), conflicted: 0 })).stdout)).toEqual(['hub: reachable, contract 1, project rafa; pulled 3 rows']);
  });

  it('prints the one offline line and no hub line for an unreachable hub, exiting 0', async () => {
    const reading: HubSyncReading = { ...AT, stop: null, status: { outcome: 'unreachable', problem: 'connect refused' } };

    const outcome = await run([], reading, [OFFLINE]);

    expect(outcome.exitCode).toBe(0);
    expect(lines(outcome.stdout + outcome.stderr)).toEqual([`warn: ${OFFLINE}`]);
  });

  it('names the project by its id when the hub names it nothing, and an unknown contract as unknown', async () => {
    const reading: HubSyncReading = {
      ...synced(0),
      hub: { outcome: 'done', result: { contractVersion: null, projectId: 'p-1', projectName: null, pulled: 0, heldBack: 0, conflicts: 0 } },
    };

    const outcome = await run([], reading);

    expect(lines(outcome.stdout)).toEqual(['hub: reachable, contract unknown, project p-1; pulled 0 rows']);
  });
});

describe('rafa effort sync --status', () => {
  it('prints the hub\'s contract, project and the rows waiting to push, handing the contact the status stop', async () => {
    const reading: HubSyncReading = {
      ...AT,
      stop: 'status',
      status: { outcome: 'done', result: STATUS },
      pending: { outcome: 'done', result: 4 },
    };

    const outcome = await run(['--status'], reading);

    expect(outcome.exitCode).toBe(0);
    expect(outcome.contacts.inputs.map((input) => input.stop)).toEqual(['status']);
    expect(lines(outcome.stdout)).toEqual(['hub: reachable, contract 1, project rafa; 4 rows waiting to push']);
  });

  it('leaves the count out when the strategy counts none', async () => {
    const reading: HubSyncReading = {
      ...AT,
      stop: 'status',
      status: { outcome: 'done', result: STATUS },
      pending: { outcome: 'done', result: null },
    };

    const outcome = await run(['--status'], reading);

    expect(lines(outcome.stdout)).toEqual(['hub: reachable, contract 1, project rafa']);
  });

  it('prints the skew refusal alone and exits 1, beside the same hub with nothing to refuse exiting 0', async () => {
    const refused: HubSyncReading = {
      ...AT,
      stop: 'status',
      status: { outcome: 'done', result: STATUS },
      refusal: { cause: 'skew', line: SKEW },
    };

    const outcome = await run(['--status'], refused, [SKEW]);

    expect(outcome.exitCode).toBe(SYNC_REFUSED_EXIT);
    expect(lines(outcome.stdout + outcome.stderr)).toEqual([`warn: ${SKEW}`]);
    expect((await run(['--status'], { ...refused, refusal: null, pending: { outcome: 'done', result: 0 } })).exitCode).toBe(0);
  });
});

describe('rafa effort sync --dry-run', () => {
  it('prints what would be pushed, pulled and recorded as conflicts, handing the contact the dry-run stop', async () => {
    const reading: HubSyncReading = { ...synced(7, 0, 2), stop: 'dry-run', pending: { outcome: 'done', result: 5 } };

    const outcome = await run(['--dry-run'], reading);

    expect(outcome.exitCode).toBe(0);
    expect(outcome.contacts.inputs.map((input) => input.stop)).toEqual(['dry-run']);
    expect(lines(outcome.stdout)).toEqual([
      'hub: reachable, contract 1, project rafa; dry run: 5 rows to push, 7 rows to pull, 2 rows in conflict; nothing was written',
    ]);
  });

  it('adds the rows the push would hold after the conflicts, and writes no held line of its own', async () => {
    const reading: HubSyncReading = { ...synced(7, 0, 2), stop: 'dry-run', pending: { outcome: 'done', result: 5 }, conflicted: 1 };

    const outcome = await run(['--dry-run'], reading);

    expect(lines(outcome.stdout + outcome.stderr)).toEqual([
      'hub: reachable, contract 1, project rafa; dry run: 5 rows to push, 7 rows to pull, 2 rows in conflict; 1 rows would be held;'
      + ' nothing was written',
    ]);
  });

  it('says the push was not counted for a strategy with no dry-run push, and names rows held back', async () => {
    const reading: HubSyncReading = {
      ...synced(7, 3, 0),
      stop: 'dry-run',
      push: { outcome: 'skipped' },
      pending: { outcome: 'done', result: null },
    };

    const outcome = await run(['--dry-run'], reading);

    expect(lines(outcome.stdout)).toEqual([
      'hub: reachable, contract 1, project rafa; dry run: push not counted, 7 rows to pull, 3 rows held back, 0 rows in conflict;'
      + ' nothing was written',
    ]);
  });
});

describe('the exit codes of rafa effort sync', () => {
  it.each(['skew', 'contract', 'project', 'token'] as const)('exits 1 for a %s refusal, writing its line once and no hub line', async (cause) => {
    const line = `effort sync: refused for ${cause}`;
    const reading: HubSyncReading = {
      ...AT,
      stop: null,
      status: { outcome: 'done', result: STATUS },
      push: { outcome: 'refused', problem: line },
      refusal: { cause, line },
    };

    const outcome = await run([], reading, [line]);

    expect(outcome.exitCode).toBe(1);
    expect(lines(outcome.stdout + outcome.stderr)).toEqual([`warn: ${line}`]);
  });

  it('exits 1 for a pull that failed otherwise, beside the pull that answered exiting 0', async () => {
    const failed: HubSyncReading = { ...synced(0), pull: { outcome: 'failed', problem: 'the merge refused' }, hub: { outcome: 'skipped' } };
    const line = 'effort sync: pull over service failed: the merge refused';

    const outcome = await run([], failed, [line]);

    expect(outcome.exitCode).toBe(1);
    expect(lines(outcome.stdout + outcome.stderr)).toEqual([`warn: ${line}`]);
    expect((await run([], synced(0))).exitCode).toBe(0);
  });

  it('exits 1 for a strategy no module selects', async () => {
    const problem = 'the sync strategy \'service\' needs a module';
    const outcome = await run([], { state: 'unselected', strategy: 'service', problem }, [problem]);

    expect(outcome.exitCode).toBe(1);
    expect(lines(outcome.stdout + outcome.stderr)).toEqual([`warn: ${problem}`]);
  });

  it('reads each reading as the module note says', () => {
    expect(syncExitCode({ state: 'not-contacted', strategy: 'local' })).toBe(0);
    expect(syncExitCode(synced(1))).toBe(0);
    expect(syncExitCode({ ...AT, stop: null, status: { outcome: 'unreachable', problem: 'down' } })).toBe(0);
    expect(syncExitCode({ ...synced(1), push: { outcome: 'unreachable', problem: 'down' }, pull: null, hub: { outcome: 'skipped' } })).toBe(0);
    expect(syncExitCode({ ...AT, stop: null, status: { outcome: 'failed', problem: 'bad answer' } })).toBe(1);
    expect(syncExitCode({ ...AT, stop: 'status', status: { outcome: 'done', result: STATUS }, pending: { outcome: 'failed', problem: 'x' } })).toBe(1);
    expect(syncExitCode({ state: 'unselected', strategy: 'git', problem: 'x' })).toBe(1);
  });

  it('exits 1 for both flags at once, contacting nothing, beside each flag alone', async () => {
    const both = await run(['--status', '--dry-run'], synced(0));

    expect(both.exitCode).toBe(1);
    expect(both.stderr).toContain('--status and --dry-run are two stop points');
    expect(both.stderr).toContain(`Usage: ${SYNC_USAGE}`);
    expect(both.contacts.inputs).toEqual([]);
    expect((await run(['--status'], synced(0))).contacts.inputs).toHaveLength(1);
    expect((await run(['--dry-run'], synced(0))).contacts.inputs).toHaveLength(1);
  });

  it('exits 1 for a positional word or a config that cannot be used, contacting nothing', async () => {
    const word = await run(['now'], synced(0));
    const config = await run([], synced(0), [], plant('store: nonesuch\n'));

    expect(word.exitCode).toBe(1);
    expect(word.stderr).toContain(`Usage: ${SYNC_USAGE}`);
    expect(word.contacts.inputs).toEqual([]);
    expect(config.exitCode).toBe(1);
    expect(config.stderr).toContain('rafa effort sync: the config cannot be used:');
    expect(config.contacts.inputs).toEqual([]);
  });

  it('hands the contact the project root and the home', async () => {
    const project = plant();

    const outcome = await run([], synced(0), [], project);

    expect(outcome.contacts.inputs.map((input) => input.roots)).toEqual([{ root: project.root, home: project.home }]);
  });
});

describe('rafa effort sync --output=json', () => {
  it('gives whether a hub was contacted, the outcome, the counts and every line as the result\'s data', async () => {
    const outcome = await run(['--output=json'], synced(3, 2, 1), [PROJECTED]);

    expect(outcome.exitCode).toBe(0);
    expect(resultOf(outcome)).toMatchObject({
      ok: true,
      data: {
        strategy: 'service',
        contacted: true,
        stop: null,
        outcome: 'synced',
        contractVersion: 1,
        projectId: 'p-1',
        projectName: 'rafa',
        pending: null,
        pulled: 3,
        heldBack: 2,
        conflicts: 1,
        lines: [PROJECTED, 'hub: reachable, contract 1, project rafa; pulled 3 rows; 2 rows held back'],
      },
    });
  });

  it('gives the unreachable outcome with the offline line, contacted', async () => {
    const reading: HubSyncReading = { ...AT, stop: null, status: { outcome: 'unreachable', problem: 'down' } };

    const outcome = await run(['--output=json'], reading, [OFFLINE]);

    expect(outcome.exitCode).toBe(0);
    expect(resultOf(outcome)).toMatchObject({ ok: true, data: { contacted: true, outcome: 'unreachable', pulled: null, lines: [OFFLINE] } });
  });

  it('gives a refusal\'s lines as the error\'s message, exiting 1', async () => {
    const reading: HubSyncReading = { ...AT, stop: null, status: { outcome: 'done', result: STATUS }, refusal: { cause: 'skew', line: SKEW } };

    const outcome = await run(['--output=json'], reading, [SKEW]);

    expect(outcome.exitCode).toBe(1);
    expect(resultOf(outcome)).toMatchObject({ ok: false, error: { message: SKEW } });
  });

  it('answers the not-contacted data for local, its one line included', () => {
    const line = nothingToSyncLine('local');

    expect(syncData({ state: 'not-contacted', strategy: 'local' }, [line])).toMatchObject({
      strategy: 'local',
      contacted: false,
      outcome: 'nothing-to-sync',
      lines: [line],
    });
  });
});

describe('rafa effort sync with nothing to sync, the default seam', () => {
  it.each(['local', 'file'])('prints one line under effort.sync: %s and exits 0', async (strategy) => {
    const project = plant(`effort:\n  sync: ${strategy}\n`);

    const outcome = await dispatchInProject(['effort', 'sync'], [EFFORT_SUBJECT], [syncCommand], project);

    expect(outcome.exitCode).toBe(0);
    expect(lines(outcome.stdout + outcome.stderr)).toEqual([nothingToSyncLine(strategy)]);
  });
});

/** Every call a stub strategy was asked, in order. */
type Call = 'hubStatus' | 'pendingPush' | 'push' | 'push --dry-run' | 'pull' | 'pull --dry-run';

/** A stub `service` strategy recording its calls, its hub holding exactly this rafa's migrations. */
function stubService(calls: Call[]): Sync & { readonly hubStatus: () => Promise<unknown>; readonly pendingPush: () => Promise<number> } {
  return {
    kind: 'service',
    hubStatus: () => {
      calls.push('hubStatus');
      return Promise.resolve({
        contractVersion: WIRE_CONTRACT_VERSION,
        projectId: 'p-2',
        projectName: 'Beta',
        migrations: SQLITE_MIGRATIONS.map(({ id }) => id),
      });
    },
    pendingPush: () => {
      calls.push('pendingPush');
      return Promise.resolve(6);
    },
    push: (request: SyncPushRequest): Promise<SyncPushResult> => {
      const dryRun = (request as { readonly dryRun?: boolean }).dryRun === true;
      calls.push(dryRun
        ? 'push --dry-run'
        : 'push');
      return Promise.resolve(dryRun
        ? { status: 'pushed', path: null, dryRun: true, rows: 6 } as SyncPushResult
        : { status: 'pushed', path: null });
    },
    pull: (request: SyncPullRequest): Promise<SyncPullResult> => {
      calls.push(request.dryRun
        ? 'pull --dry-run'
        : 'pull');
      return Promise.resolve({ status: 'pulled', merge: merge(9, 0, 1) });
    },
  };
}

/** A contact seam over the real contact and `sync`, registered as the `service` strategy. */
function realContact(sync: Sync): (input: SyncContactInput) => Promise<HubSyncReading> {
  return (input) => {
    const create = (): Sync => sync;
    const adapters = createAdapterRegistry([{ port: 'sync', kind: 'service', portVersion: PORT_VERSIONS.sync, create }]);
    const text = 'effort:\n  sync: service\nhub:\n  url: http://127.0.0.1:9\n';
    const resolved = resolveConfig({ cli: {}, file: parseConfigText(text, join(input.roots.root, '.rafa', 'config.yaml')), user: null });
    return createHubContact(
      { root: input.roots.root, home: input.roots.home, resolved, warn: input.warn },
      { modules: { adapters, manifest: { rafaVersion: '0.1.0', portVersions: PORT_VERSIONS } } },
    ).sync({ stop: input.stop });
  };
}

describe('rafa effort sync over the real contact and a stub service strategy', () => {
  it('pulls, pushes and prints the hub line naming this port\'s project, under effort.syncMerge: ff-only, the default', async () => {
    const calls: Call[] = [];

    const outcome = await dispatchInProject(['effort', 'sync'], [EFFORT_SUBJECT], [createSyncCommand({ contact: realContact(stubService(calls)) })], plant());

    expect(outcome.exitCode).toBe(0);
    expect(calls).toEqual(['hubStatus', 'pull', 'push']);
    expect(lines(outcome.stdout)).toEqual([
      hubLine({ contractVersion: WIRE_CONTRACT_VERSION, projectId: 'p-2', projectName: 'Beta', pulled: 9, heldBack: 0 }),
    ]);
  });

  it('stops at the check under --status, asking only the status and the rows waiting to push', async () => {
    const calls: Call[] = [];

    const outcome = await dispatchInProject(['effort', 'sync', '--status'], [EFFORT_SUBJECT], [createSyncCommand({ contact: realContact(stubService(calls)) })], plant());

    expect(outcome.exitCode).toBe(0);
    expect(calls).toEqual(['hubStatus', 'pendingPush']);
    expect(lines(outcome.stdout)).toEqual([`hub: reachable, contract ${String(WIRE_CONTRACT_VERSION)}, project Beta; 6 rows waiting to push`]);
  });

  it('pulls and pushes as dry runs under --dry-run, printing the counts', async () => {
    const calls: Call[] = [];

    const outcome = await dispatchInProject(['effort', 'sync', '--dry-run'], [EFFORT_SUBJECT], [createSyncCommand({ contact: realContact(stubService(calls)) })], plant());

    expect(outcome.exitCode).toBe(0);
    expect(calls).toEqual(['hubStatus', 'pull --dry-run', 'push --dry-run']);
    expect(lines(outcome.stdout)).toEqual([
      `hub: reachable, contract ${String(WIRE_CONTRACT_VERSION)}, project Beta; dry run: 6 rows to push, 9 rows to pull, 1 rows in conflict;`
      + ' nothing was written',
    ]);
  });
});

describe('the effort sync declaration', () => {
  it('is an effort action, spends nothing, runs inside a project and declares its two flags', () => {
    expect([syncCommand.subject, syncCommand.action, syncCommand.name]).toEqual(['effort', 'sync', 'effort sync']);
    expect(syncCommand.spends).toBeUndefined();
    expect(syncCommand.needsProject).toBeUndefined();
    expect(syncCommand.args).toEqual([]);
    expect(syncCommand.flags.map((flag) => [flag.name, flag.type])).toEqual([['status', 'boolean'], ['dry-run', 'boolean']]);
    expect(syncCommand.outputs).toEqual(['text', 'json']);
  });
});

const TOKEN_SECRET = 'hub-token';
const TOKEN = 'ghp_effort_sync_command_token';

/** A hub the case stops once it ends: the stand-in, or a scripted one. */
interface RunningHub {
  readonly stop: () => Promise<void>;
}

let hubs: RunningHub[] = [];

afterEach(async () => {
  await Promise.all(hubs.map((started) => started.stop()));
  hubs = [];
});

/** A stand-in hub, stopped after the case. */
function hub(): StandInHub {
  const started = startStandInHub();
  hubs = [...hubs, started];
  return started;
}

/** A scripted hub's address and the path of every request it saw. */
interface ScriptedHub {
  readonly url: string;
  readonly paths: readonly string[];
}

/** A hub answering `/v1/status` with `contractVersion` and `migrations`, and every other route with a 500, stopped after the case. */
function scriptedHub(contractVersion: number, migrations: readonly string[]): ScriptedHub {
  const paths: string[] = [];
  const server = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    fetch: (request) => {
      const { pathname } = new URL(request.url);
      paths.push(pathname);
      return pathname.endsWith('/v1/status')
        ? Response.json({
          success: true,
          data: { version: '0.0.0-scripted', migrations, rows: {}, devices: [], contractVersion, capabilities: {} },
        })
        : Response.json({ success: false, error: 'the scripted hub answers the status alone' }, { status: 500 });
    },
  });
  hubs = [...hubs, { stop: () => server.stop(true) }];
  return { url: `http://127.0.0.1:${String(server.port)}`, paths };
}

/** Runs git in `cwd`, failing the case when it fails. */
function git(cwd: string, ...args: string[]): void {
  const env = Object.fromEntries(Object.entries(process.env)
    .filter((entry): entry is [string, string] => !entry[0].startsWith('GIT_') && entry[1] !== undefined));
  const ran = Bun.spawnSync(['git', '-c', 'user.name=rafa-test', '-c', 'user.email=rafa-test@example.invalid', ...args], { cwd, env });
  if (ran.exitCode !== 0) throw new Error(`git ${args.join(' ')} failed: ${ran.stderr.toString()}`);
}

/** A commit row of `seed`'s sha, taken at `timestamp`. */
function commitOf(seed: string, timestamp = '2026-10-01T08:00:00.000Z'): CommitEffortRow {
  const sha = new Bun.CryptoHasher('sha1')
    .update(seed)
    .digest('hex');
  return { sha, timestamp } as CommitEffortRow;
}

/** One device of the fake hub: a project whose root is a git repository holding a store. */
interface Device {
  readonly project: PlantedProject;
  /** The folder holding the store's file and its sync state file. */
  readonly storeDir: string;
  /** The project's id: the sha of its root commit, which the hub line names when the hub names no project. */
  readonly projectId: string;
  readonly append: (rows: readonly CommitEffortRow[]) => void;
}

/** The `effort.syncMerge` value a project config names; the default when left out. */
type SyncMerge = 'ff-only' | 'merge';

/** The project config naming the `service` strategy and the hub at `url`, with `syncMerge` when one is named. */
function serviceConfig(url: string, syncMerge?: SyncMerge): string {
  const merge = syncMerge === undefined
    ? ''
    : `  syncMerge: ${syncMerge}\n`;
  return `effort:\n  sync: service\n${merge}hub:\n  url: ${url}\n`;
}

/** A device holding `rows` commits of its own, its config naming `url`. */
function deviceOf(url: string, rows: readonly CommitEffortRow[]): Device {
  const project = plant(serviceConfig(url));
  git(project.root, 'init', '-q');
  git(project.root, 'commit', '-q', '--allow-empty', '--no-verify', '-m', 'root');
  const store = openSqliteStore(project.root);
  store.append('commits', [...rows]);
  const projectId = Bun.spawnSync(['git', 'rev-list', '--max-parents=0', 'HEAD'], { cwd: project.root }).stdout.toString().trim();
  return { project, storeDir: dirname(store.path('commits')), projectId, append: (more) => store.append('commits', [...more]) };
}

/** Pushes every row of `at` to `url`, as another device of the project would. */
async function seed(at: Device, url: string): Promise<void> {
  await createServiceSync({
    repoRoot: at.project.root,
    backend: 'sqlite',
    hub: { url, tokenSecret: TOKEN_SECRET, timeoutMs: 2000 },
    readSecret: () => Promise.resolve(TOKEN),
  }).push({ to: null });
}

/** What the contact is made with: the token its reader answers and the project it names. */
interface ServiceOptions {
  readonly token?: string | null;
  readonly project?: string;
  readonly syncMerge?: SyncMerge;
}

/** A contact seam over the real contact and the real `service` strategy for the hub at `url`. */
function serviceContact(url: string, options: ServiceOptions = {}): (input: SyncContactInput) => Promise<HubSyncReading> {
  const token = options.token === undefined
    ? TOKEN
    : options.token;
  return (input) => {
    const create = ({ repoRoot }: { readonly repoRoot: string }): Sync => createServiceSync({
      repoRoot,
      backend: 'sqlite',
      hub: { url, tokenSecret: TOKEN_SECRET, timeoutMs: 2000, ...options.project === undefined
        ? {}
        : { project: options.project } },
      readSecret: () => Promise.resolve(token),
    });
    const adapters = createAdapterRegistry([{ port: 'sync', kind: 'service', portVersion: PORT_VERSIONS.sync, create }]);
    const resolved = resolveConfig({ cli: {}, file: parseConfigText(serviceConfig(url, options.syncMerge), join(input.roots.root, '.rafa', 'config.yaml')), user: null });
    return createHubContact(
      { root: input.roots.root, home: input.roots.home, resolved, warn: input.warn },
      { modules: { adapters, manifest: { rafaVersion: '0.1.0', portVersions: PORT_VERSIONS } } },
    ).sync({ stop: input.stop });
  };
}

/** Dispatches `rafa effort sync <words>` at `at` over the real contact for the hub at `url`. */
async function syncAt(at: Device, url: string, words: readonly string[] = [], options: ServiceOptions = {}): Promise<CapturedRun> {
  return dispatchInProject(['effort', 'sync', ...words], [EFFORT_SUBJECT], [createSyncCommand({ contact: serviceContact(url, options) })], at.project);
}

/** The hash of every file in `dir`, by name: the store, its state file and whatever else a run left. */
function filesIn(dir: string): Record<string, string> {
  return Object.fromEntries(readdirSync(dir)
    .filter((name) => !name.endsWith('-wal') && !name.endsWith('-shm'))
    .map((name) => [name, new Bun.CryptoHasher('sha256').update(readFileSync(join(dir, name)))
      .digest('hex')]));
}

/** A stand-in hub already holding another device's rows, so its migrations are the ones this rafa knows. */
async function seededHub(): Promise<StandInHub> {
  const over = hub();
  await seed(deviceOf(over.url, [commitOf('peer-seed')]), over.url);
  return over;
}

describe('rafa effort sync --status over a fake hub', () => {
  it('reads /v1/status and sends no push or pull, leaving the store folder as it was, where a whole sync sends both', async () => {
    const over = await seededHub();
    const at = deviceOf(over.url, [commitOf('own-1'), commitOf('own-2'), commitOf('own-3')]);
    const requestsBefore = over.requests.length;
    const readsBefore = over.statusReads();
    const filesBefore = filesIn(at.storeDir);

    const outcome = await syncAt(at, over.url, ['--status']);

    expect(outcome.exitCode).toBe(0);
    expect(lines(outcome.stdout)).toEqual([`hub: reachable, contract ${String(WIRE_CONTRACT_VERSION)}, project ${at.projectId}; 3 rows waiting to push`]);
    expect(over.requests).toHaveLength(requestsBefore);
    expect(over.statusReads() - readsBefore).toBe(1);
    expect(filesIn(at.storeDir)).toEqual(filesBefore);

    const whole = await syncAt(at, over.url);

    expect(whole.exitCode).toBe(0);
    expect(over.requests.slice(requestsBefore).map(({ method, path }) => `${method} ${path}`)).toEqual(['GET /v1/effort/pull', 'POST /v1/effort/push']);
    expect(filesIn(at.storeDir)).not.toEqual(filesBefore);
  });

  it('stops at the skew check of a hub behind this rafa, no request past /v1/status, exiting 1', async () => {
    const over = hub();
    const at = deviceOf(over.url, [commitOf('own-1')]);

    const outcome = await syncAt(at, over.url, ['--status']);

    expect(outcome.exitCode).toBe(SYNC_REFUSED_EXIT);
    expect(lines(outcome.stdout + outcome.stderr)).toEqual([expect.stringContaining('the hub is behind this rafa')]);
    expect(over.requests).toEqual([]);
    expect(over.statusReads()).toBe(1);
  });
});

describe('rafa effort sync --dry-run over a fake hub', () => {
  /** A device synced once with a hub holding a peer's row, a row of the peer's and one of its own sharing a sha, and rows of its own waiting. */
  async function conflictingDevice(): Promise<{ readonly over: StandInHub; readonly at: Device }> {
    const over = await seededHub();
    const at = deviceOf(over.url, [commitOf('own-1')]);
    expect((await syncAt(at, over.url)).exitCode).toBe(0);
    await seed(deviceOf(over.url, [commitOf('shared', '2026-10-01T09:00:00.000Z'), commitOf('peer-new')]), over.url);
    at.append([commitOf('shared', '2026-10-01T10:00:00.000Z'), commitOf('own-2')]);
    return { over, at };
  }

  it('leaves every file of the store folder byte-identical, sends no push, and reports the conflict count', async () => {
    const { over, at } = await conflictingDevice();
    const filesBefore = filesIn(at.storeDir);
    const requestsBefore = over.requests.length;

    const outcome = await syncAt(at, over.url, ['--dry-run']);

    expect(outcome.exitCode).toBe(0);
    expect(lines(outcome.stdout)).toEqual([
      expect.stringMatching(new RegExp(`^hub: reachable, contract ${String(WIRE_CONTRACT_VERSION)}, project ${at.projectId}; dry run: \\d+ rows to push, `
        + '1 rows to pull, 1 rows in conflict; nothing was written$', 'u')),
    ]);
    expect(filesIn(at.storeDir)).toEqual(filesBefore);
    expect(over.requests.slice(requestsBefore).map(({ method }) => method)).toEqual(['GET']);
  });

  it('is told apart from the whole sync on the same device, which writes the store and the state file', async () => {
    const { over, at } = await conflictingDevice();
    const filesBefore = filesIn(at.storeDir);
    await syncAt(at, over.url, ['--dry-run']);

    const whole = await syncAt(at, over.url);

    expect(whole.exitCode).toBe(0);
    // Its pull records the shared row's conflict, so its push, under ff-only, holds that row.
    expect(lines(whole.stdout)).toEqual([
      `warn: ${conflictedLine(1)}`,
      expect.stringMatching(/^hub: reachable, contract \d+, project \S+; pulled \d+ rows$/u),
    ]);
    expect(Object.keys(filesIn(at.storeDir)).length).toBeGreaterThanOrEqual(Object.keys(filesBefore).length);
    expect(filesIn(at.storeDir)).not.toEqual(filesBefore);
    expect(over.requests.map(({ method }) => method)).toContain('POST');
  });
});

describe('rafa effort sync --dry-run over a fake hub, a conflict recorded', () => {
  /**
   * A device holding a commit of its own that a peer pushed to the hub
   * at another time, pulled so its merge records the conflict, and never
   * pushed: the row is past its push cursor and `merge_conflicts` names it.
   */
  async function recordedConflict(): Promise<{ readonly over: StandInHub; readonly at: Device }> {
    const over = await seededHub();
    await seed(deviceOf(over.url, [commitOf('shared', '2026-10-01T09:00:00.000Z')]), over.url);
    const at = deviceOf(over.url, [commitOf('shared', '2026-10-01T10:00:00.000Z'), commitOf('own-1')]);
    const pulled = await createServiceSync({
      repoRoot: at.project.root,
      backend: 'sqlite',
      hub: { url: over.url, tokenSecret: TOKEN_SECRET, timeoutMs: 2000 },
      readSecret: () => Promise.resolve(TOKEN),
    }).pull({ from: null, dryRun: false });
    expect(pulled).toMatchObject({ status: 'pulled', merge: { rowsInConflict: 1 } });
    return { over, at };
  }

  it('reports 1 rows would be held under ff-only, leaving the store and sync-service.json byte-for-byte unchanged', async () => {
    const { over, at } = await recordedConflict();
    const filesBefore = filesIn(at.storeDir);
    const requestsBefore = over.requests.length;

    const outcome = await syncAt(at, over.url, ['--dry-run'], { syncMerge: 'ff-only' });

    expect(outcome.exitCode).toBe(0);
    expect(lines(outcome.stdout + outcome.stderr)).toEqual([
      expect.stringMatching(/^hub: reachable, contract \d+, project \S+; dry run: \d+ rows to push, \d+ rows to pull, \d+ rows in conflict; 1 rows would be held; nothing was written$/u),
    ]);
    expect(Object.keys(filesBefore)).toContain(SYNC_STATE_FILE_NAME);
    expect(filesIn(at.storeDir)).toEqual(filesBefore);
    expect(over.requests.slice(requestsBefore).map(({ method }) => method)).toEqual(['GET']);

    // The control: the whole sync on the same device holds the row, prints the held line and writes the store folder.
    const whole = await syncAt(at, over.url, [], { syncMerge: 'ff-only' });

    expect(whole.exitCode).toBe(0);
    expect(lines(whole.stdout + whole.stderr)).toEqual([
      `warn: ${conflictedLine(1)}`,
      expect.stringMatching(/^hub: reachable, contract \d+, project \S+; pulled \d+ rows$/u),
    ]);
    expect(filesIn(at.storeDir)).not.toEqual(filesBefore);
  });

  it('prints no held count under merge for the same recorded conflict, writing nothing', async () => {
    const { over, at } = await recordedConflict();
    const filesBefore = filesIn(at.storeDir);

    const outcome = await syncAt(at, over.url, ['--dry-run'], { syncMerge: 'merge' });

    expect(outcome.exitCode).toBe(0);
    expect(lines(outcome.stdout + outcome.stderr)).toEqual([
      expect.stringMatching(/^hub: reachable, contract \d+, project \S+; dry run: \d+ rows to push, \d+ rows to pull, \d+ rows in conflict; nothing was written$/u),
    ]);
    expect(outcome.stdout).not.toContain('would be held');
    expect(filesIn(at.storeDir)).toEqual(filesBefore);
  });
});

/** The line the real hub refuses a project it does not serve with. */
const NOT_SERVED = 'rafa-hub: project alpha is not served here; add it under hub.projects';

describe('the exit codes of rafa effort sync over a fake hub', () => {
  it('exits 0 for a sync that completed, writing the hub line alone', async () => {
    const over = await seededHub();

    const outcome = await syncAt(deviceOf(over.url, [commitOf('own-1')]), over.url);

    expect(outcome.exitCode).toBe(0);
    expect(lines(outcome.stdout + outcome.stderr)).toEqual([expect.stringMatching(/^hub: reachable, contract \d+, project \S+; pulled 1 rows$/u)]);
  });

  it.each(['local', 'file'])('exits 0 for effort.sync: %s with one line and no hub contacted', async (strategy) => {
    const over = await seededHub();
    const requestsBefore = over.requests.length;
    const readsBefore = over.statusReads();
    const project = plant(`effort:\n  sync: ${strategy}\nhub:\n  url: ${over.url}\n`);

    const outcome = await dispatchInProject(['effort', 'sync'], [EFFORT_SUBJECT], [syncCommand], project);

    expect(outcome.exitCode).toBe(0);
    expect(lines(outcome.stdout + outcome.stderr)).toEqual([nothingToSyncLine(strategy)]);
    expect(over.requests).toHaveLength(requestsBefore);
    expect(over.statusReads()).toBe(readsBefore);
  });

  it('exits 0 for a hub that cannot be reached, its offline line the only one, beside the same hub reachable', async () => {
    const over = await seededHub();
    const at = deviceOf(over.url, [commitOf('own-1')]);
    expect((await syncAt(at, over.url)).exitCode).toBe(0);
    await over.stop();

    const outcome = await syncAt(at, over.url);

    expect(outcome.exitCode).toBe(0);
    expect(lines(outcome.stdout + outcome.stderr)).toEqual([expect.stringContaining('is unreachable')]);
    expect(outcome.stdout).not.toContain('hub: reachable');
  });

  it('exits 1 for a hub behind this rafa, naming the next step and sending nothing, beside the seeded hub exiting 0', async () => {
    const behind = hub();

    const outcome = await syncAt(deviceOf(behind.url, [commitOf('own-1')]), behind.url);

    expect(outcome.exitCode).toBe(SYNC_REFUSED_EXIT);
    expect(lines(outcome.stdout + outcome.stderr)).toEqual([expect.stringContaining('the hub is behind this rafa')]);
    expect(lines(outcome.stdout + outcome.stderr)[0]).toContain('upgrade the hub');
    expect(behind.requests).toEqual([]);
    const seeded = await seededHub();
    expect((await syncAt(deviceOf(seeded.url, [commitOf('own-1')]), seeded.url)).exitCode).toBe(0);
  });

  it('exits 1 for a hub holding a migration this rafa lacks, naming rafa self-update and sending nothing, beside the matching hub exiting 0', async () => {
    const known = SQLITE_MIGRATIONS.map(({ id }) => id);
    const ahead = scriptedHub(WIRE_CONTRACT_VERSION, [...known, '9999-from-a-newer-rafa']);

    const outcome = await syncAt(deviceOf(ahead.url, [commitOf('own-1')]), ahead.url);

    expect(outcome.exitCode).toBe(SYNC_REFUSED_EXIT);
    expect(lines(outcome.stdout + outcome.stderr)).toEqual([expect.stringContaining('rafa self-update')]);
    expect(ahead.paths).toEqual(['/v1/status']);
    const matching = scriptedHub(WIRE_CONTRACT_VERSION, known);
    expect((await syncAt(deviceOf(matching.url, [commitOf('own-1')]), matching.url, ['--status'])).exitCode).toBe(0);
  });

  it('exits 1 for a hub speaking another contract, naming both versions and sending nothing, beside the same contract exiting 0', async () => {
    const known = SQLITE_MIGRATIONS.map(({ id }) => id);
    const other = scriptedHub(WIRE_CONTRACT_VERSION + 1, known);

    const outcome = await syncAt(deviceOf(other.url, [commitOf('own-1')]), other.url);

    expect(outcome.exitCode).toBe(SYNC_REFUSED_EXIT);
    expect(lines(outcome.stdout + outcome.stderr)).toEqual([
      expect.stringContaining(`the hub speaks contract ${String(WIRE_CONTRACT_VERSION + 1)}, this rafa contract ${String(WIRE_CONTRACT_VERSION)}`),
    ]);
    expect(other.paths).toEqual(['/v1/status']);
    const same = scriptedHub(WIRE_CONTRACT_VERSION, known);
    expect((await syncAt(deviceOf(same.url, [commitOf('own-1')]), same.url, ['--status'])).exitCode).toBe(0);
  });

  it('exits 1 for a project the hub does not serve, its line naming it, beside the served project exiting 0', async () => {
    const over = await seededHub();
    over.setProjects([{ id: 'beta', name: 'Beta' }]);
    over.setFault(() => Response.json({ success: false, error: NOT_SERVED }, { status: 404 }));
    const at = deviceOf(over.url, [commitOf('own-1')]);

    const outcome = await syncAt(at, over.url, [], { project: 'alpha' });

    expect(outcome.exitCode).toBe(SYNC_REFUSED_EXIT);
    expect(lines(outcome.stdout + outcome.stderr)).toEqual([expect.stringContaining('project alpha is not served here')]);
    expect(outcome.stdout).not.toContain('hub: reachable');
    over.setFault(null);
    over.setProjects([{ id: 'alpha', name: 'Alpha' }]);
    const served = await syncAt(at, over.url, [], { project: 'alpha' });
    expect(served.exitCode).toBe(0);
    expect(lines(served.stdout)).toEqual([expect.stringContaining('project Alpha;')]);
  });

  it('exits 1 for a missing token, its line naming the secret and nothing sent, beside the stored token exiting 0', async () => {
    const over = await seededHub();
    const requestsBefore = over.requests.length;
    const at = deviceOf(over.url, [commitOf('own-1')]);

    const outcome = await syncAt(at, over.url, [], { token: null });

    expect(outcome.exitCode).toBe(SYNC_REFUSED_EXIT);
    expect(lines(outcome.stdout + outcome.stderr)).toEqual([expect.stringContaining(TOKEN_SECRET)]);
    expect(outcome.stdout).not.toContain('hub: reachable');
    expect(over.requests).toHaveLength(requestsBefore);
    expect((await syncAt(at, over.url)).exitCode).toBe(0);
  });
});
