/**
 * Tests for the offer `plan create` makes on an unlabelled issue
 * (`ready-offer.ts`): the terminal read that decides whether there is an
 * offer at all, the lines one prints, the issue it hands over instead of
 * reading again, the prompter it opens only to ask, and the refusals it
 * passes on.
 *
 * `../issue/ready.test.ts` drives the run itself and this file drives
 * none of that again. What only this file can see is the WIRING: that
 * the issue the route already read is what the run is given, that the
 * answer is the label and not the question, and that a run with no
 * terminal hands `resolvePlanSpec` no offer at all rather than one that
 * answers false.
 *
 * Every case plants a `gh` runner, a trust and an output of its own, so
 * none reaches GitHub, spawns anything or waits on an answer. The
 * planted runner ANSWERS NO `issue view`: a wiring that re-read the
 * issue would reject with `no route for issue view 20` rather than
 * quietly costing a command, which is the reading the handed-over issue
 * is held by.
 *
 * ## The controls
 *
 * - The terminal case is a pair over the same seams, one answering true
 *   and one false, so "no offer" is held against an offer being made.
 * - The yes case is paired with the same board answered no: one writes
 *   the swap and answers true, the other writes nothing and answers
 *   false. A wiring that answered the question rather than the label
 *   would look right on the first half alone.
 * - The completeness refusal plants a prompter that THROWS when opened,
 *   paired with the yes case above, which opens one: that is what holds
 *   "nobody was asked about a body with gaps".
 *
 * ## What passes while wrong
 *
 * Three mutations were driven on 2026-09-21, one at a time, over
 * `env -u CLAUDECODE bun test src/board/plan-spec.test.ts
 * ./ready-offer.test.ts`, the module restored from a scratch copy and
 * verified with `shasum -c` each time, against 38 pass and 0 fail
 * either side:
 *
 *  - the terminal reading spent and ignored, so there is always an
 *    offer: 37 pass and 1 fail, the terminal pair alone. Nothing else
 *    here notices, because every other case asks for an offer.
 *  - the answer taken off the question rather than off the label
 *    (`status !== 'unasked'` for `status === 'marked'`): 36 pass and 2
 *    fail, the two cases that answer no. A wiring that reported every
 *    run it finished as marked would let `plan create` go on to plan
 *    from an issue nobody marked ready.
 *  - the `readIssue` seam dropped, so the run reads the issue again
 *    through `gh`: 33 pass and 5 fail, every case that drives the real
 *    run, since the planted runner answers no `issue view`. That is the
 *    reading which holds the no-second-read claim.
 */
import type { GhResult, GhRunner } from '../../adapters/tracker/github.js';
import type { SpecIssue } from '../../board/issue.js';
import type { BoardTrust } from '../../board/trust.js';
import type { Prompter } from '../../cli/prompt/confirm.js';
import type { ReadyOptions, ReadyReport } from '../issue/ready.js';

import { describe, expect, it } from 'bun:test';

import { SPEC_NEEDS_WORK_LABEL } from '../../board/gate.js';
import { SPEC_LABEL } from '../../board/issue.js';
import { SPEC_READY_LABEL } from '../../board/readiness.js';
import { CommandExit } from '../../cli/command.js';
import { sinkOutput } from '../../tests/output-sinks.js';
import { completeSpecBody } from '../../tests/spec-bodies.js';

import { createPlanReadyOffer, offerHeadLine } from './ready-offer.js';

/** The repository a trust sentence names. */
const REPO = 'github.com/open-tomato/rafa';

/** A body filling every template heading, so the completeness check passes. */
const COMPLETE = completeSpecBody('Issue 20');

/** A body filling none of them, so the completeness check refuses. */
const THIN = 'Make the thing work.\n';

/** The issue a case offers over: unlabelled, complete and opened by a write-holder. */
function issueOf(fields: Partial<SpecIssue> = {}): SpecIssue {
  return {
    number: 20,
    title: 'Issue 20',
    body: COMPLETE,
    state: 'OPEN',
    labels: [SPEC_LABEL],
    author: 'maintainer',
    ...fields,
  };
}

/** A trust whose lookup answers one permission, and the logins it was asked about. */
function fakeTrust(permission = 'admin'): { trust: BoardTrust; lookups: () => readonly string[] } {
  const lookups: string[] = [];
  const trust: BoardTrust = {
    permissions: (login) => {
      lookups.push(login);
      return Promise.resolve({ login, permission, roleName: permission, detail: '' });
    },
    trustedAuthors: [],
    repo: REPO,
  };
  return { trust, lookups: () => lookups };
}

/**
 * A runner that answers the label swap and nothing else, keeping every
 * command it was sent. An `issue view` is a failure on purpose; the
 * module note holds why.
 */
function plantedGh(): { gh: GhRunner; sent: () => readonly string[] } {
  let sent: readonly string[] = [];
  const gh: GhRunner = (args) => {
    sent = [...sent, args.join(' ')];
    const answer: GhResult = args[0] === 'issue' && args[1] === 'edit'
      ? { ok: true, stdout: '', stderr: '' }
      : { ok: false, stdout: '', stderr: `no route for ${args.join(' ')}` };
    return Promise.resolve(answer);
  };
  return { gh, sent: () => sent };
}

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
    throw new Error('the offer opened a prompter for an issue it refuses');
  };
}

/** What a thrown `CommandExit` carried. */
async function refusal(run: () => Promise<unknown>): Promise<CommandExit> {
  try {
    await run();
  } catch (error) {
    if (error instanceof CommandExit) return error;
    throw error;
  }
  throw new Error('expected a CommandExit, and the call answered instead');
}

/** An output keeping every info line. */
function keptLines(): { output: ReturnType<typeof sinkOutput>; lines: () => readonly string[] } {
  const lines: string[] = [];
  return { output: sinkOutput({ info: (line) => lines.push(line) }), lines: () => lines };
}

describe('the offer a run has to make', () => {
  it('answers no offer where standard input is no terminal, and one where it is', () => {
    const seams = { openPrompter: unopenedPrompter() };

    const none = createPlanReadyOffer({ ...seams, isTerminal: () => false });
    const made = createPlanReadyOffer({ ...seams, isTerminal: () => true });

    expect(none).toBeNull();
    expect(made).not.toBeNull();
  });

  it('names the label that is missing and the command the lines under it come from', () => {
    expect(offerHeadLine(20)).toBe('🏷  issue #20 is not marked spec:ready'
      + ' — reading it as rafa issue ready 20 would.');
  });
});

describe('the question, and what each answer comes to', () => {
  it('prints the head line and the three readings, swaps the labels on a yes and answers true', async () => {
    const board = plantedGh();
    const prompter = scriptedPrompter('y');
    const kept = keptLines();
    const offer = createPlanReadyOffer({ isTerminal: () => true, openPrompter: prompter.open });

    const marked = await offer?.({ issue: issueOf(), gh: board.gh, trust: fakeTrust().trust, output: kept.output });

    expect(marked).toBe(true);
    expect(prompter.asked()).toEqual(['Mark #20 spec:ready? [y/N] ']);
    expect(kept.lines()).toEqual([
      offerHeadLine(20),
      `#20 was opened by maintainer, who has write access to ${REPO}`,
      '#20 fills every heading the spec template asks for, with no placeholder left',
      'Marked #20 spec:ready, and took spec:needs-work off it',
    ]);
    // The one command an offer sends, and no `issue view` beside it:
    // the issue the route read is what the run was handed.
    expect(board.sent()).toEqual([`issue edit 20 --remove-label ${SPEC_NEEDS_WORK_LABEL} --add-label ${SPEC_READY_LABEL}`]);
    expect(prompter.closes()).toBe(1);
  });

  it('writes nothing and answers false when the same issue is answered no', async () => {
    const board = plantedGh();
    const prompter = scriptedPrompter('n');
    const kept = keptLines();
    const offer = createPlanReadyOffer({ isTerminal: () => true, openPrompter: prompter.open });

    const marked = await offer?.({ issue: issueOf(), gh: board.gh, trust: fakeTrust().trust, output: kept.output });

    expect(marked).toBe(false);
    expect(prompter.asked()).toHaveLength(1);
    expect(board.sent()).toEqual([]);
    expect(kept.lines().at(-1)).toBe('#20 was left unmarked');
    expect([prompter.opens(), prompter.closes()]).toEqual([1, 1]);
  });
});

describe('the run the offer makes', () => {
  it('hands over the issue the route read, with the question to ask and the trust already built', async () => {
    const taken: ReadyOptions[] = [];
    const issue = issueOf({ body: THIN });
    const trust = fakeTrust();
    const report: ReadyReport = {
      issue: 20,
      status: 'marked',
      author: 'maintainer',
      trustedBy: 'permission',
      trust: 'the trust line',
      checked: 'the checked line',
      message: 'the outcome line',
    };
    const offer = createPlanReadyOffer({
      isTerminal: () => true,
      openPrompter: unopenedPrompter(),
      run: (options) => {
        taken.push(options);
        return Promise.resolve(report);
      },
    });

    const marked = await offer?.({ issue, gh: plantedGh().gh, trust: trust.trust, output: sinkOutput({}) });

    expect(marked).toBe(true);
    expect(taken).toHaveLength(1);
    expect(taken[0]?.issue).toBe(20);
    expect(taken[0]?.trust).toBe(trust.trust);
    expect(taken[0]?.ask).not.toBeNull();
    // The body the run is given is the body the route read, gaps and
    // all, and not one a second `gh issue view` answered.
    await expect(taken[0]?.readIssue?.(20)).resolves.toBe(issue);
  });

  it('answers false for a run that marked nothing, whatever it was asked', async () => {
    const declined: ReadyReport = {
      issue: 20,
      status: 'declined',
      author: 'maintainer',
      trustedBy: 'permission',
      trust: 'the trust line',
      checked: 'the checked line',
      message: 'the outcome line',
    };
    const kept = keptLines();
    const offer = createPlanReadyOffer({
      isTerminal: () => true,
      openPrompter: unopenedPrompter(),
      run: () => Promise.resolve(declined),
    });

    const marked = await offer?.({
      issue: issueOf(),
      gh: plantedGh().gh,
      trust: fakeTrust().trust,
      output: kept.output,
    });

    expect(marked).toBe(false);
    expect(kept.lines()).toEqual([offerHeadLine(20), 'the trust line', 'the checked line', 'the outcome line']);
  });
});

describe('the refusals the offer passes on', () => {
  it('refuses a body with gaps with exit 2, opening no prompter and sending no command', async () => {
    const board = plantedGh();
    const offer = createPlanReadyOffer({ isTerminal: () => true, openPrompter: unopenedPrompter() });

    const refused = await refusal(() => offer?.({
      issue: issueOf({ body: THIN }),
      gh: board.gh,
      trust: fakeTrust().trust,
      output: sinkOutput({}),
    }) ?? Promise.resolve(false));

    expect(refused.exitCode).toBe(2);
    expect(refused.message).toContain('issue #20 is not ready to plan from');
    expect(board.sent()).toEqual([]);
  });

  it('refuses an issue an outsider opened with exit 2, before the body and before the question', async () => {
    const board = plantedGh();
    const offer = createPlanReadyOffer({ isTerminal: () => true, openPrompter: unopenedPrompter() });

    const refused = await refusal(() => offer?.({
      issue: issueOf({ body: THIN, author: 'outsider' }),
      gh: board.gh,
      trust: fakeTrust('read').trust,
      output: sinkOutput({}),
    }) ?? Promise.resolve(false));

    expect(refused.exitCode).toBe(2);
    expect(refused.message).toBe(`issue #20 was opened by outsider, who has no write access to ${REPO};`
      + ' a member must open the spec');
    // The body has gaps too, and none of its headings is named: the
    // author is weighed first, as `issue ready` weighs it.
    expect(refused.message).not.toContain('is missing');
    expect(board.sent()).toEqual([]);
  });
});
