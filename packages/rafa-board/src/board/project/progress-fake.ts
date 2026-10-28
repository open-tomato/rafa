/**
 * A test helper for the progress feed (`./progress.ts`): a
 * {@link ProgressFeed} whose sink records each line and whose clock moves
 * {@link TICK_MS} forward on every read, so with `progressSeconds: 1`
 * every advance answers a progress line and a case reads each count a
 * phase reported. It prints nothing and reads no real clock.
 */
import type { ProgressEventData, ProgressFeed, ProgressLine } from './progress.js';

/** How far the clock moves on each read, in milliseconds: one throttle gap at `progressSeconds: 1`. */
export const TICK_MS = 1000;

/** A feed recording every line; see the module note. */
export interface RecordingFeed {
  readonly feed: ProgressFeed;
  /** Every line heard, in order. */
  readonly lines: () => readonly ProgressLine[];
  /** Each line's step, phase and counts, in order: `adds start 0/3`, `writes end 3/3 0 refused`, `writes wait 0/7 1000 ms`. */
  readonly steps: () => readonly string[];
}

/** One line's step, phase and counts, as {@link RecordingFeed.steps} spells it. */
function stepOf(data: ProgressEventData): string {
  const counts = `${data.phase} ${data.step} ${String(data.done)}/${String(data.total)}`;
  if (data.step === 'end') return `${counts} ${String(data.refused ?? 0)} refused`;
  if (data.step === 'wait') return `${counts} ${String(data.waitMs ?? 0)} ms`;
  return counts;
}

/** A feed recording every line, a progress line on every advance unless `progressSeconds` says otherwise. */
export function recordingFeed(progressSeconds: ProgressFeed['progressSeconds'] = 1): RecordingFeed {
  const heard: ProgressLine[] = [];
  let at = 0;
  return {
    feed: {
      sink: (line) => {
        heard.push(line);
      },
      now: () => {
        at += TICK_MS;
        return at;
      },
      progressSeconds,
    },
    lines: () => [...heard],
    steps: () => heard.map(({ data }) => stepOf(data)),
  };
}
