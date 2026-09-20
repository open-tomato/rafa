/**
 * The board step `rafa init` ends with: whether to run it at all, the
 * one question it asks, and the lines it prints for what
 * {@link setUpBoard} came to.
 *
 * `src/board/setup.ts` makes the board — the six labels, the spec issue
 * template, the pinned Roadmap issue and `roadmap.issue` — and reports
 * each part as created, present or refused. This module is the half
 * that decides whether that runs, and it is where the flags, the
 * question and the printed shape of a report live (from the PR commands
 * spec: "`rafa init` sets up the board").
 *
 * ## Asked once, and only where there is a board to set up
 *
 * One question for the whole step, not one per part: the parts are a
 * board, and an operator who wants a board wants all of it.
 * {@link runBoardStep} decides in this order, and the first answer wins:
 *
 *   - `--no-board`: declined, nothing is read and nothing is asked.
 *   - A repository whose pull request provider is not `gh`: there is no
 *     GitHub board to make, so the step does not run and nothing is
 *     asked. A line that asked for `--board` anyway is told so through
 *     {@link BoardStepResult.warnings} rather than refused, because
 *     `rafa init` has written the scopes by then and a refusal that
 *     leaves a project half-made would be worse than a warning.
 *   - `--board`: run, asking nothing.
 *   - No terminal: the step does not run, and the line naming
 *     `rafa init --board` is printed. `init` reads a root the same way —
 *     it never waits on an answer nobody can type — and refusing here
 *     would make `rafa init --yes` in a script fail on a repository it
 *     had just finished setting up.
 *   - Otherwise: the question, on stderr through the {@link Prompter}
 *     `init` reads a root with, so a json-mode stdout stays NDJSON. An
 *     answer that is not `y` or `yes`, the empty answer and an input
 *     that ended included, declines: the question is spelled `[y/N]`.
 *
 * ## The public-repository line
 *
 * A public repository gets one extra line above the question, because
 * saying yes opens an issue and every issue body and comment rafa
 * writes from then on is readable by anyone — which is a thing to know
 * BEFORE answering, not after. The reading is one
 * `gh repo view --json visibility`, sent only when the question is
 * actually asked: `--board` and `--no-board` have already decided, and
 * spending a round trip to word a question nobody sees would slow every
 * scripted run.
 *
 * Measured on `gh` 2.100.0 on 2026-09-19 in this repository:
 * `gh repo view --json visibility,isPrivate` writes
 * `{"isPrivate":false,"visibility":"PUBLIC"}`, so the value is upper
 * case there and {@link readVisibility} folds it. A probe that fails, or
 * answers a shape this does not read, leaves the line out AND says so
 * as a warning: a private-looking question on a public repository is
 * exactly the false negative worth hearing about.
 *
 * ## Nothing here spawns
 *
 * GitHub arrives through the {@link GhRunner} `src/commands/init.ts`
 * opens for the root, the terminal through its seams, and the question
 * through its prompter. The runner is opened LAZILY, once the first
 * three answers above have not been reached, so a run that sends
 * nothing opens nothing — which is what lets `init.test.ts` hand every
 * case that must not reach GitHub an opener that throws. Every case in
 * `./init-board.test.ts` drives a recorded fake and a scripted
 * prompter.
 */
import type { GhRunner } from '../adapters/tracker/github.js';
import type { BoardPart, BoardSetupReport } from '../board/setup.js';
import type { PrProvider } from '../config-sections.js';
import type { Prompter } from '../project/root-choice.js';

import { boardChanged, setUpBoard } from '../board/setup.js';
import { describeValue, isMapping, messageOf } from '../config-sections.js';

/** The answers that mean yes to the question, which is spelled `[y/N]`. */
const YES_ANSWERS: readonly string[] = ['y', 'yes'];

/** The question, asked once for the whole board. */
export const BOARD_QUESTION = 'Set up the GitHub board for this repo? [y/N] ';

/** The line a public repository gets above the question. */
export const PUBLIC_REPO_LINE =
  'This repository is public, so every issue and comment the board holds can be read by anyone.';

/** What a run that did not set up a board names as the way to set one up. */
export const BOARD_FIX = 'rafa init --board';

/** What the board step came to. */
export type BoardStepStatus =
  /** {@link setUpBoard} ran, and `report` says what each part came to. */
  | 'ran'
  /** `--no-board`, or the question answered with anything but yes. */
  | 'declined'
  /** Nobody said and there was no terminal to ask on. */
  | 'unanswered'
  /** The repository's pull request provider is not `gh`, so there is no board to make. */
  | 'not-github';

/** What one run of {@link runBoardStep} came to. */
export interface BoardStepResult {
  readonly status: BoardStepStatus;
  /** True when the question was put to an operator. */
  readonly asked: boolean;
  /** What every part came to, or null when the step did not run. */
  readonly report: BoardSetupReport | null;
  /** A sentence per reading that failed without stopping the step. */
  readonly warnings: readonly string[];
}

/** What {@link runBoardStep} is asked. */
export interface BoardStepOptions {
  /** True for `--board`, false for `--no-board`, null when the line said neither. */
  readonly wanted: boolean | null;
  /** The provider the repository resolves to; anything but `gh` has no board. */
  readonly provider: PrProvider;
  /** The project root: where the template and the config are written. */
  readonly root: string;
  /** Opens the runner every `gh` command goes through. Called only when there is something to send. */
  readonly openGh: () => GhRunner;
  /** True when a question can be answered. */
  readonly isTerminal: () => boolean;
  /** Opens the prompter the question is asked through. Called only to ask. */
  readonly openPrompter: () => Prompter;
  /** Where the shipped spec template is looked for; `src/board/setup.ts`'s own when left out. */
  readonly moduleDir?: string | undefined;
}

/** A step that did not run, carrying `warnings`. */
function noRun(status: BoardStepStatus, warnings: readonly string[] = []): BoardStepResult {
  return { status, asked: false, report: null, warnings: Object.freeze([...warnings]) };
}

/** What a line asking for `--board` on a repository with no GitHub board is told. */
export function notGitHubWarning(provider: PrProvider): string {
  return `--board sets up a GitHub board, and this repository resolves to pr.provider: ${provider},`
    + ' so no board was set up. Set pr.provider: gh in .rafa/config.yaml when origin is a GitHub'
    + ` repository, then run ${BOARD_FIX}.`;
}

/** What a failed or unreadable `gh repo view` is reported as. */
export function visibilityWarning(problem: string): string {
  return 'the repository\'s visibility could not be read, so the question did not say whether issue'
    + ` bodies are public: ${problem}`;
}

/** Whether a repository is public, or the problem that kept it from being read. */
export interface VisibilityReading {
  /** True for a public repository, false for any other visibility, null when it could not be read. */
  readonly isPublic: boolean | null;
  /** Why it could not be read, or null when it was. */
  readonly problem: string | null;
}

/**
 * The repository's visibility, read with one
 * `gh repo view --json visibility`. Never throws: a failed command and a
 * shape this does not read are both a {@link VisibilityReading} carrying
 * the problem, since the visibility only words a question.
 */
export async function readVisibility(gh: GhRunner): Promise<VisibilityReading> {
  const command = 'gh repo view --json visibility';
  const result = await gh(['repo', 'view', '--json', 'visibility']);
  if (!result.ok) {
    const written = result.stderr.trim() || result.stdout.trim();
    return { isPublic: null, problem: `${command} failed: ${written || 'it wrote nothing'}` };
  }

  let payload: unknown;
  try {
    payload = JSON.parse(result.stdout) as unknown;
  } catch (error) {
    return { isPublic: null, problem: `${command} wrote output that is not JSON: ${messageOf(error)}` };
  }
  const visibility = isMapping(payload)
    ? payload['visibility']
    : null;
  if (typeof visibility !== 'string') {
    return {
      isPublic: null,
      problem: `${command} answered visibility as ${describeValue(visibility)}, expected a string`,
    };
  }
  return { isPublic: visibility.trim().toLowerCase() === 'public', problem: null };
}

/**
 * Asks the question, the public-repository line above it when `isPublic`.
 * True only for `y` or `yes`, however it is cased; an input that ended is
 * a no.
 */
export async function askBoard(prompter: Prompter, isPublic: boolean): Promise<boolean> {
  if (isPublic) prompter.say(PUBLIC_REPO_LINE);
  const answer = await prompter.ask(BOARD_QUESTION);
  return answer !== null && YES_ANSWERS.includes(answer.trim().toLowerCase());
}

/** Whether an operator wants the board, and what reading it cost; see the module note. */
async function answered(
  gh: GhRunner,
  openPrompter: () => Prompter,
): Promise<{ yes: boolean; warnings: readonly string[] }> {
  const visibility = await readVisibility(gh);
  const warnings = visibility.problem === null
    ? []
    : [visibilityWarning(visibility.problem)];

  const prompter = openPrompter();
  try {
    return { yes: await askBoard(prompter, visibility.isPublic === true), warnings };
  } finally {
    prompter.close();
  }
}

/**
 * Sets up the board, having decided whether to and asked when nobody
 * said; see the module note for the order those are decided in. Never
 * throws for a `gh` command that failed or a path that would not take a
 * write: {@link setUpBoard} reports those as refused parts.
 */
export async function runBoardStep(options: BoardStepOptions): Promise<BoardStepResult> {
  const { wanted, provider, root, openGh, isTerminal, openPrompter, moduleDir } = options;
  if (wanted === false) return noRun('declined');
  if (provider !== 'gh') {
    return noRun('not-github', wanted === true
      ? [notGitHubWarning(provider)]
      : []);
  }
  if (wanted === null && !isTerminal()) return noRun('unanswered');

  const gh = openGh();
  let asked = false;
  let warnings: readonly string[] = [];
  if (wanted === null) {
    const reading = await answered(gh, openPrompter);
    asked = true;
    warnings = reading.warnings;
    if (!reading.yes) {
      return { status: 'declined', asked: true, report: null, warnings: Object.freeze([...warnings]) };
    }
  }

  const report = await setUpBoard({ gh, root, moduleDir });
  return {
    status: 'ran',
    asked,
    report,
    warnings: Object.freeze([...warnings, ...report.problems]),
  };
}

/** True when the step wrote anything: a part it created. */
export function boardStepChanged(result: BoardStepResult): boolean {
  return result.report !== null && boardChanged(result.report);
}

/** The heading the part rows sit under. */
export const BOARD_HEADING = 'GitHub board:';

/** How wide an outcome column is: `created`, `present` and `refused` are each seven. */
const OUTCOME_WIDTH = 7;

/** A part as a row names it: a label under `label <name>`, anything else under its own name. */
function rowName(part: BoardPart): string {
  return part.kind === 'label'
    ? `label ${part.name}`
    : part.name;
}

/**
 * True when a row says more than its outcome. A part already present
 * says nothing more — "present" is the whole of what happened to it —
 * and neither does a label this run made, whose detail is the
 * description in {@link BOARD_LABELS} and so is a constant of this
 * build rather than news about the repository. Everything else carries
 * it: the issue number that was opened, the path the template came
 * from, and every reason a part was refused, a label's included.
 */
function carriesDetail(part: BoardPart): boolean {
  if (part.outcome === 'present') return false;
  return !(part.kind === 'label' && part.outcome === 'created');
}

/** One part as a row, with its detail when {@link carriesDetail} says so. */
export function boardPartLine(part: BoardPart): string {
  const outcome = part.outcome.padEnd(OUTCOME_WIDTH, ' ');
  const row = `  ${outcome}  ${rowName(part)}`;
  return carriesDetail(part)
    ? `${row}: ${part.detail}`
    : row;
}

/** The lines text mode writes for the step, and none when it has nothing to say. */
export function renderBoardStep(result: BoardStepResult): readonly string[] {
  if (result.report !== null) {
    return [BOARD_HEADING, ...result.report.parts.map((part) => boardPartLine(part))];
  }
  if (result.status === 'declined') return [`The GitHub board was left alone; run ${BOARD_FIX} to set it up.`];
  if (result.status === 'unanswered') {
    return [`The GitHub board step needs a terminal; run ${BOARD_FIX} to set it up.`];
  }
  return [];
}
