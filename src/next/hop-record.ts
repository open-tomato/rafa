/**
 * The hop record: the one per-checkout file that says a `rafa next
 * --roadmap` hop is under way, which issue it works and where home is. It
 * is kept in `<project>/.rafa/hop.json` beside `position.json`, in the
 * project scope directory (`scopeAt(root).dir`).
 *
 * ## The record
 *
 * A {@link HopRecord} holds the fields below. Its type, `HopKind`,
 * `HopState` and {@link asHopRecord}, the check of its shape, live in
 * `packages/rafa/src/core/loop/hop-record.ts`, where a session record reads them; this
 * file re-exports them under the same names.
 *
 * - `kind`: `blocker` for a hop to the epic holding H's blocker C, or
 *   `dry` for a hop to the next `now` epic after the home epic ran dry.
 * - `home` and `from`: the place the hop comes back to, and the place it
 *   left. Both are `Place` pairs, read through `asPlace` as `position.ts`
 *   reads them.
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
import type { Position } from '../project/position.js';
import type { HopKind, HopRecord, HopState } from '@open-tomato/rafa/core/loop/hops';

import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { messageOf } from '@open-tomato/rafa/core/config/sections';
import { asHopRecord } from '@open-tomato/rafa/core/loop/hops';

import { scopeAt } from '../project/scope.js';

export type { HopKind, HopRecord, HopState };
export { asHopRecord };

/** The hop record's file name, under the project's `.rafa/`. */
export const HOP_FILE = 'hop.json';

/** Why the file reads as unset. */
export type HopUnsetReason = 'absent' | 'unreadable' | 'wrong-shape';

/** What {@link readHopRecord} answers. Never a rejection. */
export type HopReading =
  | { readonly set: true; readonly record: HopRecord }
  | { readonly set: false; readonly reason: HopUnsetReason; readonly detail: string };

/** `<root>/.rafa/hop.json`. */
export function hopFilePath(root: string): string {
  return join(scopeAt(root).dir, HOP_FILE);
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
