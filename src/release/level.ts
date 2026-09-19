/**
 * The version bump one plan's pull request is worth: what the plan
 * declared, else the highest among the change notes its sessions
 * stored, else `none`.
 *
 * The spec spells the rule in one sentence — "when present it sets the
 * level and the notes only feed the text; when absent the level is the
 * highest among the plan's notes, and `none` when there are none" — and
 * this module is that sentence and nothing else. It reads no file, opens
 * no store and asks no git: a caller hands it the plan's `release` field
 * (`plan/parse.ts`) and the notes `readPlanChanges` answered for the
 * plan's stub, so the whole rule is drivable from a literal.
 *
 * ## The declaration wins outright, `none` included
 *
 * A plan that declares a level gets it, whatever the notes say. A plan
 * declaring `patch` whose tasks all reported `major` still ships a patch,
 * because the plan is the human judgement about the release and the notes
 * are per-task guesses made before the diff was whole. The reading still
 * carries {@link ReleaseLevelReading.notesLevel}, so a caller that wants
 * to say "the plan declares patch, its notes claim major" in a pull
 * request body has both numbers without recomputing either.
 *
 * `none` is a declaration like any other: `release: none` is a plan
 * saying it ships no bump, and it silences notes that say otherwise. A
 * plan with NO `release` line leaves the field null and declares nothing,
 * which is what sends the reading to the notes. `plan/parse.ts` is what
 * keeps the two apart, and a level spelled any other way never arrives
 * here — it is null there, reported as `unusable-field`.
 *
 * ## Highest, by a rank this module owns
 *
 * {@link RELEASE_LEVEL_RANK} is the only ordering of the four words in
 * the tree. Neither source list carries one: `PLAN_RELEASE_LEVELS` and
 * `CHANGE_LEVELS` both spell `patch, minor, major, none`, which is the
 * order the spec writes them in, and reading precedence off either one's
 * indices would make `none` the HIGHEST of the four — the one mistake
 * that turns a plan of nothing-notes into a major release. The record is
 * closed and mapped over {@link PlanReleaseLevel}, so a fifth level added
 * to the plan parser does not compile until it is ranked here.
 *
 * A note's level is a {@link ChangeLevel} and a plan's is a
 * {@link PlanReleaseLevel}: the same four words, declared twice because
 * one is a report field and the other a plan field. They are ranked on
 * one scale here, which is the point at which they meet.
 *
 * ## Notes that say nothing
 *
 * Notes whose highest is `none` — every task reported a diff a user would
 * notice nothing of — read as `none` from `notes`, and a plan with no
 * notes at all reads as `none` from `default`.
 * {@link ReleaseLevelReading.source} is what tells the two apart, for a
 * caller that wants to word them differently; the level is the same, and
 * the wrap-up skips the bump either way.
 */
import type { PlanReleaseLevel } from '../plan/parse.js';
import type { ChangeLevel } from '../report/parse.js';

/**
 * How the four levels order, smallest first. `none` is the SMALLEST:
 * it is a release of nothing, not a release beyond `major`.
 */
export const RELEASE_LEVEL_RANK: Readonly<Record<PlanReleaseLevel, number>> = {
  none: 0,
  patch: 1,
  minor: 2,
  major: 3,
};

/** What a stored change note has to carry to be ranked: its level. */
export interface ReleaseLevelNote {
  /** How much of a release the note claims its task's diff is worth. */
  readonly level: ChangeLevel;
}

/** Which of the three answers decided a reading. */
export type ReleaseLevelSource =
  /** The plan's own `release` field. */
  | 'plan'
  /** The highest among the plan's stored change notes. */
  | 'notes'
  /** Neither: the plan declared nothing and stored no note. */
  | 'default';

/** The bump a plan's pull request is worth, and what decided it. */
export interface ReleaseLevelReading {
  /** The level to bump by. `none` ships no version change. */
  readonly level: PlanReleaseLevel;
  /** Whether the plan, its notes, or the fallback answered. */
  readonly source: ReleaseLevelSource;
  /**
   * The highest level among the notes, or null when there were none.
   * Answered whatever the source is, so a declaration that disagrees
   * with the notes is visible to whoever reports the release.
   */
  readonly notesLevel: PlanReleaseLevel | null;
}

/**
 * The highest level among `notes`, or null when the list is empty. A
 * list of nothing but `none` answers `none`, which is not the same
 * answer as no list at all.
 */
export function highestChangeLevel(
  notes: readonly ReleaseLevelNote[],
): PlanReleaseLevel | null {
  return notes.reduce<PlanReleaseLevel | null>(
    (highest, note) => (
      highest === null || RELEASE_LEVEL_RANK[note.level] > RELEASE_LEVEL_RANK[highest]
        ? note.level
        : highest
    ),
    null,
  );
}

/**
 * The bump one plan is worth: `declared` when the plan declared one,
 * else the highest among `notes`, else `none`.
 *
 * Pass the plan header's `release` field as `declared` — null for a plan
 * with no `release` line — and the notes `readPlanChanges` answered for
 * the plan's stub. See the module note for why a declaration wins even
 * when it is lower than the notes.
 */
export function resolveReleaseLevel(
  declared: PlanReleaseLevel | null,
  notes: readonly ReleaseLevelNote[],
): ReleaseLevelReading {
  const notesLevel = highestChangeLevel(notes);
  if (declared !== null) return { level: declared, source: 'plan', notesLevel };
  if (notesLevel !== null) return { level: notesLevel, source: 'notes', notesLevel };
  return { level: 'none', source: 'default', notesLevel };
}
