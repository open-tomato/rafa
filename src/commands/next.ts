/**
 * `rafa next [--dry-run] [--roadmap] [--yes[=<action ids>]]`: where the project
 * stands in one line, the one thing to do about it in the next, the
 * question, the action, and then the same again for what follows.
 *
 * The modules under `src/next/` are the halves this one joins:
 * `state.ts` answers the ONE state the project is in with the action it
 * proposes and the two sentences it is said in, `readings.ts` is what
 * that table is read over and `sources.ts` composes those readings for
 * a real project, `actions.ts` maps an action id onto the registered
 * command that does it, `sync.ts` holds `sync`, an action that runs none,
 * `ceiling.ts` reads `--yes` as how far a run may go by itself, and
 * `hint.ts` words the question and the command line, which the six
 * commands that end by naming what follows say the same way, and
 * `lines.ts` words the two lines and the stop line and reads
 * `--dry-run`, and `settle-step.ts` answers the settle step read after a
 * merge. This module owns the loop, the action and the exit code,
 * and of the ten only `hint.ts` also prints — the one line it leaves a run that has
 * no terminal to be asked on.
 *
 * ## One turn of the chain
 *
 * Every turn reads the state AFRESH — nothing is carried over but the
 * state the last action ran for — and writes two lines:
 *
 * ```text
 * 📍 #41 is open on `feat/rafa-63`, green and merges into `main`.
 * 👉 merge #41 into `main` — rafa pr merge 41 --yes
 * Merge #41 into `main`? [y/N]
 * ```
 *
 * The first is {@link NextState.reading}, the second
 * {@link NextState.proposal} with the command the action runs after it,
 * and the question is the proposal itself, capitalised
 * ({@link nextQuestion}). Reading the state again rather than predicting
 * it is what lets each action's own writes — a merge that deleted both
 * branches, a plan that wrote a file — decide what comes next, and what
 * makes a state two rows would both take the table's business and never
 * this loop's.
 *
 * The words after the command are the ones that RUN, `--yes` included:
 * `rafa next` has already asked, so `pr merge`'s own question would be
 * the same decision asked twice (`src/next/actions.ts`). The line is
 * what happened, not a line to retype.
 *
 * ## The one question handed over
 *
 * One action is not asked about here at all: `merge-unchecked`, of
 * {@link QUESTION_HANDED_OVER}. It runs `pr merge <n> --skip-checks`
 * with no `--yes`, and that command reads the repository's workflow
 * count, prints the warning the count calls for and asks `Merge #<n>
 * with no checks? [y/N]` itself — the warning is what the answer has to
 * be given over, and `rafa next` never reads it. Asking here as well
 * would put the decision twice, the first time without the warning, so
 * the chain prints its two lines and runs the action with no question
 * of its own, and the step records `asked` as false: the question was
 * `pr merge`'s. A no there merges nothing and ends `pr merge` with exit
 * code 0, so the chain reads the same state back and stops `unchanged`.
 *
 * Before such an action runs, the chain calls
 * {@link NextChainOptions.handOver}, which in {@link runNext} closes
 * the prompter its own questions went through. Two line prompters open
 * on one standard input BOTH receive every line, and the one nobody is
 * asking buffers it: measured on bun 1.3.14 over a `PassThrough`, the
 * `y` typed for the inner prompter's question was the answer the outer
 * one gave to its NEXT question, which would be a step run on a yes
 * nobody typed for it. Closed first, the outer prompter is opened
 * afresh on the next question and reads only what is typed after it.
 *
 * `--yes` cannot reach it: a list naming `merge-unchecked` is refused
 * with exit code 2 (`src/next/ceiling.ts`), and a list that leaves it
 * out stops there `unasked`, where the stop line says to drop `--yes`
 * rather than to name an id no list may name — as it does for `ready`.
 *
 * ## The four ways it stops, and the four endings beside them
 *
 * The spec's four ({@link NextStop}): `declined`, the person said no;
 * `nothing-to-run`, the state carries no action, which is both
 * pre-conditions and the three rows that propose prose; `loop-started`,
 * an action started a loop, and what happens on that branch is the
 * loop's to report; and a FAILURE, which is no stop reason at all — the
 * `CommandExit` the action threw travels out of {@link runNextChain}
 * untouched, so the chain ends with that action's own message and its
 * own exit code and no line of this module's on top of it.
 *
 * Three of the four others keep the loop finite and honest:
 *
 *  - `dry-run`, the two lines and nothing else, which `--dry-run` asks
 *    for and which a run with no terminal and no `--yes` takes as well;
 *    {@link dryRunOf} is that reading and the module note below holds
 *    it.
 *  - `unchanged`, the state the last action ran for read back
 *    identically. An action can succeed and move nothing — a triage that
 *    assessed a pull request still red, an unblock over a blocker still
 *    open — and without this the same action would run forever.
 *  - `capped`, {@link MAX_ACTIONS} actions in one chain. `unchanged`
 *    catches the state that repeats at once and not a pair that
 *    alternates, so the cap is what makes termination a property of the
 *    code rather than of the actions.
 *
 * The fourth, `unasked`, belongs to `--yes` and is below.
 *
 * ## `--yes` is a risk ceiling
 *
 * Without it every action is asked about, `merge-unchecked` by the
 * command it runs rather than here. With it none of the ids it names
 * is: they may run unasked, and the chain STOPS at the first
 * action the list leaves out, with that action's proposal already
 * printed, so the person reads what is left to do and decides. That
 * stop is `unasked`, and it is the only one of the endings this module
 * reaches with a state it could have run. Its line names the list that
 * would allow the step, except for a step no list may name — `ready`
 * and `merge-unchecked` — where it says to drop `--yes` and be asked.
 *
 * Which ids a list may name — the ten, the five bare `--yes` allows,
 * and the two lists refused with exit code 2, one naming `ready` or
 * `merge-unchecked` and one naming a word that is no action id — is
 * `src/next/ceiling.ts`, read here through {@link readYesCeiling}
 * before any source is opened and asked through {@link allowedUnasked}
 * once a state has answered.
 *
 * ## Without a terminal it behaves as `--dry-run`
 *
 * The question is read from standard input, so a run whose standard
 * input is no TTY — a session, a loop task, a pipe, a CI step — could
 * never be answered. Rather than wait on an answer nobody types, or
 * take the empty answer as a no and call that a decision, such a run
 * prints the two lines and stops: {@link dryRunOf} answers
 * `no-terminal` where the flag is absent, `--yes` named no ceiling and
 * {@link NextCommandSeams.isTerminal} is false, and the chain ends the
 * same way `--dry-run` ends it, with exit code 0 and a stop line that
 * says which of the two it was.
 *
 * `--yes` is the other half: a run that names a ceiling asks nothing at
 * all — every step is either allowed unasked or stops the chain — so it
 * needs no terminal and keeps running without one. That is what makes
 * `rafa next --yes=sync,plan` usable from a loop task while a bare
 * `rafa next` there reports and touches nothing.
 *
 * A terminal is a standard input that is a TTY, since that is where an
 * answer is read from: measured on bun 1.3.14, a piped standard input
 * answers `isTTY` as undefined.
 *
 * ## What it asks through, and what it never spawns
 *
 * The question goes through the line prompter `rafa init` and `pr merge`
 * read an answer with, on stderr, so a json-mode stdout stays NDJSON;
 * it is opened on the first question and closed when the chain ends, so
 * a chain that asks nothing opens none. An answer that is not `y` or
 * `yes` declines, the empty answer and an input that ended included: the
 * question is spelled `[y/N]`.
 *
 * Nothing here spawns a shell line. Every action is a registered command
 * called as its own function, the three in-process actions excepted:
 * fast-forwarding the base is no command, and `sync` runs through the
 * git seam (`src/next/sync.ts`), while `hop` and `home`, which only the
 * hop rows propose, write the hop record and the position in-process
 * and move through the registered `switch` (`src/next/hop-action.ts`).
 * So each action keeps its own refusals, and {@link NextCommandSeams} is
 * the whole of what a test replaces.
 *
 * An action writes through {@link actionOutput} (`src/next/ending.ts`),
 * which is the caller's output with its `result` taken: an invocation
 * gives ONE result, and the chain's is the report.
 *
 * ## The end of an epic
 *
 * A chain that ends at `nothing-left` because the walk ran dry inside an
 * epic — every line done or taken, the epic not done — ends with the
 * lines `src/next/epic-end.ts` renders, after its own and after any stop
 * line: `rafa epic close <n>` as the next step, `rafa roadmap` to list
 * the board's epics, and `rafa release tag` where a version the
 * changelog calls released carries no tag. Each is printed, never run.
 * The dry epic is the one the LAST turn's walk answered, remembered by
 * a watch over that turn's board rather than walked again, so the
 * listing is read once; and the changelog and the tags are read only
 * once an epic ran dry, so a project with no epic sends no command more
 * and prints the same bytes. A release reading that failed is written
 * as a warning and leaves its line out.
 *
 * ## Under `--roadmap`
 *
 * The flag is read here and changes four things, each left exactly as
 * it was without it:
 *
 *  - the sources are opened with `roadmap` (`openNextSources`), so the
 *    table reads its hop rows (`src/next/hop-rows.ts`) and the board its
 *    hop reading, and nothing else sends a command more;
 *  - `plan`, `start` and `resume` carry `--roadmap` among the words they
 *    run with (`src/next/actions.ts`), and the proposal line prints it;
 *  - once a loop action has run, {@link NextChainRoadmap.afterLoop} reads
 *    the board again and, while a hop is away, answers the `home` step,
 *    which is put as one more turn — two lines, the question or the
 *    ceiling, then the action — BEFORE the chain stops `loop-started`.
 *    The loop leaves the checkout on the target's branch, where no board
 *    row is read, which is why this step is read here rather than by
 *    the table. A `home` the person declines, or a `--yes` list that
 *    leaves it out, stops the chain there instead, `declined` or
 *    `unasked`, with the position still away; a walk that fails is
 *    warned about and the chain stops `loop-started`, away, so the next
 *    run reads the hop again. A loop action ends the chain before the
 *    cap is weighed, so a chain whose last allowed action started a loop
 *    may run one more, to come home;
 *  - the report carries {@link NextChainReport.hops}, what each `hop`
 *    and `home` action that ran wrote, and the stop lines name `hop` and
 *    `home` in the lists they print (`src/next/lines.ts`).
 *
 * ## After a merge: the settle step
 *
 * Once a `merge` or `merge-unchecked` action has run,
 * {@link NextChainOptions.afterMerge} reads the fragments waiting on the
 * base (`src/next/settle-step.ts`, over the settle dry run `pr merge`'s
 * own follow-up is decided by) and, while they fold into a version,
 * puts the `settle` step as one more turn — two lines, then the question
 * or the ceiling, then `rafa release settle`. It is asked like `merge`:
 * bare `--yes` leaves it out, since it commits a release and pushes it
 * to the base, so it runs unasked only under a list naming `settle`. A
 * no stops the chain `declined` and a list that leaves it out `unasked`,
 * with the fragments still waiting for `rafa release settle` by hand;
 * a settle that fails ends the chain with its own exit code. Otherwise
 * the chain reads again, and `previous` stays the merge's state, so a
 * merge that moved nothing still stops `unchanged` on the next turn
 * rather than being proposed again after the settle. The step is read
 * after a merge alone: fragments a merge through the button left
 * waiting are the doctor warning's to report.
 *
 * ## The exit code
 *
 * 0 for every ending above, a pre-condition included: `rafa next` is a
 * guide, and a chain the person stopped is not a command that failed. 1
 * for a line it refuses and for a `sync` that would not fast-forward, 2
 * for a `--yes` list `src/next/ceiling.ts` refuses and for a repository
 * whose `pr.provider` is not `gh`, and whatever an action threw for an
 * action that failed.
 */
import type { RafaCommand, RafaContext, RafaFlagSpec } from '../cli/command.js';
import type { Prompter } from '../cli/prompt/confirm.js';
import type { NextInvocation } from '../next/actions.js';
import type { NextCeiling } from '../next/ceiling.js';
import type { NextHopStep } from '../next/hop-rows.js';
import type { NextDryRun, NextStop } from '../next/lines.js';
import type { DryEpic, NextSources } from '../next/readings.js';
import type { NextSourceSeams, OpenedNextSources } from '../next/sources.js';
import type { NextActionId, NextAnswerId, NextState } from '../next/state.js';

import { CommandExit } from '../cli/command.js';
import { createLinePrompter } from '../cli/prompt/confirm.js';
import { messageOf } from '../config-sections.js';
import { actionInvocation, runAction } from '../next/actions.js';
import { ALWAYS_ASKED, allowedUnasked, BARE_YES_ACTIONS, readYesCeiling, YES_ACTIONS, YES_FLAG } from '../next/ceiling.js';
import { actionOutput } from '../next/ending.js';
import { epicEndLines, watchDryEpic } from '../next/epic-end.js';
import { commandWords, nextQuestion } from '../next/hint.js';
import {
  DRY_RUN_FLAG,
  dryRunOf,
  MAX_ACTIONS,
  NEXT_USAGE,
  proposalLine,
  readDryRun,
  readRoadmap,
  ROADMAP_FLAG,
  stateLine,
  stopLine,
} from '../next/lines.js';
import { followsMerge, readSettleAfterMerge } from '../next/settle-step.js';
import { openNextSources } from '../next/sources.js';
import { readHomeAfterLoop, readNextState } from '../next/state.js';
import { fastForwardBase } from '../next/sync.js';
import { REMOTE } from '../start/branch-decision.js';

import { lazyPrompter } from './issue/ready.js';
import { expectNoArgument } from './plan/plan-files.js';

/** The actions that hand the checkout to a loop, after which the chain stops. */
const LOOP_ACTIONS: readonly NextActionId[] = Object.freeze(['start', 'resume']);

/**
 * The actions whose question the command they run puts itself, so the
 * chain asks none of its own before them; see the module note.
 */
export const QUESTION_HANDED_OVER: ReadonlySet<NextActionId> = new Set<NextActionId>(['merge-unchecked']);

/** Puts one question and answers whether it was said yes to. */
export type NextAsk = (question: string) => Promise<boolean>;

/** What one state the chain read came to. */
export interface NextStep {
  /** The row of the table, or the pre-condition, that answered. */
  readonly state: NextAnswerId;
  /** The action it proposed. */
  readonly action: NextActionId;
  /** What ran or would have, as a person types it after `rafa`, or null for an action that runs no command. */
  readonly command: string | null;
  /** Whether `rafa next` put its question; false for an action of {@link QUESTION_HANDED_OVER}, which asks its own. */
  readonly asked: boolean;
  /** Whether the action ran. */
  readonly ran: boolean;
}

/** What one chain came to. */
export interface NextChainReport {
  /** One per state read, in order; the last is the state that stopped it. */
  readonly steps: readonly NextStep[];
  /** Why it stopped. */
  readonly stop: NextStop;
  /**
   * Under `--roadmap`, what each `hop` and `home` action that ran wrote,
   * in order: the record a hop opened, and the closing it came home on.
   * Empty where none ran. The key is LEFT OUT, not set to undefined,
   * without `--roadmap`.
   */
  readonly hops?: readonly NextHopStep[];
}

/** What {@link NextChainOptions.roadmap} holds: what a `rafa next --roadmap` chain reads beside the rest. */
export interface NextChainRoadmap {
  /**
   * The `home` step to run once a loop action has run while a hop is
   * away, or null when none is; see the module note's "Under
   * `--roadmap`".
   */
  readonly afterLoop: () => Promise<NextState | null>;
}

/** What {@link runNextChain} reads, runs, asks and writes through. */
export interface NextChainOptions {
  /** Reads the state afresh, which every turn does. */
  readonly read: () => Promise<NextState>;
  /** Runs one state's action. Whatever it throws travels out of the chain. */
  readonly run: (state: NextState) => Promise<void>;
  /** Puts one question and answers whether it was said yes to. */
  readonly ask: NextAsk;
  /**
   * Called before an action of {@link QUESTION_HANDED_OVER} runs, so
   * nothing `ask` reads through is left open to take the answer typed
   * for that action's own question. Left out, nothing is called.
   */
  readonly handOver?: () => void;
  /** The action ids that may run unasked, as `--yes` named them, or null when every one is asked about. */
  readonly ceiling: NextCeiling;
  /** Why the run prints the two lines and no question, or null for a run that acts. */
  readonly dryRun: NextDryRun | null;
  /** Where the lines go. */
  readonly info: (line: string) => void;
  /** Where a reading that failed goes. */
  readonly warn: (line: string) => void;
  /**
   * The settle step to put after a `merge` or `merge-unchecked` action
   * has run, or null where no fragment waits to fold; see the module
   * note's "After a merge". Left out, no step is read.
   */
  readonly afterMerge?: () => NextState | null;
  /**
   * Set by `rafa next --roadmap`: the actions' words carry `--roadmap`,
   * the stop lines name `hop` and `home`, the home step runs after a loop
   * while a hop is away, and the report carries `hops`. Left out, none of
   * the four happens.
   */
  readonly roadmap?: NextChainRoadmap;
}

/** How one turn ended: at a stop, with the step that stopped it, or with its action run. */
type TurnEnd =
  | { readonly stop: NextStop; readonly step: NextStep }
  | { readonly stop: null; readonly step: NextStep };

function repeats(previous: NextState | null, state: NextState): boolean {
  if (previous === null) return false;
  return previous.id === state.id
    && previous.action === state.action
    && previous.pullRequest === state.pullRequest
    && previous.issue === state.issue
    && previous.planStub === state.planStub;
}

/** One step of a chain, as the report holds it. */
function stepOf(state: NextState, invocation: NextInvocation | null, over: Partial<NextStep> = {}): NextStep {
  return Object.freeze({
    state: state.id,
    action: state.action,
    command: invocation === null
      ? null
      : commandWords(invocation),
    asked: false,
    ran: false,
    ...over,
  });
}

/**
 * One turn over `state`: its problems and its two lines written, then
 * each ending the module note holds checked in order, the question put
 * where one is, and the action run. `previous` is the state the last
 * action ran for, or null where none is to be compared.
 */
async function playTurn(options: NextChainOptions, state: NextState, previous: NextState | null): Promise<TurnEnd> {
  const { run, ask, handOver, ceiling, dryRun, info, warn, roadmap } = options;
  for (const problem of state.problems) warn(problem);
  const invocation = actionInvocation(state, { roadmap: roadmap !== undefined });
  info(stateLine(state));
  info(proposalLine(state, invocation));

  const halt = (stop: NextStop, over: Partial<NextStep> = {}): TurnEnd => ({ stop, step: stepOf(state, invocation, over) });
  if (dryRun !== null) return halt('dry-run');
  if (state.action === 'none') return halt('nothing-to-run');
  if (repeats(previous, state)) return halt('unchanged');

  const unasked = allowedUnasked(state.action, ceiling);
  if (!unasked && ceiling !== null) return halt('unasked');
  const handedOver = QUESTION_HANDED_OVER.has(state.action);
  const asks = !unasked && !handedOver;
  if (asks && !await ask(nextQuestion(state))) return halt('declined', { asked: true });

  if (handedOver) handOver?.();
  await run(state);
  return { stop: null, step: stepOf(state, invocation, { asked: asks, ran: true }) };
}

/**
 * Reads the state, proposes the one action it carries, runs it once it
 * is allowed, and reads again, until one of the endings the module note
 * holds. Whatever an action throws travels out unchanged.
 */
export async function runNextChain(options: NextChainOptions): Promise<NextChainReport> {
  const { read, ceiling, dryRun, info, roadmap } = options;
  let steps: readonly NextStep[] = [];
  let hops: readonly NextHopStep[] = [];
  let previous: NextState | null = null;

  /** The report, `hops` carried only under `--roadmap`. */
  const report = (stop: NextStop): NextChainReport => Object.freeze({
    steps: Object.freeze([...steps]),
    stop,
    ...roadmap === undefined
      ? {}
      : { hops: Object.freeze([...hops]) },
  });
  /** Says why the chain stopped, for an ending the two lines have not already said, and reports it. */
  const stopOn = (stop: NextStop, state: NextState): NextChainReport => {
    const line = stopLine(stop, state, ceiling, dryRun, roadmap !== undefined);
    if (line !== null) info(line);
    return report(stop);
  };
  /** Plays one turn over `state` and keeps what it came to; the stop, or null for an action run. */
  const turn = async (state: NextState, before: NextState | null): Promise<NextStop | null> => {
    const end = await playTurn(options, state, before);
    steps = [...steps, end.step];
    if (end.stop === null && state.hop !== undefined) hops = [...hops, state.hop];
    return end.stop;
  };

  for (;;) {
    const state = await read();
    const stop = await turn(state, previous);
    if (stop !== null) return stopOn(stop, state);

    if (LOOP_ACTIONS.includes(state.action)) {
      const home = roadmap === undefined
        ? null
        : await roadmap.afterLoop();
      const homeStop = home === null
        ? null
        : await turn(home, null);
      return homeStop === null
        ? stopOn('loop-started', state)
        : stopOn(homeStop, home ?? state);
    }
    const settle = followsMerge(state.action)
      ? options.afterMerge?.() ?? null
      : null;
    const settleStop = settle === null
      ? null
      : await turn(settle, null);
    if (settleStop !== null) return stopOn(settleStop, settle ?? state);
    if (steps.length >= MAX_ACTIONS) return stopOn('capped', state);
    previous = state;
  }
}
/** How the command reaches the sources and the terminal; each left out is the system's own. */
export interface NextCommandSeams extends NextSourceSeams {
  /** True when a question can be answered. `process.stdin.isTTY` when left out. */
  readonly isTerminal?: () => boolean;
  /** Opens the prompter the questions are asked through. Called only to ask. */
  readonly openPrompter?: () => Prompter;
}

/** The seams the registered command runs with: the system's own, every one. */
export const DEFAULT_NEXT_SEAMS: NextCommandSeams = Object.freeze({});

/**
 * Runs one state's action: the registered command it names, `hop` and
 * `home` in-process through `runAction` as well, or, for `sync`, the
 * fast-forward through the git seam, whose refusal is this command's own
 * exit 1 and whose words git wrote are printed as they are.
 */
async function runStateAction(context: RafaContext, sources: NextSources, state: NextState): Promise<void> {
  if (state.action !== 'sync') {
    await runAction({ ...context, output: actionOutput(context.output) }, state, { roadmap: sources.roadmap !== undefined });
    return;
  }

  const outcome = fastForwardBase(sources.git, { base: sources.base, remote: sources.remote ?? REMOTE });
  if (outcome.kind === 'refused') throw new CommandExit(1, outcome.message);
  if (outcome.said !== '') context.output.info(outcome.said);
}

/**
 * The end-of-epic lines, written after a chain that ended at
 * `nothing-left` whose last walk ran dry inside `epic`; nothing, and no
 * reading, otherwise. See the module note.
 */
function endOfEpic(context: RafaContext, sources: OpenedNextSources, report: NextChainReport, epic: DryEpic | null): void {
  if (epic === null || report.steps.at(-1)?.state !== 'nothing-left') return;

  const release = sources.release();
  if (release.problem !== null) context.output.warn(`the release line is left out: ${release.problem}`);
  for (const line of epicEndLines(epic, release)) context.output.info(line);
}

/**
 * The `home` step after a loop, read over a fresh answer; a walk that
 * fails is warned about and answers null, so the hop stays away and the
 * next `rafa next --roadmap` reads it again. See the module note.
 */
async function homeAfterLoop(context: RafaContext, sources: OpenedNextSources): Promise<NextState | null> {
  try {
    return await readHomeAfterLoop(sources.answer());
  } catch (error) {
    context.output.warn(`the hop could not be read after the loop, so rafa next does not go home: ${messageOf(error)}`);
    return null;
  }
}

/**
 * Reads the line, composes the sources and runs the chain over them,
 * asking through a prompter opened on the first question. See the module
 * note for the endings and the exit codes.
 */
export async function runNext(context: RafaContext, seams: NextCommandSeams): Promise<NextChainReport> {
  expectNoArgument(context.args, NEXT_USAGE);
  const flagged = readDryRun(context.flags);
  const roadmap = readRoadmap(context.flags);
  const ceiling = readYesCeiling(context.flags, NEXT_USAGE);
  const isTerminal = seams.isTerminal ?? ((): boolean => process.stdin.isTTY === true);
  const dryRun = dryRunOf(flagged, ceiling, isTerminal());
  const sources = openNextSources(context, seams, roadmap
    ? { roadmap }
    : {});
  const openPrompter = seams.openPrompter ?? ((): Prompter => createLinePrompter(process.stdin, process.stderr));
  const prompter = lazyPrompter(openPrompter);
  const dry = watchDryEpic();

  try {
    const report = await runNextChain({
      // A new answer per turn: its board reads the issue again, so the
      // chain sees what the step it just ran changed (`next/sources.ts`).
      read: () => readNextState(dry.watch(sources.answer())),
      run: (state: NextState) => runStateAction(context, sources, state),
      ask: prompter.ask,
      handOver: prompter.close,
      ceiling,
      dryRun,
      info: (line: string) => {
        context.output.info(line);
      },
      warn: (line: string) => {
        context.output.warn(line);
      },
      afterMerge: () => readSettleAfterMerge(sources.settle, (line: string) => {
        context.output.warn(line);
      }),
      ...roadmap
        ? { roadmap: { afterLoop: () => homeAfterLoop(context, sources) } }
        : {},
    });
    endOfEpic(context, sources, report, dry.last());
    return report;
  } finally {
    prompter.close();
  }
}

/** The action ids help names, as `src/next/ceiling.ts` accepts them. */
const YES_ID_LIST = YES_ACTIONS.join(', ');

/** The three flags the command declares. */
const NEXT_FLAGS: readonly RafaFlagSpec[] = Object.freeze([
  {
    name: DRY_RUN_FLAG,
    description: 'Print where the project stands and what to do about it, and stop without asking or running it.'
      + ' A run with no terminal to answer on and no --yes does this whether or not the flag is typed.',
    type: 'boolean',
  },
  {
    name: ROADMAP_FLAG,
    description: 'Follow one blocker into another epic or board and come home: where the walk stops at an issue'
      + ' blocked by one in another epic, or at an epic with no line left, propose the hop there, pass'
      + ' --roadmap to plan create and loop start, and go home once the loop has run. A blocker that is'
      + ' itself blocked halts with the chain instead, and a pull request whose owner has not approved is'
      + ' not merged.',
    type: 'boolean',
  },
  {
    name: YES_FLAG,
    description: 'Run the actions named without asking, as a comma list of action ids, and stop at the first'
      + ` action the list leaves out. Bare it names ${BARE_YES_ACTIONS.join(', ')}. The ids are ${YES_ID_LIST};`
      + ` a list naming ${[...ALWAYS_ASKED].join(' or ')}, which are always asked, or a word that is no id at all`
      + ' is refused.',
    type: 'string',
  },
]);

/** The command, reading the project and asking through `seams`; see the module note. */
export function createNextCommand(seams: NextCommandSeams = DEFAULT_NEXT_SEAMS): RafaCommand {
  const command: RafaCommand = {
    name: 'next',
    subject: 'next',
    action: 'next',
    summary: 'say where the project stands, propose the one next step, and run it on a yes',
    description: 'Reads the project once — the running loops, the branch and its base, the plans and their'
      + ' trackers, the open pull request and its checks, and the roadmap — and prints where it stands on one'
      + ' line and the one thing to do about it on the next. On a yes it runs that action by calling the'
      + ' command that does it, then reads the project again and proposes what follows. It stops when the'
      + ' answer is no, when an action fails, when there is nothing to run, and once a loop has started. A'
      + ' working tree with changes to tracked files and a pull request provider that cannot be asked are'
      + ' reported in place of a proposal. A pull request no check has reported on is proposed as'
      + ' `rafa pr merge <n> --skip-checks`, which asks its own question after the warning it prints, so'
      + ' rafa next asks none before it. `--dry-run` prints the two lines and stops, and so does a run'
      + ' with no terminal to answer on and no `--yes`, since there is nobody to put the question to.'
      + ' After a merge, while fragments wait on the base and fold into a version, it proposes'
      + ' `rafa release settle`, which runs unasked only under a --yes list naming settle.'
      + ' With `--roadmap` it follows one blocker into another epic or board, works it up to its pull'
      + ' request and comes home, halting where that blocker is blocked in turn.'
      + ' With `--output=json`'
      + ' the steps and why the chain stopped are the data of the terminal result event, and under'
      + ' `--roadmap` the hops that ran as well.',
    args: [],
    flags: [...NEXT_FLAGS],
    examples: [
      {
        cmd: 'rafa next',
        note: 'Proposes the one next step and asks before each one it runs.',
      },
      {
        cmd: 'rafa next --dry-run',
        note: 'Prints where the project stands and what comes next, and runs nothing.',
      },
      {
        cmd: 'rafa next --yes=sync,plan',
        note: 'Fast-forwards the base and creates the next plan unasked, stopping at any other step.',
      },
      {
        cmd: 'rafa next --roadmap --yes=hop,plan,start,home',
        note: 'Hops to the epic holding the blocker, plans and runs it, and comes home unasked.',
      },
    ],
    outputs: ['text', 'json'],
    spends: { when: 'through', what: 'when the step it runs is one of the above' },
    run: async (context) => {
      const report = await runNext(context, seams);
      if (context.outputMode === 'json') context.output.result(report);
    },
  };
  return Object.freeze(command);
}

export default createNextCommand();
