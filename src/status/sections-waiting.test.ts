/**
 * Tests for the pull request a hop left waiting, as the board section of
 * `rafa status` reads it into `place.waiting` (`readPlace`,
 * `./sections.ts`).
 *
 * Every case runs over scripted seams, as `./sections.test.ts` does: a
 * git that answers the branch alone, a `gh` opener that records each
 * command, the pull request double, a scripted board walk, listing and
 * owner gate. The position file and the hop record are real files in a
 * project of each case's own. No case spawns git or `gh`.
 *
 * Each case that reads no waiting line sits beside the one that does,
 * over the same world but for the one reading it names, so a reader that
 * never carried `waiting` would fail.
 */
import type { StatusConfig, StatusSeams, StatusSections } from './sections.js';
import type { GhResult } from '../adapters/tracker/github.js';
import type { BoardIssue } from '../board/roadmap-board.js';
import type { CleanupSeams } from '../cleanup/index.js';
import type { BlockedIssuesReport } from '../commands/doctor-blocked.js';
import type { HopRecord } from '../next/hop-record.js';
import type { NextBoard, NextRoadmapReading } from '../next/readings.js';
import type { GitResult, GitRunner } from '../pr/git.js';
import type { OwnerApproval } from '../pr/owner-approval.js';
import type { PullRequestDetail, PullRequestState } from '../pr/types.js';
import type { Position } from '../project/position.js';

import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { typeOfLabels } from '../adapters/tracker/github.js';
import { hopFilePath, writeHopRecord } from '../next/hop-record.js';
import { createPullRequestsDouble } from '../pr/pull-requests-double.js';
import { writePositionFile } from '../project/position.js';
import { BRANCH, plantDemoProject } from '../tests/loop-session-fixtures.js';

import { renderStatus } from './render.js';
import { readStatusSections } from './sections.js';

/** A temporary directory of this file's own. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-status-waiting-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** The settings every case reads with. */
const CONFIG: StatusConfig = {
  planDir: '.plans',
  prBase: 'main',
  prProvider: null,
  roadmapIssue: 31,
  claimsStaleAfter: '3d',
  cleanupKeep: [],
  cleanupStaleDays: 30,
  cleanupWorktreeIdleDays: 7,
};

/** Long enough that no case waits on it, short enough that a hung seam fails the case. */
const CASE_TIMEOUT_MS = 2_000;

/** What git refuses with everywhere but the branch. */
const REFUSED: GitResult = { ok: false, stdout: '', stderr: 'fatal: not a git repository' };

/** The pull request the hop left waiting. */
const PULL = 70;

/** C, the issue the hop worked. */
const TARGET = 61;

/** Home: board #31 at epic #50. */
const HOME = { board: 31, epic: 50 } as const;

/** The position back home after the hop. */
const AT_HOME: Position = { current: HOME, previous: { board: 31, epic: 60 }, home: HOME };

/** The record the `home` action writes when C's pull request is open: state `waiting`. */
const WAITING_RECORD: HopRecord = {
  kind: 'blocker',
  home: HOME,
  from: HOME,
  blocked: 51,
  target: TARGET,
  targetEpic: 60,
  targetBoard: 31,
  state: 'waiting',
  pullRequest: PULL,
  startedAt: '2026-09-29T09:00:00.000Z',
};

/** The owner gate answering an owner that has not approved. */
const NOT_APPROVED: OwnerApproval = {
  state: 'waiting',
  reason: 'owner @beta-team of board #31 has not approved #70',
  owners: [{ handle: '@beta-team', boards: [31] }],
};

/** One listing row, its type read from its labels. */
function row(number: number, labels: readonly string[], body = ''): BoardIssue {
  return { number, title: `issue ${String(number)}`, body, state: 'OPEN', stateReason: null, labels, type: typeOfLabels(labels), module: 'unassigned' };
}

/** Board #31 with the now epics #50 (#51) and #60 (#61). */
const LISTING: readonly BoardIssue[] = [
  row(31, ['type:roadmap'], '- [ ] #50\n- [ ] #60'),
  row(50, ['type:epic', 'epic:alpha', 'horizon:now']),
  row(51, ['epic:alpha']),
  row(60, ['type:epic', 'epic:beta', 'horizon:now']),
  row(61, ['epic:beta']),
];

/** The walk: next is #51, blocked by C. */
const WALK: NextRoadmapReading = { roadmap: 31, line: { issue: 51, ticked: false, why: 'rafa status', lineNumber: 1 }, passed: 0, problems: [] };

/** A board answering {@link WALK}. */
const BOARD: NextBoard = {
  next: () => Promise.resolve(WALK),
  isReady: () => Promise.resolve(true),
  blocking: () => Promise.resolve(null),
};

/** A pull request #70 in `state`. */
function pull(state: PullRequestState): PullRequestDetail {
  return {
    number: PULL,
    title: 'feat: C',
    url: `https://github.com/open-tomato/rafa/pull/${String(PULL)}`,
    state,
    headRefName: 'feat/c',
    baseRefName: 'main',
    author: { login: 'someone', isBot: false },
    isCrossRepository: false,
    updatedAt: '2026-09-29T10:00:00Z',
    body: '',
    headRefOid: 'abc123',
    mergeable: 'mergeable',
    mergeStateStatus: 'BLOCKED',
    labels: [],
    closes: [],
  };
}

/** What a case changes about the world. */
interface WorldOptions {
  /** What `get(70)` answers; the open pull request when left out. */
  readonly get?: () => Promise<PullRequestDetail | null>;
  /** What the owner gate answers; {@link NOT_APPROVED} when left out. */
  readonly gate?: () => Promise<OwnerApproval>;
}

/** The seams of a case, and every seam reached. */
interface World {
  readonly seams: StatusSeams;
  /** The pull request calls, one line each. */
  readonly pulls: () => readonly string[];
  /** Each owner gate opened and asked, in order. */
  readonly gates: readonly string[];
  /** Every `gh` command sent. */
  readonly gh: readonly string[];
}

/** Cleanup seams whose git refuses, so the housekeeping section reads nothing. */
function refusingCleanup(_cwd: string, pulls: CleanupSeams['pulls']): CleanupSeams {
  const git: GitRunner = () => REFUSED;
  return { git, gitAt: () => git, sessions: () => [], modifiedAt: () => null, realPath: (path) => path, pulls };
}

/** The seams of a case, with `options` laid over the shared world. */
function world(options: WorldOptions = {}): World {
  const gates: string[] = [];
  const gh: string[] = [];
  const double = createPullRequestsDouble({
    findOpen: () => Promise.resolve(null),
    get: options.get ?? ((): Promise<PullRequestDetail | null> => Promise.resolve(pull('open'))),
  });
  const seams: StatusSeams = {
    openGit: () => (args) => args.join(' ') === 'rev-parse --abbrev-ref HEAD'
      ? { ok: true, stdout: `${BRANCH}\n`, stderr: '' }
      : REFUSED,
    openGh: () => (args): Promise<GhResult> => {
      gh.push(args.join(' '));
      return Promise.resolve({ ok: true, stdout: '[]', stderr: '' });
    },
    pullRequests: () => double.pulls,
    board: () => BOARD,
    listing: () => () => Promise.resolve(LISTING),
    ownerGate: (gateOptions) => {
      gates.push(`open ${gateOptions.root}`);
      return (pullRequest) => {
        gates.push(`ask ${String(pullRequest)}`);
        return (options.gate ?? ((): Promise<OwnerApproval> => Promise.resolve(NOT_APPROVED)))();
      };
    },
    blockedIssues: (): Promise<BlockedIssuesReport> => Promise.resolve({ readings: [], faults: [], problem: null, unchecked: null }),
    readRemote: () => 'https://github.com/open-tomato/rafa.git',
    isAlive: () => false,
    cleanupSeams: refusingCleanup,
    now: () => new Date('2026-09-29T12:00:00Z'),
    timeoutMs: CASE_TIMEOUT_MS,
  };
  return { seams, pulls: () => double.sent().filter((line) => line.startsWith('get')), gates, gh };
}

/** A project at home, holding `record` as its hop record when one is handed. */
function project(record: HopRecord | null, position: Position = AT_HOME): { readonly root: string; readonly home: string } {
  const planted = plantDemoProject(tempBase);
  writePositionFile(planted.root, position);
  if (record !== null) writeHopRecord(planted.root, record);
  return planted;
}

/** The sections of `root` over `seams`. */
function sections(planted: { readonly root: string; readonly home: string }, seams: StatusSeams): Promise<StatusSections> {
  return readStatusSections({ root: planted.root, home: planted.home, config: CONFIG }, seams);
}

/** The board section's place, throwing when the section or the place was not read. */
function placeOf(read: StatusSections): NonNullable<Extract<StatusSections['board'], { read: true }>['place']> {
  if (!read.board.read) throw new Error(read.board.problem);
  const { place } = read.board;
  if (place === undefined) throw new Error('the board section carries no place');
  return place;
}

describe('the waiting pull request on the place', () => {
  it('carries C and the gate for a waiting record whose pull request is open and not approved', async () => {
    const { seams, pulls, gates } = world();

    const read = await sections(project(WAITING_RECORD), seams);

    expect(placeOf(read).waiting).toEqual({ issue: TARGET, pullRequest: PULL, gate: 'waiting', reason: NOT_APPROVED.reason });
    expect(pulls()).toEqual(['get 70']);
    expect(gates.filter((gate) => gate.startsWith('ask'))).toEqual(['ask 70']);
  });

  it('prints `waiting on #C (owner review)` under the board line', async () => {
    const { seams } = world();

    const read = await sections(project(WAITING_RECORD), seams);

    expect(renderStatus(read).map((line) => line.text)).toContain('  waiting on #61 (owner review)');
  });

  it('carries unresolved and unknown gates as waiting too', async () => {
    const unresolved = world({ gate: () => Promise.resolve({ state: 'unresolved', reason: 'board #31 names no Owner:', owners: [] }) });
    const unknown = world({ gate: () => Promise.resolve({ state: 'unknown', reason: 'reviews not read', owners: [] }) });

    const one = await sections(project(WAITING_RECORD), unresolved.seams);
    const two = await sections(project(WAITING_RECORD), unknown.seams);

    expect(placeOf(one).waiting?.gate).toBe('unresolved');
    expect(placeOf(two).waiting?.gate).toBe('unknown');
  });

  it('carries none once the gate approves or lets the pull request through ungated', async () => {
    const approved = world({ gate: () => Promise.resolve({ state: 'approved', owners: [] }) });
    const ungated = world({ gate: () => Promise.resolve({ state: 'not-gated' }) });

    const one = await sections(project(WAITING_RECORD), approved.seams);
    const two = await sections(project(WAITING_RECORD), ungated.seams);

    expect(Object.keys(placeOf(one))).not.toContain('waiting');
    expect(Object.keys(placeOf(two))).not.toContain('waiting');
    expect(approved.gates.filter((gate) => gate.startsWith('ask'))).toEqual(['ask 70']);
  });

  it('drops the record once the pull request merged, closed or is absent, asking no gate and leaving the file', async () => {
    for (const get of [
      (): Promise<PullRequestDetail | null> => Promise.resolve(pull('merged')),
      (): Promise<PullRequestDetail | null> => Promise.resolve(pull('closed')),
      (): Promise<PullRequestDetail | null> => Promise.resolve(null),
    ]) {
      const { seams, pulls, gates } = world({ get });
      const planted = project(WAITING_RECORD);

      const read = await sections(planted, seams);

      expect(Object.keys(placeOf(read))).not.toContain('waiting');
      expect(renderStatus(read).some((line) => line.text.includes('waiting on'))).toBe(false);
      expect(pulls()).toEqual(['get 70']);
      expect(gates).toEqual([]);
      expect(existsSync(hopFilePath(planted.root))).toBe(true);
    }
  });

  it('reads a pull request that could not be read as unknown, never approved', async () => {
    const { seams, gates } = world({ get: () => Promise.reject(new Error('gh pr view failed')) });

    const read = await sections(project(WAITING_RECORD), seams);

    expect(placeOf(read).waiting).toEqual({
      issue: TARGET,
      pullRequest: PULL,
      gate: 'unknown',
      reason: 'could not read pull request #70: gh pr view failed',
    });
    expect(gates).toEqual([]);
  });

  it('reads a gate that rejects as unknown, never approved', async () => {
    const { seams } = world({ gate: () => Promise.reject(new Error('listing failed')) });

    const read = await sections(project(WAITING_RECORD), seams);

    expect(placeOf(read).waiting).toEqual({
      issue: TARGET,
      pullRequest: PULL,
      gate: 'unknown',
      reason: 'could not read the owner gate of #70: listing failed',
    });
  });

  it('names the pull request by its own number on a record naming no C', async () => {
    const { seams } = world();
    const record: HopRecord = { ...WAITING_RECORD, kind: 'dry', blocked: null, target: null };

    const read = await sections(project(record), seams);

    expect(placeOf(read).waiting?.issue).toBe(PULL);
  });
});

describe('no waiting pull request is read', () => {
  it('carries no waiting key and sends nothing more without a record, where the same world with one does', async () => {
    const without = world();
    const withRecord = world();

    const read = await sections(project(null), without.seams);
    const control = await sections(project(WAITING_RECORD), withRecord.seams);

    expect(Object.keys(placeOf(read))).toEqual(['current', 'home', 'view', 'notices']);
    expect(read.board.read && read.board.notes).toEqual([]);
    expect(without.pulls()).toEqual([]);
    expect(without.gates).toEqual([]);
    expect(without.gh).toEqual(withRecord.gh);
    expect(placeOf(control).waiting).toBeDefined();
  });

  it('carries none for a record still away, or one closed as merged or halted', async () => {
    for (const state of ['away', 'merged', 'halted'] as const) {
      const { seams, pulls } = world();

      const read = await sections(project({ ...WAITING_RECORD, state }), seams);

      expect(Object.keys(placeOf(read))).not.toContain('waiting');
      expect(pulls()).toEqual([]);
    }
  });

  it('carries none for a waiting record naming no pull request', async () => {
    const { seams, pulls } = world();

    const read = await sections(project({ ...WAITING_RECORD, pullRequest: null }), seams);

    expect(Object.keys(placeOf(read))).not.toContain('waiting');
    expect(pulls()).toEqual([]);
  });

  it('drops a stale record, one whose home is not the position\'s, as a person switched by hand', async () => {
    const { seams, pulls } = world();
    const rehomed: Position = { current: { board: 31, epic: 60 }, previous: HOME, home: { board: 31, epic: 60 } };

    const read = await sections(project(WAITING_RECORD, rehomed), seams);

    expect(Object.keys(placeOf(read))).not.toContain('waiting');
    expect(pulls()).toEqual([]);
  });

  it('names a record that does not read in a note, and carries no waiting key', async () => {
    const { seams, pulls } = world();
    const planted = project(null);
    mkdirSync(dirname(hopFilePath(planted.root)), { recursive: true });
    writeFileSync(hopFilePath(planted.root), '{ not json');

    const read = await sections(planted, seams);

    expect(Object.keys(placeOf(read))).not.toContain('waiting');
    expect(read.board.read && read.board.notes).toHaveLength(1);
    expect(read.board.read && read.board.notes[0]).toStartWith(`${hopFilePath(planted.root)} holds no JSON`);
    expect(read.board.read && read.board.notes[0]).toEndWith(', so no waiting pull request is read');
    expect(pulls()).toEqual([]);
  });
});
