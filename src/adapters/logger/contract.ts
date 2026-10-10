/**
 * The contract every `Logger` adapter passes (#950), as cases a test
 * file runs over its own adapter with {@link runLoggerContract}, the way
 * `../tracker/contract.ts` holds the trackers.
 *
 * An adapter is made through a harness: a logger reading the settings
 * and the verbosity a case hands it, and everything that logger has
 * written so far, as strings. A case then asks two kinds of question:
 * whether anything was written, and whether a word is in it. So the
 * cases hold WHAT is written and never its shape, which is each
 * adapter's own.
 *
 * What the cases hold:
 *
 *   - the ordered levels, a module's own level and the verbosity decide
 *     which entries are written, and `enabled` answers the same;
 *   - a child's bindings reach its entries, and an entry's own fields win
 *     over them, for the level that applies as well;
 *   - the message, the code and the hint all reach what is written;
 *   - with `callSite` on, a `debug` entry names the file that wrote it,
 *     which is THIS file, since the cases call `log` from here. A logger
 *     that built its line in a helper and reported the helper fails it;
 *   - an `api` entry is written only with `api` on, and never with a
 *     secret query value, a URL's user info or a header outside the
 *     allow-list, nor with a member the exchange type does not name,
 *     such as a body a record carried past the type.
 *
 * `contract.test.ts` runs the cases over loggers broken on purpose, the
 * control that each of those cases can fail.
 */
import type { LoggerSettings } from './settings.js';
import type { LogEntry, Logger, LogLevel } from '../../ports/index.js';

import { describe, expect, it } from 'bun:test';

import { DEFAULT_LOGGER_SETTINGS } from './settings.js';

/** A logger under test, and what it has written. */
export interface LoggerHarness {
  readonly logger: Logger;
  /** Everything the logger has written so far, as strings, in order. */
  readonly written: () => readonly string[];
}

/** What {@link runLoggerContract} is handed. */
export interface LoggerContractOptions {
  /** The adapter's name, in the suite's title. */
  readonly name: string;
  /** A fresh logger reading `settings` at each entry, at `verbosity`. */
  readonly create: (settings: () => LoggerSettings, verbosity: number) => LoggerHarness;
}

/** One case of the contract. */
export interface LoggerContractCase {
  readonly name: string;
  readonly run: () => void;
}

/** This file's name, which the call-site case expects to read. */
const THIS_FILE = 'contract.ts';

/** Settings a case reads: the default with `changes` over it. */
function settingsWith(changes: Partial<LoggerSettings> = {}): () => LoggerSettings {
  const settings: LoggerSettings = { ...DEFAULT_LOGGER_SETTINGS, ...changes };
  return () => settings;
}

/** A level for one module, over the default settings. */
function moduleLevel(module: string, level: LogLevel, changes: Partial<LoggerSettings> = {}): () => LoggerSettings {
  return settingsWith({ ...changes, modules: new Map<string, LogLevel>([[module, level]]) });
}

/** Everything `harness` wrote, as one text. */
function textOf(harness: LoggerHarness): string {
  return harness.written().join('\n');
}

/** An `api` entry holding a secret in each place a filter must read. */
const SECRET_EXCHANGE: LogEntry = {
  level: 'api',
  message: 'push',
  module: 'hub',
  api: {
    service: 'hub',
    method: 'POST',
    url: 'https://user:pass@hub.example/v1/sync?token=s3cret-value',
    status: 201,
    headers: { Authorization: 'Bearer tok' },
  },
};

/** The words of {@link SECRET_EXCHANGE} that must never be written. */
const SECRETS: readonly string[] = ['s3cret-value', 'user:pass', 'Bearer tok'];

/** Level, module, settings, verbosity, and whether the entry is on. */
const ENABLED_ROWS: readonly (readonly [LogLevel, string | undefined, () => LoggerSettings, number, boolean])[] = [
  ['warn', undefined, settingsWith(), 0, true],
  ['debug', undefined, settingsWith(), 0, false],
  ['debug', undefined, settingsWith(), 2, true],
  ['warn', undefined, settingsWith({ level: 'error' }), 0, false],
  ['error', undefined, settingsWith({ level: 'error' }), 0, true],
  ['debug', 'board', moduleLevel('board', 'debug'), 0, true],
  ['debug', 'plan', moduleLevel('board', 'debug'), 0, false],
  ['warn', 'board', moduleLevel('board', 'error', { level: 'debug' }), 0, false],
  ['api', undefined, settingsWith(), 0, false],
  ['api', undefined, settingsWith({ level: 'debug' }), 2, false],
  ['api', undefined, settingsWith(), 3, true],
  ['api', undefined, settingsWith({ level: 'error', api: true }), 0, true],
];

/** The cases of the contract, for a test file that wants them one by one. */
export function loggerContractCases(options: LoggerContractOptions): readonly LoggerContractCase[] {
  const { create } = options;
  return [
    {
      name: 'writes a warn entry at the default settings',
      run: () => {
        const harness = create(settingsWith(), 0);
        harness.logger.log({ level: 'warn', message: 'case-warn' });
        expect(textOf(harness)).toContain('case-warn');
      },
    },
    {
      name: 'drops a debug entry at the default settings and verbosity 0',
      run: () => {
        const harness = create(settingsWith(), 0);
        harness.logger.log({ level: 'debug', message: 'case-debug' });
        expect(harness.written()).toEqual([]);
      },
    },
    {
      name: 'writes a debug entry at verbosity 2',
      run: () => {
        const harness = create(settingsWith(), 2);
        harness.logger.log({ level: 'debug', message: 'case-verbose' });
        expect(textOf(harness)).toContain('case-verbose');
      },
    },
    {
      name: 'writes nothing but error at level error',
      run: () => {
        const harness = create(settingsWith({ level: 'error' }), 0);
        harness.logger.log({ level: 'warn', message: 'quiet-warn' });
        harness.logger.log({ level: 'debug', message: 'quiet-debug' });
        harness.logger.log({ level: 'error', message: 'loud-error' });
        expect(textOf(harness)).toContain('loud-error');
        expect(textOf(harness)).not.toContain('quiet-warn');
        expect(textOf(harness)).not.toContain('quiet-debug');
      },
    },
    {
      name: 'applies a module\'s level to a child bound to it, and not to a child bound to another',
      run: () => {
        const harness = create(moduleLevel('board', 'debug'), 0);
        harness.logger.child({ module: 'board' }).log({ level: 'debug', message: 'board-debug' });
        harness.logger.child({ module: 'plan' }).log({ level: 'debug', message: 'plan-debug' });
        expect(textOf(harness)).toContain('board-debug');
        expect(textOf(harness)).not.toContain('plan-debug');
      },
    },
    {
      name: 'lets an entry\'s own module win over the child\'s, for the level too',
      run: () => {
        const harness = create(moduleLevel('board', 'debug'), 0);
        harness.logger.child({ module: 'plan' }).log({ level: 'debug', message: 'own-module', module: 'board' });
        harness.logger.child({ module: 'board' }).log({ level: 'debug', message: 'other-module', module: 'plan' });
        expect(textOf(harness)).toContain('own-module');
        expect(textOf(harness)).not.toContain('other-module');
      },
    },
    {
      name: 'carries the message, the code and the hint into what it writes',
      run: () => {
        const harness = create(settingsWith(), 0);
        harness.logger.log({ level: 'warn', message: 'case-carried', code: 'git:no-identity', hint: 'set user.name' });
        expect(textOf(harness)).toContain('case-carried');
        expect(textOf(harness)).toContain('git:no-identity');
        expect(textOf(harness)).toContain('set user.name');
      },
    },
    {
      name: 'answers enabled as log writes, level by level',
      run: () => {
        for (const [level, module, settings, verbosity, on] of ENABLED_ROWS) {
          const harness = create(settings, verbosity);
          harness.logger.log({ level, message: 'case-enabled', module, api: SECRET_EXCHANGE.api });
          expect(harness.logger.enabled(level, module)).toBe(on);
          expect(harness.written().length > 0).toBe(on);
        }
      },
    },
    {
      name: 'names the calling file on a debug entry with callSite on',
      run: () => {
        const harness = create(settingsWith({ callSite: true }), 2);
        harness.logger.log({ level: 'debug', message: 'case-site' });
        expect(textOf(harness)).toContain(THIS_FILE);
      },
    },
    {
      name: 'writes an api entry only with api on, and none of its secrets',
      run: () => {
        const off = create(settingsWith(), 0);
        off.logger.log(SECRET_EXCHANGE);
        expect(off.written()).toEqual([]);

        const debug = create(settingsWith({ level: 'debug' }), 0);
        debug.logger.log(SECRET_EXCHANGE);
        expect(debug.written()).toEqual([]);

        const on = create(settingsWith({ api: true }), 0);
        on.logger.log(SECRET_EXCHANGE);
        expect(textOf(on)).toContain('hub.example');
        for (const secret of SECRETS) expect(textOf(on)).not.toContain(secret);
      },
    },
    {
      name: 'writes no member of an exchange that the type does not name',
      run: () => {
        // A record built elsewhere passes the type with members it does not name.
        const record = { service: 'hub', method: 'POST', url: 'https://hub.example/x', body: 'case-body-s3cret' };
        const harness = create(settingsWith({ api: true }), 0);
        harness.logger.log({ level: 'api', message: 'push', api: record });
        expect(textOf(harness)).toContain('hub.example');
        expect(textOf(harness)).not.toContain('case-body-s3cret');
      },
    },
  ];
}

/** Runs the contract over one adapter, as a `describe` of its own. */
export function runLoggerContract(options: LoggerContractOptions): void {
  describe(`${options.name}: Logger contract`, () => {
    for (const contractCase of loggerContractCases(options)) it(contractCase.name, contractCase.run);
  });
}
