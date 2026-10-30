/**
 * Tests for what `rafa epic cancel`'s unblock answer reads of a
 * dependent (`cancel-unblock.ts`), in both modes, over literal listings.
 *
 * ## The controls
 *
 *  - The one row carries both modes' marks, naming different blockers:
 *    its `Blocked by:` line names #12, #26, #27 and `acme/other#3`, and
 *    its `blockedBy` links name #12, #30, the closed #31 and
 *    `acme/other#9`. Each mode must name its own and none of the other's.
 *  - A foreign blocker numbered #12, like the dropped member, is read
 *    beside the member itself: only the member on this board is dropped.
 *  - The `native` port is made over a `gh` that fails any call, and
 *    `labels` is read with no port, as the cancel reads it before the
 *    port was handed in.
 */
import type { GhRunner } from '../../adapters/tracker/github.js';
import type { BoardIssue, BoardIssueLink } from '../../board/roadmap-board.js';

import { describe, expect, it } from 'bun:test';

import { LABELS_READS } from '../../board/relations/labels.js';
import { createNativeRelations } from '../../board/relations/native.js';

import { keptLinksLine, readUnblockStill } from './cancel-unblock.js';

/** The board's own repository. */
const REPOSITORY = 'acme/board';

/** Another repository. */
const FOREIGN = 'acme/other';

/** A `gh` every call to which fails the case: reads never spawn. */
const NO_GH: GhRunner = (args) => {
  throw new Error(`a read sent gh ${args.join(' ')}`);
};

/** The `native` adapter on {@link REPOSITORY}. */
const NATIVE = createNativeRelations({ gh: NO_GH, repository: REPOSITORY });

/** Issue `number` as a link node names it. */
function link(number: number, state: 'OPEN' | 'CLOSED' = 'OPEN', repository: string = REPOSITORY): BoardIssueLink {
  return { number, title: `Issue ${String(number)}`, state, repository };
}

/** A native row, open, with `blockedBy` as its links. */
function row(number: number, fields: { body?: string; state?: 'OPEN' | 'CLOSED'; labels?: readonly string[]; blockedBy?: readonly BoardIssueLink[] } = {}): BoardIssue {
  const state = fields.state ?? 'OPEN';
  return {
    number,
    title: `Issue ${String(number)}`,
    body: fields.body ?? '',
    state,
    stateReason: state === 'CLOSED'
      ? 'COMPLETED'
      : null,
    labels: fields.labels ?? [],
    type: 'code',
    module: 'unassigned',
    parent: null,
    blockedBy: { nodes: fields.blockedBy ?? [] },
    blocking: { nodes: [] },
    subIssuesSummary: { total: 0, completed: 0, percentCompleted: 0 },
    subIssues: { nodes: [] },
  };
}

/** The dependent, #57; the module note holds its marks. */
const DEPENDENT = row(57, {
  labels: ['spec:blocked'],
  body: `Pay.\n\nBlocked by: #12 #26 #27 ${FOREIGN}#3\n`,
  blockedBy: [link(12), link(30), link(31, 'CLOSED'), link(9, 'OPEN', FOREIGN), link(12, 'OPEN', FOREIGN)],
});

/** The listing: the member #12, #26 open, #27 closed, #30 open, #31 closed, and the dependent. */
const LISTING: readonly BoardIssue[] = [
  row(12),
  row(26),
  row(27, { state: 'CLOSED' }),
  row(30),
  row(31, { state: 'CLOSED' }),
  DEPENDENT,
];

describe('readUnblockStill', () => {
  it('in labels mode names every id its line still names then its foreign tokens, and the ones maybe open', () => {
    const still = readUnblockStill(LABELS_READS, LISTING, DEPENDENT, [12]);

    expect(still).toEqual({ named: ['#26', '#27', `${FOREIGN}#3`], maybeOpen: ['#26', `${FOREIGN}#3`] });
  });

  it('in native mode names its links left open, foreign ones by repository, dropping only this board\'s member', () => {
    const still = readUnblockStill(NATIVE, LISTING, DEPENDENT, [12]);

    expect(still).toEqual({ named: ['#30', `${FOREIGN}#9`, `${FOREIGN}#12`], maybeOpen: [] });
  });

  it('in native mode names nothing for an issue with no link, whatever its line names', () => {
    const lined = row(58, { labels: ['spec:blocked'], body: 'Blocked by: #26\n' });

    expect(readUnblockStill(NATIVE, [...LISTING, lined], lined, [12])).toEqual({ named: [], maybeOpen: [] });
    expect(readUnblockStill(LABELS_READS, [...LISTING, lined], lined, [12]).named).toEqual(['#26']);
  });
});

describe('keptLinksLine', () => {
  it('names the one link kept, and several', () => {
    expect(keptLinksLine(57, [12])).toBe('#57 keeps its blocked-by link to #12: in native mode the cancel clears nothing,'
      + ' and GitHub stops holding an issue back once its blocker closes.');
    expect(keptLinksLine(57, [12, 14])).toStartWith('#57 keeps its blocked-by links to #12 #14: ');
  });
});
