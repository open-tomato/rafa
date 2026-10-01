/**
 * Tests for the members `--full` prints under a `native` epic
 * (`./roadmap-epic-table.ts`, "Under --full"): their order, the epic's
 * sub-issue order rather than its checklist, and each open member's
 * blockers, read through the rows' `memberBlockers` rather than a
 * `Blocked by:` line. The `labels` cases stay in
 * `./roadmap-epic-table.test.ts`.
 *
 * The epic is read by `readEpics` over one listing through the real
 * `native` adapter, made over a `gh` that fails any call.
 *
 * ## The controls
 *
 * Epic #60's checklist lists #61 then #62, while GitHub holds its
 * sub-issues as #62 then #61; both members carry `epic:alpha` too, and
 * #62 carries a `Blocked by: #63` line naming the closed #63. The same
 * listing read in `labels` mode walks the checklist, #61 first, and
 * prints the line's #63. So a table that re-sorted a native epic by its
 * checklist, or read the line in `native` mode, fails a native case.
 */
import type { EpicTableRows } from './roadmap-epic-table.js';
import type { GhRunner } from '../../adapters/tracker/github.js';
import type { Epic, EpicRelations } from '../../board/epics.js';
import type { BoardIssue, BoardIssueLink } from '../../board/roadmap-board.js';
import type { MemberBlockers } from '../../board/roadmap-epic-rows.js';

import { describe, expect, it } from 'bun:test';

import { readEpics } from '../../board/epics.js';
import { createNativeRelations } from '../../board/relations/native.js';

import { memberLines, orderedMembers, renderEpicTable } from './roadmap-epic-table.js';
import { LABELS_LEAD } from './roadmap-table.js';

/** The board's own repository. */
const BOARD = 'acme/board';

/** A `gh` every call to which fails the case: reads never spawn. */
const NO_GH: GhRunner = (args) => {
  throw new Error(`a read sent gh ${args.join(' ')}`);
};

const NATIVE: EpicRelations = createNativeRelations({ gh: NO_GH, repository: BOARD });

/** Issue `number` as a link node names it, on `repository`. */
function link(number: number, state: 'OPEN' | 'CLOSED' = 'OPEN', repository = BOARD): BoardIssueLink {
  return { number, title: `Issue ${String(number)}`, state, repository };
}

/** A native row, every native field empty, `fields` laid over it. */
function issue(number: number, fields: Partial<BoardIssue> = {}): BoardIssue {
  return {
    number,
    title: `Issue ${String(number)}`,
    body: '',
    state: 'OPEN',
    stateReason: null,
    labels: [],
    type: 'code',
    module: 'unassigned',
    parent: null,
    blockedBy: { nodes: [] },
    blocking: { nodes: [] },
    subIssuesSummary: { total: 0, completed: 0, percentCompleted: 0 },
    subIssues: { nodes: [] },
    ...fields,
  };
}

/** The listing the module note describes. */
const LISTING: readonly BoardIssue[] = [
  issue(60, {
    title: 'Epic alpha',
    body: '- [ ] #61\n- [ ] #62\n',
    labels: ['type:epic', 'epic:alpha', 'horizon:now'],
    type: 'epic',
    subIssues: { nodes: [link(62), link(61)] },
    subIssuesSummary: { total: 2, completed: 0, percentCompleted: 0 },
  }),
  issue(61, { title: 'Alpha one', labels: ['epic:alpha'], parent: link(60) }),
  issue(62, {
    title: 'Alpha two',
    body: 'Blocked by: #63\n',
    labels: ['epic:alpha'],
    parent: link(60),
    blockedBy: { nodes: [link(20), link(7, 'CLOSED', 'other/lib')] },
  }),
  issue(63, { state: 'CLOSED', stateReason: 'COMPLETED' }),
  issue(20),
];

/** Epic #60 as `relations` read it, or as `labels` mode reads it with none. */
function epicRead(relations?: EpicRelations): Epic {
  const read = readEpics({ issues: LISTING, claims: new Set(), today: new Date(2026, 8, 30), ...relations === undefined
    ? {}
    : { relations } });
  const epic = read.epics.find((each) => each.number === 60);
  if (epic === undefined) throw new Error('epic #60 was not read');
  return epic;
}

/** #62's blockers as the port reads them, and every other member's none. */
const BLOCKERS: MemberBlockers = (member) => member.number === 62
  ? [{ reference: '#20', state: 'open' }, { reference: 'other/lib#7', state: 'closed' }]
  : [];

/** Each issue's state on the listing, by number. */
const STATES = new Map(LISTING.map((row) => [row.number, row.state]));

describe('a native epic\'s members under --full', () => {
  it('keeps the sub-issue order, whatever the checklist lists', () => {
    expect(orderedMembers(epicRead(NATIVE)).map((member) => member.number)).toEqual([62, 61]);
  });

  it('walks the checklist in labels mode, the control', () => {
    expect(orderedMembers(epicRead()).map((member) => member.number)).toEqual([61, 62]);
  });

  it('prints an open member\'s blockers as memberBlockers reads them, a foreign one with its repository', () => {
    expect(memberLines(epicRead(NATIVE), 5, undefined, undefined, STATES, BLOCKERS)).toEqual([
      '     #62  open  Alpha two',
      `          ${LABELS_LEAD}🔴 #20 🟢 other/lib#7`,
      '     #61  open  Alpha one',
    ]);
  });

  it('prints the Blocked by: line\'s blockers with no memberBlockers, the control', () => {
    expect(memberLines(epicRead(), 5, undefined, undefined, STATES)).toEqual([
      '     #61  open  Alpha one',
      '     #62  open  Alpha two',
      `          ${LABELS_LEAD}🟢 #63`,
    ]);
  });

  it('is handed the rows\' memberBlockers by the table', () => {
    const epic = epicRead(NATIVE);
    const rows: EpicTableRows = {
      roadmap: 1,
      groups: [{ horizon: 'now', rows: [{ line: { issue: 60, ticked: false, why: 'alpha', lineNumber: 1 }, epic, horizon: 'now' }] }],
      hidden: 0,
      unknown: null,
      specs: [],
      states: STATES,
      memberBlockers: BLOCKERS,
    };

    expect(renderEpicTable(rows, undefined, true)).toContain(`          ${LABELS_LEAD}🔴 #20 🟢 other/lib#7`);
  });
});
