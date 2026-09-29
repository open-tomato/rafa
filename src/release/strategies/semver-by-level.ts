/**
 * The `semver-by-level` release strategy, the default of
 * `release.strategy`: the base version bumped ONCE by the highest level
 * among the fragments it folds.
 *
 * ## The version
 *
 * The batch's level is the highest of its fragments' levels, ranked by
 * `RELEASE_LEVEL_RANK` (`../level.ts`), and the base moves by that level
 * once through `nextVersion` (`../version.ts`). Two minors make one
 * minor bump, not two: the fragments are plans finished in parallel,
 * and the release they land in is one release. Taking a maximum is what
 * makes the version independent of the fragments' order.
 *
 * A batch with no fragment, or with only `level: none` ones, answers
 * null — nothing to settle. A base that is no semantic version is a
 * throw, which the port's wrapper turns into one line.
 *
 * ## The section
 *
 * ```text
 * ## 0.28.0 — 2026-09-29, rafa next --roadmap; rafa plan list --open
 * <!-- rafa:fragments rafa-247 rafa-234 -->
 *
 * - Walk: one hop to a blocker's epic
 * - Plans: new rafa plan list --open
 * ```
 *
 * The heading is `release.heading` rendered by `renderReleaseHeading`
 * (`../changelog.ts`) over three values:
 *
 *   - `{version}`, the bumped version.
 *   - `{title}`, the titles of the fragments that ship something, in
 *     fold order, joined by `; `. A `none` fragment's plan changed
 *     nothing a user would notice, so its title is not a headline of
 *     the release, and a title repeated by a plan's second fragment is
 *     written once.
 *   - `{date}`, the newest {@link FoldFragment.addedOn} among EVERY
 *     folded fragment, `none` ones included: the day the batch the
 *     section settles was complete on the base branch. Taking the
 *     newest rather than the last keeps this, too, independent of order.
 *
 * The receipt comment sits on the line under the heading and names
 * every folded fragment by id in fold order, `none` ones included,
 * because settle deletes those too and the receipt is the record of
 * what the section consumed.
 *
 * The notes follow after a blank line, grouped by area through
 * `groupChangeNotes` and `renderNoteLines`, the same grouping the
 * wrap-up's changelog entry uses. A fragment's note is a line such as
 * `- Walk: one hop`; the text before its first `: ` is read as the area.
 * A note with no area whose summary happens to hold `: ` is split the
 * same way and rendered back as the identical line, so the reading only
 * decides which lines sit together, never what a line says. The notes
 * of a `none` fragment and exact repeats are left out, as the grouping
 * leaves them out of an entry.
 *
 * The fold reads nothing but its arguments: no file, no git, no clock.
 */
import type { PlanReleaseLevel } from '../../plan/parse.js';
import type { ChangelogNote } from '../changelog.js';
import type {
  Fold,
  FoldFragment,
  FoldResult,
  ReleaseStrategyAdapter,
  ReleaseStrategyOptions,
} from '../strategy.js';

import { groupChangeNotes, renderNoteLines, renderReleaseHeading } from '../changelog.js';
import { FRAGMENT_PLAN_ID_PATTERN } from '../fragment.js';
import { highestChangeLevel } from '../level.js';
import { nextVersion } from '../version.js';

/** The name `release.strategy` selects this strategy by. */
export const SEMVER_BY_LEVEL = 'semver-by-level';

/** What a {@link FoldFragment.addedOn} has to look like. */
const ADDED_ON = /^\d{4}-\d{2}-\d{2}$/;

/** A note line: an optional list marker, then `area: summary`. */
const AREA_NOTE = /^(?:[-*+]\s+)?([^:]*[^:\s]):\s+(\S.*)$/;

/** A leading list marker, dropped from a note with no area. */
const LIST_MARKER = /^[-*+]\s+/;

/** The receipt comment naming the fragments a section folded. */
export function fragmentsReceipt(ids: readonly string[]): string {
  return `<!-- rafa:fragments ${ids.join(' ')} -->`;
}

/** `line`, a fragment note, as a note the changelog grouping reads. */
function changelogNoteOf(line: string, level: PlanReleaseLevel): ChangelogNote {
  const trimmed = line.trim();
  const found = AREA_NOTE.exec(trimmed);
  if (found !== null) return { level, area: found[1] ?? null, summary: found[2] ?? '' };
  return { level, area: null, summary: trimmed.replace(LIST_MARKER, '') };
}

/** Throws unless every fragment carries an id and a date the fold can use. */
function assertFoldable(fragments: readonly FoldFragment[]): void {
  for (const each of fragments) {
    if (!FRAGMENT_PLAN_ID_PATTERN.test(each.id)) {
      throw new Error(`fragment id ${JSON.stringify(each.id)} cannot be one word of the receipt comment`);
    }
    if (!ADDED_ON.test(each.addedOn)) {
      throw new Error(`fragment ${each.id} has add date ${JSON.stringify(each.addedOn)}, expected YYYY-MM-DD`);
    }
  }
}

/** The newest add date among `fragments`, which is not empty. */
function newestAddDate(fragments: readonly FoldFragment[]): string {
  return fragments.reduce(
    (newest, each) => (
      each.addedOn.localeCompare(newest) > 0
        ? each.addedOn
        : newest
    ),
    fragments[0]?.addedOn ?? '',
  );
}

/** The titles of the shipping fragments, in order, repeats written once. */
function batchTitle(shipping: readonly FoldFragment[]): string {
  const titles = shipping.map((each) => each.fragment.title.trim());
  return [...new Set(titles)].join('; ');
}

/** The section's lines under its heading and receipt, grouped by area. */
function noteLines(fragments: readonly FoldFragment[]): string[] {
  const notes = fragments.flatMap(
    (each) => each.fragment.notes.map((line) => changelogNoteOf(line, each.fragment.level)),
  );
  return renderNoteLines(groupChangeNotes(notes));
}

/** The `semver-by-level` fold over `heading`; see the module note. */
function foldBy(heading: string): Fold {
  return (currentVersion: string, orderedFragments: readonly FoldFragment[]): FoldResult | null => {
    assertFoldable(orderedFragments);
    const level = highestChangeLevel(orderedFragments.map((each) => each.fragment));
    if (level === null || level === 'none') return null;

    const version = nextVersion(currentVersion, level);
    if (version === null) {
      throw new Error(`the base version ${JSON.stringify(currentVersion)} is no semantic version to bump`);
    }

    const shipping = orderedFragments.filter((each) => each.fragment.level !== 'none');
    const headingLine = renderReleaseHeading(heading, {
      version,
      date: newestAddDate(orderedFragments),
      title: batchTitle(shipping),
    });
    const top = `${headingLine}\n${fragmentsReceipt(orderedFragments.map((each) => each.id))}`;
    const lines = noteLines(orderedFragments);
    const section = lines.length === 0
      ? top
      : `${top}\n\n${lines.join('\n')}`;
    return { version, section };
  };
}

/** The `semver-by-level` strategy, rendering headings from `options.heading`. */
export function createSemverByLevel(options: ReleaseStrategyOptions): ReleaseStrategyAdapter {
  return { name: SEMVER_BY_LEVEL, fold: foldBy(options.heading) };
}
