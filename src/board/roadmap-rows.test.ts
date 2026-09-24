/**
 * Tests for the roadmap rows (`src/board/roadmap-rows.ts`): the Roadmap's
 * lines joined to one planted board listing, each row's `spec`,
 * `blocked by` and `has` readings, the unticked and `all` selections,
 * and what each failed reading degrades to.
 *
 * Every read is planted: the board is a {@link BoardListing} answering a
 * fixed list, the Roadmap a reader answering one body, git a runner
 * answering fixed refs, the pull requests a fixed list and the plan dir
 * a fixed list of names. Only {@link createPlanDirNames} touches a disk,
 * under a temporary directory of its own.
 *
 * The planted board holds one row per state: `spec` ready, gaps,
 * outline, a stale label and a missing label; `blocked by` open, closed,
 * off the board and on another repository; `has` plan, branch and pr.
 */
import type { SpecIssue, SpecIssueReader } from './issue.js';
import type { BoardIssue, BoardListing } from './roadmap-board.js';
import type { RoadmapRow, RoadmapRowsOptions } from './roadmap-rows.js';
import type { RoadmapPullRequest, RoadmapSearch } from './roadmap.js';
import type { GitResult, GitRunner } from '../pr/git.js';

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { CommandExit } from '../cli/command.js';
import { completeSpecBody } from '../tests/spec-bodies.js';

import { LIST_HEADINGS, SPEC_READY_LABEL, TEMPLATE_HEADINGS } from './readiness.js';
import {
  blockersText,
  createPlanDirNames,
  hasPlanFor,
  hasText,
  OUTLINE_HEADINGS,
  readRoadmapRows,
  readSpecColumn,
  specText,
} from './roadmap-rows.js';

const ROADMAP = 1;

/** A body carrying `headings` of the template, each filled, the list ones with an item. */
function bodyWith(headings: readonly string[]): string {
  return headings.map((heading) => {
    const content = LIST_HEADINGS.includes(heading)
      ? '- one item'
      : 'Written.';
    return `## ${heading}\n\n${content}\n`;
  }).join('\n');
}

/** Every template heading but `left`, filled. */
function bodyWithout(left: string): string {
  return bodyWith(TEMPLATE_HEADINGS.filter((heading) => heading !== left));
}

/** One issue on the planted board. */
function issue(number: number, fields: Partial<BoardIssue> = {}): BoardIssue {
  return {
    number,
    title: `Issue ${String(number)}`,
    body: completeSpecBody(`Issue ${String(number)}`),
    state: 'OPEN',
    labels: [SPEC_READY_LABEL],
    type: 'code',
    module: 'unassigned',
    ...fields,
  };
}

/** The Roadmap: one ticked line, then one line per state, then one the board lacks. */
const ROADMAP_BODY = [
  '## Next, in order',
  '',
  '- [x] #10 — done already',
  '- [ ] #11 — ready, with a plan',
  '- [ ] #12 — gaps',
  '- [ ] #13 — outline',
  '- [ ] #14 — a stale label',
  '- [ ] #15 — complete, unlabelled',
  '- [ ] #16 — blocked, with a branch',
  '- [ ] #17 — with a pull request',
  '- [ ] #18 — not on the board',
  '',
].join('\n');

/** The planted board: every roadmap issue but #18, and the blockers #20 and #21. */
const BOARD: readonly BoardIssue[] = [
  issue(ROADMAP, { title: 'Roadmap', body: ROADMAP_BODY, labels: [] }),
  issue(10, { state: 'CLOSED' }),
  issue(11),
  issue(12, { body: bodyWith(TEMPLATE_HEADINGS.slice(0, OUTLINE_HEADINGS)), labels: [] }),
  issue(13, { body: bodyWith(TEMPLATE_HEADINGS.slice(0, OUTLINE_HEADINGS - 1)), labels: [] }),
  issue(14, { body: bodyWithout('Design') }),
  issue(15, { labels: [] }),
  issue(16, {
    body: `${completeSpecBody('Issue 16')}\nBlocked by: #20, #21 open-tomato/agentic-research#3 #99\n`,
    type: 'bug',
  }),
  issue(17),
  issue(20),
  issue(21, { state: 'CLOSED' }),
];

/** The one open pull request: it closes #17. */
const PULLS: readonly RoadmapPullRequest[] = [
  { number: 40, headRefName: 'feat/rafa-17-with-pr', body: 'Closes #17' },
];

/** The plan dir: #11's plan, a tracker alone for #17, and #110's plan, which is not #11's. */
const PLAN_NAMES = ['PLAN-rafa-11-ready-plan.md', 'PLAN_TRACKER-rafa-17-with-pr.md', 'PLAN-rafa-110-other.md'];

/** A git answering `for-each-ref` with `refs` and `ls-remote` with `remote`. */
function plantedGit(refs: readonly string[], remote: GitResult = { ok: true, stdout: '', stderr: '' }): GitRunner {
  return (args) => args[0] === 'ls-remote'
    ? remote
    : { ok: true, stdout: refs.join('\n'), stderr: '' };
}

/** Everything a case counts: how often each seam was asked. */
interface Counts {
  board: number;
  roadmap: readonly number[];
  pulls: number;
  search: number;
}

/** The options over the planted board, with `overrides` laid over them, and the counts. */
function planted(overrides: Partial<RoadmapRowsOptions> = {}): { options: RoadmapRowsOptions; counts: Counts } {
  const counts: Counts = { board: 0, roadmap: [], pulls: 0, search: 0 };
  const board: BoardListing = () => {
    counts.board += 1;
    return Promise.resolve(BOARD);
  };
  const issues: SpecIssueReader = (number) => {
    counts.roadmap = [...counts.roadmap, number];
    const read: SpecIssue = { number, title: 'Roadmap', body: ROADMAP_BODY, state: 'OPEN', labels: [], author: 'owner' };
    return Promise.resolve(read);
  };
  const search: RoadmapSearch = () => {
    counts.search += 1;
    return Promise.resolve([{ number: ROADMAP, title: 'Roadmap' }]);
  };
  const pullRequests = (): Promise<readonly RoadmapPullRequest[]> => {
    counts.pulls += 1;
    return Promise.resolve(PULLS);
  };
  const options: RoadmapRowsOptions = {
    configured: ROADMAP,
    search,
    issues,
    board,
    git: plantedGit(['refs/heads/main', 'refs/heads/feat/rafa-16-blocked-branch']),
    pullRequests,
    planNames: () => PLAN_NAMES,
    ...overrides,
  };
  return { options, counts };
}

/** The row for `number`, which the case expects to be there. */
function rowFor(rows: readonly RoadmapRow[], number: number): RoadmapRow {
  const found = rows.find((row) => row.line.issue === number);
  if (found === undefined) throw new Error(`no row for #${String(number)}`);
  return found;
}

/** Each row as the three printed cells. */
function cells(rows: readonly RoadmapRow[]): readonly (readonly [number, string, string, string])[] {
  return rows.map((row) => [row.line.issue, specText(row.spec), blockersText(row.blockers), hasText(row.has)]);
}

describe('the rows over a planted board', () => {
  it('prints the unticked lines in the Roadmap\'s order with every column as planted', async () => {
    const { options } = planted();
    const read = await readRoadmapRows(options);

    expect(read.roadmap).toBe(ROADMAP);
    expect(read.warnings).toEqual([]);
    expect(cells(read.rows)).toEqual([
      [11, 'ready', '', 'plan'],
      [12, 'gaps: What can go wrong, Tasks the plan must carry, Definition of done', '', ''],
      [13, 'outline', '', ''],
      [14, 'label: ready, gate: gaps', '', ''],
      [15, 'label: none, gate: ready', '', ''],
      [16, 'ready', '#20 open, #21 closed, #99 unknown, open-tomato/agentic-research#3 unknown', 'branch'],
      [17, 'ready', '', 'pr #40'],
      [18, '', '', ''],
    ]);
  });

  it('reads the board once, the Roadmap once and the pull requests once, and searches nothing when configured', async () => {
    const { options, counts } = planted();
    await readRoadmapRows(options);
    expect(counts).toEqual({ board: 1, roadmap: [ROADMAP], pulls: 1, search: 0 });
  });

  it('finds the Roadmap by its title when nothing is configured', async () => {
    const { options, counts } = planted({ configured: null });
    const read = await readRoadmapRows(options);
    expect(read.roadmap).toBe(ROADMAP);
    expect(counts).toMatchObject({ search: 1, roadmap: [ROADMAP] });
  });

  it('keeps the ticked lines in their places with all', async () => {
    const { options } = planted({ all: true });
    const read = await readRoadmapRows(options);
    expect(read.rows.map((row) => row.line.issue)).toEqual([10, 11, 12, 13, 14, 15, 16, 17, 18]);
    expect(rowFor(read.rows, 10).line.ticked).toBe(true);
  });

  it('carries the board issue on each row, so a type filter has the type', async () => {
    const { options } = planted();
    const read = await readRoadmapRows(options);
    expect(rowFor(read.rows, 16).issue?.type).toBe('bug');
    expect(rowFor(read.rows, 11).issue?.type).toBe('code');
  });

  it('leaves a line the listing lacks with no issue, spec or reading, and warns nothing', async () => {
    const { options } = planted();
    const read = await readRoadmapRows(options);
    const row = rowFor(read.rows, 18);
    expect(row).toMatchObject({ issue: null, spec: null, blocked: null, blockers: [] });
    expect(read.warnings).toEqual([]);
  });

  it('carries the blocked reading itself, with the board as known', async () => {
    const { options } = planted();
    const read = await readRoadmapRows(options);
    expect(rowFor(read.rows, 16).blocked).toMatchObject({
      kind: 'unknown-issue',
      blockers: [20, 21, 99],
      foreign: ['open-tomato/agentic-research#3'],
      unknown: [99],
    });
    expect(rowFor(read.rows, 11).blocked?.kind).toBe('no-line');
  });
});

describe('the board unreachable', () => {
  it('warns once, keeps the order, empties spec and blocked by, and asks no pull request', async () => {
    const { options, counts } = planted({ board: () => Promise.reject(new Error('gh: could not connect')) });
    const read = await readRoadmapRows(options);

    expect(read.warnings).toHaveLength(1);
    expect(read.warnings[0]).toContain('the board could not be listed');
    expect(read.warnings[0]).toContain('gh: could not connect');
    expect(read.rows.map((row) => row.line.issue)).toEqual([11, 12, 13, 14, 15, 16, 17, 18]);
    for (const row of read.rows) {
      expect(row).toMatchObject({ issue: null, spec: null, blocked: null, blockers: [] });
    }
    expect(counts.pulls).toBe(0);
  });

  it('still reads has from the plan dir and the branch scan', async () => {
    const { options } = planted({ board: () => Promise.reject(new Error('offline')) });
    const read = await readRoadmapRows(options);
    expect(hasText(rowFor(read.rows, 11).has)).toBe('plan');
    expect(hasText(rowFor(read.rows, 16).has)).toBe('branch');
    expect(hasText(rowFor(read.rows, 17).has)).toBe('');
  });
});

describe('the other readings failing', () => {
  it('warns about a pull request list that failed and shows no pr, the rest intact', async () => {
    const { options } = planted({ pullRequests: () => Promise.reject(new Error('rate limited')) });
    const read = await readRoadmapRows(options);
    expect(read.warnings).toEqual(['the open pull requests could not be listed, so no pr is shown: rate limited']);
    expect(hasText(rowFor(read.rows, 17).has)).toBe('');
    expect(specText(rowFor(read.rows, 17).spec)).toBe('ready');
  });

  it('warns about a plan dir that could not be read and shows no plan', async () => {
    const planNames = (): readonly string[] => {
      throw new Error('EACCES: permission denied');
    };
    const { options } = planted({ planNames });
    const read = await readRoadmapRows(options);
    expect(read.warnings).toEqual(['the plan dir could not be read, so no plan is shown: EACCES: permission denied']);
    expect(hasText(rowFor(read.rows, 11).has)).toBe('');
  });

  it('carries the branch scan\'s problems as warnings and keeps the local refs', async () => {
    const remote: GitResult = { ok: false, stdout: '', stderr: 'fatal: no remote' };
    const { options } = planted({ git: plantedGit(['refs/heads/feat/rafa-16-blocked-branch'], remote) });
    const read = await readRoadmapRows(options);
    expect(read.warnings).toHaveLength(1);
    expect(read.warnings[0]).toContain('fatal: no remote');
    expect(hasText(rowFor(read.rows, 16).has)).toBe('branch');
  });

  it('rejects when the Roadmap cannot be read, having listed nothing', async () => {
    const { options, counts } = planted({ issues: () => Promise.reject(new Error('gh issue view failed')) });
    await expect(readRoadmapRows(options)).rejects.toThrow('gh issue view failed');
    expect(counts.board).toBe(0);
  });

  it('rejects with the roadmap refusal when no issue is titled Roadmap', async () => {
    const { options } = planted({ configured: null, search: () => Promise.resolve([]) });
    await expect(readRoadmapRows(options)).rejects.toBeInstanceOf(CommandExit);
  });
});

describe('the spec column', () => {
  it('reads ready only with the label and no gap', () => {
    const body = completeSpecBody('x');
    expect(readSpecColumn([SPEC_READY_LABEL], body).kind).toBe('ready');
    expect(readSpecColumn([], body).kind).toBe('unlabelled');
  });

  it('reads outline below the heading threshold and gaps at it', () => {
    const below = bodyWith(TEMPLATE_HEADINGS.slice(0, OUTLINE_HEADINGS - 1));
    const at = bodyWith(TEMPLATE_HEADINGS.slice(0, OUTLINE_HEADINGS));
    expect(readSpecColumn([], below)).toMatchObject({ kind: 'outline', headings: OUTLINE_HEADINGS - 1 });
    expect(readSpecColumn([], at)).toMatchObject({ kind: 'gaps', headings: OUTLINE_HEADINGS });
  });

  it('reads a stale label over an outline, so the label that outlived its body shows', () => {
    const reading = readSpecColumn([SPEC_READY_LABEL], bodyWith([]));
    expect(reading.kind).toBe('stale-label');
    expect(specText(reading)).toBe('label: ready, gate: gaps');
  });

  it('names each gap heading once, in the gap list\'s order', () => {
    const body = `${bodyWithout('Design')}\nTODO and TBD on one line\n`;
    const reading = readSpecColumn([], body);
    expect(reading.gaps.filter((gap) => gap.heading === 'Definition of done')).toHaveLength(2);
    expect(specText(reading)).toBe('gaps: Design, Definition of done');
  });

  it('prints nothing with no reading', () => {
    expect(specText(null)).toBe('');
  });
});

describe('the has column', () => {
  it('reads a plan named rafa-<n> alone or under a slug, and not a longer number\'s', () => {
    expect(hasPlanFor(['PLAN-rafa-11.md'], 11)).toBe(true);
    expect(hasPlanFor(['PLAN-rafa-11-slug.md'], 11)).toBe(true);
    expect(hasPlanFor(['PLAN-rafa-110-slug.md'], 11)).toBe(false);
    expect(hasPlanFor(['PLAN_TRACKER-rafa-11-slug.md'], 11)).toBe(false);
  });

  it('prints plan, branch and every closing pull request in that order', () => {
    expect(hasText([{ kind: 'plan' }, { kind: 'branch', ref: 'feat/rafa-1-x' }, { kind: 'pr', number: 4 }, { kind: 'pr', number: 5 }]))
      .toBe('plan, branch, pr #4, pr #5');
  });
});

describe('the plan dir names', () => {
  const roots: string[] = [];
  afterAll(() => {
    for (const made of roots) rmSync(made, { recursive: true, force: true });
  });

  it('lists the names in the dir, read on each call', () => {
    const root = mkdtempSync(join(tmpdir(), 'rafa-roadmap-rows-'));
    roots.push(root);
    const dir = join(root, 'plans');
    mkdirSync(dir);
    const names = createPlanDirNames(dir);
    expect(names()).toEqual([]);

    writeFileSync(join(dir, 'PLAN-rafa-11-slug.md'), '# plan\n');
    expect(names()).toEqual(['PLAN-rafa-11-slug.md']);
  });

  it('answers no names for a dir that does not exist', () => {
    const root = mkdtempSync(join(tmpdir(), 'rafa-roadmap-rows-'));
    roots.push(root);
    expect(createPlanDirNames(join(root, 'absent'))()).toEqual([]);
  });

  it('throws for a path that is a file, which the rows then warn about', () => {
    const root = mkdtempSync(join(tmpdir(), 'rafa-roadmap-rows-'));
    roots.push(root);
    const file = join(root, 'plans');
    writeFileSync(file, 'not a dir\n');
    expect(() => createPlanDirNames(file)()).toThrow();
  });
});
