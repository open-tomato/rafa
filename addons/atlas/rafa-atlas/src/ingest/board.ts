/**
 * The board ingest: the board cache rafa keeps at
 * `<root>/.rafa/cache/board.json` read into `issue_facts` and today's
 * `board_snapshot` rows, stamped `local.issues` and `local.board`. The
 * cache is the only input (D14): no build calls `gh` here, and the
 * cache's `watermark` is both sources' `as_of`, so a stale cache shows as
 * old data, never as wrong data.
 *
 * 1. **One read (trap 6).** The file is read and parsed once per build,
 *    and each row is cut at once to the fields the buckets use: its
 *    number, title, state, close reason, label names and the plan stub
 *    its body names; the body itself is not kept. A file that is absent,
 *    does not parse, or is not the cache's version 1 shape is read as no
 *    cache: both sources are stamped missing (no rows, `partial`, the
 *    reason naming what was found) and the build goes on. A row that is
 *    not an issue the cache writes (no positive number, no `OPEN` or
 *    `CLOSED` state, a label that is no `{ name }` object) is skipped and
 *    counted, as is each earlier row of a number held twice (the last
 *    one is kept), and `local.issues` names the count.
 * 2. **Labels are objects (trap 1).** The cache stores `labels: [{ name }]`;
 *    the names are mapped out before any rafa-board rule reads them.
 * 3. **`issue_facts`**, one row per issue. `labels_json` is the names as a
 *    JSON array. `is_bug` is 1 for `type:bug` or `bug`, `is_epic` for
 *    `type:epic`. `epic_slug` is the first slug `epicSlugsOf` reads, in
 *    label order. `parent_number` is, for an issue that is no epic, the
 *    one `type:epic` issue carrying the same `epic:` slug; none, or two
 *    epics carrying it, leave it NULL, as does an epic itself. `stage` is
 *    `stageOf` over the labels with `pullRequests: []`, so a closed issue
 *    still labelled `rafa:in-development` reads Done (D16, trap 2) and an
 *    epic reads NULL; `stage_basis` is `labels` on every row. Under
 *    `--github` (`github.ts`), the options' `github` facts hand `stageOf`
 *    each issue's closing pull requests, open or merged, and
 *    `stage_basis` reads `labels+prs` on every row. `horizon` is `horizonOf`
 *    for an epic, `now`, `next` or `later` (the roadmap's fallback for no
 *    single known `horizon:` label), and NULL for any other issue, which
 *    gets no Horizon on the board either. `module` and `priority` are the
 *    value of the first `module:<x>` and `priority:<x>` label (D15), else
 *    NULL. `plan_stub` is the first line of the fenced block under a
 *    `## Plan` heading, then the stub of a `<!-- rafa:follow-ups <stub> -->`
 *    comment, else NULL: a bug filed by hand. `created_at` and `closed_at`
 *    stay NULL offline (trap 3): the cache holds no time but `updatedAt`,
 *    which any comment moves, so `local.issues` is stamped partial naming
 *    them. Under `--github` they are the times `gh issue list` answered,
 *    and an issue it listed no times for is counted in the stamp.
 * 4. **`board_snapshot`**, today's count of each of the eleven
 *    `STAGE_OPTIONS`, zeros included, taken over the rows just written
 *    (so under `--github` over the stages the pull requests moved),
 *    the day the build clock's UTC calendar day (D20). Every stage gets a
 *    row so the writer's carry, which keeps the build's own row of a day
 *    and stage, never brings back an earlier build's count of today for
 *    a stage now empty. With no cache, no snapshot is taken and the
 *    carried history stays as it was.
 */
import type { ReplicaBuild, SourceStamp } from '@open-tomato/atlas-data/replica';

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { epicSlugsOf, horizonOf, stageOf } from '@open-tomato/rafa-board';

/** The cache file under the project root; the facade does not export rafa-board's own constant. */
const BOARD_CACHE_FILE = join('.rafa', 'cache', 'board.json');

/** The cache shape version this reader takes. */
const BOARD_CACHE_VERSION = 1;

/** The label that marks an epic. */
const EPIC_TYPE_LABEL = 'type:epic';

/** The board's stages, in column order; the facade does not export them. */
const STAGE_OPTIONS: readonly string[] = [
  'Backlog',
  'Triage',
  'Needs work',
  'Ready',
  'Blocked',
  'Claimed',
  'In development',
  'Waiting for approval',
  'In review',
  'Done',
  'Cancelled',
];

import { dayOf } from './columns.js';

/** The `atlas_sources` row `issue_facts` is stamped as. */
export const ISSUES_SOURCE = 'local.issues';

/** The `atlas_sources` row `board_snapshot` is stamped as. */
export const BOARD_SOURCE = 'local.board';

/** The labels that make an issue a bug. */
export const BUG_LABELS: readonly string[] = ['type:bug', 'bug'];

/** The `issue_facts` columns no offline source fills; they read NULL unless `--github` reads them. */
export const UNREAD_ISSUE_COLUMNS: readonly string[] = ['created_at', 'closed_at'];

/** What every row's `stage_basis` reads offline. */
export const LABELS_BASIS = 'labels';

/** What every row's `stage_basis` reads when the GitHub source handed the closing pull requests. */
export const PRS_BASIS = 'labels+prs';

/** The prefix of the label naming an issue's module (D15). */
const MODULE_PREFIX = 'module:';

/** The prefix of the label naming an issue's priority (D15). */
const PRIORITY_PREFIX = 'priority:';

/** An issue's state, as the cache writes it. */
export type BoardState = 'OPEN' | 'CLOSED';

/** One cache row, cut to the fields the buckets use. */
export interface BoardRow {
  readonly number: number;
  readonly title: string;
  readonly state: BoardState;
  readonly stateReason: string | null;
  /** Every label's name, in cache order. */
  readonly labels: readonly string[];
  /** The plan the body names, by {@link planStubOf}. */
  readonly planStub: string | null;
}

/** What one cache read gave: the rows, or why there are none. */
export type BoardCacheRead =
  | {
    readonly ok: true;
    readonly watermark: string;
    readonly rows: readonly BoardRow[];
    /** The rows the file holds that are not an issue the cache writes, or an earlier row of a number held twice. */
    readonly skipped: number;
  }
  | { readonly ok: false; readonly reason: string };

/** What one board ingest did. */
export interface BoardIngest {
  /** False when no cache was read; both sources are then stamped missing. */
  readonly read: boolean;
  readonly issues: number;
  readonly skipped: number;
  /** The `board_snapshot` rows written for today. */
  readonly snapshotRows: number;
  /** `local.issues`, then `local.board`. */
  readonly stamps: readonly SourceStamp[];
}

/** A pull request closing an issue, as `stageOf` reads it: open or merged, with the fragment it added. */
export type StageLink = Parameters<typeof stageOf>[0]['pullRequests'][number];

/** What the GitHub source tells the board ingest about each issue, by number. */
export interface IssueGithubFacts {
  /** The pull requests that close the issue, open or merged; none when no pull request names it. */
  readonly pullRequestsOf: (issue: number) => readonly StageLink[];
  /** The issue's open and close times, or undefined when `gh` listed none for it. */
  readonly datesOf: (issue: number) => { readonly createdAt: string | null; readonly closedAt: string | null } | undefined;
}

/** What one board ingest is handed. */
export interface BoardIngestOptions {
  /** The project root: the main checkout, which holds the cache. */
  readonly root: string;
  /** The GitHub source's facts, under `--github` with a read that gave them; offline when left out. */
  readonly github?: IssueGithubFacts;
  /** The build clock: each source's `read_at` and the snapshot's day; defaults to the system clock. */
  readonly now?: () => Date;
}

/** True for a plain object. */
function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The message of a thrown value. */
function messageOf(error: unknown): string {
  return error instanceof Error
    ? error.message
    : String(error);
}

/** The first line of the fenced block under a `## Plan` heading. */
const PLAN_BLOCK = /^##[ \t]+Plan[ \t]*\r?\n(?:[ \t]*\r?\n)*[ \t]*```[^\n]*\r?\n[ \t]*([^\s`][^\n]*?)[ \t]*\r?\n/m;

/** The stub of a follow-ups comment. */
const FOLLOW_UPS = /<!--\s*rafa:follow-ups\s+(\S+?)\s*-->/;

/** The plan `body` names: the `## Plan` block's stub, then a follow-ups comment's, else null. */
export function planStubOf(body: string): string | null {
  const block = PLAN_BLOCK.exec(body)?.[1];
  if (block !== undefined && block !== '') return block;
  return FOLLOW_UPS.exec(body)?.[1] ?? null;
}

/** The label names of a cache row's `labels`, or null when one is no `{ name }` object. */
function labelNamesOf(labels: unknown): readonly string[] | null {
  if (!Array.isArray(labels)) return null;
  const names: string[] = [];
  for (const label of labels as readonly unknown[]) {
    if (!isRecord(label) || typeof label['name'] !== 'string') return null;
    names.push(label['name']);
  }
  return names;
}

/** One cache row cut to a {@link BoardRow}, or null when it is not an issue the cache writes. */
export function boardRowOf(row: unknown): BoardRow | null {
  if (!isRecord(row)) return null;
  const { number, state, stateReason, title, body } = row;
  if (typeof number !== 'number' || !Number.isSafeInteger(number) || number < 1) return null;
  if (state !== 'OPEN' && state !== 'CLOSED') return null;
  const labels = labelNamesOf(row['labels']);
  if (labels === null) return null;
  return {
    number,
    title: typeof title === 'string'
      ? title
      : '',
    state,
    stateReason: typeof stateReason === 'string' && stateReason !== ''
      ? stateReason
      : null,
    labels,
    planStub: typeof body === 'string'
      ? planStubOf(body)
      : null,
  };
}

/** The watermark as an ISO-8601 UTC time, or null when it does not parse. */
function watermarkOf(value: unknown): string | null {
  if (typeof value !== 'string' || value === '') return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms)
    ? null
    : new Date(ms).toISOString();
}

/** Parse the cache's text: its version 1 shape, cut row by row; see the module note. */
export function parseBoardCache(text: string): BoardCacheRead {
  let payload: unknown;
  try {
    payload = JSON.parse(text) as unknown;
  } catch (error) {
    return { ok: false, reason: `the cache does not parse as JSON (${messageOf(error)})` };
  }
  if (!isRecord(payload)) return { ok: false, reason: 'the cache is not a JSON object' };
  if (payload['version'] !== BOARD_CACHE_VERSION) {
    return { ok: false, reason: `the cache is version ${String(payload['version'])}, not ${String(BOARD_CACHE_VERSION)}` };
  }
  const watermark = watermarkOf(payload['watermark']);
  if (watermark === null) return { ok: false, reason: 'the cache holds no watermark time' };
  const { rows } = payload;
  if (!Array.isArray(rows)) return { ok: false, reason: 'the cache holds no rows list' };
  const byNumber = new Map<number, BoardRow>();
  for (const row of (rows as readonly unknown[]).map(boardRowOf)) {
    if (row !== null) byNumber.set(row.number, row);
  }
  return { ok: true, watermark, rows: [...byNumber.values()], skipped: rows.length - byNumber.size };
}

/** Read the cache under `root` once; see the module note. */
export function readBoardCache(root: string): BoardCacheRead {
  const path = join(root, BOARD_CACHE_FILE);
  if (!existsSync(path)) return { ok: false, reason: `no file at ${BOARD_CACHE_FILE}` };
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (error) {
    return { ok: false, reason: `${BOARD_CACHE_FILE} cannot be read (${messageOf(error)})` };
  }
  return parseBoardCache(text);
}

/** The value of the first label opening with `prefix`, or null. */
function labelValue(labels: readonly string[], prefix: string): string | null {
  const label = labels.find((each) => each.startsWith(prefix) && each.length > prefix.length);
  return label === undefined
    ? null
    : label.slice(prefix.length);
}

/** Each slug carried by exactly one epic, with that epic's number. */
function epicsBySlug(rows: readonly BoardRow[]): ReadonlyMap<string, number> {
  const numbers = new Map<string, number[]>();
  for (const row of rows) {
    if (!row.labels.includes(EPIC_TYPE_LABEL)) continue;
    for (const slug of epicSlugsOf(row.labels)) numbers.set(slug, [...(numbers.get(slug) ?? []), row.number]);
  }
  const single = new Map<string, number>();
  for (const [slug, epics] of numbers) {
    const [only] = epics;
    if (epics.length === 1 && only !== undefined) single.set(slug, only);
  }
  return single;
}

/** The `issue_facts` columns written, in the order {@link issueRow} binds them. */
const ISSUE_COLUMNS: readonly string[] = [
  'number', 'title', 'state', 'state_reason', 'labels_json', 'is_bug', 'is_epic', 'epic_slug', 'parent_number',
  'stage', 'stage_basis', 'horizon', 'plan_stub', 'module', 'priority', 'created_at', 'closed_at',
];

/** 1 for true, 0 for false: SQLite's boolean. */
function flag(value: boolean): number {
  return value
    ? 1
    : 0;
}

/** One issue's row, in {@link ISSUE_COLUMNS} order; `github` gives its stage the closing pull requests and its times. */
export function issueRow(row: BoardRow, epics: ReadonlyMap<string, number>, github?: IssueGithubFacts): (string | number | null)[] {
  const { labels } = row;
  const isEpic = labels.includes(EPIC_TYPE_LABEL);
  const isBug = BUG_LABELS.some((label) => labels.includes(label));
  const slug = epicSlugsOf(labels)[0] ?? null;
  const parent = isEpic || slug === null
    ? null
    : epics.get(slug) ?? null;
  const pullRequests = github?.pullRequestsOf(row.number) ?? [];
  const stage = stageOf({ state: row.state, stateReason: row.stateReason, labels, pullRequests });
  const dates = github?.datesOf(row.number);
  const horizon = isEpic
    ? horizonOf(labels)
    : null;
  return [
    row.number, row.title, row.state, row.stateReason, JSON.stringify(labels), flag(isBug), flag(isEpic), slug, parent,
    stage, github === undefined
      ? LABELS_BASIS
      : PRS_BASIS, horizon, row.planStub, labelValue(labels, MODULE_PREFIX), labelValue(labels, PRIORITY_PREFIX),
    dates?.createdAt ?? null, dates?.closedAt ?? null,
  ];
}

/** Insert one `issue_facts` row per issue. */
function insertIssues(build: ReplicaBuild, rows: readonly BoardRow[], github: IssueGithubFacts | undefined): void {
  const epics = epicsBySlug(rows);
  const insert = build.database.prepare<unknown, (string | number | null)[]>(
    `INSERT INTO issue_facts (${ISSUE_COLUMNS.join(', ')}) VALUES (${ISSUE_COLUMNS.map(() => '?').join(', ')})`,
  );
  build.database.transaction(() => {
    for (const row of rows) insert.run(...issueRow(row, epics, github));
  })();
}

/** Write today's count of every stage, zeros included; answers the rows written. */
function takeSnapshot(build: ReplicaBuild, takenAt: string): number {
  const day = dayOf(takenAt);
  if (day === null) throw new Error(`atlas: the build clock gave no day (${takenAt})`);
  const counts = new Map(build.database
    .query<{ readonly stage: string; readonly n: number }, []>(
      'SELECT stage, count(*) AS n FROM issue_facts WHERE stage IS NOT NULL GROUP BY stage',
    )
    .all()
    .map((row) => [row.stage, row.n]));
  const insert = build.database.prepare<unknown, [string, string, string, number]>(
    'INSERT OR REPLACE INTO board_snapshot (taken_at, day, stage, count) VALUES (?, ?, ?, ?)',
  );
  build.database.transaction(() => {
    for (const stage of STAGE_OPTIONS) insert.run(takenAt, day, stage, counts.get(stage) ?? 0);
  })();
  return STAGE_OPTIONS.length;
}

/** The stamp of a source no cache was read for. */
function missingStamp(source: string, readAt: string, reason: string): SourceStamp {
  return { source, asOf: null, readAt, rows: 0, partial: true, reason: `no board cache read: ${reason}` };
}

/** The sentence on the time columns: unread offline, or the issues `gh` listed no times for. */
function datesReasons(cacheRows: readonly BoardRow[], github: IssueGithubFacts | undefined): readonly string[] {
  if (github === undefined) return [`${UNREAD_ISSUE_COLUMNS.join(', ')} are not read yet (the GitHub source) and read NULL`];
  const undated = cacheRows.filter((row) => github.datesOf(row.number) === undefined).length;
  return undated === 0
    ? []
    : [`gh issue list gave no times for ${String(undated)} cached issues; their ${UNREAD_ISSUE_COLUMNS.join(', ')} read NULL`];
}

/** The `local.issues` stamp: the time columns, and the rows skipped; partial only when one has a reason. */
function issuesStamp(readAt: string, watermark: string, cacheRows: readonly BoardRow[], skipped: number, github: IssueGithubFacts | undefined): SourceStamp {
  const reasons = [
    ...datesReasons(cacheRows, github),
    ...(skipped === 0
      ? []
      : [`${String(skipped)} cache rows were skipped: no issue the cache writes, or a number held twice`]),
  ];
  return {
    source: ISSUES_SOURCE,
    asOf: watermark,
    readAt,
    rows: cacheRows.length,
    partial: reasons.length > 0,
    reason: reasons.length === 0
      ? null
      : reasons.join('; '),
  };
}

/** Read the board cache under the root into `issue_facts` and today's `board_snapshot`, and stamp both; see the module note. */
export function ingestBoard(build: ReplicaBuild, options: BoardIngestOptions): BoardIngest {
  const readAt = (options.now ?? (() => new Date()))().toISOString();
  const cache = readBoardCache(options.root);
  if (!cache.ok) {
    const stamps = [missingStamp(ISSUES_SOURCE, readAt, cache.reason), missingStamp(BOARD_SOURCE, readAt, cache.reason)];
    stamps.forEach((stamp) => build.stampSource(stamp));
    return { read: false, issues: 0, skipped: 0, snapshotRows: 0, stamps };
  }
  insertIssues(build, cache.rows, options.github);
  const snapshotRows = takeSnapshot(build, readAt);
  const stamps = [
    issuesStamp(readAt, cache.watermark, cache.rows, cache.skipped, options.github),
    { source: BOARD_SOURCE, asOf: cache.watermark, readAt, rows: snapshotRows, partial: false, reason: null },
  ];
  stamps.forEach((stamp) => build.stampSource(stamp));
  return { read: true, issues: cache.rows.length, skipped: cache.skipped, snapshotRows, stamps };
}
