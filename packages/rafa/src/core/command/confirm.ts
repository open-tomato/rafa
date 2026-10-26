/**
 * The line prompter: the one prompt that reads whole lines, not keys as
 * `src/cli/prompt/`'s do, so it needs no raw mode and works on a pipe as
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
 *
 * ## The lazy prompter
 *
 * {@link lazyPrompter} wraps the opening of a prompter so a run that
 * never asks opens nothing: the prompter is opened at the first
 * question, kept for the next, and closed by `close`, after which the
 * next question opens a fresh one. It asks in two forms over the one
 * prompter: `askLine` answers the line as typed, or null once the input
 * has ended, for a question that reads its own answer; `ask` is the yes
 * reading over `askLine`, whether the line typed means yes: `y` or `yes`,
 * trimmed and in any case, the reading every `[y/N]` question in rafa
 * makes. Anything else declines, the empty answer and the null of an
 * input that ended included. `issue ready`, `issue unblock`, `next`,
 * `cleanup` and `plan create`'s three offers ask through `ask`, and
 * `epic defer` and `epic promote` through `askLine`.
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

/** A prompter opened at its first question, see the module note. */
export interface LazyPrompter {
  /** Opens the prompter if it is not open, asks `question` and answers the line typed, or null once the input has ended. */
  readonly askLine: (question: string) => Promise<string | null>;
  /** Opens the prompter if it is not open, asks `question` and answers whether the line typed means yes. */
  readonly ask: (question: string) => Promise<boolean>;
  /** Closes the prompter if one is open; the next question opens another. */
  readonly close: () => void;
}

/** The answers that mean yes to a question spelled `[y/N]`. */
const YES_ANSWERS: readonly string[] = Object.freeze(['y', 'yes']);

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

/**
 * A {@link LazyPrompter} over `open`, which is called at the first
 * question and again at the first one after each `close`; see the
 * module note.
 */
export function lazyPrompter(open: () => Prompter): LazyPrompter {
  let prompter: Prompter | null = null;
  const askLine = async (question: string): Promise<string | null> => {
    prompter ??= open();
    return prompter.ask(question);
  };
  return {
    askLine,
    ask: async (question: string): Promise<boolean> => {
      const answer = await askLine(question);
      return answer !== null && YES_ANSWERS.includes(answer.trim().toLowerCase());
    },
    close: (): void => {
      prompter?.close();
      prompter = null;
    },
  };
}
