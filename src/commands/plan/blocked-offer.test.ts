/**
 * Tests for the offer `plan create --next` makes past a blocked line
 * (`blocked-offer.ts`): the terminal read that decides whether there is
 * an offer at all, the one question it puts, what each answer comes to,
 * and the prompter it opens only to ask.
 *
 * `../../board/blocked-line.test.ts` drives the reading and the walk
 * behind the question and this file drives neither again. What only this
 * file can see is the WIRING: that a run with no terminal is handed NO
 * offer rather than one answering false, that the number asked about is
 * the alternative's and never the blocked line's, and that the terminal
 * is closed whichever way the answer goes.
 *
 * Every case plants a prompter of its own, so none opens a terminal,
 * reads standard input or waits on an answer.
 *
 * ## The controls
 *
 * - The terminal case is a pair over the same seams, one answering true
 *   and one false, so "no offer" is held against an offer being made.
 * - The yes case is paired with the same request answered `n`: one
 *   answers true and the other false off the same question, which is
 *   what holds the answer to the ANSWER rather than to the asking.
 * - The number the question names is asserted against a request whose
 *   blocked line and alternative are different issues, so a question
 *   built from the wrong one of the two cannot pass.
 *
 * ## What passes while wrong
 *
 * Two mutations were driven on 2026-09-21, one at a time, over
 * `env -u CLAUDECODE bun test src/commands/plan/blocked-offer.test.ts`,
 * the module restored from a scratch copy and verified with `shasum -c`
 * each time, against 6 pass and 0 fail either side:
 *
 *  - the terminal reading spent and ignored, so there is always an
 *    offer: 5 pass and 1 fail, the terminal pair alone. Every other case
 *    asks for an offer, so nothing else here notices.
 *  - the question asked about `request.blocked.issue` rather than
 *    `request.line.issue`: 4 pass and 2 fail, the two cases that read
 *    the question back. A run that asked "plan the blocked line
 *    instead?" would collect a yes for the one issue that cannot be
 *    planned.
 */
import type { BlockedLine } from '../../board/blocked-line.js';
import type { RoadmapLine } from '../../board/roadmap.js';
import type { Prompter } from '../../cli/prompt/confirm.js';

import { describe, expect, it } from 'bun:test';

import { alternativeQuestion } from '../../board/blocked-line.js';

import { createPlanBlockedOffer } from './blocked-offer.js';

/** The blocked line every case offers past: #57, waiting on an open #24. */
const BLOCKED: BlockedLine = Object.freeze({
  issue: 57,
  blockers: [24],
  open: [24],
  unread: [],
  fault: null,
});

/** The line offered in its place: a different issue, so the two cannot be confused. */
const ALTERNATIVE: RoadmapLine = Object.freeze({
  issue: 58,
  ticked: false,
  why: 'the ending hint',
  lineNumber: 4,
});

/** A prompter answering one line, counting the times it was opened and closed. */
function scriptedPrompter(answer: string): {
  open: () => Prompter;
  asked: () => readonly string[];
  opens: () => number;
  closes: () => number;
} {
  const asked: string[] = [];
  let opens = 0;
  let closes = 0;
  const open = (): Prompter => {
    opens += 1;
    return {
      say: () => undefined,
      ask: (question: string) => {
        asked.push(question);
        return Promise.resolve(answer);
      },
      close: () => {
        closes += 1;
      },
    };
  };
  return { open, asked: () => asked, opens: () => opens, closes: () => closes };
}

/** A prompter no case may open. */
function unopenedPrompter(): () => Prompter {
  return (): Prompter => {
    throw new Error('the offer opened a prompter for a run that asks nothing');
  };
}

describe('the offer a run has to make', () => {
  it('answers no offer where standard input is no terminal, and one where it is', () => {
    const seams = { openPrompter: unopenedPrompter() };

    const none = createPlanBlockedOffer({ ...seams, isTerminal: () => false });
    const made = createPlanBlockedOffer({ ...seams, isTerminal: () => true });

    expect(none).toBeNull();
    expect(made).not.toBeNull();
  });

  it('opens nothing until it is called, so a run that reaches no blocked line asks nobody', () => {
    const prompter = scriptedPrompter('y');

    createPlanBlockedOffer({ isTerminal: () => true, openPrompter: prompter.open });

    expect(prompter.opens()).toBe(0);
  });
});

describe('the question, and what each answer comes to', () => {
  it('asks about the line offered instead, by number, and answers true to a yes', async () => {
    const prompter = scriptedPrompter('y');
    const offer = createPlanBlockedOffer({ isTerminal: () => true, openPrompter: prompter.open });

    const planned = await offer?.({ blocked: BLOCKED, line: ALTERNATIVE });

    expect(planned).toBe(true);
    expect(prompter.asked()).toEqual([alternativeQuestion(58)]);
    expect(prompter.asked()[0]).toBe('Plan #58 instead? [y/N] ');
    expect([prompter.opens(), prompter.closes()]).toEqual([1, 1]);
  });

  it('answers false to the same question answered no, and closes the terminal either way', async () => {
    const prompter = scriptedPrompter('n');
    const offer = createPlanBlockedOffer({ isTerminal: () => true, openPrompter: prompter.open });

    const planned = await offer?.({ blocked: BLOCKED, line: ALTERNATIVE });

    expect(planned).toBe(false);
    expect(prompter.asked()).toEqual([alternativeQuestion(58)]);
    expect([prompter.opens(), prompter.closes()]).toEqual([1, 1]);
  });

  it('answers false to an empty line, which is what pressing return means here', async () => {
    const prompter = scriptedPrompter('');
    const offer = createPlanBlockedOffer({ isTerminal: () => true, openPrompter: prompter.open });

    expect(await offer?.({ blocked: BLOCKED, line: ALTERNATIVE })).toBe(false);
  });

  it('closes the terminal when the prompter throws, leaving no open handle behind', async () => {
    let closes = 0;
    const offer = createPlanBlockedOffer({
      isTerminal: () => true,
      openPrompter: (): Prompter => ({
        say: () => undefined,
        ask: () => Promise.reject(new Error('standard input went away')),
        close: () => {
          closes += 1;
        },
      }),
    });

    await expect(offer?.({ blocked: BLOCKED, line: ALTERNATIVE })).rejects.toThrow('standard input went away');
    expect(closes).toBe(1);
  });
});
