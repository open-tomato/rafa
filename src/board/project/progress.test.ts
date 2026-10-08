import type { PhaseReporterOptions } from './progress.js';

import { describe, expect, test } from 'bun:test';

import { recordingFeed } from './progress-fake.js';
import { formatElapsed, openPhase, phaseReporter, progressEvent, waitLine } from './progress.js';

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

    test('keeps the start, end and wait lines', () => {
      const clock = steppedClock();
      const reporter = adds(clock, 283, false);
      expect(reporter.start().text).toBe('adding issues: 283');
      clock.step(5_000);
      expect(reporter.wait(2_000).text).toBe('waiting 2 s for GitHub\'s write limit');
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
      const line = writes.wait(1_500);
      expect(line.text).toBe('waiting 2 s for GitHub\'s write limit');
      expect(line.data).toEqual({ phase: 'writes', step: 'wait', done: 20, total: 40, elapsedMs: 3_000, waitMs: 1_500 });
    });

    test('does not move the throttle', () => {
      const clock = steppedClock();
      const reporter = adds(clock);
      reporter.start();
      clock.step(9_000);
      reporter.wait(1_000);
      clock.step(1_000);
      expect(reporter.advance(5)?.text).toBe('adding issues: 5/283, 10s');
    });

    test.each([
      [0, 'waiting 0 s for GitHub\'s write limit'],
      [1_000, 'waiting 1 s for GitHub\'s write limit'],
      [1_001, 'waiting 2 s for GitHub\'s write limit'],
      [60_000, 'waiting 60 s for GitHub\'s write limit'],
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
      'waiting 1 s for GitHub\'s write limit',
      'writing fields: 3/3, 0 refused, 3s',
    ]);
  });

  test('hands no progress line the throttle holds back, and the start, wait and end lines still', () => {
    const recording = recordingFeed(false);
    const phase = openPhase(recording.feed, 'adds', 2);
    phase.advance(1);
    phase.wait(500);
    phase.advance(2);
    phase.end({ done: 2, refused: 0 });
    expect(recording.steps()).toEqual(['adds start 0/2', 'adds wait 1/2 500 ms', 'adds end 2/2 0 refused']);
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
