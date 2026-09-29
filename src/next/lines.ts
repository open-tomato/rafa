/**
 * The lines `rafa next` writes and the two readings of its line that
 * decide whether it acts: the state line and the proposal line of every
 * turn, the line saying why a chain stopped, and `--dry-run` read as a
 * flag and, beside `--yes` and the terminal, as the reason a run prints
 * the two lines and stops.
 *
 * `src/commands/next.ts` owns the chain, the action and the exit code
 * and holds the module note on each ending; this module only words
 * them, so the command's own file keeps room for the steps it runs.
 * Nothing here reads a source or prints.
 *
 * The lists of action ids the stop lines print leave out `hop` and
 * `home` (`ROADMAP_ACTIONS`, `./ceiling.ts`) unless the run was typed
 * with `--roadmap`. No run proposes either without `NextSources.roadmap`,
 * which only `--roadmap` sets, so bare `--yes` allowing `home` changes
 * nothing a plain run does, and leaving the two out keeps what a plain
 * run prints byte for byte what it printed before they were ids. Under
 * `--roadmap` they are named like any other id, so the list a stop line
 * tells the person to type allows the hop it would otherwise stop at
 * again. The step a chain stopped at is named whatever it is.
 */

import type { NextInvocation } from './actions.js';
import type { NextCeiling } from './ceiling.js';
import type { NextActionId, NextState } from './state.js';
import type { RafaContext } from '../cli/command.js';

import { CommandExit } from '../cli/command.js';

import { ALWAYS_ASKED, BARE_YES_ACTIONS, ROADMAP_ACTIONS, YES_FLAG } from './ceiling.js';
import { commandWords } from './hint.js';

/** The usage line every refusal here names. */
export const NEXT_USAGE = 'rafa next [--dry-run] [--roadmap] [--yes[=<action ids>]]';

/** The flag that prints the two lines and stops. */
export const DRY_RUN_FLAG = 'dry-run';

/** The flag that reads the hop rows and follows one blocker into another epic or board. */
export const ROADMAP_FLAG = 'roadmap';

/** The mark the state line opens with. */
const STATE_MARK = '📍';

/** The mark the proposal line opens with. */
const PROPOSAL_MARK = '👉';

/** The mark a line saying why the chain stopped opens with. */
const STOP_MARK = '⏹';

/** How many actions may run in one chain; see the module note. */
export const MAX_ACTIONS = 12;

/**
 * Why a run prints the two lines and stops without running anything:
 * `flag` for the `--dry-run` that asked for it, `no-terminal` for the
 * run that has no terminal to answer on and named no `--yes`.
 */
export type NextDryRun = 'flag' | 'no-terminal';

/** Why the chain stopped; the module note holds each one. */
export type NextStop =
  | 'dry-run'
  | 'nothing-to-run'
  | 'declined'
  | 'unasked'
  | 'loop-started'
  | 'unchanged'
  | 'capped';

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

/** The ids a stop line lists: `hop` and `home` left out of a run without `--roadmap`; see the module note. */
function shownIds(ids: readonly NextActionId[], roadmap: boolean): readonly NextActionId[] {
  return roadmap
    ? ids
    : ids.filter((action) => !ROADMAP_ACTIONS.has(action));
}

/** The ids a ceiling names, as a sentence lists them. */
function namedIds(ceiling: readonly NextActionId[], roadmap: boolean): string {
  const shown = shownIds(ceiling, roadmap);
  return shown.length === 0
    ? 'no action'
    : shown.join(', ');
}

/** Why a run that ran nothing ran nothing: the flag, or the terminal it has not got. */
function dryRunLine(dryRun: NextDryRun | null, roadmap: boolean): string {
  if (dryRun === 'no-terminal') {
    return `${STOP_MARK} There is no terminal to answer on, so nothing ran; run rafa next where you can answer,`
      + ` or type --${YES_FLAG}=${shownIds(BARE_YES_ACTIONS, roadmap).join(',')} to allow those steps unasked.`;
  }
  return `${STOP_MARK} --${DRY_RUN_FLAG}: nothing ran.`;
}

/**
 * Why the chain stopped, or null for an ending the two lines have
 * already said. `roadmap` is whether the run was typed with
 * `--roadmap`, which decides whether the lists name `hop` and `home`.
 */
export function stopLine(
  stop: NextStop,
  state: NextState,
  ceiling: NextCeiling,
  dryRun: NextDryRun | null,
  roadmap = false,
): string | null {
  if (stop === 'dry-run') return dryRunLine(dryRun, roadmap);
  if (stop === 'declined') return `${STOP_MARK} Nothing ran.`;
  if (stop === 'unasked') {
    const allows = `${STOP_MARK} --${YES_FLAG} allows ${namedIds(ceiling ?? [], roadmap)}, and this step is ${state.action},`
      + ' so nothing ran;';
    if (ALWAYS_ASKED.has(state.action)) {
      return `${allows} no --${YES_FLAG} list allows it, so drop --${YES_FLAG} to be asked.`;
    }
    return `${allows} type --${YES_FLAG}=${[...shownIds(ceiling ?? [], roadmap), state.action].join(',')} to allow it,`
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
  return readBareFlag(flags, DRY_RUN_FLAG);
}

/**
 * True under `--roadmap`, false without it, a value refused as
 * {@link readDryRun} refuses one: `rafa next --roadmap sync` would
 * otherwise read `sync` as the flag's value.
 */
export function readRoadmap(flags: RafaContext['flags']): boolean {
  return readBareFlag(flags, ROADMAP_FLAG);
}

/** A flag that takes no value, read off `flags`; see {@link readDryRun}. */
function readBareFlag(flags: RafaContext['flags'], name: string): boolean {
  const value = flags[name];
  if (value === undefined) return false;
  if (typeof value === 'boolean') return value;
  if (value === 'true' || value === 'false') return value === 'true';
  throw lineRefusal(`--${name} takes no value, and read "${value}" as one`);
}

/**
 * Why the run prints the two lines and stops, or null for a run that
 * proposes and acts: `flag` where `--dry-run` asked for it, and
 * `no-terminal` where it did not, `--yes` named no ceiling and there is
 * no terminal to answer the question on.
 *
 * A ceiling is what makes a terminal beside the point: under `--yes`
 * every step either runs unasked or stops the chain, so nothing is ever
 * asked and the run is the same with a terminal and without one. The
 * flag outranks both, so `--dry-run` reads as itself wherever it is
 * typed.
 */
export function dryRunOf(flag: boolean, ceiling: NextCeiling, hasTerminal: boolean): NextDryRun | null {
  if (flag) return 'flag';
  if (ceiling === null && !hasTerminal) return 'no-terminal';
  return null;
}
