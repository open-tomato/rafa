/**
 * Whether a logger may colour its lines, and the colour of each level
 * (#950).
 *
 * The decision follows the two environment variables terminals agree
 * on, in this order:
 *
 *   1. `FORCE_COLOR` set to anything but `0` or nothing: colour is on,
 *      whatever the stream is. Set to `0`, it is off.
 *   2. Else `NO_COLOR` set to anything but nothing: colour is off.
 *   3. Else colour is on when the stream is a terminal.
 *
 * The caller decides what "a terminal" means and whether the output
 * mode is one a person reads: json and events lines are never coloured.
 */
import type { LoggerTheme } from './settings.js';
import type { LogLevel } from '../../ports/index.js';

/** The variable that turns colour on, or off when it is `0`. */
const FORCE_COLOR = 'FORCE_COLOR';

/** The variable that turns colour off. */
const NO_COLOR = 'NO_COLOR';

/** The SGR code each level's prefix is written in. */
const LEVEL_CODES: Readonly<Record<LogLevel, number>> = Object.freeze({
  error: 31,
  warn: 33,
  debug: 2,
  api: 36,
});

/** The sequence that puts the terminal's own colours back. */
const RESET = '\u001b[0m';

/** Whether lines may be coloured, for `env` and a stream that is a terminal or not. */
export function colourEnabled(env: Readonly<Record<string, string | undefined>>, isTerminal: boolean): boolean {
  const force = env[FORCE_COLOR];
  if (force !== undefined && force !== '') return force !== '0';
  const no = env[NO_COLOR];
  if (no !== undefined && no !== '') return false;
  return isTerminal;
}

/** `text` in the colour of `level`, or as it is under the plain theme or with colour off. */
export function paint(level: LogLevel, text: string, theme: LoggerTheme, colour: boolean): string {
  return colour && theme === 'default'
    ? `\u001b[${LEVEL_CODES[level]}m${text}${RESET}`
    : text;
}
