/**
 * Tests for the roadmap pick behind `plan create --next`
 * (`src/board/spec-source-roadmap.ts`) in `native` mode:
 * `pickRoadmapIssue` handed the board's relationships port, reading what
 * a pick waits on from its row on the run's one listing, and an epic's
 * lines from its sub-issues. The `labels` cases stay in
 * `./spec-source-roadmap.test.ts`.
 *
 * Every case calls `pickRoadmapIssue` directly over one literal native
 * board, read through the real `native` adapter made over a `gh` that
 * fails any call. Nothing spawns: the issue reader answers planted rows
 * and records every number asked, and fails any it was not planted, so a
 * per-blocker read would be seen; the listing counts its calls. Each
 * case writes under its own temporary directory, so no case reads the
 * checkout's own `.rafa/position.json` or `.rafa/hop.json`.
 *
 * ## The controls
 *
 *  - Every waiting row also carries `spec:blocked` and a `Blocked by:`
 *    line naming the OPEN #30, never its native blocker, and the first
 *    case reads the same board through the `labels` adapter, where #30
 *    is what the pick waits on and the listing is never asked. A native
 *    reading that fell back to the label or the line names #30.
 *  - The `NOT_PLANNED` blocker is paired with the same blocker OPEN,
 *    which holds the pick.
 *  - The foreign blocker is numbered as a local issue the board holds
 *    CLOSED, so a reading that dropped the repository plans the pick;
 *    it is paired with the same foreign blocker CLOSED, which plans it.
 *  - The epic cases order the sub-issues against their numbers, #83
 *    before #82, so a walk sorted by number picks the wrong one first,
 *    and the place case is read again through the `labels` adapter,
 *    where the epic carries no `epic:` label and runs dry.
 *
 * Two mutations of `spec-source-roadmap.ts` were driven on 2026-09-30,
 * one at a time, over this file against 11 pass and 0 fail, the module
 * restored from a scratch copy and verified with `shasum -c` after each:
 * the port never handed to what a pick waits on went 1 pass and 10
 * fail; the port never handed to the epic walk went 8 pass and 3 fail,
 * the three epic cases.
 */
import type { SpecIssue } from './issue.js';
import type { BoardIssue, BoardIssueLink } from './roadmap-board.js';
import type { RoadmapOutcome, RoadmapPickOptions, RoadmapSeams } from './spec-source-roadmap.js';
import type { GhRunner } from '../adapters/tracker/github.js';
import type { HopRecord } from '../next/hop-record.js';
import type { Place } from '../project/position.js';

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';

import { typeOfLabels } from '../adapters/tracker/github.js';
import { writeHopRecord } from '../next/hop-record.js';
import { positionAt, writePositionFile } from '../project/position.js';
import { sinkOutput } from '../tests/output-sinks.js';

import { noAlternativeMessage, notOnListingMessage, unaskedMessage } from './blocked-line.js';
import { SPEC_BLOCKED_LABEL } from './blocked.js';
import { dryEpicSentence, NOW_HORIZON_LABEL } from './epic-walk.js';
import { SPEC_LABEL } from './issue.js';
import { SPEC_READY_LABEL } from './readiness.js';
import { createLabelsRelations } from './relations/labels.js';
import { createNativeRelations } from './relations/native.js';
import { ROADMAP_TITLE } from './roadmap.js';
import {
  alternativeLine,
  hopBlockedMessage,
  hopPickLine,
  pickLine,
  pickRoadmapIssue,
  roadmapHeaderLine,
} from './spec-source-roadmap.js';

/** The board's own repository. */
const REPOSITORY = 'acme/board';

/** The repository a foreign blocker lives on. */
const OTHER = 'other/lib';

/** A `gh` every call to which fails the case: reads never spawn. */
const NO_GH: GhRunner = (args) => {
  throw new Error(`a read sent gh ${args.join(' ')}`);
};

/** The `native` adapter on {@link REPOSITORY}. */
const NATIVE = createNativeRelations({ gh: NO_GH, repository: REPOSITORY });

/** The `labels` adapter, for the controls. */
const LABELS = createLabelsRelations({ gh: NO_GH });

/** The roadmap every case reads, unless a place names another board. */
const ROADMAP = 31;

/** The second board a place case switches to. */
const BOARD = 40;

/** The epic the epic cases walk: #83 then #82, against their numbers. */
const EPIC = 80;

/** C, the away hop's target: on no roadmap a walk reads, so only the record can pick it. */
const HOP_TARGET = 90;

/** Where each case writes. */
let parent = '';
let root = '';

beforeAll(() => {
  parent = mkdtempSync(join(tmpdir(), 'rafa-spec-source-roadmap-native-'));
});

beforeEach(() => {
  root = mkdtempSync(join(parent, 'case-'));
});

afterAll(() => {
  rmSync(parent, { recursive: true, force: true });
});

/** A link node: issue `number` on `repository`, in `state`. */
function node(number: number, state: 'OPEN' | 'CLOSED' = 'OPEN', repository = REPOSITORY): BoardIssueLink {
  return { number, title: `issue ${String(number)}`, state, repository };
}

/** The fields a case may set on a native row. */
interface RowFields {
  readonly title?: string;
  readonly labels?: readonly string[];
  readonly state?: 'OPEN' | 'CLOSED';
  readonly stateReason?: string | null;
  readonly body?: string;
  readonly parent?: number;
  readonly blockedBy?: readonly BoardIssueLink[];
  readonly subIssues?: readonly number[];
}

/** A native row carrying all five native fields, its type read from its labels. */
function row(number: number, fields: RowFields = {}): BoardIssue {
  const labels = fields.labels ?? [SPEC_LABEL, SPEC_READY_LABEL];
  const subIssues = fields.subIssues ?? [];
  return {
    number,
    title: fields.title ?? `spec ${String(number)}`,
    body: fields.body ?? `## What you get\n\nIssue ${String(number)}.\n`,
    state: fields.state ?? 'OPEN',
    stateReason: fields.stateReason ?? null,
    labels,
    type: typeOfLabels(labels),
    module: 'unassigned',
    parent: fields.parent === undefined
      ? null
      : node(fields.parent),
    blockedBy: { nodes: fields.blockedBy ?? [] },
    blocking: { nodes: [] },
    subIssuesSummary: { total: subIssues.length, completed: 0, percentCompleted: 0 },
    subIssues: { nodes: subIssues.map((sub) => node(sub)) },
  };
}

/**
 * A ready row labelled `spec:blocked` whose body's line names the OPEN
 * #30, the control every case carries, waiting natively on `blockedBy`.
 */
function waiting(number: number, blockedBy: readonly BoardIssueLink[], fields: RowFields = {}): BoardIssue {
  return row(number, {
    labels: [SPEC_LABEL, SPEC_READY_LABEL, SPEC_BLOCKED_LABEL],
    body: `## What you get\n\nIssue ${String(number)}.\n\nBlocked by: #30\n`,
    blockedBy,
    ...fields,
  });
}

/** A roadmap body naming `lines`, one checklist line each. */
function roadmapBody(...lines: readonly number[]): string {
  return lines.map((line) => `- [ ] #${String(line)} spec ${String(line)}`).join('\n');
}

/**
 * The board around `rows`: the roadmap naming `lines`, the OPEN #30 the
 * labels name, #24 OPEN, #7 CLOSED, and #25 closed as not planned.
 */
function boardOf(lines: readonly number[], ...rows: readonly BoardIssue[]): readonly BoardIssue[] {
  return [
    row(ROADMAP, { title: ROADMAP_TITLE, labels: [], body: roadmapBody(...lines) }),
    row(30),
    row(24),
    row(7, { state: 'CLOSED', stateReason: 'COMPLETED' }),
    row(25, { state: 'CLOSED', stateReason: 'NOT_PLANNED' }),
    ...rows,
  ];
}

/** The roadmap #57, #58, #59, with #57 waiting on `blockedBy` and #58 waiting on the labels alone. */
function waitingBoard(blockedBy: readonly BoardIssueLink[]): readonly BoardIssue[] {
  return boardOf([57, 58, 59], waiting(57, blockedBy), waiting(58, []), row(59));
}

/** A reader over `board`, recording every number asked; one nobody planted is a failed read. */
function plantedIssues(board: readonly BoardIssue[]): {
  readonly read: (issue: number) => Promise<SpecIssue>;
  readonly asked: () => readonly number[];
} {
  let asked: readonly number[] = [];
  return {
    read: (issue: number) => {
      asked = [...asked, issue];
      const found = board.find((planted) => planted.number === issue);
      return found === undefined
        ? Promise.reject(new Error(`no issue ${String(issue)} was planted`))
        : Promise.resolve({
          number: found.number,
          title: found.title,
          body: found.body,
          state: found.state,
          labels: found.labels,
          author: 'maintainer',
        });
    },
    asked: () => asked,
  };
}

/** A listing over `rows`, counting its calls. */
function countedListing(rows: readonly BoardIssue[]): {
  readonly listing: () => Promise<readonly BoardIssue[]>;
  readonly calls: () => number;
} {
  let calls = 0;
  return {
    listing: () => {
      calls += 1;
      return Promise.resolve(rows);
    },
    calls: () => calls,
  };
}

/** The lines a pick printed, by level. */
interface Lines {
  readonly info: string[];
  readonly warn: string[];
}

/** What one pick came to, with everything it read and printed. */
interface Picked {
  readonly outcome: RoadmapOutcome;
  readonly lines: Lines;
  readonly asked: readonly number[];
  readonly listed: number;
}

/** What a case varies: the board, the port, the listing's rows, and the other seams. */
interface PickCase {
  readonly board: readonly BoardIssue[];
  readonly relations?: RoadmapSeams['relations'];
  /** The rows the listing answers; the board when left out. */
  readonly listed?: readonly BoardIssue[];
  readonly seams?: Partial<RoadmapSeams>;
  readonly options?: Partial<RoadmapPickOptions>;
}

/** `pickRoadmapIssue` over `pick.board`, in `native` mode unless the case names another port. */
async function pickOver(pick: PickCase): Promise<Picked> {
  const lines: Lines = { info: [], warn: [] };
  const issues = plantedIssues(pick.board);
  const listing = countedListing(pick.listed ?? pick.board);
  const outcome = await pickRoadmapIssue({
    roadmap: null,
    root,
    issues: issues.read,
    output: sinkOutput({
      info: (message) => {
        lines.info.push(message);
      },
      warn: (message) => {
        lines.warn.push(message);
      },
    }),
    seams: {
      configured: ROADMAP,
      listBoards: () => Promise.resolve([]),
      search: () => Promise.resolve([{ number: ROADMAP, title: ROADMAP_TITLE }]),
      git: () => ({ ok: true, stdout: '', stderr: '' }),
      pullRequests: () => Promise.resolve([]),
      listing: listing.listing,
      relations: pick.relations ?? NATIVE,
      ...pick.seams,
    },
    ...pick.options,
  });
  return { outcome, lines, asked: issues.asked(), listed: listing.calls() };
}

/** The line a roadmap line `issue` is picked on. */
function lineOf(issue: number, lineNumber: number): Parameters<typeof pickLine>[0] {
  return { issue, ticked: false, why: `spec ${String(issue)}`, lineNumber };
}

describe('a pick\'s blockers in native mode', () => {
  it('reads an open blockedBy node off the listing, never the label, the line or a per-blocker read', async () => {
    const board = waitingBoard([node(24)]);

    const native = await pickOver({ board });
    const labels = await pickOver({ board, relations: LABELS });

    expect(native.outcome).toEqual({ stop: 'blocked' });
    expect(native.lines.info).toEqual([
      roadmapHeaderLine(ROADMAP),
      pickLine(lineOf(57, 1)),
      '   🚧 #57 is blocked by #24 (open)',
      // #58 waits on the label and the line alone, so native mode offers it.
      alternativeLine(lineOf(58, 2)),
      unaskedMessage(57, 58),
    ]);
    expect(native.asked).not.toContain(24);
    expect(native.asked).not.toContain(30);
    expect(native.listed).toBe(1);
    // The control: the labels adapter names #30 off the line, passes
    // #58 for the same line, and never asks the listing.
    expect(labels.lines.info[2]).toBe('   🚧 #57 is blocked by #30 (open)');
    expect(labels.lines.info).toContain(alternativeLine(lineOf(59, 3)));
    expect(labels.listed).toBe(0);
  });

  it('plans a pick with no blockedBy node, though its label and line say it waits', async () => {
    const picked = await pickOver({ board: waitingBoard([]) });

    expect(picked.outcome).toEqual({ issue: 57 });
    expect(picked.lines.info).toEqual([roadmapHeaderLine(ROADMAP), pickLine(lineOf(57, 1))]);
    expect(picked.listed).toBe(1);
  });

  it('plans a pick whose one blocker closed as NOT_PLANNED, and holds it while that blocker is open', async () => {
    const cleared = await pickOver({ board: waitingBoard([node(25, 'CLOSED')]) });
    const held = await pickOver({ board: waitingBoard([node(25, 'OPEN')]) });

    expect(cleared.outcome).toEqual({ issue: 57 });
    expect(held.outcome).toEqual({ stop: 'blocked' });
    expect(held.lines.info).toContain('   🚧 #57 is blocked by #25 (open)');
  });

  it('holds a pick on an open blocker in another repository, named with it, and plans it once that closes', async () => {
    // Local #7 is CLOSED: a reading that dropped the repository plans #57.
    const held = await pickOver({ board: waitingBoard([node(7, 'OPEN', OTHER)]) });
    const cleared = await pickOver({ board: waitingBoard([node(7, 'CLOSED', OTHER)]) });

    expect(held.outcome).toEqual({ stop: 'blocked' });
    expect(held.lines.info).toContain(`   🚧 #57 is blocked by ${OTHER}#7 (open)`);
    expect(held.asked).not.toContain(7);
    expect(cleared.outcome).toEqual({ issue: 57 });
  });

  it('holds back a pick the listing does not hold, naming why, rather than planning over unread links', async () => {
    const board = waitingBoard([]);

    const picked = await pickOver({ board, listed: board.filter((issue) => issue.number !== 57) });

    expect(picked.outcome).toEqual({ stop: 'blocked' });
    expect(picked.lines.info).toContain(`   🚧 ${notOnListingMessage(57)}`);
  });

  it('plans the alternative the offer answers yes to, handed the native blocked line', async () => {
    let offered: readonly number[] = [];

    const picked = await pickOver({
      board: waitingBoard([node(24)]),
      seams: {
        offerAlternative: (request) => {
          offered = [request.blocked.issue, ...request.blocked.open, request.line.issue];
          return Promise.resolve(true);
        },
      },
    });

    expect(picked.outcome).toEqual({ issue: 58 });
    expect(offered).toEqual([57, 24, 58]);
    expect(picked.listed).toBe(1);
  });
});

/** An open `now` epic holding #83 then #82 as sub-issues, with #83 waiting on `blockedBy`. */
function epicRows(blockedBy: readonly BoardIssueLink[], labels: readonly string[]): readonly BoardIssue[] {
  return [
    row(EPIC, { title: 'The epic', labels, subIssues: [83, 82], body: '## Acceptance criteria\n' }),
    row(82, { parent: EPIC }),
    row(83, { parent: EPIC, blockedBy }),
  ];
}

describe('an epic walked in native mode', () => {
  it('walks into a now epic\'s sub-issues in the epic\'s order, reading the first one\'s blockers off the listing', async () => {
    const board = boardOf([EPIC, 59], ...epicRows([node(24)], ['type:epic', NOW_HORIZON_LABEL]), row(59));

    const picked = await pickOver({ board });

    expect(picked.outcome).toEqual({ stop: 'blocked' });
    expect(picked.lines.info[1]).toContain('its open sub-issues, in the order the epic holds them');
    expect(picked.lines.info[2]).toBe(pickLine({ issue: 83, ticked: false, why: 'spec 83', lineNumber: 3 }));
    expect(picked.lines.info[3]).toBe('   🚧 #83 is blocked by #24 (open)');
    // The alternative is looked for inside the epic, never on the roadmap's #59.
    expect(picked.lines.info).toContain(alternativeLine({ issue: 82, ticked: false, why: 'spec 82', lineNumber: 4 }));
    expect(picked.asked).not.toContain(59);
    expect(picked.listed).toBe(1);
  });

  it('walks the epic the place names through the port, where the labels adapter finds it dry', async () => {
    const board = [
      ...boardOf([]),
      row(BOARD, { title: 'Team board', labels: ['type:roadmap'], body: '- [ ] #42 the first line' }),
      row(42),
      ...epicRows([], ['type:epic', 'horizon:later']),
    ];
    const place: Place = { board: BOARD, epic: EPIC };
    writePositionFile(root, positionAt(place));

    const native = await pickOver({ board });
    const labels = await pickOver({ board, relations: LABELS });

    expect(native.outcome).toEqual({ issue: 83 });
    expect(native.lines.info.at(-1)).toBe(pickLine({ issue: 83, ticked: false, why: 'spec 83', lineNumber: 2 }));
    expect(native.asked).not.toContain(42);
    expect(native.listed).toBe(1);
    // The control: the epic carries no `epic:` label, so the labels
    // adapter reads no member and the walk runs dry on it.
    expect(labels.outcome).toEqual({ stop: 'exhausted' });
    expect(labels.lines.info.at(-1)).toBe(dryEpicSentence({
      line: { issue: EPIC, ticked: false, why: 'The epic', lineNumber: 0 },
      number: EPIC,
      title: 'The epic',
      slug: null,
      progress: { done: 0, total: 0, notPlanned: 0 },
      checklist: [],
      labelOnly: [],
    }));
  });

  it('says no alternative is left when every other sub-issue is blocked too', async () => {
    const rows = epicRows([node(24)], ['type:epic', NOW_HORIZON_LABEL])
      .map((issue) => (issue.number === 82
        ? row(82, { parent: EPIC, blockedBy: [node(24)] })
        : issue));
    const board = boardOf([EPIC], ...rows);

    const picked = await pickOver({ board });

    expect(picked.outcome).toEqual({ stop: 'blocked' });
    expect(picked.lines.info.at(-1)).toBe(noAlternativeMessage(83));
  });
});

/** Where a hop case calls home: the default roadmap, no epic. */
const HOME: Place = { board: ROADMAP, epic: null };

/** A blocker hop from {@link HOME} to C, still away. */
function hopRecord(): HopRecord {
  return {
    kind: 'blocker',
    home: HOME,
    from: HOME,
    blocked: 20,
    target: HOP_TARGET,
    targetEpic: EPIC,
    targetBoard: BOARD,
    state: 'away',
    pullRequest: null,
    startedAt: '2026-09-30T10:00:00.000Z',
  };
}

/** A checkout away on the hop, its position standing at {@link BOARD}. */
function awayOnHop(): void {
  writePositionFile(root, { current: { board: BOARD, epic: null }, previous: HOME, home: HOME });
  writeHopRecord(root, hopRecord());
}

describe('the away hop\'s target in native mode', () => {
  it('stops blocked on a C whose blockedBy node is open, read off the one listing', async () => {
    awayOnHop();
    const board = boardOf([20], row(20), waiting(HOP_TARGET, [node(24)]));

    const picked = await pickOver({ board, options: { followHop: true } });

    expect(picked.outcome).toEqual({ stop: 'blocked' });
    expect(picked.lines.info.slice(1)).toEqual([
      `   🚧 #${String(HOP_TARGET)} is blocked by #24 (open)`,
      hopBlockedMessage(HOP_TARGET),
    ]);
    expect(picked.asked).toEqual([]);
    expect(picked.listed).toBe(1);
  });

  it('picks a C with no blockedBy node, though its label and line say it waits, reading no roadmap', async () => {
    awayOnHop();
    const board = boardOf([20], row(20), waiting(HOP_TARGET, []));

    const picked = await pickOver({ board, options: { followHop: true } });
    const labels = await pickOver({ board, relations: LABELS, options: { followHop: true } });

    expect(picked.outcome).toEqual({ issue: HOP_TARGET });
    expect(picked.lines.info.at(-1)).toBe(hopPickLine(HOP_TARGET));
    expect(picked.asked).not.toContain(ROADMAP);
    // The control: the labels adapter reads C's line naming the open #30,
    // off the reader, and never lists the board.
    expect(labels.outcome).toEqual({ stop: 'blocked' });
    expect(labels.asked).toEqual([HOP_TARGET, 30]);
    expect(labels.listed).toBe(0);
  });
});
