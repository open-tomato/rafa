/**
 * The terminal under every raw-mode prompt in `src/cli/prompt/`: the keys
 * it reads, the seam it writes and switches through, and the session that
 * holds it in raw mode for exactly as long as a prompt runs.
 *
 * ## Keys
 *
 * A prompt reads {@link Key}s, never bytes. {@link decodeKeys} turns the
 * text of one read into keys:
 *
 *   - `ESC [ A` and `ESC O A` are `up`, `ESC [ B` and `ESC O B` are
 *     `down`. An arrow carrying a modifier, `ESC [ 1 ; 2 A` for shift,
 *     is still the arrow.
 *   - Any other `ESC [` sequence (left, right, Home, F5) and any other
 *     `ESC O` sequence is dropped, as is a sequence the read ends inside.
 *   - `ESC` followed by anything else, or by nothing, is `escape`, and
 *     what follows it is decoded on its own. So Alt with a letter reads
 *     as `escape` and then the letter.
 *   - CR, LF and CR LF are one `enter` each; DEL and BS are `backspace`;
 *     ETX is `ctrl-c`. Every other control character, Tab included, is
 *     dropped.
 *   - Anything else is a `char` key per code point, so pasted text is one
 *     key per character and an emoji is one key.
 *
 * A read is decoded on its own, so a sequence split across two reads is
 * an `escape` and then characters. A terminal writes each key press in
 * one write; this matters only for a pipe feeding keys by the byte.
 *
 * {@link readKeys} is the key source over a stream, `process.stdin` for
 * {@link stdinKeys}. It listens for `data` rather than iterating the
 * stream with `for await`: measured on bun 1.3.14, breaking out of a
 * `for await` over a `PassThrough` destroys it, where removing a `data`
 * listener and pausing it does not, and a command showing a list, then a
 * pager, then the list again reads one standard input three times.
 *
 * ## The terminal seam
 *
 * A {@link Terminal} is what a prompt does to its terminal: whether it is
 * one, switching raw mode, writing, hearing `SIGINT`, and ending the
 * process. {@link processTerminal} is the default: standard input's
 * `isTTY` and `setRawMode`, standard error for writing (standard output
 * stays the command's own), and `process` for the signal and the exit.
 * Tests pass a recording one.
 *
 * ## The session
 *
 * {@link rawSession} runs a prompt with the terminal in raw mode and
 * switches raw mode off on every way out:
 *
 *   - in a `finally`, so a prompt that answers and a prompt that throws
 *     both leave the terminal as they found it;
 *   - on `SIGINT`, which a finally never sees because the process ends
 *     first: the handler switches raw mode off, writes a line break so
 *     the shell's prompt starts on its own line, and ends the process
 *     with {@link INTERRUPT_EXIT_CODE}. Registering the handler replaces
 *     the default end, so the handler has to end the process itself.
 *
 * In raw mode Ctrl-C is not a signal but the `ctrl-c` key, and what it
 * means is the prompt's decision; `SIGINT` reaches a session only from
 * outside, `kill -INT` or a parent passing one on.
 *
 * Sessions do not nest: an inner session's `finally` switches raw mode
 * off under the outer one. A command running prompts one after another
 * opens one session per prompt.
 *
 * ## No terminal
 *
 * Raw mode needs a terminal on standard input. Without one,
 * {@link rawSession} refuses before switching anything, with
 * {@link noTerminalRefusal}: exit 1 and {@link NO_TERMINAL_TEXT}, then the
 * caller's `instead` line when it gives one, so `skill list -i` can name
 * `--output=json`. {@link refuseWithoutTerminal} is the same check for a
 * command that refuses before it does any work.
 */
import type { Readable } from 'node:stream';

import { CommandExit } from '../command.js';

/** The keys a prompt reads that carry no character. */
export const NAMED_KEYS = ['up', 'down', 'enter', 'escape', 'backspace', 'ctrl-c'] as const;

/** A key that carries no character. */
export type NamedKey = (typeof NAMED_KEYS)[number];

/** One decoded key press: a named key, or one printable character. */
export type Key =
  | { readonly name: NamedKey }
  | { readonly name: 'char'; readonly char: string };

/** The exit code a session interrupted by `SIGINT` ends the process with: 128 and the signal's number, 2. */
export const INTERRUPT_EXIT_CODE = 130;

/** The refusal's first line when standard input is not a terminal. */
export const NO_TERMINAL_TEXT = 'This needs a terminal to answer on, and standard input is not one.';

/** The escape character. */
const ESC = '\u001b';

/** The keys a single control character decodes to; see the module note. */
const CONTROL_KEYS: Readonly<Record<string, Key>> = {
  '\r': { name: 'enter' },
  '\n': { name: 'enter' },
  '\u007f': { name: 'backspace' },
  '\b': { name: 'backspace' },
  '\u0003': { name: 'ctrl-c' },
};

/** The keys an arrow sequence's final character decodes to. */
const ARROW_KEYS: Readonly<Record<string, Key>> = {
  A: { name: 'up' },
  B: { name: 'down' },
};

/** Code points below this one are control characters. */
const FIRST_PRINTABLE = 0x20;

/** The one control character above the printable range, DEL. */
const DELETE = 0x7f;

/** The range a control sequence's final character falls in, ECMA-48's `@` to `~`. */
const FINAL_BYTE = /[@-~]/;

/** A key read from a position, and how many characters it took; a null key is dropped. */
interface Reading {
  readonly key: Key | null;
  readonly length: number;
}

/** Reads the `ESC [` sequence at `at`: an arrow, or dropped. */
function readCsi(text: string, at: number): Reading {
  for (let end = at + 2; end < text.length; end += 1) {
    const final = text.charAt(end);
    if (FINAL_BYTE.test(final)) return { key: ARROW_KEYS[final] ?? null, length: end - at + 1 };
  }
  return { key: null, length: text.length - at };
}

/** Reads the escape at `at`: an arrow, a dropped sequence, or `escape`; see the module note. */
function readEscape(text: string, at: number): Reading {
  const next = text.charAt(at + 1);
  if (next === '[') return readCsi(text, at);
  if (next === 'O') {
    const final = text.charAt(at + 2);
    return final === ''
      ? { key: null, length: 2 }
      : { key: ARROW_KEYS[final] ?? null, length: 3 };
  }
  return { key: { name: 'escape' }, length: 1 };
}

/** Reads the key at `at`. */
function readKey(text: string, at: number): Reading {
  const first = text.charAt(at);
  if (first === ESC) return readEscape(text, at);
  if (first === '\r' && text.charAt(at + 1) === '\n') return { key: { name: 'enter' }, length: 2 };
  const control = CONTROL_KEYS[first];
  if (control !== undefined) return { key: control, length: 1 };
  const point = text.codePointAt(at) ?? 0;
  const char = String.fromCodePoint(point);
  const printable = point >= FIRST_PRINTABLE && point !== DELETE;
  const key: Key | null = printable
    ? { name: 'char', char }
    : null;
  return { key, length: char.length };
}

/** The keys in the text of one read; see the module note. */
export function decodeKeys(text: string): readonly Key[] {
  const keys: Key[] = [];
  for (let at = 0; at < text.length;) {
    const { key, length } = readKey(text, at);
    if (key !== null) keys.push(key);
    at += length;
  }
  return keys;
}

/** A stream keys are read from: `process.stdin`, or a test's own. */
export type KeyInput = Pick<Readable, 'on' | 'off' | 'resume' | 'pause'>;

/** The keys read so far, and whether the input has ended or failed. */
interface KeyQueue {
  readonly keys: Key[];
  ended: boolean;
  failure: { readonly error: unknown } | null;
  wake: (() => void) | null;
}

/**
 * The keys typed on `input`, until it ends; see the module note. Throws
 * the stream's error. Leaving the loop early stops listening and pauses
 * `input`, and leaves it open for the next prompt.
 */
export async function* readKeys(input: KeyInput): AsyncGenerator<Key, void, undefined> {
  const decoder = new TextDecoder();
  const queue: KeyQueue = { keys: [], ended: false, failure: null, wake: null };
  const wake = (): void => {
    queue.wake?.();
  };
  const onData = (chunk: string | Uint8Array): void => {
    const text = typeof chunk === 'string'
      ? chunk
      : decoder.decode(chunk, { stream: true });
    queue.keys.push(...decodeKeys(text));
    wake();
  };
  const onEnd = (): void => {
    queue.ended = true;
    wake();
  };
  const onError = (error: unknown): void => {
    queue.failure = { error };
    wake();
  };
  input.on('data', onData);
  input.on('end', onEnd);
  input.on('close', onEnd);
  input.on('error', onError);
  input.resume();
  try {
    for (;;) {
      const key = queue.keys.shift();
      if (key !== undefined) {
        yield key;
        continue;
      }
      if (queue.failure !== null) throw queue.failure.error;
      if (queue.ended) return;
      await new Promise<void>((settle) => {
        queue.wake = settle;
      });
      queue.wake = null;
    }
  } finally {
    input.off('data', onData);
    input.off('end', onEnd);
    input.off('close', onEnd);
    input.off('error', onError);
    input.pause();
  }
}

/** The keys typed on standard input: {@link readKeys} over `process.stdin`. */
export function stdinKeys(): AsyncGenerator<Key, void, undefined> {
  return readKeys(process.stdin);
}

/** What a prompt does to its terminal; see the module note. */
export interface Terminal {
  /** True when raw mode can be switched: standard input is a terminal. */
  readonly isTTY: boolean;
  /** Switches raw mode on or off. */
  readonly setRawMode: (on: boolean) => void;
  /** Writes `text` as it is. */
  readonly write: (text: string) => void;
  /** Calls `handler` on `SIGINT` until the function answered is called. */
  readonly onInterrupt: (handler: () => void) => () => void;
  /** Ends the process with `code`. */
  readonly exit: (code: number) => void;
}

/** The streams {@link processTerminal} reads and writes. */
export interface TerminalStreams {
  /** Standard input, or a stand-in: its `isTTY` and `setRawMode`. */
  readonly input: {
    readonly isTTY?: boolean;
    readonly setRawMode?: (on: boolean) => unknown;
  };
  /** Where prompts write: standard error, or a stand-in. */
  readonly output: { readonly write: (chunk: string) => unknown };
}

/**
 * The {@link Terminal} over this process: `streams.input` for `isTTY` and
 * raw mode, `streams.output` for writing, `process` for `SIGINT` and the
 * exit. `isTTY` is true only when the input also has a `setRawMode`.
 */
export function processTerminal(
  streams: TerminalStreams = { input: process.stdin, output: process.stderr },
): Terminal {
  const { input, output } = streams;
  return {
    isTTY: input.isTTY === true && typeof input.setRawMode === 'function',
    setRawMode: (on) => {
      input.setRawMode?.(on);
    },
    write: (text) => {
      output.write(text);
    },
    onInterrupt: (handler) => {
      process.on('SIGINT', handler);
      return () => {
        process.off('SIGINT', handler);
      };
    },
    exit: (code) => {
      process.exit(code);
    },
  };
}

/** How a session refuses when there is no terminal. */
export interface NoTerminalOptions {
  /** A line said after {@link NO_TERMINAL_TEXT}, naming what to run instead. */
  readonly instead?: string;
}

/** The refusal for a run whose standard input is not a terminal: exit 1, the text, then `instead`. */
export function noTerminalRefusal(options: NoTerminalOptions = {}): CommandExit {
  const lines = options.instead === undefined
    ? [NO_TERMINAL_TEXT]
    : [NO_TERMINAL_TEXT, options.instead];
  return new CommandExit(1, `❌ ${lines.join('\n   ')}`);
}

/** Throws {@link noTerminalRefusal} when `terminal` is not a terminal. */
export function refuseWithoutTerminal(terminal: Terminal, options: NoTerminalOptions = {}): void {
  if (!terminal.isTTY) throw noTerminalRefusal(options);
}

/**
 * Runs `prompt` with `terminal` in raw mode, answering what it answers,
 * and switches raw mode off in a `finally` and on `SIGINT`; see the module
 * note. Refuses with {@link noTerminalRefusal} when `terminal` is not a
 * terminal, before switching anything.
 */
export async function rawSession<T>(
  terminal: Terminal,
  prompt: () => Promise<T>,
  options: NoTerminalOptions = {},
): Promise<T> {
  refuseWithoutTerminal(terminal, options);
  const stopHearing = terminal.onInterrupt(() => {
    terminal.setRawMode(false);
    terminal.write('\n');
    terminal.exit(INTERRUPT_EXIT_CODE);
  });
  try {
    terminal.setRawMode(true);
    return await prompt();
  } finally {
    stopHearing();
    terminal.setRawMode(false);
  }
}
