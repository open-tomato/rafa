/**
 * Tests for the Blocked by rule (`rules.ts`, `blockedByTextOf`).
 *
 * Every reading below comes from a real relations adapter's `blockersOf`
 * over a literal listing, the `labels` one and the `native` one, so the
 * text is held to what the port reads in each `board.relationships`
 * mode rather than to a reading the test spells by hand.
 *
 * ## The controls
 *
 *  - Each null is read beside a case on the same rows that answers text,
 *    so a null proves the missing fact, not a rule that names nothing.
 *  - Blockers are named out of number order, so a rule sorting by number
 *    fails.
 *  - A `labels` row carries the native links of a different blocker, and
 *    a `native` row the `spec:blocked` label and a `Blocked by:` line
 *    naming a different one, so a mode reading the other's marks fails.
 *  - A closed blocker sits beside an open one, so a rule naming every
 *    blocker, or none once one is closed, fails.
 */
import type { GhRunner } from '../../adapters/tracker/github.js';
import type { BoardRelations } from '../relations/port.js';
import type { BoardIssue, BoardIssueLink, BoardIssueState } from '../roadmap-board.js';

import { describe, expect, it } from 'bun:test';

import { GITHUB_LABELS, typeOfLabels } from '../../adapters/tracker/github.js';
import { NOT_PLANNED_REASON } from '../epics.js';
import { createLabelsRelations } from '../relations/labels.js';
import { createNativeRelations } from '../relations/native.js';

import { blockedByTextOf } from './rules.js';

/** The board's own repository, for the native rows. */
const BOARD = 'acme/board';

/** Another repository, for the foreign blockers. */
const OTHER = 'acme/other';

/** A `gh` every call to which fails the case: the rule never spawns. */
const NO_GH: GhRunner = (args) => {
  throw new Error(`a read sent gh ${args.join(' ')}`);
};

/** The `labels` adapter. */
const LABELS: BoardRelations = createLabelsRelations({ gh: NO_GH });

/** The `native` adapter on {@link BOARD}. */
const NATIVE: BoardRelations = createNativeRelations({ gh: NO_GH, repository: BOARD });

/** The label a `labels`-mode blocked issue carries. */
const BLOCKED = GITHUB_LABELS.specBlocked;

/** The fields a case may set on a row. */
interface RowFields {
  readonly labels?: readonly string[];
  readonly body?: string;
  readonly state?: BoardIssueState;
  readonly stateReason?: string | null;
  readonly blockedBy?: readonly BoardIssueLink[];
  readonly truncatedAt?: number;
}

/** Issue `number` on `repository` as a native link node names it. */
function link(number: number, state: BoardIssueState = 'OPEN', repository = BOARD): BoardIssueLink {
  return { number, title: `#${String(number)}`, state, repository };
}

/** One listing row carrying the native fields too, so both adapters read it. */
function row(number: number, fields: RowFields = {}): BoardIssue {
  const labels = fields.labels ?? [];
  const nodes = fields.blockedBy ?? [];
  return {
    number,
    title: `#${String(number)}`,
    body: fields.body ?? '',
    state: fields.state ?? 'OPEN',
    stateReason: fields.stateReason ?? null,
    labels,
    type: typeOfLabels(labels),
    module: '',
    parent: null,
    blockedBy: fields.truncatedAt === undefined
      ? { nodes }
      : { nodes, truncated: { total: fields.truncatedAt } },
    blocking: { nodes: [] },
    subIssuesSummary: { total: 0, completed: 0, percentCompleted: 0 },
    subIssues: { nodes: [] },
  };
}

/** The Blocked by text of `issue` read by `relations` over `listing`, `issue` included. */
function textOf(relations: BoardRelations, issue: BoardIssue, listing: readonly BoardIssue[] = []): string | null {
  return blockedByTextOf(relations.read([issue, ...listing]).blockersOf(issue));
}

/** A `labels`-mode blocked issue #1 whose `Blocked by:` line reads `line`. */
function labelsBlocked(line: string, fields: RowFields = {}): BoardIssue {
  return row(1, { labels: [BLOCKED], body: `Why it waits.\n\nBlocked by: ${line}\n`, ...fields });
}

describe('blockedByTextOf: labels mode', () => {
  it('answers null for a Blocked by: line with no spec:blocked label', () => {
    const issue = row(1, { body: 'Blocked by: #20\n' });

    expect(textOf(LABELS, issue, [row(20)])).toBeNull();
  });

  it('answers null for spec:blocked with no Blocked by: line, a fault, beside the same label with a line naming #20', () => {
    expect(textOf(LABELS, row(1, { labels: [BLOCKED] }), [row(20)])).toBeNull();
    expect(textOf(LABELS, labelsBlocked('#20'), [row(20)])).toBe('#20');
  });

  it('answers null once every blocker on the line is closed, whatever the reason', () => {
    const listing = [row(20, { state: 'CLOSED' }), row(10, { state: 'CLOSED', stateReason: NOT_PLANNED_REASON })];

    expect(textOf(LABELS, labelsBlocked('#20 #10'), listing)).toBeNull();
  });

  it('names the open blockers in the line\'s order, never by number', () => {
    expect(textOf(LABELS, labelsBlocked('#20 #10'), [row(20), row(10)])).toBe('#20, #10');
  });

  it('leaves out a closed blocker and keeps the open one beside it', () => {
    expect(textOf(LABELS, labelsBlocked('#20 #10'), [row(20, { state: 'CLOSED' }), row(10)])).toBe('#10');
  });

  it('keeps a local blocker the listing does not hold, whose state was not read', () => {
    expect(textOf(LABELS, labelsBlocked('#20 #99'), [row(20, { state: 'CLOSED' })])).toBe('#99');
  });

  it('leaves out a foreign blocker, whose state labels mode never asks, beside an open local one', () => {
    expect(textOf(LABELS, labelsBlocked(`${OTHER}#5`), [])).toBeNull();
    expect(textOf(LABELS, labelsBlocked(`#20 ${OTHER}#5`), [row(20)])).toBe('#20');
  });

  it('reads the line and never the native links the row also carries', () => {
    const issue = labelsBlocked('#20', { blockedBy: [link(30)] });

    expect(textOf(LABELS, issue, [row(20), row(30)])).toBe('#20');
  });
});

describe('blockedByTextOf: native mode', () => {
  it('answers null for an issue with no blockedBy link, beside the same issue with one', () => {
    expect(textOf(NATIVE, row(1), [row(20)])).toBeNull();
    expect(textOf(NATIVE, row(1, { blockedBy: [link(20)] }), [row(20)])).toBe('#20');
  });

  it('answers null once every blocker node is closed, whatever the reason', () => {
    const issue = row(1, { blockedBy: [link(20, 'CLOSED'), link(10, 'CLOSED')] });

    expect(textOf(NATIVE, issue)).toBeNull();
  });

  it('names the open blockers in the order gh answered the nodes, never by number', () => {
    expect(textOf(NATIVE, row(1, { blockedBy: [link(20), link(10)] }))).toBe('#20, #10');
  });

  it('leaves out a closed node and keeps the open one beside it', () => {
    expect(textOf(NATIVE, row(1, { blockedBy: [link(20, 'CLOSED'), link(10)] }))).toBe('#10');
  });

  it('names an open foreign blocker as owner/name#n and leaves out a closed one', () => {
    const issue = row(1, { blockedBy: [link(5, 'OPEN', OTHER), link(6, 'CLOSED', OTHER), link(20)] });

    expect(textOf(NATIVE, issue)).toBe(`${OTHER}#5, #20`);
  });

  it('reads the links and never the spec:blocked label or Blocked by: line the row also carries', () => {
    const marked = { labels: [BLOCKED], body: 'Blocked by: #30\n' };

    expect(textOf(NATIVE, row(1, marked), [row(30)])).toBeNull();
    expect(textOf(NATIVE, row(1, { ...marked, blockedBy: [link(20)] }), [row(30)])).toBe('#20');
  });

  it('names the open nodes it read of a list gh cut short, and no count past them', () => {
    const issue = row(1, { blockedBy: [link(20), link(10, 'CLOSED')], truncatedAt: 60 });

    expect(textOf(NATIVE, issue)).toBe('#20');
  });
});
