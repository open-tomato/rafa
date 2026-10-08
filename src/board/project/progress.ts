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
 *
 * ## Feeding a phase
 *
 * A module that runs a phase takes an optional {@link ProgressFeed} on its
 * options — the sink that hears each line, the clock and
 * `board.project.progressSeconds` — and opens the phase with
 * {@link openPhase}, which hands each line the reporter answers to the
 * sink. With no feed the phase is silent and nothing is read off a clock.
 * The feeders are the adds (`src/commands/init-board-project.ts`'s items
 * part and `./sync.ts`'s second pass), the facts reads (`./refresh.ts`)
 * and the field writes (`./writes.ts`).
 *
 * ## Rendering
 *
 * A command renders the lines through {@link commandProgressFeed}, the
 * feed `rafa init --board --project` (`src/commands/init.ts`) and
 * `rafa board sync` (`src/commands/board/sync.ts`) hand on: its sink,
 * {@link progressSink}, writes each line to the command's output as one
 * `info` line in text mode, with no `warn: ` prefix, and as one named
 * {@link PROGRESS_EVENT} event in json mode, whose summary is the line
 * and whose data is {@link ProgressLine.data}. The lines print as the
 * phases run, ahead of the command's own closing lines or its terminal
 * result. The clock and the event stamp are the command's seams, the
 * system's own when left out.
 */
import type { BoardProjectProgressSeconds } from '../../config-schema-board-project.js';
import type { OutputMode } from '../../config-sections.js';
import type { CliEventNamed, Output } from '../../ports/index.js';

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

/** What a phase's caller is fed by: where the lines go, the clock and the throttle. */
export interface ProgressFeed {
  /** Hears each line of every phase. */
  readonly sink: ProgressSink;
  /** The clock, in milliseconds. */
  readonly now: () => number;
  /** `board.project.progressSeconds`. */
  readonly progressSeconds: BoardProjectProgressSeconds;
}

/** One opened phase: each call hands the sink the line it answers, if any. */
export interface PhaseFeed {
  readonly advance: (done: number) => void;
  readonly wait: (waitMs: number) => void;
  readonly end: (result: PhaseEnd) => void;
}

/** The feed of a phase run with no {@link ProgressFeed}: every call does nothing. */
const SILENT_PHASE: PhaseFeed = Object.freeze({
  advance: () => undefined,
  wait: () => undefined,
  end: () => undefined,
});

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

/**
 * Opens `phase` over `total` items on `feed`, handing the sink its start
 * line at once; with no feed, a phase that hands nothing. See the module
 * note.
 */
export function openPhase(feed: ProgressFeed | undefined, phase: ProgressPhase, total: number): PhaseFeed {
  if (feed === undefined) return SILENT_PHASE;
  const reporter = phaseReporter({ phase, total, now: feed.now, progressSeconds: feed.progressSeconds });
  feed.sink(reporter.start());
  return {
    advance: (done) => {
      const line = reporter.advance(done);
      if (line !== undefined) feed.sink(line);
    },
    wait: (waitMs) => {
      feed.sink(reporter.wait(waitMs));
    },
    end: (result) => {
      feed.sink(reporter.end(result));
    },
  };
}

/**
 * Writes each line to `output`: one `info` line in text mode, one
 * {@link PROGRESS_EVENT} event stamped `stamp()` in json mode. See the
 * module note.
 */
export function progressSink(output: Output, mode: OutputMode, stamp: () => Date = () => new Date()): ProgressSink {
  return (line) => {
    if (mode === 'json') output.emit(progressEvent(line, stamp()));
    else output.info(line.text);
  };
}

/** The clocks a command's progress reads; the system's own when left out. */
export interface ProgressClocks {
  /** The clock the phases are timed by, in milliseconds. */
  readonly now?: () => number;
  /** The stamp of each json event. */
  readonly stamp?: () => Date;
}

/**
 * The feed a command hands its phases: the lines written to `output` in
 * `mode` by {@link progressSink}, timed by `clocks.now` and thinned by
 * `progressSeconds` (`board.project.progressSeconds`).
 */
export function commandProgressFeed(
  output: Output,
  mode: OutputMode,
  progressSeconds: BoardProjectProgressSeconds,
  clocks: ProgressClocks = {},
): ProgressFeed {
  return {
    sink: progressSink(output, mode, clocks.stamp),
    now: clocks.now ?? (() => Date.now()),
    progressSeconds,
  };
}
