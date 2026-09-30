/**
 * Tests for the blocked count `rafa status` ends its board line with
 * (`./blocked-count.ts`), read in both modes of the board's relationships
 * port, and for how `./sections.ts` and `./render.ts` carry and word it.
 * The `labels` cases of the sections stay in `./sections.test.ts`, which
 * is past the 800-line cap.
 *
 * The native board, on `acme/board`:
 *
 * | Issue | State | Blocked by | Counted |
 * | --- | --- | --- | --- |
 * | #10 | open | #20, open | yes |
 * | #11 | open | #21, closed as `NOT_PLANNED` | no |
 * | #12 | open | `other/lib#5`, open | yes |
 * | #13 | open | #21, closed, of a list `gh` stopped short of | yes |
 * | #14 | closed | #20, open | no |
 * | #15 | open | nothing | no |
 *
 * ## The controls
 *
 *  - #11, #14 and #15 carry `spec:blocked` and a `Blocked by: #20` line,
 *    the `labels` marks, so a count that read labels or lines would count
 *    them. The `spec:blocked` listing seam answers five issues and records
 *    being asked, so a native count that fell back to it reads 5 and is
 *    seen reaching it.
 *  - #12's foreign blocker is numbered 21, the local issue the listing
 *    holds closed, so a count that dropped the repository misses #12.
 *  - The same sections read in `labels` mode carry no `mode` key, asserted
 *    by `Object.keys`, and word the count as before the port.
 *
 * Every read goes through the real adapters over a `gh` that fails any
 * call, unless a case scripts it; nothing spawns.
 */
import type { BlockedCountOptions } from './blocked-count.js';
import type { StatusConfig, StatusSeams, StatusSections } from './sections.js';
import type { GhResult, GhRunner } from '../adapters/tracker/github.js';
import type { BlockedReading } from '../board/blocked.js';
import type { BoardIssue, BoardIssueLink, BoardIssueLinks, BoardListing } from '../board/roadmap-board.js';
import type { CleanupSeams } from '../cleanup/index.js';
import type { BlockedIssuesReport } from '../commands/doctor-blocked.js';
import type { NextBoardOptions } from '../next/sources.js';
import type { GitResult, GitRunner } from '../pr/git.js';

import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { typeOfLabels } from '../adapters/tracker/github.js';
import { createLabelsRelations } from '../board/relations/labels.js';
import { createNativeRelations } from '../board/relations/native.js';
import { nativeBoardListFields } from '../board/roadmap-board.js';
import { createPullRequestsDouble } from '../pr/pull-requests-double.js';
import { BRANCH, plantDemoProject } from '../tests/loop-session-fixtures.js';

import { readBlockedCount } from './blocked-count.js';
import { renderStatus } from './render.js';
import { readStatusSections } from './sections.js';

/** A temporary directory of this file's own. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-status-blocked-count-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** The board's own repository. */
const BOARD = 'acme/board';

/** A `gh` every call to which fails the case: the reads never spawn. */
const NO_GH: GhRunner = (args) => {
  throw new Error(`a read sent gh ${args.join(' ')}`);
};

/** The `native` adapter on {@link BOARD}. */
const NATIVE = createNativeRelations({ gh: NO_GH, repository: BOARD });

/** The `labels` adapter, for the controls. */
const LABELS = createLabelsRelations({ gh: NO_GH });

/** The labels marks every control row carries. */
const LABEL_MARKS = { labels: ['spec:blocked'], body: 'Blocked by: #20\n' } as const;

/** A `blockedBy` node: issue `number` on `repository`, in `state`. */
function node(number: number, state: 'OPEN' | 'CLOSED', repository = BOARD): BoardIssueLink {
  return { number, title: `issue ${String(number)}`, state, repository };
}

/** What a case sets on a native row. */
interface RowFields {
  readonly state?: 'OPEN' | 'CLOSED';
  readonly stateReason?: string | null;
  readonly labels?: readonly string[];
  readonly body?: string;
  readonly blockedBy?: BoardIssueLinks;
}

/** A native listing row: every relationship field present, empty unless set. */
function row(number: number, fields: RowFields = {}): BoardIssue {
  const labels = fields.labels ?? [];
  return {
    number,
    title: `issue ${String(number)}`,
    body: fields.body ?? '',
    state: fields.state ?? 'OPEN',
    stateReason: fields.stateReason ?? null,
    labels,
    type: typeOfLabels(labels),
    module: 'unassigned',
    parent: null,
    blockedBy: fields.blockedBy ?? { nodes: [] },
    blocking: { nodes: [] },
    subIssuesSummary: { total: 0, completed: 0, percentCompleted: 0 },
    subIssues: { nodes: [] },
  };
}

/** The native board the module note tabulates. */
const ROWS: readonly BoardIssue[] = [
  row(10, { blockedBy: { nodes: [node(20, 'OPEN')] } }),
  row(11, { ...LABEL_MARKS, blockedBy: { nodes: [node(21, 'CLOSED')] } }),
  row(12, { blockedBy: { nodes: [node(21, 'OPEN', 'other/lib')] } }),
  row(13, { blockedBy: { nodes: [node(21, 'CLOSED')], truncated: { total: 60 } } }),
  row(14, { ...LABEL_MARKS, state: 'CLOSED', stateReason: 'COMPLETED', blockedBy: { nodes: [node(20, 'OPEN')] } }),
  row(15, LABEL_MARKS),
  row(20),
  row(21, { state: 'CLOSED', stateReason: 'NOT_PLANNED' }),
];

/** The open issues the native count holds back. */
const NATIVE_COUNT = 3;

/** The count the `spec:blocked` listing seam answers, unlike {@link NATIVE_COUNT}. */
const LABELS_COUNT = 5;

/** A `spec:blocked` report of {@link LABELS_COUNT} issues. */
const LABELS_REPORT: BlockedIssuesReport = {
  readings: Array.from({ length: LABELS_COUNT }, (_, index): BlockedReading => ({
    kind: 'blocked',
    issue: index + 1,
    line: 1,
    text: '#20',
    blockers: [20],
    foreign: [],
    unknown: [],
  })),
  faults: [],
  problem: null,
  unchecked: null,
};

/** The seams of one {@link readBlockedCount} case, and what each was asked. */
function countOptions(overrides: Partial<BlockedCountOptions> = {}): { readonly options: BlockedCountOptions; readonly asked: string[] } {
  const asked: string[] = [];
  const options: BlockedCountOptions = {
    gh: NO_GH,
    listing: () => {
      asked.push('listing');
      return Promise.resolve(ROWS);
    },
    blockedIssues: () => {
      asked.push('blockedIssues');
      return Promise.resolve(LABELS_REPORT);
    },
    ...overrides,
  };
  return { options, asked };
}

describe('readBlockedCount in native mode', () => {
  it('counts the open issues an open blocker, foreign or not, or a truncated list holds, reading the listing alone', async () => {
    const { options, asked } = countOptions({ relations: NATIVE });

    const counted = await readBlockedCount(options);

    expect(counted).toEqual({ count: NATIVE_COUNT, notes: [] });
    expect(asked).toEqual(['listing']);
  });

  it('counts a NOT_PLANNED blocker as cleared, and its OPEN control as holding', async () => {
    const reopened = ROWS.map((one) => one.number === 11
      ? row(11, { blockedBy: { nodes: [node(21, 'OPEN')] } })
      : one);
    const { options } = countOptions({ relations: NATIVE, listing: () => Promise.resolve(reopened) });

    expect((await readBlockedCount(options)).count).toBe(NATIVE_COUNT + 1);
  });

  it('answers a null count and a note in native words when the listing fails', async () => {
    const { options, asked } = countOptions({ relations: NATIVE, listing: () => Promise.reject(new Error('gh issue list failed')) });

    const counted = await readBlockedCount(options);

    expect(counted).toEqual({ count: null, notes: ['the issues with an open blocker could not be read: gh issue list failed'] });
    expect(asked).toEqual([]);
  });
});

describe('readBlockedCount in labels mode', () => {
  it('counts the spec:blocked listing and never reads the board listing, with no port or the labels one', async () => {
    for (const relations of [undefined, LABELS]) {
      const { options, asked } = countOptions(relations === undefined
        ? {}
        : { relations });

      expect(await readBlockedCount(options)).toEqual({ count: LABELS_COUNT, notes: [] });
      expect(asked).toEqual(['blockedIssues']);
    }
  });

  it('answers a null count and the label note when the spec:blocked listing fails', async () => {
    const failed: BlockedIssuesReport = { ...LABELS_REPORT, problem: 'board blocked: gh issue list failed' };
    const { options } = countOptions({ blockedIssues: () => Promise.resolve(failed) });

    expect(await readBlockedCount(options)).toEqual({
      count: null,
      notes: ['the issues labelled spec:blocked could not be read: board blocked: gh issue list failed'],
    });
  });
});

/** The settings every sections case reads with. */
const CONFIG: StatusConfig = {
  planDir: '.plans',
  prBase: 'main',
  prProvider: null,
  roadmapIssue: 31,
  cleanupKeep: [],
  cleanupStaleDays: 30,
  cleanupWorktreeIdleDays: 7,
};

/** What git refuses with everywhere but the branch. */
const REFUSED: GitResult = { ok: false, stdout: '', stderr: 'fatal: not a git repository' };

/** Cleanup seams whose git refuses, so the housekeeping section reads nothing. */
function refusingCleanup(_cwd: string, pulls: CleanupSeams['pulls']): CleanupSeams {
  const git: GitRunner = () => REFUSED;
  return { git, gitAt: () => git, sessions: () => [], modifiedAt: () => null, realPath: (path) => path, pulls };
}

/** A linked node as the native `gh issue list --json` answers it. */
function listedNode(link: BoardIssueLink): Record<string, unknown> {
  return {
    id: `I_node${String(link.number)}`,
    number: link.number,
    state: link.state,
    title: link.title,
    url: `https://github.com/${link.repository}/issues/${String(link.number)}`,
  };
}

/** {@link ROWS} as the native listing command answers them. */
function listedRows(): string {
  return JSON.stringify(ROWS.map((one) => {
    const nodes = (one.blockedBy?.nodes ?? []).map((link) => listedNode(link));
    return {
      number: one.number,
      title: one.title,
      body: one.body,
      state: one.state,
      stateReason: one.stateReason ?? '',
      labels: one.labels.map((name) => ({ name })),
      parent: null,
      blockedBy: { nodes, totalCount: one.blockedBy?.truncated?.total ?? nodes.length },
      blocking: { nodes: [], totalCount: 0 },
      subIssuesSummary: { completed: 0, percentCompleted: 0, total: 0 },
      subIssues: { nodes: [], totalCount: 0 },
    };
  }));
}

/** The seams of one sections case, and every `gh` command and board option it saw. */
interface World {
  readonly seams: StatusSeams;
  readonly gh: readonly string[];
  readonly boards: readonly NextBoardOptions[];
  readonly blockedAsked: () => number;
}

/** The sections world: the listing left to the system's own over a scripted `gh` unless `listing` is handed. */
function world(relations: StatusSeams['relations'], listing?: BoardListing): World {
  const gh: string[] = [];
  const boards: NextBoardOptions[] = [];
  let blocked = 0;
  const seams: StatusSeams = {
    openGit: () => (args) => args.join(' ') === 'rev-parse --abbrev-ref HEAD'
      ? { ok: true, stdout: `${BRANCH}\n`, stderr: '' }
      : REFUSED,
    openGh: () => (args): Promise<GhResult> => {
      gh.push(args.join(' '));
      const answer = args.slice(0, 2).join(' ') === 'issue list' && args.includes('all')
        ? listedRows()
        : '[]';
      return Promise.resolve({ ok: true, stdout: answer, stderr: '' });
    },
    pullRequests: () => createPullRequestsDouble({ findOpen: () => Promise.resolve(null) }).pulls,
    board: (options) => {
      boards.push(options);
      return {
        next: () => Promise.resolve({ roadmap: 31, line: null, passed: 0, problems: [] }),
        isReady: () => Promise.resolve(true),
        blocking: () => Promise.resolve(null),
      };
    },
    ...listing === undefined
      ? {}
      : { listing: () => listing },
    ...relations === undefined
      ? {}
      : { relations },
    blockedIssues: () => {
      blocked += 1;
      return Promise.resolve(LABELS_REPORT);
    },
    readRemote: () => 'https://github.com/acme/board.git',
    isAlive: () => false,
    cleanupSeams: refusingCleanup,
    now: () => new Date('2026-09-30T12:00:00Z'),
    timeoutMs: 2_000,
  };
  return { seams, gh, boards, blockedAsked: () => blocked };
}

/** The sections of a fresh project over `seams`. */
function sections(seams: StatusSeams): Promise<StatusSections> {
  const planted = plantDemoProject(tempBase);
  return readStatusSections({ root: planted.root, home: planted.home, config: CONFIG }, seams);
}

/** The board section's reading, throwing when it was not read. */
function boardOf(read: StatusSections): Extract<StatusSections['board'], { read: true }> {
  if (!read.board.read) throw new Error(read.board.problem);
  return read.board;
}

/** The board line `renderStatus` prints for `read`. */
function boardLine(read: StatusSections): string | undefined {
  return renderStatus(read).find((line) => line.text.startsWith('Board:'))?.text;
}

describe('the board section in native mode', () => {
  it('counts off the one native listing, sends no spec:blocked listing, and hands the walk the port', async () => {
    const { seams, gh, boards, blockedAsked } = world(NATIVE);

    const board = boardOf(await sections(seams));

    expect(board.blockedIssues).toBe(NATIVE_COUNT);
    expect(board.mode).toBe('native');
    expect(blockedAsked()).toBe(0);
    expect(gh.filter((args) => args.startsWith('issue list'))).toEqual([
      `issue list --state all --limit 1000 --json ${nativeBoardListFields}`,
    ]);
    expect(boards.map((options) => options.relations)).toEqual([NATIVE]);
  });

  it('words the count as issues with an open blocker', async () => {
    const { seams } = world(NATIVE, () => Promise.resolve(ROWS));

    expect(boardLine(await sections(seams))).toBe(`Board: roadmap #31 has no line left; ${String(NATIVE_COUNT)} issues with an open blocker`);
  });

  it('words a count not read in the native mode\'s words, with the note', async () => {
    const { seams } = world(NATIVE, () => Promise.reject(new Error('gh issue list failed')));

    const read = await sections(seams);

    expect(boardOf(read).blockedIssues).toBeNull();
    expect(boardOf(read).notes).toContain('the issues with an open blocker could not be read: gh issue list failed');
    expect(boardLine(read)).toBe('Board: roadmap #31 has no line left; the issues with an open blocker were not read');
  });
});

describe('the board section in labels mode, the control', () => {
  it('counts the spec:blocked listing, carries no mode key and words the label, with no port or the labels one', async () => {
    for (const relations of [undefined, LABELS]) {
      const { seams, gh, boards, blockedAsked } = world(relations, () => Promise.resolve(ROWS));

      const read = await sections(seams);
      const board = boardOf(read);

      expect(board.blockedIssues).toBe(LABELS_COUNT);
      expect(blockedAsked()).toBe(1);
      expect(Object.keys(board)).toEqual(['roadmap', 'next', 'passed', 'blockedIssues', 'notes', 'read']);
      expect(boards.map((options) => Object.keys(options))).toEqual([['gh', 'git', 'configured', 'listing']]);
      expect(gh).toEqual([]);
      expect(boardLine(read)).toBe(`Board: roadmap #31 has no line left; ${String(LABELS_COUNT)} issues labelled spec:blocked`);
    }
  });
});
