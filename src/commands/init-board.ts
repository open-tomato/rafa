/**
 * The board step `rafa init` ends with: whether to run it at all, the
 * one question it asks, and the lines it prints for what
 * {@link setUpBoard} came to; then the optional epic guard workflow,
 * with a question of its own.
 *
 * `src/board/setup.ts` makes the board — the twelve labels, the spec issue
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
 * ## The epic guard, asked after the board
 *
 * Once the board has run, {@link runEpicGuardStep} decides whether to
 * write the optional workflow `src/board/epic-guard.ts` ships, which
 * removes a second `epic:` label from an issue as it lands. It has its
 * own question because it is a file in the repository's workflows and
 * not part of the board: a board without it is read exactly as before.
 * The first answer wins:
 *
 *   - The board step did not run: nothing is asked or written, and a
 *     line that said `--epic-guard` is told so through the warnings.
 *   - `board.relationships: native`: nothing is read, asked or written,
 *     and a line that said `--epic-guard` is refused with
 *     {@link EPIC_GUARD_NATIVE_REFUSAL}, which names the mode. The guard
 *     removes a second `epic:` label, and in native mode an epic is the
 *     issue's sub-issue parent, which the tracker keeps to one. The
 *     refusal is a warning and not an exit code for the reason
 *     `--board` on a non-GitHub repository is one: the project has been
 *     set up by then, and a failing exit would read as if it had not.
 *   - `--no-epic-guard`: declined, nothing read.
 *   - Something is already at `.github/workflows/epic-guard.yml`: it is
 *     reported, `present` for a file and `refused` for anything else,
 *     and nothing is asked — there is nothing left to decide.
 *   - `--epic-guard`: written, asking nothing.
 *   - No terminal: not asked and not written, and the line naming
 *     `rafa init --board --epic-guard` is printed.
 *   - Otherwise its own `[y/N]` question, read as the board's is.
 *
 * `--board` answers the board's question only, so a terminal is still
 * asked about the guard under it; a script says `--epic-guard` or
 * `--no-epic-guard`.
 *
 * ## The relationships move, asked last
 *
 * When a config layer sets `board.relationships`,
 * {@link runRelationsMoveStep} moves the relationships the board holds in
 * the OTHER mode into the one the key names
 * (`src/board/relations/move.ts` plans and sends; this is where the
 * printing and the questions live). The first answer wins:
 *
 *   - The key is left at its default: the step answers null, reads,
 *     asks and prints nothing, and `init` leaves `relationsMove` out of
 *     its result, so a project that never set the key sees no change.
 *   - The board step did not run: nothing is read or asked.
 *   - The board is read ONCE, in the `native` listing fields, which carry
 *     the `labels` ones too, with one `gh repo view --json nameWithOwner`
 *     after it for the `native` side; a read that failed is a warning
 *     naming `rafa init --board`, and nothing is planned.
 *   - Nothing to write and no old mark left: one line says so, nothing
 *     is asked. This is what a second run of a finished move reads.
 *   - No terminal: nothing is written, and the line naming
 *     `rafa init --board` is printed. There is no flag that answers for
 *     a script: a move writes to every epic on the board, so it is typed.
 *   - Otherwise every planned write is printed on the prompter, with
 *     every relationship the plan skips, and ONE `[y/N]` question asks
 *     whether to send them. Anything but yes writes nothing. On a yes
 *     the writes go out in order, stopping at the first the board
 *     refuses, which is a warning naming what went through and what was
 *     left. Once every write went through, and only then, the old marks
 *     are printed and a second `[y/N]` question asks whether to remove
 *     them; on anything but yes they are kept and `rafa doctor` names
 *     them. A plan with no write left but old marks still on the board
 *     skips the first question and asks the second.
 *
 * A relationship write moves no `updated_at`, so the rows the move
 * touched are dropped from a kept `native` listing (`invalidateRows`,
 * `src/board/board-cache.ts`); a `labels` cache is left as it is.
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
import type { RelationsMoveFailure, RelationsMovePlan, RelationsMoveResult } from '../board/relations/move.js';
import type { BoardPart, BoardSetupReport } from '../board/setup.js';
import type { Prompter } from '../cli/prompt/confirm.js';
import type { BoardRelationshipMode, PrProvider } from '../config-sections.js';

import { join } from 'node:path';

import { invalidateRows } from '../board/board-cache.js';
import { EPIC_GUARD_PATH, writeEpicGuard } from '../board/epic-guard.js';
import { LABELS_READS } from '../board/relations/labels.js';
import { planRelationsMove, writeRelationsMove } from '../board/relations/move.js';
import { createNativeRelations } from '../board/relations/native.js';
import { createGhBoardListing } from '../board/roadmap-board.js';
import { anythingAt, boardChanged, setUpBoard } from '../board/setup.js';
import { describeValue, isMapping, messageOf } from '../config-sections.js';

import { readBoardRepository } from './epic/move-native.js';

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

/** The epic guard's own question, asked after the board has run. */
export const EPIC_GUARD_QUESTION = 'Install the epic guard workflow, which removes a second epic: label from an issue? [y/N] ';

/** What a run that did not install the epic guard names as the way to install it. */
export const EPIC_GUARD_FIX = 'rafa init --board --epic-guard';

/** What the epic guard step came to. */
export type EpicGuardStatus =
  /** The workflow was written, or found, or refused: `part` says which. */
  | 'ran'
  /** `--no-epic-guard`, or its question answered with anything but yes. */
  | 'declined'
  /** Nobody said and there was no terminal to ask on. */
  | 'unasked'
  /** The board step did not run, so neither did this one. */
  | 'not-run'
  /** `board.relationships` is `native`, where the tracker keeps one parent per issue. */
  | 'native';

/** What one run of {@link runEpicGuardStep} came to. */
export interface EpicGuardStepResult {
  readonly status: EpicGuardStatus;
  /** True when its question was put to an operator. */
  readonly asked: boolean;
  /** What the workflow file came to, or null when the step wrote nothing and found nothing. */
  readonly part: BoardPart | null;
  /** A sentence per flag the step could not act on. */
  readonly warnings: readonly string[];
}

/** What {@link runEpicGuardStep} is asked. */
export interface EpicGuardStepOptions {
  /** True for `--epic-guard`, false for `--no-epic-guard`, null when the line said neither. */
  readonly wanted: boolean | null;
  /** What the board step came to; the guard runs only after a board that ran. */
  readonly board: BoardStepResult;
  /** The project's `board.relationships`; the guard runs in `labels` mode only. */
  readonly relationships: BoardRelationshipMode;
  /** The project root: where the workflow is written. */
  readonly root: string;
  /** True when a question can be answered. */
  readonly isTerminal: () => boolean;
  /** Opens the prompter the question is asked through. Called only to ask. */
  readonly openPrompter: () => Prompter;
  /** Where the shipped workflow is looked for; `src/board/epic-guard.ts`'s own when left out. */
  readonly moduleDir?: string | undefined;
}

/** What a line asking for `--epic-guard` is told when the board step did not run. */
export const EPIC_GUARD_NO_BOARD_WARNING = '--epic-guard installs the epic guard workflow with the GitHub board,'
  + ` and the board step did not run, so it was not installed; run ${EPIC_GUARD_FIX}.`;

/** What a line asking for `--epic-guard` is told under `board.relationships: native`. */
export const EPIC_GUARD_NATIVE_REFUSAL = 'board.relationships is native: --epic-guard was refused, since the'
  + ' tracker keeps one parent per issue and there is no second epic: label for the workflow to remove,'
  + ' so it was not installed.';

/** A guard step that wrote nothing and found nothing. */
function noGuard(status: EpicGuardStatus, asked: boolean, warnings: readonly string[] = []): EpicGuardStepResult {
  return { status, asked, part: null, warnings: Object.freeze([...warnings]) };
}

/** Asks the guard's question; true only for `y` or `yes`, and the prompter closed either way. */
async function askEpicGuard(openPrompter: () => Prompter): Promise<boolean> {
  const prompter = openPrompter();
  try {
    const answer = await prompter.ask(EPIC_GUARD_QUESTION);
    return answer !== null && YES_ANSWERS.includes(answer.trim().toLowerCase());
  } finally {
    prompter.close();
  }
}

/**
 * Writes the epic guard workflow, having decided whether to and asked
 * when nobody said; see the module note for the order. Never throws for
 * a path that would not take a write: that is a refused part.
 */
export async function runEpicGuardStep(options: EpicGuardStepOptions): Promise<EpicGuardStepResult> {
  const { wanted, board, relationships, root, isTerminal, openPrompter, moduleDir } = options;
  if (board.status !== 'ran') {
    return noGuard('not-run', false, wanted === true
      ? [EPIC_GUARD_NO_BOARD_WARNING]
      : []);
  }
  if (relationships === 'native') {
    return noGuard('native', false, wanted === true
      ? [EPIC_GUARD_NATIVE_REFUSAL]
      : []);
  }
  if (wanted === false) return noGuard('declined', false);

  const write = (asked: boolean): EpicGuardStepResult => ({
    status: 'ran',
    asked,
    part: writeEpicGuard(root, moduleDir),
    warnings: [],
  });
  if (anythingAt(join(root, EPIC_GUARD_PATH))) return write(false);
  if (wanted === true) return write(false);
  if (!isTerminal()) return noGuard('unasked', false);
  return await askEpicGuard(openPrompter)
    ? write(true)
    : noGuard('declined', true);
}

/** True when the guard step wrote the workflow. */
export function epicGuardChanged(result: EpicGuardStepResult): boolean {
  return result.part?.outcome === 'created';
}

/** The lines text mode writes for the guard step, and none when it has nothing to say. */
export function renderEpicGuardStep(result: EpicGuardStepResult): readonly string[] {
  if (result.part !== null) return [boardPartLine(result.part)];
  if (result.status === 'declined') return [`The epic guard workflow was left out; run ${EPIC_GUARD_FIX} to install it.`];
  if (result.status === 'unasked') {
    return [`The epic guard question needs a terminal; run ${EPIC_GUARD_FIX} to install it.`];
  }
  return [];
}

/** What a run that did not move the board's relationships names as the way to move them. */
export const MOVE_FIX = 'rafa init --board';

/** What the relationships move came to. */
export type RelationsMoveStatus =
  /** The plan was sent: `move` says what the board took, what was left and what came of the old marks. */
  | 'moved'
  /** The board holds every relationship in the configured mode already, and no old mark is left. */
  | 'nothing'
  /** The first question was answered with anything but yes: nothing was written. */
  | 'declined'
  /** There was something to move and no terminal to ask on. */
  | 'unasked'
  /** The listing or the repository could not be read, so nothing was planned. */
  | 'unread'
  /** The board step did not run, so neither did this one. */
  | 'not-run';

/** What one run of {@link runRelationsMoveStep} came to. */
export interface RelationsMoveStepResult {
  readonly status: RelationsMoveStatus;
  /** The mode moved from: the one `board.relationships` does not name. */
  readonly from: BoardRelationshipMode;
  /** The mode moved to: the one `board.relationships` names. */
  readonly to: BoardRelationshipMode;
  /** True when the first question, whether to send the writes, was put to an operator. */
  readonly asked: boolean;
  /** The planned move, or null when nothing was read. */
  readonly plan: RelationsMovePlan | null;
  /** What sending it came to, or null when nothing was sent. */
  readonly move: RelationsMoveResult | null;
  /** A sentence per reading or write that failed without stopping `init`. */
  readonly warnings: readonly string[];
}

/** What {@link runRelationsMoveStep} is asked. */
export interface RelationsMoveStepOptions {
  /** What the board step came to; the move runs only after a board that ran. */
  readonly board: BoardStepResult;
  /** `board.relationships` when a config layer sets it, null when it is left at its default. */
  readonly relationships: BoardRelationshipMode | null;
  /** The project root: where a kept `native` listing drops the rows the move touched. */
  readonly root: string;
  /** Opens the runner every `gh` command goes through. Called only once the board ran. */
  readonly openGh: () => GhRunner;
  /** True when a question can be answered. */
  readonly isTerminal: () => boolean;
  /** Opens the prompter the writes are printed on and the questions asked through. Called only to ask. */
  readonly openPrompter: () => Prompter;
}

/** The mode a board is moved out of when `to` is configured. */
function otherMode(to: BoardRelationshipMode): BoardRelationshipMode {
  return to === 'native'
    ? 'labels'
    : 'native';
}

/** The first question: whether to send `plan`'s writes. */
export function moveQuestion(plan: RelationsMovePlan): string {
  const count = plan.writes.length;
  return `Send the ${String(count)} write${count === 1
    ? ''
    : 's'} above, moving the board from ${plan.from} to ${plan.to}? [y/N] `;
}

/** What a listing or repository read that failed is reported as. */
export function moveUnreadWarning(to: BoardRelationshipMode, problem: string): string {
  return `board.relationships is ${to}: the board could not be read for relationships to move, so nothing`
    + ` was moved: ${problem}; run ${MOVE_FIX} again.`;
}

/** What a move the board refused part way is reported as. */
export function moveFailureWarning(result: RelationsMoveResult, failure: RelationsMoveFailure): string {
  const left = result.left.length;
  return `the board refused "${failure.what}": ${failure.problem}. ${String(result.done.length)} write(s) went`
    + ` through and ${String(left)} did not, and the old marks were kept; every write is idempotent, so run`
    + ` ${MOVE_FIX} again to finish the move.`;
}

/** The lines printed above the first question: every write, then every relationship left where it is. */
function planLines(plan: RelationsMovePlan): readonly string[] {
  return [
    `Moving the board's relationships from ${plan.from} to ${plan.to}:`,
    ...plan.writes.map((write) => `  write    ${write.what}`),
    ...plan.skipped.map((skipped) => `  skipped  ${skipped.reason}`),
  ];
}

/** True for `y` or `yes`, however it is cased; an input that ended is a no. */
async function askYes(prompter: Prompter, question: string): Promise<boolean> {
  const answer = await prompter.ask(question);
  return answer !== null && YES_ANSWERS.includes(answer.trim().toLowerCase());
}

/** The listing in the `native` fields, and both sides of the move over it. */
async function readMove(gh: GhRunner, to: BoardRelationshipMode): Promise<RelationsMovePlan> {
  const listing = await createGhBoardListing({ gh, mode: 'native' })();
  const native = createNativeRelations({ gh, repository: await readBoardRepository(gh) });
  return to === 'native'
    ? planRelationsMove(listing, LABELS_READS, native)
    : planRelationsMove(listing, native, LABELS_READS);
}

/** Prints the plan, asks once, and sends it on a yes; the second question is asked through the same prompter. */
async function askAndSend(gh: GhRunner, plan: RelationsMovePlan, prompter: Prompter): Promise<Omit<RelationsMoveStepResult, 'from' | 'to' | 'warnings'>> {
  for (const line of planLines(plan)) prompter.say(line);
  const asked = plan.writes.length > 0;
  if (asked && !await askYes(prompter, moveQuestion(plan))) return { status: 'declined', asked, plan, move: null };
  const ask = async (question: string): Promise<boolean> => {
    for (const mark of plan.marks) prompter.say(`  mark     ${mark.what}`);
    return askYes(prompter, `${question} [y/N] `);
  };
  return { status: 'moved', asked, plan, move: await writeRelationsMove({ gh, ask }, plan) };
}

/**
 * Moves the board's relationships into the mode `board.relationships`
 * names, having printed every write and asked; see the module note for
 * the order that is decided in. Answers null, sending nothing, when the
 * key is left at its default. Never throws for the board: a read that
 * failed and a write it refused are warnings.
 */
export async function runRelationsMoveStep(options: RelationsMoveStepOptions): Promise<RelationsMoveStepResult | null> {
  const { board, relationships: to, root, openGh, isTerminal, openPrompter } = options;
  if (to === null) return null;
  const from = otherMode(to);
  const outcome = (rest: Omit<RelationsMoveStepResult, 'from' | 'to' | 'warnings'>, warnings: readonly string[] = []): RelationsMoveStepResult => Object.freeze({ ...rest, from, to, warnings: Object.freeze([...warnings]) });
  if (board.status !== 'ran') return outcome({ status: 'not-run', asked: false, plan: null, move: null });

  const gh = openGh();
  let plan: RelationsMovePlan;
  try {
    plan = await readMove(gh, to);
  } catch (error) {
    return outcome({ status: 'unread', asked: false, plan: null, move: null }, [moveUnreadWarning(to, messageOf(error))]);
  }
  if (plan.writes.length === 0 && plan.marks.length === 0) return outcome({ status: 'nothing', asked: false, plan, move: null });
  if (!isTerminal()) return outcome({ status: 'unasked', asked: false, plan, move: null });

  const prompter = openPrompter();
  let sent: Omit<RelationsMoveStepResult, 'from' | 'to' | 'warnings'>;
  try {
    sent = await askAndSend(gh, plan, prompter);
  } finally {
    prompter.close();
  }
  if (sent.move === null) return outcome(sent);
  invalidateRows(root, sent.move.touched);
  return outcome(sent, sent.move.failure === null
    ? []
    : [moveFailureWarning(sent.move, sent.move.failure)]);
}

/** True when the move wrote anything: a write the board took, or an old mark it removed. */
export function relationsMoveChanged(result: RelationsMoveStepResult | null): boolean {
  return result?.move != null && (result.move.done.length > 0 || result.move.removed.length > 0);
}

/** The rows of a sent move: what went through, what was left, and what came of each old mark. */
function movedLines(move: RelationsMoveResult): readonly string[] {
  return [
    ...move.done.map((write) => `  sent     ${write.what}`),
    ...move.left.map((write) => `  left     ${write.what}`),
    ...move.removed.map((mark) => `  removed  ${mark.what}`),
    ...move.kept.map((mark) => `  kept     ${mark.what}`),
  ];
}

/** The lines text mode writes for the move, and none when it has nothing to say. */
export function renderRelationsMoveStep(result: RelationsMoveStepResult | null): readonly string[] {
  if (result === null) return [];
  const { status, from, to, move, plan } = result;
  if (status === 'moved' && move !== null) {
    const kept = move.kept.length > 0 && move.failure === null
      ? [`The old ${from} marks were kept; rafa doctor names them, and ${MOVE_FIX} asks again.`]
      : [];
    return [`Board relationships, ${from} to ${to}:`, ...movedLines(move), ...kept];
  }
  if (status === 'nothing') return [`Board relationships: nothing to move from ${from} to ${to}.`];
  if (status === 'declined') return [`The board's ${from} relationships were left alone; run ${MOVE_FIX} to move them to ${to}.`];
  if (status === 'unasked') {
    const count = plan?.writes.length ?? 0;
    return [`Moving the board from ${from} to ${to} (${String(count)} write(s)) needs a terminal; run ${MOVE_FIX} to move it.`];
  }
  return [];
}
