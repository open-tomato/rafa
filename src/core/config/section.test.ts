/**
 * Tests for the section contract: what a merge accepts and answers, the
 * three refusals and the sentences they spell, and the active registry
 * the readers answer.
 *
 * The fixture sections borrow real specs from `CORE_SECTION` in
 * `core-section.ts`, since a section's setting names are
 * {@link RafaConfig} fields and a made-up name would not compile. Every
 * refusal is spelled here in full, and each sits beside a case the merge
 * accepts, so a merge refusing everything fails as surely as one
 * refusing nothing.
 *
 * The active registry is module state, and bun runs every test file in
 * one process. Each case that touches it reads the registry in place
 * through `registerConfigSections([])`, starts from
 * `EMPTY_CONFIG_REGISTRY`, and puts the one it read back in a `finally`,
 * so a registry another file registered is neither read nor lost here.
 *
 * Eight mutations were driven against `section.ts` on 2026-10-14, one
 * run each, with the unmutated module at 15 pass before them and
 * restored sha256-identical after, and every one reddened at least one
 * case: the setting-name refusal dropped (4 fail), the `dangerous.`
 * refusal dropped (2), the `dangerous.` prefix test dropped so any key
 * defined twice is refused (3), the completeness refusal dropped (2),
 * the section held uncopied (1), `registerConfigSections` leaving the
 * active registry unchanged (2), the package refusal dropped (1), and
 * the merged checks left empty (2).
 *
 * The key indexes (`activeSettingByKey`, `activeSectionPaths` and
 * `activeKnownKeysAbove`) are driven over the fixture sections alone,
 * in an emptied registry, so every key and section they answer is one
 * a case here registered. Each index is built once per registry, so a
 * case registers a second section after reading the first and holds
 * that the read answers the new registry rather than the cached one.
 *
 * The load hook is module state too, apart from the registry. Each case
 * that sets one reads the hook in place first and puts it back in a
 * `finally`, so the hook `src/config-registry.ts` set for every later
 * file survives this one.
 */
import type {
  ConfigCheck,
  ConfigCheckInput,
  ConfigLoadHook,
  ConfigSection,
  ConfigSectionRegistry,
} from './section.js';

import '../../config-registry.js';

import { describe, expect, it } from 'bun:test';

import { resolveConfig } from './config.js';
import { CORE_SECTION } from './core-section.js';
import {
  activeChecks,
  activeConfigLoadHook,
  activeDefaults,
  activeKnownKeysAbove,
  activeSectionPaths,
  activeSections,
  activeSettingByKey,
  activeSettings,
  ConfigSectionError,
  EMPTY_CONFIG_REGISTRY,
  mergeConfigSections,
  registerConfigSections,
  restoreConfigSections,
  setConfigLoadHook,
} from './section.js';

/** Core's specs, which the fixture sections borrow. */
const SETTINGS = CORE_SECTION.settings;

/** A check refusing every config, with one sentence naming `name` and the store it read. */
function refusing(name: string): ConfigCheck {
  return ({ config, sources }) => [`${name} refuses store ${config.store} from ${sources.store}`];
}

/** The store and plan settings, under the package `alpha`. */
function alpha(): ConfigSection {
  return {
    package: 'alpha',
    settings: { store: SETTINGS.store, planDir: SETTINGS.planDir },
    defaults: { store: 'sqlite', planDir: '.rafa/plans' },
    checks: [refusing('alpha')],
  };
}

/** The stale-refs consent, under the package `beta`. */
function beta(): ConfigSection {
  return {
    package: 'beta',
    settings: { dangerousAcceptStaleRefs: SETTINGS.dangerousAcceptStaleRefs },
    defaults: { dangerousAcceptStaleRefs: false },
  };
}

/** The `ConfigSectionError` `run` throws, or a failure when it throws none. */
function refusalOf(run: () => unknown): ConfigSectionError {
  try {
    run();
  } catch (error) {
    if (error instanceof ConfigSectionError) return error;
    throw error;
  }
  throw new Error('expected a ConfigSectionError, and nothing was thrown');
}

/** Runs `run` with the active registry empty, and puts the one in place back after. */
function withEmptyRegistry(run: () => void): void {
  const previous = registerConfigSections([]);
  restoreConfigSections(EMPTY_CONFIG_REGISTRY);
  try {
    run();
  } finally {
    restoreConfigSections(previous);
  }
}

/** A resolved input for a check: no layer, every setting at its default. */
const CHECK_INPUT: ConfigCheckInput = resolveConfig();

describe('mergeConfigSections', () => {
  it('answers an empty registry before any merge', () => {
    expect(EMPTY_CONFIG_REGISTRY.sections).toEqual([]);
    expect(EMPTY_CONFIG_REGISTRY.settings).toEqual({});
    expect(EMPTY_CONFIG_REGISTRY.defaults).toEqual({});
    expect(EMPTY_CONFIG_REGISTRY.checks).toEqual([]);
    expect(Object.isFrozen(EMPTY_CONFIG_REGISTRY)).toBe(true);
  });

  it('merges the settings, defaults and checks of every section, in order', () => {
    const merged = mergeConfigSections(EMPTY_CONFIG_REGISTRY, [alpha(), beta()]);

    expect(Object.keys(merged.settings)).toEqual(['store', 'planDir', 'dangerousAcceptStaleRefs']);
    expect(merged.settings.store).toBe(SETTINGS.store);
    expect(merged.settings.dangerousAcceptStaleRefs).toBe(SETTINGS.dangerousAcceptStaleRefs);
    expect(merged.defaults).toEqual({
      store: 'sqlite',
      planDir: '.rafa/plans',
      dangerousAcceptStaleRefs: false,
    });
    expect(merged.checks.flatMap((check) => check(CHECK_INPUT))).toEqual(['alpha refuses store sqlite from default']);
    expect(merged.sections.map((section) => section.package)).toEqual(['alpha', 'beta']);
  });

  it('merges onto an earlier registry and leaves that registry unchanged', () => {
    const first = mergeConfigSections(EMPTY_CONFIG_REGISTRY, [alpha()]);
    const second = mergeConfigSections(first, [beta()]);

    expect(Object.keys(first.settings)).toEqual(['store', 'planDir']);
    expect(Object.keys(second.settings)).toEqual(['store', 'planDir', 'dangerousAcceptStaleRefs']);
    expect(EMPTY_CONFIG_REGISTRY.sections).toEqual([]);
  });

  it('holds a frozen copy, so a section edited after the merge changes nothing', () => {
    const section = {
      package: 'alpha',
      settings: { store: SETTINGS.store },
      defaults: { store: 'sqlite' as const },
    };
    const merged = mergeConfigSections(EMPTY_CONFIG_REGISTRY, [section]);
    Object.assign(section.defaults, { store: 'ndjson' });
    section.package = 'renamed';

    expect(merged.defaults.store).toBe('sqlite');
    expect(merged.sections[0]?.package).toBe('alpha');
    expect(Object.isFrozen(merged.settings)).toBe(true);
    expect(Object.isFrozen(merged.defaults)).toBe(true);
    expect(Object.isFrozen(merged.sections[0]?.settings)).toBe(true);
  });

  it('refuses a setting name a second package registers, in one call, naming both', () => {
    const other: ConfigSection = {
      package: 'gamma',
      settings: { store: SETTINGS.store },
      defaults: { store: 'ndjson' },
    };
    const refusal = refusalOf(() => mergeConfigSections(EMPTY_CONFIG_REGISTRY, [alpha(), other]));

    expect(refusal.problems).toEqual([
      'setting store is registered by package "alpha" and again by package "gamma"',
    ]);
    expect(refusal.message).toBe(
      'rafa config sections: setting store is registered by package "alpha" and again by package "gamma"',
    );
  });

  it('refuses a setting name an earlier registration holds, naming both packages', () => {
    const first = mergeConfigSections(EMPTY_CONFIG_REGISTRY, [beta()]);
    const again: ConfigSection = { ...beta(), package: 'delta' };
    const refusal = refusalOf(() => mergeConfigSections(first, [again]));

    expect(refusal.problems).toEqual([
      'setting dangerousAcceptStaleRefs is registered by package "beta" and again by package "delta"',
      'dangerous.acceptStaleRefs is defined by package "beta" and again by package "delta";'
        + ' a dangerous. key is a person\'s consent and one package defines it',
    ]);
  });

  it('refuses a dangerous. key a second package defines under another setting name, naming both', () => {
    const redefined: ConfigSection = {
      package: 'epsilon',
      settings: {
        dangerousSelfUpdateDuringLoop: { ...SETTINGS.dangerousSelfUpdateDuringLoop, key: 'dangerous.acceptStaleRefs' },
      },
      defaults: { dangerousSelfUpdateDuringLoop: false },
    };
    const refusal = refusalOf(() => mergeConfigSections(EMPTY_CONFIG_REGISTRY, [beta(), redefined]));

    expect(refusal.problems).toEqual([
      'file key dangerous.acceptStaleRefs is defined by package "beta" under setting dangerousAcceptStaleRefs'
        + ' and again by package "epsilon" under setting dangerousSelfUpdateDuringLoop',
    ]);
  });

  it('refuses a file key outside dangerous. a second package defines under another setting name, naming both', () => {
    const specsUnderPlanKey: ConfigSection = {
      package: 'zeta',
      settings: { specsDir: { ...SETTINGS.specsDir, key: 'plan.dir' } },
      defaults: { specsDir: '.rafa/specs' },
    };
    const refusal = refusalOf(() => mergeConfigSections(EMPTY_CONFIG_REGISTRY, [alpha(), specsUnderPlanKey]));

    expect(refusal.problems).toEqual([
      'file key plan.dir is defined by package "alpha" under setting planDir'
        + ' and again by package "zeta" under setting specsDir',
    ]);
  });

  it('refuses a file key an earlier registration holds under another setting name', () => {
    const first = mergeConfigSections(EMPTY_CONFIG_REGISTRY, [alpha()]);
    const storeUnderPlanKey: ConfigSection = {
      package: 'kappa',
      settings: { specsDir: { ...SETTINGS.specsDir, key: 'store' } },
      defaults: { specsDir: '.rafa/specs' },
    };
    const refusal = refusalOf(() => mergeConfigSections(first, [storeUnderPlanKey]));

    expect(refusal.problems).toEqual([
      'file key store is defined by package "alpha" under setting store'
        + ' and again by package "kappa" under setting specsDir',
    ]);
    expect(Object.keys(first.settings)).toEqual(['store', 'planDir']);
  });

  it('accepts two dangerous. keys of two packages, and a setting under a key of its own beside a section', () => {
    const selfUpdate: ConfigSection = {
      package: 'epsilon',
      settings: { dangerousSelfUpdateDuringLoop: SETTINGS.dangerousSelfUpdateDuringLoop },
      defaults: { dangerousSelfUpdateDuringLoop: false },
    };
    const specsUnderPlan: ConfigSection = {
      package: 'zeta',
      settings: { specsDir: { ...SETTINGS.specsDir, key: 'plan.specs' } },
      defaults: { specsDir: '.rafa/specs' },
    };
    const merged = mergeConfigSections(EMPTY_CONFIG_REGISTRY, [alpha(), beta(), selfUpdate, specsUnderPlan]);

    expect(Object.keys(merged.settings)).toEqual([
      'store',
      'planDir',
      'dangerousAcceptStaleRefs',
      'dangerousSelfUpdateDuringLoop',
      'specsDir',
    ]);
  });

  it('refuses a default given for a field no section defines a setting for', () => {
    const halfDefault: ConfigSection = {
      package: 'eta',
      settings: {},
      defaults: { trackingAll: false },
    };
    const refusal = refusalOf(() => mergeConfigSections(EMPTY_CONFIG_REGISTRY, [alpha(), halfDefault]));

    expect(refusal.problems).toEqual([
      'package "eta" gives a default for trackingAll, a RafaConfig field no section defines a setting for',
    ]);
  });

  it('refuses a setting no section gives a default for', () => {
    const halfSetting: ConfigSection = {
      package: 'theta',
      settings: { trackingAll: SETTINGS.trackingAll },
      defaults: {},
    };
    const refusal = refusalOf(() => mergeConfigSections(EMPTY_CONFIG_REGISTRY, [halfSetting]));

    expect(refusal.problems).toEqual([
      'package "theta" defines setting trackingAll, a RafaConfig field no section gives a default for',
    ]);
  });

  it('accepts a setting and its default given by two sections', () => {
    const halfSetting: ConfigSection = {
      package: 'theta',
      settings: { trackingAll: SETTINGS.trackingAll },
      defaults: {},
    };
    const halfDefault: ConfigSection = {
      package: 'eta',
      settings: {},
      defaults: { trackingAll: false },
    };
    const merged = mergeConfigSections(EMPTY_CONFIG_REGISTRY, [halfSetting, halfDefault]);

    expect(merged.settings.trackingAll).toBe(SETTINGS.trackingAll);
    expect(merged.defaults.trackingAll).toBe(false);
  });

  it('refuses a section with no package name, alongside every other problem', () => {
    const nameless: ConfigSection = {
      package: '',
      settings: { store: SETTINGS.store },
      defaults: {},
    };
    const refusal = refusalOf(() => mergeConfigSections(EMPTY_CONFIG_REGISTRY, [alpha(), nameless]));

    expect(refusal.problems).toEqual([
      'a section\'s package is ""; expected a non-empty package name',
      'setting store is registered by package "alpha" and again by package ""',
    ]);
  });
});

describe('registerConfigSections', () => {
  it('merges into the active registry the readers answer, and answers the one it replaced', () => {
    withEmptyRegistry(() => {
      const before = registerConfigSections([alpha()]);
      expect(before).toBe(EMPTY_CONFIG_REGISTRY);
      registerConfigSections([beta()]);

      expect(Object.keys(activeSettings())).toEqual(['store', 'planDir', 'dangerousAcceptStaleRefs']);
      expect(activeDefaults()).toEqual({
        store: 'sqlite',
        planDir: '.rafa/plans',
        dangerousAcceptStaleRefs: false,
      });
      expect(activeChecks().flatMap((check) => check(CHECK_INPUT))).toEqual(['alpha refuses store sqlite from default']);
      expect(activeSections().map((section) => section.package)).toEqual(['alpha', 'beta']);
    });
  });

  it('leaves the active registry as it was when a registration is refused', () => {
    withEmptyRegistry(() => {
      registerConfigSections([beta()]);
      const held: ConfigSectionRegistry = registerConfigSections([]);
      const redefined: ConfigSection = { ...beta(), package: 'iota' };

      const refusal = refusalOf(() => registerConfigSections([alpha(), redefined]));
      expect(refusal.problems[0]).toBe(
        'setting dangerousAcceptStaleRefs is registered by package "beta" and again by package "iota"',
      );
      expect(Object.keys(activeSettings())).toEqual(Object.keys(held.settings));
      expect(activeDefaults()).toEqual(held.defaults);
    });
  });

  it('puts back the registry restoreConfigSections is handed', () => {
    withEmptyRegistry(() => {
      const before = registerConfigSections([alpha()]);
      restoreConfigSections(before);

      expect(activeSettings()).toEqual({});
      expect(activeDefaults()).toEqual({});
      expect(activeChecks()).toEqual([]);
      expect(activeSections()).toEqual([]);
    });
  });
});

/** The prerequisite lists and the modules, under the package `gamma`: settings with item keys. */
function gamma(): ConfigSection {
  return {
    package: 'gamma',
    settings: {
      prerequisitesRequired: SETTINGS.prerequisitesRequired,
      modules: SETTINGS.modules,
      learningBlessMinConfidence: SETTINGS.learningBlessMinConfidence,
    },
    defaults: {
      prerequisitesRequired: [],
      modules: [],
      learningBlessMinConfidence: 0.5,
    },
  };
}

describe('the key indexes', () => {
  it('reads every registered file key back to its setting, and nothing else', () => {
    withEmptyRegistry(() => {
      registerConfigSections([alpha(), beta()]);

      expect([...activeSettingByKey()]).toEqual([
        ['store', 'store'],
        ['plan.dir', 'planDir'],
        ['dangerous.acceptStaleRefs', 'dangerousAcceptStaleRefs'],
      ]);
      expect(activeSettingByKey().get('plan')).toBeUndefined();
      expect(activeSettingByKey().get('constructor')).toBeUndefined();
    });
  });

  it('opens every dotted prefix a registered setting sits under, and no setting key', () => {
    withEmptyRegistry(() => {
      registerConfigSections([alpha(), gamma()]);

      expect([...activeSectionPaths()].sort()).toEqual(['learning', 'learning.bless', 'plan', 'prerequisites']);
      expect(activeSectionPaths().has('modules')).toBe(false);
      expect(activeSectionPaths().has('__proto__')).toBe(false);
    });
  });

  it('answers the nearest registered path above a key, in registration order, falling back to the top', () => {
    withEmptyRegistry(() => {
      registerConfigSections([alpha(), gamma(), beta()]);

      expect(activeKnownKeysAbove('nonesuch')).toEqual(['', ['store', 'plan', 'prerequisites', 'modules', 'learning', 'dangerous']]);
      expect(activeKnownKeysAbove('plan.depth')).toEqual(['plan', ['dir']]);
      expect(activeKnownKeysAbove('plan.a.b')).toEqual(['plan', ['dir']]);
      expect(activeKnownKeysAbove('learning.bless.after')).toEqual(['learning.bless', ['minConfidence']]);
      expect(activeKnownKeysAbove('learning.promote')).toEqual(['learning', ['bless']]);
      expect(activeKnownKeysAbove('nonesuch.deeper.deepest')[0]).toBe('');
    });
  });

  it('collapses a list index, so an item key answers the item shape', () => {
    withEmptyRegistry(() => {
      registerConfigSections([gamma()]);

      expect(activeKnownKeysAbove('prerequisites.required[0].timeout')).toEqual([
        'prerequisites.required[0]',
        ['tool', 'env', 'service', 'lsp', 'probe'],
      ]);
      expect(activeKnownKeysAbove('modules[2].nonesuch')).toEqual(['modules[2]', ['npm', 'github', 'path', 'ref']]);
    });
  });

  it('answers the registry in place after a registration, not the one read before it', () => {
    withEmptyRegistry(() => {
      registerConfigSections([alpha()]);
      const before = [activeSettingByKey().size, [...activeSectionPaths()], activeKnownKeysAbove('x')[1]];
      registerConfigSections([beta()]);

      expect(before).toEqual([2, ['plan'], ['store', 'plan']]);
      expect(activeSettingByKey().get('dangerous.acceptStaleRefs')).toBe('dangerousAcceptStaleRefs');
      expect([...activeSectionPaths()]).toEqual(['plan', 'dangerous']);
      expect(activeKnownKeysAbove('x')[1]).toEqual(['store', 'plan', 'dangerous']);
    });
  });

  it('answers nothing with no section registered', () => {
    withEmptyRegistry(() => {
      expect(activeSettingByKey().size).toBe(0);
      expect(activeSectionPaths().size).toBe(0);
      expect(activeKnownKeysAbove('plan.inject')).toEqual(['', []]);
    });
  });
});

describe('setConfigLoadHook', () => {
  it('makes the hook activeConfigLoadHook answers, answering the one it replaced, and clears it with null', () => {
    const held = activeConfigLoadHook();
    const first: ConfigLoadHook = () => {};
    const second: ConfigLoadHook = () => {};
    try {
      const replaced = [setConfigLoadHook(first), setConfigLoadHook(second)];
      const active = activeConfigLoadHook();
      const cleared = setConfigLoadHook(null);

      expect(replaced).toEqual([held, first]);
      expect(active).toBe(second);
      expect(cleared).toBe(second);
      expect(activeConfigLoadHook()).toBeNull();
    } finally {
      setConfigLoadHook(held);
    }
  });

  it('is left as it was when a registry is restored', () => {
    const held = activeConfigLoadHook();
    const hook: ConfigLoadHook = () => {};
    try {
      setConfigLoadHook(hook);
      withEmptyRegistry(() => {
        restoreConfigSections(EMPTY_CONFIG_REGISTRY);
      });

      expect(activeConfigLoadHook()).toBe(hook);
    } finally {
      setConfigLoadHook(held);
    }
  });
});
