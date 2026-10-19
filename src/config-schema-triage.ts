/**
 * The `triage` section of the config schema: the five settings triage
 * reads when it looks for the nearest open bug a report repeats and ranks
 * the ones a new bug lists, each one's field, its default, its spec and
 * its reader.
 * {@link TRIAGE_SECTION} hands them to core as one `ConfigSection`,
 * package `triage`, and the `declare module` below adds
 * {@link TriageSettings} to `RafaConfig`.
 * {@link TriageShape} holds the keys a file writes, which
 * `src/config/shape.ts` composes into `ConfigShape`, the nested file shape.
 * `config-registry.ts`'s `CONFIG_DEFAULTS` and `SETTINGS`
 * spread the objects below right after the `claims` section.
 *
 * The section has its own module, as `config-schema-tests.ts` and
 * `config-schema-wrap-up.ts` do, because `config-schema.ts` stood at 592
 * lines and `config-sections.ts` at 705, measured with `wc -l`, when
 * these keys were added: the schema module's own note asks a new
 * section for a sibling, and the readers are rules about a VALUE that
 * only these keys read, so they sit here beside them. Only
 * `config-registry.ts` imports this file; a caller reads the settings off
 * the resolved `RafaConfig`.
 *
 * ## The five keys
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
 *   - `triage.similarity.weights.causeLeaf`, `.causeFamily` and
 *     `.boundary` are the bonuses `rankedCandidates`
 *     (`triage/similarity.ts`) adds to an open bug's word score when it
 *     shares the new bug's cause code, only its cause family, or its
 *     module and action; the sum is capped at 1 and orders the
 *     `Possible duplicates` list, never the same-bug decision. They
 *     default to `0.15`, `0.05` and `0.10` and each accepts a number from
 *     0 to 1 inclusive: `0` turns its signal off, which is why it is
 *     accepted here and refused by the threshold, and a bonus above 1
 *     could only ever hit the cap. `true` and `false` are refused, as the
 *     threshold refuses `true`: `0` already says off.
 *
 * A quoted number is refused, as every other reader refuses a string
 * spelled like its type. No key is a `CommandLineSetting`: the
 * command line has no spelling for `false` or a number this module
 * would not have to invent.
 */
import type { ConfigSection, SettingSpec } from '@open-tomato/rafa/core/config';
import type { Reader } from '@open-tomato/rafa/core/config/sections';

import { refused } from '@open-tomato/rafa/core/config/sections';

declare module '@open-tomato/rafa/core/config/config-schema' {
  /** The `triage` section's fields, added to core's. */
  interface RafaConfig extends TriageSettings {}
}

/** The `triage` keys a file writes; `src/config/shape.ts` composes them into `ConfigShape`. */
export interface TriageShape {
  readonly triage: {
    readonly similarity: {
      readonly threshold: SimilarityThreshold;
      readonly candidates: number;
      readonly weights: {
        readonly causeLeaf: number;
        readonly causeFamily: number;
        readonly boundary: number;
      };
    };
  };
}

/** The most `triage.similarity.threshold` accepts. */
export const SIMILARITY_THRESHOLD_MAX = 1;

/** The least a `triage.similarity.weights.*` bonus accepts; `0` turns its signal off. */
export const SIMILARITY_WEIGHT_MIN = 0;

/** The most a `triage.similarity.weights.*` bonus accepts. */
export const SIMILARITY_WEIGHT_MAX = 1;

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
  /**
   * The bonus an open bug with the same cause code earns in the
   * `Possible duplicates` rank. `triage.similarity.weights.causeLeaf`.
   */
  triageSimilarityWeightsCauseLeaf: number;
  /**
   * The bonus an open bug with the same cause family and another leaf
   * earns in that rank. `triage.similarity.weights.causeFamily`.
   */
  triageSimilarityWeightsCauseFamily: number;
  /**
   * The bonus an open bug with the same module and action earns in that
   * rank. `triage.similarity.weights.boundary`.
   */
  triageSimilarityWeightsBoundary: number;
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

/** True for a finite number from {@link SIMILARITY_WEIGHT_MIN} to {@link SIMILARITY_WEIGHT_MAX}, both included. */
function isWeight(raw: unknown): raw is number {
  return typeof raw === 'number'
    && Number.isFinite(raw)
    && raw >= SIMILARITY_WEIGHT_MIN
    && raw <= SIMILARITY_WEIGHT_MAX;
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

/**
 * Accepts a number from 0 to 1 inclusive as itself; the module note says
 * why `0` is accepted and `true`, `false` and a quoted number are refused.
 */
export const similarityWeight: Reader<number> = (raw, at) => isWeight(raw)
  ? { value: raw, problems: [], extras: [] }
  : refused(at, raw, `a number from ${String(SIMILARITY_WEIGHT_MIN)} to ${String(SIMILARITY_WEIGHT_MAX)}`);

/** What every `triage` setting resolves to when no layer names it. */
export const TRIAGE_DEFAULTS: Readonly<TriageSettings> = Object.freeze({
  triageSimilarityThreshold: 0.3,
  triageSimilarityCandidates: 3,
  triageSimilarityWeightsCauseLeaf: 0.15,
  triageSimilarityWeightsCauseFamily: 0.05,
  triageSimilarityWeightsBoundary: 0.1,
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
  triageSimilarityWeightsCauseLeaf: {
    key: 'triage.similarity.weights.causeLeaf',
    read: similarityWeight,
    cli: false,
  },
  triageSimilarityWeightsCauseFamily: {
    key: 'triage.similarity.weights.causeFamily',
    read: similarityWeight,
    cli: false,
  },
  triageSimilarityWeightsBoundary: {
    key: 'triage.similarity.weights.boundary',
    read: similarityWeight,
    cli: false,
  },
};

/** The `triage` section: the five `triage` keys, with their defaults and no check. */
export const TRIAGE_SECTION: ConfigSection = Object.freeze({
  package: 'triage',
  settings: Object.freeze(TRIAGE_SETTINGS),
  defaults: TRIAGE_DEFAULTS,
});
