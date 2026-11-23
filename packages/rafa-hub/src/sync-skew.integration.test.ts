/**
 * Sync skew across the whole chain: the real `service` strategy
 * (`packages/rafa-sync-service`) and the real hub contact
 * (`packages/rafa-effort/src/effort/sync/contact.ts`), reached through a
 * real `rafa effort collect`, against the real hub server (`server.ts`)
 * over the real SQLite store. `sync.test.ts` and `contact.test.ts` cover
 * each half over stand-ins; this file is the seam between them and the
 * hub's own projected pull, reached only over HTTP.
 *
 * ## The two builds
 *
 * The hub is built on this build's catalogue plus two test-only
 * migrations (`SQLITE_MIGRATIONS` and {@link TEST_MIGRATIONS}, handed to
 * `openSqliteHubStore` as its `migrations`): one adds
 * `findings.fixture_tag`, the other `commits.fixture_note`. A device on
 * the real build is then two migrations behind the hub, with no second
 * build of rafa. A device "on the full catalogue" is the same process
 * spawned under a preload (`bun --preload`) that appends the same two
 * migrations to the `SQLITE_MIGRATIONS` array the process runs on, which
 * is every default of `bringForward`, `materialiseWirePayload` and the
 * service strategy's own catalogue lookup. The preload is written into
 * the case's scratch directory and names the migrations module by its
 * path, so it adds no file to the repository and shares the module
 * instance the device runs.
 *
 * ## The cases
 *
 *   - **A device two behind.** Under the default (`refuse`) its pull is
 *     refused with the `rafa self-update` line and the hub's rows are
 *     not merged. Under `effort.syncSkew: pull-projected` the same
 *     device pulls the rows without the two columns, with one
 *     `pulled` line; its `held_rows` lists each of them and its
 *     `sync-service.json` holds `heldBack`.
 *   - **The refill.** The device runs once on the full catalogue and
 *     refills them: one `refilled` line, `held_rows` and `heldBack`
 *     empty, no new `merge_conflicts` row, and every merged table's
 *     rows, matched by origin pair, equal on every column but `seq` to
 *     those of a device that was never skewed. A held
 *     `findings.tracker_ref` set on the device meanwhile keeps its value
 *     (`SET_ONCE`, `merge-rules.ts`) and the row takes the rest whole.
 *   - **A hub one migration short.** The device on the full catalogue
 *     is refused its push under both settings with the `upgrade the hub`
 *     line, and the hub holds none of its rows.
 *
 * The seed rows are pushed to the hub store directly, before the server
 * opens it, as `WirePayload`s carrying the two columns the real build
 * has no way to write. A device is `bun src/rafa.ts` spawned as a real
 * process, never dispatched in-process, exactly as
 * `contract-skew.integration.test.ts` spawns one and for the same
 * reason: `Bun.spawn`, never `Bun.spawnSync`, since the hub is a
 * `Bun.serve` in this very process. The hub token sits in a scratch
 * secrets file named by `testdata/test-secrets.ts`, never the system
 * secret store.
 */
import type { HubServer } from './server.js';
import type { HubStore } from './store/port.js';
import type { HubMigrationCatalogue } from './store/sqlite.js';
import type { WirePayload, WireRow } from '@open-tomato/rafa/store';

import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { decodeWirePayload, openSqliteStore, WIRE_FORMAT, WIRE_VERSION } from '@open-tomato/rafa/store';
import { SQLITE_MIGRATIONS } from '@open-tomato/rafa/store/migrations';
import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { DEFAULT_STORE_FILE } from './config.js';
import { HUB_ACTIONS } from './identity/port.js';
import { openMemoryIdentity } from './identity/testdata/memory-identity.js';
import { startHubServer } from './server.js';
import { openSqliteHubStore } from './store/sqlite.js';
import { contentOf, LOCAL_ONLY_TABLES, mergedTableNames, rowsOf } from './testdata/compare-merged-stores.js';
import { plantTestSecret, testSecretsChildEnv, testSecretsFileIn } from './testdata/test-secrets.js';

const VERSION = '0.0.0-sync-skew';
const TOKEN = 'memory-sync-skew-token-0000001';

/** The first test-only migration: one column on `findings`. */
const TAG_MIGRATION = 'fixture-finding-tag';

/** The second test-only migration: one column on `commits`. */
const NOTE_MIGRATION = 'fixture-commit-note';

/** The two migrations a hub holds that the real build does not, in the order it holds them. */
const TEST_MIGRATIONS: HubMigrationCatalogue = [
  { id: TAG_MIGRATION, breaks: [], sql: 'ALTER TABLE findings ADD COLUMN fixture_tag TEXT;' },
  { id: NOTE_MIGRATION, breaks: [], sql: 'ALTER TABLE commits ADD COLUMN fixture_note TEXT;' },
];

/** This build's catalogue and the two test-only migrations: the full catalogue. */
const FULL_CATALOGUE: HubMigrationCatalogue = [...SQLITE_MIGRATIONS, ...TEST_MIGRATIONS];

/** This build's catalogue and the first test-only migration: a hub one migration short of the full one. */
const SHORT_CATALOGUE: HubMigrationCatalogue = [...SQLITE_MIGRATIONS, ...TEST_MIGRATIONS.slice(0, 1)];

/** The device the seed rows come from, as the hub knows it. */
const SEEDER = 'aaaaaaaa-0000-4000-8000-0000000000aa';

/** The time the seed rows are stamped with. */
const SEEDED_AT = '2026-09-30T10:00:00.000Z';

/** The id of the seed finding the device sets a `tracker_ref` on. */
const REFED_FINDING = 'finding-seed-1';

/** The `tracker_ref` the device sets on {@link REFED_FINDING} while it holds the row cut. */
const LOCAL_REF = '{"provider":"github","repo":"open-tomato/rafa","number":1430}';

/** How long a spawned `effort collect` may take before it is killed. */
const RUN_TIMEOUT_MS = 30_000;

/** How long one case may take. */
const CASE_TIMEOUT_MS = 180_000;

/** The real rafa CLI entry, spawned as a process; never imported. */
const RAFA_ENTRY = fileURLToPath(new URL('../../../src/rafa.ts', import.meta.url));

/** The real `rafa-sync-service` package, named by path in the device's `modules:`; never imported. */
const SYNC_SERVICE_PACKAGE = fileURLToPath(new URL('../../rafa-sync-service', import.meta.url));

/** The `name` the package's `package.json` carries, and `allowList:` must match. */
const SYNC_SERVICE_NAME = '@open-tomato/rafa-sync-service';

/** The module the catalogue lives in, by path, as the preload and the device both load it. */
const MIGRATIONS_MODULE = Bun.resolveSync('@open-tomato/rafa/store/migrations', import.meta.dir);

const gitBinary = Bun.which('git');
if (gitBinary === null) throw new Error('git is not on the PATH this suite runs under');
const GIT_DIR = dirname(gitBinary);

/** The `effort.syncSkew` setting a device's config names. */
type SyncSkew = 'refuse' | 'pull-projected';

/** What one `effort collect` run answered: its exit code, and standard output and error together. */
interface CollectRun {
  readonly exitCode: number | null;
  readonly output: string;
}

/** The line a device two behind writes for rows it cannot read, naming both migrations. */
const SELF_UPDATE_LINE = `effort sync: this rafa is behind the hub (migration ${TAG_MIGRATION}, ${NOTE_MIGRATION}); nothing was merged.`
  + ' Next step: rafa self-update, then rafa effort sync';

/** The line a device ahead of a hub one migration short writes, naming the migration the hub lacks. */
const UPGRADE_HUB_LINE = `effort sync: the hub is behind this rafa (migration ${NOTE_MIGRATION}); nothing was sent.`
  + ' Next step: upgrade the hub, then rafa effort sync';

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

/** The lines of `output` that carry a sync warning, with the command's own `warn: ` prefix taken off. */
function syncLines(output: string): string[] {
  return output.split('\n')
    .map((line) => line.replace(/^warn: /, ''))
    .filter((line) => line.startsWith('effort sync:'));
}

/** The seed commit `index`, as the seeder's `index`th row, carrying `fixture_note`. */
function seedCommit(index: number): WireRow {
  const sha = new Bun.CryptoHasher('sha1').update(`seed-commit-${String(index)}`)
    .digest('hex');
  return {
    seq: index,
    sha,
    row_json: JSON.stringify({ sha, timestamp: SEEDED_AT }),
    origin_store: SEEDER,
    origin_seq: index,
    fixture_note: `note-${String(index)}`,
  };
}

/** The seed finding `index`, as the seeder's `index`th row, carrying `fixture_tag` and no `tracker_ref`. */
function seedFinding(index: number): WireRow {
  return {
    seq: index,
    id: `finding-seed-${String(index)}`,
    session_id: 'seed-session',
    plan_stub: 'seed-plan',
    task_line: `- [ ] seed task ${String(index)}`,
    kind: 'gotcha',
    trigger: null,
    what: null,
    cause: null,
    resolution: null,
    artifact: `seed artifact ${String(index)}`,
    signal: 'loud',
    outcome: 'done',
    tracker_ref: null,
    collected_at: SEEDED_AT,
    origin_store: SEEDER,
    origin_seq: index,
    fixture_tag: `tag-${String(index)}`,
  };
}

/** The payload the seeder pushes: two commits and two findings, each with the column only the full catalogue has. */
function seedPayload(): WirePayload {
  const built = {
    format: WIRE_FORMAT,
    version: WIRE_VERSION,
    migrations: FULL_CATALOGUE.map(({ id }) => id),
    tables: { commits: [seedCommit(1), seedCommit(2)], findings: [seedFinding(1), seedFinding(2)] },
    cursor: { commits: 2, findings: 2 },
  };
  return decodeWirePayload(JSON.stringify(built));
}

/** The names of `table`'s columns on the store at `path`. */
function columnsOf(path: string, table: string): string[] {
  const db = new Database(path, { readonly: true });
  try {
    return db.query<{ name: string }, [string]>('SELECT name FROM pragma_table_info(?)').all(table)
      .map(({ name }) => name);
  } finally {
    db.close();
  }
}

/** Every `held_rows` row of the store at `path`, ordered, with `missing` read as a list. */
function heldRowsOf(path: string): { readonly table: string; readonly origin: string; readonly seq: number; readonly missing: unknown }[] {
  const db = new Database(path, { readonly: true });
  try {
    return db
      .query<{ table_name: string; origin_store: string; origin_seq: number; missing: string }, []>(
        'SELECT table_name, origin_store, origin_seq, missing FROM held_rows ORDER BY table_name, origin_seq',
      )
      .all()
      .map((row) => ({ table: row.table_name, origin: row.origin_store, seq: row.origin_seq, missing: JSON.parse(row.missing) as unknown }));
  } finally {
    db.close();
  }
}

/** `heldBack` as the state file beside the store at `storePath` keeps it, or undefined when it keeps none. */
function heldBackOf(storePath: string): { readonly cursor: unknown; readonly since: unknown } | undefined {
  const file = join(dirname(storePath), 'sync-service.json');
  if (!existsSync(file)) return undefined;
  const found: unknown[] = [];
  const walk = (value: unknown): void => {
    if (typeof value !== 'object' || value === null) return;
    for (const [key, inner] of Object.entries(value)) {
      if (key === 'heldBack') found.push(inner);
      else walk(inner);
    }
  };
  walk(JSON.parse(readFileSync(file, 'utf8')) as unknown);
  return found[0] as { readonly cursor: unknown; readonly since: unknown } | undefined;
}

/** How many `merge_conflicts` rows the store at `path` holds. */
function conflictCount(path: string): number {
  const db = new Database(path, { readonly: true });
  try {
    return db.query<{ n: number }, []>('SELECT count(*) AS n FROM merge_conflicts').get()?.n ?? 0;
  } finally {
    db.close();
  }
}

/** The merged tables the comparison reads: every merged table, past the local ones and `held_rows`. */
function comparedTables(path: string): string[] {
  return mergedTableNames(path).filter((table) => table !== 'held_rows' && !LOCAL_ONLY_TABLES.has(table));
}

/**
 * Every row of `table` on the store at `path`, as its content (every
 * column but `seq`) keyed by origin pair; `findings.tracker_ref` of
 * {@link REFED_FINDING} is read as null, the one field the device set
 * itself.
 */
function rowsByOrigin(path: string, table: string): Map<string, string> {
  return new Map(rowsOf(path, table).map((row) => {
    const key = `${String(row['origin_store'])}:${String(row['origin_seq'])}`;
    const settled = table === 'findings' && row['id'] === REFED_FINDING
      ? { ...row, tracker_ref: null }
      : row;
    return [key, contentOf(table, settled)];
  }));
}

/** The store at `held` and the store at `whole` hold the same rows in every compared table, matched by origin pair. */
function expectSameByOrigin(held: string, whole: string): void {
  expect(comparedTables(held)).toEqual(comparedTables(whole));
  for (const table of comparedTables(whole)) {
    expect(rowsByOrigin(held, table)).toEqual(rowsByOrigin(whole, table));
  }
}

describe('a device behind its hub, and a hub behind its device, over the service strategy', () => {
  let scope = '';
  let hubDir = '';
  let secretName = '';
  let preload = '';
  let hub: HubServer | undefined;

  /** Seeds a hub store holding `catalogue` with {@link seedPayload}, then serves it over HTTP. */
  const startHub = async (catalogue: HubMigrationCatalogue, seed: boolean): Promise<HubServer> => {
    if (seed) {
      const store: HubStore = await openSqliteHubStore({ directory: hubDir, now: () => new Date(SEEDED_AT) }, { migrations: catalogue });
      try {
        await store.push({ device: SEEDER, payload: seedPayload() });
      } finally {
        await store.close();
      }
    }
    const server = startHubServer({
      port: 0,
      hostname: '127.0.0.1',
      version: VERSION,
      identity: openMemoryIdentity({ [TOKEN]: { id: 'skew-writer', may: HUB_ACTIONS } }),
      openStore: () => openSqliteHubStore({ directory: hubDir, now: () => new Date() }, { migrations: catalogue }),
      log: () => undefined,
    });
    hub = server;
    return server;
  };

  /** A git repository of its own with one commit and a `.rafa/` directory; `configure` names its hub. */
  const plantDevice = (): string => {
    const root = realpathSync(mkdtempSync(join(scope, 'device-')));
    git(root, 'init', '-q');
    writeFileSync(join(root, '.gitignore'), '.rafa/\n', 'utf8');
    writeFileSync(join(root, 'device.txt'), `the device's own row ${root}\n`, 'utf8');
    git(root, 'add', '-A');
    git(root, '-c', 'user.name=device', '-c', 'user.email=device@example.invalid', 'commit', '-q', '--no-verify', '-m', `seed ${root}`);
    mkdirSync(join(root, '.rafa'), { recursive: true });
    return root;
  };

  /** Writes the device's config naming `hubUrl` and `skew`; `refuse` is written as the key left out. */
  const configure = (root: string, hubUrl: string, skew: SyncSkew): void => {
    writeFileSync(join(root, '.rafa', 'config.yaml'), [
      'pr:',
      '  provider: none',
      'effort:',
      '  sync: service',
      ...skew === 'refuse'
        ? []
        : [`  syncSkew: ${skew}`],
      'hub:',
      `  url: ${hubUrl}`,
      `  tokenSecret: ${secretName}`,
      'modules:',
      `  - path: ${SYNC_SERVICE_PACKAGE}`,
      'allowList:',
      `  - "${SYNC_SERVICE_NAME}"`,
      '',
    ].join('\n'), 'utf8');
  };

  /** Spawns the real `rafa effort collect --no-sessions` in `root`, on the full catalogue when `full`. */
  const runCollect = async (root: string, full: boolean): Promise<CollectRun> => {
    const home = realpathSync(mkdtempSync(join(scope, 'home-')));
    const flags = full
      ? ['--preload', preload]
      : [];
    const child = Bun.spawn([process.execPath, ...flags, RAFA_ENTRY, 'effort', 'collect', '--no-sessions'], {
      cwd: root,
      env: {
        TMPDIR: tmpdir(),
        RAFA_TEST: '1',
        PATH: GIT_DIR,
        ...testSecretsChildEnv(home, testSecretsFileIn(scope)),
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
  };

  beforeEach(() => {
    scope = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-hub-sync-skew-')));
    hubDir = realpathSync(mkdtempSync(join(scope, 'hub-')));
    secretName = `hub-token-${randomUUID()}`;
    plantTestSecret(scope, secretName, TOKEN);
    preload = join(scope, 'full-catalogue.preload.ts');
    writeFileSync(preload, [
      `import { SQLITE_MIGRATIONS } from ${JSON.stringify(MIGRATIONS_MODULE)};`,
      `(SQLITE_MIGRATIONS as unknown as unknown[]).push(...${JSON.stringify(TEST_MIGRATIONS)});`,
      '',
    ].join('\n'), 'utf8');
  });

  afterEach(async () => {
    await hub?.stop();
    hub = undefined;
    rmSync(scope, { recursive: true, force: true });
  });

  it('refuses, projects and refills a device two migrations behind, and matches a device never skewed', async () => {
    const server = await startHub(FULL_CATALOGUE, true);
    const behind = plantDevice();
    const never = plantDevice();
    configure(behind, server.url, 'refuse');
    configure(never, server.url, 'refuse');
    const behindPath = (): string => openSqliteStore(behind).path('commits');

    // By default the device two behind is refused, and merges none of the hub's rows.
    const refused = await runCollect(behind, false);
    expect(refused.exitCode).toBe(0);
    expect(syncLines(refused.output)).toEqual([SELF_UPDATE_LINE]);
    expect(rowsOf(behindPath(), 'commits')).toHaveLength(1);
    expect(rowsOf(behindPath(), 'findings')).toHaveLength(0);
    expect(heldBackOf(behindPath())).toBeUndefined();

    // Under the opt-in it pulls the rows without the two columns, and keeps what it cut.
    configure(behind, server.url, 'pull-projected');
    const projected = await runCollect(behind, false);
    expect(projected.exitCode).toBe(0);
    expect(syncLines(projected.output)).toEqual([
      'effort sync: pulled 4 rows projected to this rafa\'s schema; 2 columns wait for rafa self-update',
    ]);
    expect(rowsOf(behindPath(), 'commits')).toHaveLength(3);
    expect(rowsOf(behindPath(), 'findings')).toHaveLength(2);
    expect(columnsOf(behindPath(), 'commits')).not.toContain('fixture_note');
    expect(columnsOf(behindPath(), 'findings')).not.toContain('fixture_tag');
    expect(heldRowsOf(behindPath())).toEqual([
      { table: 'commits', origin: SEEDER, seq: 1, missing: [NOTE_MIGRATION] },
      { table: 'commits', origin: SEEDER, seq: 2, missing: [NOTE_MIGRATION] },
      { table: 'findings', origin: SEEDER, seq: 1, missing: [TAG_MIGRATION] },
      { table: 'findings', origin: SEEDER, seq: 2, missing: [TAG_MIGRATION] },
    ]);
    const heldBack = heldBackOf(behindPath());
    expect(heldBack?.cursor).toEqual({});
    expect(typeof heldBack?.since).toBe('string');

    // The device sets the one field its own rule keeps, on a row it holds cut.
    const edit = new Database(behindPath());
    try {
      edit.query('UPDATE findings SET tracker_ref = ? WHERE id = ?').run(LOCAL_REF, REFED_FINDING);
    } finally {
      edit.close();
    }

    // A device on the full catalogue that was never skewed pulls every row whole.
    const whole = await runCollect(never, true);
    expect(whole.exitCode).toBe(0);
    expect(syncLines(whole.output)).toEqual([]);
    const neverPath = openSqliteStore(never).path('commits');
    expect(rowsOf(neverPath, 'findings')).toHaveLength(2);
    expect(heldRowsOf(neverPath)).toEqual([]);

    // The device two behind, now on the full catalogue, refills what it held back.
    const conflictsBefore = conflictCount(behindPath());
    const since = new Date(String(heldBack?.since)).toISOString()
      .slice(0, 'YYYY-MM-DD'.length);
    const refilled = await runCollect(behind, true);
    expect(refilled.exitCode).toBe(0);
    expect(syncLines(refilled.output)).toEqual([`effort sync: refilled 4 rows held back since ${since}`]);
    expect(heldRowsOf(behindPath())).toEqual([]);
    expect(heldBackOf(behindPath())).toBeUndefined();
    expect(conflictCount(behindPath())).toBe(conflictsBefore);
    expect(columnsOf(behindPath(), 'commits')).toContain('fixture_note');
    expect(columnsOf(behindPath(), 'findings')).toContain('fixture_tag');

    // A held `findings.tracker_ref` set locally keeps its value; the rest of the row came whole.
    const refed = rowsOf(behindPath(), 'findings').find((row) => row['id'] === REFED_FINDING);
    expect(refed?.['tracker_ref']).toBe(LOCAL_REF);
    expect(refed?.['fixture_tag']).toBe('tag-1');
    expect(rowsOf(neverPath, 'findings').find((row) => row['id'] === REFED_FINDING)?.['tracker_ref']).toBeNull();

    // Every merged table matches the device never skewed, by origin pair, on every column but `seq`.
    expect(rowsOf(behindPath(), 'commits')).toHaveLength(4);
    expectSameByOrigin(behindPath(), neverPath);
  }, CASE_TIMEOUT_MS);

  it('refuses a device on the full catalogue its push under both settings against a hub one migration short', async () => {
    const server = await startHub(SHORT_CATALOGUE, false);
    const ahead = plantDevice();
    const hubPath = join(hubDir, DEFAULT_STORE_FILE);

    for (const skew of ['refuse', 'pull-projected'] as const) {
      configure(ahead, server.url, skew);

      const run = await runCollect(ahead, true);

      expect(run.exitCode).toBe(0);
      expect(syncLines(run.output)).toEqual([UPGRADE_HUB_LINE]);
      expect(mergedTableNames(hubPath).flatMap((table) => rowsOf(hubPath, table))).toEqual([]);
    }
  }, CASE_TIMEOUT_MS);
});
