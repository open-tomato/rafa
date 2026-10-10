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
 * setting at a value that differs from the other's — `version` and
 * `release.strategy` are the exceptions, since each accepts one value. Loading them
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

import { afterAll, afterEach, describe, expect, it } from 'bun:test';

import { loadConfig } from '../config-load.js';
import { CONFIG_DEFAULTS, ConfigError } from '../config.js';
import { setActiveStoreSettings } from '../effort/store/settings.js';

const tempRoot = mkdtempSync(join(tmpdir(), 'rafa-config-layers-'));
let planted = 0;

afterAll(() => {
  rmSync(tempRoot, { recursive: true, force: true });
});

// `loadConfig` hands the effort store the busy timeout each file names,
// and a later file's store would open with this file's 250 ms.
afterEach(() => {
  setActiveStoreSettings(null);
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
  'effort:',
  '  busyTimeoutMs: 250',
  '  sync: file',
  'hub:',
  '  url: https://project-hub.example.org',
  '  tokenSecret: project-hub-token',
  '  timeout: 5s',
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
  '  worktreeDir: user-trees',
  '  retries: 3',
  '  retriesOnContinue: 3',
  '  continue:',
  '    criteria: user-criteria.md',
  '    criteriaMode: replace',
  '  forceWrapUp:',
  '    maxNewFailures: 3',
  '  wrapUp:',
  '    retries: 3',
  'pr:',
  '  provider: none',
  '  mergeMethod: rebase',
  '  base: trunk',
  '  resolveBudget: 0.5',
  '  versionCollision: refuse',
  'board:',
  '  trustedAuthors: [octocat]',
  '  relationships: native',
  '  project:',
  '    template: https://github.com/orgs/acme/projects/2',
  '    number: 6',
  '    retries: 5',
  '    retryWaitSeconds: 4',
  '    progressSeconds: 30',
  '    writeBatchSize: 7',
  '    writePauseMs: 0',
  'roadmap:',
  '  issue: 31',
  'claims:',
  '  staleAfter: 36h',
  '  ahead: allow',
  'triage:',
  '  similarity:',
  '    threshold: 0.6',
  '    candidates: 7',
  'release:',
  '  enabled: true',
  '  versionFile: project.json',
  '  changelog: docs/PROJECT-CHANGES.md',
  '  heading: "### {version} on {date}"',
  '  fragments: project-changes',
  '  strategy: semver-by-level',
  '  settle: pr',
  '  tag: settle',
  '  publishCommand: pnpm publish',
  'errors:',
  '  codes:',
  '    - code: deploy:missing-secret',
  '      description: a deploy reads an unset secret',
  '      hint: set the secret',
  '      level: error',
  '      since: v1',
  'cleanup:',
  '  staleDays: 45',
  '  worktreeIdleDays: 10',
  '  keep: ["project/*"]',
  'dangerous:',
  '  acceptStaleRefs: true',
  '  acceptVersionCollision: true',
  '  selfUpdateDuringLoop: true',
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
  'task:',
  '  skills: tag',
  '  lessons: off',
  'tests:',
  '  fullSuiteTriggers: ["project/*.toml"]',
  '  integration: ["project/**/*.e2e.ts"]',
  '  alwaysRun: ["project/**/*.sweep.ts"]',
  '  retakeRedAlone: false',
  '',
].join('\n');

/** What {@link PROJECT_TEXT} reads as. */
const PROJECT_VALUES: RafaConfig = {
  version: 1,
  store: 'ndjson',
  effortBusyTimeoutMs: 250,
  effortSync: 'file',
  hubUrl: 'https://project-hub.example.org',
  hubTokenSecret: 'project-hub-token',
  hubTimeout: '5s',
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
  loopWorktreeDir: 'user-trees',
  loopRetries: 3,
  loopRetriesOnContinue: 3,
  loopContinueCriteria: 'user-criteria.md',
  loopContinueCriteriaMode: 'replace',
  loopForceWrapUpMaxNewFailures: 3,
  loopWrapUpRetries: 3,
  prProvider: 'none',
  prMergeMethod: 'rebase',
  prBase: 'trunk',
  prResolveBudget: 0.5,
  prVersionCollision: 'refuse',
  boardTrustedAuthors: ['octocat'],
  boardRelationships: 'native',
  boardProjectTemplate: 'https://github.com/orgs/acme/projects/2',
  boardProjectNumber: 6,
  boardProjectRetries: 5,
  boardProjectRetryWaitSeconds: 4,
  boardProjectProgressSeconds: 30,
  boardProjectWriteBatchSize: 7,
  boardProjectWritePauseMs: 0,
  roadmapIssue: 31,
  claimsStaleAfter: '36h',
  claimsAhead: 'allow',
  triageSimilarityThreshold: 0.6,
  triageSimilarityCandidates: 7,
  releaseEnabled: true,
  releaseVersionFile: 'project.json',
  releaseChangelog: 'docs/PROJECT-CHANGES.md',
  releaseHeading: '### {version} on {date}',
  releaseFragments: 'project-changes',
  releaseStrategy: 'semver-by-level',
  releaseSettle: 'pr',
  releaseTag: 'settle',
  releasePublishCommand: 'pnpm publish',
  errorsCodes: [{ code: 'deploy:missing-secret', description: 'a deploy reads an unset secret', hint: 'set the secret', level: 'error', since: 'v1' }],
  cleanupStaleDays: 45,
  cleanupWorktreeIdleDays: 10,
  cleanupKeep: ['project/*'],
  dangerousAcceptStaleRefs: true,
  dangerousAcceptVersionCollision: true,
  dangerousSelfUpdateDuringLoop: true,
  statusNotice: false,
  tiersRafa: 'off',
  tiersSkills: new Map<string, TierPin>([['documentation', 'project'], ['react-query', false]]),
  tiersAgents: new Map<string, TierPin>([['tdd-guide', 'rafa'], ['code-reviewer', false]]),
  routing: new Map<string, RouteTarget>([
    ...CONFIG_DEFAULTS.routing,
    ['cleanup', 'refactor-cleaner'],
    ['review', false],
  ]),
  taskSkills: 'tag',
  taskLessons: 'off',
  testsFullSuiteTriggers: ['project/*.toml'],
  testsIntegration: ['project/**/*.e2e.ts'],
  testsAlwaysRun: ['project/**/*.sweep.ts'],
  testsRetakeRedAlone: false,
};

/** A user-scope file naming every setting at a value other than the project's. */
const USER_TEXT = [
  'version: 1',
  'store: sqlite',
  'effort:',
  '  busyTimeoutMs: 750',
  '  sync: git',
  'hub:',
  '  url: http://user-hub.example.org:7373',
  '  tokenSecret: user-hub-token',
  '  timeout: 20s',
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
  '  worktreeDir: ../project-trees',
  '  retries: 1',
  '  retriesOnContinue: false',
  '  continue:',
  '    criteria: project-criteria.md',
  '    criteriaMode: extend',
  '  forceWrapUp:',
  '    maxNewFailures: false',
  '  wrapUp:',
  '    retries: false',
  'pr:',
  '  provider: gh',
  '  mergeMethod: merge',
  '  base: develop',
  '  resolveBudget: 3',
  '  versionCollision: ask',
  'board:',
  '  trustedAuthors: ["dependabot[bot]", hubot]',
  '  relationships: labels',
  '  project:',
  '    template: https://github.com/users/markost/projects/3',
  '    number: 9',
  '    retries: false',
  '    retryWaitSeconds: 8',
  '    progressSeconds: false',
  '    writeBatchSize: 50',
  '    writePauseMs: 250',
  'roadmap:',
  '  issue: 7',
  'claims:',
  '  staleAfter: disabled',
  '  ahead: off',
  'triage:',
  '  similarity:',
  '    threshold: false',
  '    candidates: 1',
  'release:',
  '  enabled: false',
  '  versionFile: user.json',
  '  changelog: docs/USER-CHANGES.md',
  '  heading: "## {version}, {title}"',
  '  fragments: user-changes',
  '  strategy: semver-by-level',
  '  settle: push',
  '  tag: manual',
  '  publishCommand: yarn npm publish',
  'errors:',
  '  codes:',
  '    - code: deploy:health-timeout',
  '      description: a deploy health check times out',
  '      hint: read the service log',
  '      level: warn',
  '      since: v2',
  'cleanup:',
  '  staleDays: 90',
  '  worktreeIdleDays: 2',
  '  keep: ["user/*", scratch]',
  'dangerous:',
  '  acceptStaleRefs: false',
  '  acceptVersionCollision: false',
  '  selfUpdateDuringLoop: false',
  'status:',
  '  notice: true',
  'tiers:',
  '  rafa: on',
  '  skills: { documentation: user }',
  '  agents: { tdd-guide: user, code-reviewer: false }',
  'routing: { review: typescript-reviewer }',
  'task:',
  '  skills: none',
  '  lessons: on',
  'tests:',
  '  fullSuiteTriggers: []',
  '  integration: ["user/**/*.e2e.ts"]',
  '  alwaysRun: []',
  '  retakeRedAlone: true',
  '',
].join('\n');

/** What {@link USER_TEXT} reads as. */
const USER_VALUES: RafaConfig = {
  version: 1,
  store: 'sqlite',
  effortBusyTimeoutMs: 750,
  effortSync: 'git',
  hubUrl: 'http://user-hub.example.org:7373',
  hubTokenSecret: 'user-hub-token',
  hubTimeout: '20s',
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
  loopWorktreeDir: '../project-trees',
  loopRetries: 1,
  loopRetriesOnContinue: false,
  loopContinueCriteria: 'project-criteria.md',
  loopContinueCriteriaMode: 'extend',
  loopForceWrapUpMaxNewFailures: false,
  loopWrapUpRetries: false,
  prProvider: 'gh',
  prMergeMethod: 'merge',
  prBase: 'develop',
  prResolveBudget: 3,
  prVersionCollision: 'ask',
  boardTrustedAuthors: ['dependabot[bot]', 'hubot'],
  boardRelationships: 'labels',
  boardProjectTemplate: 'https://github.com/users/markost/projects/3',
  boardProjectNumber: 9,
  boardProjectRetries: false,
  boardProjectRetryWaitSeconds: 8,
  boardProjectProgressSeconds: false,
  boardProjectWriteBatchSize: 50,
  boardProjectWritePauseMs: 250,
  roadmapIssue: 7,
  claimsStaleAfter: 'disabled',
  claimsAhead: 'off',
  triageSimilarityThreshold: false,
  triageSimilarityCandidates: 1,
  releaseEnabled: false,
  releaseVersionFile: 'user.json',
  releaseChangelog: 'docs/USER-CHANGES.md',
  releaseHeading: '## {version}, {title}',
  releaseFragments: 'user-changes',
  releaseStrategy: 'semver-by-level',
  releaseSettle: 'push',
  releaseTag: 'manual',
  releasePublishCommand: 'yarn npm publish',
  errorsCodes: [{ code: 'deploy:health-timeout', description: 'a deploy health check times out', hint: 'read the service log', level: 'warn', since: 'v2' }],
  cleanupStaleDays: 90,
  cleanupWorktreeIdleDays: 2,
  cleanupKeep: ['user/*', 'scratch'],
  dangerousAcceptStaleRefs: false,
  dangerousAcceptVersionCollision: false,
  dangerousSelfUpdateDuringLoop: false,
  statusNotice: true,
  tiersRafa: 'on',
  tiersSkills: new Map([['documentation', 'user']]),
  tiersAgents: new Map<string, TierPin>([['tdd-guide', 'user'], ['code-reviewer', false]]),
  routing: new Map([...CONFIG_DEFAULTS.routing, ['review', 'typescript-reviewer']]),
  taskSkills: 'none',
  taskLessons: 'on',
  testsFullSuiteTriggers: [],
  testsIntegration: ['user/**/*.e2e.ts'],
  testsAlwaysRun: [],
  testsRetakeRedAlone: true,
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
  taskSkills: 'planner',
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
      taskSkills: 'planner',
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
      taskSkills: 'cli',
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
    'effort.busyTimeoutMs', 'effort:\n  busyTimeoutMs: false',
    'effort.busyTimeoutMs is false, expected a lock wait in milliseconds, a whole number from 1 to 60000',
    'effort:\n  busyTimeoutMs: 1', 'effortBusyTimeoutMs', 1,
  ],
  [
    'effort.sync', 'effort:\n  sync: File',
    'effort.sync is "File", expected one of: local, file, git, service, p2p',
    'effort:\n  sync: service\nhub:\n  url: https://hub.example.org', 'effortSync', 'service',
  ],
  [
    'hub.url', 'hub:\n  url: https://token@hub.example.org',
    'hub.url is "https://token@hub.example.org", expected an http or https URL with no user name or password, such as https://hub.example.org',
    'hub:\n  url: https://hub.example.org/rafa', 'hubUrl', 'https://hub.example.org/rafa',
  ],
  [
    'hub.tokenSecret', 'hub:\n  tokenSecret: 7',
    'hub.tokenSecret is 7, expected a secret store name',
    'hub:\n  tokenSecret: rafa-hub-token', 'hubTokenSecret', 'rafa-hub-token',
  ],
  [
    'hub.timeout', 'hub:\n  timeout: 31s',
    'hub.timeout is "31s", expected a duration of whole seconds from 1s to 30s, such as 3s',
    'hub:\n  timeout: 1s', 'hubTimeout', '1s',
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
    'output.mode', 'output:\n  mode: tui', 'output.mode is "tui", expected one of: text, json, events',
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
    'loop.worktreeDir', 'loop:\n  worktreeDir: []', 'loop.worktreeDir is a list, expected a directory path',
    'loop:\n  worktreeDir: trees', 'loopWorktreeDir', 'trees',
  ],
  [
    'loop.retries', 'loop:\n  retries: 0',
    'loop.retries is 0, expected false or a whole number from 1 to 3',
    'loop:\n  retries: 3', 'loopRetries', 3,
  ],
  [
    'loop.retriesOnContinue', 'loop:\n  retriesOnContinue: 1.5',
    'loop.retriesOnContinue is 1.5, expected false or a whole number from 1 to 3',
    'loop:\n  retriesOnContinue: 2', 'loopRetriesOnContinue', 2,
  ],
  [
    'loop.continue.criteria', 'loop:\n  continue:\n    criteria: []',
    'loop.continue.criteria is a list, expected a file path',
    'loop:\n  continue:\n    criteria: crit.md', 'loopContinueCriteria', 'crit.md',
  ],
  [
    'loop.continue.criteriaMode', 'loop:\n  continue:\n    criteriaMode: true',
    'loop.continue.criteriaMode is true, expected one of: extend, replace',
    'loop:\n  continue:\n    criteriaMode: extend', 'loopContinueCriteriaMode', 'extend',
  ],
  [
    'loop.forceWrapUp.maxNewFailures', 'loop:\n  forceWrapUp:\n    maxNewFailures: true',
    'loop.forceWrapUp.maxNewFailures is true, expected false or a whole number from 1 to 50',
    'loop:\n  forceWrapUp:\n    maxNewFailures: 1', 'loopForceWrapUpMaxNewFailures', 1,
  ],
  [
    'loop.wrapUp.retries', 'loop:\n  wrapUp:\n    retries: 4',
    'loop.wrapUp.retries is 4, expected false or a whole number from 1 to 3',
    'loop:\n  wrapUp:\n    retries: 2', 'loopWrapUpRetries', 2,
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
    'pr.versionCollision', 'pr:\n  versionCollision: Report',
    'pr.versionCollision is "Report", expected one of: allow, report, ask, refuse',
    'pr:\n  versionCollision: allow', 'prVersionCollision', 'allow',
  ],
  [
    'board.trustedAuthors', 'board:\n  trustedAuthors: octocat',
    'board.trustedAuthors is "octocat", expected a list of GitHub logins',
    'board:\n  trustedAuthors: [hubot]', 'boardTrustedAuthors', ['hubot'],
  ],
  [
    'board.relationships', 'board:\n  relationships: Native',
    'board.relationships is "Native", expected one of: labels, native',
    'board:\n  relationships: native', 'boardRelationships', 'native',
  ],
  [
    'board.project.template', 'board:\n  project:\n    template: http://example.com/board',
    'board.project.template is "http://example.com/board", expected a GitHub project URL, https://github.com/orgs/<owner>/projects/<number> or /users/<owner>/…',
    'board:\n  project:\n    template: https://github.com/orgs/acme/projects/2',
    'boardProjectTemplate', 'https://github.com/orgs/acme/projects/2',
  ],
  [
    'board.project.number', 'board:\n  project:\n    number: 2.5',
    'board.project.number is 2.5, expected a project number, a whole number above zero',
    'board:\n  project:\n    number: 6', 'boardProjectNumber', 6,
  ],
  [
    'board.project.retries', 'board:\n  project:\n    retries: 11',
    'board.project.retries is 11, expected false or a whole number from 1 to 10',
    'board:\n  project:\n    retries: 10', 'boardProjectRetries', 10,
  ],
  [
    'board.project.retryWaitSeconds', 'board:\n  project:\n    retryWaitSeconds: 0',
    'board.project.retryWaitSeconds is 0, expected a whole number from 1 to 60',
    'board:\n  project:\n    retryWaitSeconds: 1', 'boardProjectRetryWaitSeconds', 1,
  ],
  [
    'board.project.progressSeconds', 'board:\n  project:\n    progressSeconds: 301',
    'board.project.progressSeconds is 301, expected false or a whole number from 1 to 300',
    'board:\n  project:\n    progressSeconds: 300', 'boardProjectProgressSeconds', 300,
  ],
  [
    'board.project.writeBatchSize', 'board:\n  project:\n    writeBatchSize: 0',
    'board.project.writeBatchSize is 0, expected a whole number from 1 to 100',
    'board:\n  project:\n    writeBatchSize: 1', 'boardProjectWriteBatchSize', 1,
  ],
  [
    'board.project.writePauseMs', 'board:\n  project:\n    writePauseMs: false',
    'board.project.writePauseMs is false, expected a whole number from 0 to 60000',
    'board:\n  project:\n    writePauseMs: 60000', 'boardProjectWritePauseMs', 60000,
  ],
  [
    'roadmap.issue', 'roadmap:\n  issue: 2.5',
    'roadmap.issue is 2.5, expected an issue number, a whole number above zero',
    'roadmap:\n  issue: 31', 'roadmapIssue', 31,
  ],
  [
    'claims.staleAfter', 'claims:\n  staleAfter: 3',
    'claims.staleAfter is 3, expected a duration of whole hours or days above zero, such as 36h or 3d, or disabled',
    'claims:\n  staleAfter: 12h', 'claimsStaleAfter', '12h',
  ],
  [
    'claims.ahead', 'claims:\n  ahead: on',
    'claims.ahead is "on", expected one of: off, allow',
    'claims:\n  ahead: allow', 'claimsAhead', 'allow',
  ],
  [
    'triage.similarity.threshold', 'triage:\n  similarity:\n    threshold: -1',
    'triage.similarity.threshold is -1, expected false or a number above 0 and at most 1',
    'triage:\n  similarity:\n    threshold: 0.25', 'triageSimilarityThreshold', 0.25,
  ],
  [
    'triage.similarity.candidates', 'triage:\n  similarity:\n    candidates: 0',
    'triage.similarity.candidates is 0, expected a whole number from 1 to 10',
    'triage:\n  similarity:\n    candidates: 2', 'triageSimilarityCandidates', 2,
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
    'release.fragments', 'release:\n  fragments: /tmp/changes',
    'release.fragments is "/tmp/changes", expected a relative directory path not under .rafa/',
    'release:\n  fragments: .changes/', 'releaseFragments', '.changes/',
  ],
  [
    'release.strategy', 'release:\n  strategy: semver',
    'release.strategy is "semver", expected one of: semver-by-level',
    'release:\n  strategy: semver-by-level', 'releaseStrategy', 'semver-by-level',
  ],
  [
    'release.settle', 'release:\n  settle: PR',
    'release.settle is "PR", expected one of: push, pr',
    'release:\n  settle: push', 'releaseSettle', 'push',
  ],
  [
    'release.tag', 'release:\n  tag: auto',
    'release.tag is "auto", expected one of: manual, settle',
    'release:\n  tag: manual', 'releaseTag', 'manual',
  ],
  [
    'release.publishCommand', 'release:\n  publishCommand: []',
    'release.publishCommand is a list, expected a publish command',
    'release:\n  publishCommand: bun publish', 'releasePublishCommand', 'bun publish',
  ],
  [
    'errors.codes', 'errors:\n  codes:\n    - code: git:no-identity\n      description: d\n      hint: h\n      level: error\n      since: v1',
    'errors.codes[0].code is "git:no-identity", which rafa already declares; add a leaf of your own instead',
    'errors:\n  codes:\n    - code: git:shallow-clone\n      description: d\n      hint: h\n      level: warn\n      since: v1',
    'errorsCodes', [{ code: 'git:shallow-clone', description: 'd', hint: 'h', level: 'warn', since: 'v1' }],
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
    'dangerous.acceptVersionCollision', 'dangerous:\n  acceptVersionCollision: 1',
    'dangerous.acceptVersionCollision is 1, expected true or false',
    'dangerous:\n  acceptVersionCollision: true', 'dangerousAcceptVersionCollision', true,
  ],
  [
    'dangerous.selfUpdateDuringLoop', 'dangerous:\n  selfUpdateDuringLoop: "true"',
    'dangerous.selfUpdateDuringLoop is "true", expected true or false',
    'dangerous:\n  selfUpdateDuringLoop: true', 'dangerousSelfUpdateDuringLoop', true,
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
  [
    'task.skills', 'task:\n  skills: [planner]',
    'task.skills is a list, expected one of: planner, tag, none',
    'task:\n  skills: tag', 'taskSkills', 'tag',
  ],
  [
    'task.lessons', 'task:\n  lessons: "Off"',
    'task.lessons is "Off", expected one of: on, off',
    'task:\n  lessons: off', 'taskLessons', 'off',
  ],
  [
    'tests.fullSuiteTriggers', 'tests:\n  fullSuiteTriggers: [""]',
    'tests.fullSuiteTriggers[0] is "", expected a glob pattern relative to the repository root',
    'tests:\n  fullSuiteTriggers: ["*.toml"]', 'testsFullSuiteTriggers', ['*.toml'],
  ],
  [
    'tests.integration', 'tests:\n  integration: { e2e: true }',
    'tests.integration is a mapping, expected a list of glob patterns',
    'tests:\n  integration: []', 'testsIntegration', [],
  ],
  [
    'tests.alwaysRun', 'tests:\n  alwaysRun: ["/src/*.sweep.test.ts"]',
    'tests.alwaysRun[0] is "/src/*.sweep.test.ts", expected a glob pattern relative to the repository root',
    'tests:\n  alwaysRun: ["src/*.sweep.test.ts"]', 'testsAlwaysRun', ['src/*.sweep.test.ts'],
  ],
  [
    'tests.retakeRedAlone', 'tests:\n  retakeRedAlone: "false"',
    'tests.retakeRedAlone is "false", expected true or false',
    'tests:\n  retakeRedAlone: false', 'testsRetakeRedAlone', false,
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

/**
 * The release plan's six keys, driven through `loadConfig` rather than the
 * pure resolver: `PROJECT_TEXT`/`PROJECT_VALUES` and `SECTION_CASES` above
 * already carry all six through the whole-schema round trip, so what this
 * block adds is narrow and explicit — the six read together from a real
 * `.rafa/config.yaml`, the six fall back to their defaults together when no
 * file names them, and a `release.fragments` planted under the gitignored
 * `.rafa/` is refused with the real file's path, the case `SECTION_CASES`
 * covers only with an absolute path.
 */
describe('the release plan\'s six keys, through loadConfig', () => {
  it('reads all six from .rafa/config.yaml, sourced from the file', () => {
    const roots = scopes(
      [
        'pr:',
        '  versionCollision: ask',
        'release:',
        '  fragments: release-notes',
        '  strategy: semver-by-level',
        '  settle: pr',
        '  tag: settle',
        'dangerous:',
        '  acceptVersionCollision: true',
        '',
      ].join('\n'),
      null,
    );
    const resolved = loadConfig(roots, {}, quiet);

    expect(resolved.config).toMatchObject({
      prVersionCollision: 'ask',
      releaseFragments: 'release-notes',
      releaseStrategy: 'semver-by-level',
      releaseSettle: 'pr',
      releaseTag: 'settle',
      dangerousAcceptVersionCollision: true,
    });
    expect(resolved.sources).toMatchObject({
      prVersionCollision: 'file',
      releaseFragments: 'file',
      releaseStrategy: 'file',
      releaseSettle: 'file',
      releaseTag: 'file',
      dangerousAcceptVersionCollision: 'file',
    });
  });

  it('falls back to defaults, together, when no config file names them', () => {
    const roots = scopes(null, null);
    const resolved = loadConfig(roots, {}, quiet);

    expect(resolved.config).toMatchObject({
      prVersionCollision: CONFIG_DEFAULTS.prVersionCollision,
      releaseFragments: CONFIG_DEFAULTS.releaseFragments,
      releaseStrategy: CONFIG_DEFAULTS.releaseStrategy,
      releaseSettle: CONFIG_DEFAULTS.releaseSettle,
      releaseTag: CONFIG_DEFAULTS.releaseTag,
      dangerousAcceptVersionCollision: CONFIG_DEFAULTS.dangerousAcceptVersionCollision,
    });
    expect(resolved.sources).toMatchObject({
      prVersionCollision: 'default',
      releaseFragments: 'default',
      releaseStrategy: 'default',
      releaseSettle: 'default',
      releaseTag: 'default',
      dangerousAcceptVersionCollision: 'default',
    });
  });

  it('reports a release.fragments planted under .rafa/, naming the real file', () => {
    const roots = scopes('release:\n  fragments: .rafa/changes\n', null);

    expect(refusal(() => loadConfig(roots, {}, quiet)).problems).toEqual([
      `${literalPath(roots.root)}: release.fragments is ".rafa/changes", `
        + 'expected a relative directory path not under .rafa/',
    ]);
  });
});
