/**
 * Tests for the registry: the twelve sections it lists, the
 * registration its import makes, and the merged schema it exports.
 *
 * The cases in one process read the registry this file's import made:
 * every setting the registered sections define is in {@link SETTINGS}
 * as the same spec, every default is in {@link CONFIG_DEFAULTS} as the
 * same value, and a second registration of the list is refused naming
 * both packages, leaving the registry as it was. Every key, every
 * section and every package name is SPELLED here, never read off the
 * module, so a section dropped, renamed or reordered fails rather than
 * agreeing with itself.
 *
 * The probe cases import one module first in a fresh `bun` process and
 * print how many settings and defaults core's registry answers. The
 * registry answers all of them; the control, the core config barrel
 * alone, answers none, so the probe can tell a registration from its
 * absence.
 *
 * The load hook the import sets is held to be {@link handConfigToLogger},
 * and that function to hand the logger the settings of the config it is
 * given, each away from its default so a hook that handed the defaults
 * fails.
 */
import type { ConfigSetting, RafaConfig } from './core/config/index.js';

import { join } from 'node:path';

import { describe, expect, it } from 'bun:test';

import { activeLoggerSettings, setActiveLoggerSettings } from './adapters/logger/settings.js';
import {
  CONFIG_DEFAULTS,
  CONFIG_SECTIONS,
  handConfigToLogger,
  knownKeysAbove,
  SECTIONS,
  SETTING_BY_KEY,
  SETTING_NAMES,
  SETTINGS,
} from './config-registry.js';
import {
  activeChecks,
  activeConfigLoadHook,
  activeDefaults,
  activeSettings,
  ConfigSectionError,
  registerConfigSections,
} from './core/config/index.js';

/** The twelve packages, in the order the registry lists their sections. */
const PACKAGES = [
  'core',
  'hub',
  'loop-retries',
  'loop-continue',
  'wrap-up',
  'release',
  'board-project',
  'triage',
  'errors',
  'logger',
  'issues',
  'tests',
];

/** Every setting and the file key it is spelled with, in schema order. */
const KEYS: readonly (readonly [ConfigSetting, string])[] = [
  ['version', 'version'],
  ['store', 'store'],
  ['effortBusyTimeoutMs', 'effort.busyTimeoutMs'],
  ['effortSync', 'effort.sync'],
  ['hubUrl', 'hub.url'],
  ['hubTokenSecret', 'hub.tokenSecret'],
  ['hubTimeout', 'hub.timeout'],
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
  ['loopRetries', 'loop.retries'],
  ['loopRetriesOnContinue', 'loop.retriesOnContinue'],
  ['loopContinueCriteria', 'loop.continue.criteria'],
  ['loopContinueCriteriaMode', 'loop.continue.criteriaMode'],
  ['loopForceWrapUpMaxNewFailures', 'loop.forceWrapUp.maxNewFailures'],
  ['loopWrapUpRetries', 'loop.wrapUp.retries'],
  ['prProvider', 'pr.provider'],
  ['prMergeMethod', 'pr.mergeMethod'],
  ['prBase', 'pr.base'],
  ['prResolveBudget', 'pr.resolveBudget'],
  ['prVersionCollision', 'pr.versionCollision'],
  ['boardTrustedAuthors', 'board.trustedAuthors'],
  ['boardRelationships', 'board.relationships'],
  ['boardProjectTemplate', 'board.project.template'],
  ['boardProjectNumber', 'board.project.number'],
  ['boardProjectRetries', 'board.project.retries'],
  ['boardProjectRetryWaitSeconds', 'board.project.retryWaitSeconds'],
  ['boardProjectProgressSeconds', 'board.project.progressSeconds'],
  ['boardProjectWriteBatchSize', 'board.project.writeBatchSize'],
  ['boardProjectWritePauseMs', 'board.project.writePauseMs'],
  ['roadmapIssue', 'roadmap.issue'],
  ['claimsStaleAfter', 'claims.staleAfter'],
  ['claimsAhead', 'claims.ahead'],
  ['triageSimilarityThreshold', 'triage.similarity.threshold'],
  ['triageSimilarityCandidates', 'triage.similarity.candidates'],
  ['releaseEnabled', 'release.enabled'],
  ['releaseVersionFile', 'release.versionFile'],
  ['releaseChangelog', 'release.changelog'],
  ['releaseHeading', 'release.heading'],
  ['releaseFragments', 'release.fragments'],
  ['releaseStrategy', 'release.strategy'],
  ['releaseSettle', 'release.settle'],
  ['releaseTag', 'release.tag'],
  ['releasePublishCommand', 'release.publishCommand'],
  ['errorsCodes', 'errors.codes'],
  ['loggerKind', 'logger.kind'],
  ['loggerLevel', 'logger.level'],
  ['loggerTheme', 'logger.theme'],
  ['loggerModules', 'logger.modules'],
  ['loggerCallSite', 'logger.callSite'],
  ['loggerApi', 'logger.api'],
  ['issuesTitleBug', 'issues.titles.bug'],
  ['issuesSummaryMax', 'issues.titles.summaryMax'],
  ['issuesEnvironments', 'issues.environments'],
  ['issuesVocabularyModules', 'issues.vocabulary.modules'],
  ['issuesVocabularyActions', 'issues.vocabulary.actions'],
  ['cleanupStaleDays', 'cleanup.staleDays'],
  ['cleanupWorktreeIdleDays', 'cleanup.worktreeIdleDays'],
  ['cleanupKeep', 'cleanup.keep'],
  ['dangerousAcceptStaleRefs', 'dangerous.acceptStaleRefs'],
  ['dangerousAcceptVersionCollision', 'dangerous.acceptVersionCollision'],
  ['dangerousSelfUpdateDuringLoop', 'dangerous.selfUpdateDuringLoop'],
  ['statusNotice', 'status.notice'],
  ['tiersRafa', 'tiers.rafa'],
  ['tiersSkills', 'tiers.skills'],
  ['tiersAgents', 'tiers.agents'],
  ['routing', 'routing'],
  ['taskSkills', 'task.skills'],
  ['taskLessons', 'task.lessons'],
  ['testsFullSuiteTriggers', 'tests.fullSuiteTriggers'],
  ['testsIntegration', 'tests.integration'],
  ['testsAlwaysRun', 'tests.alwaysRun'],
  ['testsRetakeRedAlone', 'tests.retakeRedAlone'],
];

/** The keys known at the top level, in schema order. */
const TOP = [
  'version',
  'store',
  'effort',
  'hub',
  'plan',
  'specs',
  'tracker',
  'learning',
  'output',
  'prerequisites',
  'tracking',
  'modules',
  'allowList',
  'loop',
  'pr',
  'board',
  'roadmap',
  'claims',
  'triage',
  'release',
  'errors',
  'logger',
  'issues',
  'cleanup',
  'dangerous',
  'status',
  'tiers',
  'routing',
  'task',
  'tests',
];

/** The settings and defaults core's registry answers once `module` is imported first, in a fresh process. */
function probeRegistered(module: string): { settings: number; defaults: number } {
  const barrel = join(import.meta.dir, 'core', 'config', 'index.ts');
  const script = [
    `await import(${JSON.stringify(module)});`,
    `const core = await import(${JSON.stringify(barrel)});`,
    'console.log(JSON.stringify({',
    '  settings: Object.keys(core.activeSettings()).length,',
    '  defaults: Object.keys(core.activeDefaults()).length,',
    '}));',
  ].join('\n');
  const run = Bun.spawnSync([process.execPath, '-e', script], { env: process.env });
  if (run.exitCode !== 0) throw new Error(`the probe of ${module} exited ${run.exitCode}: ${run.stderr.toString()}`);
  const lines = run.stdout
    .toString()
    .trimEnd()
    .split('\n');
  return JSON.parse(lines[lines.length - 1] ?? '') as { settings: number; defaults: number };
}

describe('CONFIG_SECTIONS', () => {
  it('lists the twelve sections, core\'s first', () => {
    expect(CONFIG_SECTIONS.map((section) => section.package)).toEqual(PACKAGES);
  });

  it('is frozen', () => {
    expect(Object.isFrozen(CONFIG_SECTIONS)).toBe(true);
  });
});

describe('the registration at import', () => {
  it('registers every setting of SETTINGS, each as the same spec', () => {
    const active = activeSettings();
    const registered = Object.keys(active).sort();
    const differing = SETTING_NAMES.filter((setting) => active[setting] !== SETTINGS[setting]);

    expect(registered).toEqual([...SETTING_NAMES].sort());
    expect(differing).toEqual([]);
  });

  it('registers every default of CONFIG_DEFAULTS, each as the same value', () => {
    const active: Partial<Record<ConfigSetting, unknown>> = activeDefaults();
    const registered = Object.keys(active).sort();
    const differing = SETTING_NAMES.filter((setting) => active[setting] !== CONFIG_DEFAULTS[setting]);

    expect(registered).toEqual([...SETTING_NAMES].sort());
    expect(differing).toEqual([]);
  });

  it('registers the hub\'s check, the one a section carries', () => {
    expect(activeChecks()).toEqual(CONFIG_SECTIONS.flatMap((section) => [...(section.checks ?? [])]));
    expect(activeChecks()).toHaveLength(1);
  });

  it('refuses the list a second time, naming both packages, and leaves the registry as it was', () => {
    const before = activeSettings();
    let refusal: unknown;
    try {
      registerConfigSections(CONFIG_SECTIONS);
    } catch (error) {
      refusal = error;
    }

    expect(refusal).toBeInstanceOf(ConfigSectionError);
    expect((refusal as ConfigSectionError).problems).toContain(
      'setting hubUrl is registered by package "hub" and again by package "hub"',
    );
    expect((refusal as ConfigSectionError).problems).toContain(
      'dangerous.acceptStaleRefs is defined by package "core" and again by package "core";'
        + ' a dangerous. key is a person\'s consent and one package defines it',
    );
    expect(activeSettings()).toBe(before);
  });
});

describe('the load hook', () => {
  it('is set at import to handConfigToLogger', () => {
    expect(activeConfigLoadHook()).toBe(handConfigToLogger);
  });

  it('hands the logger the logger settings of the config it is given', () => {
    const config: RafaConfig = {
      ...CONFIG_DEFAULTS,
      loggerLevel: 'error',
      loggerTheme: 'plain',
      loggerModules: new Map([['board', 'debug']]),
      loggerCallSite: true,
      loggerApi: true,
    };
    try {
      handConfigToLogger(config);

      expect(activeLoggerSettings()).toEqual({
        kind: 'console',
        level: 'error',
        theme: 'plain',
        modules: new Map([['board', 'debug']]),
        callSite: true,
        api: true,
      });
    } finally {
      setActiveLoggerSettings(null);
    }
  });
});

describe('the registration in a fresh process', () => {
  it('answers every setting and default once the registry is imported first', () => {
    expect(probeRegistered(join(import.meta.dir, 'config-registry.ts'))).toEqual({
      settings: KEYS.length,
      defaults: KEYS.length,
    });
  });

  it('answers none when the core barrel alone is imported, the control', () => {
    expect(probeRegistered(join(import.meta.dir, 'core', 'config', 'index.ts'))).toEqual({
      settings: 0,
      defaults: 0,
    });
  });
});

describe('SETTINGS', () => {
  it('spells one dotted file key per setting, in schema order', () => {
    expect(SETTING_NAMES.map((setting) => [setting, SETTINGS[setting].key])).toEqual(KEYS.map((pair) => [...pair]));
  });

  it('is frozen, as CONFIG_DEFAULTS and SETTING_NAMES are', () => {
    expect(Object.isFrozen(SETTINGS)).toBe(true);
    expect(Object.isFrozen(CONFIG_DEFAULTS)).toBe(true);
    expect(Object.isFrozen(SETTING_NAMES)).toBe(true);
  });
});

describe('CONFIG_DEFAULTS', () => {
  it('holds one default per setting, in schema order', () => {
    expect(Object.keys(CONFIG_DEFAULTS)).toEqual(KEYS.map(([setting]) => setting));
  });
});

describe('SETTING_BY_KEY', () => {
  it('reads every file key back to its setting', () => {
    expect(KEYS.map(([, key]) => SETTING_BY_KEY.get(key))).toEqual(KEYS.map(([setting]) => setting));
    expect(SETTING_BY_KEY.size).toBe(KEYS.length);
  });

  it('answers nothing for a section path, an unknown key or a prototype name', () => {
    expect(SETTING_BY_KEY.get('plan')).toBeUndefined();
    expect(SETTING_BY_KEY.get('nonesuch')).toBeUndefined();
    expect(SETTING_BY_KEY.get('constructor')).toBeUndefined();
  });
});

describe('SECTIONS', () => {
  it('holds every dotted prefix a setting sits under, and no setting key', () => {
    expect([...SECTIONS].sort()).toEqual([
      'board',
      'board.project',
      'claims',
      'cleanup',
      'dangerous',
      'effort',
      'errors',
      'hub',
      'issues',
      'issues.titles',
      'issues.vocabulary',
      'learning',
      'learning.bless',
      'learning.promote',
      'logger',
      'loop',
      'loop.continue',
      'loop.forceWrapUp',
      'loop.wrapUp',
      'output',
      'plan',
      'pr',
      'prerequisites',
      'release',
      'roadmap',
      'specs',
      'status',
      'task',
      'tests',
      'tiers',
      'tracker',
      'tracking',
      'triage',
      'triage.similarity',
    ]);
    expect(SECTIONS.has('modules')).toBe(false);
  });
});

describe('knownKeysAbove', () => {
  it('answers the top level for a key that sits at it', () => {
    expect(knownKeysAbove('nonesuch')).toEqual(['', TOP]);
  });

  it('answers the nearest section for a key under it', () => {
    expect(knownKeysAbove('plan.depth')).toEqual(['plan', ['inject', 'dir']]);
    expect(knownKeysAbove('hub.port')).toEqual(['hub', ['url', 'tokenSecret', 'timeout']]);
    expect(knownKeysAbove('plan.a.b')).toEqual(['plan', ['inject', 'dir']]);
    expect(knownKeysAbove('nonesuch.deeper.deepest')).toEqual(['', TOP]);
  });

  it('collapses a list index, so an item key answers the item shape', () => {
    expect(knownKeysAbove('modules[2].nonesuch')).toEqual([
      'modules[2]',
      ['npm', 'github', 'path', 'ref'],
    ]);
  });
});
