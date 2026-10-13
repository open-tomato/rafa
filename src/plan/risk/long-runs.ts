/**
 * The long-run reading `rafa plan risk` reports: which open task lines
 * tell their own session to run the whole suite (#941).
 *
 * A task's session runs its commands through the Bash tool, which stops
 * a command at 10 minutes, and the whole suite runs longer. The runner
 * runs the suite after the task commits when the task declares
 * `tests=full`, so a whole-suite run written into a task's TEXT is a
 * slip of the planner's, and {@link LONG_RUN_FIX} names the repair.
 *
 * ## What is read
 *
 * The sentence of each task it is handed, declaration taken off
 * (`PlanTask.text`), and nothing else: no `rafa:*` block, no prose, no
 * fence. `assessPlanRisk` hands it the open tasks, so a ticked line is
 * never read here. A sentence is flagged when it holds either of:
 *
 * - **A code span running `bun test` with no path argument**: nothing
 *   after `test`, or flags alone (`bun test --reporter=junit`). The span
 *   is split into shell words (`shellTokens`, `commands.ts`) and cut at
 *   every separator, so `bunx tsc && bun test` and `bun test | tail` are
 *   read, and a redirection's target (`bun test > out.txt`) is not taken
 *   for a path. `bun` may stand behind assignments and the wrappers of
 *   `patterns.ts` (`CI=1 time bun test`). A flag in
 *   {@link SCOPING_FLAGS} narrows the run as a path does, so
 *   `bun test --changed=<base>` is not flagged.
 * - **The phrase "full suite" or "whole suite"**, in any case, anywhere
 *   in the sentence.
 *
 * One finding per task line, level `note`: the span when the line holds
 * one, else the phrase.
 *
 * ## What this reading does not see
 *
 * - `bun test` in prose, outside a code span: only a span is a command.
 * - A flag's separate value: `bun test -t name` and
 *   `bun test --timeout 5000` each hold a word with no dash, which reads
 *   as a path, so neither is flagged.
 * - The suite run any other way: `bun run test`, a package script, a
 *   hyphenated "full-suite", or another long command altogether.
 * - The phrase's sense: "never run the full suite" is flagged like "run
 *   the full suite". It is a `note`, which `--strict` does not refuse.
 */
import type { RiskLevel } from './commands.js';
import type { PlanTask } from '../../core/plan/index.js';

import { shellTokens } from './commands.js';
import { COMMAND_WRAPPERS } from './patterns.js';

/** What a finding says to do; the text after its subject. */
export const LONG_RUN_FIX =
  'a whole-suite run can outlast one Bash call: declare tests=full on the task and take the run out of its text';

/** Flags of `bun test` that narrow the run to part of the suite. */
export const SCOPING_FLAGS: readonly string[] = ['--changed'];

/** An inline code span, with its contents captured. */
const CODE_SPAN = /`([^`\n]+)`/g;

/** The phrase naming the whole suite, in any case. */
const SUITE_PHRASE = /\b(?:full|whole)\s+suite\b/i;

/** An assignment word ahead of a command. */
const ASSIGNMENT = /^[A-Za-z_]\w*=/;

/** What of a task the reading takes: its sentence and where it sits. */
export type LongRunTask = Pick<PlanTask, 'text' | 'lineNum'>;

/** One task line that asks its session for a whole-suite run. */
export interface LongRunFinding {
  /** Always `note`: a slip to repair, not a refusal. */
  readonly level: RiskLevel;
  /** Always `long-run`. */
  readonly kind: 'long-run';
  /** The line a report prints: the subject, then {@link LONG_RUN_FIX}. */
  readonly text: string;
  /** What was found: the span in backticks, or the phrase in quotes. */
  readonly subject: string;
  /** The task's sentence, declaration taken off. */
  readonly task: string;
  /** Its 1-based line in the plan. */
  readonly line: number;
}

/** A span's argument words, one list per command, redirection targets left out. */
function commandWords(span: string): readonly (readonly string[])[] {
  const commands: string[][] = [[]];
  let redirected = false;
  for (const token of shellTokens(span)) {
    if (token.kind === 'separator') {
      commands.push([]);
      redirected = false;
    } else if (token.kind === 'redirect') {
      redirected = true;
    } else if (redirected) {
      redirected = false;
    } else {
      commands.at(-1)?.push(token.text);
    }
  }
  return commands;
}

/** Whether `flag` is one of {@link SCOPING_FLAGS}, bare or with a value. */
function scopes(flag: string): boolean {
  return SCOPING_FLAGS.some((name) => flag === name || flag.startsWith(`${name}=`));
}

/** Whether one command's words are a `bun test` with no path argument. */
function runsWholeSuite(words: readonly string[]): boolean {
  const start = words.findIndex(
    (word) => !ASSIGNMENT.test(word) && !COMMAND_WRAPPERS.includes(word) && !word.startsWith('-'),
  );
  if (start === -1 || words[start] !== 'bun' || words[start + 1] !== 'test') return false;
  return words.slice(start + 2).every((word) => word.startsWith('-') && !scopes(word));
}

/**
 * What in one task sentence asks for a whole-suite run.
 *
 * @param text - The task's sentence, declaration taken off.
 * @returns The first such code span, in backticks; else the phrase as
 *   written, in double quotes; else null.
 */
export function longRunOf(text: string): string | null {
  for (const match of text.matchAll(CODE_SPAN)) {
    if (commandWords(match[1] ?? '').some(runsWholeSuite)) return match[0];
  }
  const phrase = SUITE_PHRASE.exec(text)?.[0];
  return phrase === undefined
    ? null
    : `"${phrase}"`;
}

/**
 * Reads each task's sentence for a whole-suite run.
 *
 * @param tasks - The tasks to read: the plan's open ones.
 * @returns One `note` finding per task that asks for one, in the order
 *   given.
 */
export function readLongRuns(tasks: readonly LongRunTask[]): readonly LongRunFinding[] {
  return tasks.flatMap((task): readonly LongRunFinding[] => {
    const subject = longRunOf(task.text);
    if (subject === null) return [];
    return [{
      level: 'note',
      kind: 'long-run',
      text: `${subject} — ${LONG_RUN_FIX}`,
      subject,
      task: task.text,
      line: task.lineNum + 1,
    }];
  });
}
