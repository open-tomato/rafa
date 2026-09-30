/**
 * The readers `config-schema.ts` and `config-schema-release.ts` build
 * their settings from, beyond the value readers `config-sections.ts`
 * exports whole: {@link mapOf}, and
 * the named readers the schema's settings are read through, each built
 * on `mapOf` or on `config-sections.ts`'s `text` or `oneOf`. The readers a single
 * setting spells inline, such as `oneOf(STORE_BACKENDS)`, stay beside
 * their key in `config-schema.ts`, or in `config-schema-release.ts` for
 * a `pr` or `release` key.
 *
 * They sat in `config-schema.ts` until that module reached the 800-line
 * cap of `context/source.md`, and moved out before any setting was added
 * so a new key is not paid for by rewrapping prose. `config-sections.ts`
 * still holds every rule about a VALUE but the release plan's, below,
 * and the two item shapes, which `config-items.ts` reads;
 * {@link mapOf} is here rather than there because what it rules on is a KEY: the names a map
 * setting's file spells below its own key. Outside the config modules
 * only `tiers/routing.test.ts` imports this file, reading a file's
 * `routing` through {@link routeTable} as the schema does.
 *
 * The closed lists and readers of the release plan's keys —
 * `release.strategy`, `release.settle`, `release.tag`,
 * `pr.versionCollision` and `release.fragments` — are value rules and
 * sit here all the same: `config-sections.ts` stood at 781 lines,
 * measured with `wc -l`, when they joined, and takes no new code under
 * the 800-line cap of `context/source.md`. Each closed list is read
 * through that module's `oneOf`, so an unknown value is refused in the
 * words every other closed list is refused in.
 *
 * ## Path settings
 *
 * `release.fragments` names the directory a branch's wrap-up writes
 * its change fragment into, and a fragment is committed data: settle
 * reads the fragments present in the base branch's tree. So
 * {@link fragmentsDirectory} refuses two paths `text` would take:
 *
 *   - An absolute path. The directory is read off a scratch worktree
 *     of the base branch as well as off the caller's checkout, and an
 *     absolute path names one place on one disk rather than a place in
 *     every checkout.
 *   - `.rafa` or a path below it, after `normalize` has resolved `./`
 *     and `..` steps. `.rafa/` is gitignored, so a fragment written
 *     there would never reach a commit and no fold would ever see it.
 *
 * A path is kept as written, as every other path setting keeps one;
 * a caller joins it under the repository root.
 *
 * ## Map settings
 *
 * A map setting holds names the schema cannot list — a skill, an agent,
 * a task shape — each with a value an inner reader checks, and
 * {@link mapOf} reads one. Three readings are this module's:
 *
 *   - A name is a key the FILE spells, not one the schema knows, so it
 *     is kept in a `Map` and never in a plain object: a skill named
 *     `constructor` or `__proto__` is an ordinary name, and an object
 *     would match it against `Object.prototype` or reset the
 *     prototype. A name, like any string that names something, holds a
 *     character other than whitespace, and is kept as written.
 *   - Every entry is read, so a map with two unusable values names both,
 *     as `listOf` does for a list. An entry's label and key gain its
 *     name, `tiers.skills.tdd-guide`. A null value is handed to the
 *     inner reader like any other, which is what a map whose values
 *     include `false` needs: whether `false`, or null, means anything is
 *     the inner reader's answer.
 *   - The answer is a fresh `Map` per read, typed as a `ReadonlyMap`. A
 *     `Map` cannot be frozen the way a list is — `Object.freeze` leaves
 *     `set` working — so the promise that no caller edits a value for
 *     the next is kept by building a new one each time.
 */
import type { Reader, Reading, RouteTarget, TierPin } from './config-sections.js';

import { isAbsolute, normalize } from 'node:path';

import {
  describeValue,
  isMapping,
  oneOf,
  routeTarget,
  text,
  tierPin,
} from './config-sections.js';

/**
 * Accepts a mapping of names to values `value` accepts, answered as a
 * fresh `Map` in the order written; see "Map settings" in the module
 * note. Every entry is read, so a map with two unusable entries names
 * both. `expected` names the values, in the refusal of a value that is
 * not a mapping.
 */
export function mapOf<T>(
  value: Reader<T>,
  expected: string,
): Reader<ReadonlyMap<string, T>> {
  return (raw, at) => {
    if (!isMapping(raw)) {
      const problem = `${at.label} is ${describeValue(raw)}, expected a mapping of names to ${expected}`;
      return { value: undefined, problems: [problem], extras: [] };
    }

    const readings = Object.entries(raw).map(([name, entry]): [string, Reading<T>] => [
      name,
      name.trim() === ''
        ? {
          value: undefined,
          problems: [`${at.label} names ${JSON.stringify(name)}, expected a non-empty name`],
          extras: [],
        }
        : value(entry, { label: `${at.label}.${name}`, key: `${at.key}.${name}` }),
    ]);
    const problems = readings.flatMap(([, reading]) => reading.problems);
    const extras = readings.flatMap(([, reading]) => reading.extras);
    if (problems.length > 0) return { value: undefined, problems, extras };

    const read = new Map<string, T>();
    for (const [name, reading] of readings) {
      if (reading.value !== undefined) read.set(name, reading.value);
    }
    return { value: read, problems, extras };
  };
}

/** The reader every directory setting, `plan.dir`, `specs.dir` and `loop.worktreeDir`, shares. */
export const directory: Reader<string> = text('a directory path');

/** The reader every tracker kind goes through, alone or in a list. */
export const trackerKind: Reader<string> = text('a tracker kind name');

/** The reader both `release` file settings share. */
export const releaseFile: Reader<string> = text('a file path');

/** The reader both `tiers` maps, `tiers.skills` and `tiers.agents`, share. */
export const tierPins: Reader<ReadonlyMap<string, TierPin>> = mapOf(tierPin, 'false or a tier');

/** The reader of `routing`: a task shape to an agent, or `false`. */
export const routeTable: Reader<ReadonlyMap<string, RouteTarget>> = mapOf(
  routeTarget,
  'false or an agent name',
);

/**
 * The strategies `release.strategy` may name. One today: the fold that
 * bumps the base branch's version by the highest level among the
 * fragments it folds.
 */
export const RELEASE_STRATEGIES = ['semver-by-level'] as const;

/** One of {@link RELEASE_STRATEGIES}. */
export type ReleaseStrategy = (typeof RELEASE_STRATEGIES)[number];

/**
 * How `rafa release settle` lands a settled version on the base branch:
 * a push to it, or a pull request into it.
 */
export const RELEASE_SETTLE_MODES = ['push', 'pr'] as const;

/** One of {@link RELEASE_SETTLE_MODES}. */
export type ReleaseSettleMode = (typeof RELEASE_SETTLE_MODES)[number];

/**
 * Who puts the release tag on a settled version: a person through
 * `rafa release tag`, or settle itself.
 */
export const RELEASE_TAG_MODES = ['manual', 'settle'] as const;

/** One of {@link RELEASE_TAG_MODES}. */
export type ReleaseTagMode = (typeof RELEASE_TAG_MODES)[number];

/**
 * How `rafa pr merge` reacts to a branch the release guard reads as
 * `missing` or `stale`: stay silent, report it, ask, or refuse it.
 */
export const VERSION_COLLISION_MODES = ['allow', 'report', 'ask', 'refuse'] as const;

/** One of {@link VERSION_COLLISION_MODES}. */
export type VersionCollisionMode = (typeof VERSION_COLLISION_MODES)[number];

/** The reader of `release.strategy`. */
export const releaseStrategy: Reader<ReleaseStrategy> = oneOf(RELEASE_STRATEGIES);

/** The reader of `release.settle`. */
export const releaseSettleMode: Reader<ReleaseSettleMode> = oneOf(RELEASE_SETTLE_MODES);

/** The reader of `release.tag`. */
export const releaseTagMode: Reader<ReleaseTagMode> = oneOf(RELEASE_TAG_MODES);

/** The reader of `pr.versionCollision`. */
export const versionCollisionMode: Reader<VersionCollisionMode> = oneOf(VERSION_COLLISION_MODES);

/** The directory rafa keeps its untracked files under, gitignored. */
const UNTRACKED_DIRECTORY = '.rafa';

/** What `release.fragments` takes, in every refusal of it. */
const FRAGMENTS_EXPECTED = `a relative directory path not under ${UNTRACKED_DIRECTORY}/`;

/** Whether `path`, relative, names `.rafa` or a path below it. */
function isUnderUntracked(path: string): boolean {
  const [first] = normalize(path).split(/[\\/]/);
  return first === UNTRACKED_DIRECTORY;
}

/**
 * The reader of `release.fragments`: a directory path relative to the
 * repository root and not under `.rafa/`, kept as written; see "Path
 * settings" in the module note.
 */
export const fragmentsDirectory: Reader<string> = (raw, at) => {
  const reading = text(FRAGMENTS_EXPECTED)(raw, at);
  const path = reading.value;
  if (path === undefined || (!isAbsolute(path) && !isUnderUntracked(path))) return reading;

  const problem = `${at.label} is ${describeValue(raw)}, expected ${FRAGMENTS_EXPECTED}`;
  return { value: undefined, problems: [problem], extras: [] };
};
