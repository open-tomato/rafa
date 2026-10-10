/**
 * The `console` logger: the adapter core ships for the `Logger` port
 * (#950). It filters each entry by the settings active when the entry is
 * written (`settings.ts`), then writes through the active output in the
 * shape that output's mode reads:
 *
 *   - **text**: one line through `info`,
 *     `<level>: <module> <action>: <message> [<code>] (<site>)`, with
 *     each part left out when the entry lacks it, and a second line
 *     `  hint: <hint>` when it has one. Only the `<level>:` prefix is
 *     coloured. It goes through `info` and not through the output's own
 *     `warn`, so the line is this adapter's whole, colour included, and
 *     a `debug` entry a module's level turned on is not dropped again by
 *     the text output's verbosity.
 *   - **json** and **events**: today's `log` event. The message is the
 *     label and the message, as a text line would carry them, so a
 *     reader of `message` alone loses nothing. Everything else the entry
 *     knew goes under `fields`, which is left out when there is nothing.
 *     A `data` that JSON cannot write, a cycle or a bigint, is left out
 *     and `fields.dataUnwritable` says so: a diagnostic never throws.
 *     The events output prints an `error` event and drops the rest, as
 *     it did.
 *
 * An `api` entry has its exchange filtered first (`api-filter.ts`). In
 * text mode it reads `api: <label>: <exchange line> — <message>`. As an
 * event it is written at level `debug`, since the event's level list is
 * a published shape, with `fields.type` set to `api` and the filtered
 * exchange under `fields.api`. Its message and the message of its error
 * have every URL in them filtered too. Its `data` is written as given.
 *
 * Text mode writes neither `data` nor the error behind an entry: the
 * message is the line. Json mode keeps the error's message under
 * `fields.error`, never its stack.
 *
 * ## The call site
 *
 * With `callSite` on, a `debug` line names the file and line that wrote
 * it. The stack is recorded with `Error.captureStackTrace(holder, log)`,
 * `log` being the function the caller invoked: everything from `log`
 * upward is left out, so the first frame is the caller's and never this
 * file's. The contract suite holds that. A frame of the runtime's own
 * code is skipped, so `items.forEach((x) => logger.log(…))` names the
 * line of the `forEach`. One limit stays: where the runtime removes the
 * calling frame altogether, as for a `.then(() => logger.log(…))`, no
 * site is written.
 */
import type { LoggerSettings, LoggerTheme } from './settings.js';
import type { OutputMode } from '../../config-sections.js';
import type { CliEventLog, LogBindings, LogEntry, Logger, Output } from '../../ports/index.js';

import { basename } from 'node:path';

import { messageOf } from '../../config-sections.js';
import { activeOutput, activeOutputMode } from '../output/active.js';

import { exchangeLine, filterExchange, scrubUrls } from './api-filter.js';
import { paint } from './colour.js';
import { activeLoggerSettings, levelEnabled } from './settings.js';

/** What {@link createConsoleLogger} makes a logger with. */
export interface CreateConsoleLoggerOptions {
  /** The invocation's verbosity: `debug` is on from 2, `api` from 3. Default 0. */
  readonly verbosity?: number;
  /** Whether a text line's level prefix may be coloured. Default false. */
  readonly colour?: boolean;
  /** The settings read at each entry. Default the active ones. */
  readonly settings?: () => LoggerSettings;
  /** The output written through. Default the active one. */
  readonly output?: () => Output;
  /** The mode that output renders in. Default the active one. */
  readonly mode?: () => OutputMode;
}

/** The options, each with its default filled in. */
type ConsoleEnv = Required<CreateConsoleLoggerOptions>;

/** The file and line at the end of a stack frame. */
const FRAME_LOCATION = /\(?([^()\s]+):(\d+):\d+\)?$/;

/** Where a frame of the runtime's own code says it is, such as `Array.forEach`. */
const NATIVE_FRAME = 'native';

/** What a stack frame's line opens with. */
const FRAME_OPENING = 'at ';

/** The level an `api` entry's event is written at; see the module note. */
const API_EVENT_LEVEL = 'debug';

/** The module and the action of `entry`, as one label; empty when it names neither. */
function labelOf(entry: LogEntry): string {
  return [entry.module, entry.action].filter((part) => part !== undefined && part !== '')
    .join(' ');
}

/** The message of `entry`, with every URL in it filtered when the entry is an `api` one. */
function messageIn(entry: LogEntry): string {
  return entry.level === 'api'
    ? scrubUrls(entry.message)
    : entry.message;
}

/** What `entry` says: its message, or for an `api` entry its exchange line, then the message. */
function bodyOf(entry: LogEntry): string {
  const message = messageIn(entry);
  if (entry.api === undefined) return message;
  return message === ''
    ? exchangeLine(entry.api)
    : `${exchangeLine(entry.api)} — ${message}`;
}

/** The message of the error behind `entry`, its URLs filtered for an `api` entry; undefined with no error. */
function errorIn(entry: LogEntry): string | undefined {
  if (entry.error === undefined) return undefined;
  return entry.level === 'api'
    ? scrubUrls(messageOf(entry.error))
    : messageOf(entry.error);
}

/** True when `value` can be written as JSON: no cycle, no bigint, nothing `JSON.stringify` refuses. */
function writableAsJson(value: unknown): boolean {
  try {
    JSON.stringify(value);
    return true;
  } catch {
    return false;
  }
}

/** The label and the body, or the body alone for an entry with no label. */
function labelled(entry: LogEntry): string {
  const label = labelOf(entry);
  return label === ''
    ? bodyOf(entry)
    : `${label}: ${bodyOf(entry)}`;
}

/** The line a text output reads `entry` as, `site` being the caller's file and line when known. */
export function textLine(entry: LogEntry, site: string | null, theme: LoggerTheme, colour: boolean): string {
  const code = entry.code === undefined
    ? ''
    : ` [${entry.code}]`;
  const where = site === null
    ? ''
    : ` (${site})`;
  return `${paint(entry.level, `${entry.level}:`, theme, colour)} ${labelled(entry)}${code}${where}`;
}

/** What `entry` knew beyond its message, or null when it knew nothing. */
function fieldsOf(entry: LogEntry, site: string | null): Readonly<Record<string, unknown>> | null {
  const dataWritable = entry.data === undefined || writableAsJson(entry.data);
  const known = ([
    ['type', entry.level === 'api'
      ? 'api'
      : undefined],
    ['module', entry.module],
    ['action', entry.action],
    ['code', entry.code],
    ['hint', entry.hint],
    ['data', dataWritable
      ? entry.data
      : undefined],
    ['dataUnwritable', dataWritable
      ? undefined
      : true],
    ['error', errorIn(entry)],
    ['api', entry.api === undefined
      ? undefined
      : filterExchange(entry.api)],
    ['site', site ?? undefined],
  ] as const).filter(([, value]) => value !== undefined);
  return known.length === 0
    ? null
    : Object.freeze(Object.fromEntries(known));
}

/** The `log` event `entry` is emitted as. */
function eventOf(entry: LogEntry, site: string | null): CliEventLog {
  const fields = fieldsOf(entry, site);
  return {
    type: 'log',
    level: entry.level === 'api'
      ? API_EVENT_LEVEL
      : entry.level,
    message: labelled(entry),
    ...fields === null
      ? {}
      : { fields },
    ts: new Date().toISOString(),
  };
}

/** The file and line that called `below`, or null when the stack names none. */
function callSiteOf(below: (entry: LogEntry) => void): string | null {
  const holder: { stack?: string } = {};
  Error.captureStackTrace(holder, below);
  const located = (holder.stack ?? '').split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith(FRAME_OPENING))
    .map((line) => FRAME_LOCATION.exec(line))
    .find((match) => match !== null && match[1] !== NATIVE_FRAME);
  return located === undefined || located === null
    ? null
    : `${basename(located[1] ?? '')}:${located[2] ?? ''}`;
}

/** Writes `entry` through the output of `env`, in the shape its mode reads. */
function write(env: ConsoleEnv, entry: LogEntry, settings: LoggerSettings, site: string | null): void {
  const output = env.output();
  if (env.mode() !== 'text') {
    output.emit(eventOf(entry, site));
    return;
  }
  output.info(textLine(entry, site, settings.theme, env.colour));
  if (entry.hint !== undefined) output.info(`  hint: ${entry.hint}`);
}

/** `entry` without the members it names as undefined, so they do not erase a child's bindings. */
function definedOf(entry: LogEntry): LogEntry {
  return Object.fromEntries(Object.entries(entry).filter(([, value]) => value !== undefined)) as unknown as LogEntry;
}

/** A logger over `env` adding `bindings` to every entry. */
function loggerWith(env: ConsoleEnv, bindings: LogBindings): Logger {
  const log = (given: LogEntry): void => {
    const entry: LogEntry = { ...bindings, ...definedOf(given) };
    const settings = env.settings();
    if (!levelEnabled(entry.level, entry.module, settings, env.verbosity)) return;
    const site = settings.callSite && entry.level === 'debug'
      ? callSiteOf(log)
      : null;
    write(env, entry, settings, site);
  };
  return Object.freeze({
    log,
    child: (more: LogBindings) => loggerWith(env, { ...bindings, ...more }),
    enabled: (level: LogEntry['level'], module: string | undefined = bindings.module) => levelEnabled(
      level,
      module,
      env.settings(),
      env.verbosity,
    ),
  });
}

/** The console logger; see the module note. */
export function createConsoleLogger(options: CreateConsoleLoggerOptions = {}): Logger {
  return loggerWith({
    verbosity: options.verbosity ?? 0,
    colour: options.colour ?? false,
    settings: options.settings ?? activeLoggerSettings,
    output: options.output ?? activeOutput,
    mode: options.mode ?? activeOutputMode,
  }, {});
}
