/**
 * Tests for the `checks` section: the seven check-point keys, each a
 * list of check names read by `checkList`.
 *
 * Each key is driven through the spec `SETTINGS` holds for it, so what
 * is proved is the reader the schema wires to the key, not a reader of
 * the same name. Every refusal sits beside an accepting control of the
 * same spec, so a reader that refused everything fails here. Every key,
 * name and default is SPELLED, never read off the module, so a module
 * that renames a key or widens the vocabulary fails rather than
 * agreeing with itself.
 */
import type { ConfigSetting } from '@open-tomato/rafa/core/config';

import { describe, expect, it } from 'bun:test';

import { parseConfigText, resolveConfig } from '@open-tomato/rafa/core/config';

import { CONFIG_DEFAULTS, SETTINGS } from './config-registry.js';
import { CHECK_NAMES, checkList, CHECKS_DEFAULTS, CHECKS_SECTION } from './config-schema-checks.js';

/** The label every file case parses under. No file is read at it. */
const PATH = '/repo/.rafa/config.yaml';

/** The six names, spelled, in the order a refusal lists them. */
const SIX = ['affected', 'related', 'unit', 'contract', 'integration', 'full'] as const;

/** How a refusal lists the six. */
const SIX_LISTED = 'affected, related, unit, contract, integration, full';

/** The seven settings and their file keys, in schema order. */
const KEYS: readonly (readonly [ConfigSetting, string])[] = [
  ['checksTask', 'checks.task'],
  ['checksStage', 'checks.stage'],
  ['checksLoop', 'checks.loop'],
  ['checksPullRequest', 'checks.pullRequest'],
  ['checksStretch', 'checks.stretch'],
  ['checksReleasePullRequest', 'checks.releasePullRequest'],
  ['checksPublish', 'checks.publish'],
];

/** Reads `raw` through the spec `SETTINGS` holds for `setting`. */
function readAs(setting: ConfigSetting, raw: unknown) {
  const { key } = SETTINGS[setting];
  return SETTINGS[setting].read(raw, { label: `F: ${key}`, key });
}

describe('the checks section', () => {
  it('exports the six names, frozen, in order', () => {
    expect(CHECK_NAMES).toEqual([...SIX]);
    expect(Object.isFrozen(CHECK_NAMES)).toBe(true);
  });

  it('spells its package checks and holds the seven settings in order', () => {
    expect(CHECKS_SECTION.package).toBe('checks');
    expect(Object.keys(CHECKS_SECTION.settings)).toEqual(KEYS.map(([setting]) => setting));
    expect(Object.isFrozen(CHECKS_DEFAULTS)).toBe(true);
  });
});

describe.each(KEYS)('%s', (setting, key) => {
  it(`is spelled ${key}, file-only, read through checkList`, () => {
    expect(SETTINGS[setting].key).toBe(key);
    expect(SETTINGS[setting].cli).toBe(false);
    expect(SETTINGS[setting].read).toBe(checkList);
  });

  it('resolves to an empty list from the defaults when no layer names it', () => {
    expect(CONFIG_DEFAULTS[setting]).toEqual([]);
    expect(resolveConfig().config[setting]).toEqual([]);
    expect(resolveConfig().sources[setting]).toBe('default');
  });

  it.each([...SIX])('reads %s alone', (name) => {
    expect(readAs(setting, [name])).toEqual({ value: [name], problems: [], extras: [] });
  });

  it('reads all six together, frozen, in the order written', () => {
    const written = ['full', 'integration', 'contract', 'unit', 'related', 'affected'];
    const reading = readAs(setting, written);

    expect(reading).toEqual({ value: written, problems: [], extras: [] });
    expect(Object.isFrozen(reading.value)).toBe(true);
  });

  it('reads an empty list as said', () => {
    expect(readAs(setting, [])).toEqual({ value: [], problems: [], extras: [] });
  });

  it('refuses a name written twice, naming the key, the name and the six', () => {
    const reading = readAs(setting, ['unit', 'related', 'unit']);

    expect(reading.value).toBeUndefined();
    expect(reading.problems).toHaveLength(1);
    expect(reading.problems[0]).toStartWith(`F: ${key} is a list, expected `);
    expect(reading.problems[0]).toContain(SIX_LISTED);
    expect(reading.problems[0]).toContain('"unit" is written twice');
  });

  it('refuses a name outside the six, naming the key and the six', () => {
    expect(readAs(setting, ['unit', 'bun test'])).toEqual({
      value: undefined,
      problems: [`F: ${key}[1] is "bun test", expected one of: ${SIX_LISTED}`],
      extras: [],
    });
  });

  it('refuses a value that is not a list, naming the key and the six', () => {
    const reading = readAs(setting, 'unit');

    expect(reading.value).toBeUndefined();
    expect(reading.problems).toEqual([`F: ${key} is "unit", expected a list of check names from: ${SIX_LISTED}`]);
  });
});

describe('a file naming the checks', () => {
  it('resolves what it writes from the file, and every key it leaves out to the empty default', () => {
    const file = parseConfigText('checks:\n  task: [affected]\n  stage: [related, integration]\n', PATH);
    const { config, sources } = resolveConfig({ file });

    expect(config.checksTask).toEqual(['affected']);
    expect(config.checksStage).toEqual(['related', 'integration']);
    expect(sources.checksTask).toBe('file');
    expect(config.checksLoop).toEqual([]);
    expect(sources.checksLoop).toBe('default');
  });

  it('refuses a repeated name as the file is read, naming the file and the key', () => {
    const read = () => parseConfigText('checks:\n  loop: [full, full]\n', PATH);

    expect(read).toThrow(/\/repo\/\.rafa\/config\.yaml: checks\.loop is a list, expected .*"full" is written twice/);
  });
});
