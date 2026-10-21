/**
 * Epics and issues from rafa's board cache (`.rafa/cache/board.json`), tied
 * to modules two ways: a `module:<name>` label, and the plans named after
 * the issue (`rafa-<n>-…`) whose store rows name the module's files.
 *
 * Only open issues that belong to an epic become nodes; open bugs become
 * counts on the modules they name, for the QA lens's fog.
 */
import { existsSync, readFileSync } from 'node:fs';

import type { GraphEdge, GraphNode, RafaNode } from '../src/types.ts';
import { weekOf, type IssueDates } from './dates.ts';

interface BoardRow {
  readonly number: number;
  readonly title: string;
  readonly state: 'OPEN' | 'CLOSED';
  readonly labels: readonly ({ readonly name: string } | string)[];
}

const REPO_URL = 'https://github.com/open-tomato/rafa/issues';
const TITLE_MAX = 64;

const labelsOf = (row: BoardRow): string[] => row.labels.map((l) => (typeof l === 'string' ? l : l.name));

/** The board column an open issue sits in, from its labels: the furthest along wins. */
export function statusOf(labels: readonly string[]): string {
  if (labels.includes('rafa:in-development')) return 'doing';
  if (labels.includes('spec:blocked')) return 'blocked';
  if (labels.includes('spec:ready')) return 'ready';
  if (labels.includes('spec:needs-work')) return 'needs-work';
  if (labels.includes('needs-triage')) return 'triage';
  return 'backlog';
}

const NO_EPIC = 'epic:none';
const prefixed = (labels: readonly string[], prefix: string): string | undefined => labels.find((l) => l.startsWith(prefix))?.slice(prefix.length);
const cut = (text: string): string => (text.length > TITLE_MAX ? `${text.slice(0, TITLE_MAX - 1)}…` : text);

export interface BoardGraph {
  readonly nodes: readonly GraphNode[];
  readonly edges: readonly GraphEdge[];
  /** Open board bugs per module id, from their module labels. */
  readonly openBugsByModule: ReadonlyMap<string, number>;
  readonly openIssues: number;
}

export function boardGraph(path: string, modules: readonly RafaNode[], importEdges: readonly GraphEdge[], reportsByPlan: ReadonlyMap<string, number>, dates: ReadonlyMap<number, IssueDates>): BoardGraph | null {
  if (!existsSync(path)) return null;
  const rows = (JSON.parse(readFileSync(path, 'utf8')) as { rows: BoardRow[] }).rows;
  const moduleIds = new Set(modules.map((m) => m.id));
  const moduleOfLabel = (name: string): string | undefined => [`rafa:${name}`, `core:core/${name}`, `core:${name}`].find((id) => moduleIds.has(id));
  const plansOf = (n: number): string[] => [...reportsByPlan.keys()].filter((stub) => stub === `rafa-${n}` || stub.startsWith(`rafa-${n}-`));
  const modulesOf = (row: BoardRow): string[] => {
    const byLabel = labelsOf(row).flatMap((l) => (l.startsWith('module:') ? [moduleOfLabel(l.slice(7))].filter((id): id is string => !!id) : []));
    const stubs = new Set(plansOf(row.number));
    const byPlan = modules.filter((m) => m.plans.some((p) => stubs.has(p))).map((m) => m.id);
    return [...new Set([...byLabel, ...byPlan])];
  };
  const callersOf = (ids: ReadonlySet<string>): number => new Set(importEdges.filter((e) => ids.has(e.target) && !ids.has(e.source)).map((e) => e.source)).size;

  const epicRows = rows.filter((r) => labelsOf(r).includes('type:epic'));
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];

  for (const epic of epicRows) {
    const slug = prefixed(labelsOf(epic), 'epic:');
    if (!slug) continue;
    const id = `epic:${slug}`;
    const all = rows.filter((r) => r.number !== epic.number && prefixed(labelsOf(r), 'epic:') === slug);
    const open = all.filter((r) => r.state === 'OPEN');
    const has = (r: BoardRow, label: string): boolean => labelsOf(r).includes(label);
    const touched = new Set(all.flatMap(modulesOf));
    const members = open.map((r) => `issue:${r.number}`);
    // Per week: members merged (done) and open members worked on (active), for the roadmap's cells.
    const weeks: Record<string, { done: number; active: number }> = {};
    const tally = (iso: string | undefined, key: 'done' | 'active'): void => {
      if (!iso) return;
      const w = weekOf(iso);
      weeks[w] = { done: weeks[w]?.done ?? 0, active: weeks[w]?.active ?? 0, [key]: (weeks[w]?.[key] ?? 0) + 1 };
    };
    for (const r of all) {
      const d = dates.get(r.number);
      if (r.state === 'CLOSED') tally(d?.done ?? d?.last, 'done');
      else tally(d?.last, 'active');
    }
    const spanDates = all.flatMap((r) => [dates.get(r.number)?.first, dates.get(r.number)?.done ?? dates.get(r.number)?.last]).filter((d): d is string => !!d).sort();
    nodes.push({
      id,
      label: slug,
      type: 'epic',
      group: id,
      legend: cut(epic.title),
      number: epic.number,
      url: `${REPO_URL}/${epic.number}`,
      issueStats: {
        total: all.length,
        open: open.length,
        closed: all.length - open.length,
        bugs: open.filter((r) => has(r, 'type:bug')).length,
        specs: open.filter((r) => has(r, 'type:spec')).length,
        ready: open.filter((r) => has(r, 'spec:ready')).length,
        blocked: open.filter((r) => has(r, 'spec:blocked')).length,
        inDevelopment: open.filter((r) => has(r, 'rafa:in-development')).length,
        high: open.filter((r) => has(r, 'priority:high')).length,
      },
      progress: all.length === 0 ? 0 : (all.length - open.length) / all.length,
      members,
      memberTitles: open.map((r) => ({ number: `#${r.number}`, title: r.title, kind: prefixed(labelsOf(r), 'type:') ?? 'issue' })),
      modules: [...touched],
      blast: callersOf(touched),
      moduleBugs: modules.filter((m) => touched.has(m.id)).reduce((acc, m) => acc + m.stats.bugs, 0),
      plansRun: all.filter((r) => plansOf(r.number).length > 0).length,
      weeks,
      span: spanDates.length > 0 ? { first: spanDates[0], last: spanDates[spanDates.length - 1] } : null,
    });
    for (const m of touched) edges.push({ source: id, target: m, kind: 'scopes', weight: all.filter((r) => modulesOf(r).includes(m)).length });
    for (const row of open) {
      const issueId = `issue:${row.number}`;
      const labels = labelsOf(row);
      const targets = modulesOf(row);
      const plans = plansOf(row.number);
      nodes.push({
        id: issueId,
        label: `#${row.number}`,
        type: 'issue',
        group: id,
        legend: cut(row.title),
        number: row.number,
        url: `${REPO_URL}/${row.number}`,
        title: row.title,
        status: statusOf(labels),
        kind: prefixed(labels, 'type:') ?? 'issue',
        priority: prefixed(labels, 'priority:') ?? 'none',
        specState: prefixed(labels, 'spec:') ?? null,
        labels,
        modules: targets,
        plans,
        reports: plans.reduce((acc, p) => acc + (reportsByPlan.get(p) ?? 0), 0),
        activity: dates.get(row.number) ?? null,
      });
      edges.push({ source: id, target: issueId, kind: 'member', weight: 1 });
      for (const m of targets) edges.push({ source: issueId, target: m, kind: 'targets', weight: 1 });
    }
  }

  // Open bugs outside every epic: their own type, so the PM lens leaves them out and the board shows them.
  const orphans = rows.filter((r) => r.state === 'OPEN' && labelsOf(r).includes('type:bug') && !prefixed(labelsOf(r), 'epic:'));
  for (const row of orphans) {
    const labels = labelsOf(row);
    const targets = modulesOf(row);
    nodes.push({
      id: `issue:${row.number}`,
      label: `#${row.number}`,
      type: 'bug',
      group: NO_EPIC,
      legend: cut(row.title),
      number: row.number,
      url: `${REPO_URL}/${row.number}`,
      title: row.title,
      status: statusOf(labels),
      kind: 'bug',
      priority: prefixed(labels, 'priority:') ?? 'none',
      specState: null,
      labels,
      modules: targets,
      plans: plansOf(row.number),
      reports: 0,
    });
    for (const m of targets) edges.push({ source: `issue:${row.number}`, target: m, kind: 'targets', weight: 1 });
  }

  const openBugsByModule = new Map<string, number>();
  for (const row of rows.filter((r) => r.state === 'OPEN' && labelsOf(r).includes('type:bug'))) {
    for (const m of modulesOf(row)) openBugsByModule.set(m, (openBugsByModule.get(m) ?? 0) + 1);
  }
  return { nodes, edges, openBugsByModule, openIssues: rows.filter((r) => r.state === 'OPEN').length };
}
