/**
 * Tests for `--yes` as a risk ceiling (`ceiling.ts`): the eight ids a
 * list may name, the four bare `--yes` allows, the two lists refused
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
 *  - The eight ids are read as a literal list AND as the action table
 *    with the two always-asked ids dropped, so a list spelled twice
 *    cannot drift apart unnoticed: the first would pass over a
 *    hand-written copy.
 *  - The four bare `--yes` allows are read beside the four it leaves
 *    out, so a bare flag that named all eight would fail rather than
 *    satisfy a check that the four are among them.
 *  - Each refusal is read beside a list that is NOT refused —
 *    {@link refusalOf} answers null where nothing was thrown — so a
 *    reader that refused everything could not pass.
 *  - `ready` and `merge-unchecked` are each read as refused in a list
 *    and as unaskable in a ceiling built in code, beside the seven ids
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
 */
import type { NextActionId } from './state.js';

import { describe, expect, it } from 'bun:test';

import { CommandExit } from '../cli/command.js';

import { NEXT_COMMAND_ACTIONS } from './actions.js';
import {
  allowedUnasked,
  ALWAYS_ASKED,
  BARE_YES_ACTIONS,
  CEILING_REFUSAL_EXIT,
  readYesCeiling,
  YES_ACTIONS,
  YES_FLAG,
} from './ceiling.js';

/** The usage line the caller hands the reading, which every refusal names. */
const USAGE = 'rafa next [--dry-run] [--yes[=<action ids>]]';

/** The eight, spelled out: what a person may type, held against the table below. */
const EIGHT: readonly NextActionId[] = ['sync', 'resume', 'wait', 'triage', 'merge', 'start', 'plan', 'unblock'];

/** The ceiling `--yes=<value>` reads to. */
function ceilingOf(value: boolean | string): readonly NextActionId[] | null {
  return readYesCeiling({ [YES_FLAG]: value }, USAGE);
}

/** The refusal `--yes=<value>` earns, or null where the list was read without one. */
function refusalOf(value: string): CommandExit | null {
  try {
    readYesCeiling({ [YES_FLAG]: value }, USAGE);
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

  it('accepts eight: sync and the command actions but the two that are always asked', () => {
    expect(YES_ACTIONS).toEqual(EIGHT);
    expect(YES_ACTIONS).toHaveLength(8);
    expect(YES_ACTIONS.filter((action) => ALWAYS_ASKED.has(action))).toEqual([]);
    expect(YES_ACTIONS).not.toContain('none');
  });

  it('takes the seven that run a command off the action table rather than spelling them again', () => {
    expect(YES_ACTIONS.filter((action) => action !== 'sync'))
      .toEqual(NEXT_COMMAND_ACTIONS.filter((action) => action !== 'ready' && action !== 'merge-unchecked'));
  });

  it('reads each of the eight, one at a time, as the id it spells', () => {
    expect(YES_ACTIONS.map((action) => ceilingOf(action))).toEqual(YES_ACTIONS.map((action) => [action]));
  });
});

describe('the four bare --yes allows', () => {
  it('names the four that neither merge, nor start a loop, nor push, and leaves the other four out', () => {
    expect(BARE_YES_ACTIONS).toEqual(['sync', 'wait', 'unblock', 'plan']);
    expect(ceilingOf(true)).toEqual(BARE_YES_ACTIONS);
    expect(YES_ACTIONS.filter((action) => !BARE_YES_ACTIONS.includes(action)))
      .toEqual(['resume', 'triage', 'merge', 'start']);
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

  it('refuses a list naming no id of the table with exit 2, naming the eight and the usage', () => {
    const refused = refusalOf('mrege,sync');

    expect(refused?.exitCode).toBe(CEILING_REFUSAL_EXIT);
    expect(refused?.message).toBe(`❌ --${YES_FLAG} names "mrege", which is no step of rafa next;`
      + ` the ids are ${EIGHT.join(', ')}\nUsage: ${USAGE}`);
  });

  it('reads an id spelled with a capital as no id at all', () => {
    expect(refusalOf('Merge')?.exitCode).toBe(CEILING_REFUSAL_EXIT);
  });

  it('refuses no list the eight spell, however they are padded or ordered', () => {
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

  it('allows each of the eight a ceiling names, and never ready, whatever the ceiling holds', () => {
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
