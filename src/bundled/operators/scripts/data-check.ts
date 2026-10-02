/**
 * `stretch data-check`: whether the effort store's baseline can be read
 * against this stretch. The store keeps no device on a row yet, so the
 * check splits sessions by the home directory in their log's path, a
 * proxy that two machines with one layout defeat. It opens the store
 * read-only and never migrates it.
 *
 * @module bundled/operators/scripts/data-check
 */
import { Database } from 'bun:sqlite';

/** The sessions of one home directory. */
export interface RootRows {
  readonly root: string;
  readonly rows: number;
  readonly inWindow: number;
  readonly newest: string | undefined;
}

/** What `data-check` answers. */
export interface DataCheck {
  readonly thisRoot: string;
  readonly roots: readonly RootRows[];
  readonly usable: boolean;
  readonly reasons: readonly string[];
}

/** The home directory a session log's path sits under. */
const HOME_ROOT = /^(\/Users\/[^/]+|\/home\/[^/]+|\/root|[A-Za-z]:[\\/]Users[\\/][^\\/]+)/;

/** The home directory of `path`, or `other`. */
export function homeRoot(path: string): string {
  return HOME_ROOT.exec(path)?.[1] ?? 'other';
}

/** One session row as the check reads it. */
export interface SessionRow {
  readonly filePath: string;
  readonly lastTimestamp: string | undefined;
}

/** Groups `rows` by home directory and decides whether the baseline is usable. */
export function checkRows(rows: readonly SessionRow[], thisRoot: string, since: number): DataCheck {
  const byRoot = new Map<string, { rows: number; inWindow: number; newest: string | undefined }>();

  for (const row of rows) {
    const root = homeRoot(row.filePath);
    const entry = byRoot.get(root) ?? { rows: 0, inWindow: 0, newest: undefined };
    const at = Date.parse(row.lastTimestamp ?? '');
    const newest = row.lastTimestamp !== undefined && (entry.newest === undefined || row.lastTimestamp > entry.newest)
      ? row.lastTimestamp
      : entry.newest;

    byRoot.set(root, { rows: entry.rows + 1, inWindow: entry.inWindow + (at >= since
      ? 1
      : 0), newest });
  }
  const roots = [...byRoot.entries()].map(([root, entry]) => ({ root, ...entry })).sort((a, b) => b.rows - a.rows);
  const mine = roots.find((entry) => entry.root === thisRoot);
  const reasons: string[] = [];

  if (!mine || mine.inWindow === 0) {
    reasons.push(`no session of this machine (${thisRoot}) since ${new Date(since).toISOString()}; its newest is ${mine?.newest ?? 'none'}`);
  }
  if (roots.length > 1) {
    reasons.push(`rows from ${roots.length} home directories are mixed (${roots.map((entry) => `${entry.root} ${entry.rows}`).join(', ')}); split by path, a proxy until rows carry a device`);
  }

  return { thisRoot, roots, usable: mine !== undefined && mine.inWindow > 0, reasons };
}

/** Reads every session row's log path and last timestamp from a store, read-only. */
export function readSessionRows(storePath: string): SessionRow[] {
  const db = new Database(storePath, { readonly: true });

  try {
    return db
      .query('SELECT json_extract(row_json, \'$.filePath\') AS filePath, json_extract(row_json, \'$.lastTimestamp\') AS lastTimestamp FROM sessions')
      .all()
      .map((row) => {
        const { filePath, lastTimestamp } = row as { filePath: string | null; lastTimestamp: string | null };

        return { filePath: filePath ?? '', lastTimestamp: lastTimestamp ?? undefined };
      });
  } finally {
    db.close();
  }
}

/** The check as text: the verdict, each home directory, then each reason. */
export function formatCheck(check: DataCheck, suspends: string): string {
  return [
    `baseline usable: ${check.usable
      ? 'yes'
      : 'no'}`,
    ...check.roots.map((entry) => `  ${entry.root === check.thisRoot
      ? '*'
      : ' '} ${entry.root}: ${entry.rows} sessions, ${entry.inWindow} in the window, newest ${entry.newest ?? 'none'}`),
    `  suspends in the window: ${suspends}`,
    ...check.reasons.map((reason) => `  ⚠️ ${reason}`),
  ].join('\n');
}
