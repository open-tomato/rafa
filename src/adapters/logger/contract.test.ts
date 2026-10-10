/**
 * The logger contract run over the console adapter, and the control
 * that its cases can fail: three loggers each broken in one way, held to
 * break the cases meant to catch them.
 */
import type { LoggerContractOptions } from './contract.js';
import type { Logger, LogEntry } from '../../ports/index.js';

import { describe, expect, it } from 'bun:test';

import { consoleHarness } from '../../tests/logger-harness.js';

import { loggerContractCases, runLoggerContract } from './contract.js';

runLoggerContract({ name: 'console', create: (settings, verbosity) => consoleHarness(settings, verbosity) });
runLoggerContract({ name: 'console, json mode', create: (settings, verbosity) => consoleHarness(settings, verbosity, 'json') });

/** A logger writing `line(entry)` for every entry, whatever the settings say. */
function looseLogger(written: string[], line: (entry: LogEntry) => string, bindings: Partial<LogEntry> = {}): Logger {
  return {
    log: (entry) => {
      written.push(line({ ...bindings, ...entry }));
    },
    child: (more) => looseLogger(written, line, { ...bindings, ...more }),
    enabled: () => true,
  };
}

/** The names of the contract cases `options` breaks. */
function broken(options: LoggerContractOptions): readonly string[] {
  return loggerContractCases(options).flatMap((contractCase) => {
    try {
      contractCase.run();
      return [];
    } catch {
      return [contractCase.name];
    }
  });
}

describe('the logger contract, over loggers broken on purpose', () => {
  it('catches a logger that writes every entry', () => {
    const names = broken({
      name: 'writes everything',
      create: () => {
        const written: string[] = [];
        return { logger: looseLogger(written, (entry) => `${entry.module ?? ''} ${entry.message}`), written: () => written };
      },
    });

    expect(names).toContain('drops a debug entry at the default settings and verbosity 0');
    expect(names).toContain('writes nothing but error at level error');
  });

  it('catches a logger that writes an api exchange unfiltered', () => {
    const names = broken({
      name: 'leaks',
      create: (settings, verbosity) => {
        const harness = consoleHarness(settings, verbosity);
        const written: string[] = [];
        const leaking: Logger = {
          log: (entry) => {
            if (harness.logger.enabled(entry.level, entry.module)) written.push(`${entry.message} ${JSON.stringify(entry.api ?? {})}`);
          },
          child: () => leaking,
          enabled: harness.logger.enabled,
        };
        return { logger: leaking, written: () => written };
      },
    });

    expect(names).toContain('writes an api entry only with api on, and none of its secrets');
    expect(names).toContain('writes no member of an exchange that the type does not name');
  });

  it('catches a logger whose child drops its bindings', () => {
    const names = broken({
      name: 'forgets',
      create: (settings, verbosity) => {
        const harness = consoleHarness(settings, verbosity);
        const forgetful: Logger = { log: harness.logger.log, child: () => forgetful, enabled: harness.logger.enabled };
        return { logger: forgetful, written: harness.written };
      },
    });

    expect(names).toContain('applies a module\'s level to a child bound to it, and not to a child bound to another');
  });
});

describe('the logger contract, over a logger naming its own file', () => {
  it('catches a call site read off the wrong frame', () => {
    const names = broken({
      name: 'misplaced',
      create: (settings, verbosity) => {
        const harness = consoleHarness(settings, verbosity);
        const written: string[] = [];
        const misplaced: Logger = {
          log: (entry) => {
            if (harness.logger.enabled(entry.level, entry.module)) written.push(`${entry.message} (console.ts:1)`);
          },
          child: () => misplaced,
          enabled: harness.logger.enabled,
        };
        return { logger: misplaced, written: () => written };
      },
    });

    expect(names).toContain('names the calling file on a debug entry with callSite on');
  });
});

describe('the logger contract', () => {
  it('holds eleven cases', () => {
    expect(loggerContractCases({ name: 'console', create: (settings, verbosity) => consoleHarness(settings, verbosity) }))
      .toHaveLength(11);
  });
});
