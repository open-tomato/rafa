/**
 * Tests for the pre-init directory check (`pre-init-dirs.ts`): which
 * resolved values count as a pre-init name, the spellings of one name
 * read as one, the values that count as nothing, and the warning each
 * finding prints.
 *
 * Every case plants its own config values — `.plans` and `.specs` appear
 * here on purpose, which is the exemption `src/tests/default-plan-dirs.test.ts`
 * carves out for `*.test.ts` files. Nothing is read from disk and no
 * project config is loaded: the check is a function of two strings, and
 * each case hands it the two it means.
 *
 * The defaulting case is the control for every warning case. It hands
 * the check `CONFIG_DEFAULTS` itself, so a check that had degenerated
 * into always warning would fail there, and a check that had degenerated
 * into never warning fails in the cases below it.
 */
import type { PreInitDirFound } from './pre-init-dirs.js';

import { join, sep } from 'node:path';

import { describe, expect, it } from 'bun:test';

import { CONFIG_DEFAULTS, CONFIG_FILE } from '../config.js';

import { PRE_INIT_DIRS, preInitWarning, readPreInitDirs } from './pre-init-dirs.js';

/** A config holding just the two settings the check reads. */
function configOf(planDir: string, specsDir: string): { planDir: string; specsDir: string } {
  return { planDir, specsDir };
}

/** The settings a reading found, as `<key>=<value>` pairs. */
function foundPairs(found: readonly PreInitDirFound[]): string[] {
  return found.map((dir) => `${dir.key}=${dir.value}`);
}

describe('the two names', () => {
  it('pairs each setting with its pre-init name and its default', () => {
    expect(PRE_INIT_DIRS.map((dir) => [dir.setting, dir.key, dir.preInit, dir.fallback])).toEqual([
      ['planDir', 'plan.dir', '.plans', join('.rafa', 'plans')],
      ['specsDir', 'specs.dir', '.specs', join('.rafa', 'specs')],
    ]);
  });

  it('takes each default from the config defaults rather than a literal', () => {
    expect(PRE_INIT_DIRS.map((dir) => dir.fallback))
      .toEqual([CONFIG_DEFAULTS.planDir, CONFIG_DEFAULTS.specsDir]);
  });
});

describe('a project on the defaults', () => {
  it('finds nothing and warns about nothing', () => {
    const reading = readPreInitDirs(CONFIG_DEFAULTS);

    expect(foundPairs(reading.found)).toEqual([]);
    expect(reading.warning).toBeNull();
  });

  it('finds nothing for directories that are neither pre-init nor default', () => {
    const reading = readPreInitDirs(configOf('docs/plans', join('docs', 'specs')));

    expect(foundPairs(reading.found)).toEqual([]);
    expect(reading.warning).toBeNull();
  });
});

describe('a project overriding one setting', () => {
  it('finds plan.dir alone and warns naming its default', () => {
    const reading = readPreInitDirs(configOf('.plans', CONFIG_DEFAULTS.specsDir));

    expect(foundPairs(reading.found)).toEqual(['plan.dir=.plans']);
    expect(reading.warning).toBe(
      `plan.dir is .plans, where the default is ${join('.rafa', 'plans')}. That is the directory rafa`
      + ` used before it had defaults of its own; dropping plan.dir from ${CONFIG_FILE} points rafa`
      + ' at the default, so move what is there first.',
    );
  });

  it('finds specs.dir alone when plan.dir is elsewhere', () => {
    const reading = readPreInitDirs(configOf('docs/plans', '.specs'));

    expect(foundPairs(reading.found)).toEqual(['specs.dir=.specs']);
    expect(reading.warning).toContain(`specs.dir is .specs, where the default is ${join('.rafa', 'specs')}`);
    expect(reading.warning).not.toContain('plan.dir');
  });

  it('does not cross the names: plan.dir naming the specs directory is no finding', () => {
    const reading = readPreInitDirs(configOf('.specs', '.plans'));

    expect(foundPairs(reading.found)).toEqual([]);
    expect(reading.warning).toBeNull();
  });
});

describe('a project overriding both settings', () => {
  it('finds both, in the order the settings are listed, and warns once', () => {
    const reading = readPreInitDirs(configOf('.plans', '.specs'));

    expect(foundPairs(reading.found)).toEqual(['plan.dir=.plans', 'specs.dir=.specs']);
    expect(reading.warning).toBe(
      `plan.dir is .plans, where the default is ${join('.rafa', 'plans')};`
      + ` specs.dir is .specs, where the default is ${join('.rafa', 'specs')}.`
      + ' Those are the directories rafa used before it had defaults of its own; dropping plan.dir and'
      + ` specs.dir from ${CONFIG_FILE} points rafa at the default, so move what is there first.`,
    );
  });
});

describe('spellings of one directory', () => {
  it('reads a leading ./ and a trailing separator as the pre-init name', () => {
    const reading = readPreInitDirs(configOf('./.plans', `.specs${sep}`));

    expect(foundPairs(reading.found)).toEqual(['plan.dir=./.plans', `specs.dir=.specs${sep}`]);
    expect(reading.warning).toContain('plan.dir is ./.plans');
  });

  it('keeps the value as the config spells it, not as it was compared', () => {
    const reading = readPreInitDirs(configOf('./.plans/', CONFIG_DEFAULTS.specsDir));

    expect(reading.found.map((dir) => dir.value)).toEqual(['./.plans/']);
  });

  it('reads a detour through a parent as the pre-init name', () => {
    const reading = readPreInitDirs(configOf('docs/../.plans', CONFIG_DEFAULTS.specsDir));

    expect(foundPairs(reading.found)).toEqual(['plan.dir=docs/../.plans']);
  });

  it('finds nothing for an absolute path ending in the pre-init name', () => {
    const reading = readPreInitDirs(configOf(join('/srv', 'shared', '.plans'), '/srv/shared/.specs'));

    expect(foundPairs(reading.found)).toEqual([]);
    expect(reading.warning).toBeNull();
  });

  it('finds nothing for a pre-init name nested under another directory', () => {
    const reading = readPreInitDirs(configOf('docs/.plans', 'docs/.specs'));

    expect(foundPairs(reading.found)).toEqual([]);
    expect(reading.warning).toBeNull();
  });
});

describe('the warning on its own', () => {
  it('answers null for no findings', () => {
    expect(preInitWarning([])).toBeNull();
  });

  it('names every finding it is handed', () => {
    const found: PreInitDirFound[] = PRE_INIT_DIRS.map((dir) => ({ ...dir, value: dir.preInit }));
    const warning = preInitWarning(found);

    expect(warning).toContain('plan.dir is .plans');
    expect(warning).toContain('specs.dir is .specs');
    expect(warning).toContain(CONFIG_FILE);
  });
});
