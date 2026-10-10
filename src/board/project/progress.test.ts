import type { PhaseReporterOptions } from './progress.js';
import type { CliEvent } from '../../ports/index.js';

import { describe, expect, test } from 'bun:test';

import { sinkOutput } from '../../tests/output-sinks.js';

import { recordingFeed } from './progress-fake.js';
import {
  commandProgressFeed,
  formatElapsed,
  openPhase,
  phaseReporter,
  progressEvent,
  progressSink,
  waitLine,
} from './progress.js';

/** A clock the test steps by hand, in milliseconds. */
function steppedClock(startMs = 1_000_000): { readonly now: () => number; readonly step: (ms: number) => void } {
  let at = startMs;
  return {
    now: () => at,
    step: (ms) => {
      at += ms;
    },
  };
}

/** A reporter over `total` adds on `clock`, a line at most every 10 s unless `progressSeconds` says otherwise. */
function adds(
  clock: { readonly now: () => number },
  total = 283,
  progressSeconds: PhaseReporterOptions['progressSeconds'] = 10,
): ReturnType<typeof phaseReporter> {
  return phaseReporter({ phase: 'adds', total, now: clock.now, progressSeconds });
}

describe('formatElapsed', () => {
  test.each([
    [0, '0s'],
    [999, '0s'],
    [40_000, '40s'],
    [60_000, '1m 0s'],
    [400_000, '6m 40s'],
    [613_000, '10m 13s'],
    [3_725_000, '1h 2m 5s'],
    [-5, '0s'],
  ])('spells %p ms as %p', (ms, words) => {
    expect(formatElapsed(ms)).toBe(words);
  });
});

describe('phaseReporter', () => {
  test('the start line names the phase and its total, at zero elapsed', () => {
    const clock = steppedClock();
    const line = adds(clock).start();
    expect(line.text).toBe('adding issues: 283');
    expect(line.data).toEqual({ phase: 'adds', step: 'start', done: 0, total: 283, elapsedMs: 0 });
  });

  test('each phase spells its own label', () => {
    const clock = steppedClock();
    const facts = phaseReporter({ phase: 'facts', total: 5, now: clock.now, progressSeconds: 10 });
    const writes = phaseReporter({ phase: 'writes', total: 7, now: clock.now, progressSeconds: 10 });
    expect(facts.start().text).toBe('reading facts: 5');
    expect(writes.start().text).toBe('writing fields: 7');
  });

  test('an advance before progressSeconds passed answers no line, and one at the gap answers the count and time', () => {
    const clock = steppedClock();
    const reporter = adds(clock);
    reporter.start();
    clock.step(9_999);
    expect(reporter.advance(3)).toBeUndefined();
    clock.step(1);
    const line = reporter.advance(4);
    expect(line?.text).toBe('adding issues: 4/283, 10s');
    expect(line?.data).toEqual({ phase: 'adds', step: 'progress', done: 4, total: 283, elapsedMs: 10_000 });
  });

  test('the throttle counts from the last progress line, not from the start', () => {
    const clock = steppedClock();
    const reporter = adds(clock);
    reporter.start();
    clock.step(12_000);
    expect(reporter.advance(10)).toBeDefined();
    clock.step(9_000);
    expect(reporter.advance(11)).toBeUndefined();
    clock.step(1_000);
    expect(reporter.advance(12)?.text).toBe('adding issues: 12/283, 22s');
  });

  test('the spec\'s middle line reads 146/283 at 6m 40s', () => {
    const clock = steppedClock();
    const reporter = adds(clock);
    reporter.start();
    clock.step(400_000);
    expect(reporter.advance(146)?.text).toBe('adding issues: 146/283, 6m 40s');
  });

  test('the end line holds the count, the refused count and the time, whatever the throttle', () => {
    const clock = steppedClock();
    const reporter = adds(clock);
    reporter.start();
    clock.step(1);
    expect(reporter.advance(1)).toBeUndefined();
    clock.step(612_999);
    const line = reporter.end({ done: 281, refused: 2 });
    expect(line.text).toBe('adding issues: 281/283, 2 refused, 10m 13s');
    expect(line.data).toEqual({ phase: 'adds', step: 'end', done: 281, total: 283, elapsedMs: 613_000, refused: 2 });
  });

  test('elapsed time counts from start, not from opening', () => {
    const clock = steppedClock();
    const reporter = adds(clock);
    clock.step(50_000);
    reporter.start();
    clock.step(10_000);
    expect(reporter.advance(1)?.data.elapsedMs).toBe(10_000);
  });

  test('progressSeconds 1 answers a line once a second has passed', () => {
    const clock = steppedClock();
    const reporter = adds(clock, 3, 1);
    reporter.start();
    clock.step(999);
    expect(reporter.advance(1)).toBeUndefined();
    clock.step(1);
    expect(reporter.advance(2)?.text).toBe('adding issues: 2/3, 1s');
  });

  describe('progressSeconds: false', () => {
    test('drops every progress line, however long the phase runs', () => {
      const clock = steppedClock();
      const reporter = adds(clock, 283, false);
      reporter.start();
      const lines = Array.from({ length: 283 }, (_, index) => {
        clock.step(60_000);
        return reporter.advance(index + 1);
      });
      expect(lines.filter((line) => line !== undefined)).toEqual([]);
    });

    test('keeps the start and end lines, and answers no wait line however long the pause', () => {
      const clock = steppedClock();
      const reporter = adds(clock, 283, false);
      expect(reporter.start().text).toBe('adding issues: 283');
      clock.step(5_000);
      expect([2_000, 60_000, 300_000].map((ms) => reporter.wait(ms))).toEqual([undefined, undefined, undefined]);
      clock.step(5_000);
      expect(reporter.end({ done: 283, refused: 0 }).text).toBe('adding issues: 283/283, 0 refused, 10s');
    });

    test('control: the same steps with progressSeconds 10 answer a line on every advance', () => {
      const clock = steppedClock();
      const reporter = adds(clock, 3, 10);
      reporter.start();
      const lines = [1, 2, 3].map((done) => {
        clock.step(60_000);
        return reporter.advance(done);
      });
      expect(lines.map((line) => line?.text)).toEqual([
        'adding issues: 1/3, 1m 0s',
        'adding issues: 2/3, 2m 0s',
        'adding issues: 3/3, 3m 0s',
      ]);
    });
  });

  describe('the wait line', () => {
    test('names the wait in whole seconds, rounded up, at the last advance\'s count', () => {
      const clock = steppedClock();
      const writes = phaseReporter({ phase: 'writes', total: 40, now: clock.now, progressSeconds: 10 });
      writes.start();
      clock.step(3_000);
      writes.advance(20);
      const line = writes.wait(14_500);
      expect(line?.text).toBe('pausing 15 s between writes (board.project.writePauseMs)');
      expect(line?.data).toEqual({ phase: 'writes', step: 'wait', done: 20, total: 40, elapsedMs: 3_000, waitMs: 14_500 });
    });

    test('answers no line for the default 1 s pause under the default 10 s, nor for any pause short of progressSeconds', () => {
      const reporter = adds(steppedClock());
      reporter.start();
      expect([0, 1_000, 9_999].map((ms) => reporter.wait(ms))).toEqual([undefined, undefined, undefined]);
    });

    test('answers a line for a pause equal to progressSeconds, and for a longer one', () => {
      const reporter = adds(steppedClock());
      reporter.start();
      expect([10_000, 10_001].map((ms) => reporter.wait(ms)?.text)).toEqual([
        'pausing 10 s between writes (board.project.writePauseMs)',
        'pausing 11 s between writes (board.project.writePauseMs)',
      ]);
    });

    test('measures the pause against the progressSeconds it is opened with: 1 s prints at 1, not at 2', () => {
      const pauseOf = (progressSeconds: number): string | undefined => adds(steppedClock(), 283, progressSeconds).wait(1_000)?.text;
      expect([pauseOf(1), pauseOf(2)]).toEqual(['pausing 1 s between writes (board.project.writePauseMs)', undefined]);
    });

    test('does not move the throttle', () => {
      const clock = steppedClock();
      const reporter = adds(clock);
      reporter.start();
      clock.step(9_000);
      expect(reporter.wait(10_000)?.data.step).toBe('wait');
      clock.step(1_000);
      expect(reporter.advance(5)?.text).toBe('adding issues: 5/283, 10s');
    });

    test.each([
      [0, 'pausing 0 s between writes (board.project.writePauseMs)'],
      [1_000, 'pausing 1 s between writes (board.project.writePauseMs)'],
      [1_001, 'pausing 2 s between writes (board.project.writePauseMs)'],
      [60_000, 'pausing 60 s between writes (board.project.writePauseMs)'],
    ])('waitLine spells %p ms as %p', (ms, words) => {
      expect(waitLine(ms)).toBe(words);
    });
  });
});

describe('progressEvent', () => {
  test('is a named progress event carrying the line as its summary and its data, stamped now', () => {
    const clock = steppedClock();
    const reporter = adds(clock);
    reporter.start();
    clock.step(400_000);
    const line = reporter.advance(146);
    if (line === undefined) throw new Error('expected a progress line');
    const stamp = new Date('2026-10-08T12:00:00.000Z');
    expect(progressEvent(line, stamp)).toEqual({
      type: 'event',
      name: 'progress',
      summary: 'adding issues: 146/283, 6m 40s',
      data: { phase: 'adds', step: 'progress', done: 146, total: 283, elapsedMs: 400_000 },
      ts: '2026-10-08T12:00:00.000Z',
    });
  });
});

describe('openPhase', () => {
  test('hands the sink the start line at once, then each line the reporter answers', () => {
    const recording = recordingFeed();
    const phase = openPhase(recording.feed, 'writes', 3);
    expect(recording.steps()).toEqual(['writes start 0/3']);
    phase.advance(2);
    phase.wait(1000);
    phase.end({ done: 3, refused: 0 });
    expect(recording.steps()).toEqual(['writes start 0/3', 'writes progress 2/3', 'writes wait 2/3 1000 ms', 'writes end 3/3 0 refused']);
    expect(recording.lines().map(({ text }) => text)).toEqual([
      'writing fields: 3',
      'writing fields: 2/3, 1s',
      'pausing 1 s between writes (board.project.writePauseMs)',
      'writing fields: 3/3, 0 refused, 3s',
    ]);
  });

  test('hands no wait line for a pause short of progressSeconds; the same pause one step longer is the control', () => {
    const stepsOf = (waitMs: number): readonly string[] => {
      const recording = recordingFeed(2);
      const phase = openPhase(recording.feed, 'writes', 3);
      phase.wait(waitMs);
      phase.end({ done: 3, refused: 0 });
      return recording.steps();
    };
    expect(stepsOf(1_999)).toEqual(['writes start 0/3', 'writes end 3/3 0 refused']);
    expect(stepsOf(2_000)).toEqual(['writes start 0/3', 'writes wait 0/3 2000 ms', 'writes end 3/3 0 refused']);
  });

  test('with progressSeconds false, hands no progress line and no wait line, and the start and end lines still', () => {
    const recording = recordingFeed(false);
    const phase = openPhase(recording.feed, 'adds', 2);
    phase.advance(1);
    phase.wait(300_000);
    phase.advance(2);
    phase.end({ done: 2, refused: 0 });
    expect(recording.steps()).toEqual(['adds start 0/2', 'adds end 2/2 0 refused']);
  });

  test('with no feed, every call does nothing and none throws', () => {
    const phase = openPhase(undefined, 'facts', 4);
    expect(() => {
      phase.advance(1);
      phase.wait(10);
      phase.end({ done: 4, refused: 0 });
    }).not.toThrow();
  });
});

/** Lines and events written to an output, by kind. */
interface Captured {
  readonly info: string[];
  readonly warn: string[];
  readonly events: CliEvent[];
}

/** An output capturing what a progress sink writes. */
function capture(): { readonly captured: Captured; readonly output: ReturnType<typeof sinkOutput> } {
  const captured: Captured = { info: [], warn: [], events: [] };
  const output = sinkOutput({
    info: (line) => captured.info.push(line),
    warn: (line) => captured.warn.push(line),
    event: (event) => captured.events.push(event),
  });
  return { captured, output };
}

/** The stamp every event of the rendering cases carries. */
const STAMP = new Date('2026-10-08T12:00:00.000Z');

/** The end line of 283 adds, two refused, after 10m 13s. */
const END_LINE = {
  text: 'adding issues: 283/283, 2 refused, 10m 13s',
  data: { phase: 'adds', step: 'end', done: 283, total: 283, elapsedMs: 613_000, refused: 2 },
} as const;

describe('progressSink', () => {
  test('writes one info line in text mode, with no warn prefix and no event', () => {
    const { captured, output } = capture();

    progressSink(output, 'text', () => STAMP)(END_LINE);

    expect(captured).toEqual({ info: ['adding issues: 283/283, 2 refused, 10m 13s'], warn: [], events: [] });
  });

  test('writes one progress event in json mode, and no line; the same line in text mode is the control', () => {
    const { captured, output } = capture();

    progressSink(output, 'json', () => STAMP)(END_LINE);

    expect(captured.info).toEqual([]);
    expect(captured.warn).toEqual([]);
    expect(captured.events).toEqual([progressEvent(END_LINE, STAMP)]);
    expect(captured.events[0]).toMatchObject({ type: 'event', name: 'progress', summary: END_LINE.text, ts: STAMP.toISOString() });
  });
});

describe('commandProgressFeed', () => {
  test('renders a phase through the output, timed by the clock it is handed and thinned by progressSeconds', () => {
    const { captured, output } = capture();
    const clock = steppedClock(0);
    const feed = commandProgressFeed(output, 'text', 10, { now: clock.now, stamp: () => STAMP });

    const phase = openPhase(feed, 'facts', 283);
    clock.step(5_000);
    phase.advance(10);
    clock.step(5_000);
    phase.advance(20);
    clock.step(30_000);
    phase.end({ done: 282, refused: 1 });

    expect(feed.progressSeconds).toBe(10);
    expect(captured.info).toEqual(['reading facts: 283', 'reading facts: 20/283, 10s', 'reading facts: 282/283, 1 refused, 40s']);
  });

  test('passes progressSeconds false on, so only the start and end lines are written', () => {
    const { captured, output } = capture();
    const clock = steppedClock(0);
    const feed = commandProgressFeed(output, 'json', false, { now: clock.now, stamp: () => STAMP });

    const phase = openPhase(feed, 'writes', 40);
    clock.step(60_000);
    phase.advance(20);
    phase.end({ done: 40, refused: 0 });

    expect(captured.info).toEqual([]);
    expect(captured.events.map((event) => (event as { summary?: string }).summary)).toEqual([
      'writing fields: 40',
      'writing fields: 40/40, 0 refused, 1m 0s',
    ]);
  });

  test('writes a pause equal to progressSeconds as one line in text mode and one wait event in json mode', () => {
    const text = capture();
    const json = capture();
    const clock = steppedClock(0);
    const clocks = { now: clock.now, stamp: () => STAMP };

    openPhase(commandProgressFeed(text.output, 'text', 10, clocks), 'writes', 40).wait(10_000);
    openPhase(commandProgressFeed(json.output, 'json', 10, clocks), 'writes', 40).wait(10_000);

    expect(text.captured.info).toEqual(['writing fields: 40', 'pausing 10 s between writes (board.project.writePauseMs)']);
    expect(json.captured.info).toEqual([]);
    expect(json.captured.events[1]).toEqual({
      type: 'event',
      name: 'progress',
      summary: 'pausing 10 s between writes (board.project.writePauseMs)',
      data: { phase: 'writes', step: 'wait', done: 0, total: 40, elapsedMs: 0, waitMs: 10_000 },
      ts: STAMP.toISOString(),
    });
    expect(json.captured.events).toHaveLength(2);
  });

  test('times the phases by the system clock when handed none', () => {
    const { captured, output } = capture();
    const before = Date.now();

    const at = commandProgressFeed(output, 'text', 10).now();

    expect(at).toBeGreaterThanOrEqual(before);
    expect(at).toBeLessThanOrEqual(Date.now());
    expect(captured.info).toEqual([]);
  });
});
