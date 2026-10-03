/**
 * The synthetic merge scenarios of #322, built by code into a directory
 * the caller names under `tmpdir()`. No `.sqlite` file is committed for
 * any of them; each run builds its stores afresh.
 *
 * ## The scenarios
 *
 * Each one is a set of devices, one store each, differing only in how
 * much a union of their stores finds:
 *
 *   - **3, two clean starts** ({@link buildCleanStarts}): two stores,
 *     two origins, no row in common but the commits, which both devices
 *     collected from one history under their own origins.
 *   - **4, a copy then divergence** ({@link buildCopyDiverged}): one
 *     store written, copied, the copy minted a new origin, then both
 *     written; the shared part collapses and the diverged parts add.
 *   - **5, a restored older `.bak`** ({@link buildRestoredBak}): a copy
 *     taken earlier of the same store, keeping its origin, restored as a
 *     second device's store; merged into the newer one it adds nothing.
 *   - **6, one side at `plan-ci`** ({@link buildPlanCiSide}): a store a
 *     0.24.x runtime left, holding the legacy history only, beside a copy
 *     of it brought through `row-origins` and `store-meta`; the shared
 *     rows carry no origin and match by identity.
 *   - **7, another project** ({@link buildOtherProject}): two stores
 *     whose `store_meta` rows name different root commits; refused.
 *   - **8, a running loop** ({@link buildRunningLoop}): two stores of one
 *     project, each with a loop record beside it that reads `running`,
 *     naming this process's pid, which is alive; refused.
 *   - **9, three devices** ({@link buildThreeDevices}): a store copied to
 *     a second device, the second copied to a third, all three written.
 *   - **The cloned disk** ({@link buildClonedDisk}): a copy that kept its
 *     origin, because nothing it records moved, then written on both
 *     sides, so the same origin pairs hold different rows.
 *
 * ## The rows
 *
 * A device writes tasks and commits. A task is one row in each of the
 * eleven merged tables other than `commits`, keyed by the task's name;
 * a commit is one `commits` row whose `minutesSincePrevious` is measured
 * against the commit before it in time in that store, as a collection
 * measures it. So every merged table is exercised, and each builder
 * knows the rows the union of its devices holds from the names it
 * wrote: {@link Scenario.union}.
 *
 * Rows are inserted as a production insert stamps them, through
 * `STAMPED_COLUMNS` and `stampedValues` (`origins.ts`), so a store's
 * rows carry its origin and their own `seq`. A store past `row-origins`
 * with no `store_meta` row, and the `plan-ci` side of scenario 6, stamp
 * NULL, the latter because it has no origin columns at all.
 *
 * ## Identity without the machine
 *
 * `store_meta` is planted here rather than minted, so no builder reads
 * the host id or asks git for the project: the host is a fixed name per
 * device, the project a fixed root commit, the path and file identity
 * the store file's own. A copy minted a new origin is given its new row
 * by deleting the copied one and inserting another, the statement a mint
 * would write, since this file is scanned for edits (`merge-rules.sweep.test.ts`)
 * as every non-test module under `src/` is. Copies are taken with
 * `vacuumInto` (`copy.ts`), the snapshot `rafa effort copy` writes.
 *
 * Each builder passes its directory through `guardTestProcess`
 * (`location.ts`) first, so one handed a scope outside `tmpdir()` throws
 * in a test before it makes anything.
 */
import type { OriginTable } from '../origins.js';
import type { SQLQueryBindings } from 'bun:sqlite';

import { mkdirSync, mkdtempSync, realpathSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { Database } from 'bun:sqlite';

import { beginSession } from '../../../loop/sessions.js';
import { minutesBetween } from '../../commits.js';
import { bringForward } from '../bring-forward.js';
import { vacuumInto } from '../copy.js';
import { guardTestProcess } from '../location.js';
import { LEGACY_GATE_OPEN, SQLITE_MIGRATIONS } from '../migrations.js';
import { ORIGIN_TABLES, STAMPED_COLUMNS, stampedValues } from '../origins.js';
import { migrateSchema, SQLITE_STORE_FILE_NAME } from '../sqlite.js';
import { toStoredInteger } from '../store-meta.js';

/** The names of the scenarios this module builds. */
export type ScenarioName =
  | 'clean-starts'
  | 'copy-diverged'
  | 'restored-bak'
  | 'plan-ci-side'
  | 'other-project'
  | 'running-loop'
  | 'three-devices'
  | 'cloned-disk';

/** Why a merge of a scenario's stores must be refused. */
export type ScenarioRefusal = 'other-project' | 'live-loop';

/** One device of a scenario: a project root holding one store. */
export interface ScenarioDevice {
  readonly name: string;
  /** The project root, whose `.rafa/effort/` holds the store. */
  readonly root: string;
  /** The store file. */
  readonly path: string;
  /** The origin its `store_meta` row names, or null when it has none. */
  readonly storeId: string | null;
}

/** One origin pair two devices hold with different rows under it. */
export interface OriginCollision {
  readonly table: OriginTable;
  readonly originStore: string;
  readonly originSeq: number;
}

/** A built scenario. */
export interface Scenario {
  readonly name: ScenarioName;
  /** Its number among #322's scenarios, or null for the cloned disk, which has none. */
  readonly number: number | null;
  /** The devices, in the order they were started: the first is device A. */
  readonly devices: readonly ScenarioDevice[];
  /**
   * The rows each merged table holds once every device's store is
   * merged into one, counted from the tasks and commits written; null
   * where the merge is refused or its rows collide.
   */
  readonly union: Readonly<Record<OriginTable, number>> | null;
  /** Why the merge must be refused, or null when it runs. */
  readonly refusal: ScenarioRefusal | null;
  /** Each origin pair two devices hold different rows under; empty but for the cloned disk. */
  readonly collisions: readonly OriginCollision[];
}

/** The root commit every scenario's project records, but the other project of scenario 7. */
export const SCENARIO_PROJECT = 'root-commit-322';

/** The root commit scenario 7's second device records. */
export const OTHER_PROJECT = 'root-commit-elsewhere';

/** The plan every planted row and loop record names. */
const PLAN_STUB = 'rafa-322-effort-stores-two-devices';

/** The pull request every `plan_ci` row reads. */
const PLAN_PR = 322;

/** The instant every planted time counts minutes from. */
const EPOCH_MS = Date.parse('2026-09-29T08:00:00.000Z');

const MS_PER_MINUTE = 60_000;

/** The merged tables a task writes one row to: every one but `commits`. */
const TASK_TABLES = ORIGIN_TABLES.filter((table) => table !== 'commits');

/** A task or commit a device writes: its name, and when, in minutes past {@link EPOCH_MS}. */
interface Written {
  readonly key: string;
  readonly minute: number;
}

/** One row to insert, by column. */
interface PlantedRow {
  readonly table: OriginTable;
  readonly values: Readonly<Record<string, SQLQueryBindings>>;
}

/** The ISO time `minute` minutes past {@link EPOCH_MS}. */
function at(minute: number): string {
  return new Date(EPOCH_MS + (minute * MS_PER_MINUTE)).toISOString();
}

/** The rows one task writes, one per table of {@link TASK_TABLES}, in that order. */
function taskRows({ key, minute }: Written): readonly PlantedRow[] {
  const time = at(minute);
  const session = `session-${key}`;
  const report = { session_id: session, plan_stub: PLAN_STUB, task_line: `task ${key}` };
  const rows: Readonly<Record<Exclude<OriginTable, 'commits'>, PlantedRow['values']>> = {
    sessions: { session_id: session, row_json: JSON.stringify({ sessionId: session, startedAt: time }) },
    findings: {
      ...report, id: `finding-${key}`, kind: 'gotcha', trigger: `when ${key}`, what: `what ${key}`,
      artifact: `artifact-${key}`, signal: 'loud', outcome: 'done', collected_at: time,
    },
    blockers: { ...report, id: `blocker-${key}`, what: `blocked ${key}`, artifact: null, outcome: 'done', collected_at: time },
    out_of_scope_bugs: {
      ...report, id: `bug-${key}`, what: `bug ${key}`, artifact: null, security: 0, outcome: 'done', collected_at: time,
    },
    report_absences: {
      ...report, session_id: `${session}-retry`, id: `absence-${key}`, reason: 'no-report',
      detail: `no block from ${key}`, block_body: null, outcome: 'blocked', collected_at: time,
    },
    task_reports: { ...report, id: `report-${key}`, status: 'done', outcome: 'done', collected_at: time },
    preflight: {
      run_id: `run-${key}`, position: 0, tier: 'required', kind: 'command', item: 'bun', probe: null,
      outcome: 'pass', duration_ms: 12, failure: null, collected_at: time,
    },
    dispatches: { ...report, agent: 'loop-implementer', effort: 'medium', flags: '[]', collected_at: time },
    changes: { ...report, id: `change-${key}`, level: 'patch', area: null, summary: `summary ${key}`, collected_at: time },
    skill_invocations: { session_id: session, name: 'ts-symbols', sidechain: 0, count: 1 },
    plan_ci: { plan_stub: PLAN_STUB, pr: PLAN_PR, head_sha: `head-${key}`, verdict: 'none', failing: '[]', read_at: time },
  };
  return TASK_TABLES.map((table) => ({ table, values: rows[table] }));
}

/** Runs `use` on the store at `path`, opened for writing. */
function withStore<T>(path: string, use: (db: Database) => T): T {
  const db = new Database(path, { readwrite: true });
  try {
    return use(db);
  } finally {
    db.close();
  }
}

/** Whether the store holds the origin columns, which the `plan-ci` schema does not. */
function hasOrigins(db: Database): boolean {
  return db.query<{ name: string }, []>('SELECT name FROM pragma_table_info(\'findings\')').all()
    .some(({ name }) => name === 'origin_store');
}

/** Inserts `row` as a production insert does: stamped where the store has origin columns. */
function insertRow(db: Database, row: PlantedRow, stamped: boolean): void {
  const columns = Object.keys(row.values);
  const names = stamped
    ? `${columns.join(', ')}, ${STAMPED_COLUMNS}`
    : columns.join(', ');
  const values = stamped
    ? `${columns.map(() => '?').join(', ')}, ${stampedValues(row.table)}`
    : columns.map(() => '?').join(', ');
  db.query<unknown, SQLQueryBindings[]>(`INSERT INTO ${row.table} (${names}) VALUES (${values})`)
    .run(...Object.values(row.values));
}

/** Writes each task to the store at `path`, in order. */
function writeTasks(path: string, tasks: readonly Written[]): void {
  withStore(path, (db) => {
    const stamped = hasOrigins(db);
    for (const task of tasks) {
      for (const row of taskRows(task)) insertRow(db, row, stamped);
    }
  });
}

/** The timestamps of every commit the store holds. */
function commitTimes(db: Database): readonly string[] {
  return db.query<{ row_json: string }, []>('SELECT row_json FROM commits').all()
    .map(({ row_json: rowJson }) => String((JSON.parse(rowJson) as { timestamp?: unknown }).timestamp));
}

/** The gap a collection measures for a commit at `time`: minutes since the latest commit before it, or null. */
function gapBefore(db: Database, time: string): number | null {
  const earlier = commitTimes(db)
    .filter((held) => Date.parse(held) < Date.parse(time))
    .sort();
  const previous = earlier.at(-1);
  return previous === undefined
    ? null
    : minutesBetween(previous, time);
}

/** Writes each commit to the store at `path`, in order; each is named `sha-<key>`. */
function writeCommits(path: string, commits: readonly Written[]): void {
  withStore(path, (db) => {
    const stamped = hasOrigins(db);
    for (const { key, minute } of commits) {
      const sha = `sha-${key}`;
      const timestamp = at(minute);
      const rowJson = JSON.stringify({ sha, timestamp, minutesSincePrevious: gapBefore(db, timestamp) });
      insertRow(db, { table: 'commits', values: { sha, row_json: rowJson } }, stamped);
    }
  });
}

/** Writes `tasks` then `commits` to `device`'s store. */
function write(device: ScenarioDevice, tasks: readonly Written[], commits: readonly Written[] = []): void {
  writeTasks(device.path, tasks);
  writeCommits(device.path, commits);
}

/** A directory of its own under `scope` for one scenario, made only once the test guard lets it. */
function scenarioDir(scope: string, name: ScenarioName): string {
  guardTestProcess(join(scope, name));
  return realpathSync(mkdtempSync(join(scope, `${name}-`)));
}

/** The layout of device `name` under `dir`, its store not yet made. */
function deviceAt(dir: string, name: string, storeId: string | null): ScenarioDevice {
  const root = join(dir, name);
  return { name, root, path: join(root, '.rafa', 'effort', SQLITE_STORE_FILE_NAME), storeId };
}

/**
 * Makes `device`'s store: through every migration this rafa knows, or
 * through the legacy history only when `legacy` is set, as a 0.24.x
 * runtime left it.
 */
function createStore(device: ScenarioDevice, legacy = false): void {
  mkdirSync(dirname(device.path), { recursive: true });
  const db = new Database(device.path, { create: true, readwrite: true });
  try {
    if (legacy) migrateSchema(db, device.path, SQLITE_MIGRATIONS.slice(0, LEGACY_GATE_OPEN));
    else bringForward(db, device.path, 'write', 'open');
  } finally {
    db.close();
  }
}

/** Replaces `device`'s `store_meta` row with one naming its origin in `project`, as a mint would write it. */
function plantMeta(device: ScenarioDevice, project: string = SCENARIO_PROJECT): void {
  if (device.storeId === null) return;
  const file = statSync(device.path, { bigint: true });
  const values: SQLQueryBindings[] = [
    device.storeId, project, `host-${device.name}`, device.path, toStoredInteger(file.dev), toStoredInteger(file.ino), at(0),
  ];
  withStore(device.path, (db) => {
    db.run('DELETE FROM store_meta');
    db.query<unknown, SQLQueryBindings[]>(
      'INSERT INTO store_meta (id, store_id, project_root_commit, project_remote, host_id, store_path, file_dev, file_ino, minted_at)'
        + ' VALUES (1, ?, ?, NULL, ?, ?, ?, ?, ?)',
    ).run(...values);
  });
}

/** A new device whose store is made and minted `storeId` in `project`. */
function startDevice(dir: string, name: string, storeId: string, project: string = SCENARIO_PROJECT): ScenarioDevice {
  const device = deviceAt(dir, name, storeId);
  createStore(device);
  plantMeta(device, project);
  return device;
}

/**
 * A new device holding a snapshot of `source`'s store. With `storeId`
 * the copy is minted that new origin, as its first writing open would;
 * without it the copy keeps the origin it was taken with.
 */
function copyDevice(source: ScenarioDevice, dir: string, name: string, storeId?: string): ScenarioDevice {
  const device = deviceAt(dir, name, storeId ?? source.storeId);
  mkdirSync(dirname(device.path), { recursive: true });
  vacuumInto(source.path, device.path);
  if (storeId !== undefined) plantMeta(device);
  return device;
}

/** A task written at `minute`. */
function task(key: string, minute: number): Written {
  return { key, minute };
}

/** A commit made at `minute`. */
const commit = task;

/** The rows each merged table holds over the distinct tasks and commits written. */
function unionOf(tasks: readonly Written[], commits: readonly Written[]): Readonly<Record<OriginTable, number>> {
  const taskCount = new Set(tasks.map(({ key }) => key)).size;
  const commitCount = new Set(commits.map(({ key }) => key)).size;
  return Object.fromEntries(ORIGIN_TABLES.map((table) => [table, table === 'commits'
    ? commitCount
    : taskCount])) as Record<OriginTable, number>;
}

/** A scenario that merges, with the union of what its devices wrote. */
function merging(
  name: ScenarioName,
  number: number,
  devices: readonly ScenarioDevice[],
  written: { readonly tasks: readonly Written[]; readonly commits: readonly Written[] },
): Scenario {
  return { name, number, devices, union: unionOf(written.tasks, written.commits), refusal: null, collisions: [] };
}

/** Scenario 3: two clean starts, one history of commits collected on both under two origins. */
export function buildCleanStarts(scope: string): Scenario {
  const dir = scenarioDir(scope, 'clean-starts');
  const history = [commit('1000', 0), commit('1010', 10), commit('1020', 20)];
  const tasksA = [task('a1', 1), task('a2', 12)];
  const tasksB = [task('b1', 5), task('b2', 15), task('b3', 25)];
  const a = startDevice(dir, 'device-a', 'store-a');
  const b = startDevice(dir, 'device-b', 'store-b');
  write(a, tasksA, history);
  write(b, tasksB, history);
  return merging('clean-starts', 3, [a, b], { tasks: [...tasksA, ...tasksB], commits: history });
}

/** Scenario 4: a store copied to a second device, minted a new origin there, then written on both sides. */
export function buildCopyDiverged(scope: string): Scenario {
  const dir = scenarioDir(scope, 'copy-diverged');
  const seedTasks = [task('s1', 1), task('s2', 2)];
  const seedCommits = [commit('1000', 0), commit('1010', 10)];
  const a = startDevice(dir, 'device-a', 'store-a');
  write(a, seedTasks, seedCommits);
  const b = copyDevice(a, dir, 'device-b', 'store-b');
  const tasksA = [task('a1', 20), task('a2', 45)];
  const tasksB = [task('b1', 25)];
  const commitsA = [commit('1040', 40)];
  const commitsB = [commit('1030', 30)];
  write(a, tasksA, commitsA);
  write(b, tasksB, commitsB);
  return merging('copy-diverged', 4, [a, b], {
    tasks: [...seedTasks, ...tasksA, ...tasksB],
    commits: [...seedCommits, ...commitsA, ...commitsB],
  });
}

/**
 * Scenario 5: an older snapshot of a store, taken as a `.bak` and
 * restored as a second device's store with the origin it was taken
 * with, beside the store that went on being written.
 */
export function buildRestoredBak(scope: string): Scenario {
  const dir = scenarioDir(scope, 'restored-bak');
  const seedTasks = [task('s1', 1), task('s2', 2)];
  const seedCommits = [commit('1000', 0), commit('1010', 10)];
  const a = startDevice(dir, 'device-a', 'store-a');
  write(a, seedTasks, seedCommits);
  const restored = copyDevice(a, dir, 'restored');
  const laterTasks = [task('a1', 20)];
  const laterCommits = [commit('1030', 30)];
  write(a, laterTasks, laterCommits);
  return merging('restored-bak', 5, [a, restored], {
    tasks: [...seedTasks, ...laterTasks],
    commits: [...seedCommits, ...laterCommits],
  });
}

/**
 * Scenario 6: a store a 0.24.x runtime wrote, at `plan-ci`, copied to a
 * second device; the first brought through `row-origins` and
 * `store-meta` and minted, the second left at `plan-ci`, both written.
 * The shared rows carry no origin on either side.
 */
export function buildPlanCiSide(scope: string): Scenario {
  const dir = scenarioDir(scope, 'plan-ci-side');
  const seedTasks = [task('s1', 1), task('s2', 2)];
  const seedCommits = [commit('1000', 0)];
  const seed = deviceAt(dir, 'device-a', null);
  createStore(seed, true);
  write(seed, seedTasks, seedCommits);
  const legacy = copyDevice(seed, dir, 'device-old');
  const a = { ...seed, storeId: 'store-a' };
  createStore(a);
  plantMeta(a);
  const tasksA = [task('a1', 20)];
  const tasksOld = [task('o1', 25), task('o2', 35)];
  const commitsA = [commit('1030', 30)];
  const commitsOld = [commit('1020', 20)];
  write(a, tasksA, commitsA);
  write(legacy, tasksOld, commitsOld);
  return merging('plan-ci-side', 6, [a, legacy], {
    tasks: [...seedTasks, ...tasksA, ...tasksOld],
    commits: [...seedCommits, ...commitsA, ...commitsOld],
  });
}

/** Scenario 7: two stores whose `store_meta` rows name different projects. */
export function buildOtherProject(scope: string): Scenario {
  const dir = scenarioDir(scope, 'other-project');
  const a = startDevice(dir, 'device-a', 'store-a');
  const b = startDevice(dir, 'device-b', 'store-b', OTHER_PROJECT);
  write(a, [task('a1', 1)], [commit('1000', 0)]);
  write(b, [task('b1', 2)], [commit('2000', 0)]);
  return { name: 'other-project', number: 7, devices: [a, b], union: null, refusal: 'other-project', collisions: [] };
}

/** Records a loop running on `device`'s project under this process's pid, which is alive. */
function plantRunningLoop(device: ScenarioDevice, sessionId: string): void {
  beginSession(device.root, {
    sessionId,
    planStub: PLAN_STUB,
    plan: `.rafa/plans/PLAN-${PLAN_STUB}.md`,
    branch: `feat/${PLAN_STUB}`,
    pid: process.pid,
    startedAt: at(0),
  });
}

/**
 * Scenario 8: two stores of one project, a copy diverged from the
 * other, with a loop record reading `running` beside each, so a merge
 * into either side is refused. With the loop read as gone they merge,
 * and {@link Scenario.union} is what that control holds.
 */
export function buildRunningLoop(scope: string): Scenario {
  const dir = scenarioDir(scope, 'running-loop');
  const seedTasks = [task('s1', 1)];
  const commits = [commit('1000', 0)];
  const tasksA = [task('a1', 10)];
  const tasksB = [task('b1', 12)];
  const a = startDevice(dir, 'device-a', 'store-a');
  write(a, seedTasks, commits);
  const b = copyDevice(a, dir, 'device-b', 'store-b');
  write(a, tasksA);
  write(b, tasksB);
  plantRunningLoop(a, '0322aaaa-0000-4000-8000-000000000001');
  plantRunningLoop(b, '0322bbbb-0000-4000-8000-000000000002');
  const scenario = merging('running-loop', 8, [a, b], { tasks: [...seedTasks, ...tasksA, ...tasksB], commits });
  return { ...scenario, refusal: 'live-loop' };
}

/**
 * Scenario 9: device A's store copied to B, B's copied to C, each copy
 * minted its own origin, and all three written after their copies,
 * B both before and after C was taken from it.
 */
export function buildThreeDevices(scope: string): Scenario {
  const dir = scenarioDir(scope, 'three-devices');
  const seedTasks = [task('s1', 1), task('s2', 2)];
  const seedCommits = [commit('1000', 0), commit('1010', 10)];
  const a = startDevice(dir, 'device-a', 'store-a');
  write(a, seedTasks, seedCommits);
  const b = copyDevice(a, dir, 'device-b', 'store-b');
  const beforeC = { tasks: [task('b1', 20)], commits: [commit('1030', 30)] };
  write(b, beforeC.tasks, beforeC.commits);
  const c = copyDevice(b, dir, 'device-c', 'store-c');
  const afterC = {
    a: { tasks: [task('a1', 22)], commits: [commit('1040', 40)] },
    b: { tasks: [task('b2', 50)], commits: [commit('1050', 50)] },
    c: { tasks: [task('c1', 24), task('c2', 44)], commits: [commit('1025', 25)] },
  };
  write(a, afterC.a.tasks, afterC.a.commits);
  write(b, afterC.b.tasks, afterC.b.commits);
  write(c, afterC.c.tasks, afterC.c.commits);
  const sides = [beforeC, afterC.a, afterC.b, afterC.c];
  return merging('three-devices', 9, [a, b, c], {
    tasks: [...seedTasks, ...sides.flatMap(({ tasks }) => tasks)],
    commits: [...seedCommits, ...sides.flatMap(({ commits }) => commits)],
  });
}

/** How many tasks and commits one side wrote. */
interface WrittenCounts {
  readonly tasks: number;
  readonly commits: number;
}

/** The origin pairs `originStore` gives each table's rows `written` after a store holding `held` rows. */
function pairsAfter(originStore: string, held: WrittenCounts, written: WrittenCounts): readonly OriginCollision[] {
  const pairs = (tables: readonly OriginTable[], before: number, count: number): OriginCollision[] => tables.flatMap(
    (table) => Array.from({ length: count }, (_, index) => ({ table, originStore, originSeq: before + index + 1 })),
  );
  return [...pairs(TASK_TABLES, held.tasks, written.tasks), ...pairs(['commits'], held.commits, written.commits)];
}

/**
 * The cloned disk: a copy taken where nothing the store records moved,
 * so it keeps its origin, then written on both sides. The first rows
 * each side writes after the clone take the same origin pairs with
 * different content, listed in {@link Scenario.collisions}; the clone's
 * one further task takes pairs the original never reached.
 */
export function buildClonedDisk(scope: string): Scenario {
  const dir = scenarioDir(scope, 'cloned-disk');
  const seedTasks = [task('s1', 1), task('s2', 2)];
  const seedCommits = [commit('1000', 0), commit('1010', 10)];
  const a = startDevice(dir, 'device-a', 'store-a');
  write(a, seedTasks, seedCommits);
  const clone = copyDevice(a, dir, 'device-clone');
  write(a, [task('a3', 20)], [commit('1020', 20)]);
  write(clone, [task('k3', 21), task('k4', 31)], [commit('1021', 21)]);
  const collisions = pairsAfter('store-a', { tasks: seedTasks.length, commits: seedCommits.length }, { tasks: 1, commits: 1 });
  return { name: 'cloned-disk', number: null, devices: [a, clone], union: null, refusal: null, collisions };
}

/** Every scenario's builder, by name. */
export const SCENARIO_BUILDERS: Readonly<Record<ScenarioName, (scope: string) => Scenario>> = {
  'clean-starts': buildCleanStarts,
  'copy-diverged': buildCopyDiverged,
  'restored-bak': buildRestoredBak,
  'plan-ci-side': buildPlanCiSide,
  'other-project': buildOtherProject,
  'running-loop': buildRunningLoop,
  'three-devices': buildThreeDevices,
  'cloned-disk': buildClonedDisk,
};
