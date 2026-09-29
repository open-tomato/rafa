/**
 * The `hop` and `home` actions of `rafa next --roadmap`: the two steps the
 * hop rows propose (`./hop-rows.ts`) that write the hop record
 * (`./hop-record.ts`) and move the position (`src/project/position.ts`).
 * Like `sync` (`./sync.ts`) neither is a registered command of its own
 * name; `./actions.ts` runs both in-process and hands them the
 * {@link HopActionWorld} they write through.
 *
 * ## `hop`
 *
 * {@link runHop} takes the {@link HopOut} its row carries and:
 *
 * 1. writes the hop record: the row's opening, in state `away`, with no
 *    pull request yet and `startedAt` now;
 * 2. moves the position through the registered `switch <epic>
 *    --no-rehome` ({@link HopActionWorld.switchTo}), so the switch's own
 *    refusals, its own place line and the board it picks for the epic
 *    are the command's, and home stays where it was;
 * 3. prints its log line: `hop from epic #<e>: #<H> blocked by #<C>, in
 *    epic #<f>` for a blocker hop, the sentence `hopMoveSentence`
 *    (`./hop-chain.ts`) reads the row's decision with, or the dry form
 *    `dryHopSentence` (`./hop-rows.ts`) words for a dry hop.
 *
 * The record is written FIRST so a turn read while the switch runs never
 * sees the position away with no record saying why. A switch that
 * throws puts back what the file held before — the earlier record, or
 * no file — and the throw travels on, so a refused move leaves no `away`
 * record over a position that never left; the log line is printed only
 * once the move is made.
 *
 * ## `home`
 *
 * {@link runHome} takes the {@link HopHome} its row carries and:
 *
 * 1. writes `goHome` over the position, so home becomes current and the
 *    place left becomes previous. A position already at home is left as
 *    it is, since `goHome` there would overwrite `previous` with home and
 *    lose the place `rafa switch -` goes back to; with no position file
 *    the checkout already stands at the fallback place a first switch
 *    resolves as home, and nothing is written. A file that is there and
 *    does not read is warned about and rewritten at the row's home;
 * 2. closes the hop record as `waiting` (with the target's pull request),
 *    `merged` or `halted`, the row's {@link HopHome.closing}. Only an
 *    `away` record whose home is the position's is closed: a record
 *    already closed belongs to an earlier hop, whose `waiting` a halt at
 *    home must not overwrite, and a stale one (`staleAgainst`) is a
 *    person's switch that `rafa next` follows rather than undoes. With
 *    no position file the record is stale the same way, as the board
 *    reads it (`./sources.ts`), and is left as it is;
 * 3. prints `back home: epic #<e> on board #<b>`, or `back home: board
 *    #<b>` for a home with no epic chosen.
 *
 * Neither function spawns a process: `hop` moves through the registered
 * command it is handed, and both write the two files through their own
 * modules' atomic writers.
 */
import type { HopReading, HopRecord } from './hop-record.js';
import type { HopHome, HopOpening, HopOut } from './hop-rows.js';
import type { Place, Position } from '../project/position.js';

import { rmSync } from 'node:fs';

import { samePlace } from '../board/place.js';
import { CommandExit } from '../cli/command.js';
import { messageOf } from '../config-sections.js';
import { goHome, positionAt, positionFilePath, readPositionFile, writePositionFile } from '../project/position.js';

import { hopMoveSentence } from './hop-chain.js';
import { hopFilePath, readHopRecord, staleAgainst, writeHopRecord } from './hop-record.js';
import { dryHopSentence, placeText } from './hop-rows.js';

/** The flag `hop` moves with, so the switch keeps home. */
export const NO_REHOME = '--no-rehome';

/** What the two actions read, write and print through; `./actions.ts` builds it off the caller's context. */
export interface HopActionWorld {
  /** The project root whose `.rafa/` holds the position and the hop record. */
  readonly root: string;
  /** Runs the registered `rafa switch` with these words after it. */
  readonly switchTo: (argv: readonly string[]) => Promise<void>;
  /** Where a log line goes. */
  readonly info: (line: string) => void;
  /** Where a file that did not read goes. */
  readonly warn: (line: string) => void;
  /** The time `startedAt` is stamped with. */
  readonly now: () => Date;
}

/** What {@link runHome} wrote. */
export interface HomeOutcome {
  /** The position written, or null where none was: at home already, or no position file. */
  readonly position: Position | null;
  /** The record closed, or null where no `away` record was there to close. */
  readonly record: HopRecord | null;
  /** The log line printed. */
  readonly line: string;
}

/** The log line a hop prints; see the module note. */
export function hopLogLine(opening: HopOpening): string {
  const { from, blocked, target, targetEpic, targetBoard } = opening;
  if (opening.kind === 'dry' || blocked === null || target === null) {
    return dryHopSentence({ number: from.epic ?? from.board }, { number: targetEpic, board: targetBoard });
  }
  return hopMoveSentence({ from, blocked, blocker: target, epic: targetEpic });
}

/** The log line coming home prints: `back home: epic #<e> on board #<b>`. */
export function homeLogLine(home: Place): string {
  return `back home: ${placeText(home)}`;
}

/** The record a hop opens: the row's opening, away, with no pull request yet. */
function openedRecord(opening: HopOpening, now: Date): HopRecord {
  return {
    ...opening,
    state: 'away',
    pullRequest: null,
    startedAt: now.toISOString(),
  };
}

/** Writes `record`; a refusal with exit code 1 naming the file when it cannot. */
function writeRecord(root: string, record: HopRecord): void {
  try {
    writeHopRecord(root, record);
  } catch (error) {
    throw new CommandExit(1, `❌ Could not write ${hopFilePath(root)}: ${messageOf(error)}`);
  }
}

/** Puts back what the record file held before a hop that did not move: the earlier record, or no file. */
function restoreRecord(root: string, before: HopReading): void {
  if (before.set) writeHopRecord(root, before.record);
  else rmSync(hopFilePath(root), { force: true });
}

/**
 * Runs `hop`: writes the record, moves through `switch <epic>
 * --no-rehome` and prints the log line; see the module note. Answers the
 * record written. Whatever the switch throws travels on, the record
 * file put back first.
 */
export async function runHop(world: HopActionWorld, step: HopOut): Promise<HopRecord> {
  const { opening } = step;
  const before = readHopRecord(world.root);
  const record = openedRecord(opening, world.now());
  writeRecord(world.root, record);
  try {
    await world.switchTo([String(opening.targetEpic), NO_REHOME]);
  } catch (error) {
    restoreRecord(world.root, before);
    throw error;
  }
  world.info(hopLogLine(opening));
  return record;
}

/** Writes `position`; a refusal with exit code 1 naming the file when it cannot. */
function writePosition(root: string, position: Position): void {
  try {
    writePositionFile(root, position);
  } catch (error) {
    throw new CommandExit(1, `❌ Could not write ${positionFilePath(root)}: ${messageOf(error)}`);
  }
}

/** The position home stands at once written, and whether it had to be; see the module note. */
function movedHome(world: HopActionWorld, step: HopHome): { readonly now: Position | null; readonly written: boolean } {
  const reading = readPositionFile(world.root);
  if (reading.set) {
    if (samePlace(reading.position.current, reading.position.home)) return { now: reading.position, written: false };
    return { now: goHome(reading.position), written: true };
  }
  if (reading.reason === 'absent') return { now: null, written: false };
  world.warn(`${reading.detail}, so it is written afresh at home`);
  return { now: positionAt(step.home), written: true };
}

/** The `away` record `home` closes, or null where there is none to close; see the module note. */
function awayToClose(world: HopActionWorld, position: Position | null): HopRecord | null {
  const reading = readHopRecord(world.root);
  if (!reading.set) {
    if (reading.reason !== 'absent') world.warn(`${reading.detail}, so no hop record is closed`);
    return null;
  }
  const { record } = reading;
  if (record.state !== 'away' || position === null) return null;
  return staleAgainst(record, position)
    ? null
    : record;
}

/** Runs `home`: writes `goHome`, closes the away record and prints the log line; see the module note. */
export function runHome(world: HopActionWorld, step: HopHome): HomeOutcome {
  const moved = movedHome(world, step);
  if (moved.written && moved.now !== null) writePosition(world.root, moved.now);

  const away = awayToClose(world, moved.now);
  const closed: HopRecord | null = away === null
    ? null
    : { ...away, state: step.closing, pullRequest: step.pullRequest ?? away.pullRequest };
  if (closed !== null) writeRecord(world.root, closed);

  const line = homeLogLine(moved.now?.home ?? step.home);
  world.info(line);
  return Object.freeze({
    position: moved.written
      ? moved.now
      : null,
    record: closed,
    line,
  });
}
