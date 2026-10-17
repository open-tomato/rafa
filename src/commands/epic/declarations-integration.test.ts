/**
 * The `epic` declarations as values: the values `declarations.ts` copies
 * from outside `src/commands/` stay equal to their sources; the lasting
 * alias of `epic show` and the `spends` of `epic close` sit on their
 * declarations; and each of the seven modules exports a command that is
 * its declaration plus a `run`.
 *
 * These cases import `declarations.ts`, and so reach core's command
 * types; the cases that read its source for what it imports stay in
 * `declarations.test.ts` beside this file.
 */
import type { CommandDeclaration, RafaCommand } from '@open-tomato/rafa/core/command';

import { describe, expect, it } from 'bun:test';

import { REASON_FLAG } from '../../board/epic-trail.js';
import { HORIZONS } from '../../board/roadmap-epic-rows.js';

import epicCancel from './cancel.js';
import epicClose from './close.js';
import {
  DEFAULT_HORIZON,
  DEFER_TARGETS,
  EPIC_CANCEL_DECLARATION,
  EPIC_CLOSE_DECLARATION,
  EPIC_DEFER_DECLARATION,
  EPIC_HORIZON_WORDS,
  EPIC_MOVE_DECLARATION,
  EPIC_NEW_DECLARATION,
  EPIC_PROMOTE_DECLARATION,
  EPIC_REASON_FLAG,
  EPIC_SHOW_DECLARATION,
  EPIC_SUBJECT,
  PROMOTE_TARGETS,
} from './declarations.js';
import epicDefer from './defer.js';
import { DEFER_ACTION, PROMOTE_ACTION } from './horizon-change.js';
import epicMove from './move.js';
import epicNew from './new.js';
import epicPromote from './promote.js';
import epicShow from './show.js';

/**
 * A command less its `run`: the fields its declaration carries.
 *
 * @param command - A command a module exports.
 * @returns Every field but `run`.
 */
function lessRun(command: RafaCommand): object {
  return Object.fromEntries(Object.entries(command).filter(([field]) => field !== 'run'));
}

describe('the values declarations.ts copies and owns', () => {
  it('spells the reason flag and the horizons as their sources do', () => {
    expect(EPIC_REASON_FLAG).toBe(REASON_FLAG);
    expect(EPIC_HORIZON_WORDS).toEqual(HORIZONS);
  });

  it('gives the defer and promote actions their targets, each a horizon in horizon order', () => {
    expect(DEFER_ACTION.targets).toBe(DEFER_TARGETS);
    expect(PROMOTE_ACTION.targets).toBe(PROMOTE_TARGETS);
    for (const targets of [DEFER_TARGETS, PROMOTE_TARGETS]) {
      expect(HORIZONS.filter((horizon) => (targets as readonly string[]).includes(horizon))).toEqual([...targets]);
    }
    expect(HORIZONS).toContain(DEFAULT_HORIZON);
  });
});

describe('the epic declarations', () => {
  /** Each module's default command beside the declaration it spreads, in roster order. */
  const PAIRS: readonly (readonly [string, RafaCommand, CommandDeclaration])[] = [
    ['epic show', epicShow, EPIC_SHOW_DECLARATION],
    ['epic new', epicNew, EPIC_NEW_DECLARATION],
    ['epic defer', epicDefer, EPIC_DEFER_DECLARATION],
    ['epic promote', epicPromote, EPIC_PROMOTE_DECLARATION],
    ['epic move', epicMove, EPIC_MOVE_DECLARATION],
    ['epic close', epicClose, EPIC_CLOSE_DECLARATION],
    ['epic cancel', epicCancel, EPIC_CANCEL_DECLARATION],
  ];

  it.each(PAIRS)('exports %s as its declaration plus a run', (name, command, declaration) => {
    expect(declaration.name).toBe(name);
    expect(declaration.subject).toBe(EPIC_SUBJECT.name);
    expect(Object.isFrozen(declaration)).toBe(true);
    expect(lessRun(command)).toEqual({ ...declaration });
    expect(typeof command.run).toBe('function');
  });

  it('declares epic as the lasting alias of epic show, and on no other', () => {
    expect(EPIC_SHOW_DECLARATION.aliases).toEqual(['epic']);
    expect(EPIC_SHOW_DECLARATION.lastingAliases).toEqual(['epic']);
    expect(PAIRS.filter(([, , declaration]) => declaration.lastingAliases !== undefined).map(([name]) => name))
      .toEqual(['epic show']);
  });

  it('declares spends on epic close alone', () => {
    expect(EPIC_CLOSE_DECLARATION.spends?.when).toBe('always');
    expect(PAIRS.filter(([, , declaration]) => declaration.spends !== undefined).map(([name]) => name))
      .toEqual(['epic close']);
  });

  it('names the epic subject', () => {
    expect(EPIC_SUBJECT.name).toBe('epic');
    expect(Object.isFrozen(EPIC_SUBJECT)).toBe(true);
  });
});
