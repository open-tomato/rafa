/** The view config for the services demo: same dice, other entity types, other widgets. */
import type { AtlasConfig } from '../contract/types.ts';

export const SERVICES_CONFIG: AtlasConfig = {
  id: 'services',
  title: 'services of an organisation (demo data)',
  entityTypes: {
    team: { name: 'team', icon: '👥', stroke: '#f5c26b', help: 'A team; it owns services and stores. Its d12 opens to show them inside.', shape: 'd12' },
    service: { name: 'service', icon: '🧩', stroke: '#d8dee9', help: 'A running service; its links are the calls it makes.', shape: 'd10' },
    database: { name: 'database', icon: '🛢️', stroke: '#c3a6ff', help: 'A database the services read and write.', shape: 'cylinder' },
    cache: { name: 'cache', icon: '⚡', stroke: '#7dcfff', help: 'An in-memory cache.', shape: 'd8' },
    queue: { name: 'queue', icon: '📬', stroke: '#9ece6a', help: 'A message queue: services publish to it, workers get deliveries from it.', shape: 'd8' },
    external: { name: 'external', icon: '🌐', stroke: '#ff9e64', help: 'A third-party API outside the organisation.', shape: 'd6' },
  },
  edgeKinds: {
    calls: { label: 'calls', color: '#8fa3bf', dash: 0, rest: 11, stiffness: 0.006, calls: true, help: 'Service A calls service B. Thicker means more traffic.' },
    reads: { label: 'reads / writes', color: '#c3a6ff', dash: 0, rest: 7, stiffness: 0.02, calls: true, help: 'A service uses a database or a cache.' },
    publishes: { label: 'publishes', color: '#9ece6a', dash: 0.6, rest: 9, stiffness: 0.01, help: 'A service puts events on a queue.' },
    delivers: { label: 'delivers', color: '#e0af68', dash: 0.6, rest: 9, stiffness: 0.01, help: 'A queue hands events to a consumer.' },
    owns: { label: 'owns', color: '#f5c26b', dash: 0.25, rest: 6, stiffness: 0.03, help: 'A team owns a service or a store.' },
  },
  weightedKind: 'calls',
  minWeight: 1,
  pinned: ['svc:checkout', 'svc:search', 'db:orders'],
  groupColors: {
    'team:payments': '#2f8f5b',
    'team:platform': '#4a74e8',
    'team:growth': '#c2587a',
    external: '#a0602a',
  },
  size: 'metrics.rps',
  widgets: {
    callers: {
      title: 'Callers', icon: '⬆️', value: '@callers', action: { kind: 'highlight', relation: 'callers' },
      description: 'Services that call this one. Click to fold back and light them up.',
    },
    callees: {
      title: 'Calls', icon: '⬇️', value: '@callees', action: { kind: 'highlight', relation: 'callees' },
      description: 'What this one calls: services, stores and external APIs. Click to light them up.',
    },
    rps: { title: 'Requests/s', icon: '📈', value: 'metrics.rps', format: { kind: 'number', compact: true }, description: 'Requests per second, last 5 minutes.' },
    errors: { title: 'Error rate', icon: '🚨', value: 'metrics.errorRate', format: { kind: 'percent', ratio: true, decimals: 2 }, description: 'Share of requests answered with a 5xx, last hour.' },
    p95: { title: 'p95 latency', icon: '⏱️', value: 'metrics.p95', format: { kind: 'number', unit: 'ms' }, description: '95th percentile response time, last hour.' },
    uptime: { title: 'Uptime 30d', icon: '✅', value: 'metrics.uptime', format: { kind: 'percent', ratio: true, decimals: 2 }, description: 'Availability over the last 30 days.' },
    deployed: {
      title: 'Deployed', icon: '🚀', value: 'deploy.at', ui: 'label', format: { kind: 'relative-time', style: 'short' },
      description: 'When the running version was deployed.',
    },
    version: { title: 'Version', icon: '🏷️', value: 'deploy.version', ui: 'label', format: { kind: 'text', max: 12 }, description: 'The running version.' },
    incidents: {
      title: 'Incidents', icon: '🔥', value: 'incidents', background: { kind: 'icon', opacity: 0.1 }, action: { kind: 'list', items: 'incidents', shape: { text: 'title', tag: 'severity', meta: 'at' } },
      description: 'Incidents in the last 60 days. Click to list them.',
    },
    runbooks: {
      title: 'Runbooks', icon: '📕', value: 'runbooks', action: { kind: 'radial', items: 'runbooks' },
      description: 'Runbooks for this service. Click to spread them out.',
    },
    oncall: { title: 'On call', icon: '📟', value: 'oncall', ui: 'label', format: { kind: 'text', max: 16 }, description: 'The rotation paged for this service.' },
    connections: { title: 'Connections', icon: '🔗', value: 'metrics.connections', format: { kind: 'number', compact: true }, description: 'Open client connections.' },
    size: { title: 'Size', icon: '💾', value: 'metrics.sizeGb', format: { kind: 'number', compact: true, unit: 'GB' }, description: 'Data on disk.' },
    qps: { title: 'Queries/s', icon: '📊', value: 'metrics.qps', format: { kind: 'number', compact: true }, description: 'Queries per second.' },
    lag: { title: 'Replica lag', icon: '🐢', value: 'metrics.lagMs', format: { kind: 'number', unit: 'ms' }, description: 'Replication lag of the slowest replica.' },
    hitRate: { title: 'Hit rate', icon: '🎯', value: 'metrics.hitRate', format: { kind: 'percent', ratio: true, decimals: 1 }, description: 'Share of reads answered from the cache.' },
    memory: { title: 'Memory', icon: '🧠', value: 'metrics.memoryMb', format: { kind: 'number', compact: true, unit: 'MB' }, description: 'Memory in use.' },
    depth: { title: 'Depth', icon: '📥', value: 'metrics.depth', format: { kind: 'number', compact: true }, description: 'Messages waiting.' },
    consumers: { title: 'Consumers', icon: '👂', value: 'metrics.consumers', description: 'Consumers attached.' },
  },
  templates: [
    {
      id: 'service',
      appliesTo: ['service'],
      faces: {
        up0: 'callers', up1: 'rps', up2: 'deployed', up3: 'oncall', up4: 'runbooks',
        down0: 'callees', down1: 'errors', down2: 'p95', down3: 'uptime', down4: 'incidents',
      },
      details: [
        { value: 'legend', format: { kind: 'text', max: 44 } },
        { label: 'running', value: 'deploy.version' },
        { label: 'req/s', value: 'metrics.rps', format: { kind: 'number', compact: true } },
        { label: 'errors', value: 'metrics.errorRate', format: { kind: 'percent', ratio: true, decimals: 2 } },
        { label: 'deployed', value: 'deploy.at', format: { kind: 'relative-time' } },
      ],
      summary: ['rps', 'errors', 'p95', 'uptime', 'incidents', 'callers', 'callees', 'deployed'],
      lists: [
        { title: 'Incidents', items: 'incidents', shape: { text: 'title', tag: 'severity' } },
        { title: 'Runbooks', items: 'runbooks', display: 'chips' },
      ],
    },
    {
      id: 'store',
      appliesTo: ['database', 'cache', 'queue'],
      faces: {
        up0: 'callers', up1: 'connections', up2: 'qps', up3: 'hitRate', up4: 'consumers',
        down0: 'callees', down1: 'size', down2: 'lag', down3: 'memory', down4: 'depth',
      },
      details: [{ value: 'legend', format: { kind: 'text', max: 44 } }],
      summary: ['callers', 'connections', 'qps', 'size', 'hitRate', 'depth'],
    },
    {
      id: 'default',
      appliesTo: '*',
      faces: {
        up0: 'callers', up1: 'rps', up2: 'deployed', up3: 'oncall', up4: 'runbooks',
        down0: 'callees', down1: 'errors', down2: 'p95', down3: 'uptime', down4: 'incidents',
      },
      details: [{ value: 'legend', format: { kind: 'text', max: 44 } }],
      summary: ['callers', 'callees'],
    },
  ],
  heat: ['errors', 'rps', 'p95', 'incidents'],
  lenses: {
    all: { title: 'All', icon: '🌐', description: 'Every service, store and team, every link drawn.' },
    arch: {
      title: 'Architecture', icon: '🏛️',
      description: 'For an architect: one box per team with what it owns, and the calls, reads and events between them routed at right angles.',
      arrange: { kind: 'plots', contains: 'owns', routed: ['calls', 'reads', 'publishes', 'delivers'], direction: 'RIGHT' },
      relations: { owns: 'hidden' },
      labels: { service: 'name', database: 'name', cache: 'name', queue: 'name', external: 'name', team: 'none' },
    },
    sequence: {
      title: 'Time warp', icon: '⏱️',
      description: 'Replays a use case as requests moving between services, one step at a time, with a choice at each fork.',
      types: ['service', 'database', 'cache', 'queue', 'external'],
      arrange: { kind: 'sequence' },
      relations: { calls: 'hidden', reads: 'hidden', publishes: 'hidden', delivers: 'hidden', owns: 'hidden' },
    },
  },
};
