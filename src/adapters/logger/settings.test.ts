/**
 * Tests for the logger settings: the default, setting and putting it
 * back, the async scope `runWithLoggerSettings` holds settings in, and
 * `levelEnabled` over the ordered levels, a module's own level, the
 * verbosity and the `api` type, which only its own switch or verbosity 3
 * turns on.
 *
 * The scope cases order their overlaps with gates they open themselves,
 * never with a timer, as `src/cli/dispatch-scope.test.ts` does.
 */
import type { LoggerSettings } from './settings.js';
import type { LogLevel } from '@open-tomato/rafa/ports';

import { afterEach, describe, expect, it } from 'bun:test';

import {
  activeLoggerSettings,
  DEFAULT_LOGGER_SETTINGS,
  levelEnabled,
  LOG_LEVELS,
  runWithLoggerSettings,
  setActiveLoggerSettings,
} from './settings.js';

/** The default settings with `changes` over them. */
function settingsWith(changes: Partial<LoggerSettings>): LoggerSettings {
  return { ...DEFAULT_LOGGER_SETTINGS, ...changes };
}

/** A promise and the function that settles it, so a case orders its own overlaps. */
function gate(): { readonly opened: Promise<void>; readonly open: () => void } {
  let open: () => void = () => {};
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { opened, open };
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

describe('a settings scope', () => {
  it('starts from the settings it is given, frozen, and from the defaults for null, whatever is set at module level', () => {
    setActiveLoggerSettings(settingsWith({ level: 'error' }));

    const given = runWithLoggerSettings(settingsWith({ level: 'debug' }), () => activeLoggerSettings());
    const fresh = runWithLoggerSettings(null, () => activeLoggerSettings());

    expect(given.level).toBe('debug');
    expect(Object.isFrozen(given)).toBe(true);
    expect(fresh).toBe(DEFAULT_LOGGER_SETTINGS);
    expect(activeLoggerSettings().level).toBe('error');
  });

  it('answers what the function answers', async () => {
    expect(runWithLoggerSettings(null, () => 'answer')).toBe('answer');
    expect(await runWithLoggerSettings(null, async () => 'later')).toBe('later');
  });

  it('holds a set made inside it: read there after an await, and neither outside it nor after it', async () => {
    const set = gate();
    const read = gate();
    const inside = runWithLoggerSettings(null, async () => {
      setActiveLoggerSettings(settingsWith({ level: 'error' }));
      set.open();
      await read.opened;
      return activeLoggerSettings().level;
    });

    await set.opened;
    const outside = activeLoggerSettings();
    read.open();

    expect(await inside).toBe('error');
    expect(outside).toBe(DEFAULT_LOGGER_SETTINGS);
    expect(activeLoggerSettings()).toBe(DEFAULT_LOGGER_SETTINGS);
  });

  it('puts the defaults back in the scope, and not at module level, when null is set inside it', () => {
    setActiveLoggerSettings(settingsWith({ level: 'error' }));

    const inside = runWithLoggerSettings(settingsWith({ level: 'debug' }), () => {
      setActiveLoggerSettings(null);
      return activeLoggerSettings();
    });

    expect(inside).toBe(DEFAULT_LOGGER_SETTINGS);
    expect(activeLoggerSettings().level).toBe('error');
  });

  it.each([['first'], ['last']] as const)('keeps two scopes that overlap apart when the first started ends %s', async (ends) => {
    const bothSet = gate();
    const otherEnded = gate();
    const levels: Record<string, string> = {};
    const scoped = async (level: LogLevel, waitsFor: Promise<void>): Promise<void> => runWithLoggerSettings(null, async () => {
      setActiveLoggerSettings(settingsWith({ level }));
      await waitsFor;
      levels[level] = activeLoggerSettings().level;
    });
    const [firstWaits, secondWaits] = ends === 'first'
      ? [bothSet.opened, otherEnded.opened]
      : [otherEnded.opened, bothSet.opened];

    const first = scoped('error', firstWaits);
    const second = scoped('debug', secondWaits);
    bothSet.open();
    await (ends === 'first'
      ? first
      : second);
    const between = activeLoggerSettings();
    otherEnded.open();
    await Promise.all([first, second]);

    expect(levels).toEqual({ error: 'error', debug: 'debug' });
    expect(between).toBe(DEFAULT_LOGGER_SETTINGS);
    expect(activeLoggerSettings()).toBe(DEFAULT_LOGGER_SETTINGS);
  });

  it('gives a scope inside another settings of its own, and the outer one its own again after it', async () => {
    const levels: string[] = [];

    await runWithLoggerSettings(null, async () => {
      setActiveLoggerSettings(settingsWith({ level: 'error' }));
      levels.push(activeLoggerSettings().level);
      await runWithLoggerSettings(null, async () => {
        levels.push(activeLoggerSettings().level);
        setActiveLoggerSettings(settingsWith({ level: 'debug' }));
        await Promise.resolve();
        levels.push(activeLoggerSettings().level);
      });
      levels.push(activeLoggerSettings().level);
    });

    expect(levels).toEqual(['error', 'warn', 'debug', 'error']);
    expect(activeLoggerSettings()).toBe(DEFAULT_LOGGER_SETTINGS);
  });

  it('leaves nothing of a scope whose function throws', async () => {
    const thrown = runWithLoggerSettings(null, async () => {
      setActiveLoggerSettings(settingsWith({ level: 'error' }));
      await Promise.resolve();
      throw new Error('boom');
    });

    await expect(thrown).rejects.toThrow('boom');
    expect(activeLoggerSettings()).toBe(DEFAULT_LOGGER_SETTINGS);
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
