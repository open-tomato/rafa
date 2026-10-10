/**
 * Tests for the active logger: the default, setting one and putting the
 * previous back, and a `logger.kind` other than console resolved once
 * through the resolver, or warned about once and replaced by console.
 */
import type { Logger } from '../../ports/index.js';

import { afterEach, describe, expect, it } from 'bun:test';

import { consoleHarness, keptOutput } from '../../tests/logger-harness.js';
import { setActiveOutput } from '../output/active.js';

import { activeLogger, restoreActiveLogger, setActiveLogger } from './active.js';
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
