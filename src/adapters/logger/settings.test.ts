/**
 * Tests for the logger settings: the default, setting and putting it
 * back, and `levelEnabled` over the ordered levels, a module's own
 * level, the verbosity and the `api` type, which only its own switch or
 * verbosity 3 turns on.
 */
import type { LoggerSettings } from './settings.js';
import type { LogLevel } from '../../ports/index.js';

import { afterEach, describe, expect, it } from 'bun:test';

import {
  activeLoggerSettings,
  DEFAULT_LOGGER_SETTINGS,
  levelEnabled,
  LOG_LEVELS,
  setActiveLoggerSettings,
} from './settings.js';

/** The default settings with `changes` over them. */
function settingsWith(changes: Partial<LoggerSettings>): LoggerSettings {
  return { ...DEFAULT_LOGGER_SETTINGS, ...changes };
}

afterEach(() => {
  setActiveLoggerSettings(null);
});

describe('the logger settings', () => {
  it('default to console at warn, the default theme, no module level, and callSite and api off', () => {
    expect(activeLoggerSettings()).toEqual({
      kind: 'console',
      level: 'warn',
      theme: 'default',
      modules: new Map(),
      callSite: false,
      api: false,
    });
  });

  it('are what was set, frozen, until null puts the default back', () => {
    setActiveLoggerSettings(settingsWith({ level: 'error' }));

    expect(activeLoggerSettings().level).toBe('error');
    expect(Object.isFrozen(activeLoggerSettings())).toBe(true);

    setActiveLoggerSettings(null);

    expect(activeLoggerSettings()).toBe(DEFAULT_LOGGER_SETTINGS);
  });

  it('order the levels quietest first, with api outside the order', () => {
    expect(LOG_LEVELS).toEqual(['error', 'warn', 'debug']);
  });
});

describe('levelEnabled', () => {
  const BOARD_DEBUG = settingsWith({ modules: new Map<string, LogLevel>([['board', 'debug']]) });
  const rows: readonly (readonly [LogLevel, string | undefined, LoggerSettings, number, boolean])[] = [
    ['warn', undefined, DEFAULT_LOGGER_SETTINGS, 0, true],
    ['debug', undefined, DEFAULT_LOGGER_SETTINGS, 0, false],
    ['debug', undefined, DEFAULT_LOGGER_SETTINGS, 2, true],
    ['warn', undefined, settingsWith({ level: 'error' }), 0, false],
    ['error', undefined, settingsWith({ level: 'error' }), 0, true],
    ['debug', 'board', BOARD_DEBUG, 0, true],
    ['debug', 'plan', BOARD_DEBUG, 0, false],
    ['warn', 'board', settingsWith({ level: 'debug', modules: new Map<string, LogLevel>([['board', 'error']]) }), 0, false],
    ['api', undefined, DEFAULT_LOGGER_SETTINGS, 0, false],
    ['api', undefined, settingsWith({ level: 'debug' }), 2, false],
    ['api', undefined, DEFAULT_LOGGER_SETTINGS, 3, true],
    ['api', undefined, settingsWith({ level: 'error', api: true }), 0, true],
  ];

  it.each(rows)('reads %s from module %s as on or off', (level, module, settings, verbosity, on) => {
    expect(levelEnabled(level, module, settings, verbosity)).toBe(on);
  });
});
