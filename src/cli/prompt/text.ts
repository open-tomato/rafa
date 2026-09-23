/**
 * The `text` prompt: one line of free text, typed in raw mode.
 *
 * The prompt reads {@link Key}s from its key source and redraws its one
 * line on the terminal seam after each key that changes it:
 *
 *   - a printable character is appended to the answer;
 *   - `backspace` removes the answer's last character (a code point, so an
 *     emoji goes whole), and does nothing on an empty answer;
 *   - `enter` answers the text typed, unless `validate` names a problem
 *     with it, in which case the problem is shown after the line and the
 *     prompt keeps reading;
 *   - `escape` answers `null`: the person declined to answer;
 *   - `ctrl-c` throws a {@link CommandExit} with
 *     {@link INTERRUPT_EXIT_CODE}, since in raw mode Ctrl-C is a key and
 *     not a signal;
 *   - `up` and `down` are ignored.
 *
 * A key source that ends before `enter` or `escape` answers `null`.
 *
 * The prompt runs inside {@link rawSession}, so raw mode is switched off
 * however it ends, and with no terminal it refuses before reading a key.
 * The line is drawn as carriage return, erase-line, then the message and
 * the answer so far; the answer ends with a line break.
 */
import type { Key, NoTerminalOptions, Terminal } from './terminal.js';

import { CommandExit } from '../command.js';

import { INTERRUPT_EXIT_CODE, processTerminal, rawSession, stdinKeys } from './terminal.js';

/** Carriage return and erase the whole line, before each redraw. */
const CLEAR_LINE = '\r\u001b[2K';

/** How a {@link text} prompt asks, and where it reads and writes. */
export interface TextOptions extends NoTerminalOptions {
  /** The question, shown before the answer. */
  readonly message: string;
  /** The answer already typed when the prompt opens; empty by default. */
  readonly initial?: string;
  /** A problem with `value` that stops `enter` from answering, or `null` when there is none. */
  readonly validate?: (value: string) => string | null;
  /** The key source; {@link stdinKeys} by default. */
  readonly keys?: AsyncIterable<Key>;
  /** The terminal seam; {@link processTerminal} by default. */
  readonly terminal?: Terminal;
}

/** The prompt's line: the message, the answer so far, and a problem when there is one. */
export function renderText(message: string, value: string, problem: string | null = null): string {
  const line = `${CLEAR_LINE}? ${message} ${value}`;
  return problem === null
    ? line
    : `${line}  (${problem})`;
}

/** `value` without its last code point. */
function dropLast(value: string): string {
  const points = [...value];
  return points.slice(0, -1).join('');
}

/** Reads keys until one answers; see the module note. */
async function readText(options: TextOptions, keys: AsyncIterable<Key>, terminal: Terminal): Promise<string | null> {
  let value = options.initial ?? '';
  terminal.write(renderText(options.message, value));
  for await (const key of keys) {
    if (key.name === 'ctrl-c') throw new CommandExit(INTERRUPT_EXIT_CODE);
    if (key.name === 'escape') {
      terminal.write('\n');
      return null;
    }
    if (key.name === 'enter') {
      const problem = options.validate?.(value) ?? null;
      if (problem === null) {
        terminal.write('\n');
        return value;
      }
      terminal.write(renderText(options.message, value, problem));
      continue;
    }
    if (key.name === 'char') value = `${value}${key.char}`;
    else if (key.name === 'backspace') value = dropLast(value);
    else continue;
    terminal.write(renderText(options.message, value));
  }
  terminal.write('\n');
  return null;
}

/**
 * Asks for one line of text; answers it, or `null` on `escape` or when the
 * keys end. Throws a {@link CommandExit} on `ctrl-c`, and refuses when
 * standard input is not a terminal; see the module note.
 */
export async function text(options: TextOptions): Promise<string | null> {
  const terminal = options.terminal ?? processTerminal();
  const refusal: NoTerminalOptions = options.instead === undefined
    ? {}
    : { instead: options.instead };
  return rawSession(terminal, async () => readText(options, options.keys ?? stdinKeys(), terminal), refusal);
}
