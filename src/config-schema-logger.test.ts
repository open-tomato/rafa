/**
 * Tests for the `logger` section: `logger.kind`, `logger.level`,
 * `logger.theme`, `logger.modules`, `logger.callSite` and `logger.api`,
 * and the settings a loaded config hands the logger.
 *
 * Each key is driven through the spec `SETTINGS` holds for it. Every
 * refusal sits beside an accepting control, and every key and message is
 * SPELLED, never read off the module.
 */
import type { ConfigSetting } from './config-schema.js';

import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, afterEach, describe, expect, it } from 'bun:test';

import { activeLoggerSettings, setActiveLoggerSettings } from './adapters/logger/settings.js';
import { loadConfig } from './config-load.js';
import { loggerSettingsOf } from './config-schema-logger.js';
import { CONFIG_DEFAULTS, SETTINGS } from './config-schema.js';
import { projectConfigText } from './project/scaffold.js';
import { plantProject } from './tests/cli-capture.js';

const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-config-logger-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

afterEach(() => {
  setActiveLoggerSettings(null);
});

/** What `setting` reads `raw` as, under its own file key. */
function read(setting: ConfigSetting, raw: unknown): { value: unknown; problems: readonly string[]; extras: readonly unknown[] } {
  const spec = SETTINGS[setting];
  return spec.read(raw, { label: `F: ${spec.key}`, key: spec.key });
}

describe('logger.level', () => {
  it('accepts each ordered level', () => {
    expect(read('loggerLevel', 'error').value).toBe('error');
    expect(read('loggerLevel', 'warn').value).toBe('warn');
    expect(read('loggerLevel', 'debug').value).toBe('debug');
  });

  it('refuses info and api, which are no ordered level', () => {
    expect(read('loggerLevel', 'info').problems).toEqual(['F: logger.level is "info", expected one of: error, warn, debug']);
    expect(read('loggerLevel', 'api').problems).toEqual(['F: logger.level is "api", expected one of: error, warn, debug']);
  });
});

describe('logger.theme', () => {
  it('accepts default and plain, and refuses another name', () => {
    expect(read('loggerTheme', 'plain').value).toBe('plain');
    expect(read('loggerTheme', 'neon').problems).toEqual(['F: logger.theme is "neon", expected one of: default, plain']);
  });
});

describe('logger.callSite and logger.api', () => {
  it('accept a YAML boolean and refuse anything spelled like one', () => {
    expect(read('loggerCallSite', true).value).toBe(true);
    expect(read('loggerCallSite', 'yes').problems).toEqual(['F: logger.callSite is "yes", expected true or false']);
    expect(read('loggerApi', true).value).toBe(true);
    expect(read('loggerApi', 1).problems).toEqual(['F: logger.api is 1, expected true or false']);
  });
});

describe('logger.kind', () => {
  it('accepts a kind name and refuses an empty one', () => {
    expect(read('loggerKind', 'winston').value).toBe('winston');
    expect(read('loggerKind', '').problems).toEqual(['F: logger.kind is "", expected an adapter kind, such as console']);
  });
});

describe('logger.modules', () => {
  it('reads a level per module, as a map by module', () => {
    expect(read('loggerModules', { board: { level: 'debug' }, plan: { level: 'error' } }).value)
      .toEqual(new Map([['board', 'debug'], ['plan', 'error']]));
  });

  it('refuses a module naming no level', () => {
    expect(read('loggerModules', { board: {} }).problems)
      .toEqual(['F: logger.modules.board.level is undefined, expected one of: error, warn, debug']);
  });

  it('refuses a module that is no mapping', () => {
    expect(read('loggerModules', { board: 'debug' }).problems)
      .toEqual(['F: logger.modules.board is "debug", expected a mapping holding level']);
  });

  it('keeps a key it does not read as an extra', () => {
    const reading = read('loggerModules', { board: { level: 'debug', tint: 'red' } });

    expect(reading.value).toEqual(new Map([['board', 'debug']]));
    expect(reading.extras).toEqual([{ key: 'logger.modules.board.tint', value: 'red' }]);
  });

  it('refuses a value that is no mapping', () => {
    expect(read('loggerModules', ['board']).problems)
      .toEqual(['F: logger.modules is a list, expected a mapping of names to a mapping holding level']);
  });
});

describe('the logger defaults', () => {
  it('are console at warn, the default theme, no module level, and callSite and api off', () => {
    expect(loggerSettingsOf(CONFIG_DEFAULTS)).toEqual({
      kind: 'console',
      level: 'warn',
      theme: 'default',
      modules: new Map(),
      callSite: false,
      api: false,
    });
  });
});

describe('loadConfig', () => {
  it('hands the file\'s logger settings to the logger', () => {
    const text = `${projectConfigText()}\nlogger:\n  level: error\n  api: true\n  modules:\n    board: { level: debug }\n`;
    const project = plantProject(mkdtempSync(join(tempBase, 'case-')), text);

    loadConfig({ root: project.root, home: project.home }, {}, () => {});

    expect(activeLoggerSettings()).toEqual({
      kind: 'console',
      level: 'error',
      theme: 'default',
      modules: new Map([['board', 'debug']]),
      callSite: false,
      api: true,
    });
  });

  it('sets them before it prints the load\'s own warnings', () => {
    const text = `${projectConfigText()}\nlogger:\n  level: error\nnonesuch: 1\n`;
    const project = plantProject(mkdtempSync(join(tempBase, 'case-')), text);
    const levels: string[] = [];

    loadConfig({ root: project.root, home: project.home }, {}, () => {
      levels.push(activeLoggerSettings().level);
    });

    expect(levels).toEqual(['error']);
  });
});
