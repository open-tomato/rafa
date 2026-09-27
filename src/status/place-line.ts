/**
 * The words `rafa status` shows for where this checkout stands: the
 * place line, and the away line while the current place is not home
 * (`.rafa/specs/rafa-245-boards-several-roadmaps-per.md`). It reads
 * nothing and prints nothing: the caller hands in a {@link PlaceView}
 * built from the place `resolvePlace` (`src/board/place.ts`) answered
 * and the board listing it already read, and writes the lines itself.
 *
 * ## The place line
 *
 * {@link placeLine} spells the place as fields joined by ` · `:
 *
 * | The place | Its line |
 * | --- | --- |
 * | at an epic | `board #<b> · epic #<e> <title> (<horizon>) · <done>/<total> done · next #<n>` |
 * | on a board with no epic | `board #<b> · no epic · next #<n>` |
 *
 * The `next #<n>` field is left out when the view has no next issue, so
 * an epic with nothing left to pick ends at its `done` count. The
 * board-only form says `no epic` as `rafa switch` does for a board that
 * names no `now` epic that is not done.
 *
 * ## The away line
 *
 * {@link awayLine} answers `away from home: working #C for #H` while the
 * current place and home differ, and null while they are one place.
 * Each side is named by its epic, or by its board when its epic is
 * null, since issue numbers are unique in a repository and the number
 * alone says which it is. Two places on one board at different epics
 * name their epics; a place at an epic and one on the same board with no
 * epic name the epic and the board.
 */
import type { Horizon } from '../board/roadmap-epic-rows.js';
import type { Place } from '../project/position.js';

import { samePlace } from '../board/place.js';

/** What the place line says about the current epic. */
export interface EpicView {
  readonly number: number;
  readonly title: string;
  readonly horizon: Horizon;
  /** Issues of the epic done. */
  readonly done: number;
  /** Issues of the epic in all. */
  readonly total: number;
}

/** What {@link placeLine} spells; see the module note. */
export interface PlaceView {
  readonly board: number;
  /** The current epic, or null for the board-only form. */
  readonly epic: EpicView | null;
  /** The next issue to pick, or null to leave the `next` field out. */
  readonly next: number | null;
}

/** The separator between the place line's fields. */
export const PLACE_SEPARATOR = ' · ';

/** What the away line opens with. */
export const AWAY_PREFIX = 'away from home';

/** `#<n>`. */
function id(number: number): string {
  return `#${String(number)}`;
}

/** The epic field of the place line. */
function epicFields(epic: EpicView | null): readonly string[] {
  if (epic === null) return ['no epic'];
  return [
    `epic ${id(epic.number)} ${epic.title} (${epic.horizon})`,
    `${String(epic.done)}/${String(epic.total)} done`,
  ];
}

/** The place line for `view`; see the module note. */
export function placeLine(view: PlaceView): string {
  const next = view.next === null
    ? []
    : [`next ${id(view.next)}`];
  return [`board ${id(view.board)}`, ...epicFields(view.epic), ...next].join(PLACE_SEPARATOR);
}

/** The number that names `place`: its epic, or its board when the epic is null. */
export function placeNumber(place: Place): number {
  return place.epic ?? place.board;
}

/** `away from home: working #C for #H`, or null when `current` is `home`; see the module note. */
export function awayLine(current: Place, home: Place): string | null {
  if (samePlace(current, home)) return null;
  return `${AWAY_PREFIX}: working ${id(placeNumber(current))} for ${id(placeNumber(home))}`;
}
