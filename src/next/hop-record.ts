/**
 * The hop record: the one per-checkout file that says a `rafa next
 * --roadmap` hop is under way, which issue it works and where home is. It
 * is kept in `<project>/.rafa/hop.json` beside `position.json`, in the
 * project scope directory (`scopeAt(root).dir`).
 *
 * ## The record
 *
 * A {@link HopRecord} holds:
 *
 * - `kind`: `blocker` for a hop to the epic holding H's blocker C, or
 *   `dry` for a hop to the next `now` epic after the home epic ran dry.
 * - `home` and `from`: the place the hop comes back to, and the place it
 *   left. Both are {@link Place} pairs, read as `position.ts` reads them.
 * - `blocked` and `target`: the issue numbers H and C. A `blocker` record
 *   holds both; a `dry` record holds null in both, and any other mix is
 *   read as a wrong shape.
 * - `targetEpic` and `targetBoard`: the epic and board the hop goes to.
 * - `state`: `away` while the hop works its target, `waiting` once it came
 *   home with the target's pull request open, `merged` once it came home
 *   with the target closed, `halted` once it came home from a halt. The
 *   `home` action (`./hop-action.ts`) writes the last three.
 * - `pullRequest`: the target's pull request number, or null before one.
 * - `startedAt`: when the hop began, an ISO 8601 timestamp.
 *
 * ## Reading
 *
 * {@link readHopRecord} never throws. It answers the record, or unset with
 * the reason it is unset: `absent` (no file), `unreadable` (the file is
 * there and reading it failed) or `wrong-shape` (the file holds no JSON,
 * or JSON that is not a hop record; the `detail` tells the two apart).
 * Each reason carries a one-line `detail` naming the file.
 *
 * ## Writing
 *
 * {@link writeHopRecord} creates `.rafa/` when it is not there, writes a
 * temporary file in the same directory and renames it over the old one,
 * as `writePositionFile` does: a reader, or a second writer racing this
 * one, only ever sees a whole file. The temporary name holds the pid and
 * a random suffix, so two writers never share one, and a failed write
 * removes its temporary file before it rethrows. Only the record's own
 * keys are written.
 *
 * ## Staleness
 *
 * {@link staleAgainst} answers true when the position's `home` is not the
 * record's `home`: a person switched by hand, which re-homes, so the
 * record no longer describes this checkout and the caller drops it.
 */
import type { Place, Position } from '../project/position.js';

import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { messageOf } from '../config-sections.js';
import { asPlace } from '../project/position.js';
import { scopeAt } from '../project/scope.js';

/** The hop record's file name, under the project's `.rafa/`. */
export const HOP_FILE = 'hop.json';

/** Why the hop went: H's blocker, or a home epic that ran dry. */
export type HopKind = 'blocker' | 'dry';

/** Where the hop stands: working its target, back home waiting on it or with it merged, or back home from a halt. */
export type HopState = 'away' | 'waiting' | 'merged' | 'halted';

/** The record the file holds; see the module note. */
export interface HopRecord {
  readonly kind: HopKind;
  readonly home: Place;
  readonly from: Place;
  /** H, the home issue its blocker stopped; null on a dry hop. */
  readonly blocked: number | null;
  /** C, H's blocker the hop works; null on a dry hop. */
  readonly target: number | null;
  readonly targetEpic: number;
  readonly targetBoard: number;
  readonly state: HopState;
  /** The target's pull request, null before it is opened. */
  readonly pullRequest: number | null;
  /** ISO 8601. */
  readonly startedAt: string;
}

/** Why the file reads as unset. */
export type HopUnsetReason = 'absent' | 'unreadable' | 'wrong-shape';

/** What {@link readHopRecord} answers. Never a rejection. */
export type HopReading =
  | { readonly set: true; readonly record: HopRecord }
  | { readonly set: false; readonly reason: HopUnsetReason; readonly detail: string };

const HOP_KINDS: readonly string[] = ['blocker', 'dry'] satisfies readonly HopKind[];
const HOP_STATES: readonly string[] = ['away', 'waiting', 'merged', 'halted'] satisfies readonly HopState[];

/** `<root>/.rafa/hop.json`. */
export function hopFilePath(root: string): string {
  return join(scopeAt(root).dir, HOP_FILE);
}

/** True for a plain object. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** True for an issue number: a positive integer. */
function isIssueNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

/** True for an issue number or null. */
function isIssueOrNull(value: unknown): value is number | null {
  return value === null || isIssueNumber(value);
}

/** True for a string `Date` can read. */
function isTimestamp(value: unknown): value is string {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

/** True when `blocked` and `target` match the kind: both set on a blocker hop, both null on a dry one. */
function issuesMatchKind(kind: HopKind, blocked: number | null, target: number | null): boolean {
  return kind === 'blocker'
    ? blocked !== null && target !== null
    : blocked === null && target === null;
}

/**
 * `value` as a hop record, or null when it is not one: the check
 * {@link readHopRecord} makes on the parsed file, which the session record
 * makes on its `hop` field (`src/loop/sessions.ts`).
 */
export function asHopRecord(value: unknown): HopRecord | null {
  if (!isRecord(value)) return null;
  const { kind, blocked, target, targetEpic, targetBoard, state, pullRequest, startedAt } = value;
  const home = asPlace(value.home);
  const from = asPlace(value.from);
  if (typeof kind !== 'string' || !HOP_KINDS.includes(kind)) return null;
  if (typeof state !== 'string' || !HOP_STATES.includes(state)) return null;
  if (home === null || from === null) return null;
  if (!isIssueOrNull(blocked) || !isIssueOrNull(target) || !isIssueOrNull(pullRequest)) return null;
  if (!isIssueNumber(targetEpic) || !isIssueNumber(targetBoard) || !isTimestamp(startedAt)) return null;
  const hopKind = kind as HopKind;
  if (!issuesMatchKind(hopKind, blocked, target)) return null;
  return {
    kind: hopKind,
    home,
    from,
    blocked,
    target,
    targetEpic,
    targetBoard,
    state: state as HopState,
    pullRequest,
    startedAt,
  };
}

/** Reads `.rafa/hop.json`; see the module note. */
export function readHopRecord(root: string): HopReading {
  const file = hopFilePath(root);
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    return code === 'ENOENT'
      ? { set: false, reason: 'absent', detail: `No hop record at ${file}` }
      : { set: false, reason: 'unreadable', detail: `Cannot read ${file}: ${messageOf(error)}` };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return { set: false, reason: 'wrong-shape', detail: `${file} holds no JSON: ${messageOf(error)}` };
  }
  const record = asHopRecord(parsed);
  return record === null
    ? { set: false, reason: 'wrong-shape', detail: `${file} does not hold a hop record` }
    : { set: true, record };
}

/** The record's own keys, in the order the file holds them. */
function ownKeys(record: HopRecord): HopRecord {
  const { kind, home, from, blocked, target, targetEpic, targetBoard, state, pullRequest, startedAt } = record;
  return {
    kind,
    home: { board: home.board, epic: home.epic },
    from: { board: from.board, epic: from.epic },
    blocked,
    target,
    targetEpic,
    targetBoard,
    state,
    pullRequest,
    startedAt,
  };
}

/** Writes `record` to `.rafa/hop.json` whole; see the module note. Throws when it cannot. */
export function writeHopRecord(root: string, record: HopRecord): void {
  const file = hopFilePath(root);
  mkdirSync(dirname(file), { recursive: true });
  const temporary = `${file}.${String(process.pid)}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, `${JSON.stringify(ownKeys(record), null, 2)}\n`);
    renameSync(temporary, file);
  } catch (error) {
    rmSync(temporary, { force: true });
    throw error;
  }
}

/** True when `position`'s home is not `record`'s: a person switched by hand and the record is stale. */
export function staleAgainst(record: HopRecord, position: Position): boolean {
  return position.home.board !== record.home.board || position.home.epic !== record.home.epic;
}
