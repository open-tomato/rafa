/**
 * The board listing kept between commands: one full `gh issue list` read
 * written to {@link BOARD_CACHE_FILE}, then brought up to date on every
 * later read by ONE small `gh api` read of the issues changed since.
 *
 * `rafa roadmap` measured 3.0 s for the full listing of a board of 270
 * issues on 2026-09-28, and the listing grows with the board: it carries
 * every body. What changed since the last read is usually nothing, and
 * the one request that says so answered in under a second on the same
 * board. The listing a caller gets is the same {@link BoardIssue} list
 * `createGhBoardListing` answers, so nothing downstream knows the cache
 * is there.
 *
 * ## The two reads
 *
 *  - FULL, when there is no cache file, the file cannot be read as this
 *    version wrote it, the caller asked for `refresh`, or the incremental
 *    read failed: first the WATERMARK — the `updated_at` of the most
 *    recently updated issue or pull request on the repository — then the
 *    listing `createGhBoardListing` sends, unchanged. The watermark is
 *    read BEFORE the listing, so an issue updated between the two is in
 *    the listing and read again next time, never missed: GitHub's `since`
 *    keeps an issue updated at or after the time it is given.
 *  - INCREMENTAL, otherwise: in the `labels` mode, `gh api --paginate`
 *    over the repository's issues with `since=<watermark>`, filtered by
 *    `jq` to the fields the listing asks for and to issues only (the REST
 *    endpoint answers pull requests too); in the `native` mode, one
 *    `gh api graphql --paginate` query over
 *    `repository.issues(filterBy: {since})` asking for the relationship
 *    fields too (`./board-cache-native.ts`). Each issue answered replaces
 *    the cached row with its number, a new one is added, and the
 *    watermark moves to the newest `updated_at` answered.
 *
 * A change rafa makes itself — a label swapped, a body edited, a line
 * ticked — moves the issue's `updated_at`, so the next read picks it up
 * with no invalidation step of its own; so does a change made on GitHub
 * by hand. A relationship write in the `native` mode is the exception:
 * see "Rows a relationship write touched" below.
 *
 * ## The mode the file was written in
 *
 * `board.relationships` decides what a row holds: the listing's six
 * fields in `labels`, the default, and the five relationship fields too
 * in `native`. A file written in the `native` mode records it as
 * `mode: "native"`; a file written in the `labels` mode has no `mode`
 * key, so it is byte for byte the file this module wrote before the mode
 * existed, and a file with none is read as `labels`. A file whose mode is
 * not the one asked for is read as no cache and the read is a full one,
 * which rewrites it in the mode asked for: a `labels` row read in the
 * `native` mode would be refused for lacking the relationship fields, and
 * a `native` row read in the `labels` mode would be answered with them
 * silently dropped, so neither is read across.
 *
 * ## What the incremental read cannot see
 *
 * An issue deleted or transferred out of the repository answers nothing
 * to `since`, so its row stays until a full read: `--refresh` asks for
 * one.
 *
 * In the `native` mode two more changes answer nothing to `since`, both
 * measured 2026-09-30 and kept in `context/pull-requests.md` ("Native
 * relationships"). A sub-issue or blocked-by link added or removed moves
 * neither end's `updated_at`. A blocker closing moves its own
 * `updated_at` and not the blocked issue's (scratch A#14 kept its
 * creation time after its blocker B#1 closed), so a kept row's linked
 * issue holds the title and state it had when that row was last read.
 *
 * ## Rows a relationship write touched
 *
 * A sub-issue or blocked-by link added or removed moves neither end's
 * `updated_at`, so {@link invalidateRows} is the step the writer takes:
 * it drops the rows of the issues the write touched from a `native` file
 * and records their numbers under `stale`, and the next read sends,
 * after its `since` read, one more `gh api graphql` read of those issues
 * by number (`./board-cache-native.ts`) and clears `stale`. Only a read
 * that follows an invalidation sends it. A file with nothing stale has no
 * `stale` key, and a `labels` file is left alone: in that mode a
 * relationship is a label or a body line, whose edit moves `updated_at`.
 *
 * The invalidation rewrites the file as a read does, whole, so a read
 * rewriting it at the same moment can win and lose the record; the next
 * `--refresh` reads the board whole.
 *
 * The cache also belongs to the project root and not to a repository
 * name, so a checkout whose `origin` moved to another repository needs
 * `--refresh` once.
 *
 * ## The REST rows
 *
 * The `jq` filter writes each issue as the listing's `gh` row does:
 * `state` and `stateReason` in capitals (`OPEN`, `NOT_PLANNED`), `labels`
 * as named mappings, and a body GitHub holds as null as the empty string.
 * Every row, cached or read, goes through `parseBoardListing`, so a row
 * the listing would refuse is refused here too, and the read falls back
 * to a full one rather than answering it.
 *
 * ## Writing the file
 *
 * The file is written whole through a temporary file and a rename, so a
 * second rafa writing at the same moment leaves one complete file. A
 * write that fails costs the next command its speed and nothing else:
 * the listing already read is answered either way.
 */
import type { BoardIssue, BoardListing } from './roadmap-board.js';
import type { GhRunner } from '../adapters/tracker/github.js';
import type { BoardRelationshipMode } from '../config-sections.js';

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { isMapping } from '../config-sections.js';
import { SCOPE_DIR } from '../project/scope.js';

import { nativeChangedArgs, nativeIssuesArgs, nativeRowFields } from './board-cache-native.js';
import { BOARD_LISTING_LIMIT, createGhBoardListing, parseBoardListing } from './roadmap-board.js';

/** Where the cache is kept, relative to the project root. */
export const BOARD_CACHE_FILE = join(SCOPE_DIR, 'cache', 'board.json');

/** The shape version the file is written with; a file of another version is read as no cache. */
export const BOARD_CACHE_VERSION = 1;

/** The `mode` key a file written in the `native` mode records; see the module note. */
const NATIVE_MODE_KEY: Readonly<{ mode: 'native' }> = Object.freeze({ mode: 'native' });

/** The `gh api` arguments that read the watermark; see the module note. */
export const WATERMARK_ARGS: readonly string[] = Object.freeze([
  'api',
  'repos/{owner}/{repo}/issues?state=all&sort=updated&direction=desc&per_page=1',
  '--jq',
  '.[0].updated_at // ""',
]);

/** The `jq` filter that writes each changed issue as the listing's `gh` row. */
const CHANGED_ROWS = '.[] | select(.pull_request == null) | {number, title, body: (.body // ""),'
  + ' state: (.state | ascii_upcase),'
  + ' stateReason: (if .state_reason == null then null else (.state_reason | ascii_upcase) end),'
  + ' labels: [.labels[] | {name}], updatedAt: .updated_at}';

/** The `gh api` arguments that read the issues changed since `watermark` in the `labels` mode. */
export function changedArgs(watermark: string): readonly string[] {
  return Object.freeze([
    'api',
    '--paginate',
    `repos/{owner}/{repo}/issues?state=all&per_page=100&since=${watermark}`,
    '--jq',
    CHANGED_ROWS,
  ]);
}

/** What the file holds. */
interface BoardCache {
  readonly version: number;
  /** The mode the rows were read in; left out of the file in `labels`. See the module note. */
  readonly mode: BoardRelationshipMode;
  /** The `updated_at` every issue changed later than is read again. */
  readonly watermark: string;
  /** The listing's rows, as `gh` writes them. */
  readonly rows: readonly Readonly<Record<string, unknown>>[];
  /** Issues whose rows {@link invalidateRows} dropped, read by number on the next read; left out of the file when empty. */
  readonly stale: readonly number[];
}

/** What {@link createCachedBoardListing} is made with. */
export interface CachedBoardListingOptions {
  /** Runs every `gh` command the listing sends. */
  readonly gh: GhRunner;
  /** The project root the cache file sits under. */
  readonly root: string;
  /** Read the whole board and rewrite the cache; `--refresh`. */
  readonly refresh?: boolean;
  /** How many issues a full read lists; `BOARD_LISTING_LIMIT` when left out. */
  readonly limit?: number;
  /** `board.relationships`: what a row holds and which incremental read is sent. `labels` when left out. */
  readonly mode?: BoardRelationshipMode;
}

/** The mode a file's `mode` key names, `labels` when it has none, or null when it names neither. */
function modeOfFile(value: unknown): BoardRelationshipMode | null {
  if (value === undefined) return 'labels';
  return value === 'labels' || value === 'native'
    ? value
    : null;
}

/** The cache at `path` written in `mode`, or null when there is none this version can read in it. */
function readCache(path: string, mode: BoardRelationshipMode): BoardCache | null {
  let payload: unknown;
  try {
    payload = JSON.parse(readFileSync(path, 'utf8')) as unknown;
  } catch {
    return null;
  }
  if (!isMapping(payload)) return null;
  const { version, watermark, rows } = payload;
  if (version !== BOARD_CACHE_VERSION || typeof watermark !== 'string' || watermark === '') return null;
  if (modeOfFile(payload['mode']) !== mode) return null;
  if (!Array.isArray(rows) || !rows.every(isMapping)) return null;
  const stale = staleOfFile(payload['stale']);
  if (stale === null) return null;
  return { version, mode, watermark, rows, stale };
}

/** True when `value` is a positive integer, an issue number. */
function isIssueNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

/** The numbers a file's `stale` key names, none when it has none, or null when it is not a list of issue numbers. */
function staleOfFile(value: unknown): readonly number[] | null {
  if (value === undefined) return [];
  return Array.isArray(value) && value.every(isIssueNumber)
    ? value
    : null;
}

/** What the file holds for `cache`: no `mode` key in the `labels` mode. See the module note. */
function fileOf(cache: BoardCache): Readonly<Record<string, unknown>> {
  const { version, mode, watermark, rows, stale } = cache;
  if (mode !== 'native') return { version, watermark, rows };
  return stale.length === 0
    ? { version, ...NATIVE_MODE_KEY, watermark, rows }
    : { version, ...NATIVE_MODE_KEY, watermark, rows, stale };
}

/** Writes `cache` to `path` whole; false when it could not be written. See the module note. */
function writeCache(path: string, cache: BoardCache): boolean {
  const temporary = `${path}.${String(process.pid)}.tmp`;
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(temporary, `${JSON.stringify(fileOf(cache))}\n`);
    renameSync(temporary, path);
    return true;
  } catch {
    return false;
  }
}

/** The rows `gh` wrote one JSON object per line, or null when a line is not one. */
function parseChangedRows(stdout: string): readonly Readonly<Record<string, unknown>>[] | null {
  const rows: Readonly<Record<string, unknown>>[] = [];
  for (const line of stdout.split('\n')) {
    if (line.trim() === '') continue;
    try {
      const row = JSON.parse(line) as unknown;
      if (!isMapping(row)) return null;
      rows.push(row);
    } catch {
      return null;
    }
  }
  return rows;
}

/** `rows` with each of `changed` replacing the row of its number, newest number first. */
export function mergeRows(
  rows: readonly Readonly<Record<string, unknown>>[],
  changed: readonly Readonly<Record<string, unknown>>[],
): readonly Readonly<Record<string, unknown>>[] {
  const byNumber = new Map(rows.map((row) => [row['number'], row]));
  for (const row of changed) byNumber.set(row['number'], row);
  return [...byNumber.values()].sort((left, right) => Number(right['number']) - Number(left['number']));
}

/** The newest `updatedAt` among `rows`, or `floor` when none is newer. */
function newestUpdate(rows: readonly Readonly<Record<string, unknown>>[], floor: string): string {
  return rows.reduce<string>((newest, row) => {
    const at = row['updatedAt'];
    return typeof at === 'string' && at > newest
      ? at
      : newest;
  }, floor);
}

/** `issue` as its kept row: the row `gh issue list` writes, with the relationship fields when it was read with them. */
function rowOf(issue: BoardIssue): Readonly<Record<string, unknown>> {
  return {
    number: issue.number,
    title: issue.title,
    body: issue.body,
    state: issue.state,
    stateReason: issue.stateReason,
    labels: issue.labels.map((name) => ({ name })),
    ...nativeRowFields(issue),
  };
}

/** The incremental read's arguments for `cache`, per its mode; see the module note. */
function incrementalArgs(cache: BoardCache): readonly string[] {
  return cache.mode === 'native'
    ? nativeChangedArgs(cache.watermark)
    : changedArgs(cache.watermark);
}

/** The rows `gh` answers to `args`, or null when it fails or answers something else. */
async function readRows(gh: GhRunner, args: readonly string[]): Promise<readonly Readonly<Record<string, unknown>>[] | null> {
  const answered = await gh(args);
  return answered.ok
    ? parseChangedRows(answered.stdout)
    : null;
}

/** The rows of `cache`'s stale issues read again, none when it has none; see the module note. */
function readStale(gh: GhRunner, cache: BoardCache): Promise<readonly Readonly<Record<string, unknown>>[] | null> {
  return cache.stale.length === 0
    ? Promise.resolve([])
    : readRows(gh, nativeIssuesArgs(cache.stale));
}

/** The cached listing brought up to date, or null when it cannot be; see the module note. */
async function readIncremental(gh: GhRunner, path: string, cache: BoardCache): Promise<readonly BoardIssue[] | null> {
  const since = await readRows(gh, incrementalArgs(cache));
  if (since === null) return null;
  const restored = await readStale(gh, cache);
  if (restored === null) return null;
  const changed = [...since, ...restored];
  const rows = mergeRows(cache.rows, changed);
  let issues: readonly BoardIssue[];
  try {
    issues = parseBoardListing(JSON.stringify(rows), BOARD_CACHE_FILE, cache.mode);
  } catch {
    return null;
  }
  if (cache.stale.length > 0 || !changesNothing(cache.rows, changed)) {
    writeCache(path, { ...cache, watermark: newestUpdate(changed, cache.watermark), rows, stale: [] });
  }
  return issues;
}

/**
 * True when every row of `changed` is already cached byte for byte. The
 * issue updated AT the watermark is answered again on every read, since
 * `since` keeps it, and rewriting the file for it would cost a write per
 * command for nothing.
 */
function changesNothing(
  rows: readonly Readonly<Record<string, unknown>>[],
  changed: readonly Readonly<Record<string, unknown>>[],
): boolean {
  const cached = new Map(rows.map((row) => [row['number'], JSON.stringify(row)]));
  return changed.every((row) => cached.get(row['number']) === JSON.stringify(row));
}

/**
 * The board listing over `options.gh`, kept under the project root and
 * read incrementally once kept; see the module note. Rejects as the
 * listing `createGhBoardListing` makes rejects, and only when the full
 * read fails.
 */
export function createCachedBoardListing(options: CachedBoardListingOptions): BoardListing {
  const { gh, root, refresh = false, limit = BOARD_LISTING_LIMIT, mode = 'labels' } = options;
  const path = join(root, BOARD_CACHE_FILE);
  const full = createGhBoardListing({ gh, limit, mode });
  return async () => {
    const cache = refresh
      ? null
      : readCache(path, mode);
    if (cache !== null) {
      const issues = await readIncremental(gh, path, cache);
      if (issues !== null) return issues;
    }
    const mark = await gh(WATERMARK_ARGS);
    const issues = await full();
    const watermark = mark.ok
      ? mark.stdout.trim()
      : '';
    if (watermark !== '') {
      writeCache(path, { version: BOARD_CACHE_VERSION, mode, watermark, rows: issues.map(rowOf), stale: [] });
    }
    return issues;
  };
}

/**
 * Drops the kept rows of the issues `numbers` from the `native` file
 * under `root` and records them as stale, so the next read reads them
 * again by number; see "Rows a relationship write touched" in the module
 * note. Called after a relationship write, with both ends of the link.
 * Leaves no file, a file this version cannot read and a `labels` file as
 * they are. True when the file records every number afterwards; false
 * when there is no `native` file to record them in or it could not be
 * written. Throws a `RangeError` naming a number that is not a positive
 * integer.
 */
export function invalidateRows(root: string, numbers: readonly number[]): boolean {
  const bad = numbers.find((number) => !isIssueNumber(number));
  if (bad !== undefined) throw new RangeError(`not an issue number: ${String(bad)}`);
  const path = join(root, BOARD_CACHE_FILE);
  const cache = readCache(path, 'native');
  if (cache === null) return false;
  if (numbers.length === 0) return true;
  const touched = new Set(numbers);
  const stale = [...new Set([...cache.stale, ...numbers])].sort((left, right) => left - right);
  const rows = cache.rows.filter((row) => !touched.has(row['number'] as number));
  return writeCache(path, { ...cache, rows, stale });
}
