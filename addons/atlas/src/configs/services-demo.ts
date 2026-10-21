/**
 * A made-up organisation of services, to check that the dice draw data that
 * is nothing like a repo. Every name and number here is invented; dates are
 * relative to the moment it is built, so "deployed 3 hours ago" stays true.
 */
import type { GraphEdge, GraphNode, Scenario, Snapshot } from '../contract/types.ts';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

interface ServiceSeed {
  readonly id: string;
  readonly label: string;
  readonly team: string;
  readonly legend: string;
  readonly rps: number;
  readonly errorRate: number;
  readonly p95: number;
  readonly uptime: number;
  readonly deployedHoursAgo: number;
  readonly version: string;
  readonly oncall: string;
  readonly runbooks: readonly string[];
  readonly incidents: readonly { readonly title: string; readonly severity: string; readonly daysAgo: number }[];
}

const TEAMS = [
  { id: 'team:payments', label: 'payments', legend: 'team · 3 services' },
  { id: 'team:platform', label: 'platform', legend: 'team · shared infra' },
  { id: 'team:growth', label: 'growth', legend: 'team · search and messaging' },
];

const SERVICES: readonly ServiceSeed[] = [
  { id: 'svc:checkout', label: 'checkout-api', team: 'team:payments', legend: 'cart to order', rps: 1840, errorRate: 0.0042, p95: 212, uptime: 0.9991, deployedHoursAgo: 3, version: '4.18.2', oncall: 'payments-primary', runbooks: ['checkout-latency', 'cart-recovery', 'feature-flags'], incidents: [{ title: 'Elevated 5xx after flag rollout', severity: 'sev2', daysAgo: 4 }, { title: 'Slow cart totals under load', severity: 'sev3', daysAgo: 19 }] },
  { id: 'svc:payments', label: 'payments-gateway', team: 'team:payments', legend: 'card and wallet charges', rps: 620, errorRate: 0.0011, p95: 388, uptime: 0.9997, deployedHoursAgo: 52, version: '2.7.0', oncall: 'payments-primary', runbooks: ['provider-failover', 'refund-backlog'], incidents: [{ title: 'Provider timeout spike', severity: 'sev2', daysAgo: 11 }] },
  { id: 'svc:orders', label: 'orders-service', team: 'team:payments', legend: 'order lifecycle', rps: 940, errorRate: 0.0023, p95: 145, uptime: 0.9994, deployedHoursAgo: 26, version: '7.2.1', oncall: 'payments-secondary', runbooks: ['stuck-orders', 'db-failover'], incidents: [] },
  { id: 'svc:catalog', label: 'catalog-api', team: 'team:growth', legend: 'products and prices', rps: 5210, errorRate: 0.0006, p95: 64, uptime: 0.99995, deployedHoursAgo: 170, version: '11.0.4', oncall: 'growth-primary', runbooks: ['cache-warmup', 'price-sync'], incidents: [{ title: 'Stale prices after sync job', severity: 'sev3', daysAgo: 33 }] },
  { id: 'svc:search', label: 'search-service', team: 'team:growth', legend: 'full-text and facets', rps: 2730, errorRate: 0.0158, p95: 498, uptime: 0.9962, deployedHoursAgo: 0.5, version: '3.3.0-rc.2', oncall: 'growth-primary', runbooks: ['reindex', 'shard-rebalance', 'query-timeouts'], incidents: [{ title: 'Shard hot-spotting', severity: 'sev2', daysAgo: 1 }, { title: 'Reindex stalled', severity: 'sev3', daysAgo: 8 }, { title: 'Facet counts wrong', severity: 'sev4', daysAgo: 15 }] },
  { id: 'svc:notify', label: 'notifications-worker', team: 'team:growth', legend: 'email and push', rps: 310, errorRate: 0.0071, p95: 920, uptime: 0.9989, deployedHoursAgo: 75, version: '1.14.3', oncall: 'growth-secondary', runbooks: ['dead-letters'], incidents: [] },
  { id: 'svc:auth', label: 'auth-service', team: 'team:platform', legend: 'sessions and tokens', rps: 7400, errorRate: 0.0003, p95: 38, uptime: 0.99998, deployedHoursAgo: 340, version: '9.1.0', oncall: 'platform-primary', runbooks: ['key-rotation', 'session-flush'], incidents: [] },
  { id: 'svc:web', label: 'web-frontend', team: 'team:platform', legend: 'storefront SSR', rps: 3900, errorRate: 0.0019, p95: 310, uptime: 0.9993, deployedHoursAgo: 6, version: '2026.10.20-3', oncall: 'platform-secondary', runbooks: ['cdn-purge', 'ssr-memory'], incidents: [{ title: 'CDN purge lag', severity: 'sev4', daysAgo: 6 }] },
];

const STORES: readonly GraphNode[] = [
  { id: 'db:orders', label: 'orders-db', type: 'database', group: 'team:payments', legend: 'postgres · primary + 2 replicas', metrics: { connections: 412, sizeGb: 1840, qps: 6100, lagMs: 42 } },
  { id: 'db:catalog', label: 'catalog-db', type: 'database', group: 'team:growth', legend: 'postgres · read heavy', metrics: { connections: 188, sizeGb: 260, qps: 9800, lagMs: 8 } },
  { id: 'cache:sessions', label: 'session-cache', type: 'cache', group: 'team:platform', legend: 'redis cluster', metrics: { hitRate: 0.962, memoryMb: 28400, ops: 41000 } },
  { id: 'queue:events', label: 'events-bus', type: 'queue', group: 'team:platform', legend: 'order and user events', metrics: { depth: 1270, publishRate: 860, consumers: 4 } },
  { id: 'ext:card', label: 'card-provider', type: 'external', group: 'external', legend: 'third-party charges API', metrics: {} },
];

const CALLS: readonly [string, string, string, number][] = [
  ['svc:web', 'svc:checkout', 'calls', 6], ['svc:web', 'svc:catalog', 'calls', 9], ['svc:web', 'svc:search', 'calls', 7], ['svc:web', 'svc:auth', 'calls', 9],
  ['svc:checkout', 'svc:payments', 'calls', 5], ['svc:checkout', 'svc:orders', 'calls', 5], ['svc:checkout', 'svc:catalog', 'calls', 4], ['svc:checkout', 'svc:auth', 'calls', 4],
  ['svc:payments', 'ext:card', 'calls', 5], ['svc:search', 'svc:catalog', 'calls', 3],
  ['svc:orders', 'db:orders', 'reads', 8], ['svc:catalog', 'db:catalog', 'reads', 9], ['svc:auth', 'cache:sessions', 'reads', 9], ['svc:web', 'cache:sessions', 'reads', 4],
  ['svc:orders', 'queue:events', 'publishes', 6], ['svc:checkout', 'queue:events', 'publishes', 3], ['queue:events', 'svc:notify', 'delivers', 6], ['queue:events', 'svc:search', 'delivers', 2],
];

/** Invented use cases for the sequence view: requests from service to service, with one fork. */
const SCENARIOS: readonly Scenario[] = [
  {
    id: 'checkout',
    title: 'Checkout a cart',
    description: 'A signed-in shopper pays for a cart: the session is checked, prices re-read, the card charged, the order written and an event published.',
    steps: [
      { from: 'svc:web', to: 'svc:checkout', label: 'POST /checkout', ms: 4, detail: { method: 'POST', url: '/api/checkout', body: { cartId: 'c_8812', items: 3, currency: 'EUR' } } },
      { from: 'svc:checkout', to: 'svc:auth', label: 'GET /session', ms: 3, detail: { method: 'GET', url: '/v1/session/s_51c', headers: { authorization: 'Bearer …' } } },
      { from: 'svc:auth', to: 'cache:sessions', label: 'GET session', ms: 1, detail: { command: 'GET', key: 'session:s_51c' } },
      { from: 'cache:sessions', to: 'svc:auth', label: 'hit', reply: true, ms: 1, detail: { found: true, ttl: 1720 } },
      { from: 'svc:auth', to: 'svc:checkout', label: '200 user u_93', reply: true, ms: 2, detail: { status: 200, body: { userId: 'u_93', roles: ['shopper'] } } },
      { from: 'svc:checkout', to: 'svc:catalog', label: 'POST /prices', ms: 12, detail: { method: 'POST', url: '/v2/prices:batch', body: { skus: ['SKU-11', 'SKU-40', 'SKU-77'] } } },
      { from: 'svc:catalog', to: 'svc:checkout', label: '200 total 84.90', reply: true, ms: 2, detail: { status: 200, body: { total: 84.9, currency: 'EUR' } } },
      { from: 'svc:checkout', to: 'svc:payments', label: 'POST /charges', ms: 6, detail: { method: 'POST', url: '/v1/charges', body: { amount: 8490, currency: 'EUR', method: 'card' } } },
      {
        from: 'svc:payments', to: 'ext:card', label: 'authorize', ms: 180, detail: { method: 'POST', url: 'https://card-provider.example/authorize', body: { amount: 8490, token: 'tok_…' } },
        choice: { prompt: 'The card provider answers…', options: [{ label: 'approved', goto: 9 }, { label: 'declined', goto: 16 }] },
      },
      { from: 'ext:card', to: 'svc:payments', label: 'approved', reply: true, ms: 2, detail: { status: 200, body: { result: 'approved', authCode: 'A7731' } } },
      { from: 'svc:payments', to: 'svc:checkout', label: '201 charge ch_19', reply: true, ms: 2, detail: { status: 201, body: { chargeId: 'ch_19' } } },
      { from: 'svc:checkout', to: 'svc:orders', label: 'POST /orders', ms: 8, detail: { method: 'POST', url: '/v1/orders', body: { cartId: 'c_8812', chargeId: 'ch_19' } } },
      { from: 'svc:orders', to: 'db:orders', label: 'INSERT order', ms: 5, detail: { sql: 'INSERT INTO orders (cart_id, charge_id, …) VALUES ($1, $2, …)' } },
      { from: 'svc:orders', to: 'queue:events', label: 'order.created', ms: 2, detail: { topic: 'order.created', payload: { orderId: 'o_4410' } } },
      { from: 'svc:orders', to: 'svc:checkout', label: '201 order o_4410', reply: true, ms: 2, detail: { status: 201, body: { orderId: 'o_4410' } } },
      { from: 'svc:checkout', to: 'svc:web', label: '200 confirmed', reply: true, ms: 2, next: -1, detail: { status: 200, body: { orderId: 'o_4410', state: 'confirmed' } } },
      { from: 'ext:card', to: 'svc:payments', label: 'declined', reply: true, ms: 2, detail: { status: 402, body: { result: 'declined', reason: 'insufficient_funds' } } },
      { from: 'svc:payments', to: 'svc:checkout', label: '402 payment failed', reply: true, ms: 2, detail: { status: 402, body: { error: 'card_declined' } } },
      { from: 'svc:checkout', to: 'svc:web', label: '402 try another card', reply: true, ms: 2, next: -1, detail: { status: 402, body: { error: 'card_declined', retry: true } } },
    ],
  },
  {
    id: 'search',
    title: 'Search the catalogue',
    description: 'A shopper types a query: the search service asks the index, then fills prices from the catalogue.',
    steps: [
      { from: 'svc:web', to: 'svc:search', label: 'GET /search?q=lamp', ms: 3, detail: { method: 'GET', url: '/api/search?q=lamp&page=1' } },
      { from: 'svc:search', to: 'svc:catalog', label: 'POST /prices', ms: 9, detail: { method: 'POST', url: '/v2/prices:batch', body: { skus: ['SKU-201', 'SKU-208'] } } },
      { from: 'svc:catalog', to: 'db:catalog', label: 'SELECT prices', ms: 4, detail: { sql: 'SELECT sku, price FROM prices WHERE sku = ANY($1)' } },
      { from: 'db:catalog', to: 'svc:catalog', label: '2 rows', reply: true, ms: 1, detail: { rows: 2 } },
      { from: 'svc:catalog', to: 'svc:search', label: '200 prices', reply: true, ms: 1, detail: { status: 200 } },
      { from: 'svc:search', to: 'svc:web', label: '200 2 results', reply: true, ms: 2, next: -1, detail: { status: 200, body: { hits: 2, tookMs: 21 } } },
    ],
  },
];

export function buildServicesDemo(now = Date.now()): Snapshot {
  const iso = (msAgo: number): string => new Date(now - msAgo).toISOString();
  const teams: GraphNode[] = TEAMS.map((t) => ({ ...t, type: 'team', group: t.id }));
  const services: GraphNode[] = SERVICES.map((s) => ({
    id: s.id,
    label: s.label,
    type: 'service',
    group: s.team,
    legend: s.legend,
    metrics: { rps: s.rps, errorRate: s.errorRate, p95: s.p95, uptime: s.uptime },
    deploy: { at: iso(s.deployedHoursAgo * HOUR), version: s.version },
    oncall: s.oncall,
    runbooks: s.runbooks,
    incidents: s.incidents.map((i) => ({ title: i.title, severity: i.severity, at: iso(i.daysAgo * DAY) })),
    lastIncident: s.incidents[0] ? iso(s.incidents[0].daysAgo * DAY) : null,
  }));
  const edges: GraphEdge[] = [
    ...CALLS.map(([source, target, kind, weight]) => ({ source, target, kind, weight })),
    ...[...services, ...STORES].filter((n) => n.group.startsWith('team:')).map((n) => ({ source: n.group, target: n.id, kind: 'owns', weight: 1 })),
  ];
  return {
    dataset: 'services',
    project: { org: 'acme (demo)', name: 'storefront', scope: 'organization' },
    generatedAt: new Date(now).toISOString(),
    summary: { services: services.length, teams: teams.length, 'open incidents': services.reduce((acc, s) => acc + (s.incidents as unknown[]).length, 0) },
    nodes: [...teams, ...services, ...STORES],
    edges,
    scenarios: SCENARIOS,
  };
}
