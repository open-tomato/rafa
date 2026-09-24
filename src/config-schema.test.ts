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
 * The one reader here, `mapOf`, is driven directly as
 * `config-sections.test.ts` drives the rest, each refusal beside an
 * accepting control of the same reader.
 *
 * Every key and every section is SPELLED here, never read off
 * {@link SETTINGS}, so a module that renames a key or drops a section
 * fails rather than agreeing with itself.
 */
import type { ConfigSetting } from './config-schema.js';
import type { Reader, ValueAt } from './config-sections.js';

import { describe, expect, it } from 'bun:test';

import {
  isCommandLineSetting,
  knownKeysAbove,
  mapOf,
  SECTIONS,
  SETTING_BY_KEY,
  SETTING_NAMES,
  SETTINGS,
} from './config-schema.js';
import { flag, text } from './config-sections.js';

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
  ['statusNotice', 'status.notice'],
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
  'status',
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
      'status',
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
    expect(knownKeysAbove('status.notices')).toEqual(['status', ['notice']]);
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

describe('mapOf', () => {
  /** Where every map case reads its value. */
  const at: ValueAt = { label: 'F: m', key: 'm' };

  /** A map of names to YAML booleans. */
  const flags = mapOf(flag, 'true or false');

  /** An inner reader that accepts null, and retains one extra per value. */
  const anything: Reader<unknown> = (raw, where) => ({
    value: raw,
    problems: [],
    extras: [{ key: `${where.key}.seen`, value: raw }],
  });

  it('accepts a mapping, answering a Map in the order written', () => {
    const reading = flags({ b: true, a: false }, at);

    expect(reading.problems).toEqual([]);
    expect(reading.value).toBeInstanceOf(Map);
    expect([...(reading.value ?? [])]).toEqual([['b', true], ['a', false]]);
  });

  it('accepts an empty mapping as an empty Map', () => {
    expect(flags({}, at).value?.size).toBe(0);
  });

  it('refuses a list, a scalar and null, naming what it expected', () => {
    expect(flags(['a'], at)).toEqual({
      value: undefined,
      problems: ['F: m is a list, expected a mapping of names to true or false'],
      extras: [],
    });
    expect(flags('a', at).problems).toEqual([
      'F: m is "a", expected a mapping of names to true or false',
    ]);
    expect(flags(null, at).problems).toEqual([
      'F: m is null, expected a mapping of names to true or false',
    ]);
  });

  it('names every unusable value under its own name, and answers no value', () => {
    const reading = flags({ a: 'yes', b: true, c: 1 }, at);

    expect(reading.value).toBeUndefined();
    expect(reading.problems).toEqual([
      'F: m.a is "yes", expected true or false',
      'F: m.c is 1, expected true or false',
    ]);
  });

  it('refuses an empty or blank name beside an accepting control', () => {
    expect(flags({ '': true, ' ': false }, at).problems).toEqual([
      'F: m names "", expected a non-empty name',
      'F: m names " ", expected a non-empty name',
    ]);
    expect(flags({ ' a ': true }, at).value?.get(' a ')).toBe(true);
  });

  it('hands a null value to the inner reader rather than deciding for it', () => {
    expect(flags({ a: null }, at).problems).toEqual(['F: m.a is null, expected true or false']);
    expect(mapOf(anything, 'anything')({ a: null }, at).value?.get('a')).toBeNull();
  });

  it('carries the inner reader\'s extras, keyed under each name', () => {
    const reading = mapOf(anything, 'anything')({ a: 1, b: 2 }, at);

    expect(reading.extras).toEqual([
      { key: 'm.a.seen', value: 1 },
      { key: 'm.b.seen', value: 2 },
    ]);
  });

  it('keeps names an object would read off its prototype as ordinary names', () => {
    const raw: unknown = Bun.YAML.parse('__proto__: true\nconstructor: false\ntoString: true\n');
    const reading = mapOf(text('a name'), 'names')(raw, at);
    const names = flags(raw, at).value;

    expect(reading.problems).toEqual([
      'F: m.__proto__ is true, expected a name',
      'F: m.constructor is false, expected a name',
      'F: m.toString is true, expected a name',
    ]);
    expect([...(names ?? [])]).toEqual([
      ['__proto__', true],
      ['constructor', false],
      ['toString', true],
    ]);
    expect(names?.has('hasOwnProperty')).toBe(false);
  });

  it('answers a fresh Map on every read, so one caller cannot edit the next', () => {
    const first = flags({ a: true }, at).value;
    const second = flags({ a: true }, at).value;

    expect(first).not.toBe(second);
    expect(first).toEqual(second);
  });
});
