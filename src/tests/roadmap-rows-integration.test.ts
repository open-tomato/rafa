/**
 * Board-level integration test for `readRoadmapRows`
 * (`src/board/roadmap-rows.ts`): the real board listing and open pull
 * request readers run over ONE planted `gh` runner, the branch scan over a
 * planted git runner, and the plan dir is a real temporary directory.
 *
 * The unreachable board comes first (warning carried, order intact,
 * columns empty), then the four-row board of the definition of done and a
 * `spec:ready` issue missing a heading. Each case counts the board
 * listing calls and the Roadmap reads: exactly one of each.
 */
import type { GhResult, GhRunner } from '../adapters/tracker/github.js';
import type { SpecIssue, SpecIssueReader } from '../board/issue.js';
import type { RoadmapRow, RoadmapRowsOptions } from '../board/roadmap-rows.js';
import type { GitRunner } from '../pr/git.js';

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { LIST_HEADINGS, SPEC_READY_LABEL, TEMPLATE_HEADINGS } from '../board/readiness.js';
import { createGhBoardListing } from '../board/roadmap-board.js';
import {
  blockersText,
  createPlanDirNames,
  hasText,
  OUTLINE_HEADINGS,
  readRoadmapRows,
  specText,
} from '../board/roadmap-rows.js';
import { createGhOpenPullRequests } from '../board/roadmap.js';

import { completeSpecBody } from './spec-bodies.js';

const ROADMAP = 1;

const ROADMAP_BODY = [
  '## Next, in order',
  '',
  '- [ ] #11 — ready',
  '- [ ] #12 — outline',
  '- [ ] #13 — blocked',
  '- [ ] #14 — plan and branch',
  '- [ ] #15 — stale label',
  '',
].join('\n');

/** A body carrying `headings` of the template, each filled. */
function bodyWith(headings: readonly string[]): string {
  return headings.map((heading) => {
    const content = LIST_HEADINGS.includes(heading)
      ? '- one item'
      : 'Written.';
    return `## ${heading}\n\n${content}\n`;
  }).join('\n');
}

/** One issue as `gh issue list --json` writes it. */
function ghIssue(number: number, body: string, state: 'OPEN' | 'CLOSED', labels: readonly string[]): object {
  return { number, title: `Issue ${String(number)}`, body, state, labels: labels.map((name) => ({ name })) };
}

const BOARD_JSON = JSON.stringify([
  ghIssue(11, completeSpecBody('Eleven'), 'OPEN', [SPEC_READY_LABEL]),
  ghIssue(12, bodyWith(TEMPLATE_HEADINGS.slice(0, OUTLINE_HEADINGS - 1)), 'OPEN', []),
  ghIssue(13, `${completeSpecBody('Thirteen')}\nBlocked by: #20, #21\n`, 'OPEN', [SPEC_READY_LABEL]),
  ghIssue(14, completeSpecBody('Fourteen'), 'OPEN', [SPEC_READY_LABEL]),
  ghIssue(15, bodyWith(TEMPLATE_HEADINGS.filter((heading) => heading !== 'Design')), 'OPEN', [SPEC_READY_LABEL]),
  ghIssue(20, completeSpecBody('Twenty'), 'OPEN', []),
  ghIssue(21, completeSpecBody('Twenty-one'), 'CLOSED', []),
]);

const PLAN_NAMES = ['PLAN-rafa-14-plan-and-branch.md'];

const scratch = mkdtempSync(join(tmpdir(), 'rafa-roadmap-rows-'));
afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

/** A `gh` answering the listing with `board` and the pull request list with none open. */
function plantedGh(board: GhResult, calls: string[][]): GhRunner {
  return (args) => {
    calls.push([...args]);
    if (args[0] === 'issue' && args[1] === 'list') return Promise.resolve(board);
    if (args[0] === 'pr' && args[1] === 'list') return Promise.resolve({ ok: true, stdout: '[]', stderr: '' });
    return Promise.resolve({ ok: false, stdout: '', stderr: `unplanted: ${args.join(' ')}` });
  };
}

const git: GitRunner = (args) => ({
  ok: true,
  stdout: args[0] === 'ls-remote'
    ? ''
    : 'refs/heads/main\nrefs/heads/feat/rafa-14-plan-and-branch',
  stderr: '',
});

/** The options over `board`, with the calls the `gh` and the Roadmap reader saw. */
function planted(board: GhResult): {
  options: RoadmapRowsOptions;
  ghCalls: string[][];
  roadmapReads: number[];
} {
  const ghCalls: string[][] = [];
  const roadmapReads: number[] = [];
  const gh = plantedGh(board, ghCalls);
  const dir = mkdtempSync(join(scratch, 'plans-'));
  for (const name of PLAN_NAMES) writeFileSync(join(dir, name), '# plan\n');
  const issues: SpecIssueReader = (number) => {
    roadmapReads.push(number);
    const read: SpecIssue = { number, title: 'Roadmap', body: ROADMAP_BODY, state: 'OPEN', labels: [], author: 'owner' };
    return Promise.resolve(read);
  };
  const options: RoadmapRowsOptions = {
    configured: ROADMAP,
    search: () => Promise.reject(new Error('no title search expected')),
    issues,
    board: createGhBoardListing({ gh }),
    git,
    pullRequests: createGhOpenPullRequests({ gh }),
    planNames: createPlanDirNames(dir),
  };
  return { options, ghCalls, roadmapReads };
}

/** Each row as the three printed cells. */
function cells(rows: readonly RoadmapRow[]): readonly (readonly [number, string, string, string])[] {
  return rows.map((row) => [row.line.issue, specText(row.spec), blockersText(row.blockers), hasText(row.has)]);
}

/** How many of `calls` are the board listing. */
function listingCalls(calls: readonly string[][]): number {
  return calls.filter((args) => args[0] === 'issue' && args[1] === 'list').length;
}

describe('readRoadmapRows over a planted gh, git and plan dir', () => {
  it('carries a warning and keeps every row in order with empty columns when the board is unreachable', async () => {
    const { options, ghCalls, roadmapReads } = planted({ ok: false, stdout: '', stderr: 'network down' });
    const read = await readRoadmapRows(options);

    expect(read.warnings).toHaveLength(1);
    expect(read.warnings[0]).toContain('network down');
    expect(read.rows.map((row) => row.line.issue)).toEqual([11, 12, 13, 14, 15]);
    expect(read.rows.every((row) => row.issue === null && row.spec === null && row.blockers.length === 0)).toBe(true);
    expect(cells(read.rows).map(([, spec, blocked]) => [spec, blocked])).toEqual(Array(5).fill(['', '']));
    expect(read.rows.find((row) => row.line.issue === 14)?.has.map((mark) => mark.kind)).toEqual(['plan', 'branch']);
    expect(listingCalls(ghCalls)).toBe(1);
    expect(roadmapReads).toEqual([ROADMAP]);
  });

  it('reads the definition of done\'s four rows and a stale label off one listing and one Roadmap read', async () => {
    const { options, ghCalls, roadmapReads } = planted({ ok: true, stdout: BOARD_JSON, stderr: '' });
    const read = await readRoadmapRows(options);

    expect(read.warnings).toEqual([]);
    expect(cells(read.rows)).toEqual([
      [11, 'ready', '', ''],
      [12, 'outline', '', ''],
      [13, 'ready', '#20 open, #21 closed', ''],
      [14, 'ready', '', 'plan, branch'],
      [15, 'label: ready, gate: gaps', '', ''],
    ]);
    expect(listingCalls(ghCalls)).toBe(1);
    expect(roadmapReads).toEqual([ROADMAP]);
  });
});
