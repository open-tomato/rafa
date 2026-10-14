/**
 * Tests for core's own section: its package name, the file key and
 * command-line spelling of each of its settings, each default, the
 * config file, and how it merges through the section contract.
 *
 * Every key, every default and the package name are SPELLED here, never
 * read off the module, so a module that renames a key or moves a default
 * fails rather than agreeing with itself. The set of names is held a
 * second way: read off `config-schema.ts`'s source with the TypeScript
 * parser, the fields that file declares on `RafaConfig` are exactly the
 * section's settings, which no type can say once a section file adds
 * fields of its own. That reading is checked against a field it must see
 * (`store`) and one it must not (`hubUrl`, a section file's), so a parse
 * that came back empty or read the merged interface fails.
 *
 * The merge cases go through `mergeConfigSections` on a registry value
 * and never touch the active registry, so nothing here leaks into a file
 * bun runs later.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'bun:test';
import ts from 'typescript';

import { DEFAULT_ROUTING } from '../../tiers/routing.js';

import { CONFIG_FILE, CORE_SECTION } from './core-section.js';
import { ConfigSectionError, EMPTY_CONFIG_REGISTRY, mergeConfigSections } from './section.js';

/** The file `RafaConfig` is declared in. */
const SCHEMA_FILE = resolve(import.meta.dir, 'config-schema.ts');

/** Each of core's settings and the file key it is spelled with, in order. */
const KEYS: readonly (readonly [string, string])[] = [
  ['version', 'version'],
  ['store', 'store'],
  ['effortBusyTimeoutMs', 'effort.busyTimeoutMs'],
  ['effortSync', 'effort.sync'],
  ['inject', 'plan.inject'],
  ['planDir', 'plan.dir'],
  ['specsDir', 'specs.dir'],
  ['trackerDefault', 'tracker.default'],
  ['trackerFallback', 'tracker.fallback'],
  ['learningAdapter', 'learning.adapter'],
  ['learningBlessMinConfidence', 'learning.bless.minConfidence'],
  ['learningPromoteAfter', 'learning.promote.after'],
  ['learningPromoteMinConfidence', 'learning.promote.minConfidence'],
  ['outputMode', 'output.mode'],
  ['prerequisitesRequired', 'prerequisites.required'],
  ['prerequisitesOptional', 'prerequisites.optional'],
  ['trackingSpecs', 'tracking.specs'],
  ['trackingPlans', 'tracking.plans'],
  ['trackingAll', 'tracking.all'],
  ['modules', 'modules'],
  ['allowList', 'allowList'],
  ['settingSources', 'loop.settingSources'],
  ['loopWorktreeDir', 'loop.worktreeDir'],
  ['boardTrustedAuthors', 'board.trustedAuthors'],
  ['boardRelationships', 'board.relationships'],
  ['boardProjectTemplate', 'board.project.template'],
  ['boardProjectNumber', 'board.project.number'],
  ['roadmapIssue', 'roadmap.issue'],
  ['claimsStaleAfter', 'claims.staleAfter'],
  ['claimsAhead', 'claims.ahead'],
  ['cleanupStaleDays', 'cleanup.staleDays'],
  ['cleanupWorktreeIdleDays', 'cleanup.worktreeIdleDays'],
  ['cleanupKeep', 'cleanup.keep'],
  ['dangerousAcceptStaleRefs', 'dangerous.acceptStaleRefs'],
  ['dangerousSelfUpdateDuringLoop', 'dangerous.selfUpdateDuringLoop'],
  ['statusNotice', 'status.notice'],
  ['tiersRafa', 'tiers.rafa'],
  ['tiersSkills', 'tiers.skills'],
  ['tiersAgents', 'tiers.agents'],
  ['routing', 'routing'],
  ['taskSkills', 'task.skills'],
  ['taskLessons', 'task.lessons'],
  ['mergeDuplicates', 'merge.duplicates'],
  ['namingBranch', 'naming.branch'],
];

/** The settings a flag may name, each of them core's. */
const COMMAND_LINE: readonly string[] = [
  'store',
  'inject',
  'planDir',
  'specsDir',
  'trackerDefault',
  'learningAdapter',
  'outputMode',
  'settingSources',
  'taskSkills',
];

/** Every default but the three maps, spelled. */
const DEFAULTS: Readonly<Record<string, unknown>> = {
  version: 1,
  store: 'sqlite',
  effortBusyTimeoutMs: 5000,
  effortSync: 'local',
  inject: 'stage',
  planDir: join('.rafa', 'plans'),
  specsDir: join('.rafa', 'specs'),
  trackerDefault: 'github',
  trackerFallback: ['local'],
  learningAdapter: 'local',
  learningBlessMinConfidence: 0.5,
  learningPromoteAfter: 3,
  learningPromoteMinConfidence: 0.7,
  outputMode: 'text',
  prerequisitesRequired: [],
  prerequisitesOptional: [],
  trackingSpecs: false,
  trackingPlans: false,
  trackingAll: false,
  modules: [],
  allowList: [],
  settingSources: ['project', 'local'],
  loopWorktreeDir: join('.rafa', 'worktrees'),
  boardTrustedAuthors: [],
  boardRelationships: 'labels',
  boardProjectTemplate: 'https://github.com/orgs/open-tomato/projects/6',
  boardProjectNumber: null,
  roadmapIssue: null,
  claimsStaleAfter: '3d',
  claimsAhead: 'off',
  cleanupStaleDays: 30,
  cleanupWorktreeIdleDays: 7,
  cleanupKeep: [],
  dangerousAcceptStaleRefs: false,
  dangerousSelfUpdateDuringLoop: false,
  statusNotice: true,
  tiersRafa: 'on',
  taskSkills: 'planner',
  taskLessons: 'on',
  mergeDuplicates: 'warn',
  namingBranch: 'feat/{stub}',
};

/** The three map settings, whose defaults are compared by identity or by entries. */
const MAP_SETTINGS = ['tiersSkills', 'tiersAgents', 'routing'];

/**
 * The fields of the `RafaConfig` interface declared in `config-schema.ts`
 * itself, in source order: the declaration in that file alone, not the
 * interface a section file merges into.
 *
 * @returns The property names, in the order written.
 * @throws When the file declares no `RafaConfig` interface.
 */
function declaredFields(): string[] {
  const source = ts.createSourceFile(SCHEMA_FILE, readFileSync(SCHEMA_FILE, 'utf8'), ts.ScriptTarget.Latest, true);
  const declaration = source.statements.find(
    (statement): statement is ts.InterfaceDeclaration => ts.isInterfaceDeclaration(statement)
      && statement.name.text === 'RafaConfig',
  );
  if (declaration === undefined) throw new Error(`no RafaConfig interface in ${SCHEMA_FILE}`);
  return declaration.members
    .filter(ts.isPropertySignature)
    .map((member) => member.name.getText(source));
}

describe('CORE_SECTION', () => {
  it('is registered under the package core, with no check', () => {
    expect(CORE_SECTION.package).toBe('core');
    expect(CORE_SECTION.checks).toBeUndefined();
  });

  it('spells one dotted file key per setting, in order', () => {
    const spelled = Object.entries(CORE_SECTION.settings).map(([setting, spec]) => [setting, spec.key]);

    expect(spelled).toEqual(KEYS.map((pair) => [...pair]));
  });

  it('defines exactly the fields config-schema.ts declares on RafaConfig', () => {
    const fields = declaredFields();

    expect(fields).toContain('store');
    expect(fields).not.toContain('hubUrl');
    expect(fields).toEqual(KEYS.map(([setting]) => setting));
    expect(Object.keys(CORE_SECTION.settings)).toEqual(fields);
  });

  it('gives a default for every setting it defines and for no other', () => {
    expect(Object.keys(CORE_SECTION.defaults).sort()).toEqual(Object.keys(CORE_SECTION.settings).sort());
  });

  it('marks the settings a flag may name and no other', () => {
    const named = Object.entries(CORE_SECTION.settings)
      .filter(([, spec]) => spec.cli)
      .map(([setting]) => setting);

    expect(named).toEqual([...COMMAND_LINE]);
  });

  it('carries item keys for its lists of mappings and for nothing else', () => {
    const withItems = Object.entries(CORE_SECTION.settings)
      .filter(([, spec]) => spec.itemKeys !== undefined)
      .map(([setting, spec]) => [setting, spec.itemKeys]);

    expect(withItems).toEqual([
      ['prerequisitesRequired', ['tool', 'env', 'service', 'lsp', 'probe']],
      ['prerequisitesOptional', ['tool', 'env', 'service', 'lsp', 'probe', 'reason']],
      ['modules', ['npm', 'github', 'path', 'ref']],
    ]);
  });
});

describe('the defaults of core', () => {
  it('spells every default other than the maps', () => {
    const values: Record<string, unknown> = Object.fromEntries(
      Object.entries(CORE_SECTION.defaults).filter(([setting]) => !MAP_SETTINGS.includes(setting)),
    );

    expect(values).toEqual({ ...DEFAULTS });
  });

  it('holds the routing table rafa ships and two empty tier maps', () => {
    expect(CORE_SECTION.defaults.routing).toBe(DEFAULT_ROUTING);
    expect([...CORE_SECTION.defaults.tiersSkills]).toEqual([]);
    expect([...CORE_SECTION.defaults.tiersAgents]).toEqual([]);
  });

  it('is frozen, with the section, its settings record and every list default', () => {
    const lists = Object.values(CORE_SECTION.defaults).filter((value) => Array.isArray(value));

    expect(lists.length).toBe(8);
    expect(lists.every((list) => Object.isFrozen(list))).toBe(true);
    expect(Object.isFrozen(CORE_SECTION.defaults)).toBe(true);
    expect(Object.isFrozen(CORE_SECTION.settings)).toBe(true);
    expect(Object.isFrozen(CORE_SECTION)).toBe(true);
  });
});

describe('CONFIG_FILE', () => {
  it('is .rafa/config.yaml, joined', () => {
    expect(CONFIG_FILE).toBe(join('.rafa', 'config.yaml'));
  });
});

describe('core through the section contract', () => {
  it('merges alone, every setting paired with its default', () => {
    const merged = mergeConfigSections(EMPTY_CONFIG_REGISTRY, [CORE_SECTION]);

    expect(Object.keys(merged.settings)).toEqual(KEYS.map(([setting]) => setting));
    expect(merged.settings.store).toBe(CORE_SECTION.settings.store);
    expect(merged.defaults.store).toBe('sqlite');
    expect(merged.checks).toEqual([]);
  });

  it('refuses a second section defining one of its consents, naming core and the other package', () => {
    const refusal = (): unknown => mergeConfigSections(EMPTY_CONFIG_REGISTRY, [
      CORE_SECTION,
      {
        package: 'intruder',
        settings: { dangerousAcceptStaleRefs: CORE_SECTION.settings.dangerousAcceptStaleRefs },
        defaults: { dangerousAcceptStaleRefs: true },
      },
    ]);

    expect(refusal).toThrow(ConfigSectionError);
    expect(refusal).toThrow(
      'dangerous.acceptStaleRefs is defined by package "core" and again by package "intruder"',
    );
  });
});

describe('merge.duplicates', () => {
  const spec = CORE_SECTION.settings.mergeDuplicates;
  const at = { label: spec.key, key: spec.key };

  it.each(['warn', 'error', 'allow'])('accepts %s as itself', (level) => {
    expect(spec.read(level, at)).toEqual({ value: level, problems: [], extras: [] });
  });

  it('refuses a level outside the three, naming them', () => {
    const reading = spec.read('fail', at);
    expect(reading.value).toBeUndefined();
    expect(reading.problems).toEqual(['merge.duplicates is "fail", expected one of: warn, error, allow']);
  });

  it('defaults to warn', () => {
    expect(CORE_SECTION.defaults.mergeDuplicates).toBe('warn');
  });
});

describe('naming.branch', () => {
  const spec = CORE_SECTION.settings.namingBranch;
  const at = { label: spec.key, key: spec.key };

  it('accepts a template holding {stub} once', () => {
    expect(spec.read('work/{stub}', at)).toEqual({ value: 'work/{stub}', problems: [], extras: [] });
  });

  it('refuses a template without {stub}, naming the rule', () => {
    const reading = spec.read('work/main', at);
    expect(reading.value).toBeUndefined();
    expect(reading.problems).toEqual([
      'naming.branch is "work/main", expected a branch name template holding {stub} exactly once',
    ]);
  });

  it('defaults to feat/{stub}, and takes no flag', () => {
    expect(CORE_SECTION.defaults.namingBranch).toBe('feat/{stub}');
    expect(spec.cli).toBe(false);
  });
});
