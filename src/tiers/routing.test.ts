/**
 * Tests for the routing defaults and routing-row resolution.
 *
 * The table is SPELLED here, row by row, from the spec, and never read
 * off {@link DEFAULT_ROUTES}, so a module that drops, renames or
 * reorders a row fails rather than agreeing with itself. The map is
 * then held to the list, and both are driven through the reader a
 * file's `routing` goes through, so a default the reader would refuse
 * fails here too. That case has a control: a table holding `true`,
 * which the same reader refuses.
 *
 * Resolution runs over real `resolveTiers` output built from planted
 * rows and an in-memory reader, never a hand-built `Resolution`, so a
 * resolver change the routing reading depends on shows up here. Each
 * refusal sits beside the same row resolving once the agent is held,
 * so a check that answered unresolved for everything would fail.
 */
import type { RouteTarget, ValueAt } from '../config-sections.js';
import type { Resolution, TierRow, TierSettings } from './resolve.js';
import type { RoutingContext } from './routing.js';
import type { InventorySource } from '../inventory/record.js';

import { describe, expect, it } from 'bun:test';

import { BUILT_IN_AGENTS } from '../agents/roster.js';
import { mapOf } from '../config-schema.js';
import { routeTarget } from '../config-sections.js';
import { CONFIG_DEFAULTS, parseConfigText } from '../config.js';

import { resolveTiers } from './resolve.js';
import {
  configuredShapes,
  DEFAULT_ROUTES,
  DEFAULT_ROUTING,
  resolveRouting,
} from './routing.js';

/** The spec's routing table, as rafa's defaults. */
const SPEC_TABLE: [string, string][] = [
  ['prose', 'doc-updater'],
  ['tests', 'tdd-guide'],
  ['repair', 'build-error-resolver'],
  ['review', 'code-reviewer'],
  ['implementation', 'loop-implementer'],
];

/** The reader `routing` is read through, as `config-schema.ts` builds it. */
const readRouting = mapOf(routeTarget, 'false or an agent name');

/** Where every reading here is labelled. */
const AT: ValueAt = { label: 'F: routing', key: 'routing' };

describe('DEFAULT_ROUTES', () => {
  it('holds the spec table, row for row and in order', () => {
    expect(DEFAULT_ROUTES.map((route) => [...route])).toEqual(SPEC_TABLE);
  });

  it('leaves the two user-level rows out', () => {
    const shapes = DEFAULT_ROUTES.map(([shape]) => shape);
    const agents = DEFAULT_ROUTES.map(([, agent]) => agent);

    expect(shapes).not.toContain('cleanup');
    expect(agents).not.toContain('refactor-cleaner');
    expect(agents).not.toContain('typescript-reviewer');
  });

  it('is frozen, the list and each row', () => {
    expect(Object.isFrozen(DEFAULT_ROUTES)).toBe(true);
    expect(DEFAULT_ROUTES.every((route) => Object.isFrozen(route))).toBe(true);
  });
});

describe('DEFAULT_ROUTING', () => {
  it('maps each shape of the list to its agent, in the list order', () => {
    expect([...DEFAULT_ROUTING]).toEqual(SPEC_TABLE);
  });

  it('is the routing every config resolves to when no layer names it', () => {
    expect(CONFIG_DEFAULTS.routing).toBe(DEFAULT_ROUTING);
  });

  it('reads back through the routing reader unchanged', () => {
    const reading = readRouting(Object.fromEntries(DEFAULT_ROUTING), AT);

    expect(reading.problems).toEqual([]);
    expect(reading.value).toEqual(DEFAULT_ROUTING);
  });

  it('would fail that reading with a row the reader refuses, the control', () => {
    const reading = readRouting({ ...Object.fromEntries(DEFAULT_ROUTING), prose: true }, AT);

    expect(reading.value).toBeUndefined();
    expect(reading.problems).toEqual([
      'F: routing.prose is true, expected false or an agent name',
    ]);
  });
});

/** Where each tier's agents are planted; nothing is written there. */
const AGENT_DIRS: Record<string, string> = {
  project: '/p/.claude/agents',
  rafa: '/r/bundled/agents',
  user: '/u/.claude/agents',
};

/** An agent row of `name` in `source`. */
function agentRow(source: InventorySource, name: string): TierRow {
  return { kind: 'agent', name, source, path: `${AGENT_DIRS[source]}/${name}.md` };
}

/** The config defaults' tier settings, with `changes` applied. */
function tierSettings(changes: Partial<TierSettings> = {}): TierSettings {
  return {
    settingSources: CONFIG_DEFAULTS.settingSources,
    tiersRafa: CONFIG_DEFAULTS.tiersRafa,
    tiersSkills: CONFIG_DEFAULTS.tiersSkills,
    tiersAgents: CONFIG_DEFAULTS.tiersAgents,
    ...changes,
  };
}

/** `rows` resolved, each file's bytes being its own path, so no two holders are identical. */
function resolved(rows: readonly TierRow[], changes: Partial<TierSettings> = {}): Resolution {
  return resolveTiers(rows, tierSettings(changes), (path) => new TextEncoder().encode(path));
}

/** The rafa tier holding every default row's agent. */
const BUNDLE: readonly TierRow[] = DEFAULT_ROUTES.map(([, agent]) => agentRow('rafa', agent));

/** The built-ins a caller passes. */
const BUILT_INS: readonly string[] = BUILT_IN_AGENTS;

/** The defaults with `rows` merged over them, as `resolveConfig` merges a layer. */
function routingWith(rows: [string, RouteTarget][]): ReadonlyMap<string, RouteTarget> {
  return new Map([...DEFAULT_ROUTING, ...rows]);
}

/** A context naming `configured` as written by a config file. */
function context(configured: string[] = []): RoutingContext {
  return { configured: new Set(configured), builtIns: BUILT_INS };
}

describe('resolveRouting', () => {
  it('resolves every default row against a rafa tier holding the roster', () => {
    const reading = resolveRouting(DEFAULT_ROUTING, resolved(BUNDLE), context());

    expect(reading.rows.map((row) => [row.shape, row.origin, row.answer.state])).toEqual(
      SPEC_TABLE.map(([shape]) => [shape, 'default', 'served']),
    );
    expect(reading.loadErrors).toEqual([]);
    expect(reading.doctorProblems).toEqual([]);
  });

  it('answers a load error for a configured row whose agent no tier holds', () => {
    const routing = routingWith([['cleanup', 'refactor-cleaner']]);
    const reading = resolveRouting(routing, resolved(BUNDLE), context(['cleanup']));

    expect(reading.loadErrors).toEqual([
      'routing.cleanup names agent refactor-cleaner, which does not resolve: '
        + 'no loaded tier holds an agent of that name',
    ]);
    expect(reading.doctorProblems).toEqual([]);
  });

  it('answers no error for that row once the project holds the agent, the control', () => {
    const routing = routingWith([['cleanup', 'refactor-cleaner']]);
    const rows = [...BUNDLE, agentRow('project', 'refactor-cleaner')];
    const reading = resolveRouting(routing, resolved(rows), context(['cleanup']));

    expect(reading.rows.find((row) => row.shape === 'cleanup')).toMatchObject({
      origin: 'configured',
      resolves: true,
      answer: { state: 'served' },
    });
    expect(reading.loadErrors).toEqual([]);
  });

  it('answers a doctor problem, not a load error, for a default row the tiers do not serve', () => {
    const reading = resolveRouting(DEFAULT_ROUTING, resolved(BUNDLE, { tiersRafa: 'off' }), context());

    expect(reading.loadErrors).toEqual([]);
    expect(reading.doctorProblems).toHaveLength(5);
    expect(reading.doctorProblems[0]).toBe(
      'the default routing row prose → doc-updater does not resolve: '
        + 'only the rafa tier holds it, and a loop session does not load that; '
        + 'route the shape to an agent that resolves, or remove the row: routing: { prose: false }',
    );
  });

  it('counts a configured row restating the default agent as configured', () => {
    const reading = resolveRouting(DEFAULT_ROUTING, resolved([]), context(['tests']));

    expect(reading.loadErrors).toEqual([
      'routing.tests names agent tdd-guide, which does not resolve: '
        + 'no loaded tier holds an agent of that name',
    ]);
    expect(reading.doctorProblems).toHaveLength(4);
  });

  it('counts a row the defaults could not have written as configured whatever the set says', () => {
    const routing = routingWith([['review', 'typescript-reviewer']]);
    const reading = resolveRouting(routing, resolved(BUNDLE), context());

    expect(reading.loadErrors).toEqual([
      'routing.review names agent typescript-reviewer, which does not resolve: '
        + 'no loaded tier holds an agent of that name',
    ]);
  });

  it('skips a false row, which removes it', () => {
    const routing = routingWith([['tests', false], ['cleanup', false]]);
    const reading = resolveRouting(routing, resolved([]), context(['tests', 'cleanup']));

    expect(reading.rows.map((row) => row.shape)).toEqual(['prose', 'repair', 'review', 'implementation']);
    expect(reading.loadErrors).toEqual([]);
  });

  it('refuses an agent tiers.agents turns off', () => {
    const tiersAgents = new Map([['tdd-guide', false as const]]);
    const reading = resolveRouting(DEFAULT_ROUTING, resolved(BUNDLE, { tiersAgents }), context());

    expect(reading.doctorProblems).toEqual([
      'the default routing row tests → tdd-guide does not resolve: tiers.agents turns it off; '
        + 'route the shape to an agent that resolves, or remove the row: routing: { tests: false }',
    ]);
  });

  it('refuses an agent only the unloaded user tier holds, and serves it once user loads', () => {
    const routing = routingWith([['cleanup', 'refactor-cleaner']]);
    const rows = [...BUNDLE, agentRow('user', 'refactor-cleaner')];

    const unloaded = resolveRouting(routing, resolved(rows), context(['cleanup']));
    const loaded = resolveRouting(
      routing,
      resolved(rows, { settingSources: ['user', 'project', 'local'] }),
      context(['cleanup']),
    );

    expect(unloaded.loadErrors).toEqual([
      'routing.cleanup names agent refactor-cleaner, which does not resolve: '
        + 'only the user tier holds it, and a loop session does not load that',
    ]);
    expect(loaded.loadErrors).toEqual([]);
  });

  it('refuses a collision with both paths and its pin line, and resolves it once pinned', () => {
    const rows = [...BUNDLE, agentRow('project', 'tdd-guide')];

    const collision = resolveRouting(DEFAULT_ROUTING, resolved(rows), context());
    const pinned = resolveRouting(
      DEFAULT_ROUTING,
      resolved(rows, { tiersAgents: new Map([['tdd-guide', 'rafa' as const]]) }),
      context(),
    );

    expect(collision.doctorProblems).toEqual([
      'the default routing row tests → tdd-guide does not resolve: 2 loaded tiers hold different '
        + 'definitions of it (/p/.claude/agents/tdd-guide.md and /r/bundled/agents/tdd-guide.md); '
        + 'pin the tier that serves it: tiers.agents: { tdd-guide: project }; '
        + 'route the shape to an agent that resolves, or remove the row: routing: { tests: false }',
    ]);
    expect(pinned.doctorProblems).toEqual([]);
  });

  it('resolves a built-in agent no tier holds, and refuses a name that is not one, the control', () => {
    const routing = routingWith([['explore', 'Explore'], ['lower', 'explore']]);
    const reading = resolveRouting(routing, resolved(BUNDLE), context(['explore', 'lower']));

    expect(reading.rows.find((row) => row.shape === 'explore')?.answer).toEqual({ state: 'built-in' });
    expect(reading.loadErrors).toEqual([
      'routing.lower names agent explore, which does not resolve: '
        + 'no loaded tier holds an agent of that name',
    ]);
  });

  it('still refuses a built-in name the tiers hold as a collision', () => {
    const routing = routingWith([['plan', 'Plan']]);
    const rows = [...BUNDLE, agentRow('project', 'Plan'), agentRow('rafa', 'Plan')];
    const reading = resolveRouting(routing, resolved(rows), context(['plan']));

    expect(reading.rows.find((row) => row.shape === 'plan')?.answer.state).toBe('collision');
    expect(reading.loadErrors).toHaveLength(1);
  });

  it('reads a shape no flow mapping carries bare as any other configured row', () => {
    const routing = new Map<string, RouteTarget>([['ts review', 'code-reviewer']]);

    expect(resolveRouting(routing, resolved([]), context()).loadErrors).toEqual([
      'routing.ts review names agent code-reviewer, which does not resolve: '
        + 'no loaded tier holds an agent of that name',
    ]);
    expect(resolveRouting(routing, resolved(BUNDLE), context()).loadErrors).toEqual([]);
  });
});

describe('configuredShapes', () => {
  it('collects the shapes the project and user files name, false rows included', () => {
    const file = parseConfigText('routing: { cleanup: refactor-cleaner, tests: false }\n', '/p/.rafa/config.yaml');
    const user = parseConfigText('routing: { review: typescript-reviewer }\n', '/u/.rafa/config.yaml');

    expect([...configuredShapes({ file, user })].sort()).toEqual(['cleanup', 'review', 'tests']);
  });

  it('is empty when neither file names routing', () => {
    const file = parseConfigText('tiers:\n  rafa: off\n', '/p/.rafa/config.yaml');

    expect(configuredShapes({ file, user: null }).size).toBe(0);
    expect(configuredShapes({}).size).toBe(0);
  });
});
