/**
 * Builds the PoC's graph: one node per package and per source module, import
 * edges between modules, and the effort store's rows tied to each module by
 * the source paths their text names.
 *
 * Run `bun run snapshot [--store <effort.sqlite>]` to write `data/snapshot.json`.
 * The store is opened read-only; without `--store` it is the main checkout's.
 */
import { Database } from 'bun:sqlite';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

import type { EdgeKind, FindingRef, GraphEdge, NodeStats, RafaNode, Snapshot } from '../src/types.ts';
import { boardGraph } from './board.ts';
import { issueDates } from './dates.ts';
import { schemaGraph } from './schema.ts';

const REPO_ROOT = resolve(import.meta.dir, '../../..');
const SNAPSHOT_PATH = resolve(import.meta.dir, '../data/snapshot.json');
const SKIPPED_ROOT_DIRS = new Set(['tests', 'fixtures', 'bundled']);
const CORE_TOP_DIRS = ['effort', 'errors', 'ports', 'report', 'schema'];
const TOP_ITEMS = 6;
const IMPORT_PATTERN = /(?:from\s+|import\s*\(\s*)['"]([^'"]+)['"]/g;

interface ModuleDef {
  readonly id: string;
  readonly label: string;
  readonly group: string;
  readonly dir: string;
  /** Paths a store row may name for this module, longest first when matched. */
  readonly mentions: readonly string[];
  readonly legend: string;
}

interface PackageDef {
  readonly id: string;
  readonly label: string;
  readonly dir: string;
  readonly legend: string;
}

const PACKAGES: readonly PackageDef[] = [
  { id: 'pkg:rafa', label: '@open-tomato/rafa', dir: '.', legend: 'CLI package · the loop' },
  { id: 'pkg:rafa-core', label: '@open-tomato/rafa-core', dir: 'packages/rafa', legend: 'core library' },
  { id: 'pkg:rafa-hub', label: '@open-tomato/rafa-hub', dir: 'packages/rafa-hub', legend: 'sync hub server' },
  { id: 'pkg:rafa-sync-service', label: '@open-tomato/rafa-sync-service', dir: 'packages/rafa-sync-service', legend: 'sync service' },
  { id: 'pkg:eslint-config', label: '@open-tomato/rafa-eslint-config', dir: 'packages/eslint-config', legend: 'lint config' },
  { id: 'pkg:typescript-config', label: '@open-tomato/rafa-typescript-config', dir: 'packages/typescript-config', legend: 'tsconfig base' },
];

function listTs(dir: string, recursive = true): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return recursive && name !== 'node_modules' ? listTs(full) : [];
    return name.endsWith('.ts') || name.endsWith('.tsx') ? [full] : [];
  });
}

function subdirs(dir: string): string[] {
  return readdirSync(dir).filter((name) => statSync(join(dir, name)).isDirectory());
}

function discoverModules(): ModuleDef[] {
  const rootSrc = join(REPO_ROOT, 'src');
  const rootModules = subdirs(rootSrc)
    .filter((name) => !SKIPPED_ROOT_DIRS.has(name) && listTs(join(rootSrc, name)).length > 0)
    .map((name) => ({
      id: `rafa:${name}`,
      label: name,
      group: 'pkg:rafa',
      dir: join(rootSrc, name),
      mentions: [`src/${name}/`],
      legend: `src/${name}`,
    }));
  const entry: ModuleDef = {
    id: 'rafa:entry', label: 'entry', group: 'pkg:rafa', dir: rootSrc, mentions: [], legend: 'src/*.ts · CLI entry',
  };
  const coreSrc = join(REPO_ROOT, 'packages/rafa/src');
  const coreModules = [
    ...subdirs(join(coreSrc, 'core')).map((name) => ({ name: `core/${name}`, label: name })),
    ...CORE_TOP_DIRS.map((name) => ({ name, label: name === 'effort' ? 'effort store' : name })),
  ].map(({ name, label }) => ({
    id: `core:${name}`,
    label,
    group: 'pkg:rafa-core',
    dir: join(coreSrc, name),
    // The store moved from `src/effort/store/` into core; older rows name the old path.
    mentions: name === 'effort' ? ['packages/rafa/src/effort/', 'src/effort/store/'] : [`packages/rafa/src/${name}/`],
    legend: `rafa-core/${name}`,
  }));
  return [entry, ...rootModules, ...coreModules];
}

/** Maps an import specifier, seen from `fromFile`, to a module id or an external package name. */
function resolveImport(spec: string, fromFile: string, moduleOfFile: (file: string) => string | null): string {
  if (spec.startsWith('.')) return moduleOfFile(resolve(dirname(fromFile), spec)) ?? '';
  const aliased = /^@open-tomato\/rafa\/(core\/[\w-]+|store|ports|report|schema|errors)/.exec(spec);
  if (aliased) {
    const sub = aliased[1] ?? '';
    return sub === 'store' ? 'core:effort' : `core:${sub}`;
  }
  if (spec.startsWith('@open-tomato/rafa-core')) return 'pkg:rafa-core';
  const parts = spec.split('/');
  const name = spec.startsWith('@') ? parts.slice(0, 2).join('/') : (parts[0] ?? spec);
  return `ext:${name}`;
}

function emptyStats(): NodeStats {
  return { files: 0, tests: 0, loc: 0, findings: 0, gotchas: 0, patterns: 0, bugs: 0, blockers: 0, changes: 0, plans: 0 };
}

interface Tally {
  stats: NodeStats;
  readonly plans: Set<string>;
  readonly hotFiles: Map<string, number>;
  readonly findings: FindingRef[];
  readonly bugs: FindingRef[];
  lastTouched: string | null;
}

function newTally(): Tally {
  return { stats: emptyStats(), plans: new Set(), hotFiles: new Map(), findings: [], bugs: [], lastTouched: null };
}

/** The main checkout, where the loop's store and board cache live; a worktree has neither. */
function mainCheckout(): string {
  const listing = Bun.spawnSync(['git', '-C', REPO_ROOT, 'worktree', 'list', '--porcelain']).stdout.toString();
  return /^worktree (.+)$/m.exec(listing)?.[1] ?? REPO_ROOT;
}

function mainCheckoutStore(): string {
  const main = mainCheckout();
  return join(process.env.RAFA_EFFORT_DIR ?? join(main, '.rafa/effort'), 'effort.sqlite');
}

interface StoreRow {
  readonly text: string;
  readonly plan: string;
  readonly kind: string;
  readonly what: string;
  readonly at: string;
}

function readRows(db: Database, sql: string): StoreRow[] {
  return db.query(sql).all() as StoreRow[];
}

const WEEK_MS = 7 * 24 * 3_600_000;
const TREND_WEEKS = 8;
const TOP_INFESTED = 10;

/**
 * What the bugs bucket shows: how many, how fresh, how many blocked or
 * security, which modules they name most (the infestation), which plans
 * filed them, and a weekly count for a trend.
 */
function bugFacts(
  bugs: readonly StoreRow[],
  outcomes: readonly { outcome: string; security: number }[],
  modules: readonly RafaNode[],
  namesAModule: (row: StoreRow) => boolean,
): Record<string, unknown> {
  const now = Date.now();
  const ages = bugs.map((b) => now - Date.parse(b.at));
  const inWeek = (back: number): number => ages.filter((age) => age >= back * WEEK_MS && age < (back + 1) * WEEK_MS).length;
  const byPlan = new Map<string, number>();
  for (const b of bugs) if (b.plan) byPlan.set(b.plan, (byPlan.get(b.plan) ?? 0) + 1);
  const infested = modules.filter((m) => m.stats.bugs > 0).sort((a, b) => b.stats.bugs - a.stats.bugs);
  return {
    bugStats: {
      total: bugs.length,
      thisWeek: inWeek(0),
      lastWeek: inWeek(1),
      blocked: outcomes.filter((o) => o.outcome === 'blocked').length,
      security: outcomes.filter((o) => o.security === 1).length,
      unattributed: bugs.filter((b) => !namesAModule(b)).length,
      modulesNamed: infested.length,
      plansFiling: byPlan.size,
      lastAt: bugs.reduce<string | null>((acc, b) => (!acc || b.at > acc ? b.at : acc), null),
    },
    weekly: Array.from({ length: TREND_WEEKS }, (_, i) => inWeek(TREND_WEEKS - 1 - i)),
    infested: infested.slice(0, TOP_INFESTED).map((m) => ({ id: m.id, label: m.label, count: m.stats.bugs })),
    infestedIds: infested.map((m) => m.id),
    byPlan: [...byPlan.entries()].sort((a, b) => b[1] - a[1]).map(([plan, count]) => ({ plan, count })),
  };
}

export function buildSnapshot(storePath = mainCheckoutStore()): Snapshot {
  const modules = discoverModules();
  const byMentionLength = [...modules].sort((a, b) => b.dir.length - a.dir.length);
  const moduleOfFile = (file: string): string | null => {
    const found = byMentionLength.find((m) => m.id !== 'rafa:entry' && (file === m.dir || file.startsWith(`${m.dir}/`)));
    if (found) return found.id;
    return dirname(file) === join(REPO_ROOT, 'src') ? 'rafa:entry' : null;
  };

  const tallies = new Map<string, Tally>([...modules.map((m) => m.id), ...PACKAGES.map((p) => p.id)].map((id) => [id, newTally()]));
  const tally = (id: string): Tally => tallies.get(id) ?? newTally();
  const edgeWeights = new Map<string, number>();
  const externals = new Map<string, Map<string, number>>();
  const addEdge = (source: string, target: string, kind: EdgeKind, weight = 1): void => {
    if (source === target) return;
    const key = `${source}|${target}|${kind}`;
    edgeWeights.set(key, (edgeWeights.get(key) ?? 0) + weight);
  };

  const scanFiles = (ownerId: string, files: readonly string[]): void => {
    for (const file of files) {
      const owner = ownerId.startsWith('pkg:') ? ownerId : (moduleOfFile(file) ?? ownerId);
      const t = tally(owner);
      const isTest = file.includes('.test.');
      const source = readFileSync(file, 'utf8');
      t.stats = {
        ...t.stats,
        files: t.stats.files + (isTest ? 0 : 1),
        tests: t.stats.tests + (isTest ? 1 : 0),
        loc: t.stats.loc + (isTest ? 0 : source.split('\n').length),
      };
      if (isTest) continue;
      for (const match of source.matchAll(IMPORT_PATTERN)) {
        const target = resolveImport(match[1] ?? '', file, moduleOfFile);
        if (target.startsWith('ext:')) {
          const ext = externals.get(owner) ?? new Map<string, number>();
          ext.set(target.slice(4), (ext.get(target.slice(4)) ?? 0) + 1);
          externals.set(owner, ext);
        } else if (target) {
          addEdge(owner, target, target.startsWith('pkg:') ? 'depends' : 'imports');
        }
      }
    }
  };

  scanFiles('rafa', listTs(join(REPO_ROOT, 'src')).filter((f) => moduleOfFile(f) !== null));
  scanFiles('core', listTs(join(REPO_ROOT, 'packages/rafa/src')));
  for (const pkg of PACKAGES.filter((p) => p.id === 'pkg:rafa-hub' || p.id === 'pkg:rafa-sync-service')) {
    scanFiles(pkg.id, listTs(join(REPO_ROOT, pkg.dir, 'src')));
  }
  for (const m of modules) addEdge(m.group, m.id, 'contains');
  for (const pkg of PACKAGES) {
    const manifest = JSON.parse(readFileSync(join(REPO_ROOT, pkg.dir, 'package.json'), 'utf8')) as Record<string, Record<string, string> | undefined>;
    const deps = { ...manifest.dependencies, ...manifest.devDependencies };
    for (const other of PACKAGES) if (other.label in deps) addEdge(pkg.id, other.id, 'depends');
  }

  // Context pages a module's path appears in.
  const contextDir = join(REPO_ROOT, 'context');
  const pages = readdirSync(contextDir).map((name) => ({ name, text: readFileSync(join(contextDir, name), 'utf8') }));

  // Store rows, tied to modules by the paths they name.
  const db = new Database(storePath, { readonly: true });
  const count = (table: string): number => (db.query(`select count(*) as n from ${table}`).get() as { n: number }).n;
  const storeRows = Object.fromEntries(['sessions', 'task_reports', 'findings', 'out_of_scope_bugs', 'blockers', 'changes', 'commits', 'plan_ci']
    .map((table) => [table, count(table)]));
  const findings = readRows(db, `select coalesce(what,'')||' '||coalesce(cause,'')||' '||coalesce(resolution,'')||' '||coalesce(artifact,'') as text,
    coalesce(plan_stub,'') as plan, coalesce(nullif(kind,''),'note') as kind, coalesce(what,'') as what, collected_at as at from findings`);
  const bugs = readRows(db, `select coalesce(what,'')||' '||coalesce(artifact,'') as text, coalesce(plan_stub,'') as plan,
    case when security=1 then 'security' else coalesce(nullif(scope,''),'bug') end as kind, coalesce(what,'') as what, collected_at as at from out_of_scope_bugs`);
  const blockers = readRows(db, `select coalesce(what,'')||' '||coalesce(artifact,'') as text, coalesce(plan_stub,'') as plan,
    'blocker' as kind, coalesce(what,'') as what, collected_at as at from blockers`);
  const changes = readRows(db, `select coalesce(task_line,'')||' '||coalesce(summary,'') as text, coalesce(plan_stub,'') as plan,
    coalesce(level,'none') as kind, coalesce(summary,'') as what, collected_at as at from changes`);
  const planStubs = (db.query('select distinct plan_stub as p from task_reports where plan_stub is not null').all() as { p: string }[]).map((r) => r.p);
  const reportsByPlan = new Map((db.query('select plan_stub as p, count(*) as n from task_reports where plan_stub is not null group by plan_stub').all() as { p: string; n: number }[]).map((r) => [r.p, r.n]));
  const schema = schemaGraph(db);
  const datesByIssue = issueDates(db, REPO_ROOT);
  const bugOutcomes = db.query('select coalesce(outcome, \'\') as outcome, security from out_of_scope_bugs').all() as { outcome: string; security: number }[];
  db.close();

  const mentionIndex = modules.flatMap((m) => m.mentions.map((mention) => ({ mention, id: m.id })))
    .sort((a, b) => b.mention.length - a.mention.length);
  const pathPattern = /(?:packages\/rafa\/)?src\/[\w./-]+/g;
  const modulesNamed = (text: string): Map<string, string[]> => {
    const hits = new Map<string, string[]>();
    for (const match of text.matchAll(pathPattern)) {
      const path = match[0].replace(/[.,:)]+$/, '');
      const hit = mentionIndex.find(({ mention }) => path.startsWith(mention));
      if (hit) hits.set(hit.id, [...(hits.get(hit.id) ?? []), path]);
    }
    return hits;
  };

  const attach = (rows: readonly StoreRow[], apply: (t: Tally, row: StoreRow) => void): void => {
    for (const row of rows) {
      for (const [id, paths] of modulesNamed(row.text)) {
        const t = tally(id);
        apply(t, row);
        if (row.plan) t.plans.add(row.plan);
        for (const path of paths) t.hotFiles.set(path, (t.hotFiles.get(path) ?? 0) + 1);
        if (!t.lastTouched || row.at > t.lastTouched) t.lastTouched = row.at;
      }
    }
  };
  const ref = (row: StoreRow): FindingRef => ({ kind: row.kind, what: row.what.slice(0, 220), plan: row.plan });
  attach(findings, (t, row) => {
    t.stats = {
      ...t.stats,
      findings: t.stats.findings + 1,
      gotchas: t.stats.gotchas + (row.kind === 'gotcha' ? 1 : 0),
      patterns: t.stats.patterns + (row.kind === 'pattern' ? 1 : 0),
    };
    t.findings.push(ref(row));
  });
  attach(bugs, (t, row) => {
    t.stats = { ...t.stats, bugs: t.stats.bugs + 1 };
    t.bugs.push(ref(row));
  });
  attach(blockers, (t) => {
    t.stats = { ...t.stats, blockers: t.stats.blockers + 1 };
  });
  attach(changes, (t) => {
    t.stats = { ...t.stats, changes: t.stats.changes + 1 };
  });

  const latestFirst = (refs: readonly FindingRef[]): FindingRef[] => [...refs].reverse().slice(0, TOP_ITEMS);
  const toNode = (def: { id: string; label: string; group: string; path: string; legend: string; mentions: readonly string[] }, type: RafaNode['type']): RafaNode => {
    const t = tally(def.id);
    return {
      id: def.id,
      label: def.label,
      type,
      group: def.group,
      path: def.path,
      legend: def.legend,
      stats: { ...t.stats, plans: t.plans.size },
      externalDeps: [...(externals.get(def.id) ?? new Map<string, number>()).entries()].sort((a, b) => b[1] - a[1]).map(([name]) => name),
      docs: pages.filter((p) => def.mentions.some((m) => p.text.includes(m))).map((p) => `context/${p.name}`),
      plans: [...t.plans].sort(),
      hotFiles: [...t.hotFiles.entries()].sort((a, b) => b[1] - a[1]).slice(0, TOP_ITEMS).map(([path, n]) => ({ path, count: n })),
      topFindings: latestFirst(t.findings),
      topBugs: latestFirst(t.bugs),
      lastTouched: t.lastTouched,
    };
  };

  const moduleNodes = modules.map((m) => toNode({ ...m, path: relative(REPO_ROOT, m.dir) || '.' }, 'module'));
  // A package's own counters are its modules' added up; packages without module folders keep their own scan.
  const packageNodes = PACKAGES.map((p) => {
    const own = toNode({ ...p, group: p.id, path: p.dir, mentions: [] }, 'package');
    const mine = moduleNodes.filter((m) => m.group === p.id);
    const add = (key: keyof NodeStats): number => mine.reduce((acc, m) => acc + m.stats[key], own.stats[key]);
    return { ...own, rollup: { modules: mine.length, files: add('files'), loc: add('loc'), findings: add('findings'), bugs: add('bugs'), plans: new Set(mine.flatMap((m) => m.plans)).size } };
  });
  const sum = (key: keyof NodeStats): number => moduleNodes.reduce((acc, n) => acc + n.stats[key], 0);
  const bucket = (id: string, label: string, legend: string, type: RafaNode['type'], stats: Partial<NodeStats>): RafaNode => ({
    id, label, type, group: 'store', path: '.rafa/effort', legend,
    stats: { ...emptyStats(), ...stats }, externalDeps: [], docs: ['context/effort-store.md'], plans: [], hotFiles: [], topFindings: [], topBugs: [], lastTouched: null,
  });
  const store = { ...bucket('store:effort', 'effort.sqlite', `effort store · ${storeRows.sessions} sessions`, 'store', { findings: findings.length, bugs: bugs.length, changes: changes.length }), storeRows };
  const plansBucket = { ...bucket('bucket:plans', 'plans', `${planStubs.length} plans run by the loop`, 'bucket', { plans: planStubs.length }), plans: planStubs.sort() };
  const bugsBucket = {
    ...bucket('bucket:bugs', 'bugs', `${bugs.length} out-of-scope bugs`, 'bucket', { bugs: bugs.length }),
    topBugs: [...bugs].reverse().slice(0, TOP_ITEMS).map(ref),
    ...bugFacts(bugs, bugOutcomes, moduleNodes, (row) => modulesNamed(row.text).size > 0),
  };
  const lessonsBucket = {
    ...bucket('bucket:lore', 'lore', `${findings.length} findings · gotchas, patterns`, 'bucket', { findings: findings.length, gotchas: sum('gotchas'), patterns: sum('patterns') }),
    topFindings: [...findings].reverse().slice(0, TOP_ITEMS).map(ref),
  };

  addEdge('core:effort', store.id, 'persists');
  for (const b of [plansBucket, bugsBucket, lessonsBucket]) addEdge(store.id, b.id, 'contains');
  for (const n of moduleNodes) {
    if (n.stats.plans > 0) addEdge(plansBucket.id, n.id, 'touches', n.stats.plans);
    if (n.stats.bugs > 0) addEdge(bugsBucket.id, n.id, 'reports', n.stats.bugs);
  }

  const edges: GraphEdge[] = [...edgeWeights.entries()].map(([key, weight]) => {
    const [source = '', target = '', kind = 'imports'] = key.split('|');
    return { source, target, kind: kind as EdgeKind, weight };
  });
  const rootManifest = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')) as { name: string; version: string };
  const board = boardGraph(join(mainCheckout(), '.rafa/cache/board.json'), moduleNodes, edges.filter((e) => e.kind === 'imports'), reportsByPlan, datesByIssue);
  // The QA lens's fog: bugs the store names plus open board bugs labelled for the module.
  const withBugLoad = moduleNodes.map((m) => {
    const openBugs = board?.openBugsByModule.get(m.id) ?? 0;
    return { ...m, openBugs, bugLoad: m.stats.bugs + openBugs };
  });
  return {
    dataset: 'rafa',
    project: { org: rootManifest.name.split('/')[0]?.replace('@', '') ?? '', name: rootManifest.name.split('/')[1] ?? rootManifest.name, version: rootManifest.version, scope: 'monorepo' },
    generatedAt: new Date().toISOString(),
    summary: { sessions: storeRows.sessions ?? 0, findings: storeRows.findings ?? 0, bugs: storeRows.out_of_scope_bugs ?? 0, 'open issues': board?.openIssues ?? 0 },
    nodes: [...packageNodes, ...withBugLoad, store, plansBucket, bugsBucket, lessonsBucket, ...(board?.nodes ?? []), ...schema.nodes],
    edges: [...edges, ...(board?.edges ?? []), ...schema.edges],
  };
}

if (import.meta.main) {
  const flag = process.argv.indexOf('--store');
  const storePath = flag > 0 ? process.argv[flag + 1] : undefined;
  const snapshot = buildSnapshot(storePath);
  await Bun.write(SNAPSHOT_PATH, JSON.stringify(snapshot, null, 2));
  process.stdout.write(`wrote ${relative(process.cwd(), SNAPSHOT_PATH)}: ${snapshot.nodes.length} nodes, ${snapshot.edges.length} edges\n`);
}
