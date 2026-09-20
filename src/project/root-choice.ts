/**
 * Taking one project root for `rafa init`: the first candidate, a path
 * named on the command line, or an answer typed at a prompt listing the
 * candidates. Step 4 of `rafa init` under "Scope resolution" in
 * `.rafa/specs/phase-1-installable.md`: "present the candidates for selection
 * or free typing".
 *
 * `roots.ts` answers the candidates and each refusal; this module reads a
 * choice among them. {@link firstCandidate} is `--yes`, {@link namedRoot}
 * is `--root=<path>`, and {@link promptForRoot} lists the candidates
 * through a {@link Prompter} and reads answers until one names a root a
 * project may take, or the input ends. Whether to prompt at all is the
 * command's decision, since only a terminal can answer.
 *
 * ## An answer
 *
 * {@link readRootAnswer} reads an answer, trimmed of surrounding blanks:
 *
 *   - Nothing: the first candidate, unless it is refused. The question
 *     shows it as `[1]` only when it can be taken.
 *   - Digits alone: the candidate with that number, from 1. So a
 *     directory named `2` is typed as `./2`.
 *   - Anything else: a path, resolved against the start directory, and
 *     refused as `rootRefusal` refuses any root.
 *
 * A refused candidate is listed with its number and its reason, and
 * choosing it answers that reason, so the operator reads why rather than
 * wondering where a directory went. Each problem is said through the
 * prompter, and the question asked again.
 *
 * ## The root chosen
 *
 * A {@link ChosenRoot} is a real path, every symlink followed: a
 * candidate already is one, and a named path is resolved once its
 * refusal check has found it resolves. The walk in `scope.ts` answers a
 * project root as a real path too, so the root `init` writes under is the
 * root every later command resolves.
 *
 * ## The prompter
 *
 * {@link createLinePrompter} reads lines from a stream with `readline`'s
 * `line` and `close` events, and writes the list and each question to
 * another stream. It does not use `readline/promises`: measured on bun
 * 1.3.14, a `question` pending when its input ends never settles, where
 * the `close` event fires. The final line of an input that ends without a
 * line break is still delivered as a line, measured the same way.
 * readline is given no output and `terminal: false`, so on a terminal the
 * terminal's own line discipline echoes and edits what is typed.
 */
import type {
  CandidateSource,
  RefusalSeams,
  RootCandidate,
  RootCandidates,
} from './roots.js';
import type { Readable } from 'node:stream';

import { resolve } from 'node:path';
import { createInterface } from 'node:readline';

import { DISK_ROOTS_FILE_SYSTEM, rootRefusal } from './roots.js';

/** Where a chosen root came from: a candidate's source, `--root`, or a path typed at the prompt. */
export type RootSource = CandidateSource | 'root-flag' | 'typed';

/** The root `init` writes under. */
export interface ChosenRoot {
  /** The root, a real path. */
  readonly path: string;
  readonly source: RootSource;
}

/** A root read from a choice, or the problem that kept it from being one. */
export type RootReading =
  | { readonly root: ChosenRoot; readonly problem: null }
  | { readonly root: null; readonly problem: string };

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

/** A reading of a root. */
function chosen(path: string, source: RootSource): RootReading {
  return { root: { path, source }, problem: null };
}

/** A reading of a problem. */
function problem(text: string): RootReading {
  return { root: null, problem: text };
}

/** What each candidate source is, as a phrase. */
const CANDIDATE_PHRASES: Readonly<Record<CandidateSource, string>> = {
  'git-toplevel': 'the git toplevel',
  'directory': 'this directory, in no git repository',
  'monorepo': 'the outermost monorepo root',
};

/** The markers a candidate holds, as the end of its phrase, or nothing. */
function markedPhrase(candidate: RootCandidate): string {
  if (candidate.markers.length === 0) return '';
  const markers = candidate.markers.join(', ');
  return candidate.source === 'monorepo'
    ? `, marked by ${markers}`
    : `, marked as a monorepo by ${markers}`;
}

/** What a candidate is, as a phrase: `the git toplevel, marked as a monorepo by turbo.json`. */
export function describeCandidate(candidate: RootCandidate): string {
  return `${CANDIDATE_PHRASES[candidate.source]}${markedPhrase(candidate)}`;
}

/** The candidate list, one line per candidate after a line naming the start; see the module note. */
export function candidateLines(found: RootCandidates): readonly string[] {
  const width = Math.max(...found.candidates.map((candidate) => candidate.path.length));
  const rows = found.candidates.map((candidate, index) => {
    const refused = candidate.refusal === null
      ? ''
      : `; refused: ${candidate.refusal.reason}`;
    return `  ${String(index + 1)}) ${candidate.path.padEnd(width)}   ${describeCandidate(candidate)}${refused}`;
  });
  return [`Root candidates for a rafa project, from ${found.start}:`, ...rows];
}

/** The question the prompt asks, showing `[1]` when an empty answer takes the first candidate. */
export function rootQuestion(found: RootCandidates): string {
  const fallback = found.candidates[0].refusal === null
    ? ' [1]'
    : '';
  return `Type a candidate's number or a path${fallback}: `;
}

/** The first candidate, `--yes`'s choice, or its refusal. */
export function firstCandidate(found: RootCandidates): RootReading {
  const [first] = found.candidates;
  return first.refusal === null
    ? chosen(first.path, first.source)
    : problem(first.refusal.reason);
}

/**
 * The root `typed` names, resolved against `start`, or the reason
 * `rootRefusal` refuses it. Throws what `rootRefusal` throws for a
 * relative home.
 */
export function namedRoot(
  typed: string,
  start: string,
  source: 'root-flag' | 'typed',
  seams: RefusalSeams,
): RootReading {
  const path = resolve(start, typed);
  const refusal = rootRefusal(path, seams);
  if (refusal !== null) return problem(refusal.reason);
  const fs = seams.fs ?? DISK_ROOTS_FILE_SYSTEM;
  return chosen(fs.realpath(path), source);
}

/** The candidate numbered `digits`, or the problem with that number. */
function numberedCandidate(digits: string, found: RootCandidates): RootReading {
  const count = found.candidates.length;
  const candidate = found.candidates[Number(digits) - 1];
  if (candidate === undefined) {
    return problem(`no candidate is numbered ${digits}; type 1 to ${String(count)}, or a path`);
  }
  return candidate.refusal === null
    ? chosen(candidate.path, candidate.source)
    : problem(candidate.refusal.reason);
}

/** Reads one answer typed at the prompt; see the module note. */
export function readRootAnswer(answer: string, found: RootCandidates, seams: RefusalSeams): RootReading {
  const trimmed = answer.trim();
  if (trimmed === '') {
    return found.candidates[0].refusal === null
      ? firstCandidate(found)
      : problem('type a candidate\'s number or a path');
  }
  if (/^\d+$/.test(trimmed)) return numberedCandidate(trimmed, found);
  return namedRoot(trimmed, found.start, 'typed', seams);
}

/** Asks until an answer names a root, or the input ends. */
async function askUntilChosen(
  found: RootCandidates,
  prompter: Prompter,
  seams: RefusalSeams,
): Promise<ChosenRoot | null> {
  const answer = await prompter.ask(rootQuestion(found));
  if (answer === null) return null;
  const reading = readRootAnswer(answer, found, seams);
  if (reading.root !== null) return reading.root;
  prompter.say(reading.problem);
  return askUntilChosen(found, prompter, seams);
}

/**
 * Lists the candidates through `prompter` and reads answers until one
 * names a root a project may take, answering it, or null once the input
 * ends. Leaves the prompter open; its opener closes it.
 */
export async function promptForRoot(
  found: RootCandidates,
  prompter: Prompter,
  seams: RefusalSeams,
): Promise<ChosenRoot | null> {
  prompter.say(candidateLines(found).join('\n'));
  return askUntilChosen(found, prompter, seams);
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
