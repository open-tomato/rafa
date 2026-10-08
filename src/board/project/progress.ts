/**
 * The progress of a long project phase
 * (`.rafa/specs/rafa-924-board-project-fixes.md`, "Progress for each long
 * phase"): {@link phaseReporter} answers the lines one phase prints and
 * the json `progress` event data of each, and prints nothing itself.
 *
 * ## The lines
 *
 * | Line | Text | When |
 * |---|---|---|
 * | start | `adding issues: 283` | once, before the first item |
 * | progress | `adding issues: 146/283, 6m 40s` | on an advance, once `board.project.progressSeconds` have passed since the last start or progress line |
 * | end | `adding issues: 283/283, 2 refused, 10m 13s` | once, after the last item |
 * | wait | `waiting 2 s for GitHub's write limit` | each time the caller reports a pause |
 *
 * The three phases are {@link PROGRESS_PHASES}: adding the issues,
 * reading their facts and writing their fields. A progress line comes
 * only from an advance: the reporter holds no timer, so while one item
 * takes longer than `progressSeconds` (a retry's wait, say) no line is
 * printed, and the next advance prints one. `progressSeconds: false`
 * drops the progress lines; the start, end and wait lines stay, the wait
 * line because it says why the run stands still. A wait line does not
 * move the throttle.
 *
 * No line is redrawn in place, so the lines read the same in a terminal
 * and in a loop's log. Each line's {@link ProgressLine.data} is the
 * `progress` event's data for json mode: the phase, the step, done,
 * total and elapsed milliseconds, plus the refused count on the end
 * line and the wait on the wait line.
 *
 * Time comes from the injected `now`, in milliseconds, and never from
 * `Date.now()` read here, so a test steps the clock and holds the
 * throttle.
 */
import type { BoardProjectProgressSeconds } from '../../config-schema-board-project.js';
import type { CliEventNamed } from '../../ports/index.js';

/** The name of the json event a progress line is emitted as. */
export const PROGRESS_EVENT = 'progress';

/** The three phases that print progress, each as its line spells it. */
export const PROGRESS_PHASES = Object.freeze({
  adds: 'adding issues',
  facts: 'reading facts',
  writes: 'writing fields',
} as const);

/** One phase that prints progress. */
export type ProgressPhase = keyof typeof PROGRESS_PHASES;

/** Which line of a phase a line is. */
export type ProgressStep = 'start' | 'progress' | 'end' | 'wait';

/** The json `progress` event's data for one line. */
export interface ProgressEventData {
  readonly phase: ProgressPhase;
  readonly step: ProgressStep;
  readonly done: number;
  readonly total: number;
  /** Milliseconds since the phase started. */
  readonly elapsedMs: number;
  /** The items refused; only on the end line. */
  readonly refused?: number;
  /** The pause about to be waited, in milliseconds; only on the wait line. */
  readonly waitMs?: number;
}

/** One line a phase prints: its text and its event's data. */
export interface ProgressLine {
  readonly text: string;
  readonly data: ProgressEventData;
}

/** Hears each line a phase prints. */
export type ProgressSink = (line: ProgressLine) => void;

/** What {@link phaseReporter} is opened with. */
export interface PhaseReporterOptions {
  readonly phase: ProgressPhase;
  /** The items the phase goes through. */
  readonly total: number;
  /** The clock, in milliseconds. */
  readonly now: () => number;
  /** `board.project.progressSeconds`: the most seconds between two progress lines, or `false` for none. */
  readonly progressSeconds: BoardProjectProgressSeconds;
}

/** What a phase reports at its end. */
export interface PhaseEnd {
  readonly done: number;
  readonly refused: number;
}

/** The lines of one phase; see the module note. */
export interface PhaseReporter {
  /** The start line; the phase's time counts from this call. */
  readonly start: () => ProgressLine;
  /** A progress line for `done` items when the throttle allows one, else undefined. */
  readonly advance: (done: number) => ProgressLine | undefined;
  /** The end line. */
  readonly end: (result: PhaseEnd) => ProgressLine;
  /** The line of a pause for GitHub's write limit of `waitMs`, at the last advance's count. */
  readonly wait: (waitMs: number) => ProgressLine;
}

const MS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_HOUR = 3600;

/** Elapsed milliseconds as the lines spell them: `40s`, `6m 40s`, `1h 2m 5s`. */
export function formatElapsed(elapsedMs: number): string {
  const seconds = Math.floor(Math.max(0, elapsedMs) / MS_PER_SECOND);
  const hours = Math.floor(seconds / SECONDS_PER_HOUR);
  const minutes = Math.floor((seconds % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE);
  const rest = seconds % SECONDS_PER_MINUTE;
  if (hours > 0) return `${String(hours)}h ${String(minutes)}m ${String(rest)}s`;
  if (minutes > 0) return `${String(minutes)}m ${String(rest)}s`;
  return `${String(rest)}s`;
}

/** The text of a wait line: `waiting 2 s for GitHub's write limit`, the seconds rounded up. */
export function waitLine(waitMs: number): string {
  return `waiting ${String(Math.ceil(Math.max(0, waitMs) / MS_PER_SECOND))} s for GitHub's write limit`;
}

/** The json event of one line, stamped `now`. */
export function progressEvent(line: ProgressLine, now: Date): CliEventNamed {
  return {
    type: 'event',
    name: PROGRESS_EVENT,
    summary: line.text,
    data: { ...line.data },
    ts: now.toISOString(),
  };
}

/**
 * Opens the reporter of one phase over `options.total` items. The
 * phase's time counts from {@link PhaseReporter.start}; a line asked for
 * before it counts from the opening.
 */
export function phaseReporter(options: PhaseReporterOptions): PhaseReporter {
  const label = PROGRESS_PHASES[options.phase];
  const total = String(options.total);
  const gapMs = options.progressSeconds === false
    ? null
    : options.progressSeconds * MS_PER_SECOND;
  let startedAt = options.now();
  let lastLineAt = startedAt;
  let doneSoFar = 0;

  const base = (step: ProgressStep, done: number, at: number): ProgressEventData => ({
    phase: options.phase,
    step,
    done,
    total: options.total,
    elapsedMs: at - startedAt,
  });

  return {
    start: () => {
      startedAt = options.now();
      lastLineAt = startedAt;
      return { text: `${label}: ${total}`, data: base('start', 0, startedAt) };
    },
    advance: (done) => {
      doneSoFar = done;
      if (gapMs === null) return undefined;
      const at = options.now();
      if (at - lastLineAt < gapMs) return undefined;
      lastLineAt = at;
      const data = base('progress', done, at);
      return { text: `${label}: ${String(done)}/${total}, ${formatElapsed(data.elapsedMs)}`, data };
    },
    end: ({ done, refused }) => {
      const data = { ...base('end', done, options.now()), refused };
      return {
        text: `${label}: ${String(done)}/${total}, ${String(refused)} refused, ${formatElapsed(data.elapsedMs)}`,
        data,
      };
    },
    wait: (waitMs) => {
      const data = { ...base('wait', doneSoFar, options.now()), waitMs };
      return { text: waitLine(waitMs), data };
    },
  };
}
