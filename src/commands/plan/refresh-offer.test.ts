/**
 * Tests for the question `plan create` asks over a changed issue body
 * (`refresh-offer.ts`): the terminal read that decides whether there is
 * an offer at all, the question it puts, the answers that read as yes,
 * and the prompter it opens only to ask and always closes.
 *
 * `src/board/snapshot-settle.test.ts` drives what the answer DOES — the
 * rebuild on a yes, the refusal on a no — and this file drives none of
 * that again. Every case plants a terminal reading and a prompter of its
 * own, so none reads standard input or waits on an answer.
 *
 * ## The controls
 *
 * - The terminal case is a pair over the same seams, one answering true
 *   and one false, so "no offer" is held against an offer being made.
 * - Every answer read as no is held beside `y` and `yes` over the same
 *   prompter, so an offer answering a constant fails one half.
 * - "Opened only to ask" is held against the case that asks and counts
 *   one opening, so a count of zero is not a prompter never reachable.
 *
 * ## What passes while wrong
 *
 * Three mutations were driven on 2026-09-22, one at a time, over
 * `env -u CLAUDECODE bun test ./refresh-offer.test.ts`, the module
 * restored from a scratch copy and verified with `shasum -c` after,
 * against 8 pass and 0 fail unmutated:
 *
 *  - the terminal reading spent and ignored, so there is always an
 *    offer: 7 pass and 1 fail, the terminal pair alone.
 *  - every answer read as yes: 6 pass and 2 fail, the two cases that
 *    read no. An offer like that would plan from a body nobody agreed to.
 *  - the prompter never closed: 6 pass and 2 fail, the two prompter
 *    cases. A prompter left open holds standard input past the question.
 */
import type { RefreshOfferRequest } from '../../board/snapshot-settle.js';
import type { Prompter } from '../../project/root-choice.js';

import { describe, expect, it } from 'bun:test';

import { refreshQuestion } from '../../board/snapshot-settle.js';

import { createPlanRefreshOffer } from './refresh-offer.js';

/** When the saved copy a case asks about was taken. */
const SAVED_AT = new Date('2026-09-20T23:30:00Z');

/** The request a case asks with. */
const REQUEST: RefreshOfferRequest = {
  issue: 20,
  path: '.rafa/specs/rafa-20.md',
  savedAt: SAVED_AT,
};

/** A prompter answering `answer`, and what was asked, opened and closed through it. */
interface Scripted {
  readonly open: () => Prompter;
  readonly asked: () => readonly string[];
  readonly opened: () => number;
  readonly closed: () => number;
}

/** A prompter answering every question with `answer`, or rejecting with it when it is an Error. */
function scripted(answer: string | null | Error): Scripted {
  let asked: readonly string[] = [];
  let opened = 0;
  let closed = 0;
  const prompter: Prompter = {
    say: () => undefined,
    ask: (question) => {
      asked = [...asked, question];
      return answer instanceof Error
        ? Promise.reject(answer)
        : Promise.resolve(answer);
    },
    close: () => {
      closed += 1;
    },
  };
  return {
    open: () => {
      opened += 1;
      return prompter;
    },
    asked: () => asked,
    opened: () => opened,
    closed: () => closed,
  };
}

/** The offer over a terminal and `script`, failing the case when there is none. */
function offerOver(script: Scripted) {
  const offer = createPlanRefreshOffer({ isTerminal: () => true, openPrompter: script.open });
  if (offer === null) throw new Error('expected an offer over a terminal');
  return offer;
}

describe('createPlanRefreshOffer and the terminal', () => {
  it('answers null with no terminal and an offer with one, opening no prompter either way', () => {
    const script = scripted('y');

    const without = createPlanRefreshOffer({ isTerminal: () => false, openPrompter: script.open });
    const within = createPlanRefreshOffer({ isTerminal: () => true, openPrompter: script.open });

    expect(without).toBeNull();
    expect(within).not.toBeNull();
    expect(script.opened()).toBe(0);
  });

  it('reads the terminal once, when it is made, and not on each question', async () => {
    let readings = 0;
    const script = scripted('y');
    const offer = createPlanRefreshOffer({
      isTerminal: () => {
        readings += 1;
        return true;
      },
      openPrompter: script.open,
    });
    expect(readings).toBe(1);

    await offer?.(REQUEST);
    await offer?.(REQUEST);

    expect(readings).toBe(1);
  });
});

describe('createPlanRefreshOffer and the question', () => {
  it('asks the dated question once, naming the issue and the saved copy\'s UTC date', async () => {
    const script = scripted('y');

    await offerOver(script)(REQUEST);

    expect(script.asked()).toEqual([refreshQuestion(20, SAVED_AT)]);
    expect(script.asked()).toEqual([
      'Issue #20 changed since the saved copy of 2026-09-20. Plan from it as it reads now? [y/N] ',
    ]);
  });

  it('reads y and yes as yes, trimmed and in any case', async () => {
    for (const answer of ['y', 'yes', 'Y', ' YES ']) {
      expect(await offerOver(scripted(answer))(REQUEST)).toBe(true);
    }
  });

  it('reads anything else as no, the empty answer included', async () => {
    for (const answer of ['n', 'no', '', 'yep', 'sure']) {
      expect(await offerOver(scripted(answer))(REQUEST)).toBe(false);
    }
  });

  it('reads an input that ended before an answer as no', async () => {
    const script = scripted(null);

    expect(await offerOver(script)(REQUEST)).toBe(false);
    expect(script.asked()).toHaveLength(1);
  });
});

describe('createPlanRefreshOffer and the prompter', () => {
  it('opens a prompter to ask and closes it after the answer, once per question', async () => {
    const script = scripted('n');
    const offer = offerOver(script);

    await offer(REQUEST);
    expect([script.opened(), script.closed()]).toEqual([1, 1]);

    await offer(REQUEST);
    expect([script.opened(), script.closed()]).toEqual([2, 2]);
  });

  it('throws on what the prompter throws, and closes it all the same', async () => {
    const script = scripted(new Error('the terminal went away'));

    await expect(offerOver(script)(REQUEST)).rejects.toThrow('the terminal went away');
    expect([script.opened(), script.closed()]).toEqual([1, 1]);
  });
});
