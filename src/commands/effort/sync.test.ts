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
 */
import type { SyncCommandSeams, SyncContactInput } from './sync.js';
import type { CapturedRun, PlantedProject } from '../../tests/cli-capture.js';
import type { Sync, SyncPullRequest, SyncPullResult, SyncPushRequest, SyncPushResult } from '@open-tomato/rafa/ports';
import type { HubSyncContacted, HubSyncReading, HubSyncStatus } from '@open-tomato/rafa-effort/effort/sync/contact';

import '../../config-registry.js';

import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { createAdapterRegistry, PORT_VERSIONS } from '@open-tomato/rafa/core/adapters';
import { parseConfigText, resolveConfig } from '@open-tomato/rafa/core/config';
import { WIRE_CONTRACT_VERSION } from '@open-tomato/rafa/store';
import { SQLITE_MIGRATIONS } from '@open-tomato/rafa/store/migrations';
import { createHubContact, hubLine } from '@open-tomato/rafa-effort/effort/sync/contact';

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
  it('pushes, pulls and prints the hub line naming this port\'s project', async () => {
    const calls: Call[] = [];

    const outcome = await dispatchInProject(['effort', 'sync'], [EFFORT_SUBJECT], [createSyncCommand({ contact: realContact(stubService(calls)) })], plant());

    expect(outcome.exitCode).toBe(0);
    expect(calls).toEqual(['hubStatus', 'push', 'pull']);
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

  it('pushes and pulls as dry runs under --dry-run, printing the counts', async () => {
    const calls: Call[] = [];

    const outcome = await dispatchInProject(['effort', 'sync', '--dry-run'], [EFFORT_SUBJECT], [createSyncCommand({ contact: realContact(stubService(calls)) })], plant());

    expect(outcome.exitCode).toBe(0);
    expect(calls).toEqual(['hubStatus', 'push --dry-run', 'pull --dry-run']);
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
