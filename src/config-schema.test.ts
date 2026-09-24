/**
 * Tests for the config schema: the settings, the file key each is
 * spelled with, and the indexes built off them.
 *
 * `config-schema.ts` is imported directly here, which nothing outside
 * the config trio does — every name it exports reaches a caller through
 * `config.ts`. What is driven here is what only the schema module
 * answers: the dotted key per setting, which settings a command line
 * may name, the sections a file may open, and the known-key index a
 * warning is built from. `CONFIG_FILE` and `CONFIG_DEFAULTS` are driven
 * through `config.js` in `config.test.ts` and are not repeated; the
 * layers, the refusals and the warning sentence are driven there too.
 *
 * Every key and every section is SPELLED here, never read off
 * {@link SETTINGS}, so a module that renames a key or drops a section
 * fails rather than agreeing with itself.
 */
import type { ConfigSetting } from './config-schema.js';

import { describe, expect, it } from 'bun:test';

import {
  isCommandLineSetting,
  knownKeysAbove,
  SECTIONS,
  SETTING_BY_KEY,
  SETTING_NAMES,
  SETTINGS,
} from './config-schema.js';

/** Every setting and the file key it is spelled with, in schema order. */
const KEYS: readonly (readonly [ConfigSetting, string])[] = [
  ['version', 'version'],
  ['store', 'store'],
  ['inject', 'plan.inject'],
  ['planDir', 'plan.dir'],
  ['specsDir', 'specs.dir'],
  ['trackerDefault', 'tracker.default'],
  ['trackerFallback', 'tracker.fallback'],
  ['learningAdapter', 'learning.adapter'],
  ['outputMode', 'output.mode'],
  ['prerequisitesRequired', 'prerequisites.required'],
  ['prerequisitesOptional', 'prerequisites.optional'],
  ['trackingSpecs', 'tracking.specs'],
  ['trackingPlans', 'tracking.plans'],
  ['trackingAll', 'tracking.all'],
  ['modules', 'modules'],
  ['allowList', 'allowList'],
  ['settingSources', 'loop.settingSources'],
  ['prProvider', 'pr.provider'],
  ['prMergeMethod', 'pr.mergeMethod'],
  ['prBase', 'pr.base'],
  ['prResolveBudget', 'pr.resolveBudget'],
  ['boardTrustedAuthors', 'board.trustedAuthors'],
  ['roadmapIssue', 'roadmap.issue'],
  ['releaseEnabled', 'release.enabled'],
  ['releaseVersionFile', 'release.versionFile'],
  ['releaseChangelog', 'release.changelog'],
  ['releaseHeading', 'release.heading'],
  ['cleanupStaleDays', 'cleanup.staleDays'],
  ['cleanupWorktreeIdleDays', 'cleanup.worktreeIdleDays'],
  ['cleanupKeep', 'cleanup.keep'],
  ['dangerousAcceptStaleRefs', 'dangerous.acceptStaleRefs'],
];

/** The settings a flag may name: every one the file spells as a string. */
const COMMAND_LINE: readonly ConfigSetting[] = [
  'store',
  'inject',
  'planDir',
  'specsDir',
  'trackerDefault',
  'learningAdapter',
  'outputMode',
  'settingSources',
];

/** The keys known at the top level, in schema order. */
const TOP = [
  'version',
  'store',
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
  'release',
  'cleanup',
  'dangerous',
];

describe('SETTINGS', () => {
  it('spells one dotted file key per setting, in schema order', () => {
    const spelled = SETTING_NAMES.map((setting) => [
      setting,
      SETTINGS[setting].key,
    ]);

    expect(spelled).toEqual(KEYS.map((pair) => [...pair]));
  });

  it('carries item keys for the two lists of mappings and for nothing else', () => {
    const withItems = SETTING_NAMES
      .filter((setting) => SETTINGS[setting].itemKeys !== undefined)
      .map((setting) => [setting, SETTINGS[setting].itemKeys]);

    expect(withItems).toEqual([
      ['prerequisitesRequired', ['tool', 'env', 'service', 'lsp', 'probe']],
      ['prerequisitesOptional', ['tool', 'env', 'service', 'lsp', 'probe', 'reason']],
      ['modules', ['npm', 'github', 'path', 'ref']],
    ]);
  });
});

describe('SETTING_BY_KEY', () => {
  it('reads every file key back to its setting', () => {
    const read = KEYS.map(([, key]) => SETTING_BY_KEY.get(key));

    expect(read).toEqual(KEYS.map(([setting]) => setting));
  });

  it('holds one entry per setting, so no two settings share a key', () => {
    expect(SETTING_BY_KEY.size).toBe(SETTING_NAMES.length);
  });

  it('answers nothing for a section path or an unknown key', () => {
    expect(SETTING_BY_KEY.get('plan')).toBeUndefined();
    expect(SETTING_BY_KEY.get('nonesuch')).toBeUndefined();
  });
});

describe('isCommandLineSetting', () => {
  it('is true for the settings a flag may name and false for the rest', () => {
    const named = SETTING_NAMES.filter(isCommandLineSetting);

    expect(named).toEqual([...COMMAND_LINE]);
  });
});

describe('SECTIONS', () => {
  it('holds every dotted prefix a setting sits under, and no setting key', () => {
    expect([...SECTIONS].sort()).toEqual([
      'board',
      'cleanup',
      'dangerous',
      'learning',
      'loop',
      'output',
      'plan',
      'pr',
      'prerequisites',
      'release',
      'roadmap',
      'specs',
      'tracker',
      'tracking',
    ]);
    expect(SECTIONS.has('modules')).toBe(false);
  });
});

describe('knownKeysAbove', () => {
  it('answers the top level for a key that sits at it', () => {
    expect(knownKeysAbove('nonesuch')).toEqual(['', TOP]);
  });

  it('answers a section for a key under it', () => {
    expect(knownKeysAbove('plan.depth')).toEqual(['plan', ['inject', 'dir']]);
    expect(knownKeysAbove('pr.nonesuch')).toEqual([
      'pr',
      ['provider', 'mergeMethod', 'base', 'resolveBudget'],
    ]);
    expect(knownKeysAbove('release.bump')).toEqual([
      'release',
      ['enabled', 'versionFile', 'changelog', 'heading'],
    ]);
    expect(knownKeysAbove('cleanup.staleDayz')).toEqual([
      'cleanup',
      ['staleDays', 'worktreeIdleDays', 'keep'],
    ]);
    expect(knownKeysAbove('dangerous.acceptStaleRef')).toEqual([
      'dangerous',
      ['acceptStaleRefs'],
    ]);
  });

  it('collapses a list index, so an item key answers the item shape', () => {
    expect(knownKeysAbove('prerequisites.required[0].timeout')).toEqual([
      'prerequisites.required[0]',
      ['tool', 'env', 'service', 'lsp', 'probe'],
    ]);
    expect(knownKeysAbove('modules[2].nonesuch')).toEqual([
      'modules[2]',
      ['npm', 'github', 'path', 'ref'],
    ]);
  });

  it('climbs to the nearest known path, falling back to the top level', () => {
    expect(knownKeysAbove('plan.a.b')).toEqual(['plan', ['inject', 'dir']]);
    expect(knownKeysAbove('nonesuch.deeper.deepest')).toEqual(['', TOP]);
  });
});
