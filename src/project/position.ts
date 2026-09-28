/**
 * The position file: where this checkout stands among the project's
 * boards and epics, kept in `<project>/.rafa/position.json` beside
 * `status-seen.json`, in the project scope directory (`scopeAt(root).dir`),
 * so a nested `.rafa/config.yaml` in a monorepo package keeps its own.
 *
 * ## The triple
 *
 * A {@link Place} is a (board, epic) pair of issue numbers; `epic` is null
 * on a board with no epic chosen. A {@link Position} holds three places the
 * way a shell holds `PWD` and `OLDPWD`: `current`, `previous` (null until
 * the first move) and `home`, the place a hop comes back to. Nothing else
 * is in the file, and the file is read whole or not at all.
 *
 * ## Reading
 *
 * {@link readPositionFile} never throws. It answers the position, or
 * unset with the reason it is unset: `absent` (no file), `unreadable`
 * (the file is there and reading it failed), `invalid-json` (it holds no
 * JSON) or `wrong-shape` (JSON that is not a position). Each reason
 * carries a one-line `detail` naming the file, so the caller can print a
 * notice that says why it fell back.
 *
 * ## Writing
 *
 * {@link writePositionFile} creates `.rafa/` when it is not there, writes
 * a temporary file in the same directory and renames it over the old one.
 * The rename is atomic on one filesystem, so a reader, or a second writer
 * racing this one, only ever sees a whole file. The temporary name holds
 * the pid and a random suffix, so two writers never share one, and a
 * failed write removes its temporary file before it rethrows.
 *
 * ## Moving
 *
 * The transitions are pure and answer a new position, never touching the
 * one they are given. {@link rehome} is a switch made by hand: the new
 * place becomes current and home. {@link hop} is a switch that keeps home
 * (`--no-rehome`). {@link swap} goes back to the previous place, as
 * `cd -` does, keeping home, and answers null when there is no previous
 * place. {@link goHome} is the way back from a hop: home becomes current,
 * the place left becomes previous, and home is kept; at home already it
 * answers a position whose previous is home too. {@link positionAt} is the
 * position a first switch starts from.
 */
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { messageOf } from '../config-sections.js';

import { scopeAt } from './scope.js';

/** The position's file name, under the project's `.rafa/`. */
export const POSITION_FILE = 'position.json';

/** A (board, epic) pair of issue numbers; `epic` is null on a board with no epic chosen. */
export interface Place {
  readonly board: number;
  readonly epic: number | null;
}

/** The place triple the file holds; see the module note. */
export interface Position {
  readonly current: Place;
  /** Null until the first move. */
  readonly previous: Place | null;
  readonly home: Place;
}

/** Why the file reads as unset. */
export type PositionUnsetReason = 'absent' | 'unreadable' | 'invalid-json' | 'wrong-shape';

/** What {@link readPositionFile} answers. Never a rejection. */
export type PositionReading =
  | { readonly set: true; readonly position: Position }
  | { readonly set: false; readonly reason: PositionUnsetReason; readonly detail: string };

/** `<root>/.rafa/position.json`. */
export function positionFilePath(root: string): string {
  return join(scopeAt(root).dir, POSITION_FILE);
}

/** True for a plain object. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** True for an issue number: a positive integer. */
function isIssueNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

/** `value` as a place, or null when it is not one. */
function asPlace(value: unknown): Place | null {
  if (!isRecord(value) || !isIssueNumber(value.board)) return null;
  if (value.epic !== null && !isIssueNumber(value.epic)) return null;
  return { board: value.board, epic: value.epic };
}

/** `value` as a position, or null when it is not one. */
function asPosition(value: unknown): Position | null {
  if (!isRecord(value)) return null;
  const current = asPlace(value.current);
  const home = asPlace(value.home);
  const previous = value.previous === null
    ? null
    : asPlace(value.previous);
  if (current === null || home === null) return null;
  if (previous === null && value.previous !== null) return null;
  return { current, previous, home };
}

/** Reads `.rafa/position.json`; see the module note. */
export function readPositionFile(root: string): PositionReading {
  const file = positionFilePath(root);
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    return code === 'ENOENT'
      ? { set: false, reason: 'absent', detail: `No position file at ${file}` }
      : { set: false, reason: 'unreadable', detail: `Cannot read ${file}: ${messageOf(error)}` };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return { set: false, reason: 'invalid-json', detail: `${file} holds no JSON: ${messageOf(error)}` };
  }
  const position = asPosition(parsed);
  return position === null
    ? { set: false, reason: 'wrong-shape', detail: `${file} does not hold a current, previous and home place` }
    : { set: true, position };
}

/** Writes `position` to `.rafa/position.json` whole; see the module note. Throws when it cannot. */
export function writePositionFile(root: string, position: Position): void {
  const file = positionFilePath(root);
  mkdirSync(dirname(file), { recursive: true });
  const temporary = `${file}.${String(process.pid)}.${randomUUID()}.tmp`;
  const { current, previous, home } = position;
  try {
    writeFileSync(temporary, `${JSON.stringify({ current, previous, home }, null, 2)}\n`);
    renameSync(temporary, file);
  } catch (error) {
    rmSync(temporary, { force: true });
    throw error;
  }
}

/** The position a first switch starts from: `place` current and home, nothing previous. */
export function positionAt(place: Place): Position {
  return { current: place, previous: null, home: place };
}

/** A switch made by hand: `place` becomes current and home. */
export function rehome(position: Position, place: Place): Position {
  return { current: place, previous: position.current, home: place };
}

/** A switch that keeps home (`--no-rehome`): `place` becomes current. */
export function hop(position: Position, place: Place): Position {
  return { current: place, previous: position.current, home: position.home };
}

/** Back to the previous place, keeping home; null when there is none. */
export function swap(position: Position): Position | null {
  if (position.previous === null) return null;
  return { current: position.previous, previous: position.current, home: position.home };
}

/** Back home from wherever the position stands: home becomes current, the place left previous. */
export function goHome(position: Position): Position {
  return { current: position.home, previous: position.current, home: position.home };
}
