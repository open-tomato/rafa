/**
 * When the machine slept. A loop's wall time holds every suspend that
 * fell inside it, so a reading subtracts them before it calls a minute
 * work. Linux records them in the kernel log (`PM: suspend entry` and
 * `PM: suspend exit`), macOS in `pmset -g log` (`Sleep` and `Wake`
 * lines). A log that cannot be read is `unknown`, never "no suspends".
 *
 * @module bundled/operators/scripts/suspends
 */
import type { Io } from './io.js';

/** One stretch of sleep, in epoch milliseconds. */
export interface Suspend {
  readonly from: number;
  readonly to: number;
}

/** What the suspend log said: the suspends, or that it could not be read. */
export type SuspendReading =
  | { readonly known: true; readonly suspends: readonly Suspend[] }
  | { readonly known: false; readonly reason: string };

/** Milliseconds in a minute. */
const MINUTE_MS = 60_000;

/** The ISO timestamp at the start of a `journalctl -o short-iso` line. */
const JOURNAL_LINE = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:?\d{2})\s.*PM: suspend (entry|exit)/;

/** A `pmset -g log` line: its timestamp, then `Sleep` or `Wake` as the event. */
const PMSET_LINE = /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} [+-]\d{4})\s+(Sleep|Wake)\s/;

/** Pairs each entry with the exit after it; an entry with no exit is dropped. */
function pair(marks: readonly { at: number; enter: boolean }[]): Suspend[] {
  const suspends: Suspend[] = [];
  let open: number | undefined;

  for (const mark of marks) {
    if (mark.enter) {
      open = mark.at;
    } else if (open !== undefined && mark.at > open) {
      suspends.push({ from: open, to: mark.at });
      open = undefined;
    }
  }

  return suspends;
}

/** The suspends in `journalctl -k -o short-iso` output. */
export function parseJournal(text: string): Suspend[] {
  const marks = text.split('\n').flatMap((line) => {
    const match = JOURNAL_LINE.exec(line);

    return match?.[1]
      ? [{ at: Date.parse(match[1]), enter: match[2] === 'entry' }]
      : [];
  });

  return pair(marks);
}

/** `2026-10-01 23:09:18 +0200` as epoch milliseconds. */
function pmsetTime(stamp: string): number {
  const [date, time, zone = '+0000'] = stamp.split(' ');

  return Date.parse(`${date}T${time}${zone.slice(0, 3)}:${zone.slice(3)}`);
}

/** The suspends in `pmset -g log` output. */
export function parsePmset(text: string): Suspend[] {
  const marks = text.split('\n').flatMap((line) => {
    const match = PMSET_LINE.exec(line);

    return match?.[1]
      ? [{ at: pmsetTime(match[1]), enter: match[2] === 'Sleep' }]
      : [];
  });

  return pair(marks);
}

/** Reads this machine's suspends since `since` (epoch milliseconds). */
export function readSuspends(io: Io, since: number): SuspendReading {
  const platform = io.platform();

  if (platform === 'linux') {
    const run = io.exec(['journalctl', '-k', '-o', 'short-iso', '--no-pager', '--since', new Date(since).toISOString(), '--grep', 'PM: suspend']);

    return run.code === 0 || run.code === 1
      ? { known: true, suspends: parseJournal(run.stdout) }
      : { known: false, reason: `journalctl exited ${run.code}` };
  }
  if (platform === 'darwin') {
    const run = io.exec(['pmset', '-g', 'log']);

    return run.code === 0
      ? { known: true, suspends: parsePmset(run.stdout).filter((suspend) => suspend.to >= since) }
      : { known: false, reason: `pmset exited ${run.code}` };
  }

  return { known: false, reason: `no suspend log read on ${platform}` };
}

/** Minutes of `suspends` that fall inside `[from, to]`. */
export function suspendedMinutes(suspends: readonly Suspend[], from: number, to: number): number {
  const ms = suspends.reduce((total, suspend) => total + Math.max(0, Math.min(to, suspend.to) - Math.max(from, suspend.from)), 0);

  return ms / MINUTE_MS;
}
