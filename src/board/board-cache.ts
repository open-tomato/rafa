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
 *  - INCREMENTAL, otherwise: `gh api --paginate` over the repository's
 *    issues with `since=<watermark>`, filtered by `jq` to the fields the
 *    listing asks for and to issues only (the REST endpoint answers pull
 *    requests too). Each issue answered replaces the cached row with its
 *    number, a new one is added, and the watermark moves to the newest
 *    `updated_at` answered.
 *
 * A change rafa makes itself — a label swapped, a body edited, a line
 * ticked — moves the issue's `updated_at`, so the next read picks it up
 * with no invalidation step of its own; so does a change made on GitHub
 * by hand.
 *
 * ## What the incremental read cannot see
 *
 * An issue deleted or transferred out of the repository answers nothing
 * to `since`, so its row stays until a full read: `--refresh` asks for
 * one. The cache also belongs to the project root and not to a
 * repository name, so a checkout whose `origin` moved to another
 * repository needs `--refresh` once.
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

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { isMapping } from '../config-sections.js';
import { SCOPE_DIR } from '../project/scope.js';

import { BOARD_LISTING_LIMIT, createGhBoardListing, parseBoardListing } from './roadmap-board.js';

/** Where the cache is kept, relative to the project root. */
export const BOARD_CACHE_FILE = join(SCOPE_DIR, 'cache', 'board.json');

/** The shape version the file is written with; a file of another version is read as no cache. */
export const BOARD_CACHE_VERSION = 1;

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

/** The `gh api` arguments that read the issues changed since `watermark`. */
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
  /** The `updated_at` every issue changed later than is read again. */
  readonly watermark: string;
  /** The listing's rows, as `gh` writes them. */
  readonly rows: readonly Readonly<Record<string, unknown>>[];
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
}

/** The cache at `path`, or null when there is none this version can read. */
function readCache(path: string): BoardCache | null {
  let payload: unknown;
  try {
    payload = JSON.parse(readFileSync(path, 'utf8')) as unknown;
  } catch {
    return null;
  }
  if (!isMapping(payload)) return null;
  const { version, watermark, rows } = payload;
  if (version !== BOARD_CACHE_VERSION || typeof watermark !== 'string' || watermark === '') return null;
  if (!Array.isArray(rows) || !rows.every(isMapping)) return null;
  return { version, watermark, rows };
}

/** Writes `cache` to `path` whole; false when it could not be written. See the module note. */
function writeCache(path: string, cache: BoardCache): boolean {
  const temporary = `${path}.${String(process.pid)}.tmp`;
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(temporary, `${JSON.stringify(cache)}\n`);
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

/** `issue` as the row `gh issue list` writes for it. */
function rowOf(issue: BoardIssue): Readonly<Record<string, unknown>> {
  return {
    number: issue.number,
    title: issue.title,
    body: issue.body,
    state: issue.state,
    stateReason: issue.stateReason,
    labels: issue.labels.map((name) => ({ name })),
  };
}

/** The cached listing brought up to date, or null when it cannot be; see the module note. */
async function readIncremental(gh: GhRunner, path: string, cache: BoardCache): Promise<readonly BoardIssue[] | null> {
  const answered = await gh(changedArgs(cache.watermark));
  if (!answered.ok) return null;
  const changed = parseChangedRows(answered.stdout);
  if (changed === null) return null;
  const rows = mergeRows(cache.rows, changed);
  let issues: readonly BoardIssue[];
  try {
    issues = parseBoardListing(JSON.stringify(rows), BOARD_CACHE_FILE);
  } catch {
    return null;
  }
  if (!changesNothing(cache.rows, changed)) {
    writeCache(path, { version: BOARD_CACHE_VERSION, watermark: newestUpdate(changed, cache.watermark), rows });
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
  const { gh, root, refresh = false, limit = BOARD_LISTING_LIMIT } = options;
  const path = join(root, BOARD_CACHE_FILE);
  const full = createGhBoardListing({ gh, limit });
  return async () => {
    const cache = refresh
      ? null
      : readCache(path);
    if (cache !== null) {
      const issues = await readIncremental(gh, path, cache);
      if (issues !== null) return issues;
    }
    const mark = await gh(WATERMARK_ARGS);
    const issues = await full();
    const watermark = mark.ok
      ? mark.stdout.trim()
      : '';
    if (watermark !== '') writeCache(path, { version: BOARD_CACHE_VERSION, watermark, rows: issues.map(rowOf) });
    return issues;
  };
}
