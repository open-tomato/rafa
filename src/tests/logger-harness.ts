/**
 * What the logger tests share: an output that keeps what is written to
 * it, and a console logger made over one. It holds no test of its own,
 * and no production module imports it.
 */
import type { LoggerHarness } from '../adapters/logger/contract.js';
import type { LoggerSettings } from '../adapters/logger/settings.js';
import type { OutputMode } from '../config-sections.js';
import type { CliEvent, Logger, Output } from '../ports/index.js';

import { createConsoleLogger } from '../adapters/logger/console.js';

/** An output keeping every line and event handed to it. */
export interface KeptOutput {
  readonly output: Output;
  /** The `info` lines, in order. */
  readonly lines: () => readonly string[];
  /** The `warn` lines, in order. */
  readonly warnings: () => readonly string[];
  /** The emitted events, in order. */
  readonly events: () => readonly CliEvent[];
}

/** An output that keeps what it is handed and writes nothing. */
export function keptOutput(): KeptOutput {
  const lines: string[] = [];
  const warnings: string[] = [];
  const events: CliEvent[] = [];
  const output: Output = {
    info: (message) => {
      lines.push(message);
    },
    warn: (message) => {
      warnings.push(message);
    },
    error: () => {},
    debug: () => {},
    emit: (event) => {
      events.push(event);
    },
    result: () => {},
  };
  return { output, lines: () => lines, warnings: () => warnings, events: () => events };
}

/** A console logger over a kept output, and what it wrote. */
export interface ConsoleHarness extends LoggerHarness {
  readonly logger: Logger;
  readonly kept: KeptOutput;
}

/** A console logger reading `settings`, writing in `mode` to an output that keeps everything. */
export function consoleHarness(
  settings: () => LoggerSettings,
  verbosity: number,
  mode: OutputMode = 'text',
  colour = false,
): ConsoleHarness {
  const kept = keptOutput();
  const logger = createConsoleLogger({ verbosity, colour, settings, output: () => kept.output, mode: () => mode });
  return {
    logger,
    kept,
    written: () => [...kept.lines(), ...kept.events().map((event) => JSON.stringify(event))],
  };
}
