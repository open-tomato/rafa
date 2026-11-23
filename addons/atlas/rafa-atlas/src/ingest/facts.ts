/**
 * The finding, bug, change and CI buckets of the effort ingest, read from
 * the same snapshot as `task_facts` (`effort.ts`, which calls
 * {@link readEffortFacts} and {@link insertEffortFacts} and stamps each
 * bucket's source).
 *
 * Every store table is read the one way: its columns of `READ_COLUMNS`
 * (`columns.ts`), each one the snapshot lacks read as NULL, in `seq`
 * order, one row per D3 key (`coalesce(origin_store, store_meta.store_id)`
 * with `coalesce(origin_seq, seq)`) and one per identity (the row's `id`,
 * or `plan_stub`, `head_sha` and `read_at` for `plan_ci`, the replica's
 * primary key there); the first row in `seq` order is kept. A table
 * without the columns a row of it is read by (`seq` and `id`, or the
 * identity) reads no row.
 *
 * - **`finding_facts`** holds each finding with a kind (`source`
 *   `finding`), then each blocker (`blocker`). A findings row with no
 *   kind was written by `writeTrackerRef` to keep a filed issue's
 *   reference, with no report field of its own: it is left out of the
 *   bucket and of every count, and read only for the issue link below.
 *   `trackerRefOnly` counts them.
 * - **`bug_facts`** holds each out-of-scope bug (`out_of_scope`), then
 *   each routed one (`routed`, from `bug_routes`), which takes its
 *   `artifact` and `outcome` from the out-of-scope bug of its session
 *   with the same `what`. A bug's `issue_number` is the GitHub issue its
 *   session filed it as: the newest reference a findings row of the same
 *   session holds under a key ending with `bugKeyOf('', artifact, what)`.
 *   With no tracker file, `bugKeyOf` answers the key's part after the
 *   tracker file's name (`: <stripped artifact>`), or the whole key of a
 *   bug naming a test case, so the match holds whichever tracker file the
 *   bug was keyed under. A bug with no artifact, a reference held by
 *   another session (a recurrence commented on), or one to another
 *   tracker reads NULL.
 * - **`change_facts`** holds each changelog entry, `level` as reported.
 * - **`ci_facts`** holds each reading of a plan's head. `flipped` is 1 on
 *   every reading of a head (plan stub and head sha) read red and, at a
 *   later `read_at`, green; a head read green and then red, or red only,
 *   reads 0.
 *
 * `module` is `attributeModule` (`attribute.ts`) over the artifact, then
 * the `what`, for a finding or a bug, and over the area, then the summary,
 * for a change. `day` is the UTC day of `collected_at`, or of `read_at`
 * for a CI reading.
 *
 * After the inserts, `task_facts` takes each session's counts: `findings`
 * and `blockers` from `finding_facts`, `bugs` from the out-of-scope rows
 * of `bug_facts`, so a routed bug, the same entry again, is not counted
 * twice.
 */
import type { ColumnCheck, EffortTable } from './columns.js';
import type { Database } from 'bun:sqlite';

import { bugKeyOf } from '@open-tomato/rafa-core/triage/bug-key';

import { attributeModule } from './attribute.js';
import { dayOf, newest, numberOrNull, READ_COLUMNS, textOrNull } from './columns.js';

/** The `atlas_sources` rows the fact buckets stamp, one per bucket. */
export const FINDINGS_SOURCE = 'local.findings';
export const BUGS_SOURCE = 'local.bugs';
export const CHANGES_SOURCE = 'local.changes';
export const CI_SOURCE = 'local.ci';

/** One of the four fact sources. */
export type FactSource = typeof FINDINGS_SOURCE | typeof BUGS_SOURCE | typeof CHANGES_SOURCE | typeof CI_SOURCE;

/** A cell of a store row or a replica row. */
type Cell = string | number | null;

/** A store row read by {@link readStoreTable}: its columns by name, its D3 key resolved. */
interface StoreRow {
  readonly values: Readonly<Record<string, unknown>>;
  readonly originStore: string | null;
  readonly originSeq: number;
}

/** One store table, read once per D3 key and once per identity. */
interface TableRead {
  readonly rows: readonly StoreRow[];
  /** Rows dropped as a second row of a D3 key or of an identity. */
  readonly duplicates: number;
}

/** The columns without which a table reads no row. */
const TABLE_KEY_COLUMNS: Readonly<Partial<Record<EffortTable, readonly string[]>>> = {
  findings: ['seq', 'id'],
  blockers: ['seq', 'id'],
  out_of_scope_bugs: ['seq', 'id'],
  bug_routes: ['seq', 'id'],
  changes: ['seq', 'id'],
  plan_ci: ['seq', 'plan_stub', 'head_sha', 'verdict', 'read_at'],
};

/** What a row is one fact by besides its D3 key: the replica's primary key. */
const IDENTITY_COLUMNS: Readonly<Partial<Record<EffortTable, readonly string[]>>> = {
  plan_ci: ['plan_stub', 'head_sha', 'read_at'],
};

/** The tables each fact source is read from; its stamp names their missing columns. */
export const FACT_SOURCE_TABLES: Readonly<Record<FactSource, readonly EffortTable[]>> = {
  [FINDINGS_SOURCE]: ['findings', 'blockers', 'store_meta'],
  [BUGS_SOURCE]: ['out_of_scope_bugs', 'bug_routes', 'findings', 'store_meta'],
  [CHANGES_SOURCE]: ['changes', 'store_meta'],
  [CI_SOURCE]: ['plan_ci', 'store_meta'],
};

/** The store's own id, or null when `store_meta` holds none. */
function storeIdOf(snapshot: Database, present: ColumnCheck['present']): string | null {
  if (!present.store_meta.has('id') || !present.store_meta.has('store_id')) return null;
  const row = snapshot.query<{ readonly store_id: unknown }, []>('SELECT store_id FROM store_meta WHERE id = 1').get();
  return textOrNull(row?.store_id);
}

/** True when `table` holds the columns a row of it is read by. */
export function readable(present: ColumnCheck['present'], table: EffortTable): boolean {
  return (TABLE_KEY_COLUMNS[table] ?? []).every((column) => present[table].has(column));
}

/** Read `table` in `seq` order, one row per D3 key and identity, each missing column read as NULL. */
function readStoreTable(snapshot: Database, present: ColumnCheck['present'], table: EffortTable, storeId: string | null): TableRead {
  if (!readable(present, table)) return { rows: [], duplicates: 0 };
  const select = READ_COLUMNS[table]
    .map((column) => present[table].has(column)
      ? column
      : `NULL AS ${column}`)
    .join(', ');
  const seen = new Set<string>();
  const rows: StoreRow[] = [];
  let duplicates = 0;
  for (const values of snapshot.query<Record<string, unknown>, []>(`SELECT ${select} FROM ${table} ORDER BY seq`).all()) {
    const originStore = textOrNull(values.origin_store) ?? storeId;
    const originSeq = numberOrNull(values.origin_seq) ?? Number(values.seq);
    const identity = IDENTITY_COLUMNS[table] ?? ['id'];
    const keys = [JSON.stringify(['origin', originStore, originSeq]), JSON.stringify(identity.map((column) => values[column]))];
    if (keys.some((key) => seen.has(key))) {
      duplicates += 1;
      continue;
    }
    keys.forEach((key) => seen.add(key));
    rows.push({ values, originStore, originSeq });
  }
  return { rows, duplicates };
}

/** The text cell `column` of `row`, or null. */
function text(row: StoreRow, column: string): string | null {
  return textOrNull(row.values[column]);
}

/** The cells every store-row fact opens with. */
function originCells(row: StoreRow): Readonly<Record<string, Cell>> {
  return {
    id: text(row, 'id'),
    origin_store: row.originStore,
    origin_seq: row.originSeq,
    session_id: text(row, 'session_id'),
    plan_stub: text(row, 'plan_stub'),
    task_line: text(row, 'task_line'),
    day: dayOf(text(row, 'collected_at')),
  };
}

/** The GitHub issue number a stored `tracker_ref` names, or null for another tracker or none. */
export function issueNumberOf(trackerRef: string | null): number | null {
  if (trackerRef === null) return null;
  try {
    const ref: unknown = JSON.parse(trackerRef);
    if (ref === null || typeof ref !== 'object') return null;
    const { kind, externalId } = ref as { readonly kind?: unknown; readonly externalId?: unknown };
    return kind === 'github' && typeof externalId === 'string' && /^\d+$/.test(externalId)
      ? Number(externalId)
      : null;
  } catch {
    return null;
  }
}

/** One finding row holding a reference, as the issue lookup reads it. */
interface StoredRef {
  readonly artifact: string;
  readonly issueNumber: number;
}

/** The references the findings rows hold, by session, in `seq` order. */
function refsBySession(findings: TableRead): ReadonlyMap<string, readonly StoredRef[]> {
  const refs = new Map<string, StoredRef[]>();
  for (const row of findings.rows) {
    const sessionId = text(row, 'session_id');
    const artifact = text(row, 'artifact');
    const issueNumber = issueNumberOf(text(row, 'tracker_ref'));
    if (sessionId === null || artifact === null || issueNumber === null) continue;
    refs.set(sessionId, [...(refs.get(sessionId) ?? []), { artifact, issueNumber }]);
  }
  return refs;
}

/**
 * The issue a bug of `sessionId` was filed as: the newest reference that
 * session's findings hold under a key ending with the bug's key, built by
 * `bugKeyOf` with no tracker file, so it ends every tracker file's key
 * for the bug. Null for a bug with no artifact or no such reference.
 */
function issueOf(
  refs: ReadonlyMap<string, readonly StoredRef[]>,
  sessionId: string | null,
  artifact: string | null,
  what: string | null,
): number | null {
  if (sessionId === null || artifact === null) return null;
  const key = bugKeyOf('', artifact, what);
  const matches = (refs.get(sessionId) ?? []).filter((ref) => ref.artifact.endsWith(key));
  return matches[matches.length - 1]?.issueNumber ?? null;
}

/** Every fact row the four buckets hold, by bucket, and what was left out. */
export interface EffortFactsRead {
  readonly findings: readonly Readonly<Record<string, Cell>>[];
  readonly bugs: readonly Readonly<Record<string, Cell>>[];
  readonly changes: readonly Readonly<Record<string, Cell>>[];
  readonly ci: readonly Readonly<Record<string, Cell>>[];
  /** Findings rows with no kind, written for a tracker reference only: kept out of `finding_facts`. */
  readonly trackerRefOnly: number;
  /** Rows dropped as a second row of a D3 key or an identity, over the six tables. */
  readonly duplicates: number;
  /** The newest fact each source holds, by source id: `collected_at`, or `read_at` for a CI reading. */
  readonly asOf: Readonly<Record<FactSource, string | null>>;
}

/** `finding_facts`: each finding with a kind, then each blocker. */
function findingFacts(findings: TableRead, blockers: TableRead, modules: readonly string[]): Readonly<Record<string, Cell>>[] {
  const kinded = findings.rows
    .filter((row) => text(row, 'kind') !== null)
    .map((row) => ({
      ...originCells(row),
      source: 'finding',
      kind: text(row, 'kind'),
      signal: text(row, 'signal'),
      trigger: text(row, 'trigger'),
      what: text(row, 'what'),
      artifact: text(row, 'artifact'),
      module: attributeModule(modules, [text(row, 'artifact'), text(row, 'what')]),
      outcome: text(row, 'outcome'),
      tracker_ref: text(row, 'tracker_ref'),
    }));
  const blocked = blockers.rows.map((row) => ({
    ...originCells(row),
    source: 'blocker',
    what: text(row, 'what'),
    artifact: text(row, 'artifact'),
    module: attributeModule(modules, [text(row, 'artifact'), text(row, 'what')]),
    outcome: text(row, 'outcome'),
  }));
  return [...kinded, ...blocked];
}

/** `bug_facts`: each out-of-scope bug, then each routed one with its bug's artifact and outcome. */
function bugFacts(bugs: TableRead, routes: TableRead, findings: TableRead, modules: readonly string[]): Readonly<Record<string, Cell>>[] {
  const refs = refsBySession(findings);
  const outOfScope = bugs.rows.map((row) => ({
    ...originCells(row),
    source: 'out_of_scope',
    what: text(row, 'what'),
    artifact: text(row, 'artifact'),
    module: attributeModule(modules, [text(row, 'artifact'), text(row, 'what')]),
    security: numberOrNull(row.values.security),
    scope: text(row, 'scope'),
    outcome: text(row, 'outcome'),
    issue_number: issueOf(refs, text(row, 'session_id'), text(row, 'artifact'), text(row, 'what')),
  }));
  const routed = routes.rows.map((row) => {
    const sessionId = text(row, 'session_id');
    const what = text(row, 'what');
    const bug = bugs.rows.find((candidate) => text(candidate, 'session_id') === sessionId && text(candidate, 'what') === what);
    const artifact = bug === undefined
      ? null
      : text(bug, 'artifact');
    return {
      ...originCells(row),
      source: 'routed',
      what,
      artifact,
      module: attributeModule(modules, [artifact, what]),
      kind: text(row, 'kind'),
      route: text(row, 'route'),
      outcome: bug === undefined
        ? null
        : text(bug, 'outcome'),
      issue_number: issueOf(refs, sessionId, artifact, what),
    };
  });
  return [...outOfScope, ...routed];
}

/** `change_facts`: each changelog entry, its module read from its area, then its summary. */
function changeFacts(changes: TableRead, modules: readonly string[]): Readonly<Record<string, Cell>>[] {
  return changes.rows.map((row) => ({
    ...originCells(row),
    level: text(row, 'level'),
    area: text(row, 'area'),
    module: attributeModule(modules, [text(row, 'area'), text(row, 'summary')]),
    summary: text(row, 'summary'),
  }));
}

/** The failing check names of a stored `failing` array, or none for one that is not an array of names. */
function failingNames(failing: unknown): readonly string[] {
  if (typeof failing !== 'string') return [];
  try {
    const names: unknown = JSON.parse(failing);
    return Array.isArray(names)
      ? names.filter((name): name is string => typeof name === 'string')
      : [];
  } catch {
    return [];
  }
}

/** The plan and head of a CI reading, as one key. */
function headOf(row: StoreRow): string {
  return JSON.stringify([text(row, 'plan_stub'), text(row, 'head_sha')]);
}

/** The heads read red and, at a later `read_at`, green. */
export function flippedHeads(readings: readonly { readonly head: string; readonly verdict: string | null; readonly readAt: string | null }[]): ReadonlySet<string> {
  const firstRed = new Map<string, number>();
  const flipped = new Set<string>();
  const ms = (at: string | null): number => Date.parse(at ?? '');
  const ordered = [...readings]
    .filter((reading) => !Number.isNaN(ms(reading.readAt)))
    .sort((a, b) => ms(a.readAt) - ms(b.readAt));
  for (const reading of ordered) {
    const red = firstRed.get(reading.head);
    if (reading.verdict === 'red' && red === undefined) firstRed.set(reading.head, ms(reading.readAt));
    if (reading.verdict === 'green' && red !== undefined && ms(reading.readAt) > red) flipped.add(reading.head);
  }
  return flipped;
}

/** `ci_facts`: each reading of a plan's head, every reading of a flipped head marked `flipped`. */
function ciFacts(readings: TableRead): Readonly<Record<string, Cell>>[] {
  const flipped = flippedHeads(readings.rows.map((row) => ({
    head: headOf(row),
    verdict: text(row, 'verdict'),
    readAt: text(row, 'read_at'),
  })));
  return readings.rows.map((row) => {
    const failing = failingNames(row.values.failing);
    return {
      plan_stub: text(row, 'plan_stub'),
      pr: numberOrNull(row.values.pr),
      head_sha: text(row, 'head_sha'),
      verdict: text(row, 'verdict'),
      failing_json: JSON.stringify(failing),
      failing_count: failing.length,
      read_at: text(row, 'read_at'),
      day: dayOf(text(row, 'read_at')),
      flipped: flipped.has(headOf(row))
        ? 1
        : 0,
      origin_store: row.originStore,
      origin_seq: row.originSeq,
    };
  });
}

/** `findings` without its tracker-ref-only rows. */
function kindedOnly(findings: TableRead): TableRead {
  return { rows: findings.rows.filter((row) => text(row, 'kind') !== null), duplicates: findings.duplicates };
}

/** The newest `column` time over the rows of `tables`. */
function newestOf(tables: readonly TableRead[], column: string): string | null {
  return newest(tables.flatMap((table) => table.rows.map((row) => text(row, column))));
}

/** Read the snapshot's finding, bug, change and CI rows into the four buckets' facts; see the module note. */
export function readEffortFacts(snapshot: Database, columns: ColumnCheck, modules: readonly string[] = []): EffortFactsRead {
  const storeId = storeIdOf(snapshot, columns.present);
  const read = (table: EffortTable): TableRead => readStoreTable(snapshot, columns.present, table, storeId);
  const [findings, blockers, bugs, routes, changes, ci] = (
    ['findings', 'blockers', 'out_of_scope_bugs', 'bug_routes', 'changes', 'plan_ci'] as const
  ).map(read) as [TableRead, TableRead, TableRead, TableRead, TableRead, TableRead];
  return {
    findings: findingFacts(findings, blockers, modules),
    bugs: bugFacts(bugs, routes, findings, modules),
    changes: changeFacts(changes, modules),
    ci: ciFacts(ci),
    trackerRefOnly: findings.rows.filter((row) => text(row, 'kind') === null).length,
    duplicates: [findings, blockers, bugs, routes, changes, ci].reduce((sum, table) => sum + table.duplicates, 0),
    asOf: {
      [FINDINGS_SOURCE]: newestOf([kindedOnly(findings), blockers], 'collected_at'),
      [BUGS_SOURCE]: newestOf([bugs, routes], 'collected_at'),
      [CHANGES_SOURCE]: newestOf([changes], 'collected_at'),
      [CI_SOURCE]: newestOf([ci], 'read_at'),
    },
  };
}

/** The replica columns each fact bucket is written with, in DDL order. */
const FACT_COLUMNS: Readonly<Record<'finding_facts' | 'bug_facts' | 'change_facts' | 'ci_facts', readonly string[]>> = {
  finding_facts: [
    'id', 'origin_store', 'origin_seq', 'source', 'session_id', 'plan_stub', 'task_line', 'kind', 'signal',
    'trigger', 'what', 'artifact', 'module', 'outcome', 'tracker_ref', 'day',
  ],
  bug_facts: [
    'id', 'origin_store', 'origin_seq', 'source', 'session_id', 'plan_stub', 'task_line', 'what', 'artifact',
    'module', 'security', 'scope', 'kind', 'route', 'outcome', 'issue_number', 'day',
  ],
  change_facts: ['id', 'origin_store', 'origin_seq', 'session_id', 'plan_stub', 'level', 'area', 'module', 'summary', 'day'],
  ci_facts: [
    'plan_stub', 'pr', 'head_sha', 'verdict', 'failing_json', 'failing_count', 'read_at', 'day', 'flipped',
    'origin_store', 'origin_seq',
  ],
};

/** The per-session counts `task_facts` takes from the buckets, a tracker-ref-only finding in none. */
const COUNT_UPDATE = `UPDATE task_facts SET
  findings = (SELECT count(*) FROM finding_facts f WHERE f.session_id = task_facts.session_id AND f.source = 'finding'),
  blockers = (SELECT count(*) FROM finding_facts f WHERE f.session_id = task_facts.session_id AND f.source = 'blocker'),
  bugs = (SELECT count(*) FROM bug_facts b WHERE b.session_id = task_facts.session_id AND b.source = 'out_of_scope')`;

/**
 * Insert `facts` into the four buckets, then count each session's
 * findings, blockers and out-of-scope bugs into `task_facts`, in one
 * transaction. Answers the rows written per bucket.
 */
export function insertEffortFacts(replica: Database, facts: EffortFactsRead): Readonly<Record<keyof typeof FACT_COLUMNS, number>> {
  const buckets = { finding_facts: facts.findings, bug_facts: facts.bugs, change_facts: facts.changes, ci_facts: facts.ci };
  replica.transaction(() => {
    for (const [table, rows] of Object.entries(buckets) as [keyof typeof FACT_COLUMNS, typeof facts.findings][]) {
      const columns = FACT_COLUMNS[table];
      const insert = replica.prepare<unknown, Cell[]>(
        `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`,
      );
      for (const row of rows) insert.run(...columns.map((column) => row[column] ?? null));
    }
    replica.run(COUNT_UPDATE);
  })();
  return {
    finding_facts: facts.findings.length,
    bug_facts: facts.bugs.length,
    change_facts: facts.changes.length,
    ci_facts: facts.ci.length,
  };
}
