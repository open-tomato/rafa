/**
 * Tests for the epic rows (`src/board/roadmap-epic-rows.ts`) in `native`
 * mode: each epic's state and `done/total` taken from its row's
 * `subIssuesSummary`, the `horizon:` problems alone carried, and the
 * two-labels, orphan-label and checklist problems and the cancelled-epic
 * notice left to the `labels` mode. The `labels` cases stay in
 * `./roadmap-epic-rows.test.ts`.
 *
 * Every read is planted, as there. The port is the real `native` adapter
 * made over a `gh` that fails any call, so a read that spawned would
 * fail the case.
 *
 * ## The controls
 *
 * The planted board is written so each `native` answer differs from the
 * `labels` one over the SAME listing, and each case reads both:
 *
 *  - every epic's summary disagrees with the members the listing holds,
 *    and the `epic:` labels group the members another way;
 *  - #102 carries two `epic:` labels and #103 one no epic owns, and #100's
 *    checklist names an issue without its label: `labels` warns each;
 *  - epic #500 is closed as not planned and #50's `Blocked by:` line names
 *    its open member: `labels` warns the cancelled-epic notice.
 *
 * `labels` mode is also read with a port whose `read` throws, so a
 * `labels` reading that asked the port fails, and it must answer what
 * the reading with no port answers.
 */
import type { BoardLister } from './boards.js';
import type { EpicRelations } from './epics.js';
import type { SpecIssue, SpecIssueReader } from './issue.js';
import type { BoardIssue, BoardIssueLink, BoardListing, BoardSubIssuesSummary } from './roadmap-board.js';
import type { RefsCell, RoadmapRowsOptions } from './roadmap-rows.js';
import type { RoadmapPullRequest, RoadmapSearch } from './roadmap.js';
import type { GhRunner } from '../adapters/tracker/github.js';

import { describe, expect, it } from 'bun:test';

import { completeSpecBody } from '../tests/spec-bodies.js';

import { renderCancelledEpicNotice } from './epic-cancel-notice.js';
import { SPEC_READY_LABEL } from './readiness.js';
import { createNativeRelations } from './relations/native.js';
import { readRoadmapEpicRows } from './roadmap-epic-rows.js';

const ROADMAP = 1;

/** The board's own repository. */
const BOARD = 'acme/board';

/** A fixed day, so lateness does not move with the clock. */
const TODAY = new Date(2026, 8, 30);

/** A `gh` every call to which fails the case: reads never spawn. */
const NO_GH: GhRunner = (args) => {
  throw new Error(`a read sent gh ${args.join(' ')}`);
};

const NATIVE = createNativeRelations({ gh: NO_GH, repository: BOARD });

/** A `labels` port whose read fails the case if it is ever called. */
const LABELS_UNCALLED: EpicRelations = {
  mode: 'labels',
  read: () => {
    throw new Error('labels mode asked the port');
  },
};

/** Issue `number` as a link node names it, on {@link BOARD}. */
function link(number: number, state: 'OPEN' | 'CLOSED' = 'OPEN'): BoardIssueLink {
  return { number, title: `Issue ${String(number)}`, state, repository: BOARD };
}

/** Summary `completed` of `total`. */
function summary(completed: number, total: number): BoardSubIssuesSummary {
  return { total, completed, percentCompleted: total === 0
    ? 0
    : Math.floor((completed * 100) / total) };
}

/** A native row, ready, with every native field, `fields` laid over it. */
function issue(number: number, fields: Partial<BoardIssue> = {}): BoardIssue {
  return {
    number,
    title: `Issue ${String(number)}`,
    body: completeSpecBody(`Issue ${String(number)}`),
    state: 'OPEN',
    stateReason: null,
    labels: [SPEC_READY_LABEL],
    type: 'code',
    module: 'unassigned',
    parent: null,
    blockedBy: { nodes: [] },
    blocking: { nodes: [] },
    subIssuesSummary: summary(0, 0),
    subIssues: { nodes: [] },
    ...fields,
  };
}

/** An epic labelled `epic:<slug>` and `horizons`, its checklist naming `checklist`, its sub-issues `subs`, GitHub counting `count`. */
function epic(
  number: number,
  slug: string,
  horizons: readonly string[],
  shape: { checklist: readonly number[]; subs: readonly BoardIssueLink[]; count: BoardSubIssuesSummary },
): BoardIssue {
  const lines = shape.checklist.map((line) => `- [ ] #${String(line)}`).join('\n');
  return issue(number, {
    title: `Epic ${slug}`,
    body: `## Acceptance criteria\n\n- it works\n\n${lines}\n`,
    labels: ['type:epic', `epic:${slug}`, ...horizons],
    type: 'epic',
    subIssuesSummary: shape.count,
    subIssues: { nodes: shape.subs },
  });
}

/** A sub-issue of epic `parent`, carrying `labels` beside `spec:ready`. */
function sub(number: number, parent: number, labels: readonly string[], fields: Partial<BoardIssue> = {}): BoardIssue {
  return issue(number, { labels: [SPEC_READY_LABEL, ...labels], parent: link(parent), ...fields });
}

/**
 * Epic #100 `now`: sub-issues #101 closed and #102 open on the listing,
 * GitHub counting 2 of 5; #102 carries `epic:alpha` and `epic:beta`, and
 * #101 no label. Epic #200 `now`: sub-issue #201 open on the listing,
 * GitHub counting 3 of 3. Epic #300 carries no horizon. #103 carries the
 * orphan `epic:zeta`. Epic #500 is closed as not planned with open member
 * #501, which #50's `Blocked by:` line names.
 */
const LISTING: readonly BoardIssue[] = [
  epic(100, 'alpha', ['horizon:now'], { checklist: [101, 102], subs: [link(102), link(101, 'CLOSED')], count: summary(2, 5) }),
  sub(101, 100, [], { state: 'CLOSED', stateReason: 'COMPLETED' }),
  sub(102, 100, ['epic:alpha', 'epic:beta']),
  issue(103, { labels: [SPEC_READY_LABEL, 'epic:zeta'] }),
  epic(200, 'beta', ['horizon:now'], { checklist: [201], subs: [link(201)], count: summary(3, 3) }),
  sub(201, 200, ['epic:beta']),
  epic(300, 'gamma', [], { checklist: [], subs: [], count: summary(0, 2) }),
  { ...epic(500, 'omega', ['horizon:now'], { checklist: [501], subs: [link(501)], count: summary(0, 1) }), state: 'CLOSED', stateReason: 'NOT_PLANNED' },
  sub(501, 500, ['epic:omega']),
  issue(50, { body: `${completeSpecBody('Issue 50')}\nBlocked by: #501\n` }),
];

/** The Roadmap: a spec, the two `now` epics and the epic with no horizon. */
const ROADMAP_BODY = ['## Next, in order', '', '- [ ] #50 — a spec', '- [ ] #100 — alpha', '- [ ] #200 — beta', '- [ ] #300 — gamma', ''].join('\n');

/** The options over {@link LISTING}, `overrides` laid over them, and how often the listing was asked. */
function planted(overrides: Partial<RoadmapRowsOptions> = {}): { options: RoadmapRowsOptions; asked: () => number } {
  let asked = 0;
  const board: BoardListing = () => {
    asked += 1;
    return Promise.resolve(LISTING);
  };
  const issues: SpecIssueReader = (number) => {
    const read: SpecIssue = { number, title: 'Roadmap', body: ROADMAP_BODY, state: 'OPEN', labels: [], author: 'owner' };
    return Promise.resolve(read);
  };
  const search: RoadmapSearch = () => Promise.resolve([{ number: ROADMAP, title: 'Roadmap' }]);
  const listBoards: BoardLister = () => Promise.resolve([]);
  const options: RoadmapRowsOptions = {
    configured: ROADMAP,
    listBoards,
    search,
    issues,
    board,
    git: () => ({ ok: true, stdout: '', stderr: '' }),
    pullRequests: (): Promise<readonly RoadmapPullRequest[]> => Promise.resolve([]),
    planNames: () => [],
    refs: () => Promise.resolve(new Map<number, RefsCell>()),
    ...overrides,
  };
  return { options, asked: () => asked };
}

/** The shown rows' epics, by number: state and `done/total`. */
function shown(read: Awaited<ReturnType<typeof readRoadmapEpicRows>>): readonly (readonly [number, string, number, number])[] {
  return read.groups.flatMap((group) => group.rows).map((row) => [
    row.epic.number,
    row.epic.state,
    row.epic.progress.done,
    row.epic.progress.total,
  ] as const);
}

describe('readRoadmapEpicRows in native mode: state and done/total', () => {
  it('shows each epic\'s done/total and state from its subIssuesSummary', async () => {
    const read = await readRoadmapEpicRows({ ...planted({ relations: NATIVE }).options, today: TODAY });

    expect(shown(read)).toEqual([[100, 'in-progress', 2, 5], [200, 'done', 3, 3]]);
  });

  it('counts the members on the listing by their epic: labels in labels mode (control)', async () => {
    const read = await readRoadmapEpicRows({ ...planted().options, today: TODAY });

    // alpha's labelled member is #102 alone, open; beta's are #102 and #201, both open.
    expect(shown(read)).toEqual([[100, 'backlog', 0, 1], [200, 'backlog', 0, 2]]);
  });

  it('carries the summary\'s count on every epic for --check, and the disagreement it makes', async () => {
    const read = await readRoadmapEpicRows({ ...planted({ relations: NATIVE }).options, today: TODAY });
    const byNumber = new Map(read.epics.epics.map((one) => [one.number, one]));

    expect(byNumber.get(300)?.progress).toEqual({ done: 0, total: 2, notPlanned: 0 });
    expect(byNumber.get(300)?.state).toBe('backlog');
    expect(byNumber.get(200)?.disagreement).toBe('done, but epic #200 is still open');
    expect(byNumber.get(100)?.members.map((member) => member.number)).toEqual([102, 101]);
  });

  it('keeps the spec lines as rows and lists the board once', async () => {
    const { options, asked } = planted({ relations: NATIVE });
    const read = await readRoadmapEpicRows({ ...options, today: TODAY });

    expect(read.specs.map((row) => row.line.issue)).toEqual([50]);
    expect(read.hidden).toBe(1);
    expect(asked()).toBe(1);
  });
});

describe('readRoadmapEpicRows in native mode: problems and the notice', () => {
  it('carries the horizon problems alone, each with a null slug', async () => {
    const read = await readRoadmapEpicRows({ ...planted({ relations: NATIVE }).options, today: TODAY });

    expect(read.problems).toEqual([{ kind: 'horizon', issue: 300, slug: null, horizons: [] }]);
    expect(read.warnings).toEqual([
      'epic #300 carries no horizon: label; add one of horizon:now, horizon:next or horizon:later',
    ]);
  });

  it('carries the two-labels, orphan and checklist problems and the notice in labels mode (control)', async () => {
    const read = await readRoadmapEpicRows({ ...planted().options, today: TODAY });

    expect(read.problems.map((problem) => [problem.kind, problem.issue])).toEqual([
      ['several-epic-labels', 102],
      ['orphan-label', 103],
      ['horizon', 300],
      ['unlabelled-checklist', 101],
      // #102's second label, epic:beta, puts it in #200, whose checklist does not name it.
      ['unlisted-member', 102],
    ]);
    expect(read.warnings.at(-1)).toBe(renderCancelledEpicNotice({ epic: 500, dependents: [50] }));
  });
});

describe('readRoadmapEpicRows in labels mode with a port', () => {
  it('never asks the port, and answers what the reading with no port answers', async () => {
    const withPort = await readRoadmapEpicRows({ ...planted({ relations: LABELS_UNCALLED }).options, today: TODAY });
    const without = await readRoadmapEpicRows({ ...planted().options, today: TODAY });

    expect(withPort).toEqual(without);
    expect(withPort.epics.epics.map((one) => Object.keys(one))).toEqual(without.epics.epics.map((one) => Object.keys(one)));
  });
});
