/**
 * Tests for the words `rafa status` shows (`render.ts`).
 *
 * Every case renders a {@link StatusSections} literal: the renderer is
 * pure, so nothing is planted, spawned or read. {@link allRead} holds
 * every section read, with one running loop and two blocked tasks; each
 * case changes only what it is about. Every `warn` reading sits beside a
 * case where the same section was read and printed at `info`, so a
 * renderer that always warned, or never did, would fail.
 */
import type { BlockedSession, SectionUnread, StatusSections } from './sections.js';
import type { SessionRecord } from '../loop/sessions.js';

import { describe, expect, it } from 'bun:test';

import { renderStatus, STATUS_SECTION_TITLES, statusData } from './render.js';

/** A session record, the fields a case does not name held fixed. */
function record(fields: Partial<SessionRecord> = {}): SessionRecord {
  return {
    sessionId: 'session-0100',
    planStub: 'rafa-101-rafa-status',
    plan: '.rafa/plans/PLAN-rafa-101-rafa-status.md',
    branch: 'feat/rafa-101-rafa-status',
    pid: 4242,
    startedAt: '2026-09-24T10:00:00.000Z',
    state: 'running',
    task: null,
    ...fields,
  };
}

const BLOCKED: BlockedSession = {
  session: record({ sessionId: 'session-0090', state: 'stopped' }),
  checklist: '/project/.rafa/plans/PLAN_TRACKER-rafa-101-rafa-status.md',
  tasks: [
    { line: 12, text: 'Add the spawned test', blocker: 'gh never answers' },
    { line: 14, text: 'Write the docs', blocker: null },
  ],
};

/** Every section read. */
function allRead(): StatusSections {
  return {
    branch: {
      read: true,
      branch: 'feat/rafa-101-rafa-status',
      plan: {
        stub: 'rafa-101-rafa-status',
        plan: '/project/.rafa/plans/PLAN-rafa-101-rafa-status.md',
        tracker: '/project/.rafa/plans/PLAN_TRACKER-rafa-101-rafa-status.md',
        tasks: { total: 5, done: 2, blocked: 2, open: 1 },
        issues: 0,
      },
      notes: ['a note the text leaves to the JSON'],
    },
    loops: { read: true, live: [record()], blocked: [BLOCKED] },
    pull: {
      read: true,
      pull: {
        summary: {
          number: 120,
          title: 'rafa status',
          url: 'https://github.com/open-tomato/rafa/pull/120',
          state: 'open',
          headRefName: 'feat/rafa-101-rafa-status',
          baseRefName: 'main',
          author: { login: 'marcos', isBot: false },
          isCrossRepository: false,
          updatedAt: '2026-09-24T09:00:00Z',
        },
        mergeable: 'mergeable',
        verdict: 'green',
      },
      notes: [],
    },
    board: {
      read: true,
      roadmap: 31,
      next: { line: { issue: 102, ticked: false, why: 'the next one', lineNumber: 7 }, ready: true, blocked: null },
      passed: 2,
      blockedIssues: 3,
      notes: [],
    },
    housekeeping: {
      read: true,
      counts: { merged: 1, stale: 0, notPushed: 2, worktrees: 3 },
      idleWorktrees: 1,
      notes: [],
    },
  };
}

/** The lines' text, for a case that reads only the words. */
function texts(sections: StatusSections): readonly string[] {
  return renderStatus(sections).map((line) => line.text);
}

/** A section not read. */
function unread(problem: string): SectionUnread {
  return { read: false, problem };
}

describe('renderStatus', () => {
  it('prints one line per section in order, the running loop and each blocked task under the loops line', () => {
    const lines = renderStatus(allRead());

    expect(lines).toEqual([
      { level: 'info', text: 'Branch: `feat/rafa-101-rafa-status`, plan `rafa-101-rafa-status` (2/5 done, 2 blocked, 1 open)' },
      { level: 'info', text: 'Loops: 1 running, 2 tasks blocked' },
      {
        level: 'info',
        text: '  session-0100: plan `rafa-101-rafa-status` on `feat/rafa-101-rafa-status`, running, pid 4242, started 2026-09-24T10:00:00.000Z',
      },
      { level: 'info', text: '  blocked: plan `rafa-101-rafa-status` line 12: Add the spawned test (gh never answers)' },
      { level: 'info', text: '  blocked: plan `rafa-101-rafa-status` line 14: Write the docs' },
      { level: 'info', text: 'Pull request: #120 rafa status, mergeable, checks green' },
      { level: 'info', text: 'Board: next is #102 on roadmap #31, ready; 3 issues labelled spec:blocked' },
      { level: 'info', text: 'Housekeeping: 1 merged, 0 stale, 2 not pushed, 3 worktrees (1 idle)' },
    ]);
  });

  it('prints the loops line alone when nothing runs and nothing is blocked', () => {
    const lines = texts({ ...allRead(), loops: { read: true, live: [], blocked: [] } });

    expect(lines.filter((line) => line.startsWith('  '))).toEqual([]);
    expect(lines).toContain('Loops: 0 running, 0 tasks blocked');
  });

  it('counts one blocked task in the singular', () => {
    const one: BlockedSession = { ...BLOCKED, tasks: [BLOCKED.tasks[0]!] };

    expect(texts({ ...allRead(), loops: { read: true, live: [], blocked: [one] } })).toContain('Loops: 0 running, 1 task blocked');
  });

  it('names a branch that names no plan', () => {
    const sections = allRead();
    if (!sections.branch.read) throw new Error('the fixture reads its branch');

    expect(texts({ ...sections, branch: { ...sections.branch, branch: 'main', plan: null } })[0]).toBe('Branch: `main`, no plan');
  });

  it('names no open pull request, and each mergeability and verdict in words', () => {
    const sections = allRead();
    if (!sections.pull.read || sections.pull.pull === null) throw new Error('the fixture reads its pull request');
    const { pull } = sections.pull;

    expect(texts({ ...sections, pull: { read: true, pull: null, notes: [] } })).toContain('Pull request: none open');
    expect(texts({ ...sections, pull: { read: true, pull: { ...pull, mergeable: 'conflicting', verdict: 'red' }, notes: [] } }))
      .toContain('Pull request: #120 rafa status, conflicting, checks red');
    expect(texts({ ...sections, pull: { read: true, pull: { ...pull, mergeable: 'unknown', verdict: 'none' }, notes: [] } }))
      .toContain('Pull request: #120 rafa status, mergeability unknown, no checks');
  });

  it('names what blocks the next line, a line not ready, a roadmap with none left and a listing not read', () => {
    const sections = allRead();
    if (!sections.board.read || sections.board.next === null) throw new Error('the fixture reads its board');
    const { board } = sections;
    const next = board.next!;
    const blocked = { issue: 102, blockers: [24], open: [24], unread: [], fault: null };

    expect(texts({ ...sections, board: { ...board, next: { ...next, blocked } } }))
      .toContain('Board: next is #102 on roadmap #31, #102 is blocked by #24 (open); 3 issues labelled spec:blocked');
    expect(texts({ ...sections, board: { ...board, next: { ...next, ready: false }, blockedIssues: 1 } }))
      .toContain('Board: next is #102 on roadmap #31, not ready; 1 issue labelled spec:blocked');
    expect(texts({ ...sections, board: { ...board, next: null, blockedIssues: null } }))
      .toContain('Board: roadmap #31 has no line left; the spec:blocked issues were not read');
  });

  it('counts one worktree in the singular', () => {
    const sections = allRead();

    expect(texts({
      ...sections,
      housekeeping: { read: true, counts: { merged: 0, stale: 0, notPushed: 0, worktrees: 1 }, idleWorktrees: 0, notes: [] },
    })).toContain('Housekeeping: 0 merged, 0 stale, 0 not pushed, 1 worktree (0 idle)');
  });

  it('prints one warn line for each section not read, naming its problem, and the read sections at info', () => {
    const lines = renderStatus({
      ...allRead(),
      pull: unread('the pull request was not read within the 5000ms network deadline'),
      board: unread('the board was not read within the 5000ms network deadline'),
    });

    expect(lines.filter((line) => line.level === 'warn')).toEqual([
      { level: 'warn', text: 'Pull request: not read: the pull request was not read within the 5000ms network deadline' },
      { level: 'warn', text: 'Board: not read: the board was not read within the 5000ms network deadline' },
    ]);
    expect(lines.filter((line) => line.level === 'info').map((line) => line.text.split(':')[0]))
      .toEqual(['Branch', 'Loops', '  session-0100', '  blocked', '  blocked', 'Housekeeping']);
  });

  it('prints a warn line and nothing under it for a loops section not read', () => {
    const lines = renderStatus({ ...allRead(), loops: unread('the runs directory could not be read') });

    expect(lines.filter((line) => line.text.startsWith('  '))).toEqual([]);
    expect(lines[1]).toEqual({ level: 'warn', text: 'Loops: not read: the runs directory could not be read' });
  });

  it('prints five warn lines, one per title, when no section was read', () => {
    const problem = unread('nothing answered');
    const lines = renderStatus({ branch: problem, loops: problem, pull: problem, board: problem, housekeeping: problem });

    expect(lines).toEqual(Object.values(STATUS_SECTION_TITLES).map((title) => ({
      level: 'warn',
      text: `${title}: not read: nothing answered`,
    })));
  });
});

describe('statusData', () => {
  it('holds every section under its own key, read first, surviving a JSON round trip unchanged', () => {
    const sections: StatusSections = {
      ...allRead(),
      branch: { branch: 'main', plan: null, notes: [], read: true },
      board: { problem: 'pr.provider is gitlab', read: false },
    };

    const data = statusData(sections);

    expect(data).toEqual(sections);
    expect(JSON.parse(JSON.stringify(data))).toEqual(data);
    expect(Object.keys(data)).toEqual(['branch', 'loops', 'pull', 'board', 'housekeeping']);
    expect(Object.keys(sections.branch).at(-1)).toBe('read');
    expect(Object.keys(data.branch)).toEqual(['read', 'branch', 'plan', 'notes']);
    expect(Object.keys(data.board)).toEqual(['read', 'problem']);
  });

  it('carries what the text leaves out: the notes, the paths and the url', () => {
    const data = statusData(allRead());

    expect(data.branch.read && data.branch.notes).toEqual(['a note the text leaves to the JSON']);
    expect(data.branch.read && data.branch.plan?.tracker).toBe('/project/.rafa/plans/PLAN_TRACKER-rafa-101-rafa-status.md');
    expect(data.pull.read && data.pull.pull?.summary.url).toBe('https://github.com/open-tomato/rafa/pull/120');
  });

  it('is a copy: changing the data leaves the reading as it was', () => {
    const sections = allRead();

    const data = statusData(sections);
    (data.housekeeping as { counts: { merged: number } }).counts.merged = 99;

    expect(sections.housekeeping.read && sections.housekeeping.counts.merged).toBe(1);
  });
});
