/**
 * A `RafaContext` for the command tests: the lines each level printed,
 * the payload handed to `output.result`, and an abort controller for the
 * command's signal. `project` is null, as `module exec` hands a module
 * command, so the root comes from `ATLAS_PROJECT_ROOT` in `env`. Named
 * without `.test` so bun never runs it alone.
 */
import type { RafaContext } from '@open-tomato/rafa-core/core/command';

/** The lines a command printed, by level, and what it handed `result`. */
export interface Printed {
  readonly info: string[];
  readonly warn: string[];
  readonly error: string[];
  readonly results: unknown[];
}

/** What a test context is built from. */
export interface TestContextOptions {
  /** Read as the command's environment; `ATLAS_PROJECT_ROOT` names the root. */
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly flags?: Readonly<Record<string, string | boolean>>;
  readonly outputMode?: 'text' | 'json';
}

/** A context printing into `printed`, its signal aborted by `abort`. */
export function testContext(options: TestContextOptions = {}): { context: RafaContext; printed: Printed; abort: () => void } {
  const printed: Printed = { info: [], warn: [], error: [], results: [] };
  const controller = new AbortController();
  const output = {
    info: (line: string) => printed.info.push(line),
    warn: (line: string) => printed.warn.push(line),
    error: (line: string) => printed.error.push(line),
    debug: () => undefined,
    emit: () => undefined,
    result: (payload: unknown) => printed.results.push(payload),
  };
  const context = {
    args: [],
    argv: [],
    flags: options.flags ?? {},
    env: options.env ?? {},
    output,
    outputMode: options.outputMode ?? 'text',
    verbosity: 1,
    signal: controller.signal,
    project: null,
  } as unknown as RafaContext;
  return { context, printed, abort: () => {
    controller.abort();
  } };
}
