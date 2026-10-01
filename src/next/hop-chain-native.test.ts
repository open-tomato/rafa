/**
 * Tests for the one-hop decision (`src/next/hop-chain.ts`) handed the
 * board's relationships port: C's epic read from its `parent` and what C
 * waits on read from its `blockedBy` nodes in `native` mode, with the
 * `Blocked by:` line faults read in `labels` mode only. The `labels`
 * cases the decision had before the port stay in `./hop-chain.test.ts`.
 *
 * The board, on `acme/board`: home is board #10 at epic #20, where H is
 * #100; #10 also lists epic #30, and board #11 lists epic #40. Every C
 * below is a sub-issue of #40, so a native hop lands on board #11. Every
 * case reads it through the real adapters made over a `gh` that fails
 * any call, so a read that spawned would be seen.
 *
 * ## The controls
 *
 *  - Every C also carries the label `epic:other`, naming epic #30, and
 *    the same listing read in `labels` mode locates #30. A native reading
 *    that fell back to the label hops to the wrong epic.
 *  - Each blocked C is paired with one differing in the one thing it is
 *    about that hops: an open node beside a closed one, a foreign open
 *    node beside a foreign closed one, a truncated list of closed nodes
 *    beside the same closed node untruncated.
 *  - The C carrying `spec:blocked` and a `Blocked by:` line (a real one,
 *    and a fault) with no `blockedBy` node hops in `native` mode, and the
 *    same row halts in `labels` mode, the fault with its sentence.
 */
import type { TakenReadings } from './hop-chain.js';
import type { GhRunner } from '../adapters/tracker/github.js';
import type { BoardView } from '../board/epic-board.js';
import type { EpicRelations } from '../board/epics.js';
import type { BoardIssue, BoardIssueLink, BoardIssueState } from '../board/roadmap-board.js';
import type { Place } from '../project/position.js';

import { describe, expect, it } from 'bun:test';

import { typeOfLabels } from '../adapters/tracker/github.js';
import { SPEC_BLOCKED_LABEL } from '../board/blocked.js';
import { createLabelsRelations } from '../board/relations/labels.js';
import { createNativeRelations } from '../board/relations/native.js';

import { decideHop, hopDecisionSentence } from './hop-chain.js';

/** The board's own repository. */
const BOARD = 'acme/board';

/** The repository a foreign blocker lives on. */
const OTHER = 'other/lib';

/** A `gh` every call to which fails the case: reads never spawn. */
const NO_GH: GhRunner = (args) => {
  throw new Error(`a read sent gh ${args.join(' ')}`);
};

/** The `native` adapter on {@link BOARD}. */
const NATIVE = createNativeRelations({ gh: NO_GH, repository: BOARD });

/** The `labels` adapter, for the controls. */
const LABELS = createLabelsRelations({ gh: NO_GH });

/** A link to issue `number` on `repository`, in `state`. */
function link(number: number, state: BoardIssueState = 'OPEN', repository = BOARD): BoardIssueLink {
  return { number, title: `issue ${String(number)}`, state, repository };
}

/** The fields a case may set on a native row. */
interface RowFields {
  readonly labels?: readonly string[];
  readonly body?: string;
  readonly state?: BoardIssueState;
  readonly stateReason?: string | null;
  readonly parent?: BoardIssueLink | null;
  readonly blockedBy?: readonly BoardIssueLink[];
  /** GitHub's `totalCount`, when above the nodes. */
  readonly total?: number;
}

/** A native row carrying all five native fields, its type read from its labels. */
function row(number: number, fields: RowFields = {}): BoardIssue {
  const labels = fields.labels ?? [];
  const nodes = fields.blockedBy ?? [];
  const state = fields.state ?? 'OPEN';
  return {
    number,
    title: `Issue ${String(number)}`,
    body: fields.body ?? '',
    state,
    stateReason: fields.stateReason ?? (state === 'CLOSED'
      ? 'COMPLETED'
      : null),
    labels,
    type: typeOfLabels(labels),
    module: 'unassigned',
    parent: fields.parent ?? null,
    blockedBy: fields.total === undefined
      ? { nodes }
      : { nodes, truncated: { total: fields.total } },
    blocking: { nodes: [] },
    subIssuesSummary: { total: 0, completed: 0, percentCompleted: 0 },
    subIssues: { nodes: [] },
  };
}

/** A board whose checklist names `epics`, unticked. */
function board(number: number, epics: readonly number[]): BoardIssue {
  return row(number, { labels: ['type:roadmap'], body: epics.map((epic) => `- [ ] #${String(epic)}`).join('\n') });
}

/** An epic issue whose own slug is `slug`, for the `labels` controls. */
function epic(number: number, slug: string): BoardIssue {
  return row(number, { labels: ['type:epic', `epic:${slug}`, 'horizon:now'] });
}

/** A sub-issue of epic #40 labelled into epic #30, waiting natively on `blockedBy`. */
function inFar(number: number, fields: RowFields = {}): BoardIssue {
  return row(number, { labels: ['epic:other'], parent: link(40), ...fields });
}

/** The board the module note describes. */
const LISTING: readonly BoardIssue[] = [
  board(10, [20, 30]),
  board(11, [40]),
  epic(20, 'home'),
  epic(30, 'other'),
  epic(40, 'far'),
  row(100, { labels: ['epic:home'], parent: link(20), blockedBy: [link(102)] }),
  inFar(102),
  inFar(103),
  inFar(105, { blockedBy: [link(106)] }),
  row(106),
  inFar(107, { blockedBy: [link(100)] }),
  inFar(108, { blockedBy: [link(109, 'CLOSED')] }),
  row(109, { state: 'CLOSED' }),
  inFar(110, { labels: ['epic:other', SPEC_BLOCKED_LABEL], body: 'Blocked by: #106' }),
  inFar(111, { labels: ['epic:other', SPEC_BLOCKED_LABEL], body: 'Nothing named here.' }),
  inFar(112, { blockedBy: [link(106, 'OPEN', OTHER)] }),
  inFar(113, { blockedBy: [link(106, 'CLOSED', OTHER)] }),
  inFar(114, { blockedBy: [link(109, 'CLOSED')], total: 51 }),
  inFar(115, { blockedBy: [link(116, 'CLOSED')] }),
  row(116, { state: 'CLOSED', stateReason: 'NOT_PLANNED' }),
  inFar(117, { blockedBy: [link(999)] }),
  inFar(118, { blockedBy: [link(106)] }),
];

/** Home: board #10 at epic #20. */
const HOME: Place = { board: 10, epic: 20 };

/** The view of {@link LISTING}, its default board #10. */
const VIEW: BoardView = {
  listing: LISTING,
  rows: new Map(LISTING.map((issue) => [issue.number, issue])),
  defaultBoard: () => Promise.resolve(10),
};

/** Taken readings where only #118 is taken, by a branch. */
const TAKEN: TakenReadings = {
  branchFor: (issue) => issue === 118
    ? 'feat/118-x'
    : null,
  pullRequestFor: () => Promise.resolve(null),
};

/** Decides for H #100 blocked by `blocker`, read at home, in `relations`' mode. */
function decide(blocker: Parameters<typeof decideHop>[0]['blocker'], relations: EpicRelations = NATIVE) {
  return decideHop({ blocked: 100, blocker, position: { current: HOME, home: HOME }, view: VIEW, taken: TAKEN, relations });
}

describe('decideHop in native mode, hop', () => {
  it('hops to the epic C is a sub-issue of, with no slug, where the label control names another epic', async () => {
    const native = await decide(102);
    expect(native).toEqual({
      kind: 'hop', blocked: 100, blocker: 102, epic: 40, slug: null, board: 11, from: HOME, to: { board: 11, epic: 40 },
    });

    const labels = await decide(102, LABELS);
    expect(labels).toMatchObject({ kind: 'hop', blocker: 102, epic: 30, slug: 'other', board: 10 });
  });

  it('reads C handed as its blockedBy node on this board as the local number', async () => {
    expect(await decide({ number: 102, repository: null })).toMatchObject({ kind: 'hop', blocker: 102, epic: 40 });
  });

  it('stays on a C whose blockedBy node names another repository, though this board holds that number', async () => {
    const decision = await decide({ number: 102, repository: OTHER });
    expect(decision).toMatchObject({ kind: 'stay', located: { blocker: `${OTHER}#102`, reason: 'cross-repository' } });
  });
});

describe('decideHop in native mode, halt on C blocked', () => {
  it('halts on an open blockedBy node, beside a closed one that hops', async () => {
    const decision = await decide(105);
    expect(decision).toMatchObject({
      kind: 'halt', reason: 'blocked-blocker', fault: null, chain: { blocked: 100, blocker: 105, next: [106], mutual: false },
    });
    expect(hopDecisionSentence(decision)).toBe('halt: #100 ← #105 ← #106: #105 is blocked in turn');

    expect(await decide(108)).toMatchObject({ kind: 'hop', blocker: 108 });
  });

  it('clears a blocker closed as NOT_PLANNED as one closed as done', async () => {
    expect(await decide(115)).toMatchObject({ kind: 'hop', blocker: 115, epic: 40 });
  });

  it('reads a blocker node this board does not hold as not read, which holds C', async () => {
    expect(await decide(117)).toMatchObject({ kind: 'halt', reason: 'blocked-blocker', chain: { next: [999] } });
  });

  it('names the mutual block when C waits on H', async () => {
    const decision = await decide(107);
    expect(decision).toMatchObject({ kind: 'halt', chain: { next: [100], mutual: true } });
    expect(hopDecisionSentence(decision)).toBe('halt: #100 ← #107 ← #100: #100 and #107 block each other');
  });

  it('halts on an open foreign blocker with no number on the chain, beside a closed foreign one that hops', async () => {
    const decision = await decide(112);
    expect(decision).toMatchObject({ kind: 'halt', reason: 'blocked-blocker', fault: null, chain: { next: [] } });
    expect(hopDecisionSentence(decision)).toBe('halt: #100 ← #112: #112 is blocked in turn');

    expect(await decide(113)).toMatchObject({ kind: 'hop', blocker: 113 });
  });

  it('halts on a truncated blockedBy list whose answered nodes are closed, beside the same node untruncated that hops', async () => {
    expect(await decide(114)).toMatchObject({ kind: 'halt', reason: 'blocked-blocker', chain: { next: [] } });
    expect(await decide(108)).toMatchObject({ kind: 'hop', blocker: 108 });
  });

  it('waits on a taken C before reading its blockers, in native mode too', async () => {
    expect(await decide(118)).toMatchObject({ kind: 'wait', blocker: 118, taken: { by: 'branch', branch: 'feat/118-x' } });
  });
});

describe('decideHop, the Blocked by: line is labels mode only', () => {
  // Labelled into epic #40 here, so both modes locate the same epic and
  // differ only in what C waits on.
  const relabelled = LISTING.map((issue) => issue.number === 110 || issue.number === 111
    ? { ...issue, labels: ['epic:far', SPEC_BLOCKED_LABEL] }
    : issue);
  const view: BoardView = { ...VIEW, listing: relabelled, rows: new Map(relabelled.map((issue) => [issue.number, issue])) };
  const decideOver = (blocker: number, relations: EpicRelations) => decideHop({
    blocked: 100, blocker, position: { current: HOME, home: HOME }, view, taken: TAKEN, relations,
  });

  it('hops over a spec:blocked C with a Blocked by: line and no blockedBy node, which labels mode halts on', async () => {
    expect(await decideOver(110, NATIVE)).toMatchObject({ kind: 'hop', blocker: 110, epic: 40 });
    expect(await decideOver(110, LABELS)).toMatchObject({
      kind: 'halt', reason: 'blocked-blocker', fault: null, chain: { next: [106] },
    });
  });

  it('reads no fault in native mode off a line labels mode reports one for', async () => {
    expect(await decideOver(111, NATIVE)).toMatchObject({ kind: 'hop', blocker: 111 });

    const labels = await decideOver(111, LABELS);
    expect(labels).toMatchObject({ kind: 'halt', reason: 'blocked-blocker', chain: { next: [] } });
    expect(labels.kind === 'halt'
      ? labels.fault
      : null).not.toBeNull();
  });
});
