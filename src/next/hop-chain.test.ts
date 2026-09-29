/**
 * Tests for the one-hop decision (`src/next/hop-chain.ts`): hop, wait,
 * halt and stay for H blocked by C, over one literal listing and planted
 * taken readings.
 *
 * The board: home is board #10 at epic #20 (`epic:home`), where H is
 * #100. #10 also lists epic #30 (`other`); board #11 lists epic #40
 * (`far`). #106 is an open issue in no epic and #109 a closed one; #999
 * is on no listing. Branch `feat/103-x` claims #103 and `feat/118-y`
 * claims #118; pull request #7 closes #104 and #8 closes #115.
 *
 * ## The controls
 *
 * Each answer is read beside a C that differs from it in the one thing
 * the answer is about and answers `hop`: #102 free beside #103 and #104
 * taken, #105 blocked by the open #106 beside #108 blocked by the closed
 * #109, #105 labelled `spec:blocked` beside #110 carrying the same line
 * with no label, #113 in the home epic read at home (`stay`) beside the
 * same #113 read away (a hop home), #101 read at home beside #101 read
 * away (`halt`). The taken readings count every ask, so a decision that
 * spent one on a move it refuses fails too.
 */
import type { TakenReadings } from './hop-chain.js';
import type { BoardView } from '../board/epic-board.js';
import type { BoardIssue, BoardIssueState } from '../board/roadmap-board.js';
import type { Place } from '../project/position.js';

import { describe, expect, it } from 'bun:test';

import { typeOfLabels } from '../adapters/tracker/github.js';

import { chainText, decideHop, hopDecisionSentence, oneHopAllows } from './hop-chain.js';

/** One row as the listing reads it. */
function row(number: number, labels: readonly string[], body = '', state: BoardIssueState = 'OPEN'): BoardIssue {
  const stateReason = state === 'CLOSED'
    ? 'COMPLETED'
    : null;
  return { number, title: `Issue ${String(number)}`, body, state, stateReason, labels, type: typeOfLabels(labels), module: 'unassigned' };
}

/** A board whose checklist names `epics`, unticked. */
function board(number: number, epics: readonly number[]): BoardIssue {
  return row(number, ['type:roadmap'], epics.map((epic) => `- [ ] #${String(epic)}`).join('\n'));
}

/** An epic issue whose own slug is `slug`. */
function epic(number: number, slug: string): BoardIssue {
  return row(number, ['type:epic', `epic:${slug}`, 'horizon:now']);
}

/** A `spec:blocked` member of epic `slug` whose body is `body`. */
function blockedIn(number: number, slug: string, body: string): BoardIssue {
  return row(number, [`epic:${slug}`, 'spec:blocked'], body);
}

/** The board the module note describes. */
const LISTING: readonly BoardIssue[] = [
  board(10, [20, 30]),
  board(11, [40]),
  epic(20, 'home'),
  epic(30, 'other'),
  epic(40, 'far'),
  blockedIn(100, 'home', 'Blocked by: #102'),
  row(101, ['epic:other']),
  row(102, ['epic:far']),
  row(103, ['epic:far']),
  row(104, ['epic:far']),
  blockedIn(105, 'far', 'Blocked by: #106'),
  row(106, []),
  blockedIn(107, 'far', 'Blocked by: #100'),
  blockedIn(108, 'far', 'Blocked by: #109'),
  row(109, [], '', 'CLOSED'),
  row(110, ['epic:far'], 'Blocked by: #106'),
  blockedIn(111, 'far', 'Nothing named here.'),
  blockedIn(112, 'far', 'Blocked by: #999'),
  row(113, ['epic:home']),
  row(114, ['type:bug']),
  blockedIn(115, 'far', 'Blocked by: #106'),
  blockedIn(116, 'far', 'Blocked by: #999 #109 #106'),
  blockedIn(117, 'far', 'Blocked by: #101'),
  row(118, ['epic:other']),
];

/** Home: board #10 at epic #20. */
const HOME: Place = { board: 10, epic: 20 };

/** Away: board #11 at epic #40, where a hop to `far` lands. */
const AWAY: Place = { board: 11, epic: 40 };

/** The view of {@link LISTING}, its default board #10. */
function viewOf(listing: readonly BoardIssue[] = LISTING): BoardView {
  return { listing, rows: new Map(listing.map((issue) => [issue.number, issue])), defaultBoard: () => Promise.resolve(10) };
}

/** The taken readings the module note describes, counting each ask. */
function takenOf(): TakenReadings & { readonly asks: () => readonly string[] } {
  let asks: readonly string[] = [];
  const branches = new Map([[103, 'feat/103-x'], [118, 'feat/118-y']]);
  const pulls = new Map([[104, 7], [115, 8]]);
  return {
    branchFor: (issue) => {
      asks = [...asks, `branch ${String(issue)}`];
      return branches.get(issue) ?? null;
    },
    pullRequestFor: (issue) => {
      asks = [...asks, `pull ${String(issue)}`];
      return Promise.resolve(pulls.get(issue) ?? null);
    },
    asks: () => asks,
  };
}

/** Decides for H blocked by `blocker`, read at `current` with home {@link HOME}. */
function decide(blocked: number, blocker: number | string, current: Place = HOME, taken: TakenReadings = takenOf()) {
  return decideHop({ blocked, blocker, position: { current, home: HOME }, view: viewOf(), taken });
}

describe('oneHopAllows', () => {
  it('allows a move that leaves home or comes back to it', () => {
    expect(oneHopAllows(HOME, AWAY, HOME)).toBe(true);
    expect(oneHopAllows(AWAY, HOME, HOME)).toBe(true);
  });

  it('refuses a move whose two ends are both away from home', () => {
    expect(oneHopAllows(AWAY, { board: 10, epic: 30 }, HOME)).toBe(false);
  });

  it('reads a place by board and epic both, so home\'s board at another epic is away', () => {
    expect(oneHopAllows({ board: 10, epic: 30 }, AWAY, HOME)).toBe(false);
    expect(oneHopAllows({ board: 10, epic: null }, AWAY, HOME)).toBe(false);
  });
});

describe('decideHop, hop', () => {
  it('hops to C\'s epic on another board, from home', async () => {
    const decision = await decide(100, 102);

    expect(decision).toEqual({ kind: 'hop', blocked: 100, blocker: 102, epic: 40, slug: 'far', board: 11, from: HOME, to: AWAY });
    expect(Object.isFrozen(decision)).toBe(true);
  });

  it('hops to another epic on home\'s own board', async () => {
    expect(await decide(100, 101)).toMatchObject({ kind: 'hop', epic: 30, board: 10, to: { board: 10, epic: 30 } });
  });

  it('hops when every blocker C names is closed', async () => {
    expect(await decide(100, 108)).toMatchObject({ kind: 'hop', blocker: 108 });
  });

  it('hops when C carries a Blocked by: line without the spec:blocked label', async () => {
    expect(await decide(100, 110)).toMatchObject({ kind: 'hop', blocker: 110 });
  });

  it('asks the branch and then the pull request, once each, before hopping', async () => {
    const taken = takenOf();
    await decide(100, 102, HOME, taken);

    expect(taken.asks()).toEqual(['branch 102', 'pull 102']);
  });
});

describe('decideHop, wait', () => {
  it('waits when a branch claims C, without reading the pull requests', async () => {
    const taken = takenOf();

    expect(await decide(100, 103, HOME, taken)).toEqual({
      kind: 'wait', blocked: 100, blocker: 103, epic: 40, board: 11, taken: { by: 'branch', branch: 'feat/103-x' },
    });
    expect(taken.asks()).toEqual(['branch 103']);
  });

  it('waits when an open pull request closes C', async () => {
    expect(await decide(100, 104)).toEqual({
      kind: 'wait', blocked: 100, blocker: 104, epic: 40, board: 11, taken: { by: 'pull-request', pullRequest: 7 },
    });
  });

  it('waits on a taken C before reading its own blockers', async () => {
    expect(await decide(100, 115)).toMatchObject({ kind: 'wait', blocker: 115, taken: { by: 'pull-request', pullRequest: 8 } });
  });

  it('rejects with the pull request list when it could not be read', async () => {
    const taken: TakenReadings = { branchFor: () => null, pullRequestFor: () => Promise.reject(new Error('gh pr list failed')) };

    await expect(decide(100, 102, HOME, taken)).rejects.toThrow('gh pr list failed');
  });
});

describe('decideHop, halt on C blocked', () => {
  it('halts with the chain when C has an open blocker B', async () => {
    const decision = await decide(100, 105);

    expect(decision).toEqual({
      kind: 'halt',
      reason: 'blocked-blocker',
      chain: { blocked: 100, blocker: 105, next: [106], mutual: false },
      from: HOME,
      to: AWAY,
      fault: null,
    });
    expect(hopDecisionSentence(decision)).toBe('halt: #100 ← #105 ← #106: #105 is blocked in turn');
  });

  it('halts on the mutual block when C is blocked by H itself', async () => {
    const decision = await decide(100, 107);

    expect(decision).toMatchObject({ kind: 'halt', reason: 'blocked-blocker', chain: { next: [100], mutual: true } });
    expect(hopDecisionSentence(decision)).toBe('halt: #100 ← #107 ← #100: #100 and #107 block each other');
  });

  it('counts a blocker the listing does not hold as not cleared', async () => {
    expect(await decide(100, 112)).toMatchObject({ kind: 'halt', chain: { next: [999] } });
  });

  it('names C\'s held blockers in line order, leaving the closed one out', async () => {
    const decision = await decide(100, 116);

    expect(decision).toMatchObject({ kind: 'halt', chain: { next: [999, 106] } });
    expect(hopDecisionSentence(decision)).toStartWith('halt: #100 ← #116 ← #999, #106:');
  });

  it('halts with the fault when C is labelled spec:blocked and names nothing', async () => {
    const decision = await decide(100, 111);

    expect(decision).toMatchObject({ kind: 'halt', reason: 'blocked-blocker', chain: { next: [] } });
    const fault = decision.kind === 'halt'
      ? decision.fault
      : null;
    expect(fault).toStartWith('#111 is labelled spec:blocked');
    expect(hopDecisionSentence(decision)).toBe(`halt: #100 ← #111: ${fault ?? ''}`);
  });
});

describe('decideHop, halt on a move with both ends away', () => {
  it('halts when H read away is blocked by C in a third place', async () => {
    const taken = takenOf();
    const decision = await decide(117, 101, AWAY, taken);

    expect(decision).toEqual({
      kind: 'halt',
      reason: 'both-away',
      chain: { blocked: 117, blocker: 101, next: [], mutual: false },
      from: AWAY,
      to: { board: 10, epic: 30 },
      fault: null,
    });
    expect(taken.asks()).toEqual([]);
    expect(hopDecisionSentence(decision)).toBe(
      'halt: #117 ← #101: the move from epic #40 on board #11 to epic #30 on board #10 has neither end at home',
    );
  });

  it('halts rather than waiting when the C a second hop would reach is taken', async () => {
    expect(await decide(117, 118, AWAY)).toMatchObject({ kind: 'halt', reason: 'both-away' });
  });

  it('allows the move from away when C sits in the home epic, since it ends at home', async () => {
    expect(await decide(117, 113, AWAY)).toMatchObject({ kind: 'hop', from: AWAY, to: HOME });
  });
});

describe('decideHop, stay', () => {
  it('stays when C is in the epic H was read in', async () => {
    const decision = await decide(100, 113);

    expect(decision).toEqual({ kind: 'stay', blocked: 100, located: { kind: 'no-hop', blocker: 113, reason: 'same-epic', epic: 20 } });
    expect(hopDecisionSentence(decision)).toBe(
      '#100 stays: #113 (epic #20) is in the home epic, so there is no other epic to hop to',
    );
  });

  it('stays when C carries no epic label', async () => {
    expect(await decide(100, 114)).toMatchObject({ kind: 'stay', located: { reason: 'no-epic-label' } });
  });

  it('stays on a cross-repository C without asking whether it is taken', async () => {
    const taken = takenOf();

    expect(await decide(100, 'owner/repo#5', HOME, taken)).toMatchObject({ kind: 'stay', located: { reason: 'cross-repository' } });
    expect(taken.asks()).toEqual([]);
  });
});

describe('hopDecisionSentence', () => {
  it('prints a hop as the spec\'s log line', async () => {
    expect(hopDecisionSentence(await decide(100, 102))).toBe('hop from epic #20: #100 blocked by #102, in epic #40');
  });

  it('names the board a hop left when no epic was chosen there', async () => {
    const decision = await decideHop({
      blocked: 100, blocker: 102, position: { current: { board: 10, epic: null }, home: { board: 10, epic: null } }, view: viewOf(), taken: takenOf(),
    });

    expect(hopDecisionSentence(decision)).toBe('hop from board #10: #100 blocked by #102, in epic #40');
  });

  it('prints a wait with what took C', async () => {
    expect(hopDecisionSentence(await decide(100, 103))).toBe('#100 waits on #103, taken: branch feat/103-x exists');
    expect(hopDecisionSentence(await decide(100, 104))).toBe('#100 waits on #104, taken: PR #7 open');
  });
});

describe('chainText', () => {
  it('spells the chain with and without C\'s blockers', () => {
    expect(chainText({ blocked: 210, blocker: 118, next: [90], mutual: false })).toBe('#210 ← #118 ← #90');
    expect(chainText({ blocked: 210, blocker: 118, next: [], mutual: false })).toBe('#210 ← #118');
  });
});
