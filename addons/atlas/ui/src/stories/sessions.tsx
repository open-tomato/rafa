import type { BadgeTone } from '../atoms/Badge/Badge.variants.js';
import type { TableColumn } from '../organisms/Table/Table.js';
import type { ReactElement } from 'react';

import { Badge } from '../atoms/Badge/Badge.js';

/**
 * The agent-sessions dataset the Table and Toolbar stories share. Stories
 * only; never exported from the library barrel.
 */

/** One session row. */
export interface Session {
  readonly id: string;
  readonly status: 'running' | 'waiting' | 'done' | 'idle' | 'failed';
  readonly name: string;
  readonly goal: string;
  readonly model: string;
  readonly tokens: number;
  readonly updated: number;
}

export const SESSIONS: readonly Session[] = [
  { id: 'ses_8x21', status: 'running', name: 'refactor-bot · split-primitives', goal: 'Split the monolith Primitives file into per-role wrappers and update every import across the dashboard kit.', model: 'sonnet-4.5', tokens: 184_200, updated: 2 },
  { id: 'ses_4f09', status: 'waiting', name: 'docs-writer · variant-tables', goal: 'Draft the variant reference tables for each wrapper directly from the CVA configs.', model: 'haiku-4', tokens: 52_100, updated: 6 },
  { id: 'ses_2c77', status: 'done', name: 'test-runner · snapshot-themes', goal: 'Snapshot every primitive across light and dark, then diff against the baseline set.', model: 'sonnet-4.5', tokens: 311_800, updated: 18 },
  { id: 'ses_9b13', status: 'idle', name: 'schema-migrator · backfill-tokens', goal: 'Backfill tokenized class names into the legacy kit so no raw hex survives in a variant.', model: 'opus-4', tokens: 0, updated: 41 },
  { id: 'ses_1a55', status: 'running', name: 'a11y-architect · focus-rings', goal: 'Audit keyboard focus order and add visible focus rings to every interactive component.', model: 'sonnet-4.5', tokens: 96_400, updated: 1 },
  { id: 'ses_7d30', status: 'failed', name: 'perf-bot · bundle-trim', goal: 'Trim the shared bundle by code-splitting the playground; the build step is currently erroring on the colgroup helper.', model: 'haiku-4', tokens: 23_700, updated: 33 },
  { id: 'ses_3e88', status: 'done', name: 'lint-sweeper · no-static-interactions', goal: 'Resolve jsx-a11y/no-static-element-interactions by routing clicks through a button.', model: 'sonnet-4.5', tokens: 142_500, updated: 27 },
];

/** How each status is drawn and ranked. */
export const STATUS: Readonly<Record<Session['status'], { readonly tone: BadgeTone; readonly dot: boolean; readonly label: string; readonly rank: number }>> = {
  running: { tone: 'good', dot: true, label: 'running', rank: 0 },
  waiting: { tone: 'warning', dot: false, label: 'waiting', rank: 1 },
  failed: { tone: 'critical', dot: false, label: 'failed', rank: 2 },
  done: { tone: 'info', dot: false, label: 'done', rank: 3 },
  idle: { tone: 'neutral', dot: false, label: 'idle', rank: 4 },
};

/** 184200 → "184k", 52100 → "52.1k", 0 → "—". */
export function formatTokens(count: number): string {
  if (count === 0) return '—';
  if (count >= 1000) {
    return `${(count / 1000).toFixed(count >= 100_000
      ? 0
      : 1)}k`;
  }
  return String(count);
}

/** The status pill a row shows. */
function StatusCell({ status }: { readonly status: Session['status'] }): ReactElement {
  const entry = STATUS[status];
  return <Badge tone={entry.tone} dot={entry.dot}>{entry.label}</Badge>;
}

/** The demo column set: width, sort and overflow defined once. */
export function makeColumns(goalMode: 'wrap' | 'clamp' | 'truncate'): readonly TableColumn<Session>[] {
  return [
    {
      key: 'status',
      header: 'Status',
      width: 116,
      sortable: true,
      sortAccessor: (row) => STATUS[row.status].rank,
      cell: (row) => <StatusCell status={row.status} />,
      footer: (rows) => `${rows.length} sessions`,
    },
    {
      key: 'name',
      header: 'Session',
      width: 220,
      sortable: true,
      overflow: 'truncate',
      cell: (row) => (
        <span>
          <span className="font-semibold">{row.name.split(' · ')[0]}</span>
          <span className="font-mono text-xs text-muted"> · {row.name.split(' · ')[1]}</span>
        </span>
      ),
    },
    {
      key: 'goal',
      header: 'Goal',
      overflow: goalMode,
      clampLines: 2,
      cell: (row) => <span className="text-ink-2">{row.goal}</span>,
    },
    {
      key: 'model',
      header: 'Model',
      width: 116,
      sortable: true,
      cell: (row) => <span className="font-mono text-[12.5px] text-ink-2">{row.model}</span>,
    },
    {
      key: 'tokens',
      header: 'Tokens',
      width: 100,
      align: 'end',
      sortable: true,
      cell: (row) => (
        <span className={row.tokens === 0
          ? 'font-mono text-muted'
          : 'font-mono'}
        >
          {formatTokens(row.tokens)}
        </span>
      ),
      footer: (rows) => `${formatTokens(rows.reduce((sum, row) => sum + row.tokens, 0))} total`,
    },
    {
      key: 'updated',
      header: 'Updated',
      width: 104,
      align: 'end',
      sortable: true,
      cell: (row) => <span className="font-mono text-[12.5px] text-muted">{row.updated}m ago</span>,
    },
  ];
}
