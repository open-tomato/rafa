/**
 * Tests for the `issues` section: `issues.titles.bug`,
 * `issues.titles.summaryMax`, `issues.environments`,
 * `issues.vocabulary.modules` and `issues.vocabulary.actions`, and the
 * rules a bug record is checked against.
 *
 * Each key is driven through the spec `SETTINGS` holds for it. Every
 * refusal sits beside an accepting control, and every key and message is
 * SPELLED, never read off the module.
 */
import type { ConfigSetting } from './core/config/index.js';

import { describe, expect, it } from 'bun:test';

import { templateProblem } from './bugs/title.js';
import { CONFIG_DEFAULTS, SETTINGS } from './config-registry.js';
import { bugRulesOf, ISSUES_SECTION } from './config-schema-issues.js';
import {
  EMPTY_CONFIG_REGISTRY,
  mergeConfigSections,
  parseConfigText,
  resolveConfig,
} from './core/config/index.js';
import { RAFA_CODES } from './errors/rafa-codes.js';
import { projectConfigText } from './project/scaffold.js';

/** What `setting` reads `raw` as, under its own file key. */
function read(setting: ConfigSetting, raw: unknown): { value: unknown; problems: readonly string[]; extras: readonly unknown[] } {
  const spec = SETTINGS[setting];
  return spec.read(raw, { label: `F: ${spec.key}`, key: spec.key });
}

describe('issues.titles.bug', () => {
  it('accepts a template as written', () => {
    const template = '?([${project}] )?(${module}?( - ${action}): )${summary}';
    expect(read('issuesTitleBug', template).value).toBe(template);
  });

  it('refuses a template that cannot be parsed, saying why', () => {
    expect(read('issuesTitleBug', '${module} ${summary').problems).toEqual([
      'F: issues.titles.bug is "${module} ${summary", expected a title template: "${" at 10 is never closed',
    ]);
  });

  it('refuses a template whose own title does not read back', () => {
    expect(read('issuesTitleBug', '?(${project})${summary}').problems).toEqual([
      'F: issues.titles.bug is "?(${project})${summary}", expected a title template: the title'
      + ' "Does not find the branch: again" does not read back as the fields it was rendered from',
    ]);
  });

  it('refuses a blank string and a value that is no string', () => {
    expect(read('issuesTitleBug', '  ').problems).toEqual(['F: issues.titles.bug is "  ", expected a title template']);
    expect(read('issuesTitleBug', 3).problems).toEqual(['F: issues.titles.bug is 3, expected a title template']);
  });
});

describe('issues.titles.summaryMax', () => {
  it('accepts a whole number from 20 to 120', () => {
    expect(read('issuesSummaryMax', 20).value).toBe(20);
    expect(read('issuesSummaryMax', 70).value).toBe(70);
    expect(read('issuesSummaryMax', 120).value).toBe(120);
  });

  it.each([[19, '19'], [121, '121'], [70.5, '70.5'], ['70', '"70"'], [true, 'true']])('refuses %p', (raw, shown) => {
    expect(read('issuesSummaryMax', raw).problems).toEqual([
      `F: issues.titles.summaryMax is ${shown}, expected a whole number from 20 to 120`,
    ]);
  });
});

describe('issues.environments', () => {
  it('accepts a list of places', () => {
    expect(read('issuesEnvironments', ['staging', 'pre-prod']).value).toEqual(['staging', 'pre-prod']);
    expect(read('issuesEnvironments', []).value).toEqual([]);
  });

  it.each(['Staging', 'ci', 'unknown', 'pre prod'])('refuses the place %p', (place) => {
    expect(read('issuesEnvironments', [place]).problems).toEqual([
      `F: issues.environments[0] is "${place}", expected a place name in lower-case kebab-case, other than local, ci, prod and unknown`,
    ]);
  });

  it('refuses a value that is no list', () => {
    expect(read('issuesEnvironments', 'staging').problems).toEqual(['F: issues.environments is "staging", expected a list of place names']);
  });
});

describe('issues.vocabulary', () => {
  it('accepts module names, and actions with spaces', () => {
    expect(read('issuesVocabularyModules', ['auth', 'cli-gap']).value).toEqual(['auth', 'cli-gap']);
    expect(read('issuesVocabularyActions', ['login', 'pr show']).value).toEqual(['login', 'pr show']);
  });

  it('refuses a name off its shape, naming its place in the list', () => {
    expect(read('issuesVocabularyModules', ['auth', 'Auth']).problems).toEqual([
      'F: issues.vocabulary.modules[1] is "Auth", expected a module name in lower-case letters, digits, ".", "_" and "-", other than unknown',
    ]);
    expect(read('issuesVocabularyModules', ['pr show']).problems).toHaveLength(1);
    expect(read('issuesVocabularyModules', ['unknown']).problems).toHaveLength(1);
    expect(read('issuesVocabularyActions', ['PR show']).problems).toEqual([
      'F: issues.vocabulary.actions[0] is "PR show", expected an action in lower-case letters, digits, ".", "_", "-" and spaces, other than unknown',
    ]);
  });
});

describe('the issues defaults', () => {
  it('are the default template, 80 characters, no added place and no vocabulary', () => {
    expect(CONFIG_DEFAULTS.issuesTitleBug).toBe('?(${module}?( - ${action}): )${summary}');
    expect(CONFIG_DEFAULTS.issuesSummaryMax).toBe(80);
    expect(CONFIG_DEFAULTS.issuesEnvironments).toEqual([]);
    expect(CONFIG_DEFAULTS.issuesVocabularyModules).toEqual([]);
    expect(CONFIG_DEFAULTS.issuesVocabularyActions).toEqual([]);
    expect(templateProblem(CONFIG_DEFAULTS.issuesTitleBug)).toBeNull();
  });
});

describe('the rules a bug record is checked against', () => {
  it('hold the built-in places, the defaults and rafa\'s codes for a config that sets nothing', () => {
    const rules = bugRulesOf(CONFIG_DEFAULTS);
    expect(rules.environments).toEqual(['local', 'ci', 'prod']);
    expect(rules.summaryMax).toBe(80);
    expect(rules.template).toBe('?(${module}?( - ${action}): )${summary}');
    expect(rules.modules).toEqual([]);
    expect(rules.actions).toEqual([]);
    expect(rules.codes.map((entry) => entry.code)).toEqual(RAFA_CODES.map((entry) => entry.code));
  });

  it('hold what a config file sets, the project\'s places after the built-in ones and its codes after rafa\'s', () => {
    const text = [
      projectConfigText(),
      'issues:',
      '  titles:',
      '    bug: "?([${project}] )${summary}"',
      '    summaryMax: 70',
      '  environments: [staging]',
      '  vocabulary:',
      '    modules: [auth, billing]',
      '    actions: [login]',
      'errors:',
      '  codes:',
      '    - { code: "billing:card-declined", description: "the card was declined", hint: "ask for another card", level: error }',
      '',
    ].join('\n');
    const rules = bugRulesOf(resolveConfig({ file: parseConfigText(text, 'F') }).config);
    expect(rules).toMatchObject({
      template: '?([${project}] )${summary}',
      summaryMax: 70,
      environments: ['local', 'ci', 'prod', 'staging'],
      modules: ['auth', 'billing'],
      actions: ['login'],
    });
    expect(rules.codes.at(-1)?.code).toBe('billing:card-declined');
  });
});

describe('the section', () => {
  it('is package issues, defining its keys in this order with these defaults, with no check', () => {
    expect(ISSUES_SECTION.package).toBe('issues');
    expect(Object.entries(ISSUES_SECTION.settings).map(([setting, spec]) => [setting, spec?.key])).toEqual([
      ['issuesTitleBug', 'issues.titles.bug'],
      ['issuesSummaryMax', 'issues.titles.summaryMax'],
      ['issuesEnvironments', 'issues.environments'],
      ['issuesVocabularyModules', 'issues.vocabulary.modules'],
      ['issuesVocabularyActions', 'issues.vocabulary.actions'],
    ]);
    expect(ISSUES_SECTION.defaults).toEqual({
      issuesTitleBug: '?(${module}?( - ${action}): )${summary}',
      issuesSummaryMax: 80,
      issuesEnvironments: [],
      issuesVocabularyModules: [],
      issuesVocabularyActions: [],
    });
    expect(ISSUES_SECTION.checks ?? []).toEqual([]);
  });

  it('hands in the very specs SETTINGS reads, frozen', () => {
    const entries = Object.entries(ISSUES_SECTION.settings);

    expect(entries.length).toBeGreaterThan(0);
    for (const [setting, spec] of entries) {
      expect([setting, SETTINGS[setting as ConfigSetting] === spec]).toEqual([setting, true]);
    }
    expect(Object.isFrozen(ISSUES_SECTION)).toBe(true);
    expect(Object.isFrozen(ISSUES_SECTION.settings)).toBe(true);
    expect(Object.isFrozen(ISSUES_SECTION.defaults)).toBe(true);
  });

  it('registers alone, each of its settings paired with a default', () => {
    const registry = mergeConfigSections(EMPTY_CONFIG_REGISTRY, [ISSUES_SECTION]);

    expect(registry.sections.map((section) => section.package)).toEqual(['issues']);
    expect(Object.keys(registry.settings)).toEqual(Object.keys(ISSUES_SECTION.settings));
    expect(Object.keys(registry.defaults).sort()).toEqual(Object.keys(ISSUES_SECTION.settings).sort());
  });
});
