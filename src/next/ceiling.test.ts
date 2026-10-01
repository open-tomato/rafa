/**
 * Tests for `--yes` as a risk ceiling (`ceiling.ts`): the eleven ids a
 * list may name, the five bare `--yes` allows, the two lists refused
 * with exit code 2 — the second read for each of the two always-asked
 * ids, `ready` and `merge-unchecked` — and which action may then run
 * with no question put.
 *
 * Every case here drives the reading itself — a flags record in, a
 * ceiling or a `CommandExit` out. What the chain DOES with a ceiling —
 * running the ids it names unasked and stopping at the first action
 * outside the list with that action's proposal printed — is
 * `src/commands/next.test.ts`, over `runNextChain`, which is the only
 * module that prints.
 *
 * ## The controls
 *
 * Four readings here would pass while wrong, and each is paired:
 *
 *  - The eleven ids are read as a literal list AND as the action table
 *    with the two always-asked ids dropped, `sync`, `hop` and `home` beside it, so a list spelled twice
 *    cannot drift apart unnoticed: the first would pass over a
 *    hand-written copy.
 *  - The five bare `--yes` allows are read beside the six it leaves
 *    out, so a bare flag that named all eleven would fail rather than
 *    satisfy a check that the five are among them.
 *  - Each refusal is read beside a list that is NOT refused —
 *    {@link refusalOf} answers null where nothing was thrown — so a
 *    reader that refused everything could not pass.
 *  - `ready` and `merge-unchecked` are each read as refused in a list
 *    and as unaskable in a ceiling built in code, beside the eleven ids
 *    that do run unasked.
 *
 * ## What passes while wrong
 *
 * Six mutations of `ceiling.ts` were driven on 2026-09-22, one at a
 * time, over `env -u CLAUDECODE bun test src/next/ceiling.test.ts`, the
 * module restored from a scratch copy and verified with `shasum -c`
 * each time, against the 17 pass and 0 fail the file answers whole:
 *
 *  - the always-asked arm of `readCeilingId` dropped, so both words
 *    fall through to the unknown-id refusal: 15 pass and 2 fail, the
 *    two cases that read each refusal's own message. The exit code is 2
 *    either way, which is why the message is what they read.
 *  - the unknown-id refusal dropped and the word taken as an id, so
 *    `--yes=mrege` names a step nothing proposes: 15 pass and 2 fail,
 *    the unknown case and the one that reads a capitalised id as
 *    unknown.
 *  - bare `--yes` answered {@link YES_ACTIONS} rather than
 *    {@link BARE_YES_ACTIONS}, so it allows the merge, the start and
 *    the resume as well: 16 pass and 1 fail, the bare case, which reads
 *    the four beside the four left out.
 *  - the `ALWAYS_ASKED` guard dropped from {@link allowedUnasked}, so a
 *    ceiling built in code naming `ready` or `merge-unchecked` runs it
 *    unasked: 15 pass and 2 fail, the case for each id. The line
 *    refusal above it does not see this one, which is why both
 *    boundaries are read: over `src/commands/next.test.ts src/next/`
 *    that same mutation reads 238 pass and 3 fail, the chain case for
 *    the `ready` step beside the two here.
 *  - `merge-unchecked` left out of {@link ALWAYS_ASKED}, the set as it
 *    stood before: 9 pass and 8 fail, as the id joins the ones a list
 *    may name and the eight become nine.
 *  - the refusal reading `ready` alone while the set still holds both,
 *    so `--yes=merge-unchecked` reads as no id at all rather than as an
 *    always-asked one: 16 pass and 1 fail, the `merge-unchecked`
 *    refusal case, which reads its message rather than its exit code.
 *
 * Four more were driven on 2026-09-30 for the lists in `native` mode,
 * the same way over this file and `./actions.test.ts`, against 52 pass
 * and 0 fail: the native lists answered as the labels ones, 48 pass and
 * 4 fail; the native `unblock` refusal dropped, so the word falls to the
 * unknown-id refusal, 51 pass and 1 fail, the case reading its message;
 * and bare `--yes` answering {@link BARE_YES_ACTIONS} whatever the mode,
 * 51 pass and 1 fail. The fourth is `./actions.test.ts`'s.
 */
import type { NextActionId } from './state.js';

import { describe, expect, it } from 'bun:test';

import { CommandExit } from '../cli/command.js';

import { NEXT_COMMAND_ACTIONS } from './actions.js';
import {
  allowedUnasked,
  ALWAYS_ASKED,
  BARE_YES_ACTIONS,
  bareYesActionsFor,
  CEILING_REFUSAL_EXIT,
  readYesCeiling,
  ROADMAP_ACTIONS,
  YES_ACTIONS,
  yesActionsFor,
  YES_FLAG,
} from './ceiling.js';

/** The usage line the caller hands the reading, which every refusal names. */
const USAGE = 'rafa next [--dry-run] [--yes[=<action ids>]]';

/** The eleven, spelled out: what a person may type, held against the table below. */
const ELEVEN: readonly NextActionId[] = ['sync', 'resume', 'wait', 'triage', 'merge', 'settle', 'start', 'plan', 'unblock', 'hop', 'home'];

/** The ten a list may name in `native` mode, spelled out: the eleven without `unblock`. */
const NATIVE_TEN: readonly NextActionId[] = ['sync', 'resume', 'wait', 'triage', 'merge', 'settle', 'start', 'plan', 'hop', 'home'];

/** The ceiling `--yes=<value>` reads to. */
function ceilingOf(value: boolean | string): readonly NextActionId[] | null {
  return readYesCeiling({ [YES_FLAG]: value }, USAGE);
}

/** The refusal `--yes=<value>` earns, or null where the list was read without one. */
function refusalOf(value: string, mode: 'labels' | 'native' = 'labels'): CommandExit | null {
  try {
    readYesCeiling({ [YES_FLAG]: value }, USAGE, mode);
    return null;
  } catch (error) {
    if (error instanceof CommandExit) return error;
    throw error;
  }
}

describe('the ids a list may name', () => {
  it('holds ready and merge-unchecked, and nothing else, as always asked', () => {
    expect([...ALWAYS_ASKED].sort()).toEqual(['merge-unchecked', 'ready']);
    expect([...ALWAYS_ASKED].every((action) => NEXT_COMMAND_ACTIONS.includes(action))).toBe(true);
  });

  it('accepts eleven: sync, the command actions but the two that are always asked, hop and home', () => {
    expect(YES_ACTIONS).toEqual(ELEVEN);
    expect(YES_ACTIONS).toHaveLength(11);
    expect(YES_ACTIONS.filter((action) => ALWAYS_ASKED.has(action))).toEqual([]);
    expect(YES_ACTIONS).not.toContain('none');
  });

  it('takes the eight that run a command off the action table rather than spelling them again', () => {
    expect(YES_ACTIONS.filter((action) => action !== 'sync' && !ROADMAP_ACTIONS.has(action)))
      .toEqual(NEXT_COMMAND_ACTIONS.filter((action) => action !== 'ready' && action !== 'merge-unchecked'));
    expect([...ROADMAP_ACTIONS]).toEqual(['hop', 'home']);
    expect(NEXT_COMMAND_ACTIONS.filter((action) => ROADMAP_ACTIONS.has(action))).toEqual([]);
  });

  it('reads each of the eleven, one at a time, as the id it spells', () => {
    expect(YES_ACTIONS.map((action) => ceilingOf(action))).toEqual(YES_ACTIONS.map((action) => [action]));
  });
});

describe('the five bare --yes allows', () => {
  it('names the five that neither merge, nor start a loop, nor push, nor leave home, and leaves the other six out', () => {
    expect(BARE_YES_ACTIONS).toEqual(['sync', 'wait', 'unblock', 'plan', 'home']);
    expect(ceilingOf(true)).toEqual(BARE_YES_ACTIONS);
    expect(YES_ACTIONS.filter((action) => !BARE_YES_ACTIONS.includes(action)))
      .toEqual(['resume', 'triage', 'merge', 'settle', 'start', 'hop']);
  });
});

describe('the list read off the line', () => {
  it('names nothing where the line leaves the flag out or negates it', () => {
    expect(readYesCeiling({}, USAGE)).toBeNull();
    expect(ceilingOf(false)).toBeNull();
  });

  it('reads a comma list, dropping the padding and the empty entries', () => {
    expect(ceilingOf('merge, sync ,,plan')).toEqual(['merge', 'sync', 'plan']);
  });

  it('reads a value holding nothing as a ceiling allowing nothing rather than as a line refused', () => {
    expect(ceilingOf('')).toEqual([]);
    expect(refusalOf('')).toBeNull();
  });
});

describe('the two refusals', () => {
  it('refuses a list naming ready with exit 2, saying why and naming the usage', () => {
    const alone = refusalOf('ready');
    const among = refusalOf('sync,ready,plan');

    expect([alone?.exitCode, among?.exitCode]).toEqual([CEILING_REFUSAL_EXIT, CEILING_REFUSAL_EXIT]);
    expect(alone?.message).toBe(`❌ --${YES_FLAG} names ready, which no list runs unasked: marking an issue ready`
      + ' is a claim about a spec that a person makes, and rafa next asks it however the list is spelled'
      + `\nUsage: ${USAGE}`);
    expect(among?.message).toBe(alone?.message);
  });

  it('refuses a list naming merge-unchecked with exit 2, saying pr merge --skip-checks asks it', () => {
    const alone = refusalOf('merge-unchecked');
    const among = refusalOf('merge, merge-unchecked');

    expect([alone?.exitCode, among?.exitCode]).toEqual([CEILING_REFUSAL_EXIT, CEILING_REFUSAL_EXIT]);
    expect(alone?.message).toBe(`❌ --${YES_FLAG} names merge-unchecked, which no list runs unasked: merging a pull`
      + ' request no check has reported on is asked by rafa pr merge --skip-checks itself, however the list is spelled'
      + `\nUsage: ${USAGE}`);
    expect(among?.message).toBe(alone?.message);
  });

  it('refuses a list naming both always-asked ids at the first one it reads', () => {
    expect(refusalOf('merge-unchecked,ready')?.message).toBe(refusalOf('merge-unchecked')?.message);
    expect(refusalOf('ready,merge-unchecked')?.message).toBe(refusalOf('ready')?.message);
  });

  it('refuses a list naming no id of the table with exit 2, naming the eleven and the usage', () => {
    const refused = refusalOf('mrege,sync');

    expect(refused?.exitCode).toBe(CEILING_REFUSAL_EXIT);
    expect(refused?.message).toBe(`❌ --${YES_FLAG} names "mrege", which is no step of rafa next;`
      + ` the ids are ${ELEVEN.join(', ')}\nUsage: ${USAGE}`);
  });

  it('reads an id spelled with a capital as no id at all', () => {
    expect(refusalOf('Merge')?.exitCode).toBe(CEILING_REFUSAL_EXIT);
  });

  it('refuses no list the eleven spell, however they are padded or ordered', () => {
    expect(refusalOf(YES_ACTIONS.join(','))).toBeNull();
    expect(refusalOf(' start , merge ')).toBeNull();
  });
});

describe('whether an action may run unasked', () => {
  it('allows what a ceiling names and nothing else, and nothing at all without one', () => {
    expect([
      allowedUnasked('merge', ['merge']),
      allowedUnasked('merge', ['sync']),
      allowedUnasked('merge', []),
      allowedUnasked('merge', null),
    ]).toEqual([true, false, false, false]);
  });

  it('allows each of the eleven a ceiling names, and never ready, whatever the ceiling holds', () => {
    expect(YES_ACTIONS.map((action) => allowedUnasked(action, YES_ACTIONS))).toEqual(YES_ACTIONS.map(() => true));
    expect(allowedUnasked('ready', ['ready'])).toBe(false);
    expect(allowedUnasked('ready', [...YES_ACTIONS, 'ready'])).toBe(false);
  });

  it('never allows merge-unchecked, even where a ceiling built in code names it', () => {
    expect(allowedUnasked('merge-unchecked', ['merge-unchecked'])).toBe(false);
    expect(allowedUnasked('merge-unchecked', [...YES_ACTIONS, 'merge-unchecked'])).toBe(false);
    expect(allowedUnasked('merge', [...YES_ACTIONS, 'merge-unchecked'])).toBe(true);
  });
});

describe('the lists in native mode', () => {
  it('reads labels mode as the eleven and the five, whether the mode is handed or left out', () => {
    expect([yesActionsFor('labels'), bareYesActionsFor('labels')]).toEqual([ELEVEN, ['sync', 'wait', 'unblock', 'plan', 'home']]);
    expect(readYesCeiling({ [YES_FLAG]: true }, USAGE, 'labels')).toEqual(ceilingOf(true));
    expect(refusalOf('unblock', 'labels')).toBeNull();
  });

  it('accepts ten in native mode, the eleven without unblock', () => {
    expect(yesActionsFor('native')).toEqual(NATIVE_TEN);
    expect(NATIVE_TEN.map((action) => readYesCeiling({ [YES_FLAG]: action }, USAGE, 'native')))
      .toEqual(NATIVE_TEN.map((action) => [action]));
  });

  it('allows four with bare --yes in native mode, the five without unblock', () => {
    expect(bareYesActionsFor('native')).toEqual(['sync', 'wait', 'plan', 'home']);
    expect(readYesCeiling({ [YES_FLAG]: true }, USAGE, 'native')).toEqual(['sync', 'wait', 'plan', 'home']);
  });

  it('refuses a list naming unblock in native mode with exit 2, naming the mode and the ten', () => {
    const alone = refusalOf('unblock', 'native');
    const among = refusalOf('sync, unblock', 'native');

    expect([alone?.exitCode, among?.exitCode]).toEqual([CEILING_REFUSAL_EXIT, CEILING_REFUSAL_EXIT]);
    expect(alone?.message).toBe(`❌ --${YES_FLAG} names unblock, which is offered in labels mode only and`
      + ' board.relationships is native: the tracker clears a blocker when it closes;'
      + ` the ids are ${NATIVE_TEN.join(', ')}\nUsage: ${USAGE}`);
    expect(among?.message).toBe(alone?.message);
    expect(refusalOf(NATIVE_TEN.join(','), 'native')).toBeNull();
  });

  it('names the ten, not the eleven, when native mode refuses a word that is no id', () => {
    expect(refusalOf('mrege', 'native')?.message).toBe(`❌ --${YES_FLAG} names "mrege", which is no step of rafa next;`
      + ` the ids are ${NATIVE_TEN.join(', ')}\nUsage: ${USAGE}`);
  });

  it('still refuses the always-asked ids in native mode, with their own reasons', () => {
    expect(refusalOf('ready', 'native')?.message).toBe(refusalOf('ready')?.message);
    expect(refusalOf('merge-unchecked', 'native')?.message).toBe(refusalOf('merge-unchecked')?.message);
  });
});
