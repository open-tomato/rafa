/**
 * Pull-first sync across the whole chain: the real `service` strategy
 * (`packages/rafa-sync-service`) and the real hub contact
 * (`packages/rafa-effort/src/effort/sync/contact.ts`), reached through a
 * real `rafa effort collect`, against the real hub server (`server.ts`)
 * over the real SQLite store. `contact.test.ts` and `sync.test.ts` cover
 * each half over stand-ins, and the stand-in hub records no conflict of
 * its own, so only this file reads what `effort.syncMerge` leaves in the
 * hub's `merge_conflicts`.
 *
 * ## One finding filed twice
 *
 * Each case that needs a conflict writes one finding, under one id, one
 * dispatch and one time, to two stores through the store's own writers
 * (`writeFindings`, then `writeTrackerRef`). The two rows differ in their
 * origin pair and in `tracker_ref` alone, so the merge that meets them
 * records the pair under the field `tracker_ref` and keeps its own row
 * (`SET_ONCE`, `merge-rules.ts`).
 *
 * ## The cases, the refusing ones first
 *
 *   - **A pull refused for skew** under `ff-only` and
 *     `effort.syncSkew: refuse`, against a hub holding one test-only
 *     migration this build lacks: no push request reaches the hub.
 *   - **An unreachable hub** under `ff-only`, first one whose store does
 *     not open (`503` on every route), then one whose pull alone fails
 *     (`500`): no push request reaches either, and `effort collect` exits
 *     as it does with no hub at all.
 *   - **`merge`**: device B's push sends its row, and the hub's
 *     `merge_conflicts` records it.
 *   - **`ff-only`**: B's pull records the conflict, its push sends every
 *     other row, the hub keeps device A's `tracker_ref` and lacks B's
 *     row, B's store keeps it, and B's output holds the held line. A
 *     second `effort collect` neither sends the row nor prints the line:
 *     the line is written once, by the push whose cut reaches the row.
 *   - **A file merge**: a conflict `rafa effort merge` records on B, from
 *     a store file the hub never saw, is held on B's next `effort
 *     collect`.
 *
 * Push requests are counted at the server, off the `request` lines its
 * `log` is handed. Each "no push request" claim has a control under
 * `merge` against the same hub, which counts one: the order is what makes
 * the number zero. The pull-alone failure is the case that tells the two
 * orders apart for an unreachable hub, since a hub failing every route
 * stops a push at its status read under either order.
 *
 * A device is `bun src/rafa.ts` spawned as a real process, never
 * dispatched in-process, exactly as `two-devices.integration.test.ts`
 * spawns one and for the same reason: `Bun.spawn`, never
 * `Bun.spawnSync`, since the hub is a `Bun.serve` in this very process.
 * The hub token sits in a scratch secrets file named by
 * `testdata/test-secrets.ts`, never the system secret store.
 */
import type { StandInGitHub } from './identity/testdata/stand-in-github.js';
import type { HubLogEntry, HubServer } from './server.js';
import type { HubStore } from './store/port.js';
import type { HubMigrationCatalogue } from './store/sqlite.js';
import type { Row } from './testdata/compare-merged-stores.js';
import type { IssueRef } from '@open-tomato/rafa/ports';

import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { openSqliteStore, readStoreOrigin } from '@open-tomato/rafa/store';
import { writeFindings } from '@open-tomato/rafa/store/findings';
import { SQLITE_MIGRATIONS } from '@open-tomato/rafa/store/migrations';
import { writeTrackerRef } from '@open-tomato/rafa/store/tracker-refs';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { DEFAULT_STORE_FILE } from './config.js';
import { openGitHubIdentity } from './identity/github.js';
import { startStandInGitHub } from './identity/testdata/stand-in-github.js';
import { HUB_ROUTES, startHubServer } from './server.js';
import { openSqliteHubStore } from './store/sqlite.js';
import { contentOf, mergedTableNames, rowsOf } from './testdata/compare-merged-stores.js';
import { plantTestSecret, testSecretsChildEnv, testSecretsFileIn } from './testdata/test-secrets.js';

const VERSION = '0.0.0-pull-first';
const REPOSITORY = 'open-tomato/rafa';
const WRITER = 'ghp_pull_first_writer_000000001';

/** The test-only migration a hub ahead of this build holds: one column on `findings`. */
const AHEAD_MIGRATION = 'fixture-finding-tag';

/** This build's catalogue and {@link AHEAD_MIGRATION}. */
const AHEAD_CATALOGUE: HubMigrationCatalogue = [
  ...SQLITE_MIGRATIONS,
  { id: AHEAD_MIGRATION, breaks: [], sql: 'ALTER TABLE findings ADD COLUMN fixture_tag TEXT;' },
];

/** The id of the finding two stores file. */
const SHARED_FINDING = 'finding-filed-twice';

/** The id of a finding device B alone holds: a row of the same table that is in no conflict. */
const OWN_FINDING = 'finding-of-device-b';

/** The time both writes of one finding are stamped with. */
const WRITTEN_AT = '2026-11-20T10:00:00.000Z';

/** The reference device A filed the shared finding under. */
const REF_A: IssueRef = reference(1001);

/** The reference device B filed the same finding under. */
const REF_B: IssueRef = reference(2002);

/** The reference the store file the hub never saw filed it under. */
const REF_FILE: IssueRef = reference(3003);

/** How long a spawned command may take before it is killed. */
const RUN_TIMEOUT_MS = 30_000;

/** How long one case may take. */
const CASE_TIMEOUT_MS = 120_000;

/** `hub.timeout` of every device, well past what a loaded runner takes over one request. */
const HUB_TIMEOUT = '10s';

/** The real rafa CLI entry, spawned as a process; never imported. */
const RAFA_ENTRY = fileURLToPath(new URL('../../../src/rafa.ts', import.meta.url));

/** The real `rafa-sync-service` package, named by path in each device's `modules:`; never imported. */
const SYNC_SERVICE_PACKAGE = fileURLToPath(new URL('../../rafa-sync-service', import.meta.url));

/** The `name` the package's `package.json` carries, and `allowList:` must match. */
const SYNC_SERVICE_NAME = '@open-tomato/rafa-sync-service';

/** The line a push writes when it left one conflicted row out. */
const HELD_LINE = 'effort sync: 1 rows held: they differ from the hub\'s copy (merge_conflicts); the rest was pushed';

/** The line a pull refused for a migration this build lacks writes. */
const SELF_UPDATE_LINE = `effort sync: this rafa is behind the hub (migration ${AHEAD_MIGRATION}); nothing was merged.`
  + ' Next step: rafa self-update, then rafa effort sync';

/** `rafa effort collect --no-sessions`. */
const EFFORT_COLLECT: readonly string[] = ['effort', 'collect', '--no-sessions'];

const gitBinary = Bun.which('git');
if (gitBinary === null) throw new Error('git is not on the PATH this suite runs under');
const GIT_DIR = dirname(gitBinary);

/** The environment this process runs `git` fixture steps under: its own, with no `GIT_*` variable reaching it. */
function gitEnv(): Record<string, string> {
  return Object.fromEntries(Object.entries(process.env)
    .filter((entry): entry is [string, string] => !entry[0].startsWith('GIT_') && entry[1] !== undefined));
}

/** Runs `git` in `cwd` as a fixture step, throwing what it said on the way out when it failed. */
function git(cwd: string, ...args: string[]): void {
  const ran = Bun.spawnSync(['git', ...args], { cwd, env: gitEnv() });
  if (ran.exitCode !== 0) throw new Error(`git ${args.join(' ')} in ${cwd} failed: ${ran.stderr.toString()}`);
}

/** A GitHub issue reference to issue `number`. */
function reference(number: number): IssueRef {
  return {
    opt: number,
    kind: 'github',
    externalId: String(number),
    url: `https://github.com/${REPOSITORY}/issues/${String(number)}`,
  };
}

/** One scratch device: its repository, a home of its own, and the secrets file holding the hub token. */
interface Device {
  readonly root: string;
  readonly home: string;
  readonly secretsFile: string;
}

/** The `effort` settings a device's config names beside `sync: service`. */
interface EffortSettings {
  /** `effort.syncMerge`; the key is left out, so the default applies, when this is. */
  readonly syncMerge?: 'ff-only' | 'merge';
  /** `effort.syncSkew`; the key is left out when this is. */
  readonly syncSkew?: 'refuse';
}

/**
 * A fresh git repository under `scope` named `name`, with a git identity
 * of its own and one commit over a file no other device holds, and an
 * empty `.rafa/` directory; {@link configure} names its hub.
 */
function plantDevice(scope: string, name: string): Device {
  const root = realpathSync(mkdtempSync(join(scope, `${name}-`)));
  const home = realpathSync(mkdtempSync(join(scope, `${name}-home-`)));

  git(root, 'init', '-q');
  writeFileSync(join(root, '.gitignore'), '.rafa/\n', 'utf8');
  writeFileSync(join(root, `${name}.txt`), `${name}'s own row\n`, 'utf8');
  git(root, 'add', '-A');
  git(root, '-c', `user.name=${name}`, '-c', `user.email=${name}@example.invalid`, 'commit', '-q', '--no-verify', '-m', `${name} seed`);

  mkdirSync(join(root, '.rafa'), { recursive: true });
  return { root, home, secretsFile: testSecretsFileIn(scope) };
}

/**
 * A second checkout of `of`'s repository under `scope`: the same project,
 * so `rafa effort merge` takes its store file, with a store, and so an
 * origin, of its own. It names no hub.
 */
function plantSecondCheckout(scope: string, of: Device): string {
  const root = join(realpathSync(mkdtempSync(join(scope, 'file-source-'))), 'checkout');
  git(scope, 'clone', '-q', of.root, root);
  return root;
}

/** Writes `device`'s config naming `effort.sync: service` over `hubUrl`, with `settings`. */
function configure(device: Device, hubUrl: string, secretName: string, settings: EffortSettings): void {
  writeFileSync(join(device.root, '.rafa', 'config.yaml'), [
    'pr:',
    '  provider: none',
    'effort:',
    '  sync: service',
    ...settings.syncMerge === undefined
      ? []
      : [`  syncMerge: ${settings.syncMerge}`],
    ...settings.syncSkew === undefined
      ? []
      : [`  syncSkew: ${settings.syncSkew}`],
    'hub:',
    `  url: ${hubUrl}`,
    `  tokenSecret: ${secretName}`,
    `  timeout: ${HUB_TIMEOUT}`,
    'modules:',
    `  - path: ${SYNC_SERVICE_PACKAGE}`,
    'allowList:',
    `  - "${SYNC_SERVICE_NAME}"`,
    '',
  ].join('\n'), 'utf8');
}

/** What one command run answered: its exit code, and standard output and error together. */
interface CommandRun {
  readonly exitCode: number | null;
  readonly output: string;
}

/** Spawns the real `rafa` for `device` with `words`. `Bun.spawn`, never `Bun.spawnSync`; see the module note. */
async function runCommand(device: Device, words: readonly string[]): Promise<CommandRun> {
  const child = Bun.spawn([process.execPath, RAFA_ENTRY, ...words], {
    cwd: device.root,
    env: {
      TMPDIR: tmpdir(),
      RAFA_TEST: '1',
      PATH: GIT_DIR,
      ...testSecretsChildEnv(device.home, device.secretsFile),
    },
    stdout: 'pipe',
    stderr: 'pipe',
    timeout: RUN_TIMEOUT_MS,
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { exitCode, output: `${stdout}${stderr}` };
}

/** The lines of `output` that carry a sync warning, with the command's own `warn: ` prefix taken off. */
function syncLines(output: string): string[] {
  return output.split('\n')
    .map((line) => line.replace(/^warn: /, ''))
    .filter((line) => line.startsWith('effort sync:'));
}

/** Whether `line` is the hub-unreachable line a contact writes for the hub at `hubUrl`, whatever its reason. */
function isUnreachableLine(line: string, hubUrl: string): boolean {
  return line.startsWith(`effort sync: the hub at ${hubUrl} is unreachable (`)
    && line.endsWith('); this command used the local store, and its rows sync on the next contact');
}

/**
 * Writes the finding `id` to the store under `root` and files it under
 * `ref`, when one is given. Every write of one id is the same row but for
 * its origin pair and the reference.
 */
function fileFinding(root: string, id: string, ref: IssueRef | null): void {
  const dispatch = { sessionId: `session-of-${id}`, planStub: 'pull-first-plan', taskLine: `- [ ] task of ${id}` };
  const seams = { now: () => new Date(WRITTEN_AT), newId: () => id };
  const artifact = `fixture artifact of ${id}`;
  const written = writeFindings(root, {
    dispatch,
    outcome: 'done',
    findings: [{
      kind: 'gotcha',
      trigger: 'when two devices file one finding',
      what: 'each files an issue of its own',
      cause: null,
      resolution: null,
      artifact,
      signal: 'loud',
      domain: null,
      extras: [],
    }],
  }, seams);
  if (written.appended !== 1) throw new Error(`the finding ${id} was not written: ${JSON.stringify(written)}`);
  if (ref === null) return;
  const filed = writeTrackerRef(root, { dispatch, outcome: 'done', artifact, ref }, seams);
  if (filed.action !== 'attached') throw new Error(`the reference of ${id} was ${filed.action}, not attached`);
}

/** The store file under the project at `root`. */
function storePathOf(root: string): string {
  return openSqliteStore(root).path('commits');
}

/** The origin the store at `path` records, or a throw when it records none. */
function originOf(path: string): string {
  const origin = readStoreOrigin(path);
  if (origin === null) throw new Error(`the store at ${path} records no origin`);
  return origin;
}

/** The rows of `findings` under the id `id` on the store at `path`. */
function findingRows(path: string, id: string): Row[] {
  return rowsOf(path, 'findings').filter((row) => row['id'] === id);
}

/** The reference the one row of the finding `id` holds on the store at `path`. */
function referenceOn(path: string, id: string): unknown {
  const rows = findingRows(path, id);
  expect(rows).toHaveLength(1);
  return JSON.parse(String(rows[0]?.['tracker_ref'])) as unknown;
}

/** One `merge_conflicts` row, its incoming row read down to its origin and its reference. */
interface Conflict {
  readonly table: unknown;
  readonly localSeq: unknown;
  readonly field: unknown;
  readonly incomingOrigin: unknown;
  readonly incomingRef: unknown;
}

/** Every `merge_conflicts` row of the store at `path`. */
function conflictsOn(path: string): Conflict[] {
  return rowsOf(path, 'merge_conflicts').map((row) => {
    const incoming = JSON.parse(String(row['incoming'])) as Record<string, unknown>;
    return {
      table: row['table_name'],
      localSeq: row['local_seq'],
      field: row['field'],
      incomingOrigin: incoming['origin_store'],
      incomingRef: JSON.parse(String(incoming['tracker_ref'])) as unknown,
    };
  });
}

/** The conflict one store records for the shared finding: its row at `localSeq`, against `origin`'s reference `ref`. */
function sharedConflict(localSeq: unknown, origin: string, ref: IssueRef): Conflict {
  return { table: 'findings', localSeq, field: 'tracker_ref', incomingOrigin: origin, incomingRef: ref };
}

/** Every merged row the store at `path` holds under its own `origin`, as `<table> <content>`, sorted. */
function ownRows(path: string, origin: string): string[] {
  return mergedTableNames(path)
    .flatMap((table) => rowsOf(path, table)
      .filter((row) => row['origin_store'] === origin)
      .map((row) => `${table} ${contentOf(table, row)}`))
    .sort();
}

/** How a case's hub is to misbehave; each left out is the real store as it is. */
interface HubShape {
  /** The migration catalogue its store is built on; this build's own when left out. */
  readonly catalogue?: HubMigrationCatalogue;
  /** What fails: the store's opening, so every route answers `503`, or its pull alone, answered `500`. */
  readonly down?: 'every-route' | 'pull';
}

/** A running hub, its store file, and the push requests it has been sent. */
interface ScratchHub {
  readonly server: HubServer;
  readonly storePath: string;
  /** How many requests have reached the push route, whatever they were answered. */
  readonly pushRequests: () => number;
  /** The status of each request that reached the pull route, in order. */
  readonly pullStatuses: () => readonly unknown[];
}

describe('a device pulls before it pushes, and holds the rows in conflict', () => {
  let scope = '';
  let github: StandInGitHub;
  let hubs: HubServer[] = [];
  let secretName = '';

  /** Starts the real hub server over a SQLite store in a directory of its own, shaped by `shape`. */
  const startHub = (shape: HubShape = {}): ScratchHub => {
    const directory = realpathSync(mkdtempSync(join(scope, 'hub-')));
    const logged: HubLogEntry[] = [];
    const openStore = async (): Promise<HubStore> => {
      if (shape.down === 'every-route') throw new Error('fixture: the hub store does not open');
      const store = await openSqliteHubStore(
        { directory, now: () => new Date() },
        shape.catalogue === undefined
          ? {}
          : { migrations: shape.catalogue },
      );
      return shape.down === 'pull'
        ? { ...store, pull: () => Promise.reject(new Error('fixture: the pull route is down')) }
        : store;
    };
    const server = startHubServer({
      port: 0,
      hostname: '127.0.0.1',
      version: VERSION,
      identity: openGitHubIdentity({ repository: REPOSITORY, cacheForMs: null, apiBase: github.url }),
      openStore,
      log: (entry) => {
        logged.push(entry);
      },
    });
    hubs = [...hubs, server];
    const requestsTo = (route: string): HubLogEntry[] => logged
      .filter((entry) => entry.event === 'request' && entry['path'] === route);
    return {
      server,
      storePath: join(directory, DEFAULT_STORE_FILE),
      pushRequests: () => requestsTo(HUB_ROUTES.push).length,
      pullStatuses: () => requestsTo(HUB_ROUTES.pull).map((entry) => entry['status']),
    };
  };

  /** Plants a device named `name` over `hub`, configured with `settings`. */
  const deviceOn = (hub: ScratchHub, name: string, settings: EffortSettings): Device => {
    const device = plantDevice(scope, name);
    configure(device, hub.server.url, secretName, settings);
    return device;
  };

  /** Device A files the shared finding under {@link REF_A} and collects, so the hub holds its row. */
  const filedByDeviceA = async (hub: ScratchHub): Promise<Device> => {
    const a = deviceOn(hub, 'device-a', { syncMerge: 'ff-only' });
    fileFinding(a.root, SHARED_FINDING, REF_A);
    const run = await runCommand(a, EFFORT_COLLECT);
    expect(run.exitCode).toBe(0);
    expect(syncLines(run.output)).toEqual([]);
    expect(referenceOn(hub.storePath, SHARED_FINDING)).toEqual(REF_A);
    return a;
  };

  beforeEach(() => {
    scope = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-hub-pull-first-')));
    github = startStandInGitHub({ [WRITER]: { login: 'writer', roles: { [REPOSITORY]: 'write' } } });
    secretName = `hub-token-${randomUUID()}`;
    plantTestSecret(scope, secretName, WRITER);
  });

  afterEach(async () => {
    await Promise.all(hubs.map((server) => server.stop()));
    hubs = [];
    await github.stop();
    rmSync(scope, { recursive: true, force: true });
  });

  it('sends no push request under ff-only when the pull is refused for a migration this build lacks', async () => {
    const hub = startHub({ catalogue: AHEAD_CATALOGUE });
    const b = deviceOn(hub, 'device-b', { syncMerge: 'ff-only', syncSkew: 'refuse' });
    fileFinding(b.root, SHARED_FINDING, REF_B);

    const refused = await runCommand(b, EFFORT_COLLECT);

    expect(refused.exitCode).toBe(0);
    expect(refused.output).toContain('+1 rows');
    expect(syncLines(refused.output)).toEqual([SELF_UPDATE_LINE]);
    expect(hub.pullStatuses()).toHaveLength(1);
    expect(hub.pushRequests()).toBe(0);
    expect(mergedTableNames(hub.storePath).flatMap((table) => rowsOf(hub.storePath, table))).toEqual([]);
    expect(findingRows(storePathOf(b.root), SHARED_FINDING)).toHaveLength(1);

    // The control: the same device against the same hub, pushing first, does send a push request.
    configure(b, hub.server.url, secretName, { syncMerge: 'merge', syncSkew: 'refuse' });
    const pushedFirst = await runCommand(b, EFFORT_COLLECT);
    expect(pushedFirst.exitCode).toBe(0);
    expect(hub.pushRequests()).toBe(1);
  }, CASE_TIMEOUT_MS);

  it('sends no push request under ff-only to an unreachable hub, and exits as the command itself does', async () => {
    const dead = startHub({ down: 'every-route' });
    const b = deviceOn(dead, 'device-b', { syncMerge: 'ff-only' });
    fileFinding(b.root, SHARED_FINDING, REF_B);

    // Every route fails: one line, the local store written, the collect's own exit code.
    const unreachable = await runCommand(b, EFFORT_COLLECT);

    expect(unreachable.exitCode).toBe(0);
    expect(unreachable.output).toContain('+1 rows');
    expect(syncLines(unreachable.output)).toHaveLength(1);
    expect(isUnreachableLine(String(syncLines(unreachable.output)[0]), dead.server.url)).toBe(true);
    expect(dead.pushRequests()).toBe(0);

    // The pull alone fails: a push would be answered, and none is sent.
    const halfDead = startHub({ down: 'pull' });
    configure(b, halfDead.server.url, secretName, { syncMerge: 'ff-only' });

    const pullFailed = await runCommand(b, EFFORT_COLLECT);

    expect(pullFailed.exitCode).toBe(0);
    expect(syncLines(pullFailed.output)).toHaveLength(1);
    expect(isUnreachableLine(String(syncLines(pullFailed.output)[0]), halfDead.server.url)).toBe(true);
    expect(halfDead.pullStatuses()).toEqual([500]);
    expect(halfDead.pushRequests()).toBe(0);

    // The control: pushing first, the same device reaches that hub's push route before its pull fails.
    configure(b, halfDead.server.url, secretName, { syncMerge: 'merge' });
    const pushedFirst = await runCommand(b, EFFORT_COLLECT);
    expect(pushedFirst.exitCode).toBe(0);
    expect(halfDead.pushRequests()).toBe(1);
    expect(referenceOn(halfDead.storePath, SHARED_FINDING)).toEqual(REF_B);
  }, CASE_TIMEOUT_MS);

  it('sends the conflicting row under merge, and the hub records it in its merge_conflicts', async () => {
    const hub = startHub();
    await filedByDeviceA(hub);
    const b = deviceOn(hub, 'device-b', { syncMerge: 'merge' });
    fileFinding(b.root, SHARED_FINDING, REF_B);
    const pushesBefore = hub.pushRequests();

    const run = await runCommand(b, EFFORT_COLLECT);

    expect(run.exitCode).toBe(0);
    expect(syncLines(run.output)).toEqual([]);
    expect(hub.pushRequests()).toBe(pushesBefore + 1);
    const bOrigin = originOf(storePathOf(b.root));
    const [kept] = findingRows(hub.storePath, SHARED_FINDING);
    expect(conflictsOn(hub.storePath)).toEqual([sharedConflict(kept?.['seq'], bOrigin, REF_B)]);
    expect(referenceOn(hub.storePath, SHARED_FINDING)).toEqual(REF_A);
    expect(referenceOn(storePathOf(b.root), SHARED_FINDING)).toEqual(REF_B);
  }, CASE_TIMEOUT_MS);

  it('holds the conflicting row under ff-only, and pushes every other row', async () => {
    const hub = startHub();
    const a = await filedByDeviceA(hub);
    const b = deviceOn(hub, 'device-b', { syncMerge: 'ff-only' });
    fileFinding(b.root, SHARED_FINDING, REF_B);
    fileFinding(b.root, OWN_FINDING, null);
    const pushesBefore = hub.pushRequests();

    const run = await runCommand(b, EFFORT_COLLECT);

    expect(run.exitCode).toBe(0);
    expect(syncLines(run.output)).toEqual([HELD_LINE]);
    expect(hub.pushRequests()).toBe(pushesBefore + 1);

    // B's pull recorded the conflict against B's own row.
    const bPath = storePathOf(b.root);
    const bOrigin = originOf(bPath);
    const aOrigin = originOf(storePathOf(a.root));
    const held = findingRows(bPath, SHARED_FINDING);
    expect(held).toHaveLength(1);
    expect(held[0]?.['origin_store']).toBe(bOrigin);
    expect(conflictsOn(bPath)).toEqual([sharedConflict(held[0]?.['seq'], aOrigin, REF_A)]);

    // B's store keeps its row; the hub lacks it, keeps A's reference and was handed nothing to settle.
    expect(referenceOn(bPath, SHARED_FINDING)).toEqual(REF_B);
    expect(referenceOn(hub.storePath, SHARED_FINDING)).toEqual(REF_A);
    expect(findingRows(hub.storePath, SHARED_FINDING)[0]?.['origin_store']).toBe(aOrigin);
    expect(conflictsOn(hub.storePath)).toEqual([]);

    // Every other row of B's is on the hub: its commit and its other finding among them.
    const heldContent = `findings ${contentOf('findings', held[0] ?? {})}`;
    const others = ownRows(bPath, bOrigin).filter((row) => row !== heldContent);
    expect(others.map((row) => row.split(' ')[0])).toEqual(expect.arrayContaining(['commits', 'findings']));
    expect(ownRows(hub.storePath, bOrigin)).toEqual(others);

    // The push cursor moved past the held row, so the next contact does not send it, and
    // prints no held line: the line is written once, by the push whose cut reaches the row.
    // The first run's line above is the control that `syncLines` reads it.
    const again = await runCommand(b, EFFORT_COLLECT);
    expect(again.exitCode).toBe(0);
    expect(syncLines(again.output)).toEqual([]);
    expect(ownRows(hub.storePath, bOrigin)).toEqual(others);
    expect(referenceOn(hub.storePath, SHARED_FINDING)).toEqual(REF_A);
    expect(conflictsOn(hub.storePath)).toEqual([]);
  }, CASE_TIMEOUT_MS);

  it('holds a conflict rafa effort merge recorded from a store file the hub never saw', async () => {
    const hub = startHub();
    // `effort.syncMerge` is left out: the default is what holds the row.
    const b = deviceOn(hub, 'device-b', {});
    fileFinding(b.root, SHARED_FINDING, REF_B);
    fileFinding(b.root, OWN_FINDING, null);
    const source = plantSecondCheckout(scope, b);
    fileFinding(source, SHARED_FINDING, REF_FILE);
    const bPath = storePathOf(b.root);
    const sourcePath = storePathOf(source);

    const merged = await runCommand(b, ['effort', 'merge', sourcePath]);

    expect(merged.exitCode).toBe(0);
    expect(merged.output).toContain('1 in conflict');
    const bOrigin = originOf(bPath);
    const [held] = findingRows(bPath, SHARED_FINDING);
    expect(conflictsOn(bPath)).toEqual([sharedConflict(held?.['seq'], originOf(sourcePath), REF_FILE)]);
    expect(hub.pushRequests()).toBe(0);

    const run = await runCommand(b, EFFORT_COLLECT);

    expect(run.exitCode).toBe(0);
    expect(syncLines(run.output)).toEqual([HELD_LINE]);
    expect(hub.pushRequests()).toBe(1);
    expect(findingRows(hub.storePath, SHARED_FINDING)).toEqual([]);
    expect(findingRows(hub.storePath, OWN_FINDING).map((row) => row['origin_store'])).toEqual([bOrigin]);
    expect(rowsOf(hub.storePath, 'commits').map((row) => row['origin_store'])).toEqual([bOrigin]);
    expect(conflictsOn(hub.storePath)).toEqual([]);
    expect(referenceOn(bPath, SHARED_FINDING)).toEqual(REF_B);
  }, CASE_TIMEOUT_MS);
});
