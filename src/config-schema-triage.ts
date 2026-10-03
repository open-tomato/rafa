/**
 * The `triage` section of the config schema: the two settings triage
 * reads when it looks for the nearest open bug a report repeats, each
 * one's field, its default, its spec and its reader.
 * `config-schema.ts`'s `RafaConfig` extends {@link TriageSettings}, and
 * its `CONFIG_DEFAULTS` and `SETTINGS` spread the objects below right
 * after the `claims` section.
 *
 * The section has its own module, as `config-schema-tests.ts` and
 * `config-schema-wrap-up.ts` do, because `config-schema.ts` stood at 592
 * lines and `config-sections.ts` at 705, measured with `wc -l`, when
 * these keys were added: the schema module's own note asks a new
 * section for a sibling, and the readers are rules about a VALUE that
 * only these keys read, so they sit here beside them. Only
 * `config-schema.ts` imports this file; a caller reads the settings off
 * the resolved `RafaConfig`.
 *
 * ## The two keys
 *
 * Step 3 of a public bug's lookup (`triage/triage.ts`) scores the
 * report against each open bug by Jaccard similarity of their word
 * sets, after the exact-key lookups have missed:
 *
 *   - `triage.similarity.threshold` is the least score at which the
 *     nearest open bug is taken for the same bug and commented on. It
 *     defaults to `0.3` and accepts a number above 0 and at most 1: a
 *     Jaccard score lies in 0..1, so a threshold above 1 could never be
 *     met, and one of 0 or below would match every open bug, words
 *     shared or not. `false` turns step 3 off, so triage files with the
 *     exact-key lookups alone. `true` is refused: it names no score, and
 *     reading it as the default would be a choice nobody wrote.
 *   - `triage.similarity.candidates` is how many of the nearest open
 *     bugs a new bug's `Possible duplicates` section lists. It defaults
 *     to `3` and accepts a whole number from 1 to 10; the cap keeps that
 *     section short enough to read. It takes no `false`: turning step 3
 *     off is the threshold's to say.
 *
 * A quoted number is refused, as every other reader refuses a string
 * spelled like its type. Neither key is a `CommandLineSetting`: the
 * command line has no spelling for `false` or a number this module
 * would not have to invent.
 */
import type { SettingSpec } from './config-schema.js';
import type { Reader } from './config-sections.js';

import { refused } from './config-sections.js';

/** The most `triage.similarity.threshold` accepts. */
export const SIMILARITY_THRESHOLD_MAX = 1;

/** The fewest nearest issues `triage.similarity.candidates` accepts. */
export const SIMILARITY_CANDIDATES_MIN = 1;

/** The most nearest issues `triage.similarity.candidates` accepts. */
export const SIMILARITY_CANDIDATES_MAX = 10;

/**
 * The least Jaccard score at which the nearest open bug is taken for the
 * report's, or `false` with the similarity step turned off.
 */
export type SimilarityThreshold = number | false;

/** The `triage` section's settings, resolved. */
export interface TriageSettings {
  /**
   * The least score at which the nearest open bug is commented on, or
   * `false` to skip the similarity step. `triage.similarity.threshold`.
   */
  triageSimilarityThreshold: SimilarityThreshold;
  /**
   * How many nearest open bugs a new bug's `Possible duplicates`
   * section lists. `triage.similarity.candidates`.
   */
  triageSimilarityCandidates: number;
}

/** True for a finite number above 0 and at most {@link SIMILARITY_THRESHOLD_MAX}. */
function isThreshold(raw: unknown): raw is number {
  return typeof raw === 'number'
    && Number.isFinite(raw)
    && raw > 0
    && raw <= SIMILARITY_THRESHOLD_MAX;
}

/** True for a whole number from {@link SIMILARITY_CANDIDATES_MIN} to {@link SIMILARITY_CANDIDATES_MAX}. */
function isCandidateCount(raw: unknown): raw is number {
  return typeof raw === 'number'
    && Number.isSafeInteger(raw)
    && raw >= SIMILARITY_CANDIDATES_MIN
    && raw <= SIMILARITY_CANDIDATES_MAX;
}

/**
 * Accepts `false` or a number above 0 and at most 1, each as itself; the
 * module note says why `0`, `true` and a quoted number are refused.
 */
export const similarityThreshold: Reader<SimilarityThreshold> = (raw, at) => raw === false || isThreshold(raw)
  ? { value: raw, problems: [], extras: [] }
  : refused(at, raw, `false or a number above 0 and at most ${String(SIMILARITY_THRESHOLD_MAX)}`);

/** Accepts a whole number from 1 to 10 as itself. */
export const similarityCandidates: Reader<number> = (raw, at) => isCandidateCount(raw)
  ? { value: raw, problems: [], extras: [] }
  : refused(at, raw, `a whole number from ${String(SIMILARITY_CANDIDATES_MIN)} to ${String(SIMILARITY_CANDIDATES_MAX)}`);

/** What every `triage` setting resolves to when no layer names it. */
export const TRIAGE_DEFAULTS: Readonly<TriageSettings> = Object.freeze({
  triageSimilarityThreshold: 0.3,
  triageSimilarityCandidates: 3,
});

/** The `triage` section's setting specs, in the order problems are reported. */
export const TRIAGE_SETTINGS: {
  readonly [K in keyof TriageSettings]: SettingSpec<K>;
} = {
  triageSimilarityThreshold: {
    key: 'triage.similarity.threshold',
    read: similarityThreshold,
    cli: false,
  },
  triageSimilarityCandidates: {
    key: 'triage.similarity.candidates',
    read: similarityCandidates,
    cli: false,
  },
};
