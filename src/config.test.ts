/**
 * Tests for the config reader: the phase 1 schema, its layers and its
 * refusals.
 *
 * The rules are tested where they live. `parseConfigText` and
 * `resolveConfig` are pure, so every precedence and refusal case here
 * runs without a disk. Reading the files, from a project root and a
 * home, is `config-load.ts`, driven in `config-load.test.ts`. The value
 * readers are driven one by one in `config-sections.test.ts`; here each
 * section is reached through a file's text. The schema itself — the
 * dotted file key per setting, the sections a file may open, and the
 * known-key index — is `config-schema.ts`, driven in
 * `config-schema.test.ts`; here it is reached through `config.js`,
 * which re-exports every name a caller reads.
 *
 * Every precedence case plants values that DIFFER from the defaults in
 * each layer it names, which is what lets it fail: a resolver that
 * skipped the file would answer the defaults, never the file's values.
 * {@link FULL} names every setting at a value other than its default,
 * and a case holds it to that. The one case where a layer spells the
 * default is there to pin the source record, which is the only thing
 * that can tell a file that was read from one that was skipped.
 *
 * The settings, the defaults and the known keys a warning lists are
 * spelled here, never read off the module, so a module that drops a
 * setting or moves a default fails rather than agreeing with itself.
 * Files are planted at the LITERAL `.rafa/config.yaml` for the same
 * reason.
 *
 * Three cases are CHARACTERIZATIONS of bun rather than guards of this
 * module, and are named as such: a tab-indented child parsing as a
 * top-level key, `Bun.file().exists()` answering false for a directory,
 * and `yes` parsing as a string where `TRUE` parses as the boolean.
 * Each pins a measured claim the module note makes, so a bun upgrade
 * that changes one fails here and says which sentence went stale.
 *
 * Fifty module mutations were driven against this file and
 * `config-sections.test.ts` together, each an exact string found once,
 * with both modules restored sha256-identical after it and the two
 * files green either side, and on the last pass every one reddened at
 * least one case. Twenty-five were aimed at this module: the file over
 * the command line; three defaults moved; a default list unfrozen and
 * the defaults unfrozen; `outputMode` taken off the command line, and
 * every override read; a section that is no mapping skipped; the known
 * keys always the top level's; an item index not collapsed; item extras
 * dropped, and put before the document's; reader problems dropped;
 * tracker kinds closed; version 2 accepted; `loop.settingSources`
 * misspelt; a null read as a value; no section descended into; the
 * given-twice check dropped; warnings never printed; the command line
 * judged before the file; its label spelling the file key; the known
 * keys not deduplicated; and command-line problems ignored.
 *
 * Two of those, warnings never printed and the command line judged
 * before the file, were mutations of `loadConfig`, which has since
 * moved to `config-load.ts` with the cases that caught them.
 */
import type {
  ConfigLayer,
  ConfigOverrides,
  ConfigSetting,
  ConfigSource,
  RafaConfig,
  RouteTarget,
  TierPin,
} from './config.js';

import { join } from 'node:path';

import { describe, expect, it } from 'bun:test';

import {
  CONFIG_DEFAULTS,
  CONFIG_FILE,
  ConfigError,
  configFilePath,
  parseConfigText,
  resolveConfig,
} from './config.js';

/** The label every pure case parses under. No file is read at it. */
const PATH = '/repo/.rafa/config.yaml';

/** The label a user scope file parses under. No file is read at it. */
const USER_PATH = '/home/someone/.rafa/config.yaml';

/** The known-keys tail of a warning about a top-level unknown key. */
const KNOWN = '(known keys: version, store, plan, specs, tracker, learning, '
  + 'output, prerequisites, tracking, modules, allowList, loop, pr, board, '
  + 'roadmap, release, cleanup, dangerous, status, tiers, routing, task)';

/** Every setting, in the order a layer holds them. */
const SETTINGS: readonly ConfigSetting[] = [
  'version',
  'store',
  'inject',
  'planDir',
  'specsDir',
  'trackerDefault',
  'trackerFallback',
  'learningAdapter',
  'learningBlessMinConfidence',
  'learningPromoteAfter',
  'learningPromoteMinConfidence',
  'outputMode',
  'prerequisitesRequired',
  'prerequisitesOptional',
  'trackingSpecs',
  'trackingPlans',
  'trackingAll',
  'modules',
  'allowList',
  'settingSources',
  'prProvider',
  'prMergeMethod',
  'prBase',
  'prResolveBudget',
  'boardTrustedAuthors',
  'roadmapIssue',
  'releaseEnabled',
  'releaseVersionFile',
  'releaseChangelog',
  'releaseHeading',
  'cleanupStaleDays',
  'cleanupWorktreeIdleDays',
  'cleanupKeep',
  'dangerousAcceptStaleRefs',
  'statusNotice',
  'tiersRafa',
  'tiersSkills',
  'tiersAgents',
  'routing',
  'taskSkills',
  'taskLessons',
];

/** The block under "Config schema" in the phase 1 spec, as defaults. */
const DEFAULTS: RafaConfig = {
  version: 1,
  store: 'sqlite',
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
  prProvider: null,
  prMergeMethod: 'squash',
  prBase: null,
  prResolveBudget: 2,
  boardTrustedAuthors: [],
  roadmapIssue: null,
  releaseEnabled: 'auto',
  releaseVersionFile: 'package.json',
  releaseChangelog: 'CHANGELOG.md',
  releaseHeading: '## {version} — {date}, {title}',
  cleanupStaleDays: 30,
  cleanupWorktreeIdleDays: 7,
  cleanupKeep: [],
  dangerousAcceptStaleRefs: false,
  statusNotice: true,
  tiersRafa: 'on',
  tiersSkills: new Map(),
  tiersAgents: new Map(),
  routing: new Map([
    ['prose', 'doc-updater'],
    ['tests', 'tdd-guide'],
    ['repair', 'build-error-resolver'],
    ['review', 'code-reviewer'],
    ['implementation', 'loop-implementer'],
  ]),
  taskSkills: 'planner',
  taskLessons: 'on',
};

/** A file naming every setting, each at a value other than its default. */
const FULL = [
  'version: 1',
  'store: ndjson',
  'plan:',
  '  inject: full',
  '  dir: .plans',
  'specs:',
  '  dir: .specs',
  'tracker:',
  '  default: linear',
  '  fallback: [local, github]',
  'learning:',
  '  adapter: remote',
  '  bless:',
  '    minConfidence: 0.6',
  '  promote:',
  '    after: 4',
  '    minConfidence: 0.8',
  'output:',
  '  mode: json',
  'prerequisites:',
  '  required:',
  '    - tool: bun',
  '      probe: bun --version',
  '    - env: GITHUB_TOKEN',
  '  optional:',
  '    - tool: mgrep',
  '      probe: mgrep --version',
  '      reason: "faster search; grep is the fallback"',
  '    - lsp: typescript',
  'tracking:',
  '  specs: true',
  '  plans: true',
  '  all: true',
  'modules:',
  '  - path: ../my-output',
  '  - github: someone/rafa-obsidian',
  '    ref: v0.3.0',
  'allowList: [my-output]',
  'loop:',
  '  settingSources: user, project',
  'pr:',
  '  provider: none',
  '  mergeMethod: rebase',
  '  base: trunk',
  '  resolveBudget: 0.5',
  'board:',
  '  trustedAuthors: ["dependabot[bot]"]',
  'roadmap:',
  '  issue: 31',
  'release:',
  '  enabled: false',
  '  versionFile: deno.json',
  '  changelog: docs/CHANGES.md',
  '  heading: "### {version} on {date}"',
  'cleanup:',
  '  staleDays: 60',
  '  worktreeIdleDays: 14',
  '  keep: ["release/*", keep-me]',
  'dangerous:',
  '  acceptStaleRefs: true',
  'status:',
  '  notice: false',
  'tiers:',
  '  rafa: off',
  '  skills: { react-query: false, documentation: project }',
  '  agents: { tdd-guide: user }',
  'routing: { cleanup: refactor-cleaner, review: false }',
  'task:',
  '  skills: tag',
  '  lessons: off',
  '',
].join('\n');

/** What {@link FULL} reads as. `version` is the one at its default. */
const FULL_VALUES: RafaConfig = {
  version: 1,
  store: 'ndjson',
  inject: 'full',
  planDir: '.plans',
  specsDir: '.specs',
  trackerDefault: 'linear',
  trackerFallback: ['local', 'github'],
  learningAdapter: 'remote',
  learningBlessMinConfidence: 0.6,
  learningPromoteAfter: 4,
  learningPromoteMinConfidence: 0.8,
  outputMode: 'json',
  prerequisitesRequired: [
    { kind: 'tool', name: 'bun', probe: 'bun --version' },
    { kind: 'env', name: 'GITHUB_TOKEN', probe: null },
  ],
  prerequisitesOptional: [
    {
      kind: 'tool',
      name: 'mgrep',
      probe: 'mgrep --version',
      reason: 'faster search; grep is the fallback',
    },
    { kind: 'lsp', name: 'typescript', probe: null, reason: null },
  ],
  trackingSpecs: true,
  trackingPlans: true,
  trackingAll: true,
  modules: [
    { kind: 'path', location: '../my-output', ref: null },
    { kind: 'github', location: 'someone/rafa-obsidian', ref: 'v0.3.0' },
  ],
  allowList: ['my-output'],
  settingSources: ['user', 'project'],
  prProvider: 'none',
  prMergeMethod: 'rebase',
  prBase: 'trunk',
  prResolveBudget: 0.5,
  boardTrustedAuthors: ['dependabot[bot]'],
  roadmapIssue: 31,
  releaseEnabled: false,
  releaseVersionFile: 'deno.json',
  releaseChangelog: 'docs/CHANGES.md',
  releaseHeading: '### {version} on {date}',
  cleanupStaleDays: 60,
  cleanupWorktreeIdleDays: 14,
  cleanupKeep: ['release/*', 'keep-me'],
  dangerousAcceptStaleRefs: true,
  statusNotice: false,
  tiersRafa: 'off',
  tiersSkills: new Map<string, TierPin>([['react-query', false], ['documentation', 'project']]),
  tiersAgents: new Map([['tdd-guide', 'user']]),
  routing: new Map<string, RouteTarget>([['cleanup', 'refactor-cleaner'], ['review', false]]),
  taskSkills: 'tag',
  taskLessons: 'off',
};

/**
 * What {@link FULL} resolves to: maps merge by key over the defaults, so
 * the file's `false` shadows the default review row rather than dropping it.
 */
const FULL_RESOLVED: RafaConfig = {
  ...FULL_VALUES,
  routing: new Map<string, RouteTarget>([
    ...DEFAULTS.routing,
    ['cleanup', 'refactor-cleaner'],
    ['review', false],
  ]),
};

/** Parses `text` as a file labelled `path`, {@link PATH} unless named. */
function fileOf(text: string, path = PATH) {
  return parseConfigText(text, path);
}

/** The {@link ConfigError} `run` throws. Fails when it throws none. */
function refusal(run: () => unknown): ConfigError {
  try {
    run();
  } catch (error) {
    if (error instanceof ConfigError) return error;
    throw error;
  }
  throw new Error('expected a ConfigError, and nothing was thrown');
}

/** Every setting answered by `rest`, except those `named` answers. */
function sourcesWith(
  named: Partial<Record<ConfigSetting, ConfigSource>>,
  rest: ConfigSource = 'default',
): Record<ConfigSetting, ConfigSource> {
  const all = Object.fromEntries(SETTINGS.map((setting) => [setting, rest]));
  return { ...all, ...named } as Record<ConfigSetting, ConfigSource>;
}

/** Holds a layer to saying nothing, with every setting still present. */
function expectSilent(values: ConfigLayer): void {
  expect(Object.keys(values)).toEqual([...SETTINGS]);
  expect(Object.values(values).filter((value) => value !== undefined)).toEqual([]);
}

describe('CONFIG_FILE', () => {
  it('is .rafa/config.yaml, joined under the root it is given', () => {
    expect(CONFIG_FILE).toBe(join('.rafa', 'config.yaml'));
    expect(configFilePath('/r')).toBe(join('/r', '.rafa', 'config.yaml'));
  });
});

describe('CONFIG_DEFAULTS', () => {
  it('are the spec block defaults, with both prerequisite tiers empty', () => {
    expect(Object.keys(CONFIG_DEFAULTS)).toEqual([...SETTINGS]);
    expect(CONFIG_DEFAULTS).toEqual(DEFAULTS);
  });

  it('are frozen, every list in them included, so no caller can move them for the next', () => {
    const lists = SETTINGS.map((setting) => CONFIG_DEFAULTS[setting])
      .filter((value) => Array.isArray(value));

    expect(Object.isFrozen(CONFIG_DEFAULTS)).toBe(true);
    expect(lists).toHaveLength(8);
    expect(lists.filter((list) => !Object.isFrozen(list))).toEqual([]);
  });
});

describe('parseConfigText', () => {
  it('reads every setting from a file naming each', () => {
    const file = fileOf(FULL);

    expect(file.values).toEqual(FULL_VALUES);
    expect(file.extras).toEqual([]);
    expect(file.path).toBe(PATH);
  });

  it('names every setting but version at a value other than its default', () => {
    const atDefault = SETTINGS.filter(
      (setting) => Bun.deepEquals(FULL_VALUES[setting], CONFIG_DEFAULTS[setting]),
    );

    expect(atDefault).toEqual(['version']);
  });

  it.each([
    ['plan.inject', 'plan.inject: task\n', 'inject', 'task'],
    ['tracker.default', 'tracker.default: linear\n', 'trackerDefault', 'linear'],
    ['loop.settingSources', 'loop.settingSources: local\n', 'settingSources', ['local']],
  ] as [string, string, ConfigSetting, unknown][])(
    'reads %s written flat as the same setting',
    (_label, text, setting, expected) => {
      expect<unknown>(fileOf(text).values[setting]).toEqual(expected);
    },
  );

  it.each([
    ['an empty file', ''],
    ['a whitespace-only file', '  \n\n'],
    ['a comment-only file', '# store: ndjson\n'],
    ['a bare document marker', '---\n'],
  ])('reads %s as a file that says nothing', (_label, text) => {
    const file = fileOf(text);

    expectSilent(file.values);
    expect(file.extras).toEqual([]);
  });

  it('reads a null value or section as silence rather than as a problem', () => {
    const text = [
      'store:',
      'plan:',
      '  # inject: full',
      'tracker:',
      '  fallback:',
      'prerequisites:',
      '  required:',
      'loop:',
      '',
    ].join('\n');
    const file = fileOf(text);

    expectSilent(file.values);
    expect(file.extras).toEqual([]);
  });

  it('retains an unknown key at the top, under a section and in an item, with its value', () => {
    const text = [
      'store: sqlite',
      'nonesuch:',
      '  kind: linear',
      'plan:',
      '  inject: stage',
      '  depth: 3',
      'tracker:',
      '  kind: linear',
      'prerequisites:',
      '  required:',
      '    - tool: bun',
      '      timeout: 30',
      '',
    ].join('\n');
    const file = fileOf(text);

    expect(file.values.store).toBe('sqlite');
    expect(file.values.inject).toBe('stage');
    expect(file.values.prerequisitesRequired).toEqual([{ kind: 'tool', name: 'bun', probe: null }]);
    expect(file.extras).toEqual([
      { key: 'nonesuch', value: { kind: 'linear' } },
      { key: 'plan.depth', value: 3 },
      { key: 'tracker.kind', value: 'linear' },
      { key: 'prerequisites.required[0].timeout', value: 30 },
    ]);
  });

  it('treats a key named like an Object.prototype member as unknown', () => {
    const text = [
      'constructor: a',
      'toString: b',
      '__proto__: c',
      'plan:',
      '  hasOwnProperty: d',
      'tracker:',
      '  valueOf: e',
      '',
    ].join('\n');
    const file = fileOf(text);

    expectSilent(file.values);
    expect(file.extras.map((extra) => extra.key)).toEqual([
      'constructor',
      'toString',
      '__proto__',
      'plan.hasOwnProperty',
      'tracker.valueOf',
    ]);
  });

  it('characterizes a tab-indented child as a top-level key', () => {
    const file = fileOf('plan:\n\tinject: full\n');

    expect(file.values.inject).toBeUndefined();
    expect(file.extras).toEqual([{ key: 'inject', value: 'full' }]);
  });

  it('characterizes yes as a string and TRUE as the boolean, so yes is refused', () => {
    expect(Bun.YAML.parse('a: yes')).toEqual({ a: 'yes' });
    expect(fileOf('tracking:\n  specs: TRUE\n').values.trackingSpecs).toBe(true);
    expect(refusal(() => fileOf('tracking:\n  specs: yes\n')).problems).toEqual([
      `${PATH}: tracking.specs is "yes", expected true or false`,
    ]);
  });

  it('refuses malformed YAML, naming the file and keeping the cause', () => {
    const error = refusal(() => fileOf('store: [unclosed\n'));

    expect(error.problems).toHaveLength(1);
    expect(error.problems[0]).toStartWith(`${PATH}: not valid YAML (`);
    expect(error.cause).toBeInstanceOf(SyntaxError);
    expect(error.message).toStartWith('rafa config: ');
  });

  it.each([
    ['a list', '- store\n- ndjson\n', 'a list'],
    ['a scalar', 'sqlite\n', '"sqlite"'],
    ['a multi-document stream', 'store: ndjson\n---\nstore: sqlite\n', 'a list'],
  ])('refuses %s at the top level', (_label, text, found) => {
    expect(refusal(() => fileOf(text)).problems).toEqual([
      `${PATH}: expected a mapping at the top level, found ${found}`,
    ]);
  });

  it('refuses every value a setting does not accept, in one error', () => {
    const text = 'store: postgres\nplan:\n  inject: everything\ntracking:\n  all: 1\n';

    expect(refusal(() => fileOf(text)).problems).toEqual([
      `${PATH}: store is "postgres", expected one of: sqlite, ndjson`,
      `${PATH}: plan.inject is "everything", expected one of: full, stage, task`,
      `${PATH}: tracking.all is 1, expected true or false`,
    ]);
  });

  describe('each section, refused by name beside an accepting control', () => {
    const cases: readonly [string, string, string, string, ConfigSetting, unknown][] = [
      ['version', 'version: 2', 'version is 2, expected one of: 1', 'version: 1', 'version', 1],
      [
        'store', 'store: postgres', 'store is "postgres", expected one of: sqlite, ndjson',
        'store: ndjson', 'store', 'ndjson',
      ],
      [
        'plan.inject', 'plan:\n  inject: all',
        'plan.inject is "all", expected one of: full, stage, task',
        'plan:\n  inject: task', 'inject', 'task',
      ],
      [
        'plan.dir', 'plan:\n  dir: ""', 'plan.dir is "", expected a directory path',
        'plan:\n  dir: .plans', 'planDir', '.plans',
      ],
      [
        'specs.dir', 'specs:\n  dir: 3', 'specs.dir is 3, expected a directory path',
        'specs:\n  dir: .specs', 'specsDir', '.specs',
      ],
      [
        'tracker.default', 'tracker:\n  default: [linear]',
        'tracker.default is a list, expected a tracker kind name',
        'tracker:\n  default: linear', 'trackerDefault', 'linear',
      ],
      [
        'tracker.fallback', 'tracker:\n  fallback: local',
        'tracker.fallback is "local", expected a list of tracker kind names',
        'tracker:\n  fallback: [github, obsidian]', 'trackerFallback', ['github', 'obsidian'],
      ],
      [
        'learning.adapter', 'learning:\n  adapter: "  "',
        'learning.adapter is "  ", expected a learning adapter name',
        'learning:\n  adapter: remote', 'learningAdapter', 'remote',
      ],
      [
        'learning.bless.minConfidence', 'learning:\n  bless:\n    minConfidence: 0.95',
        'learning.bless.minConfidence is 0.95, expected a confidence from 0.3 to 0.9',
        'learning:\n  bless:\n    minConfidence: 0.6', 'learningBlessMinConfidence', 0.6,
      ],
      [
        'learning.promote.after', 'learning:\n  promote:\n    after: 0',
        'learning.promote.after is 0, expected a count, a whole number of 1 or more',
        'learning:\n  promote:\n    after: 5', 'learningPromoteAfter', 5,
      ],
      [
        'learning.promote.minConfidence', 'learning:\n  promote:\n    minConfidence: 0.2',
        'learning.promote.minConfidence is 0.2, expected a confidence from 0.3 to 0.9',
        'learning:\n  promote:\n    minConfidence: 0.8', 'learningPromoteMinConfidence', 0.8,
      ],
      [
        'output.mode', 'output:\n  mode: tui', 'output.mode is "tui", expected one of: text, json',
        'output:\n  mode: json', 'outputMode', 'json',
      ],
      [
        'prerequisites.required', 'prerequisites:\n  required:\n    - tool: bun\n      env: X',
        'prerequisites.required[0] names tool and env, expected exactly one of: tool, env, service, lsp',
        'prerequisites:\n  required:\n    - env: X', 'prerequisitesRequired',
        [{ kind: 'env', name: 'X', probe: null }],
      ],
      [
        'prerequisites.optional',
        'prerequisites:\n  optional:\n    - lsp: typescript\n      reason: 4',
        'prerequisites.optional[0].reason is 4, expected a non-empty string',
        'prerequisites:\n  optional:\n    - lsp: typescript\n      reason: types',
        'prerequisitesOptional', [{ kind: 'lsp', name: 'typescript', probe: null, reason: 'types' }],
      ],
      [
        'tracking.specs', 'tracking:\n  specs: "true"',
        'tracking.specs is "true", expected true or false',
        'tracking:\n  specs: true', 'trackingSpecs', true,
      ],
      [
        'tracking.plans', 'tracking:\n  plans: 1', 'tracking.plans is 1, expected true or false',
        'tracking:\n  plans: true', 'trackingPlans', true,
      ],
      [
        'tracking.all', 'tracking:\n  all: no', 'tracking.all is "no", expected true or false',
        'tracking:\n  all: true', 'trackingAll', true,
      ],
      [
        'modules', 'modules:\n  - {}', 'modules[0] names none of: npm, github, path',
        'modules:\n  - path: ../mine', 'modules', [{ kind: 'path', location: '../mine', ref: null }],
      ],
      [
        'allowList', 'allowList: mine', 'allowList is "mine", expected a list of module names',
        'allowList: [mine]', 'allowList', ['mine'],
      ],
      [
        'loop.settingSources', 'loop:\n  settingSources: project,project',
        'loop.settingSources is "project,project", '
          + 'expected a comma-separated subset of: user, project, local',
        'loop:\n  settingSources: user', 'settingSources', ['user'],
      ],
      [
        'pr.provider', 'pr:\n  provider: github',
        'pr.provider is "github", expected one of: gh, none',
        'pr:\n  provider: none', 'prProvider', 'none',
      ],
      [
        'pr.mergeMethod', 'pr:\n  mergeMethod: squash-merge',
        'pr.mergeMethod is "squash-merge", expected one of: squash, merge, rebase',
        'pr:\n  mergeMethod: merge', 'prMergeMethod', 'merge',
      ],
      [
        'pr.base', 'pr:\n  base: 7', 'pr.base is 7, expected a branch name',
        'pr:\n  base: develop', 'prBase', 'develop',
      ],
      [
        'pr.resolveBudget', 'pr:\n  resolveBudget: "2"',
        'pr.resolveBudget is "2", expected a number of US dollars above zero, '
          + 'at most six digits either side of the point',
        'pr:\n  resolveBudget: 1.25', 'prResolveBudget', 1.25,
      ],
      [
        'board.trustedAuthors', 'board:\n  trustedAuthors: [octo cat]',
        'board.trustedAuthors[0] is "octo cat", expected a GitHub login',
        'board:\n  trustedAuthors: [octocat]', 'boardTrustedAuthors', ['octocat'],
      ],
      [
        'roadmap.issue', 'roadmap:\n  issue: 0',
        'roadmap.issue is 0, expected an issue number, a whole number above zero',
        'roadmap:\n  issue: 31', 'roadmapIssue', 31,
      ],
      [
        'release.enabled', 'release:\n  enabled: on',
        'release.enabled is "on", expected true, false or auto',
        'release:\n  enabled: false', 'releaseEnabled', false,
      ],
      [
        'release.versionFile', 'release:\n  versionFile: []',
        'release.versionFile is a list, expected a file path',
        'release:\n  versionFile: deno.json', 'releaseVersionFile', 'deno.json',
      ],
      [
        'release.changelog', 'release:\n  changelog: ""',
        'release.changelog is "", expected a file path',
        'release:\n  changelog: docs/CHANGES.md', 'releaseChangelog', 'docs/CHANGES.md',
      ],
      [
        'release.heading', 'release:\n  heading: 2',
        'release.heading is 2, expected a changelog heading template',
        'release:\n  heading: "### {version}"', 'releaseHeading', '### {version}',
      ],
      [
        'cleanup.staleDays', 'cleanup:\n  staleDays: 0',
        'cleanup.staleDays is 0, expected a number of days, a whole number above zero',
        'cleanup:\n  staleDays: 90', 'cleanupStaleDays', 90,
      ],
      [
        'cleanup.worktreeIdleDays', 'cleanup:\n  worktreeIdleDays: "7"',
        'cleanup.worktreeIdleDays is "7", expected a number of days, a whole number above zero',
        'cleanup:\n  worktreeIdleDays: 3', 'cleanupWorktreeIdleDays', 3,
      ],
      [
        'cleanup.keep', 'cleanup:\n  keep: "release/*"',
        'cleanup.keep is "release/*", expected a list of glob patterns',
        'cleanup:\n  keep: ["hotfix/*"]', 'cleanupKeep', ['hotfix/*'],
      ],
      [
        'dangerous.acceptStaleRefs', 'dangerous:\n  acceptStaleRefs: yes',
        'dangerous.acceptStaleRefs is "yes", expected true or false',
        'dangerous:\n  acceptStaleRefs: true', 'dangerousAcceptStaleRefs', true,
      ],
      [
        'status.notice', 'status:\n  notice: no',
        'status.notice is "no", expected true or false',
        'status:\n  notice: false', 'statusNotice', false,
      ],
      [
        'tiers.rafa', 'tiers:\n  rafa: false',
        'tiers.rafa is false, expected one of: on, off',
        'tiers:\n  rafa: off', 'tiersRafa', 'off',
      ],
      [
        'tiers.skills', 'tiers:\n  skills: { react-query: true }',
        'tiers.skills.react-query is true, expected false or one of: project, rafa, user',
        'tiers:\n  skills: { react-query: false }', 'tiersSkills', new Map([['react-query', false]]),
      ],
      [
        'tiers.agents', 'tiers:\n  agents: [tdd-guide]',
        'tiers.agents is a list, expected a mapping of names to false or a tier',
        'tiers:\n  agents: { tdd-guide: rafa }', 'tiersAgents', new Map([['tdd-guide', 'rafa']]),
      ],
      [
        'routing', 'routing: { prose: true }',
        'routing.prose is true, expected false or an agent name',
        'routing: { prose: tdd-guide }', 'routing', new Map([['prose', 'tdd-guide']]),
      ],
      [
        'task.skills', 'task:\n  skills: Tag',
        'task.skills is "Tag", expected one of: planner, tag, none',
        'task:\n  skills: none', 'taskSkills', 'none',
      ],
      [
        'task.lessons', 'task:\n  lessons: false',
        'task.lessons is false, expected one of: on, off',
        'task:\n  lessons: off', 'taskLessons', 'off',
      ],
    ];

    it('covers every setting once', () => {
      expect(cases.map((row) => row[4])).toEqual([...SETTINGS]);
    });

    it.each(cases)('refuses an unusable %s', (_key, unusable, problem) => {
      expect(refusal(() => fileOf(`${unusable}\n`)).problems).toEqual([`${PATH}: ${problem}`]);
    });

    // The file layer holds undefined for a key it did not read, so the
    // value alone tells a read key from a skipped one, version's 1
    // (its default, and the one value it accepts) included.
    it.each(cases)('accepts a usable %s into the file layer', (_k, _u, _p, usable, setting, expected) => {
      expect<unknown>(fileOf(`${usable}\n`).values[setting]).toEqual(expected);
    });
  });

  it.each([
    ['a different case', 'SQLite', '"SQLite"'],
    ['a number', '3', '3'],
    ['a boolean', 'true', 'true'],
    ['a list', '[sqlite]', 'a list'],
    ['a mapping', '{ backend: sqlite }', 'a mapping'],
  ])('refuses a store given as %s', (_label, value, found) => {
    expect(refusal(() => fileOf(`store: ${value}\n`)).problems).toEqual([
      `${PATH}: store is ${found}, expected one of: sqlite, ndjson`,
    ]);
  });

  it.each([
    'plan',
    'specs',
    'tracker',
    'learning',
    'output',
    'prerequisites',
    'tracking',
    'loop',
  ])('refuses a %s section that is not a mapping', (section) => {
    expect(refusal(() => fileOf(`${section}: linear\n`)).problems).toEqual([
      `${PATH}: ${section} must be a mapping, found "linear"`,
    ]);
  });

  it('retains a tiers map name spelled flat as an unknown key, not as a pin', () => {
    const file = fileOf('tiers.skills.tdd-guide: false\n');

    expect(file.extras).toEqual([{ key: 'tiers.skills.tdd-guide', value: false }]);
    expect(file.values.tiersSkills).toBeUndefined();
    expect(fileOf('tiers:\n  skills:\n    tdd-guide: false\n').values.tiersSkills)
      .toEqual(new Map([['tdd-guide', false]]));
  });

  it('retains a routing shape spelled flat as an unknown key, not as a row', () => {
    const file = fileOf('routing.cleanup: refactor-cleaner\n');

    expect(file.extras).toEqual([{ key: 'routing.cleanup', value: 'refactor-cleaner' }]);
    expect(file.values.routing).toBeUndefined();
  });

  it.each([
    ['plan.inject', 'plan.inject: full\nplan:\n  inject: task\n'],
    ['loop.settingSources', 'loop.settingSources: user\nloop:\n  settingSources: local\n'],
  ])('refuses %s given both flat and nested', (key, text) => {
    expect(refusal(() => fileOf(text)).problems).toEqual([
      `${PATH}: ${key} is given more than once`,
    ]);
  });
});

describe('resolveConfig', () => {
  it('merges a file\'s routing rows by key over the five defaults', () => {
    const file = fileOf('routing: { cleanup: refactor-cleaner }\n');

    expect(resolveConfig({ file }).config.routing)
      .toEqual(new Map([...DEFAULTS.routing, ['cleanup', 'refactor-cleaner']]));
    expect(resolveConfig({ file: fileOf('store: sqlite\n') }).config.routing)
      .toEqual(DEFAULTS.routing);
  });

  it('answers the defaults when no layer names a setting', () => {
    expect(resolveConfig()).toEqual({
      config: DEFAULTS,
      sources: sourcesWith({}),
      path: null,
      userPath: null,
      extras: [],
      userExtras: [],
      warnings: [],
    });
  });

  it('lets the file outrank the default, for every setting', () => {
    const resolved = resolveConfig({ file: fileOf(FULL) });

    expect(resolved.config).toEqual(FULL_RESOLVED);
    expect(resolved.sources).toEqual(sourcesWith({}, 'file'));
    expect(resolved.path).toBe(PATH);
  });

  it('lets the user file outrank the default, for every setting', () => {
    const resolved = resolveConfig({ user: fileOf(FULL, USER_PATH) });

    expect(resolved.config).toEqual(FULL_RESOLVED);
    expect(resolved.sources).toEqual(sourcesWith({}, 'user'));
    expect([resolved.path, resolved.userPath]).toEqual([null, USER_PATH]);
  });

  it('lets the project file outrank the user file, setting by setting', () => {
    const user = fileOf(FULL, USER_PATH);
    const file = fileOf('plan:\n  inject: task\n  dir: project-plans\n');
    const resolved = resolveConfig({ file, user });

    expect(resolved.config).toEqual({ ...FULL_RESOLVED, inject: 'task', planDir: 'project-plans' });
    expect(resolved.sources).toEqual(sourcesWith({ inject: 'file', planDir: 'file' }, 'user'));
    expect([resolved.path, resolved.userPath]).toEqual([PATH, USER_PATH]);
  });

  it('lets the command line outrank both files', () => {
    const user = fileOf(FULL, USER_PATH);
    const file = fileOf('plan:\n  inject: task\n  dir: project-plans\n');
    const resolved = resolveConfig({ file, user, cli: { planDir: 'cli-plans' } });

    expect(resolved.config).toEqual({ ...FULL_RESOLVED, inject: 'task', planDir: 'cli-plans' });
    expect(resolved.sources).toEqual(sourcesWith({ inject: 'file', planDir: 'cli' }, 'user'));
  });

  it('warns about the user file unknown keys first, each naming its own file', () => {
    const user = fileOf('nonesuch: a\n', USER_PATH);
    const file = fileOf('plan:\n  depth: 3\n');
    const resolved = resolveConfig({ file, user });

    expect(resolved.warnings).toEqual([
      `rafa config: unknown key "nonesuch" in ${USER_PATH} has no effect in this version ${KNOWN}`,
      `rafa config: unknown key "plan.depth" in ${PATH} has no effect in this version `
        + '(known keys under plan: inject, dir)',
    ]);
    expect(resolved.userExtras).toEqual([{ key: 'nonesuch', value: 'a' }]);
    expect(resolved.extras).toEqual([{ key: 'plan.depth', value: 3 }]);
  });

  it('lets the command line outrank the file, for every setting it can name', () => {
    const cli: Required<ConfigOverrides> = {
      store: 'sqlite',
      inject: 'task',
      planDir: 'cli-plans',
      specsDir: 'cli-specs',
      trackerDefault: 'obsidian',
      learningAdapter: 'mirror',
      outputMode: 'text',
      settingSources: 'local',
      taskSkills: 'none',
    };
    const resolved = resolveConfig({ file: fileOf(FULL), cli });

    expect(resolved.config).toEqual({
      ...FULL_RESOLVED,
      store: 'sqlite',
      inject: 'task',
      planDir: 'cli-plans',
      specsDir: 'cli-specs',
      trackerDefault: 'obsidian',
      learningAdapter: 'mirror',
      outputMode: 'text',
      settingSources: ['local'],
      taskSkills: 'none',
    });
    expect(resolved.sources).toEqual(sourcesWith({
      store: 'cli',
      inject: 'cli',
      planDir: 'cli',
      specsDir: 'cli',
      trackerDefault: 'cli',
      learningAdapter: 'cli',
      outputMode: 'cli',
      settingSources: 'cli',
      taskSkills: 'cli',
    }, 'file'));
  });

  it('reads no command-line key naming a setting only the file spells', () => {
    const cli = { version: '2', modules: 'x', trackingAll: 'true', taskLessons: 'off' } as unknown as ConfigOverrides;
    const resolved = resolveConfig({ cli });

    expect(resolved.config).toEqual(DEFAULTS);
    expect(resolved.sources).toEqual(sourcesWith({}));
  });

  it('ranks each setting on its own', () => {
    const file = fileOf('store: ndjson\nplan:\n  inject: full\n');
    const resolved = resolveConfig({ file, cli: { inject: 'task' } });

    expect(resolved.config).toEqual({ ...DEFAULTS, store: 'ndjson', inject: 'task' });
    expect(resolved.sources).toEqual(sourcesWith({ store: 'file', inject: 'cli' }));
  });

  it('lets the command line outrank the default with no file', () => {
    const resolved = resolveConfig({ file: null, cli: { store: 'ndjson' } });

    expect(resolved.config).toEqual({ ...DEFAULTS, store: 'ndjson' });
    expect(resolved.sources).toEqual(sourcesWith({ store: 'cli' }));
  });

  it('records a file spelling the default as the layer that answered', () => {
    const fromFile = resolveConfig({ file: fileOf('store: sqlite\n') });
    const fromNothing = resolveConfig();

    expect(fromFile.config.store).toBe(fromNothing.config.store);
    expect(fromFile.sources.store).toBe('file');
    expect(fromNothing.sources.store).toBe('default');
  });

  it('treats an override of undefined as no flag given', () => {
    const file = fileOf('plan:\n  inject: full\n');
    const resolved = resolveConfig({ file, cli: { inject: undefined } });

    expect(resolved.config.inject).toBe('full');
    expect(resolved.sources.inject).toBe('file');
  });

  it.each([
    ['an empty value', { inject: '' }, 'inject is ""', 'one of: full, stage, task'],
    ['a misspelt mode', { inject: 'stag' }, 'inject is "stag"', 'one of: full, stage, task'],
    ['a misspelt backend', { store: 'sqllite' }, 'store is "sqllite"', 'one of: sqlite, ndjson'],
    ['an empty directory', { planDir: '' }, 'planDir is ""', 'a directory path'],
    ['an output mode', { outputMode: 'tui' }, 'outputMode is "tui"', 'one of: text, json'],
    ['an empty resolver', { taskSkills: '' }, 'taskSkills is ""', 'one of: planner, tag, none'],
    [
      'empty setting sources', { settingSources: '' }, 'settingSources is ""',
      'a comma-separated subset of: user, project, local',
    ],
  ] as [string, ConfigOverrides, string, string][])(
    'refuses %s on the command line',
    (_label, cli, said, expected) => {
      expect(refusal(() => resolveConfig({ cli })).problems).toEqual([
        `command line: ${said}, expected ${expected}`,
      ]);
    },
  );

  it('names every unusable command-line value at once', () => {
    const cli = { store: 'x', inject: 'y', settingSources: 'z' };

    expect(refusal(() => resolveConfig({ cli })).problems).toHaveLength(3);
  });

  it('never downgrades an unusable command-line value to the file', () => {
    const file = fileOf('plan:\n  inject: full\n');

    expect(() => resolveConfig({ file, cli: { inject: 'bogus' } }))
      .toThrow(ConfigError);
  });

  it('warns once per retained unknown key, listing the keys known where it sits', () => {
    const text = [
      'nonesuch: linear',
      'plan:',
      '  depth: 3',
      '  a.b: 4',
      'tracker:',
      '  kind: x',
      'prerequisites:',
      '  optional:',
      '    - env: A',
      '      timeout: 30',
      'modules:',
      '  - npm: pkg',
      '    ref: v1',
      '',
    ].join('\n');
    const file = fileOf(text);
    const resolved = resolveConfig({ file });
    const warning = (key: string, known: string): string => `rafa config: unknown key "${key}" `
      + `in ${PATH} has no effect in this version ${known}`;

    expect(resolved.warnings).toEqual([
      warning('nonesuch', KNOWN),
      warning('plan.depth', '(known keys under plan: inject, dir)'),
      warning('plan.a.b', '(known keys under plan: inject, dir)'),
      warning('tracker.kind', '(known keys under tracker: default, fallback)'),
      warning(
        'prerequisites.optional[0].timeout',
        '(known keys under prerequisites.optional[0]: tool, env, service, lsp, probe, reason)',
      ),
      warning('modules[0].ref', '(known keys under modules[0]: npm, github, path, ref)'),
    ]);
    expect(resolved.extras).toEqual(file.extras);
    expect(resolved.config).toEqual({
      ...DEFAULTS,
      prerequisitesOptional: [{ kind: 'env', name: 'A', probe: null, reason: null }],
      modules: [{ kind: 'npm', location: 'pkg', ref: null }],
    });
  });

  it('warns about nothing when the file holds only known keys', () => {
    expect(resolveConfig({ file: fileOf(FULL) }).warnings).toEqual([]);
  });

  it('answers fresh objects, so one result cannot leak into the next', () => {
    const first = resolveConfig();
    first.config.store = 'ndjson';

    expect(resolveConfig().config.store).toBe('sqlite');
  });

  it('answers frozen lists, from the defaults and from a file alike', () => {
    const fromDefaults = resolveConfig().config.trackerFallback as string[];
    const fromFile = resolveConfig({ file: fileOf(FULL) }).config.allowList as string[];

    expect(() => fromDefaults.push('x')).toThrow(TypeError);
    expect(() => fromFile.push('x')).toThrow(TypeError);
    expect(CONFIG_DEFAULTS.trackerFallback).toEqual(['local']);
  });
});
