/**
 * `loadConfig` driven over the whole phase 1 schema, through scratch
 * project and user-scope directories rather than the pure resolver.
 *
 * `config.test.ts` drives every setting's precedence and every section's
 * refusal through the pure `parseConfigText` and `resolveConfig`, with no
 * disk involved. `config-load.test.ts` pins the DISK WIRING — which
 * directory each file is read from, the judging order, a home that is the
 * root — through a handful of representative settings. This file sits
 * between the two: it exercises `loadConfig` itself, the disk and home
 * seam included, across every section of the schema at once.
 *
 * Two full config texts, `PROJECT_TEXT` and `USER_TEXT`, name every
 * setting at a value that differs from the other's — `version` is the
 * one exception, since `1` is its only accepted value. Loading them
 * together through `loadConfig` and reading `PROJECT_VALUES` back off
 * every setting, every source labelled `file`, is what shows the project
 * file outranks the user's key by key rather than by accident; the
 * paired control loads the user file alone, under the same home, and
 * reads `USER_VALUES` back, every source `user`. A third set of values,
 * given only on the command line, then outranks both files for the
 * settings a flag can name, leaving the rest to the project file.
 *
 * The unknown-key case nests one under a section — `tracker.kind` beside
 * a known `tracker.default` — and holds the loader to retaining it in
 * `extras` and warning about it exactly once, not zero times and not once
 * per key it sits beside.
 *
 * The refusal table pairs every section's unusable value with an
 * accepting control at the same key, run through `loadConfig` rather than
 * `parseConfigText`, so a refusal that only worked against the pure
 * parser and broke on the way through the disk-reading loader would be
 * caught here. The problem strings and the usable values are the same
 * ones `config.test.ts` proves the readers accept and refuse; what this
 * table adds is that `loadConfig` passes them through unchanged, prefixed
 * with the real path of the scratch project file it read.
 */
import type { ConfigRoots } from '../config-load.js';
import type {
  ConfigOverrides,
  ConfigSetting,
  ConfigSource,
  RafaConfig,
  RouteTarget,
  TierPin,
} from '../config.js';

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { loadConfig } from '../config-load.js';
import { CONFIG_DEFAULTS, ConfigError } from '../config.js';

const tempRoot = mkdtempSync(join(tmpdir(), 'rafa-config-layers-'));
let planted = 0;

afterAll(() => {
  rmSync(tempRoot, { recursive: true, force: true });
});

/** A fresh, empty directory under this file's temporary root. */
function freshDir(name: string): string {
  planted += 1;
  const dir = join(tempRoot, `${planted}-${name}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** The literal config path under a directory, spelled without the module. */
function literalPath(dir: string): string {
  return join(dir, '.rafa', 'config.yaml');
}

/** Plants `text` at `.rafa/config.yaml` under `dir`. */
function plant(dir: string, text: string): void {
  mkdirSync(join(dir, '.rafa'), { recursive: true });
  writeFileSync(literalPath(dir), text);
}

/** A fresh project root and home, side by side, each holding its text if given. */
function scopes(project: string | null, user: string | null): ConfigRoots {
  const root = freshDir('project');
  const home = freshDir('home');
  if (project !== null) plant(root, project);
  if (user !== null) plant(home, user);
  return { root, home };
}

/** A warning sink, and every line it was handed. */
function sink(): { lines: string[]; warn: (line: string) => void } {
  const lines: string[] = [];
  return { lines, warn: (line) => lines.push(line) };
}

/** A warning sink that keeps nothing. */
function quiet(): void {}

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

/** Every setting name, read off {@link CONFIG_DEFAULTS}; see the module note. */
const ALL_SETTINGS = Object.keys(CONFIG_DEFAULTS) as ConfigSetting[];

/** Every setting answered by `rest`, except those `named` answers. */
function sourcesWith(
  named: Partial<Record<ConfigSetting, ConfigSource>>,
  rest: ConfigSource = 'default',
): Record<ConfigSetting, ConfigSource> {
  const all = Object.fromEntries(ALL_SETTINGS.map((setting) => [setting, rest]));
  return { ...all, ...named } as Record<ConfigSetting, ConfigSource>;
}

/** A project file naming every setting at a value other than the user's. */
const PROJECT_TEXT = [
  'version: 1',
  'store: ndjson',
  'plan:',
  '  inject: full',
  '  dir: project-plans',
  'specs:',
  '  dir: project-specs',
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
  '  trustedAuthors: [octocat]',
  'roadmap:',
  '  issue: 31',
  'release:',
  '  enabled: true',
  '  versionFile: project.json',
  '  changelog: docs/PROJECT-CHANGES.md',
  '  heading: "### {version} on {date}"',
  'cleanup:',
  '  staleDays: 45',
  '  worktreeIdleDays: 10',
  '  keep: ["project/*"]',
  'dangerous:',
  '  acceptStaleRefs: true',
  'status:',
  '  notice: false',
  'tiers:',
  '  rafa: off',
  '  skills:',
  '    documentation: project',
  '    react-query: false',
  '  agents:',
  '    tdd-guide: rafa',
  'routing:',
  '  cleanup: refactor-cleaner',
  '  review: false',
  '',
].join('\n');

/** What {@link PROJECT_TEXT} reads as. */
const PROJECT_VALUES: RafaConfig = {
  version: 1,
  store: 'ndjson',
  inject: 'full',
  planDir: 'project-plans',
  specsDir: 'project-specs',
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
  boardTrustedAuthors: ['octocat'],
  roadmapIssue: 31,
  releaseEnabled: true,
  releaseVersionFile: 'project.json',
  releaseChangelog: 'docs/PROJECT-CHANGES.md',
  releaseHeading: '### {version} on {date}',
  cleanupStaleDays: 45,
  cleanupWorktreeIdleDays: 10,
  cleanupKeep: ['project/*'],
  dangerousAcceptStaleRefs: true,
  statusNotice: false,
  tiersRafa: 'off',
  tiersSkills: new Map<string, TierPin>([['documentation', 'project'], ['react-query', false]]),
  tiersAgents: new Map<string, TierPin>([['tdd-guide', 'rafa'], ['code-reviewer', false]]),
  routing: new Map<string, RouteTarget>([
    ...CONFIG_DEFAULTS.routing,
    ['cleanup', 'refactor-cleaner'],
    ['review', false],
  ]),
};

/** A user-scope file naming every setting at a value other than the project's. */
const USER_TEXT = [
  'version: 1',
  'store: sqlite',
  'plan:',
  '  inject: task',
  '  dir: user-plans',
  'specs:',
  '  dir: user-specs',
  'tracker:',
  '  default: obsidian',
  '  fallback: [github]',
  'learning:',
  '  adapter: mirror',
  '  bless:',
  '    minConfidence: 0.4',
  '  promote:',
  '    after: 2',
  '    minConfidence: 0.9',
  'output:',
  '  mode: text',
  'prerequisites:',
  '  required:',
  '    - service: https://example.com/health',
  '  optional:',
  '    - env: MGREP_TOKEN',
  '      reason: "optional speed-up"',
  'tracking:',
  '  specs: false',
  '  plans: false',
  '  all: false',
  'modules:',
  '  - npm: rafa-linear',
  'allowList: [rafa-linear, my-output]',
  'loop:',
  '  settingSources: project, local',
  'pr:',
  '  provider: gh',
  '  mergeMethod: merge',
  '  base: develop',
  '  resolveBudget: 3',
  'board:',
  '  trustedAuthors: ["dependabot[bot]", hubot]',
  'roadmap:',
  '  issue: 7',
  'release:',
  '  enabled: false',
  '  versionFile: user.json',
  '  changelog: docs/USER-CHANGES.md',
  '  heading: "## {version}, {title}"',
  'cleanup:',
  '  staleDays: 90',
  '  worktreeIdleDays: 2',
  '  keep: ["user/*", scratch]',
  'dangerous:',
  '  acceptStaleRefs: false',
  'status:',
  '  notice: true',
  'tiers:',
  '  rafa: on',
  '  skills: { documentation: user }',
  '  agents: { tdd-guide: user, code-reviewer: false }',
  'routing: { review: typescript-reviewer }',
  '',
].join('\n');

/** What {@link USER_TEXT} reads as. */
const USER_VALUES: RafaConfig = {
  version: 1,
  store: 'sqlite',
  inject: 'task',
  planDir: 'user-plans',
  specsDir: 'user-specs',
  trackerDefault: 'obsidian',
  trackerFallback: ['github'],
  learningAdapter: 'mirror',
  learningBlessMinConfidence: 0.4,
  learningPromoteAfter: 2,
  learningPromoteMinConfidence: 0.9,
  outputMode: 'text',
  prerequisitesRequired: [
    { kind: 'service', name: 'https://example.com/health', probe: null },
  ],
  prerequisitesOptional: [
    { kind: 'env', name: 'MGREP_TOKEN', probe: null, reason: 'optional speed-up' },
  ],
  trackingSpecs: false,
  trackingPlans: false,
  trackingAll: false,
  modules: [{ kind: 'npm', location: 'rafa-linear', ref: null }],
  allowList: ['rafa-linear', 'my-output'],
  settingSources: ['project', 'local'],
  prProvider: 'gh',
  prMergeMethod: 'merge',
  prBase: 'develop',
  prResolveBudget: 3,
  boardTrustedAuthors: ['dependabot[bot]', 'hubot'],
  roadmapIssue: 7,
  releaseEnabled: false,
  releaseVersionFile: 'user.json',
  releaseChangelog: 'docs/USER-CHANGES.md',
  releaseHeading: '## {version}, {title}',
  cleanupStaleDays: 90,
  cleanupWorktreeIdleDays: 2,
  cleanupKeep: ['user/*', 'scratch'],
  dangerousAcceptStaleRefs: false,
  statusNotice: true,
  tiersRafa: 'on',
  tiersSkills: new Map([['documentation', 'user']]),
  tiersAgents: new Map<string, TierPin>([['tdd-guide', 'user'], ['code-reviewer', false]]),
  routing: new Map([...CONFIG_DEFAULTS.routing, ['review', 'typescript-reviewer']]),
};

/** Command-line values, one per setting a flag can name, distinct from both files. */
const CLI_OVERRIDES: ConfigOverrides = {
  store: 'sqlite',
  inject: 'stage',
  planDir: 'cli-plans',
  specsDir: 'cli-specs',
  trackerDefault: 'cli-tracker',
  learningAdapter: 'cli-adapter',
  outputMode: 'text',
  settingSources: 'local',
};

describe('loadConfig across the whole schema', () => {
  it('lets the project file outrank the user file, setting by setting', () => {
    const roots = scopes(PROJECT_TEXT, USER_TEXT);
    const resolved = loadConfig(roots, {}, quiet);

    expect(resolved.config).toEqual(PROJECT_VALUES);
    expect(resolved.sources).toEqual(sourcesWith({}, 'file'));

    // The control: the same home with no project file to outrank it
    // answers the user's own values, so the project's above was a real
    // override and not an accident of the defaults.
    const userAlone = loadConfig({ root: freshDir('no-project'), home: roots.home }, {}, quiet);
    expect(userAlone.config).toEqual(USER_VALUES);
    expect(userAlone.sources).toEqual(sourcesWith({}, 'user'));
  });

  it('lets a command-line value outrank both files', () => {
    const roots = scopes(PROJECT_TEXT, USER_TEXT);
    const flagged = loadConfig(roots, CLI_OVERRIDES, quiet);

    expect(flagged.config).toEqual({
      ...PROJECT_VALUES,
      store: 'sqlite',
      inject: 'stage',
      planDir: 'cli-plans',
      specsDir: 'cli-specs',
      trackerDefault: 'cli-tracker',
      learningAdapter: 'cli-adapter',
      outputMode: 'text',
      settingSources: ['local'],
    });
    expect(flagged.sources).toEqual(sourcesWith({
      store: 'cli',
      inject: 'cli',
      planDir: 'cli',
      specsDir: 'cli',
      trackerDefault: 'cli',
      learningAdapter: 'cli',
      outputMode: 'cli',
      settingSources: 'cli',
    }, 'file'));

    // The control: the same roots with no flag answer the project's
    // values for every setting the flag named above.
    const unflagged = loadConfig(roots, {}, quiet);
    expect(unflagged.config).toEqual(PROJECT_VALUES);
    expect(unflagged.sources).toEqual(sourcesWith({}, 'file'));
  });
});

describe('an unknown key nested under a section', () => {
  it('is retained in extras, with exactly one warning naming it', () => {
    const roots = scopes('tracker:\n  default: linear\n  kind: legacy\n', null);
    const { lines, warn } = sink();
    const resolved = loadConfig(roots, {}, warn);

    expect(resolved.config.trackerDefault).toBe('linear');
    expect(resolved.extras).toEqual([{ key: 'tracker.kind', value: 'legacy' }]);
    expect(lines).toEqual([
      `rafa config: unknown key "tracker.kind" in ${literalPath(roots.root)} `
        + 'has no effect in this version (known keys under tracker: default, fallback)',
    ]);

    // The control: the same section without the unknown key warns about
    // nothing, so the single warning above was earned by `kind` alone.
    const clean = scopes('tracker:\n  default: linear\n', null);
    const cleanSink = sink();
    loadConfig(clean, {}, cleanSink.warn);
    expect(cleanSink.lines).toEqual([]);
  });
});

/**
 * One row per section: an unusable value, the problem it is refused
 * with, a usable value at the same key, the setting it reads into, and
 * what it reads as. The problem strings and the usable readings are the
 * ones `config.test.ts` proves the readers accept and refuse; this table
 * drives them through `loadConfig` instead.
 */
const SECTION_CASES: readonly [string, string, string, string, ConfigSetting, unknown][] = [
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
    'pr.provider', 'pr:\n  provider: gitlab',
    'pr.provider is "gitlab", expected one of: gh, none',
    'pr:\n  provider: none', 'prProvider', 'none',
  ],
  [
    'pr.mergeMethod', 'pr:\n  mergeMethod: Squash',
    'pr.mergeMethod is "Squash", expected one of: squash, merge, rebase',
    'pr:\n  mergeMethod: rebase', 'prMergeMethod', 'rebase',
  ],
  [
    'pr.base', 'pr:\n  base: ""', 'pr.base is "", expected a branch name',
    'pr:\n  base: trunk', 'prBase', 'trunk',
  ],
  [
    'pr.resolveBudget', 'pr:\n  resolveBudget: 0',
    'pr.resolveBudget is 0, expected a number of US dollars above zero, '
      + 'at most six digits either side of the point',
    'pr:\n  resolveBudget: 4', 'prResolveBudget', 4,
  ],
  [
    'board.trustedAuthors', 'board:\n  trustedAuthors: octocat',
    'board.trustedAuthors is "octocat", expected a list of GitHub logins',
    'board:\n  trustedAuthors: [hubot]', 'boardTrustedAuthors', ['hubot'],
  ],
  [
    'roadmap.issue', 'roadmap:\n  issue: 2.5',
    'roadmap.issue is 2.5, expected an issue number, a whole number above zero',
    'roadmap:\n  issue: 31', 'roadmapIssue', 31,
  ],
  [
    'release.enabled', 'release:\n  enabled: "true"',
    'release.enabled is "true", expected true, false or auto',
    'release:\n  enabled: auto', 'releaseEnabled', 'auto',
  ],
  [
    'release.versionFile', 'release:\n  versionFile: 2',
    'release.versionFile is 2, expected a file path',
    'release:\n  versionFile: deno.json', 'releaseVersionFile', 'deno.json',
  ],
  [
    'release.changelog', 'release:\n  changelog: "  "',
    'release.changelog is "  ", expected a file path',
    'release:\n  changelog: NEWS.md', 'releaseChangelog', 'NEWS.md',
  ],
  [
    'release.heading', 'release:\n  heading: []',
    'release.heading is a list, expected a changelog heading template',
    'release:\n  heading: "## {version}"', 'releaseHeading', '## {version}',
  ],
  [
    'cleanup.staleDays', 'cleanup:\n  staleDays: 2.5',
    'cleanup.staleDays is 2.5, expected a number of days, a whole number above zero',
    'cleanup:\n  staleDays: 14', 'cleanupStaleDays', 14,
  ],
  [
    'cleanup.worktreeIdleDays', 'cleanup:\n  worktreeIdleDays: -1',
    'cleanup.worktreeIdleDays is -1, expected a number of days, a whole number above zero',
    'cleanup:\n  worktreeIdleDays: 1', 'cleanupWorktreeIdleDays', 1,
  ],
  [
    'cleanup.keep', 'cleanup:\n  keep: [""]',
    'cleanup.keep[0] is "", expected a glob pattern',
    'cleanup:\n  keep: [main-*]', 'cleanupKeep', ['main-*'],
  ],
  [
    'dangerous.acceptStaleRefs', 'dangerous:\n  acceptStaleRefs: "true"',
    'dangerous.acceptStaleRefs is "true", expected true or false',
    'dangerous:\n  acceptStaleRefs: true', 'dangerousAcceptStaleRefs', true,
  ],
  [
    'status.notice', 'status:\n  notice: "false"',
    'status.notice is "false", expected true or false',
    'status:\n  notice: false', 'statusNotice', false,
  ],
  [
    'tiers.rafa', 'tiers:\n  rafa: true',
    'tiers.rafa is true, expected one of: on, off',
    'tiers:\n  rafa: on', 'tiersRafa', 'on',
  ],
  [
    'tiers.skills', 'tiers:\n  skills: { documentation: }',
    'tiers.skills.documentation is null, expected false or one of: project, rafa, user',
    'tiers:\n  skills: { documentation: user }', 'tiersSkills', new Map([['documentation', 'user']]),
  ],
  [
    'tiers.agents', 'tiers:\n  agents: { tdd-guide: Project }',
    'tiers.agents.tdd-guide is "Project", expected false or one of: project, rafa, user',
    'tiers:\n  agents: { tdd-guide: false }', 'tiersAgents', new Map([['tdd-guide', false]]),
  ],
  [
    'routing', 'routing: { tests: }',
    'routing.tests is null, expected false or an agent name',
    'routing: { tests: false }', 'routing', new Map([...CONFIG_DEFAULTS.routing, ['tests', false]]),
  ],
];

describe('each section, an unusable value refused by name beside an accepting control', () => {
  it('names every setting exactly once, in schema order', () => {
    expect(SECTION_CASES.map((row) => row[4])).toEqual(ALL_SETTINGS);
  });

  it.each(SECTION_CASES)(
    'refuses an unusable %s through loadConfig, naming the real file',
    (_label, unusable, problem) => {
      const roots = scopes(`${unusable}\n`, null);

      expect(refusal(() => loadConfig(roots, {}, quiet)).problems).toEqual([
        `${literalPath(roots.root)}: ${problem}`,
      ]);
    },
  );

  it.each(SECTION_CASES)(
    'accepts a usable %s into the config, sourced from the file',
    (_label, _unusable, _problem, usable, setting, expected) => {
      const roots = scopes(`${usable}\n`, null);
      const resolved = loadConfig(roots, {}, quiet);

      expect<unknown>(resolved.config[setting]).toEqual(expected);
      expect(resolved.sources[setting]).toBe('file');
    },
  );
});

describe('maps merged across the user and project layers', () => {
  it('merges tiers.skills by key, the project outranking the user on a shared name', () => {
    const roots = scopes(
      'tiers:\n  skills: { documentation: project, lint: rafa }\n',
      'tiers:\n  skills: { documentation: user, react-query: user }\n',
    );
    const resolved = loadConfig(roots, {}, quiet);

    expect(resolved.config.tiersSkills).toEqual(new Map<string, TierPin>([
      ['documentation', 'project'],
      ['react-query', 'user'],
      ['lint', 'rafa'],
    ]));
    expect(resolved.sources.tiersSkills).toBe('file');
  });

  it('merges routing by key over the defaults, user rows then project rows', () => {
    const roots = scopes(
      'routing: { cleanup: refactor-cleaner }\n',
      'routing: { review: typescript-reviewer, cleanup: user-cleaner }\n',
    );
    const resolved = loadConfig(roots, {}, quiet);

    expect(resolved.config.routing).toEqual(new Map<string, RouteTarget>([
      ...CONFIG_DEFAULTS.routing,
      ['review', 'typescript-reviewer'],
      ['cleanup', 'refactor-cleaner'],
    ]));
  });

  it('lets a project false shadow the user pin and a user false shadow a default row', () => {
    const roots = scopes(
      'tiers:\n  skills: { documentation: false }\n',
      'tiers:\n  skills: { documentation: user }\nrouting: { tests: false }\n',
    );
    const resolved = loadConfig(roots, {}, quiet);

    expect(resolved.config.tiersSkills.get('documentation')).toBe(false);
    expect(resolved.config.routing.get('tests')).toBe(false);
    expect(resolved.config.routing.get('prose')).toBe('doc-updater');
  });
});

describe('a user-level pin naming an unloaded tier', () => {
  const USER_PIN = 'tiers:\n  rafa: off\n  skills: { documentation: rafa }\n';

  it('warns naming the pin and the file, and still loads the config', () => {
    const roots = scopes(null, USER_PIN);
    const { lines, warn } = sink();
    const resolved = loadConfig(roots, {}, warn);

    expect(resolved.config.tiersSkills.get('documentation')).toBe('rafa');
    expect(lines).toEqual([
      `rafa config: tiers.skills.documentation in ${literalPath(roots.home)} pins the rafa tier, `
        + 'which is not loaded (tiers.rafa is off), so the pin has no effect',
    ]);
  });

  it('does not warn while the rafa tier is loaded', () => {
    const roots = scopes(null, 'tiers:\n  skills: { documentation: rafa }\n');
    const { lines, warn } = sink();
    loadConfig(roots, {}, warn);

    expect(lines).toEqual([]);
  });
});
