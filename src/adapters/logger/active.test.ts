/**
 * Tests for the active logger: the default, setting one and putting the
 * previous back, a `logger.kind` other than console resolved once
 * through the resolver, or warned about once and replaced by console,
 * and the async scope `runWithActiveLogger` holds a logger in.
 *
 * The scope cases order their overlaps with gates they open themselves,
 * never with a timer, as `src/cli/dispatch-scope.test.ts` does.
 */
import type { Logger } from '../../ports/index.js';

import { afterEach, describe, expect, it } from 'bun:test';

import { setActiveOutput } from '../../core/output/index.js';
import { consoleHarness, keptOutput } from '../../tests/logger-harness.js';

import { activeLogger, restoreActiveLogger, runWithActiveLogger, setActiveLogger } from './active.js';
import { DEFAULT_LOGGER_SETTINGS, setActiveLoggerSettings } from './settings.js';

afterEach(() => {
  setActiveLogger(null);
  setActiveLoggerSettings(null);
  setActiveOutput(null);
});

/** A logger that only counts as itself. */
function namedLogger(): Logger {
  const logger: Logger = { log: () => {}, child: () => logger, enabled: () => true };
  return logger;
}

/** A promise and the function that settles it, so a case orders its own overlaps. */
function gate(): { readonly opened: Promise<void>; readonly open: () => void } {
  let open: () => void = () => {};
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { opened, open };
}

describe('the active logger', () => {
  it('is a console logger while nothing is set, writing through the active output', () => {
    const kept = keptOutput();
    setActiveOutput(kept.output);

    activeLogger().log({ level: 'warn', message: 'careful' });

    expect(kept.lines()).toEqual(['warn: careful']);
  });

  it('is the one set, and the previous one again once its state is restored', () => {
    const first = consoleHarness(() => DEFAULT_LOGGER_SETTINGS, 0).logger;
    const second = namedLogger();
    setActiveLogger(first);

    const previous = setActiveLogger(second);

    expect(activeLogger()).toBe(second);

    restoreActiveLogger(previous);

    expect(activeLogger()).toBe(first);
  });

  it('resolves another kind once through the resolver', () => {
    const other = namedLogger();
    const asked: string[] = [];
    setActiveLogger(namedLogger(), (kind) => {
      asked.push(kind);
      return other;
    });
    setActiveLoggerSettings({ ...DEFAULT_LOGGER_SETTINGS, kind: 'winston' });

    expect(activeLogger()).toBe(other);
    expect(activeLogger()).toBe(other);
    expect(asked).toEqual(['winston']);
  });

  it('warns once and keeps the console logger for a kind the resolver refuses', () => {
    const kept = keptOutput();
    setActiveOutput(kept.output);
    const console = namedLogger();
    setActiveLogger(console, () => {
      throw new Error('no adapter of type "logger" and kind "nope"');
    });
    setActiveLoggerSettings({ ...DEFAULT_LOGGER_SETTINGS, kind: 'nope' });

    expect(activeLogger()).toBe(console);
    expect(activeLogger()).toBe(console);
    expect(kept.warnings()).toEqual([
      'logger: no adapter of kind "nope": no adapter of type "logger" and kind "nope"; using console',
    ]);
  });

  it('keeps the set logger when another kind is named and no resolver was given', () => {
    const only = namedLogger();
    setActiveLogger(only);
    setActiveLoggerSettings({ ...DEFAULT_LOGGER_SETTINGS, kind: 'winston' });

    expect(activeLogger()).toBe(only);
  });
});

describe('a logger scope', () => {
  it('answers its logger inside, after an await too, and the module-level one outside it and after it', async () => {
    const outer = namedLogger();
    const scoped = namedLogger();
    const running = gate();
    const mayRead = gate();
    setActiveLogger(outer);

    const inside = runWithActiveLogger(scoped, null, async () => {
      const atStart = activeLogger();
      running.open();
      await mayRead.opened;
      return [atStart, activeLogger()];
    });
    await running.opened;
    const outside = activeLogger();
    mayRead.open();

    expect(await inside).toEqual([scoped, scoped]);
    expect(outside).toBe(outer);
    expect(activeLogger()).toBe(outer);
  });

  it('answers what the function answers, and the default logger for null', () => {
    const fallback = activeLogger();
    setActiveLogger(namedLogger());

    expect(runWithActiveLogger(namedLogger(), null, () => 'answer')).toBe('answer');
    expect(runWithActiveLogger(null, null, () => activeLogger())).toBe(fallback);
  });

  it.each([['first'], ['last']] as const)('keeps two scopes that overlap apart when the first started ends %s', async (ends) => {
    const loggers = { one: namedLogger(), two: namedLogger() };
    const bothRunning = gate();
    const otherEnded = gate();
    const read: Record<string, Logger> = {};
    const fallback = activeLogger();
    const scoped = async (name: 'one' | 'two', waitsFor: Promise<void>): Promise<void> => runWithActiveLogger(
      loggers[name],
      null,
      async () => {
        await waitsFor;
        read[name] = activeLogger();
      },
    );
    const [firstWaits, secondWaits] = ends === 'first'
      ? [bothRunning.opened, otherEnded.opened]
      : [otherEnded.opened, bothRunning.opened];

    const first = scoped('one', firstWaits);
    const second = scoped('two', secondWaits);
    bothRunning.open();
    await (ends === 'first'
      ? first
      : second);
    const between = activeLogger();
    otherEnded.open();
    await Promise.all([first, second]);

    expect(read['one']).toBe(loggers.one);
    expect(read['two']).toBe(loggers.two);
    expect(between).toBe(fallback);
    expect(activeLogger()).toBe(fallback);
  });

  it('gives a scope inside another its own logger, and the outer one its own again after it', async () => {
    const outer = namedLogger();
    const inner = namedLogger();
    const read: Logger[] = [];

    await runWithActiveLogger(outer, null, async () => {
      read.push(activeLogger());
      await runWithActiveLogger(inner, null, async () => {
        await Promise.resolve();
        read.push(activeLogger());
      });
      read.push(activeLogger());
    });

    expect(read.map((logger) => [outer, inner].indexOf(logger))).toEqual([0, 1, 0]);
  });

  it('holds a set made inside it, answers that scope\'s previous state for a restore, and leaves the module-level logger as it was', async () => {
    const outer = namedLogger();
    const scoped = namedLogger();
    const replacement = namedLogger();
    const read: Logger[] = [];
    setActiveLogger(outer);

    await runWithActiveLogger(scoped, null, async () => {
      const previous = setActiveLogger(replacement);
      await Promise.resolve();
      read.push(activeLogger());
      restoreActiveLogger(previous);
      read.push(activeLogger());
      setActiveLogger(replacement);
    });

    expect(read.map((logger) => [scoped, replacement].indexOf(logger))).toEqual([1, 0]);
    expect(activeLogger()).toBe(outer);
  });

  it('asks each scope\'s resolver once for another kind, and never the module-level one', async () => {
    const made = { outside: namedLogger(), one: namedLogger(), two: namedLogger() };
    const asked: string[] = [];
    const resolverOf = (name: keyof typeof made) => (kind: string): Logger => {
      asked.push(`${name}:${kind}`);
      return made[name];
    };
    const bothRunning = gate();
    const read: Record<string, Logger[]> = {};
    setActiveLogger(namedLogger(), resolverOf('outside'));
    setActiveLoggerSettings({ ...DEFAULT_LOGGER_SETTINGS, kind: 'winston' });
    const scoped = async (name: 'one' | 'two'): Promise<void> => runWithActiveLogger(namedLogger(), resolverOf(name), async () => {
      const atStart = activeLogger();
      await bothRunning.opened;
      read[name] = [atStart, activeLogger()];
    });

    const runs = [scoped('one'), scoped('two')];
    bothRunning.open();
    await Promise.all(runs);

    const order = [made.outside, made.one, made.two];
    expect(read['one']?.map((logger) => order.indexOf(logger))).toEqual([1, 1]);
    expect(read['two']?.map((logger) => order.indexOf(logger))).toEqual([2, 2]);
    expect(asked).toEqual(['one:winston', 'two:winston']);
  });

  it('warns once in each scope for a kind its resolver refuses, and keeps that scope\'s logger', async () => {
    const kept = keptOutput();
    setActiveOutput(kept.output);
    setActiveLoggerSettings({ ...DEFAULT_LOGGER_SETTINGS, kind: 'nope' });
    const refuse = (): Logger => {
      throw new Error('none');
    };
    const loggers = [namedLogger(), namedLogger()];
    const read: Logger[] = [];

    for (const logger of loggers) {
      await runWithActiveLogger(logger, refuse, async () => {
        activeLogger();
        await Promise.resolve();
        read.push(activeLogger());
      });
    }

    expect(read.map((logger) => loggers.indexOf(logger))).toEqual([0, 1]);
    expect(kept.warnings()).toEqual([
      'logger: no adapter of kind "nope": none; using console',
      'logger: no adapter of kind "nope": none; using console',
    ]);
  });

  it('leaves nothing of a scope whose function throws', async () => {
    const fallback = activeLogger();
    const thrown = runWithActiveLogger(namedLogger(), null, async () => {
      setActiveLogger(namedLogger());
      await Promise.resolve();
      throw new Error('boom');
    });

    await expect(thrown).rejects.toThrow('boom');
    expect(activeLogger()).toBe(fallback);
  });
});
