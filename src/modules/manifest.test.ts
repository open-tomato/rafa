/**
 * Tests for `validateManifest`: the `rafa` manifest a module's
 * `package.json` carries, accepted whole or refused with every problem
 * spelled in full.
 *
 * Every refusal sits beside a case the validator accepts, so a validator
 * refusing everything fails as surely as one refusing nothing. Each
 * family the task names has its own block: `manifestVersion`, the
 * `types` list, `provides` by type, `requires.rafa` against the running
 * version, and `requires.ports` against `PORT_VERSIONS`.
 *
 * Two readings carry a control that proves the check could have failed:
 *
 *   - The ranges refused by the grammar are each first shown satisfied
 *     by `Bun.semver.satisfies`, so the refusal is the grammar's and not
 *     bun's.
 *   - The prototype-key case first shows `JSON.parse` kept `__proto__`
 *     as an own key with the prototype untouched, so the refusal is read
 *     off the key and not off a parser that dropped it.
 *
 * Every case passes its seams, apart from the block reading the running
 * seams, which holds them to the `package.json` read off the disk here
 * and to `PORT_VERSIONS`.
 *
 * Fourteen mutations were driven against `manifest.ts` on 2026-09-15,
 * one run of this file each, with the unmutated module at 92 pass before
 * and after and restored byte-identical (sha256). Every one reddened at
 * least one case:
 *
 *   - The port version comparison dropped, and the refusal naming the
 *     served version alone, each reddened the three cases reading a port
 *     refusal. A listed port type stating no version accepted reddened
 *     its own case alone.
 *   - The range grammar dropped reddened the twelve refused ranges. The
 *     running version ignored for `0.2.0` reddened thirteen cases: the
 *     pinned table rows whose answer differs at `0.2.0`, the refusal
 *     naming the version, and the running seams.
 *   - `learning` opened reddened its case alone. `manifestVersion`
 *     compared with `!=` reddened the `"1"` case alone.
 *   - Unknown keys accepted reddened nine cases. A key matched as a
 *     `Object.prototype` member as well reddened the prototype-key case
 *     alone.
 *   - The cross check against `types` dropped reddened three cases, the
 *     spec example among them, and a listed type with no entry accepted
 *     its own case. A value listed twice accepted reddened three.
 *   - The types list left unfrozen reddened the frozen case, and a
 *     repeated `mcp` server accepted its own case.
 */
import type { ManifestSeams, ModuleManifest } from './manifest.js';
import type { PortVersions } from '../ports/index.js';

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'bun:test';

import { PORT_VERSIONS } from '../adapters/registry.js';

import { RUNNING_MANIFEST_SEAMS, validateManifest } from './manifest.js';

/** A rafa at 0.2.0 serving every port at version 1. */
const SEAMS: ManifestSeams = { rafaVersion: '0.2.0', portVersions: PORT_VERSIONS };

/** The feature types, as a refusal lists them. */
const TYPES = 'output, tracker, store, planner, learning, skills, agents, mcp, commands';

/** The port types, as a refusal lists them. */
const PORTS = 'tracker, store, learning, output, planner';

/** The sentence every refusal of `learning` ends with. */
const CLOSED = 'which core closes to third parties: a module never provides a learning source';

/** The problems `raw` is refused with, failing the case when it is accepted. */
function problemsOf(raw: unknown, seams: ManifestSeams = SEAMS): readonly string[] {
  const result = validateManifest(raw, 'rafa', seams);
  if (result.ok) throw new Error('expected a refusal, and the manifest was accepted');
  return result.problems;
}

/** The manifest `raw` is accepted as, failing the case with its problems when it is refused. */
function manifestOf(raw: unknown, seams: ManifestSeams = SEAMS): ModuleManifest {
  const result = validateManifest(raw, 'rafa', seams);
  if (!result.ok) throw new Error(`expected the manifest accepted, and it was refused:\n${result.problems.join('\n')}`);
  return result.manifest;
}

/** The port feature types, which state a port version. */
const PORTED: readonly string[] = ['tracker', 'store', 'planner', 'output'];

/** A manifest listing `type` alone and providing `value` for it. */
function providing(type: string, value: unknown): Record<string, unknown> {
  const ports = PORTED.includes(type)
    ? { [type]: 1 }
    : {};
  return { manifestVersion: 1, types: [type], provides: { [type]: value }, requires: { rafa: '>=0.1', ports } };
}

/** A commands-only manifest, with `overrides` laid over its top-level keys. */
function commandsModule(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { ...providing('commands', { entry: './src/commands.ts' }), ...overrides };
}

/** A manifest listing every type a module may, with every optional key given. */
function fullManifest(): Record<string, unknown> {
  return {
    manifestVersion: 1,
    types: ['tracker', 'store', 'planner', 'output', 'commands', 'skills', 'agents', 'mcp'],
    provides: {
      tracker: { kind: 'linear', entry: './src/tracker.ts' },
      store: { kind: 'postgres', entry: './src/store.ts' },
      planner: { kind: 'webhook', entry: './src/planner.ts' },
      output: { kind: 'mqtt', entry: './src/output.ts', channels: ['socket', 'mqtt'] },
      commands: { entry: './src/commands.ts' },
      skills: './skills',
      agents: './agents',
      mcp: [{ name: 'linear', command: 'bunx', args: ['@linear/mcp'] }, { name: 'notes', command: 'notes-mcp' }],
    },
    requires: { rafa: '>=0.2 <1', ports: { tracker: 1, store: 1, planner: 1, output: 1 } },
    prerequisites: { required: [{ env: 'LINEAR_API_KEY' }], optional: [{ tool: 'jq', reason: 'pretty output' }] },
    source: 'https://github.com/open-tomato/rafa-linear',
  };
}

/** The example under "Module manifest" in `.specs/modules-and-addons.md`, as written there. */
function specExample(): Record<string, unknown> {
  return {
    manifestVersion: 1,
    types: ['tracker', 'commands'],
    provides: {
      tracker: { kind: 'linear', entry: './src/tracker.ts' },
      commands: { entry: './src/commands.ts' },
      skills: './skills',
      agents: './agents',
      mcp: [{ name: 'linear', command: 'bunx', args: ['@linear/mcp'] }],
      output: { kind: 'mqtt', channels: ['socket'], entry: './src/output.ts' },
    },
    requires: { rafa: '>=0.2 <1', ports: { tracker: 1 } },
    prerequisites: { required: [{ env: 'LINEAR_API_KEY' }] },
    source: 'https://github.com/open-tomato/rafa-linear',
  };
}

describe('validateManifest accepts', () => {
  it('a manifest listing every module type, answered whole', () => {
    expect(manifestOf(fullManifest())).toEqual({
      manifestVersion: 1,
      types: ['tracker', 'store', 'planner', 'output', 'commands', 'skills', 'agents', 'mcp'],
      provides: {
        tracker: { kind: 'linear', entry: './src/tracker.ts' },
        store: { kind: 'postgres', entry: './src/store.ts' },
        planner: { kind: 'webhook', entry: './src/planner.ts' },
        output: { kind: 'mqtt', entry: './src/output.ts', channels: ['socket', 'mqtt'] },
        commands: { entry: './src/commands.ts' },
        skills: './skills',
        agents: './agents',
        mcp: [{ name: 'linear', command: 'bunx', args: ['@linear/mcp'] }, { name: 'notes', command: 'notes-mcp', args: [] }],
      },
      requires: { rafa: '>=0.2 <1', ports: { tracker: 1, store: 1, planner: 1, output: 1 } },
      prerequisites: {
        required: [{ kind: 'env', name: 'LINEAR_API_KEY', probe: null }],
        optional: [{ kind: 'tool', name: 'jq', probe: null, reason: 'pretty output' }],
      },
      source: 'https://github.com/open-tomato/rafa-linear',
    });
  });

  it('a commands-only manifest, with no ports, prerequisites or source', () => {
    expect(manifestOf(commandsModule())).toEqual({
      manifestVersion: 1,
      types: ['commands'],
      provides: { commands: { entry: './src/commands.ts' } },
      requires: { rafa: '>=0.1', ports: {} },
      prerequisites: { required: [], optional: [] },
      source: null,
    });
  });

  it('answers a manifest frozen throughout', () => {
    const manifest = manifestOf(fullManifest());
    const { provides, requires, prerequisites } = manifest;
    const frozen = [
      manifest,
      manifest.types,
      provides,
      provides.tracker,
      provides.output,
      provides.output?.channels,
      provides.mcp,
      provides.mcp?.[0],
      provides.mcp?.[0]?.args,
      provides.mcp?.[1]?.args,
      requires,
      requires.ports,
      prerequisites,
      prerequisites.required,
      prerequisites.required[0],
      prerequisites.optional,
    ];
    expect(frozen.map((value) => value !== undefined && Object.isFrozen(value))).toEqual(frozen.map(() => true));
  });

  it('shares no list with the value it read', () => {
    const raw = fullManifest();
    const manifest = manifestOf(raw);
    (raw['types'] as string[]).push('mcp');
    ((raw['provides'] as { output: { channels: string[] } }).output.channels).push('tui');
    expect(manifest.types).toEqual(['tracker', 'store', 'planner', 'output', 'commands', 'skills', 'agents', 'mcp']);
    expect(manifest.provides.output?.channels).toEqual(['socket', 'mqtt']);
  });

  it('opens every problem with the label it is handed', () => {
    const result = validateManifest(commandsModule({ source: '' }), '/m/package.json: rafa', SEAMS);
    expect(result).toEqual({ ok: false, problems: ['/m/package.json: rafa.source is "", expected a non-empty string'] });
  });

  it('names every failure of one manifest in one answer', () => {
    const raw = {
      manifestVersion: 1,
      types: ['tracker', 'trackr'],
      provides: { tracker: { kind: 'linear' } },
      requires: { rafa: '>=9', ports: { tracker: 2 } },
      source: 7,
    };
    expect(problemsOf(raw)).toEqual([
      `rafa.types[1] is "trackr", expected one of: ${TYPES}`,
      'rafa.provides.tracker.entry is missing',
      'rafa.requires.rafa is ">=9", which the running rafa 0.2.0 does not satisfy',
      'rafa.requires.ports.tracker is 2, but core serves tracker port version 1',
      'rafa.source is 7, expected a non-empty string',
    ]);
  });
});

describe('validateManifest on the manifest itself', () => {
  it.each([
    [undefined, 'rafa is undefined, expected a mapping'],
    [null, 'rafa is null, expected a mapping'],
    [['commands'], 'rafa is a list, expected a mapping'],
    ['rafa', 'rafa is "rafa", expected a mapping'],
  ])('refuses %p as no mapping', (raw, problem) => {
    expect(problemsOf(raw)).toEqual([problem]);
  });

  it('refuses a missing manifestVersion', () => {
    const raw = commandsModule();
    delete raw['manifestVersion'];
    expect(problemsOf(raw)).toEqual(['rafa.manifestVersion is missing']);
  });

  it.each([
    ['1', 'rafa.manifestVersion is "1", expected 1'],
    [2, 'rafa.manifestVersion is 2, expected 1'],
    [null, 'rafa.manifestVersion is null, expected 1'],
  ])('refuses the manifestVersion %p', (manifestVersion, problem) => {
    expect(problemsOf(commandsModule({ manifestVersion }))).toEqual([problem]);
  });

  it('answers another manifestVersion with that problem alone, whatever else the manifest holds', () => {
    expect(problemsOf({ manifestVersion: 2, types: 'all', owner: 'x' })).toEqual(['rafa.manifestVersion is 2, expected 1']);
  });

  it('names each required key missing', () => {
    expect(problemsOf({ manifestVersion: 1 })).toEqual([
      'rafa.types is missing',
      'rafa.provides is missing',
      'rafa.requires is missing',
    ]);
  });

  it('refuses a key the schema does not name', () => {
    expect(problemsOf(commandsModule({ provide: {} }))).toEqual([
      'rafa carries "provide", which is none of: manifestVersion, types, provides, requires, prerequisites, source',
    ]);
  });

  it('refuses __proto__ and constructor keys as keys, at every level', () => {
    const raw: unknown = JSON.parse([
      '{"manifestVersion":1,"__proto__":{"polluted":true},"constructor":"x","types":["commands"],',
      '"provides":{"commands":{"entry":"./c.ts","__proto__":{"kind":"x"}},"constructor":{}},',
      '"requires":{"rafa":">=0.1","ports":{"__proto__":1,"constructor":1}}}',
    ].join(''));
    expect(Object.hasOwn(raw as object, '__proto__')).toBe(true);
    expect(Object.getPrototypeOf(raw)).toBe(Object.prototype);

    expect(problemsOf(raw)).toEqual([
      'rafa carries "__proto__", which is none of: manifestVersion, types, provides, requires, prerequisites, source',
      'rafa carries "constructor", which is none of: manifestVersion, types, provides, requires, prerequisites, source',
      `rafa.provides carries "constructor", which is none of: ${TYPES}`,
      'rafa.provides.commands carries "__proto__", which is none of: entry',
      `rafa.requires.ports carries "__proto__", which is none of: ${PORTS}`,
      `rafa.requires.ports carries "constructor", which is none of: ${PORTS}`,
    ]);
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
  });

  it('throws for running seams naming no plain version', () => {
    expect(() => validateManifest(commandsModule(), 'rafa', { ...SEAMS, rafaVersion: '0.2' }))
      .toThrow('the running rafa version "0.2" is no major.minor.patch version');
  });
});

describe('validateManifest on types', () => {
  it.each([
    ['commands', 'rafa.types is "commands", expected a non-empty list of: '],
    [[], 'rafa.types is an empty list, expected a non-empty list of: '],
  ])('refuses %p as no list of types', (types, opening) => {
    expect(problemsOf(commandsModule({ types }))).toEqual([`${opening}${TYPES}`]);
  });

  it('refuses a type the table does not name, and a type listed twice', () => {
    expect(problemsOf(commandsModule({ types: ['commands', 'command', 'commands'] }))).toEqual([
      `rafa.types[1] is "command", expected one of: ${TYPES}`,
      'rafa.types[2] is "commands", listed already',
    ]);
  });

  it('refuses learning by name, with its provides entry', () => {
    const raw = commandsModule({
      types: ['commands', 'learning'],
      provides: { commands: { entry: './src/commands.ts' }, learning: { kind: 'remote', entry: './src/learning.ts' } },
    });
    expect(problemsOf(raw)).toEqual([
      `rafa.types[1] is "learning", ${CLOSED}`,
      `rafa.provides.learning names learning, ${CLOSED}`,
    ]);
  });

  it('refuses a learning entry in provides when types does not list it', () => {
    const raw = commandsModule({ provides: { commands: { entry: './src/commands.ts' }, learning: {} } });
    expect(problemsOf(raw)).toEqual([`rafa.provides.learning names learning, ${CLOSED}`]);
  });
});

describe('validateManifest on provides', () => {
  it('refuses a provides that is no mapping', () => {
    expect(problemsOf(commandsModule({ provides: ['commands'] }))).toEqual(['rafa.provides is a list, expected a mapping']);
  });

  it('refuses an entry for a type types does not list', () => {
    const raw = commandsModule({ provides: { commands: { entry: './src/commands.ts' }, skills: './skills' } });
    expect(problemsOf(raw)).toEqual(['rafa.provides.skills is given, but rafa.types does not list skills']);
  });

  it('refuses a listed type with no entry', () => {
    expect(problemsOf(commandsModule({ types: ['commands', 'skills'] }))).toEqual(['rafa.provides.skills is missing: rafa.types lists skills']);
  });

  it('holds provides to types only when types reads clean', () => {
    const raw = commandsModule({
      types: ['commands', 'commands'],
      provides: { commands: { entry: './src/commands.ts' }, skills: './skills' },
    });
    expect(problemsOf(raw)).toEqual(['rafa.types[1] is "commands", listed already']);
  });

  it('holds the spec example to types, refusing four of its entries', () => {
    expect(problemsOf(specExample())).toEqual([
      'rafa.provides.skills is given, but rafa.types does not list skills',
      'rafa.provides.agents is given, but rafa.types does not list agents',
      'rafa.provides.mcp is given, but rafa.types does not list mcp',
      'rafa.provides.output is given, but rafa.types does not list output',
    ]);
  });

  it('accepts the spec example once types lists every entry and ports states the output version', () => {
    const raw: Record<string, unknown> = { ...specExample(), types: ['tracker', 'commands', 'skills', 'agents', 'mcp', 'output'] };
    raw['requires'] = { rafa: '>=0.2 <1', ports: { tracker: 1, output: 1 } };
    expect(manifestOf(raw).types).toEqual(['tracker', 'commands', 'skills', 'agents', 'mcp', 'output']);
  });

  it.each(['tracker', 'store', 'planner'])('accepts and refuses a %s entry by the adapter shape', (type) => {
    expect(manifestOf(providing(type, { kind: 'k', entry: './e.ts' })).provides).toEqual({ [type]: { kind: 'k', entry: './e.ts' } });
    expect(problemsOf(providing(type, { kind: ' ', entry: 3, extra: 1 }))).toEqual([
      `rafa.provides.${type} carries "extra", which is none of: kind, entry`,
      `rafa.provides.${type}.kind is " ", expected a non-empty string`,
      `rafa.provides.${type}.entry is 3, expected a non-empty string`,
    ]);
    expect(problemsOf(providing(type, {}))).toEqual([
      `rafa.provides.${type}.kind is missing`,
      `rafa.provides.${type}.entry is missing`,
    ]);
    expect(problemsOf(providing(type, './e.ts'))).toEqual([`rafa.provides.${type} is "./e.ts", expected a mapping`]);
  });

  it('refuses an output entry without channels, with an empty list, and with a channel unknown or repeated', () => {
    const channels = 'stdout, file, socket, mqtt, kafka, tui';
    expect(problemsOf(providing('output', { kind: 'k', entry: './e.ts' }))).toEqual(['rafa.provides.output.channels is missing']);
    expect(problemsOf(providing('output', { kind: 'k', entry: './e.ts', channels: [] }))).toEqual([
      `rafa.provides.output.channels is an empty list, expected a non-empty list of: ${channels}`,
    ]);
    expect(problemsOf(providing('output', { kind: 'k', entry: './e.ts', channels: ['stdout', 'tv', 'stdout'] }))).toEqual([
      `rafa.provides.output.channels[1] is "tv", expected one of: ${channels}`,
      'rafa.provides.output.channels[2] is "stdout", listed already',
    ]);
    expect(manifestOf(providing('output', { kind: 'k', entry: './e.ts', channels: ['stdout'] })).provides.output?.channels).toEqual(['stdout']);
  });

  it('refuses a commands entry naming no file, or carrying another key', () => {
    expect(problemsOf(providing('commands', { entry: null }))).toEqual(['rafa.provides.commands.entry is null, expected a non-empty string']);
    expect(problemsOf(providing('commands', { entry: './c.ts', kind: 'x' }))).toEqual(['rafa.provides.commands carries "kind", which is none of: entry']);
  });

  it.each(['skills', 'agents'])('accepts a %s directory and refuses anything else', (type) => {
    expect(manifestOf(providing(type, './dir')).provides).toEqual({ [type]: './dir' });
    expect(problemsOf(providing(type, 42))).toEqual([`rafa.provides.${type} is 42, expected a directory path`]);
    expect(problemsOf(providing(type, { path: './dir' }))).toEqual([`rafa.provides.${type} is a mapping, expected a directory path`]);
  });

  it('refuses an mcp entry that is no list of servers', () => {
    expect(problemsOf(providing('mcp', []))).toEqual(['rafa.provides.mcp is an empty list, expected a non-empty list of servers']);
    expect(problemsOf(providing('mcp', { name: 'a', command: 'x' }))).toEqual(['rafa.provides.mcp is a mapping, expected a non-empty list of servers']);
  });

  it('refuses an mcp server by its keys and its args', () => {
    const raw = providing('mcp', [
      { name: 'a' },
      { name: 'b', command: 'x', args: ['ok', 2] },
      { name: 'c', command: 'y', args: 'z', env: {} },
    ]);
    expect(problemsOf(raw)).toEqual([
      'rafa.provides.mcp[0].command is missing',
      'rafa.provides.mcp[1].args[1] is 2, expected a string',
      'rafa.provides.mcp[2] carries "env", which is none of: name, command, args',
      'rafa.provides.mcp[2].args is "z", expected a list of strings',
    ]);
  });

  it('refuses a server name given more than once, naming it once', () => {
    const raw = providing('mcp', [{ name: 'a', command: 'x' }, { name: 'a', command: 'y' }, { name: 'b', command: 'z' }, { name: 'a', command: 'w' }]);
    expect(problemsOf(raw)).toEqual(['rafa.provides.mcp names the server "a" more than once']);
  });
});

describe('validateManifest on requires.rafa', () => {
  it('refuses a requires that is no mapping, and one naming no rafa range', () => {
    expect(problemsOf(commandsModule({ requires: 'rafa' }))).toEqual(['rafa.requires is "rafa", expected a mapping']);
    expect(problemsOf(commandsModule({ requires: {} }))).toEqual(['rafa.requires.rafa is missing']);
  });

  it('accepts a range the running version satisfies and refuses one it does not, naming the version', () => {
    const range = { requires: { rafa: '>=0.2 <1' } };
    expect(manifestOf(commandsModule(range), { ...SEAMS, rafaVersion: '0.2.0' }).requires.rafa).toBe('>=0.2 <1');
    expect(problemsOf(commandsModule(range), { ...SEAMS, rafaVersion: '0.1.0' })).toEqual([
      'rafa.requires.rafa is ">=0.2 <1", which the running rafa 0.1.0 does not satisfy',
    ]);
  });

  // Each answer below was read off Bun.semver.satisfies on bun 1.3.14, and matches npm.
  it.each([
    ['0.2.9', '^0.2', true],
    ['0.3.0', '^0.2', false],
    ['0.0.4', '^0.0.3', false],
    ['1.9.0', '^1.2', true],
    ['2.0.0', '^1.2', false],
    ['1.2.5', '~1.2', true],
    ['1.3.0', '~1.2', false],
    ['1.9.0', '~1', true],
    ['2.0.0', '~1', false],
    ['0.1.5', '0.1', true],
    ['0.2.0', '0.1', false],
    ['0.1.1', '>0.1', false],
    ['0.2.0', '>0.1', true],
    ['0.1.9', '<=0.1', true],
    ['0.2.0', '<=0.1', false],
    ['0.1.0', '<0.2 || >=3', true],
    ['3.0.0', '<0.2 || >=3', true],
    ['1.0.0', '<0.2 || >=3', false],
    ['0.1.0', '=0.1.0', true],
    ['1.5.0', '1', true],
    ['0.1.0', '  >=0.1   <1  ', true],
  ])('holds %s against the range %p as %p', (rafaVersion, rafa, satisfied) => {
    expect(validateManifest(commandsModule({ requires: { rafa } }), 'rafa', { ...SEAMS, rafaVersion }).ok).toBe(satisfied);
  });

  it.each(['garbage', 'latest', 'x.y.z', '>=abc', '>=0.1.0,<1', '*', '>= 0.1.0'])(
    'refuses %p as no range, though bun satisfies 0.1.0 with it',
    (rafa) => {
      expect(Bun.semver.satisfies('0.1.0', rafa)).toBe(true);
      expect(problemsOf(commandsModule({ requires: { rafa } }), { ...SEAMS, rafaVersion: '0.1.0' })).toEqual([
        `rafa.requires.rafa is ${JSON.stringify(rafa)}, expected a version range such as ">=0.2 <1"`,
      ]);
    },
  );

  it.each(['', '   ', '>=0.1.0-beta', '01.2', '1.2.3.4', '>=0.1 ||', '^', 1])('refuses %p as no range', (rafa) => {
    const described = typeof rafa === 'string'
      ? JSON.stringify(rafa)
      : String(rafa);
    expect(problemsOf(commandsModule({ requires: { rafa } }), { ...SEAMS, rafaVersion: '0.1.0' })).toEqual([
      `rafa.requires.rafa is ${described}, expected a version range such as ">=0.2 <1"`,
    ]);
  });
});

describe('validateManifest on requires.ports', () => {
  it('refuses a port version core does not serve, naming both numbers', () => {
    const raw = providing('tracker', { kind: 'k', entry: './e.ts' });
    raw['requires'] = { rafa: '>=0.1', ports: { tracker: 2 } };
    expect(problemsOf(raw)).toEqual(['rafa.requires.ports.tracker is 2, but core serves tracker port version 1']);
  });

  it('refuses a module at version 1 once core serves the port at version 2', () => {
    const served = { ...PORT_VERSIONS, tracker: 2 } as unknown as PortVersions;
    const raw = providing('tracker', { kind: 'k', entry: './e.ts' });
    expect(manifestOf(raw).requires.ports).toEqual({ tracker: 1 });
    expect(problemsOf(raw, { ...SEAMS, portVersions: served })).toEqual(['rafa.requires.ports.tracker is 1, but core serves tracker port version 2']);
  });

  it.each([
    ['1', '"1"'],
    [0, '0'],
    [1.5, '1.5'],
    [null, 'null'],
  ])('refuses the port version %p', (version, described) => {
    const raw = providing('store', { kind: 'k', entry: './e.ts' });
    raw['requires'] = { rafa: '>=0.1', ports: { store: version } };
    expect(problemsOf(raw)).toEqual([`rafa.requires.ports.store is ${described}, expected a whole number above 0`]);
  });

  it('refuses a listed port type stating no version, with ports given or left out', () => {
    const raw = providing('planner', { kind: 'k', entry: './e.ts' });
    const missing = 'rafa.requires.ports.planner is missing: rafa.types lists planner, a port core versions';
    raw['requires'] = { rafa: '>=0.1', ports: {} };
    expect(problemsOf(raw)).toEqual([missing]);
    raw['requires'] = { rafa: '>=0.1' };
    expect(problemsOf(raw)).toEqual([missing]);
  });

  it('refuses a version for a port types does not list, learning included', () => {
    expect(problemsOf(commandsModule({ requires: { rafa: '>=0.1', ports: { output: 1, learning: 1 } } }))).toEqual([
      'rafa.requires.ports.learning is given, but rafa.types does not list learning',
      'rafa.requires.ports.output is given, but rafa.types does not list output',
    ]);
  });

  it('refuses a ports key naming no port, and a ports that is no mapping', () => {
    expect(problemsOf(commandsModule({ requires: { rafa: '>=0.1', ports: { issues: 1 } } }))).toEqual([
      `rafa.requires.ports carries "issues", which is none of: ${PORTS}`,
    ]);
    expect(problemsOf(commandsModule({ requires: { rafa: '>=0.1', ports: [1] } }))).toEqual(['rafa.requires.ports is a list, expected a mapping']);
  });
});

describe('validateManifest on prerequisites and source', () => {
  it('refuses prerequisites by the readers the config file uses', () => {
    expect(problemsOf(commandsModule({ prerequisites: 'x' }))).toEqual(['rafa.prerequisites is "x", expected a mapping']);
    expect(problemsOf(commandsModule({ prerequisites: { needed: [] } }))).toEqual([
      'rafa.prerequisites carries "needed", which is none of: required, optional',
    ]);
    expect(problemsOf(commandsModule({ prerequisites: { optional: 'jq' } }))).toEqual([
      'rafa.prerequisites.optional is "jq", expected a list of prerequisite items',
    ]);
    expect(problemsOf(commandsModule({ prerequisites: { required: [{ tool: 'bun', env: 'X' }] } }))).toEqual([
      'rafa.prerequisites.required[0] names tool and env, expected exactly one of: tool, env, service, lsp',
    ]);
  });

  it('refuses a key a prerequisite item does not read, which the config file only warns about', () => {
    expect(problemsOf(commandsModule({ prerequisites: { required: [{ env: 'A', timeout: 3 }] } }))).toEqual([
      'rafa.prerequisites.required[0].timeout is no key a prerequisite item reads',
    ]);
  });

  it('refuses a blank source and accepts a written one', () => {
    expect(problemsOf(commandsModule({ source: ' ' }))).toEqual(['rafa.source is " ", expected a non-empty string']);
    expect(manifestOf(commandsModule({ source: '../mine' })).source).toBe('../mine');
  });
});

describe('the running manifest seams', () => {
  const packageVersion = (JSON.parse(readFileSync(join(import.meta.dir, '..', '..', 'package.json'), 'utf8')) as { version: string }).version;

  it('are the package.json version and PORT_VERSIONS', () => {
    expect(RUNNING_MANIFEST_SEAMS.rafaVersion).toBe(packageVersion);
    expect(RUNNING_MANIFEST_SEAMS.portVersions).toBe(PORT_VERSIONS);
  });

  it('are what validateManifest holds a manifest against when handed none', () => {
    expect(validateManifest(commandsModule({ requires: { rafa: `=${packageVersion}` } })).ok).toBe(true);
    expect(validateManifest(commandsModule({ requires: { rafa: `>${packageVersion}` } }))).toEqual({
      ok: false,
      problems: [`rafa.requires.rafa is ">${packageVersion}", which the running rafa ${packageVersion} does not satisfy`],
    });
  });
});
