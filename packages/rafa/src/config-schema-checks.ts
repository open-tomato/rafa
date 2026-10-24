/**
 * The `checks` section of the config schema: the check-point table, one
 * setting per point of the work at which the runner checks it, each one's
 * field, its default, its spec and its reader. {@link CHECKS_SECTION}
 * hands them to core as one `ConfigSection`, package `checks`, and the
 * `declare module` below adds {@link ChecksSettings} to `RafaConfig`.
 * {@link ChecksShape} holds the keys a file writes, which
 * `src/config/shape.ts` composes into `ConfigShape`, the nested file
 * shape. `config-registry.ts` registers the section after the `tests`
 * section in `CONFIG_SECTIONS`, and its `CONFIG_DEFAULTS` and `SETTINGS`
 * spread the objects below right after the `tests` section's.
 *
 * ## The keys
 *
 * Seven check points, each a list of check names, spelled as the plan
 * `rafa-908-spec-person-sets-checks` names them:
 *
 *   - `checks.task`: what a task step runs.
 *   - `checks.stage`: what a stage step runs.
 *   - `checks.loop`: what the loop runs before its wrap-up.
 *   - `checks.pullRequest`: what a pull request's CI runs.
 *   - `checks.stretch`: what a stretch of work runs.
 *   - `checks.releasePullRequest`: what a release pull request's CI runs.
 *   - `checks.publish`: what a publish runs.
 *
 * Each resolves as `checks` and its key's name capitalised:
 * `checksTask`, `checksPullRequest` and the like. The runner's task step
 * reads `checksTask` (`start/suite-task-step.ts`) and its stage step
 * `checksStage` (`start/suite-stage-step.ts`); no step reads the others
 * yet.
 *
 * ## The vocabulary
 *
 * A check name is one of six, {@link CHECK_NAMES}: `affected`,
 * `related`, `unit`, `contract`, `integration` and `full`. The set is
 * closed, and no entry holds a shell command: what each name runs is the
 * resolver's, which imports {@link CHECK_NAMES} from here. {@link checkList}
 * reads a list of them, and refuses a value that is not a list, an entry
 * outside the six, and a name written twice, each naming the key and the
 * six, since a point that runs one check twice says nothing a single
 * mention does not.
 *
 * ## The default
 *
 * Every key defaults to an empty list, and an empty list means what it
 * says: the point runs no check. The values a project adopts come from
 * a template or from its own file, not from this module.
 *
 * No key here is a `CommandLineSetting`: each is a list, which the
 * command line has no spelling for, as `config-schema.ts` says.
 */
import type { ConfigSection, SettingSpec } from './core/config/index.js';
import type { Reader } from './core/config/sections.js';

import { listOf, oneOf, refused } from './core/config/sections.js';

declare module './core/config/config-schema.js' {
  /** The `checks` section's fields, added to core's. */
  interface RafaConfig extends ChecksSettings {}
}

/** The six check names a check-point entry may hold, in the order a refusal lists them. */
export const CHECK_NAMES: readonly ['affected', 'related', 'unit', 'contract', 'integration', 'full'] = Object.freeze([
  'affected',
  'related',
  'unit',
  'contract',
  'integration',
  'full',
] as const);

/** One check name: one of {@link CHECK_NAMES}. */
export type CheckName = (typeof CHECK_NAMES)[number];

/** The `checks` keys a file writes; `src/config/shape.ts` composes them into `ConfigShape`. */
export interface ChecksShape {
  /** The `checks` keys, each a list of check names. */
  readonly checks: {
    /** `checks.task`: the checks a task step runs. */
    readonly task: readonly CheckName[];
    /** `checks.stage`: the checks a stage step runs. */
    readonly stage: readonly CheckName[];
    /** `checks.loop`: the checks the loop runs before its wrap-up. */
    readonly loop: readonly CheckName[];
    /** `checks.pullRequest`: the checks a pull request's CI runs. */
    readonly pullRequest: readonly CheckName[];
    /** `checks.stretch`: the checks a stretch of work runs. */
    readonly stretch: readonly CheckName[];
    /** `checks.releasePullRequest`: the checks a release pull request's CI runs. */
    readonly releasePullRequest: readonly CheckName[];
    /** `checks.publish`: the checks a publish runs. */
    readonly publish: readonly CheckName[];
  };
}

/** The `checks` section's settings, resolved. */
export interface ChecksSettings {
  /** The checks a task step runs. `checks.task`. */
  checksTask: readonly CheckName[];
  /** The checks a stage step runs. `checks.stage`. */
  checksStage: readonly CheckName[];
  /** The checks the loop runs before its wrap-up. `checks.loop`. */
  checksLoop: readonly CheckName[];
  /** The checks a pull request's CI runs. `checks.pullRequest`. */
  checksPullRequest: readonly CheckName[];
  /** The checks a stretch of work runs. `checks.stretch`. */
  checksStretch: readonly CheckName[];
  /** The checks a release pull request's CI runs. `checks.releasePullRequest`. */
  checksReleasePullRequest: readonly CheckName[];
  /** The checks a publish runs. `checks.publish`. */
  checksPublish: readonly CheckName[];
}

/** What a refused entry is described as: each of the six, at most once. */
const EXPECTED = `a list of check names, each at most once, from: ${CHECK_NAMES.join(', ')}`;

/** A list of check names, every entry one of the six; repeats are refused by {@link checkList}. */
const namesList: Reader<readonly CheckName[]> = listOf(oneOf(CHECK_NAMES), `check names from: ${CHECK_NAMES.join(', ')}`);

/**
 * The reader every `checks` setting shares: a list of check names, each
 * one of {@link CHECK_NAMES} and none written twice, answered frozen in
 * the order written. A refusal opens with the key's label and lists the
 * six.
 */
export const checkList: Reader<readonly CheckName[]> = (raw, at) => {
  const reading = namesList(raw, at);
  if (reading.value === undefined) return reading;

  const repeated = reading.value.find((name, index) => reading.value?.indexOf(name) !== index);
  return repeated === undefined
    ? reading
    : refused(at, raw, `${EXPECTED}; ${JSON.stringify(repeated)} is written twice`);
};

/** The empty list every `checks` setting resolves to when no layer names it. */
const NO_CHECKS: readonly CheckName[] = Object.freeze([]);

/** What every `checks` setting resolves to when no layer names it: no check at any point. */
export const CHECKS_DEFAULTS: Readonly<ChecksSettings> = Object.freeze({
  checksTask: NO_CHECKS,
  checksStage: NO_CHECKS,
  checksLoop: NO_CHECKS,
  checksPullRequest: NO_CHECKS,
  checksStretch: NO_CHECKS,
  checksReleasePullRequest: NO_CHECKS,
  checksPublish: NO_CHECKS,
});

/** The `checks` section's setting specs, in the order problems are reported. */
export const CHECKS_SETTINGS: {
  readonly [K in keyof ChecksSettings]: SettingSpec<K>;
} = {
  checksTask: { key: 'checks.task', read: checkList, cli: false },
  checksStage: { key: 'checks.stage', read: checkList, cli: false },
  checksLoop: { key: 'checks.loop', read: checkList, cli: false },
  checksPullRequest: { key: 'checks.pullRequest', read: checkList, cli: false },
  checksStretch: { key: 'checks.stretch', read: checkList, cli: false },
  checksReleasePullRequest: { key: 'checks.releasePullRequest', read: checkList, cli: false },
  checksPublish: { key: 'checks.publish', read: checkList, cli: false },
};

/** The `checks` section: the seven check points, with their defaults and no check. */
export const CHECKS_SECTION: ConfigSection = Object.freeze({
  package: 'checks',
  settings: Object.freeze(CHECKS_SETTINGS),
  defaults: CHECKS_DEFAULTS,
});
