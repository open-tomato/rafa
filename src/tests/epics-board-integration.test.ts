/**
 * An integration test over the three pure readers a `gh issue list`
 * answer flows through end to end: `parseBoardListing`
 * (`src/board/roadmap-board.ts`), `readEpics` and `readEpicProblems`
 * (`src/board/epics.ts`, `src/board/epic-problems.ts`).
 *
 * Each of those three has its own unit tests over a literal `BoardIssue`
 * listing built by hand; this file instead plants ONE `gh issue list
 * --json ...` JSON string, the shape `parseBoardListing` actually
 * checks and unwraps, and walks it through all three readers unparsed,
 * so a field name or a label spelling that drifted between the three
 * modules would show here even though every module's own suite stayed
 * green reading its own hand-built fixture.
 *
 * The planted board carries two epics:
 *
 *  - `epic:alpha` (#10) is IN-PROGRESS: one member open, one member
 *    closed as completed, and one closed as not planned, so the
 *    not-planned member must be tallied apart from `done/total` while
 *    still keeping the epic out of `done`.
 *  - `epic:beta` (#20) is DONE by its one member, but the epic issue
 *    itself is still OPEN, so `readEpics` must print the stored/computed
 *    disagreement line naming it.
 *
 * A third issue (#22) carries `epic:beta-typoo`, a mistyped slug no
 * `type:epic` issue owns, so `readEpicProblems` must report it as an
 * orphan label rather than silently dropping it from every epic's
 * membership.
 */
import { describe, expect, it } from 'bun:test';

import { readEpicProblems } from '../board/epic-problems.js';
import { readEpics } from '../board/epics.js';
import { parseBoardListing } from '../board/roadmap-board.js';

/** One `gh issue list --json ...` row, labels already named. */
function ghRow(
  number: number,
  labelNames: readonly string[],
  fields: { readonly state?: 'OPEN' | 'CLOSED'; readonly stateReason?: string } = {},
): Record<string, unknown> {
  return {
    number,
    title: `issue ${String(number)}`,
    body: '',
    state: fields.state ?? 'OPEN',
    stateReason: fields.stateReason ?? '',
    labels: labelNames.map((name) => ({ name })),
  };
}

/** The planted board: two epics, their members, and one mistyped-slug orphan. */
const BOARD_ROWS = [
  // epic:alpha, in-progress: one open member, one done, one not planned.
  ghRow(10, ['type:epic', 'epic:alpha', 'horizon:now']),
  ghRow(11, ['epic:alpha', 'type:code']),
  ghRow(12, ['epic:alpha', 'type:code'], { state: 'CLOSED', stateReason: 'COMPLETED' }),
  ghRow(13, ['epic:alpha', 'type:code'], { state: 'CLOSED', stateReason: 'NOT_PLANNED' }),
  // epic:beta, done by its one member, but the epic issue is still open.
  ghRow(20, ['type:epic', 'epic:beta', 'horizon:next']),
  ghRow(21, ['epic:beta', 'type:code'], { state: 'CLOSED', stateReason: 'COMPLETED' }),
  // a mistyped slug: no type:epic issue's first epic: label spells it.
  ghRow(22, ['epic:beta-typoo', 'type:code']),
];

const COMMAND = 'gh issue list --state all --limit 1000 --json number,title,body,state,stateReason,labels';

describe('a planted gh issue list JSON walked through parseBoardListing, readEpics and readEpicProblems', () => {
  const issues = parseBoardListing(JSON.stringify(BOARD_ROWS), COMMAND);

  it('reads all seven planted rows', () => {
    expect(issues).toHaveLength(7);
  });

  const read = readEpics({ issues, claims: new Set(), today: new Date(2026, 9, 1) });

  it('reads the listing, not a failure', () => {
    expect(read.unknown).toBeNull();
    expect(read.epics).toHaveLength(2);
  });

  it('reads epic:alpha as in-progress, its not-planned member tallied apart from done/total', () => {
    const alpha = read.epics.find((epic) => epic.number === 10);
    expect(alpha?.state).toBe('in-progress');
    expect(alpha?.progress).toEqual({ done: 1, total: 2, notPlanned: 1 });
    expect(alpha?.disagreement).toBeNull();
  });

  it('reads epic:beta as done while its issue is still open, and prints the disagreement', () => {
    const beta = read.epics.find((epic) => epic.number === 20);
    expect(beta?.state).toBe('done');
    expect(beta?.progress).toEqual({ done: 1, total: 1, notPlanned: 0 });
    expect(beta?.stored).toBe('open');
    expect(beta?.disagreement).toBe('done, but epic #20 is still open');
  });

  it('reports the mistyped slug as an orphan label, owned by no epic', () => {
    const problems = readEpicProblems(issues);
    expect(problems).toContainEqual({ kind: 'orphan-label', issue: 22, slug: 'beta-typoo' });
  });
});
