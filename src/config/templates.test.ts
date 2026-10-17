/**
 * Holds the config templates: `escalation` holds the six keys the plan
 * names and no other, each value spelled here rather than read off the
 * module, every value reads back through its setting's reader to what
 * it holds with no problem, a name the map does not hold answers null
 * (`constructor` included, the control that the lookup is no object
 * index), and every mapping and list is frozen. The hook the
 * registration sets is held in `config-registry.test.ts`.
 */
import { describe, expect, test } from 'bun:test';

import { SETTING_BY_KEY, SETTINGS } from '../config-registry.js';

import { CONFIG_TEMPLATES, TEMPLATE_NAMES, templateEntry } from './templates.js';

/** The `escalation` template's values, by file key, as the plan spells them. */
const ESCALATION_VALUES: readonly (readonly [key: string, value: readonly string[]])[] = [
  ['tests.fullSuiteTriggers', ['bunfig.toml', 'tsconfig*.json', 'package.json', 'bun.lock', 'bun.lockb']],
  [
    'tests.integration',
    ['**/*-integration.test.ts', '**/*.integration.test.ts', '**/*-spawned*.test.ts', '**/*-cli.test.ts'],
  ],
  ['tests.contract', ['**/*.contract.test.ts']],
  ['checks.task', ['affected']],
  ['checks.stage', ['related', 'integration']],
  ['checks.loop', ['full']],
];

/** Every dotted path to a value that is no plain mapping, below `entry`, with that value. */
function leavesOf(entry: unknown, above = ''): (readonly [string, unknown])[] {
  if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return [[above, entry]];
  return Object.entries(entry).flatMap(([key, value]) => leavesOf(
    value,
    above === ''
      ? key
      : `${above}.${key}`,
  ));
}

/** Every mapping and list below `value`, itself included. */
function containersOf(value: unknown): object[] {
  if (typeof value !== 'object' || value === null) return [];
  return [value, ...Object.values(value).flatMap(containersOf)];
}

describe('CONFIG_TEMPLATES', () => {
  test('holds the one template escalation, as TEMPLATE_NAMES lists', () => {
    expect(Object.keys(CONFIG_TEMPLATES)).toEqual(['escalation']);
    expect(TEMPLATE_NAMES).toEqual(['escalation']);
  });

  test('escalation holds the six keys of the plan, each at its value, and no other key', () => {
    expect(leavesOf(CONFIG_TEMPLATES.escalation)).toEqual([...ESCALATION_VALUES]);
  });

  test('every value of escalation reads back through its setting\'s reader to itself', () => {
    const readings = leavesOf(CONFIG_TEMPLATES.escalation).map(([key, value]) => {
      const setting = SETTING_BY_KEY.get(key);
      if (setting === undefined) return { key, setting: null };
      const reading = SETTINGS[setting].read(value, { label: key, key });
      return { key, problems: reading.problems, value: reading.value };
    });

    expect(readings).toEqual(ESCALATION_VALUES.map(([key, value]) => ({ key, problems: [], value })));
  });

  test('is frozen at every mapping and list', () => {
    const containers = containersOf(CONFIG_TEMPLATES);

    expect(containers.length).toBe(10);
    expect(containers.filter((container) => !Object.isFrozen(container))).toEqual([]);
  });
});

describe('templateEntry', () => {
  test('answers the entry a known name stands for', () => {
    expect(templateEntry('escalation')).toBe(CONFIG_TEMPLATES.escalation);
  });

  test('answers null for a name the map does not hold', () => {
    expect(templateEntry('escalate')).toBeNull();
    expect(templateEntry('')).toBeNull();
  });

  test('answers null for a name Object.prototype holds', () => {
    expect(templateEntry('constructor')).toBeNull();
    expect(templateEntry('__proto__')).toBeNull();
    expect(templateEntry('toString')).toBeNull();
  });

  test('carries TEMPLATE_NAMES as the names it knows, frozen with it', () => {
    expect(templateEntry.names).toBe(TEMPLATE_NAMES);
    expect(Object.isFrozen(templateEntry)).toBe(true);
  });
});
