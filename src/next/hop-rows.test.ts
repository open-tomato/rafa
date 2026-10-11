/**
 * Tests for the hop rows (`./hop-rows.ts`) as `./state.ts` reads them:
 * only when the sources carry `roadmap`, each just ahead of the row the
 * state module note names.
 *
 * `./state.test.ts` is over 800 lines, so these cases live here, over
 * fakes of their own: a `GitRunner` answering by argv, the pull request
 * double (`src/pr/pull-requests-double.ts`), a board answering a planted
 * walk, an owner gate answering a planted approval, and a plans
 * directory under a temporary root. Nothing here spawns `git`, spawns
 * `gh` or reaches GitHub.
 *
 * ## The controls
 *
 * Every row is driven twice at least: once with its reading planted and
 * `roadmap` set, which it must answer, and once with the same reading
 * and `roadmap` left out, or with the one fact it keys on taken away,
 * where the plain row it sits ahead of must answer instead. A row that
 * answered without `roadmap` would fail the first kind; a row that
 * answered for a situation it does not name would fail the second.
 */
import type { HopDecision, HopHalt, HopMove } from './hop-chain.js';
import type { HopRecord } from './hop-record.js';
import type { NextBoard, NextHopReading, NextRoadmapReading, NextSources } from './readings.js';
import type { BlockedLine } from '../board/blocked-line.js';
import type { NextNowEpic } from '../board/epic-walk.js';
import type { ChecksVerdict, GitResult, Mergeability, PullRequestDetail, PullRequests, PullRequestSummary } from '../pr/index.js';
import type { OwnerApproval } from '../pr/owner-approval.js';
import type { Position } from '../project/position.js';

import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { plansDirAt } from '../plan/plan-files.js';
import { createPullRequestsDouble } from '../pr/pull-requests-double.js';

import { NEXT_ROADMAP_STATES, NEXT_STATES, readNextState } from './state.js';

/** A temporary directory of this file's own. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-next-hop-rows-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** The base branch every case runs against. */
const BASE = 'main';

/** The branch a pull request is open on. */
const HEAD = 'feat/rafa-118-the-blocker';

/** The home board, and the epic the walk descended into on it. */
const HOME_BOARD = 10;
const HOME_EPIC = 20;

/** The other board, and the epic on it that holds C. */
const AWAY_BOARD = 11;
const AWAY_EPIC = 40;

/** H, C and B. */
const H = 210;
const C = 118;
const B = 90;

/** C's pull request. */
const PR = 57;

/** Home as a position with no epic chosen names it. */
const HOME = Object.freeze({ board: HOME_BOARD, epic: null });

/** Where H was read: the home board, inside the epic the walk descended into. */
const H_PLACE = Object.freeze({ board: HOME_BOARD, epic: HOME_EPIC });

/** C's place. */
const C_PLACE = Object.freeze({ board: AWAY_BOARD, epic: AWAY_EPIC });

/** A position standing at home. */
const AT_HOME: Position = Object.freeze({ current: HOME, previous: null, home: HOME });

/** A position a hop moved away. */
const AWAY: Position = Object.freeze({ current: C_PLACE, previous: HOME, home: HOME });

/** A plan with one task open. */
const OPEN_PLAN = ['# Plan: one', '', '# Stage: one', '', '- [ ] first', ''].join('\n');

/** The hop decision: H blocked by C, in the other board's epic. */
const MOVE: HopMove = Object.freeze({
  kind: 'hop',
  blocked: H,
  blocker: C,
  epic: AWAY_EPIC,
  slug: 'the-other-epic',
  board: AWAY_BOARD,
  from: H_PLACE,
  to: C_PLACE,
});

/** A halt with the chain `#H ← #C ← #next`. */
function halt(next: readonly number[]): HopHalt {
  return {
    kind: 'halt',
    reason: 'blocked-blocker',
    chain: { blocked: H, blocker: C, next, mutual: next.includes(H) },
    from: H_PLACE,
    to: C_PLACE,
    fault: null,
  };
}

/** A blocker hop's record, away unless `over` says otherwise. */
function record(over: Partial<HopRecord> = {}): HopRecord {
  return {
    kind: 'blocker',
    home: HOME,
    from: H_PLACE,
    blocked: H,
    target: C,
    targetEpic: AWAY_EPIC,
    targetBoard: AWAY_BOARD,
    state: 'away',
    pullRequest: null,
    startedAt: '2026-09-28T10:00:00Z',
    ...over,
  };
}

/** A dry hop's record, away. */
function dryRecord(): HopRecord {
  return record({ kind: 'dry', blocked: null, target: null, targetEpic: 30, targetBoard: HOME_BOARD });
}

/** The next `now` epic after {@link HOME_EPIC}. */
const NEXT_EPIC: NextNowEpic = Object.freeze({
  number: 30,
  title: 'The next epic',
  slug: 'the-next-epic',
  board: HOME_BOARD,
  line: { issue: 30, ticked: false, why: '', lineNumber: 5 },
  progress: { done: 0, total: 3, notPlanned: 0 },
});

/** A hop reading, empty unless `over` fills it. */
function hopReading(over: Partial<NextHopReading> = {}): NextHopReading {
  return {
    record: null,
    stale: null,
    position: AT_HOME,
    target: null,
    waiting: [],
    decision: null,
    nextEpic: null,
    ...over,
  };
}

/** A walk answering `issue` as the line, with `hop` carried. */
function walkTo(issue: number, hop: NextHopReading): NextRoadmapReading {
  return {
    roadmap: HOME_BOARD,
    line: { issue, ticked: false, why: '', lineNumber: 3 },
    passed: 1,
    problems: [],
    hop,
  };
}

/** A walk that ran dry in {@link HOME_EPIC}, with `hop` carried. */
function walkDry(hop: NextHopReading): NextRoadmapReading {
  return {
    roadmap: HOME_BOARD,
    line: null,
    passed: 4,
    problems: [],
    dryEpic: { number: HOME_EPIC, title: 'The home epic' },
    hop,
  };
}

/** A walk answering no line, the away target read, with `hop` carried. */
function walkNone(hop: NextHopReading): NextRoadmapReading {
  return { roadmap: HOME_BOARD, line: null, passed: 0, problems: [], hop };
}

/** H waiting on C. */
const H_BLOCKED: BlockedLine = Object.freeze({ issue: H, blockers: [C], open: [C], unread: [], fault: null });

/** C waiting on B. */
const C_BLOCKED: BlockedLine = Object.freeze({ issue: C, blockers: [B], open: [B], unread: [], fault: null });

/** The open pull request a case plants. */
interface PlantedPull {
  readonly verdict: ChecksVerdict;
  readonly mergeable: Mergeability;
}

/** What a case plants; every part left out is the default beside it. */
interface Situation {
  readonly branch: string;
  readonly walk: NextRoadmapReading | Error;
  readonly ready: boolean;
  readonly blocked: BlockedLine | null;
  readonly pull: PlantedPull | null;
  readonly plans: readonly string[];
  /** The owner gate's answer, an error it rejects with, or null for sources with no `roadmap`. */
  readonly gate: OwnerApproval | Error | null;
}

/** The defaults: on the base, a walk with nothing in it, under `roadmap` with a gate that is never reached. */
const DEFAULTS: Situation = {
  branch: BASE,
  walk: { roadmap: HOME_BOARD, line: null, passed: 0, problems: [], hop: hopReading() },
  ready: false,
  blocked: null,
  pull: null,
  plans: [],
  gate: { state: 'not-gated' },
};

/** What `git` answered when it worked. */
function said(stdout: string): GitResult {
  return { ok: true, stdout, stderr: '' };
}

/** How many scratch roots a case has been handed. */
let scratches = 0;

/** A plans directory holding a plan per stub, under a root no other case shares. */
function plantPlans(stubs: readonly string[]): string {
  scratches += 1;
  const root = join(tempBase, `case-${String(scratches)}`);
  const dir = join(root, '.rafa', 'plans');
  mkdirSync(dir, { recursive: true });
  stubs.forEach((stub) => {
    writeFileSync(join(dir, `PLAN-${stub}.md`), OPEN_PLAN, 'utf8');
  });
  return root;
}

/** A summary as `findOpen` answers one. */
function summary(): PullRequestSummary {
  return {
    number: PR,
    title: 'rafa-118: the blocker',
    url: `https://github.com/open-tomato/rafa/pull/${String(PR)}`,
    state: 'open',
    headRefName: HEAD,
    baseRefName: BASE,
    author: { login: 'octo', isBot: false },
    isCrossRepository: false,
    updatedAt: '2026-09-28T11:00:00Z',
  };
}

/** A detail as `get` answers one. */
function detail(pull: PlantedPull): PullRequestDetail {
  return {
    ...summary(),
    body: `Closes #${String(C)}`,
    headRefOid: 'abc1234',
    mergeable: pull.mergeable,
    mergeStateStatus: 'CLEAN',
    labels: [],
    closes: [],
  };
}

/** A provider answering the pull request a case planted, or none. */
function providerFor(pull: PlantedPull | null): PullRequests {
  if (pull === null) return createPullRequestsDouble({ findOpen: () => Promise.resolve(null) }).pulls;
  return createPullRequestsDouble({
    findOpen: () => Promise.resolve(summary()),
    get: () => Promise.resolve(detail(pull)),
    checks: () => Promise.resolve({ rows: [], verdict: pull.verdict }),
  }).pulls;
}

/** A board answering what the case planted. */
function boardFor(situation: Situation): NextBoard {
  const { walk } = situation;
  return {
    next: () => walk instanceof Error
      ? Promise.reject(walk)
      : Promise.resolve(walk),
    blocking: () => Promise.resolve(situation.blocked),
    isReady: () => Promise.resolve(situation.ready),
  };
}

/** The sources a case is read over, and the pull requests the gate was asked about. */
function sourcesFor(over: Partial<Situation> = {}): { readonly sources: NextSources; readonly gated: number[] } {
  const situation: Situation = { ...DEFAULTS, ...over };
  const answers: Readonly<Record<string, GitResult>> = {
    'rev-parse --abbrev-ref HEAD': said(`${situation.branch}\n`),
    'status --porcelain': said(''),
    [`rev-list --left-right --count ${BASE}...origin/${BASE}`]: said('0\t0\n'),
  };
  const gated: number[] = [];
  const { gate } = situation;
  const plain: NextSources = {
    base: BASE,
    plans: plansDirAt(plantPlans(situation.plans), '.rafa/plans'),
    runs: () => [],
    git: (args) => answers[args.join(' ')] ?? said(''),
    pulls: providerFor(situation.pull),
    board: boardFor(situation),
  };
  if (gate === null) return { sources: plain, gated };
  const ownerApproval = (pullRequest: number): Promise<OwnerApproval> => {
    gated.push(pullRequest);
    return gate instanceof Error
      ? Promise.reject(gate)
      : Promise.resolve(gate);
  };
  return { sources: { ...plain, roadmap: { ownerApproval } }, gated };
}

/** The state a situation answers. */
function stateOf(over: Partial<Situation> = {}): ReturnType<typeof readNextState> {
  return readNextState(sourcesFor(over).sources);
}

/** A walk answering H blocked, with `decision` read for it. */
function hBlocked(decision: HopDecision | null, over: Partial<NextHopReading> = {}): Partial<Situation> {
  return { walk: walkTo(H, hopReading({ decision, ...over })), ready: true, blocked: H_BLOCKED };
}

describe('the table under roadmap', () => {
  it('reads the thirteen plain rows alone without roadmap, none of the hop ids among them', () => {
    expect(NEXT_STATES).toHaveLength(13);
    expect(NEXT_STATES.filter((id) => !NEXT_ROADMAP_STATES.includes(id))).toEqual([]);
  });

  it('reads each hop row just ahead of the row the module note keys it by', () => {
    expect(NEXT_ROADMAP_STATES).toEqual([
      'loop-running',
      'base-behind',
      'tracker-blocked',
      'tracker-open',
      'pr-pending',
      'pr-red',
      'pr-owner-review',
      'pr-no-checks',
      'pr-green',
      'away-ended',
      'plan-unstarted',
      'issue-ready',
      'hop-halt',
      'hop-blocked',
      'issue-blocked',
      'issue-not-ready',
      'hop-dry',
      'nothing-left',
    ]);
  });

  it('leaves the hop key out of a plain row answered under roadmap', async () => {
    const state = await stateOf({ walk: walkTo(H, hopReading()), ready: true });

    expect(state.id).toBe('issue-ready');
    expect(Object.keys(state)).not.toContain('hop');
  });
});

describe('hop-blocked', () => {
  it('proposes the hop to C with the log line, and the record the hop opens', async () => {
    const state = await stateOf(hBlocked(MOVE));

    expect(state.id).toBe('hop-blocked');
    expect(state.action).toBe('hop');
    expect(state.reading).toBe(`hop from epic #${String(HOME_EPIC)}: #${String(H)} blocked by #${String(C)}, in epic #${String(AWAY_EPIC)}`);
    expect(state.proposal).toBe(`hop to epic #${String(AWAY_EPIC)} on board #${String(AWAY_BOARD)} and work #${String(C)}, keeping home`);
    expect(state.issue).toBe(C);
    expect(state.hop).toEqual({
      action: 'hop',
      opening: {
        kind: 'blocker',
        home: HOME,
        from: H_PLACE,
        blocked: H,
        target: C,
        targetEpic: AWAY_EPIC,
        targetBoard: AWAY_BOARD,
      },
    });
  });

  it('stops at H as issue-blocked on the same reading without roadmap, with no hop key', async () => {
    const state = await stateOf({ ...hBlocked(MOVE), gate: null });

    expect(state.id).toBe('issue-blocked');
    expect(state.action).toBe('unblock');
    expect(Object.keys(state)).not.toContain('hop');
  });

  it('homes the record at the walked board when there is no position file', async () => {
    const state = await stateOf(hBlocked(MOVE, { position: null }));

    expect(state.hop).toMatchObject({ action: 'hop', opening: { home: { board: HOME_BOARD, epic: null } } });
  });

  it('falls through to issue-blocked on a decision to stay', async () => {
    const stay: HopDecision = { kind: 'stay', blocked: H, located: { kind: 'no-hop', blocker: C, reason: 'no-epic-label', epic: null } };
    const state = await stateOf(hBlocked(stay));

    expect(state.id).toBe('issue-blocked');
  });

  it('proposes no second hop while one is away', async () => {
    const state = await stateOf(hBlocked(MOVE, { record: record(), position: AWAY, target: { issue: C, closed: false, pullRequest: null } }));

    expect(state.id).toBe('issue-blocked');
  });

  it('is not read off the base branch', async () => {
    const state = await stateOf({ ...hBlocked(MOVE), branch: 'feat/elsewhere' });

    expect(state.id).toBe('nothing-left');
  });
});

describe('hop-halt', () => {
  it('reads the chain H ← C ← B and proposes home, closing the hop as halted', async () => {
    const state = await stateOf(hBlocked(halt([B])));

    expect(state.id).toBe('hop-halt');
    expect(state.action).toBe('home');
    expect(state.reading).toBe(`halt: #${String(H)} ← #${String(C)} ← #${String(B)}: #${String(C)} is blocked in turn`);
    expect(state.proposal).toBe(`go back home to board #${String(HOME_BOARD)}`);
    expect(state.issue).toBe(H);
    expect(state.hop).toEqual({ action: 'home', home: HOME, closing: 'halted', pullRequest: null });
  });

  it('names the mutual block where H and C block each other', async () => {
    const state = await stateOf(hBlocked(halt([H])));

    expect(state.id).toBe('hop-halt');
    expect(state.reading).toBe(`halt: #${String(H)} ← #${String(C)} ← #${String(H)}: #${String(H)} and #${String(C)} block each other`);
  });

  it('halts while away on C blocked in turn, home being the record\'s', async () => {
    const awayHome = { board: HOME_BOARD, epic: HOME_EPIC };
    const away = record({ home: awayHome });
    const state = await stateOf({
      walk: walkTo(C, hopReading({ record: away, position: { ...AWAY, home: awayHome }, decision: halt([B]), target: { issue: C, closed: false, pullRequest: null } })),
      ready: true,
      blocked: C_BLOCKED,
    });

    expect(state.id).toBe('hop-halt');
    expect(state.proposal).toBe(`go back home to epic #${String(HOME_EPIC)} on board #${String(HOME_BOARD)}`);
    expect(state.hop).toMatchObject({ home: awayHome });
  });

  it('stops at H as issue-blocked on the same reading without roadmap', async () => {
    const state = await stateOf({ ...hBlocked(halt([B])), gate: null });

    expect(state.id).toBe('issue-blocked');
  });
});

describe('away-ended', () => {
  /** A walk while the blocker hop is away, C read as `target` says. */
  function awayWith(target: NonNullable<NextHopReading['target']>, line: number | null): Partial<Situation> {
    const hop = hopReading({ record: record(), position: AWAY, target });
    return {
      walk: line === null
        ? walkNone(hop)
        : walkTo(line, hop),
    };
  }

  it('goes home waiting once C\'s pull request is open', async () => {
    const state = await stateOf(awayWith({ issue: C, closed: false, pullRequest: PR }, null));

    expect(state.id).toBe('away-ended');
    expect(state.action).toBe('home');
    expect(state.reading).toBe(`#${String(C)}, the hop's target in epic #${String(AWAY_EPIC)}, has pull request #${String(PR)} open`);
    expect(state.proposal).toBe(`go back home to board #${String(HOME_BOARD)}`);
    expect([state.issue, state.pullRequest]).toEqual([C, PR]);
    expect(state.hop).toEqual({ action: 'home', home: HOME, closing: 'waiting', pullRequest: PR });
  });

  it('goes home merged once C is closed', async () => {
    const state = await stateOf(awayWith({ issue: C, closed: true, pullRequest: null }, null));

    expect(state.id).toBe('away-ended');
    expect(state.reading).toBe(`#${String(C)}, the hop's target in epic #${String(AWAY_EPIC)}, is closed`);
    expect(state.hop).toEqual({ action: 'home', home: HOME, closing: 'merged', pullRequest: null });
  });

  it('goes home halted where C\'s spec carries no spec:ready, ahead of proposing ready', async () => {
    const state = await stateOf({ ...awayWith({ issue: C, closed: false, pullRequest: null }, C), ready: false });

    expect(state.id).toBe('away-ended');
    expect(state.reading).toBe(`#${String(C)}, the hop's target in epic #${String(AWAY_EPIC)}, carries no \`spec:ready\`, so its spec is refused as not ready`);
    expect(state.hop).toEqual({ action: 'home', home: HOME, closing: 'halted', pullRequest: null });
  });

  it('plans C, not going home, while C is ready and open with no pull request', async () => {
    const state = await stateOf({ ...awayWith({ issue: C, closed: false, pullRequest: null }, C), ready: true });

    expect(state.id).toBe('issue-ready');
    expect(state.action).toBe('plan');
    expect(state.issue).toBe(C);
  });

  it('leaves C not ready and blocked to hop-halt, with its chain', async () => {
    const hop = hopReading({ record: record(), position: AWAY, target: { issue: C, closed: false, pullRequest: null }, decision: halt([B]) });
    const state = await stateOf({ walk: walkTo(C, hop), ready: false, blocked: C_BLOCKED });

    expect(state.id).toBe('hop-halt');
  });

  it('goes home ahead of starting a plan that sits unstarted', async () => {
    const state = await stateOf({ ...awayWith({ issue: C, closed: false, pullRequest: PR }, null), plans: ['rafa-7-other'] });

    expect(state.id).toBe('away-ended');
  });

  it('starts that plan when no hop is away, the same walk read', async () => {
    const hop = hopReading({ target: { issue: C, closed: false, pullRequest: PR } });
    const state = await stateOf({ walk: walkNone(hop), plans: ['rafa-7-other'] });

    expect(state.id).toBe('plan-unstarted');
  });

  it('ends a dry hop whose epic ran dry in turn, rather than hopping a second time', async () => {
    const state = await stateOf({ walk: walkDry(hopReading({ record: dryRecord(), position: AWAY, nextEpic: NEXT_EPIC })) });

    expect(state.id).toBe('away-ended');
    expect(state.reading).toBe(`epic #${String(HOME_EPIC)}, where the dry hop went, has no line left, and a second hop would leave home behind`);
    expect(state.hop).toEqual({ action: 'home', home: HOME, closing: 'halted', pullRequest: null });
  });

  it('answers nothing-left on the same reading without roadmap', async () => {
    const state = await stateOf({ ...awayWith({ issue: C, closed: false, pullRequest: PR }, null), gate: null });

    expect(state.id).toBe('nothing-left');
  });
});

describe('hop-dry', () => {
  it('proposes the hop to the next now epic with the dry log line', async () => {
    const state = await stateOf({ walk: walkDry(hopReading({ nextEpic: NEXT_EPIC })) });

    expect(state.id).toBe('hop-dry');
    expect(state.action).toBe('hop');
    expect(state.reading).toBe(`hop from epic #${String(HOME_EPIC)}: it ran dry, next \`now\` epic #30 on board #${String(HOME_BOARD)}`);
    expect(state.proposal).toBe(`hop to epic #30 on board #${String(HOME_BOARD)}, keeping home`);
    expect(state.issue).toBeNull();
    expect(state.hop).toEqual({
      action: 'hop',
      opening: {
        kind: 'dry',
        home: HOME,
        from: H_PLACE,
        blocked: null,
        target: null,
        targetEpic: 30,
        targetBoard: HOME_BOARD,
      },
    });
  });

  it('answers nothing-left where no now epic follows the dry one', async () => {
    const state = await stateOf({ walk: walkDry(hopReading()) });

    expect(state.id).toBe('nothing-left');
  });

  it('refuses a dry hop whose two ends are both away from home', async () => {
    const state = await stateOf({ walk: walkDry(hopReading({ position: AWAY, nextEpic: NEXT_EPIC })) });

    expect(state.id).toBe('nothing-left');
  });

  it('answers nothing-left on the same reading without roadmap', async () => {
    const state = await stateOf({ walk: walkDry(hopReading({ nextEpic: NEXT_EPIC })), gate: null });

    expect(state.id).toBe('nothing-left');
  });
});

describe('pr-owner-review', () => {
  /** A checkout of {@link HEAD} whose pull request reads as given. */
  function onPull(verdict: ChecksVerdict, gate: Situation['gate'], walk: Situation['walk'] = DEFAULTS.walk): Partial<Situation> {
    return { branch: HEAD, pull: { verdict, mergeable: 'mergeable' }, gate, walk };
  }

  /** A gate that is not approved, in `state`. */
  function refused(state: 'waiting' | 'unresolved' | 'unknown'): OwnerApproval {
    return { state, reason: `owner @team-y of board #${String(AWAY_BOARD)} has not approved #${String(PR)}`, owners: [] };
  }

  it('answers none, waiting on C, where the hop record names the pull request', async () => {
    const walk = walkNone(hopReading({ record: record({ state: 'waiting', pullRequest: PR }) }));
    const { sources, gated } = sourcesFor(onPull('green', refused('waiting'), walk));
    const state = await readNextState(sources);

    expect(state.id).toBe('pr-owner-review');
    expect(state.action).toBe('none');
    expect(state.reading).toBe(`waiting on #${String(C)} (owner review)`);
    expect(state.proposal).toBe(`leave #${String(PR)} to its owner's review, which rafa does not merge past: owner @team-y of board #${String(AWAY_BOARD)} has not approved #${String(PR)}`);
    expect([state.issue, state.pullRequest]).toEqual([C, PR]);
    expect(gated).toEqual([PR]);
    expect(Object.keys(state)).not.toContain('hop');
  });

  it('names C off the away target\'s open pull request as well', async () => {
    const walk = walkNone(hopReading({ record: record(), position: AWAY, target: { issue: C, closed: false, pullRequest: PR } }));
    const state = await stateOf(onPull('green', refused('waiting'), walk));

    expect(state.reading).toBe(`waiting on #${String(C)} (owner review)`);
  });

  it('names the pull request itself where no hop record names it', async () => {
    const state = await stateOf(onPull('green', refused('waiting')));

    expect(state.reading).toBe(`waiting on #${String(PR)} (owner review)`);
    expect(state.issue).toBeNull();
  });

  it('names the pull request itself where the walk could not be read', async () => {
    const state = await stateOf(onPull('green', refused('waiting'), new Error('gh could not be asked')));

    expect(state.id).toBe('pr-owner-review');
    expect(state.reading).toBe(`waiting on #${String(PR)} (owner review)`);
  });

  it.each([['waiting'], ['unresolved'], ['unknown']] as const)('holds back a green pull request the gate reads %s', async (gate) => {
    const state = await stateOf(onPull('green', refused(gate)));

    expect(state.id).toBe('pr-owner-review');
  });

  it('holds back a pull request with no checks, ahead of row 7', async () => {
    const state = await stateOf(onPull('none', refused('unresolved')));

    expect(state.id).toBe('pr-owner-review');
  });

  it('reads a gate that rejects as unknown, never as approved', async () => {
    const state = await stateOf(onPull('green', new Error('the listing could not be read')));

    expect(state.id).toBe('pr-owner-review');
    expect(state.proposal).toContain(`could not read the owner gate of #${String(PR)}: the listing could not be read`);
  });

  it('lets a not-gated or an approved pull request through to rows 7 and 8', async () => {
    const approved: OwnerApproval = { state: 'approved', owners: [] };
    const green = await stateOf(onPull('green', { state: 'not-gated' }));
    const none = await stateOf(onPull('none', approved));

    expect([green.id, none.id]).toEqual(['pr-green', 'pr-no-checks']);
    expect([green.action, none.action]).toEqual(['merge', 'merge-unchecked']);
  });

  it('never asks the gate without roadmap, and merges as before', async () => {
    const { sources, gated } = sourcesFor(onPull('green', null));
    const state = await readNextState(sources);

    expect(state.id).toBe('pr-green');
    expect(gated).toEqual([]);
  });

  it('never asks the gate for a pull request rows 5 and 6 take', async () => {
    const red = sourcesFor(onPull('red', refused('waiting')));
    const pending = sourcesFor(onPull('pending', refused('waiting')));

    expect((await readNextState(red.sources)).id).toBe('pr-red');
    expect((await readNextState(pending.sources)).id).toBe('pr-pending');
    expect([...red.gated, ...pending.gated]).toEqual([]);
  });
});
