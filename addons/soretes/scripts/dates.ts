/**
 * When each board issue was worked on and done, for the roadmap timeline.
 * The board cache carries no dates, so they come from two other records:
 *   activity  the first and last task report of the plans named after the issue (`rafa-<n>-…`)
 *   done      the commit that merged it: squash merges start their subject `rafa-<n>:`
 */
import type { Database } from 'bun:sqlite';

export interface IssueDates {
  readonly first?: string;
  readonly last?: string;
  readonly done?: string;
}

const PLAN_ISSUE = /^rafa-(\d+)(?:-|$)/;
const COMMIT_ISSUE = /^rafa-(\d+):/;

export function issueDates(db: Database, repoRoot: string): Map<number, IssueDates> {
  const dates = new Map<number, IssueDates>();
  const merge = (n: number, next: IssueDates): void => {
    const was = dates.get(n) ?? {};
    const min = (a?: string, b?: string): string | undefined => (!a ? b : !b ? a : a < b ? a : b);
    const max = (a?: string, b?: string): string | undefined => (!a ? b : !b ? a : a > b ? a : b);
    dates.set(n, { first: min(was.first, next.first), last: max(was.last, next.last), done: max(was.done, next.done) });
  };
  const reports = db.query('select plan_stub as plan, min(collected_at) as first, max(collected_at) as last from task_reports where plan_stub is not null group by plan_stub').all() as { plan: string; first: string; last: string }[];
  for (const r of reports) {
    const n = PLAN_ISSUE.exec(r.plan)?.[1];
    if (n) merge(Number(n), { first: r.first, last: r.last });
  }
  const log = Bun.spawnSync(['git', '-C', repoRoot, 'log', '--format=%cI%x09%s']).stdout.toString();
  for (const line of log.split('\n')) {
    const [when = '', subject = ''] = line.split('\t');
    const n = COMMIT_ISSUE.exec(subject)?.[1];
    if (n && when) {
      const at = new Date(when).toISOString();
      merge(Number(n), { done: at, first: at, last: at });
    }
  }
  return dates;
}

/** The Monday of the date's week, as `YYYY-MM-DD` (UTC). */
export function weekOf(iso: string): string {
  const d = new Date(iso);
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day);
  return d.toISOString().slice(0, 10);
}
