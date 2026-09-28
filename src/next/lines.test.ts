/**
 * The lines `rafa next` writes and the readings of its line, moved here
 * from `src/commands/next.test.ts` with the functions they cover. The
 * chain cases that read these lines as a run writes them stay beside
 * the chain.
 */

import type { NextDryRun, NextStop } from './lines.js';
import type { NextState } from './state.js';

import { describe, expect, it } from 'bun:test';

import { CommandExit } from '../cli/command.js';

import { BARE_YES_ACTIONS, YES_FLAG } from './ceiling.js';
import {
  DRY_RUN_FLAG,
  dryRunOf,
  MAX_ACTIONS,
  NEXT_USAGE,
  proposalLine,
  readDryRun,
  stateLine,
  stopLine,
} from './lines.js';

/** The base every case names. */
const BASE = 'main';

/** The pull request the states name. */
const PR = 41;

/** A state as a row answers one, with the fields a case fills. */
function stateOf(over: Partial<NextState>): NextState {
  return Object.freeze({
    id: 'pr-green',
    action: 'merge',
    reading: `#${PR} is open on \`feat/rafa-63\`, green and merges into \`${BASE}\``,
    proposal: `merge #${PR} into \`${BASE}\``,
    pullRequest: PR,
    issue: null,
    planStub: null,
    planPath: null,
    problems: [],
    ...over,
  });
}

/** The green pull request state. */
const GREEN = stateOf({});

/** The base-behind state, whose action runs no command. */
const BEHIND = stateOf({
  id: 'base-behind',
  action: 'sync',
  reading: `\`${BASE}\` is 2 commits behind \`origin/${BASE}\``,
  proposal: `fast-forward \`${BASE}\` to \`origin/${BASE}\``,
  pullRequest: null,
});

describe('the two lines', () => {
  it('writes what is true, then what to do about it with the command that does it', () => {
    const lines = [stateLine(GREEN), proposalLine(GREEN, {
      action: 'merge',
      command: 'pr merge',
      argv: [String(PR), `--${YES_FLAG}`],
    })];

    expect(lines).toEqual([
      `📍 #${PR} is open on \`feat/rafa-63\`, green and merges into \`${BASE}\`.`,
      `👉 merge #${PR} into \`${BASE}\` — rafa pr merge ${PR} --${YES_FLAG}`,
    ]);
  });

  it('writes the proposal alone for an action that runs no command', () => {
    expect(proposalLine(BEHIND, null))
      .toBe(`👉 fast-forward \`${BASE}\` to \`origin/${BASE}\``);
  });
});

describe('the stop line', () => {
  it('words each ending, and none for the one the two lines already said', () => {
    const cases: readonly [NextStop, NextDryRun | null][] = [
      ['dry-run', 'flag'],
      ['dry-run', 'no-terminal'],
      ['declined', null],
      ['loop-started', null],
      ['unchanged', null],
      ['capped', null],
      ['nothing-to-run', null],
    ];
    const lines = cases.map(([stop, dryRun]) => stopLine(stop, GREEN, null, dryRun));

    expect(lines).toEqual([
      `⏹ --${DRY_RUN_FLAG}: nothing ran.`,
      '⏹ There is no terminal to answer on, so nothing ran; run rafa next where you can answer,'
        + ` or type --${YES_FLAG}=${BARE_YES_ACTIONS.join(',')} to allow those steps unasked.`,
      '⏹ Nothing ran.',
      '⏹ The loop has run; rafa next reads where it left the project.',
      '⏹ That last step left the project where it was, so the chain stops rather than repeating it.',
      `⏹ ${MAX_ACTIONS} actions have run, which is as many as one chain runs; run rafa next again.`,
      null,
    ]);
  });

  it('names the list that allows an unasked step, and says to drop --yes for one no list may name', () => {
    const allowable = stopLine('unasked', GREEN, ['sync'], null);
    const neverAllowed = stopLine('unasked', stateOf({ action: 'ready' }), [], null);

    expect(allowable).toBe(`⏹ --${YES_FLAG} allows sync, and this step is merge, so nothing ran;`
      + ` type --${YES_FLAG}=sync,merge to allow it, or drop --${YES_FLAG} to be asked.`);
    expect(neverAllowed).toBe(`⏹ --${YES_FLAG} allows no action, and this step is ready, so nothing ran;`
      + ` no --${YES_FLAG} list allows it, so drop --${YES_FLAG} to be asked.`);
  });
});

describe('the line', () => {
  it('reads a run with no terminal and no --yes as a dry run, and one with either as a run that acts', () => {
    const read = [
      dryRunOf(false, null, true),
      dryRunOf(false, null, false),
      dryRunOf(false, ['sync'], false),
      dryRunOf(false, [], false),
      dryRunOf(true, null, true),
      dryRunOf(true, ['sync'], false),
    ];

    expect(read).toEqual([null, 'no-terminal', null, null, 'flag', 'flag']);
  });

  it('reads --dry-run bare, negated, written out and left out', () => {
    const read = [{}, { [DRY_RUN_FLAG]: true }, { [DRY_RUN_FLAG]: false }, { [DRY_RUN_FLAG]: 'true' }, { [DRY_RUN_FLAG]: 'false' }]
      .map((flags) => readDryRun(flags));

    expect(read).toEqual([false, true, false, true, false]);
  });

  it('refuses a value --dry-run swallowed, naming the usage', () => {
    let refused: CommandExit | null = null;

    try {
      readDryRun({ [DRY_RUN_FLAG]: 'sync' });
    } catch (error) {
      refused = error instanceof CommandExit
        ? error
        : null;
    }

    expect(refused?.exitCode).toBe(1);
    expect(refused?.message).toBe(`❌ --${DRY_RUN_FLAG} takes no value, and read "sync" as one\nUsage: ${NEXT_USAGE}`);
  });
});
