/**
 * The line prompter: the one prompt in `src/cli/prompt/` that reads whole
 * lines rather than keys, so it needs no raw mode and works on a pipe as
 * well as on a terminal. Every yes-or-no question rafa asks, and the root
 * `rafa init` reads, goes through a {@link Prompter}; the commands take
 * one from {@link createLinePrompter} over `process.stdin` and
 * `process.stderr`, and tests pass a scripted one.
 *
 * ## The prompter
 *
 * {@link createLinePrompter} reads lines from a stream with `readline`'s
 * `line` and `close` events, and writes each question and each thing it
 * says to another stream. It does not use `readline/promises`: measured
 * on bun 1.3.14, a `question` pending when its input ends never settles,
 * where the `close` event fires. The final line of an input that ends
 * without a line break is still delivered as a line, measured the same
 * way. readline is given no output and `terminal: false`, so on a
 * terminal the terminal's own line discipline echoes and edits what is
 * typed.
 *
 * Two line prompters over one input both receive every line, so a
 * command handing a question to another closes its own first.
 */
import type { Readable } from 'node:stream';

import { createInterface } from 'node:readline';

/** Asks an operator, and tells them what went wrong. */
export interface Prompter {
  /** Writes `text` and a line break. */
  readonly say: (text: string) => void;
  /** Writes `question` and answers the next line typed, or null once the input has ended. */
  readonly ask: (question: string) => Promise<string | null>;
  /** Stops reading the input. */
  readonly close: () => void;
}

/** A stream the prompter writes to: `process.stderr`, or a test's own. */
export interface PromptOutput {
  readonly write: (chunk: string) => unknown;
}

/**
 * A {@link Prompter} reading lines from `input` and writing to `output`;
 * see the module note. A line typed before it is asked for is kept for
 * the next question.
 */
export function createLinePrompter(input: Readable, output: PromptOutput): Prompter {
  const buffered: string[] = [];
  const waiting: ((line: string | null) => void)[] = [];
  let ended = false;
  const lines = createInterface({ input, terminal: false, crlfDelay: Infinity });
  lines.on('line', (line: string) => {
    const reader = waiting.shift();
    if (reader === undefined) buffered.push(line);
    else reader(line);
  });
  lines.on('close', () => {
    ended = true;
    for (const reader of waiting.splice(0)) reader(null);
  });

  return {
    say: (text) => {
      output.write(`${text}\n`);
    },
    ask: async (question) => {
      output.write(question);
      const next = buffered.shift();
      if (next !== undefined) return next;
      if (ended) return null;
      return new Promise((settle) => {
        waiting.push(settle);
      });
    },
    close: () => {
      lines.close();
    },
  };
}
