/**
 * Whether a project still points `plan.dir` or `specs.dir` at the names
 * rafa used before it had defaults of its own: the reading `rafa doctor`
 * warns by.
 *
 * rafa's defaults are `.rafa/plans` and `.rafa/specs`
 * ({@link CONFIG_DEFAULTS}), and everything else rafa writes under a
 * project already sits beside them in `.rafa`. A project carried over
 * from before those defaults existed names the old top-level directories
 * in its config instead, and nothing about a loop run says so: the
 * override works, plans and specs are read and written where it points,
 * and the project simply never moves. {@link readPreInitDirs} answers
 * which of the two settings still name a pre-init directory, and the
 * warning to print, or null. This module prints nothing.
 *
 * A warning here is not a fault. An override is a choice, and `doctor`
 * keeps its exit code whatever this reading says; the line exists so the
 * choice is made knowingly rather than inherited.
 *
 * ## The two names
 *
 * {@link PRE_INIT_DIRS} pairs each setting with the name it held before
 * the defaults: `plan.dir` with a top-level `.plans`, `specs.dir` with a
 * top-level `.specs`. Neither is a default of anything, so a resolved
 * value of one of them is by itself an override and the reading needs no
 * source information from `loadConfig` to say so.
 *
 * ## Comparing a value
 *
 * A value is compared as `normalize` spells it with any trailing
 * separator dropped, so `./.plans` and a spelling with a trailing slash
 * are read as the one relative directory. An absolute value never
 * matches, whatever it ends in: `/srv/shared/.plans` names a directory of
 * its own somewhere off the project root, and moving it to a default
 * under the root is no advice this reading can give.
 *
 * ## What it touches
 *
 * Nothing. No path is stat'ed and no file is opened: the reading is a
 * function of the two resolved values and the defaults. In particular it
 * does not check whether the pre-init directory holds any files — a
 * project that named one keeps naming it whether or not it has written
 * there yet.
 */
import type { RafaConfig } from '../config.js';

import { normalize, sep } from 'node:path';

import { CONFIG_DEFAULTS, CONFIG_FILE } from '../config.js';

/** The two settings this reading judges. */
export type PreInitSetting = 'planDir' | 'specsDir';

/** What one of the two settings was called before the defaults. */
export interface PreInitDirSpec {
  readonly setting: PreInitSetting;
  /** Where the config file spells it, as a dotted path: `plan.dir`. */
  readonly key: string;
  /** The directory the setting named before rafa had a default. */
  readonly preInit: string;
  /** What {@link CONFIG_DEFAULTS} gives the setting now. */
  readonly fallback: string;
}

/** Each setting with its pre-init name and its default; see the module note. */
export const PRE_INIT_DIRS: readonly PreInitDirSpec[] = Object.freeze([
  Object.freeze({
    setting: 'planDir' as const,
    key: 'plan.dir',
    preInit: '.plans',
    fallback: CONFIG_DEFAULTS.planDir,
  }),
  Object.freeze({
    setting: 'specsDir' as const,
    key: 'specs.dir',
    preInit: '.specs',
    fallback: CONFIG_DEFAULTS.specsDir,
  }),
]);

/** One setting found still naming its pre-init directory. */
export interface PreInitDirFound extends PreInitDirSpec {
  /** The resolved value, as the config holds it. */
  readonly value: string;
}

/** What {@link readPreInitDirs} answers. */
export interface PreInitDirsReading {
  /** The settings naming a pre-init directory, in {@link PRE_INIT_DIRS} order. */
  readonly found: readonly PreInitDirFound[];
  /** The sentence to warn with, or null when neither setting names one. */
  readonly warning: string | null;
}

/** A relative path as this module compares it; see the module note. */
function compared(value: string): string {
  const normalized = normalize(value);
  return normalized.endsWith(sep) && normalized.length > sep.length
    ? normalized.slice(0, -sep.length)
    : normalized;
}

/** The warning for the settings found, or null when none were; see the module note. */
export function preInitWarning(found: readonly PreInitDirFound[]): string | null {
  if (found.length === 0) return null;
  const clauses = found
    .map((dir) => `${dir.key} is ${dir.value}, where the default is ${dir.fallback}`)
    .join('; ');
  const keys = found.map((dir) => dir.key).join(' and ');
  const those = found.length > 1
    ? 'Those are the directories'
    : 'That is the directory';
  return `${clauses}. ${those} rafa used before it had defaults of its own; dropping ${keys}`
    + ` from ${CONFIG_FILE} points rafa at the default, so move what is there first.`;
}

/**
 * Which of `plan.dir` and `specs.dir` still name the directory rafa used
 * before its defaults, and the warning to print when either does. Reads
 * the two resolved values alone and touches nothing; see the module note.
 */
export function readPreInitDirs(config: Pick<RafaConfig, PreInitSetting>): PreInitDirsReading {
  const found = PRE_INIT_DIRS
    .filter((dir) => compared(config[dir.setting]) === dir.preInit)
    .map((dir) => Object.freeze({ ...dir, value: config[dir.setting] }));
  return Object.freeze({ found: Object.freeze(found), warning: preInitWarning(found) });
}
