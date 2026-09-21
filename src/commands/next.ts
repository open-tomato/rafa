/**
 * `rafa next [--dry-run] [--yes[=<action ids>]]`: where the project
 * stands in one line, the one thing to do about it in the next, the
 * question, the action, and then the same again for what follows.
 *
 * The modules under `src/next/` are the halves this one joins:
 * `state.ts` answers the ONE state the project is in with the action it
 * proposes and the two sentences it is said in, `readings.ts` is what
 * that table is read over and `sources.ts` composes those readings for
 * a real project, `actions.ts` maps an action id onto the registered
 * command that does it, `sync.ts` holds the one action that runs none,
 * and `ceiling.ts` reads `--yes` as how far a run may go by itself.
 * This module owns the loop, the question and the exit code, and it is
 * the only one of the seven that prints anything.
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
 *    for.
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
 * Without it every action is asked about. With it none of the ids it
 * names is: they may run unasked, and the chain STOPS at the first
 * action the list leaves out, with that action's proposal already
 * printed, so the person reads what is left to do and decides. That
 * stop is `unasked`, and it is the only one of the endings this module
 * reaches with a state it could have run.
 *
 * Which ids a list may name — the eight, the four bare `--yes` allows,
 * and the two lists refused with exit code 2, one naming `ready` and
 * one naming a word that is no action id — is `src/next/ceiling.ts`,
 * read here through {@link readYesCeiling} before any source is opened
 * and asked through {@link allowedUnasked} once a state has answered.
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
 * called as its own function, `sync` alone excepted — fast-forwarding
 * the base is no command, and it runs through the git seam
 * (`src/next/sync.ts`). So each action keeps its own refusals, and
 * {@link NextCommandSeams} is the whole of what a test replaces.
 *
 * An action writes through {@link actionOutput}, which is the caller's
 * output with its `result` taken: an invocation gives ONE result, and
 * the chain's is the report.
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
import type { NextInvocation } from '../next/actions.js';
import type { NextCeiling } from '../next/ceiling.js';
import type { NextSources } from '../next/readings.js';
import type { NextSourceSeams } from '../next/sources.js';
import type { NextActionId, NextAnswerId, NextState } from '../next/state.js';
import type { Output } from '../ports/index.js';
import type { Prompter } from '../project/root-choice.js';

import { CommandExit } from '../cli/command.js';
import { actionInvocation, runAction } from '../next/actions.js';
import { allowedUnasked, BARE_YES_ACTIONS, readYesCeiling, YES_ACTIONS, YES_FLAG } from '../next/ceiling.js';
import { openNextSources } from '../next/sources.js';
import { readNextState } from '../next/state.js';
import { fastForwardBase } from '../next/sync.js';
import { createLinePrompter } from '../project/root-choice.js';
import { REMOTE } from '../start/branch-decision.js';

import { lazyPrompter } from './issue/ready.js';
import { expectNoArgument } from './plan/plan-files.js';

/** The usage line every refusal here names. */
export const NEXT_USAGE = 'rafa next [--dry-run] [--yes[=<action ids>]]';

/** The flag that prints the two lines and stops. */
export const DRY_RUN_FLAG = 'dry-run';

/** The mark the state line opens with. */
const STATE_MARK = '📍';

/** The mark the proposal line opens with. */
const PROPOSAL_MARK = '👉';

/** The mark a line saying why the chain stopped opens with. */
const STOP_MARK = '⏹';

/** How many actions may run in one chain; see the module note. */
export const MAX_ACTIONS = 12;

/** The actions that hand the checkout to a loop, after which the chain stops. */
const LOOP_ACTIONS: readonly NextActionId[] = Object.freeze(['start', 'resume']);

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
  /** Whether the question was put. */
  readonly asked: boolean;
  /** Whether the action ran. */
  readonly ran: boolean;
}

/** Why the chain stopped; the module note holds each one. */
export type NextStop =
  | 'dry-run'
  | 'nothing-to-run'
  | 'declined'
  | 'unasked'
  | 'loop-started'
  | 'unchanged'
  | 'capped';

/** What one chain came to. */
export interface NextChainReport {
  /** One per state read, in order; the last is the state that stopped it. */
  readonly steps: readonly NextStep[];
  /** Why it stopped. */
  readonly stop: NextStop;
}

/** What {@link runNextChain} reads, runs, asks and writes through. */
export interface NextChainOptions {
  /** Reads the state afresh, which every turn does. */
  readonly read: () => Promise<NextState>;
  /** Runs one state's action. Whatever it throws travels out of the chain. */
  readonly run: (state: NextState) => Promise<void>;
  /** Puts one question and answers whether it was said yes to. */
  readonly ask: NextAsk;
  /** The action ids that may run unasked, as `--yes` named them, or null when every one is asked about. */
  readonly ceiling: NextCeiling;
  /** True under `--dry-run`: the two lines and no question. */
  readonly dryRun: boolean;
  /** Where the lines go. */
  readonly info: (line: string) => void;
  /** Where a reading that failed goes. */
  readonly warn: (line: string) => void;
}

/** The command and the words it runs with, as a person types them after `rafa`. */
export function commandWords(invocation: NextInvocation): string {
  return [invocation.command, ...invocation.argv].join(' ');
}

/** What is true, on one line. */
export function stateLine(state: NextState): string {
  return `${STATE_MARK} ${state.reading}.`;
}

/** What to do about it, on one line, with the command that does it when an action runs one. */
export function proposalLine(state: NextState, invocation: NextInvocation | null): string {
  const runs = invocation === null
    ? ''
    : ` — rafa ${commandWords(invocation)}`;
  return `${PROPOSAL_MARK} ${state.proposal}${runs}`;
}

/** The proposal as a sentence opens: its first letter upper-cased, everything else left alone. */
function capitalised(text: string): string {
  return `${text.slice(0, 1).toUpperCase()}${text.slice(1)}`;
}

/** The question one proposal is put as, spelled `[y/N]` and ending in a space to type after. */
export function nextQuestion(state: NextState): string {
  return `${capitalised(state.proposal)}? [y/N] `;
}

/** The ids a ceiling names, as a sentence lists them. */
function namedIds(ceiling: readonly NextActionId[]): string {
  return ceiling.length === 0
    ? 'no action'
    : ceiling.join(', ');
}

/** Why the chain stopped, or null for an ending the two lines have already said. */
export function stopLine(stop: NextStop, state: NextState, ceiling: NextCeiling): string | null {
  if (stop === 'dry-run') return `${STOP_MARK} --${DRY_RUN_FLAG}: nothing ran.`;
  if (stop === 'declined') return `${STOP_MARK} Nothing ran.`;
  if (stop === 'unasked') {
    return `${STOP_MARK} --${YES_FLAG} allows ${namedIds(ceiling ?? [])}, and this step is ${state.action},`
      + ` so nothing ran; type --${YES_FLAG}=${[...ceiling ?? [], state.action].join(',')} to allow it,`
      + ` or drop --${YES_FLAG} to be asked.`;
  }
  if (stop === 'loop-started') {
    return `${STOP_MARK} The loop has run; rafa next reads where it left the project.`;
  }
  if (stop === 'unchanged') {
    return `${STOP_MARK} That last step left the project where it was, so the chain stops rather than repeating it.`;
  }
  if (stop === 'capped') {
    return `${STOP_MARK} ${MAX_ACTIONS} actions have run, which is as many as one chain runs; run rafa next again.`;
  }
  return null;
}

/** True when a state read back names the same thing as the one an action just ran for. */
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

/** A report ending on `step`, which is the state that stopped the chain. */
function ended(steps: readonly NextStep[], step: NextStep, stop: NextStop): NextChainReport {
  return Object.freeze({ steps: Object.freeze([...steps, step]), stop });
}

/**
 * Reads the state, proposes the one action it carries, runs it once it
 * is allowed, and reads again, until one of the endings the module note
 * holds. Whatever an action throws travels out unchanged.
 */
export async function runNextChain(options: NextChainOptions): Promise<NextChainReport> {
  const { read, run, ask, ceiling, dryRun, info, warn } = options;
  let steps: readonly NextStep[] = [];
  let previous: NextState | null = null;

  for (;;) {
    const state = await read();
    for (const problem of state.problems) warn(problem);
    const invocation = actionInvocation(state);
    info(stateLine(state));
    info(proposalLine(state, invocation));

    /** Says why the chain stopped, for an ending the two lines have not already said. */
    const announce = (stop: NextStop): void => {
      const line = stopLine(stop, state, ceiling);
      if (line !== null) info(line);
    };
    /** An ending reached before the action ran, which the state that stopped it closes. */
    const stopHere = (stop: NextStop, over: Partial<NextStep> = {}): NextChainReport => {
      announce(stop);
      return ended(steps, stepOf(state, invocation, over), stop);
    };
    /** An ending reached with the action run, which is already a step of the report. */
    const stopAfter = (stop: NextStop): NextChainReport => {
      announce(stop);
      return Object.freeze({ steps, stop });
    };

    if (dryRun) return stopHere('dry-run');
    if (state.action === 'none') return stopHere('nothing-to-run');
    if (repeats(previous, state)) return stopHere('unchanged');

    const unasked = allowedUnasked(state.action, ceiling);
    if (!unasked && ceiling !== null) return stopHere('unasked');
    if (!unasked && !await ask(nextQuestion(state))) return stopHere('declined', { asked: true });

    await run(state);
    steps = [...steps, stepOf(state, invocation, { asked: !unasked, ran: true })];

    if (LOOP_ACTIONS.includes(state.action)) return stopAfter('loop-started');
    if (steps.length >= MAX_ACTIONS) return stopAfter('capped');
    previous = state;
  }
}

/** A refusal of the line with exit code 1: the problem, then the usage line. */
function lineRefusal(problem: string): CommandExit {
  return new CommandExit(1, `❌ ${problem}\nUsage: ${NEXT_USAGE}`);
}

/**
 * True under `--dry-run`, false without it. A value that is neither
 * `true` nor `false` is refused: `parseArgs` hands a flag the word after
 * it whatever the flag declares, so `rafa next --dry-run sync` would
 * otherwise read `sync` as the flag's value and say nothing about it.
 */
export function readDryRun(flags: RafaContext['flags']): boolean {
  const value = flags[DRY_RUN_FLAG];
  if (value === undefined) return false;
  if (typeof value === 'boolean') return value;
  if (value === 'true' || value === 'false') return value === 'true';
  throw lineRefusal(`--${DRY_RUN_FLAG} takes no value, and read "${value}" as one`);
}

/** How the command reaches the sources and the terminal; each left out is the system's own. */
export interface NextCommandSeams extends NextSourceSeams {
  /** Opens the prompter the questions are asked through. Called only to ask. */
  readonly openPrompter?: () => Prompter;
}

/** The seams the registered command runs with: the system's own, every one. */
export const DEFAULT_NEXT_SEAMS: NextCommandSeams = Object.freeze({});

/**
 * The output an action writes through: the caller's, with `result`
 * taken rather than passed on.
 *
 * One invocation gives exactly ONE result and the dispatcher refuses a
 * second (`src/cli/dispatch.ts`). A chain runs several commands, and
 * `pr wait` and `issue ready` each give one in json mode, so handing
 * theirs on would throw inside the second action of a chain and would
 * leave no result for the chain itself. The action's lines still go
 * through, which in json mode is a log event each, so what it did is on
 * the stream either way; what is dropped is its payload, and the
 * payload of the invocation is {@link NextChainReport}.
 */
export function actionOutput(output: Output): Output {
  return Object.freeze({ ...output, result: () => undefined });
}

/**
 * Runs one state's action: the registered command it names, or, for
 * `sync`, the fast-forward through the git seam, whose refusal is this
 * command's own exit 1 and whose words git wrote are printed as they are.
 */
async function runStateAction(context: RafaContext, sources: NextSources, state: NextState): Promise<void> {
  if (state.action !== 'sync') {
    await runAction({ ...context, output: actionOutput(context.output) }, state);
    return;
  }

  const outcome = fastForwardBase(sources.git, { base: sources.base, remote: sources.remote ?? REMOTE });
  if (outcome.kind === 'refused') throw new CommandExit(1, outcome.message);
  if (outcome.said !== '') context.output.info(outcome.said);
}

/**
 * Reads the line, composes the sources and runs the chain over them,
 * asking through a prompter opened on the first question. See the module
 * note for the endings and the exit codes.
 */
export async function runNext(context: RafaContext, seams: NextCommandSeams): Promise<NextChainReport> {
  expectNoArgument(context.args, NEXT_USAGE);
  const dryRun = readDryRun(context.flags);
  const ceiling = readYesCeiling(context.flags, NEXT_USAGE);
  const sources = openNextSources(context, seams);
  const openPrompter = seams.openPrompter ?? ((): Prompter => createLinePrompter(process.stdin, process.stderr));
  const prompter = lazyPrompter(openPrompter);

  try {
    return await runNextChain({
      read: () => readNextState(sources),
      run: (state: NextState) => runStateAction(context, sources, state),
      ask: prompter.ask,
      ceiling,
      dryRun,
      info: (line: string) => {
        context.output.info(line);
      },
      warn: (line: string) => {
        context.output.warn(line);
      },
    });
  } finally {
    prompter.close();
  }
}

/** The action ids help names, as `src/next/ceiling.ts` accepts them. */
const YES_ID_LIST = YES_ACTIONS.join(', ');

/** The two flags the command declares. */
const NEXT_FLAGS: readonly RafaFlagSpec[] = Object.freeze([
  {
    name: DRY_RUN_FLAG,
    description: 'Print where the project stands and what to do about it, and stop without asking or running it.',
    type: 'boolean',
  },
  {
    name: YES_FLAG,
    description: 'Run the actions named without asking, as a comma list of action ids, and stop at the first'
      + ` action the list leaves out. Bare it names ${BARE_YES_ACTIONS.join(', ')}. The ids are ${YES_ID_LIST};`
      + ' a list naming ready, which is always asked, or a word that is no id at all is refused.',
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
      + ' reported in place of a proposal. `--dry-run` prints the two lines and stops. With `--output=json`'
      + ' the steps and why the chain stopped are the data of the terminal result event.',
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
    ],
    outputs: ['text', 'json'],
    run: async (context) => {
      const report = await runNext(context, seams);
      if (context.outputMode === 'json') context.output.result(report);
    },
  };
  return Object.freeze(command);
}

export default createNextCommand();
