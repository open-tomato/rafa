/**
 * The `issues` section of the config schema: the five keys a bug record
 * is filed and listed with (#951), each one's field, its default, its
 * spec and its reader. {@link ISSUES_SECTION} hands them to core as one
 * `ConfigSection`, package `issues`, and the `declare module` below adds
 * {@link IssuesConfigSettings} to `RafaConfig`.
 * `config-registry.ts`'s `CONFIG_DEFAULTS` and `SETTINGS`
 * spread the objects below right after the `logger` section. It has its
 * own module for the reason `config-schema-errors.ts` gives.
 *
 * ## The keys
 *
 *   - `issues.titles.bug` is the template a bug's title is rendered
 *     with and read back by (`bugs/title.ts`). It is refused at load
 *     when it cannot be parsed, when its summary is not the last
 *     variable outside every group, and when a title it renders does not
 *     read back as the fields it was rendered from, so `rafa issue list
 *     --type=bug` can always split a title this project filed.
 *   - `issues.titles.summaryMax` is the most characters a bug's summary
 *     holds, from {@link SUMMARY_MAX_FLOOR} to
 *     {@link SUMMARY_MAX_CEILING}, the cap triage cuts a whole title to.
 *   - `issues.environments` adds places to `local`, `ci` and `prod`,
 *     such as `staging`. A place names where a bug was seen, never what
 *     was running.
 *   - `issues.vocabulary.modules` and `issues.vocabulary.actions` are the
 *     names a bug may carry. Empty, the default, accepts any name of the
 *     shape; set, a name outside the list is refused with the closest
 *     ones shown, so one module is never filed under three spellings.
 *
 * `titles` holds one template: a bug is the only type whose title rafa
 * renders. Another type's key arrives with the code that renders it.
 *
 * ## When they take effect
 *
 * At each `rafa issue create --type=bug`, which checks the record
 * against {@link bugRulesOf}, and each `rafa issue list --type=bug`,
 * which reads the titles back with the template.
 *
 * None of the keys is a `CommandLineSetting`: a line's own flags name
 * the fields of one bug, and the rules they are held to are the
 * project's.
 */
import type { BugRules } from './bugs/record.js';
import type { ErrorsSettings } from './config-schema-errors.js';
import type { ConfigSection, SettingSpec } from './core/config/index.js';
import type { Reader, Reading } from './core/config/sections.js';

import { BUILT_IN_ENVIRONMENTS } from './bugs/places.js';
import { ACTION_SHAPE, DEFAULT_BUG_TITLE, MODULE_SHAPE, templateProblem, UNKNOWN_VALUE } from './bugs/title.js';
import { listOf, refused } from './core/config/sections.js';
import { listedCodes } from './errors/rafa-codes.js';

declare module './core/config/config-schema.js' {
  /** The `issues` section's fields, added to core's. */
  interface RafaConfig extends IssuesConfigSettings {}
}

/** The `issues` settings. */
export interface IssuesConfigSettings {
  /** The template a bug's title is rendered with. `issues.titles.bug`. */
  issuesTitleBug: string;
  /** The most characters a bug's summary holds. `issues.titles.summaryMax`. */
  issuesSummaryMax: number;
  /** Places beside local, ci and prod. `issues.environments`. */
  issuesEnvironments: readonly string[];
  /** The module names a bug may carry; empty for any. `issues.vocabulary.modules`. */
  issuesVocabularyModules: readonly string[];
  /** The actions a bug may carry; empty for any. `issues.vocabulary.actions`. */
  issuesVocabularyActions: readonly string[];
}

/** The summary cap when the config names none. */
export const SUMMARY_MAX_DEFAULT = 80;

/** The fewest characters `issues.titles.summaryMax` accepts. */
export const SUMMARY_MAX_FLOOR = 20;

/** The most characters `issues.titles.summaryMax` accepts: triage's cap on a whole title. */
export const SUMMARY_MAX_CEILING = 120;

/** What a template is expected to be, in a refusal. */
const TEMPLATE_EXPECTED = 'a title template';

/** A place: lower-case kebab-case. */
const PLACE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** A whole module name. */
const MODULE = new RegExp(`^${MODULE_SHAPE}$`);

/** A whole action. */
const ACTION = new RegExp(`^${ACTION_SHAPE}$`);

/** A reading of `value` with nothing wrong. */
function accepted<T>(value: T): Reading<T> {
  return { value, problems: [], extras: [] };
}

/** A template that parses and reads its own titles back; see the module note. */
const titleTemplate: Reader<string> = (raw, at) => {
  if (typeof raw !== 'string' || raw.trim() === '') return refused(at, raw, TEMPLATE_EXPECTED);
  const problem = templateProblem(raw);
  return problem === null
    ? accepted(raw)
    : refused(at, raw, `${TEMPLATE_EXPECTED}: ${problem}`);
};

/** A whole number within the summary cap's bounds. */
const summaryMax: Reader<number> = (raw, at) => typeof raw === 'number'
  && Number.isSafeInteger(raw)
  && raw >= SUMMARY_MAX_FLOOR
  && raw <= SUMMARY_MAX_CEILING
  ? accepted(raw)
  : refused(at, raw, `a whole number from ${SUMMARY_MAX_FLOOR} to ${SUMMARY_MAX_CEILING}`);

/** A string of `shape` that is none of `reserved`, refused as `expected`. */
function nameOf(shape: RegExp, reserved: readonly string[], expected: string): Reader<string> {
  return (raw, at) => typeof raw === 'string' && shape.test(raw) && !reserved.includes(raw)
    ? accepted(raw)
    : refused(at, raw, expected);
}

/** A place a project adds: not one every project has, and not `unknown`. */
const place = nameOf(
  PLACE,
  [...BUILT_IN_ENVIRONMENTS, UNKNOWN_VALUE],
  `a place name in lower-case kebab-case, other than ${BUILT_IN_ENVIRONMENTS.join(', ')} and ${UNKNOWN_VALUE}`,
);

/** A module name of a vocabulary. */
const moduleName = nameOf(
  MODULE,
  [UNKNOWN_VALUE],
  `a module name in lower-case letters, digits, ".", "_" and "-", other than ${UNKNOWN_VALUE}`,
);

/** An action of a vocabulary. */
const actionName = nameOf(
  ACTION,
  [UNKNOWN_VALUE],
  `an action in lower-case letters, digits, ".", "_", "-" and spaces, other than ${UNKNOWN_VALUE}`,
);

/** The defaults: the default template, its cap, no added place and no vocabulary. */
export const ISSUES_DEFAULTS: Readonly<IssuesConfigSettings> = Object.freeze({
  issuesTitleBug: DEFAULT_BUG_TITLE,
  issuesSummaryMax: SUMMARY_MAX_DEFAULT,
  issuesEnvironments: Object.freeze([]),
  issuesVocabularyModules: Object.freeze([]),
  issuesVocabularyActions: Object.freeze([]),
});

/** Every `issues` setting. */
export const ISSUES_SETTINGS: { readonly [K in keyof IssuesConfigSettings]: SettingSpec<K> } = {
  issuesTitleBug: { key: 'issues.titles.bug', read: titleTemplate, cli: false },
  issuesSummaryMax: { key: 'issues.titles.summaryMax', read: summaryMax, cli: false },
  issuesEnvironments: { key: 'issues.environments', read: listOf(place, 'place names'), cli: false },
  issuesVocabularyModules: { key: 'issues.vocabulary.modules', read: listOf(moduleName, 'module names'), cli: false },
  issuesVocabularyActions: { key: 'issues.vocabulary.actions', read: listOf(actionName, 'actions'), cli: false },
};

/** The `issues` section: the five `issues` keys, with their defaults and no check. */
export const ISSUES_SECTION: ConfigSection = Object.freeze({
  package: 'issues',
  settings: Object.freeze(ISSUES_SETTINGS),
  defaults: ISSUES_DEFAULTS,
});

/** The rules a bug record is checked against, from a resolved config; see the module note. */
export function bugRulesOf(config: IssuesConfigSettings & ErrorsSettings): BugRules {
  return {
    template: config.issuesTitleBug,
    summaryMax: config.issuesSummaryMax,
    environments: [...BUILT_IN_ENVIRONMENTS, ...config.issuesEnvironments],
    modules: config.issuesVocabularyModules,
    actions: config.issuesVocabularyActions,
    codes: listedCodes(config.errorsCodes),
  };
}
