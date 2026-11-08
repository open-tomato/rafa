/**
 * Tests for row 9 of the state table (`./state.ts`) against the merged
 * pull requests the provider answers (#1506): a plan whose branch has a
 * merged pull request is done, wherever it ran, and the row passes it
 * over for the next unstarted plan.
 *
 * Each case plants plans on the base with no run and no branch, a git
 * that answers by argv and a pull request double
 * (`packages/rafa/src/pr/pull-requests-double.ts`) whose call log says
 * whether `listMerged` was asked at all. Nothing spawns `git` or `gh`.
 *
 * Negative first: a `listMerged` that throws keeps the answer the local
 * readings give, the first plan, with one problem naming what the
 * provider said; then a merged head naming the first plan's branch,
 * which answers the second, beside a merged head naming another branch,
 * which answers the first; then the provider left unasked where row 9
 * has no candidate, a plan with a run, and asked once where it has one.
 * The template cases hand `naming.branch` as `work/{stub}` and read a
 * head under `feat/` as naming no plan.
 */
import type { NextBoard, NextSources } from './readings.js';
import type { SessionRecord } from '@open-tomato/rafa/core/loop';
import type { MergedPullRequest } from '@open-tomato/rafa/pr/types';
import type { GitResult, PullRequests } from '@open-tomato/rafa-pr/pr/index';

import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { plansDirAt } from '@open-tomato/rafa/core/plan';
import { createPullRequestsDouble } from '@open-tomato/rafa/pr/pull-requests-double';
import { afterAll, describe, expect, it } from 'bun:test';

import { openWorld } from './readings.js';
import { readNextState } from './state.js';

/** A temporary directory of this file's own. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-next-merged-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** The base branch, which every case stands on. */
const BASE = 'main';

/** The first plan in the listing's order. */
const FIRST = 'rafa-10-first';

/** The plan after it. */
const SECOND = 'rafa-20-second';

/** A checklist with its tasks open. */
const OPEN_PLAN = ['# Plan: one', '', '# Stage: one', '', '- [ ] first', ''].join('\n');

/** What a provider that could not be reached says, over two lines. */
const UNREACHABLE = 'gh: could not connect to api.github.com\n  check your network';

/** What git answered when it worked. */
function said(stdout: string): GitResult {
  return { ok: true, stdout, stderr: '' };
}

/** One merged pull request from `head`. */
function merged(head: string, number = 55): MergedPullRequest {
  return { number, headRefName: head, headRefOid: 'abc1234', mergedAt: '2026-11-01T10:00:00Z' };
}

/**
 * A pull request double answering `listMerged` with `listMerged`, or
 * naming no such member when it is left out, which rejects it. `findOpen`
 * answers no open pull request, which the provider pre-condition asks on
 * the base.
 */
function provider(listMerged?: () => Promise<readonly MergedPullRequest[]>): ReturnType<typeof createPullRequestsDouble> {
  return createPullRequestsDouble({
    findOpen: () => Promise.resolve(null),
    ...listMerged === undefined
      ? {}
      : { listMerged },
  });
}

/** A board whose roadmap has no line left, so row 13 is the last answer. */
const EXHAUSTED: NextBoard = {
  next: () => Promise.resolve({ roadmap: 31, line: null, passed: 4, problems: [] }),
  blocking: () => Promise.resolve(null),
  isReady: () => Promise.resolve(false),
};

/** How many scratch roots a case has been handed. */
let scratches = 0;

/** A plans directory holding a plan for each of `stubs`, under a root no other case shares. */
function plantPlans(stubs: readonly string[]): string {
  scratches += 1;
  const root = join(tempBase, `case-${scratches}`);
  const dir = join(root, '.rafa', 'plans');
  mkdirSync(dir, { recursive: true });
  stubs.forEach((stub) => writeFileSync(join(dir, `PLAN-${stub}.md`), OPEN_PLAN, 'utf8'));
  return root;
}

/** A finished run of `stub`. */
function ranOn(stub: string): SessionRecord {
  return {
    sessionId: '20261101-100000-abcd',
    planStub: stub,
    plan: `.rafa/plans/PLAN-${stub}.md`,
    branch: `feat/${stub}`,
    pid: 4242,
    startedAt: '2026-11-01T10:00:00Z',
    state: 'stopped',
    task: null,
  };
}

/** What a case varies. */
interface Planted {
  readonly stubs?: readonly string[];
  readonly runs?: readonly SessionRecord[];
  readonly branchTemplate?: string;
}

/** The sources a case is read over: the base, clean and level, no branch on either side. */
function sourcesFor(pulls: PullRequests, planted: Planted = {}): NextSources {
  const answers: Readonly<Record<string, GitResult>> = {
    'rev-parse --abbrev-ref HEAD': said(`${BASE}\n`),
    'status --porcelain': said(''),
    [`rev-list --left-right --count ${BASE}...origin/${BASE}`]: said('0\t0\n'),
  };
  return {
    base: BASE,
    plans: plansDirAt(plantPlans(planted.stubs ?? [FIRST, SECOND]), '.rafa/plans'),
    runs: () => planted.runs ?? [],
    git: (args) => answers[args.join(' ')] ?? said(''),
    pulls,
    board: EXHAUSTED,
    ...planted.branchTemplate === undefined
      ? {}
      : { branchTemplate: planted.branchTemplate },
  };
}

describe('row 9 over the merged pull requests', () => {
  it('keeps the first unstarted plan when listMerged throws, with one problem naming the provider failure', async () => {
    const double = provider(() => Promise.reject(new Error(UNREACHABLE)));
    const state = await readNextState(sourcesFor(double.pulls));

    expect(state.id).toBe('plan-unstarted');
    expect(state.planStub).toBe(FIRST);
    expect(state.problems).toEqual([
      'the merged pull requests could not be read from the provider, so a plan whose branch merged from another clone '
      + 'may be offered again: gh: could not connect to api.github.com check your network',
    ]);
    expect(double.sent().filter((call) => call === 'listMerged')).toEqual(['listMerged']);
  });

  it('answers the first plan when the merged heads name another branch, the control for the case after', async () => {
    const double = provider(() => Promise.resolve([merged('feat/rafa-99-elsewhere')]));
    const state = await readNextState(sourcesFor(double.pulls));

    expect([state.id, state.planStub, state.problems]).toEqual(['plan-unstarted', FIRST, []]);
  });

  it('passes over a plan whose branch has a merged pull request for the following unstarted plan', async () => {
    const double = provider(() => Promise.resolve([merged(`feat/${FIRST}`)]));
    const state = await readNextState(sourcesFor(double.pulls));

    expect([state.id, state.planStub, state.problems]).toEqual(['plan-unstarted', SECOND, []]);
    expect(state.reading).toBe(`\`${SECOND}\` is planned, with no run and no branch`);
    expect(double.sent().filter((call) => call === 'listMerged')).toEqual(['listMerged']);
  });

  it('answers no plan at all when every unstarted plan has merged', async () => {
    const double = provider(() => Promise.resolve([merged(`feat/${FIRST}`, 55), merged(`feat/${SECOND}`, 56)]));
    const state = await readNextState(sourcesFor(double.pulls));

    expect(state.id).toBe('nothing-left');
  });

  it('reads the plan branch under naming.branch, so a feat/ head names no work/ plan', async () => {
    const elsewhere = provider(() => Promise.resolve([merged(`feat/${FIRST}`)]));
    const templated = provider(() => Promise.resolve([merged(`work/${FIRST}`)]));
    const kept = await readNextState(sourcesFor(elsewhere.pulls, { branchTemplate: 'work/{stub}' }));
    const passed = await readNextState(sourcesFor(templated.pulls, { branchTemplate: 'work/{stub}' }));

    expect([kept.planStub, passed.planStub]).toEqual([FIRST, SECOND]);
  });

  it('asks no listMerged when row 9 has no candidate', async () => {
    // A double naming no listMerged rejects it, so an asked one would
    // show in the log and add a problem.
    const none = provider();
    const ran = provider();
    const noPlans = await readNextState(sourcesFor(none.pulls, { stubs: [] }));
    const allRan = await readNextState(sourcesFor(ran.pulls, { stubs: [FIRST], runs: [ranOn(FIRST)] }));

    expect([noPlans.id, allRan.id]).toEqual(['nothing-left', 'nothing-left']);
    expect([none.sent(), ran.sent()].map((sent) => sent.filter((call) => call === 'listMerged'))).toEqual([[], []]);
    expect([noPlans.problems, allRan.problems]).toEqual([[], []]);
  });

  it('asks listMerged once per world, however often the reading is asked', async () => {
    const double = provider(() => Promise.resolve([merged(`feat/${FIRST}`)]));
    const world = openWorld(sourcesFor(double.pulls));
    const answers = [await world.unmergedPlan(), await world.unmergedPlan()];

    expect(answers.map((plan) => plan?.stub)).toEqual([SECOND, SECOND]);
    expect(world.unstartedPlan()?.stub).toBe(FIRST);
    expect(double.sent().filter((call) => call === 'listMerged')).toEqual(['listMerged']);
  });
});
