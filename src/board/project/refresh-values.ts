/**
 * The pure half of the refresh (`./refresh.ts`): the five values an
 * issue should hold on the project, computed through the rules
 * (`./rules.ts`), and the writes that bring an item from what it holds to
 * them. Nothing here reads the network or the clock.
 *
 * ## The values
 *
 * {@link projectValuesOf} reads one issue's facts (`./facts.ts`) beside
 * the board the refresh read once for every issue ({@link RefreshBoard}):
 * Stage and Horizon off the facts, Rank off the home board's order, Blocked
 * by off the relations port's `blockersOf`, Progress off the issue's epic
 * as `readEpics` (`../epics.ts`) counted it. A null value is an empty
 * field.
 *
 * ## Only the values that differ
 *
 * {@link projectChangesOf} compares each value with what the item holds
 * in the field of that exact name, and answers one {@link ProjectChange}
 * per field that differs, in {@link PROJECT_FIELDS} order:
 *
 *  - a value the item already holds is no change: an option by its id, a
 *    number by its value, a text by its exact characters;
 *  - a null value over a field the item holds no value in is no change;
 *    over one it holds a value in, it is a clear;
 *  - any other value is a set, a value of another kind than the field's
 *    included, so a text left in a field by hand is overwritten.
 *
 * Only the fields matched against the template are compared
 * (`matchProjectFields`, `./port.ts`): a field the project lacks, holds
 * as another type, or holds without one of its options is skipped whole,
 * and the other four are still compared.
 */
import type { IssueFacts } from './facts.js';
import type { MatchedField, ProjectFieldKey, ProjectFieldValue, ProjectItem } from './port.js';
import type { HorizonOption, StageOption } from './rules.js';
import type { ProjectFieldWrite, ProjectWriteValue } from './writes.js';
import type { Epic } from '../epics.js';
import type { BlockersReading } from '../relations/port.js';

import { FIELD_DATA_TYPES } from './port.js';
import {
  blockedByTextOf,
  horizonOptionOf,
  progressTextOf,
  rankOf,
  stageOf,
} from './rules.js';

/** The board the refresh reads once and every issue's values are computed against. */
export interface RefreshBoard {
  /** Every ranked issue's Rank, by issue number, as `ranksOf` numbers them. */
  readonly ranks: ReadonlyMap<number, number>;
  /** The epics `readEpics` read off the listing, by issue number. */
  readonly epics: ReadonlyMap<number, Epic>;
  /** What issue `issue` waits on, as the relations port reads it in the board's mode. */
  readonly blockersOf: (issue: number) => BlockersReading;
}

/** The five values one issue should hold; null is an empty field. */
export interface ProjectValues {
  readonly stage: StageOption | null;
  readonly horizon: HorizonOption | null;
  readonly rank: number | null;
  readonly blockedBy: string | null;
  readonly progress: string | null;
}

/** One field of one item whose value differs from what the rules give. */
export interface ProjectChange {
  /** The issue the item stands for. */
  readonly issue: number;
  readonly field: ProjectFieldKey;
  /** The field's exact name on the project. */
  readonly name: string;
  /** What the item holds, as the project shows it, or null for no value. */
  readonly from: string | null;
  /** What the rules give, as the project will show it, or null for a clear. */
  readonly to: string | null;
  /** The write that makes the change. */
  readonly write: ProjectFieldWrite;
}

/** The five values of the issue `facts` describe, against `board`; see the module note. */
export function projectValuesOf(facts: IssueFacts, board: RefreshBoard): ProjectValues {
  return {
    stage: stageOf(facts),
    horizon: horizonOptionOf(facts),
    rank: rankOf(board.ranks, facts.number),
    blockedBy: blockedByTextOf(board.blockersOf(facts.number)),
    progress: progressTextOf(board.epics.get(facts.number) ?? null),
  };
}

/** `value` as the project shows it. */
function shown(value: ProjectFieldValue | undefined): string | null {
  if (value === undefined) return null;
  if (value.kind === 'option') return value.name;
  return value.kind === 'number'
    ? String(value.number)
    : value.text;
}

/** The value a set of `wanted` writes in `matched`; throws a `RangeError` for one the field cannot hold. */
function writeValue(matched: MatchedField, wanted: string | number): ProjectWriteValue {
  const { dataType, name } = matched.template;
  if (dataType === FIELD_DATA_TYPES.number && typeof wanted === 'number') return { kind: 'number', number: wanted };
  if (dataType === FIELD_DATA_TYPES.text && typeof wanted === 'string') return { kind: 'text', text: wanted };
  const optionId = typeof wanted === 'string'
    ? matched.options.get(wanted)
    : undefined;
  if (dataType !== FIELD_DATA_TYPES.singleSelect || optionId === undefined) {
    throw new RangeError(`not a value the field "${name}" holds: ${JSON.stringify(wanted)}`);
  }
  return { kind: 'option', optionId };
}

/** True when `held` is already `value`. */
function holds(held: ProjectFieldValue | undefined, value: ProjectWriteValue): boolean {
  if (held === undefined || held.kind !== value.kind) return false;
  if (held.kind === 'option' && value.kind === 'option') return held.optionId === value.optionId;
  if (held.kind === 'number' && value.kind === 'number') return held.number === value.number;
  return held.kind === 'text' && value.kind === 'text' && held.text === value.text;
}

/** The change one matched field needs, or null when the item already holds the value. */
function changeOf(issue: number, item: ProjectItem, matched: MatchedField, wanted: string | number | null): ProjectChange | null {
  const { key: field, name } = matched.template;
  const held = item.values.get(matched.field.name);
  const from = shown(held);
  const target = { itemId: item.id, fieldId: matched.field.id };
  if (wanted === null) {
    return held === undefined
      ? null
      : { issue, field, name, from, to: null, write: { kind: 'clear', ...target } };
  }
  const value = writeValue(matched, wanted);
  return holds(held, value)
    ? null
    : { issue, field, name, from, to: String(wanted), write: { kind: 'set', ...target, value } };
}

/**
 * The changes that bring `item`, standing for issue `issue`, to `values`,
 * over the fields `matched` found as the template has them; see the
 * module note.
 */
export function projectChangesOf(
  issue: number,
  item: ProjectItem,
  values: ProjectValues,
  matched: readonly MatchedField[],
): readonly ProjectChange[] {
  return matched.flatMap((field) => changeOf(issue, item, field, values[field.template.key]) ?? []);
}
