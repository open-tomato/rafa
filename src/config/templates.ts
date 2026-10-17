/**
 * The config templates: {@link CONFIG_TEMPLATES}, each a named
 * `ConfigEntry` a file adopts with its `templates` key, {@link TEMPLATE_NAMES}
 * and {@link templateEntry}, the lookup by name.
 *
 * ## The one template
 *
 * `escalation` holds the values a project that runs its tests in rings
 * writes: the five files whose change runs the full suite
 * (`tests.fullSuiteTriggers`), the four spellings of an integration test
 * (`tests.integration`), the one of a contract test (`tests.contract`),
 * and three check points, `checks.task: [affected]`,
 * `checks.stage: [related, integration]` and `checks.loop: [full]`. The
 * other four check points it leaves unnamed, so they keep their empty
 * default.
 *
 * Values are spelled as a file writes them, so `templates.test.ts` reads
 * each back through its setting's reader to the value written here.
 *
 * ## How core reaches it
 *
 * Core imports nothing from this module: `registerCoreConfigSections`
 * in `src/config-registry.ts` sets {@link templateEntry} as core's template
 * hook (`setConfigTemplateHook` in `packages/rafa/src/core/config/section.ts`),
 * and the loader calls the active hook by name. A project that installs
 * rafa can also take the map by value as `templates` from
 * `@open-tomato/rafa/config` and spread an entry into its own
 * `rafa.config.ts`.
 *
 * Every mapping and list is frozen, and a name is looked up with
 * `Object.hasOwn`, so `constructor` or `__proto__` answers null rather
 * than something off `Object.prototype`.
 */
import type { ConfigEntry } from './entry.js';

/** The name of a config template: one of {@link TEMPLATE_NAMES}. */
export type TemplateName = 'escalation';

/**
 * `value` with every mapping and list below it frozen, itself included.
 *
 * @param value - A plain value built here, mappings and lists of scalars.
 * @returns The same value, frozen at every level.
 */
function frozen<T>(value: T): T {
  if (typeof value !== 'object' || value === null) return value;
  Object.values(value).forEach(frozen);
  return Object.freeze(value);
}

/** The `escalation` template; see the module note. */
const ESCALATION: ConfigEntry = frozen<ConfigEntry>({
  tests: {
    fullSuiteTriggers: ['bunfig.toml', 'tsconfig*.json', 'package.json', 'bun.lock', 'bun.lockb'],
    integration: [
      '**/*-integration.test.ts',
      '**/*.integration.test.ts',
      '**/*-spawned*.test.ts',
      '**/*-cli.test.ts',
    ],
    contract: ['**/*.contract.test.ts'],
  },
  checks: {
    task: ['affected'],
    stage: ['related', 'integration'],
    loop: ['full'],
  },
});

/** Every config template, by name, each a frozen `ConfigEntry`. */
export const CONFIG_TEMPLATES: Readonly<Record<TemplateName, ConfigEntry>> = Object.freeze({
  escalation: ESCALATION,
});

/** The name of every template in {@link CONFIG_TEMPLATES}, in the order it lists them. */
export const TEMPLATE_NAMES: readonly TemplateName[] = Object.freeze(
  Object.keys(CONFIG_TEMPLATES) as TemplateName[],
);

/**
 * The entry a template's name stands for, or null for a name
 * {@link CONFIG_TEMPLATES} does not hold. Set as core's template hook by
 * `registerCoreConfigSections`.
 *
 * @param name - The name a file's `templates` key gives.
 * @returns The template's frozen entry, or null.
 */
export function templateEntry(name: string): ConfigEntry | null {
  return Object.hasOwn(CONFIG_TEMPLATES, name)
    ? CONFIG_TEMPLATES[name as TemplateName]
    : null;
}
