/**
 * The bug-fix join end to end over fixtures: a fixture store written
 * through the store writers, a fixture plan directory, both read by
 * their readers (`readBugFixRows`, `readPlanStageLinks`), and
 * `pairBugFixes` answering over what they read.
 *
 * Three bugs are filed, each by a session of its own: one whose fixing
 * stage names its issue in its stage context, one filed by a sweep whose
 * plan names no issue, and one whose fixing plan has no file here.
 */
import type { FindingsDispatch } from '@open-tomato/rafa/store/findings';

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { readBugFixRows } from '@open-tomato/rafa-effort';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { writeTaskReport } from '@open-tomato/rafa/store/reports';
import { writeTrackerRef } from '@open-tomato/rafa/store/tracker-refs';
import { pairBugFixes } from '@open-tomato/rafa-inventory/report/bug-fix-pairs';

import { readPlanStageLinks } from './plan-stage-links.js';

const NOW = new Date('2026-11-10T00:00:00.000Z');

const FIX_TASK = 'Guard the reader';

const STAGE_FIX_PLAN = [
  '# Plan: Fixes',
  '',
  '```rafa:plan',
  'stub: rafa-900-fixes',
  '```',
  '',
  '# Stage: Sweep',
  '',
  '```rafa:stage-context',
  'A sweep of the lint warnings; it names no issue.',
  '```',
  '',
  '- [x] Sweep the warnings',
  '- [x] Sweep the imports',
  '',
  '# Stage: Fix',
  '',
  '```rafa:stage-context',
  'This stage fixes #12, filed by a sweep.',
  '```',
  '',
  `- [x] ${FIX_TASK}`,
  '',
].join('\n');

/** A dispatch of its own for a session. */
function dispatch(sessionId: string, planStub: string, taskLine: string): FindingsDispatch {
  return { sessionId, planStub, taskLine };
}

const FILE_BUG = dispatch('session-file-12', 'rafa-899-sweep', 'Sweep the readers');
const SWEEP_BUG = dispatch('session-file-13', 'rafa-898-sweep', 'Sweep the writers');
const NO_FILE_BUG = dispatch('session-file-14', 'rafa-897-sweep', 'Sweep the parsers');
const FIXING = dispatch('session-fix-12', 'rafa-900-fixes', FIX_TASK);
const FIXING_NO_FILE = dispatch('session-fix-14', 'rafa-14-lost-plan', 'Repair the parser');

/** The clock the writers record with, fixed at `iso`. */
function at(iso: string): { now: () => Date } {
  return { now: () => new Date(iso) };
}

/** Files one bug against `from` as GitHub issue `issue`. */
function fileBug(root: string, from: FindingsDispatch, issue: number, artifact: string, iso: string): void {
  writeTrackerRef(root, {
    dispatch: from,
    outcome: 'done',
    artifact: `PLAN_TRACKER-${from.planStub}.md: ${artifact}`,
    ref: { opt: issue, kind: 'github', externalId: String(issue), url: `https://github.com/o/r/issues/${issue}` },
  }, at(iso));
}

/** Records a `done` report for `from`. */
function reportDone(root: string, from: FindingsDispatch, iso: string): void {
  writeTaskReport(root, { dispatch: from, outcome: 'done', report: { status: 'done' } }, at(iso));
}

let root = '';
let plansDir = '';

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'bug-fix-join-'));
  plansDir = join(root, 'plans');
  await mkdir(plansDir, { recursive: true });
  await writeFile(join(plansDir, 'PLAN-rafa-900-fixes.md'), STAGE_FIX_PLAN);

  fileBug(root, FILE_BUG, 12, 'reader drops the last entry', '2026-11-01T10:00:00.000Z');
  fileBug(root, SWEEP_BUG, 13, 'writer truncates the tail', '2026-11-01T11:00:00.000Z');
  fileBug(root, NO_FILE_BUG, 14, 'parser rejects a tab', '2026-11-01T12:00:00.000Z');
  reportDone(root, FIXING, '2026-11-02T10:00:00.000Z');
  reportDone(root, FIXING_NO_FILE, '2026-11-02T11:00:00.000Z');
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('the bug-fix join over a fixture store and plan directory', () => {
  test('answers one pair for a bug linked by stage context, with its fixing loop', async () => {
    const { rows } = readBugFixRows(root);
    const links = await readPlanStageLinks(plansDir);

    const { pairs } = pairBugFixes(rows, links, NOW);

    expect(pairs).toHaveLength(1);
    expect(pairs[0]).toMatchObject({
      issue: '12',
      link: 'stage-context',
      plan: 'rafa-900-fixes',
      stage: 'Fix',
    });
    expect(pairs[0]?.fix.sessionId).toBe(FIXING.sessionId);
    expect(pairs[0]?.lesson.action).toBe(FIX_TASK);
  });

  test('answers no-link for a sweep that names no issue', async () => {
    const { rows } = readBugFixRows(root);
    const links = await readPlanStageLinks(plansDir);

    const { unpaired } = pairBugFixes(rows, links, NOW);

    const sweep = unpaired.find((entry) => entry.issue === '13');
    expect(sweep?.reason).toBe('no-link');
    expect(sweep?.bug.sessionId).toBe(SWEEP_BUG.sessionId);
  });

  test('answers no-plan-file for a bug whose fixing plan has no file', async () => {
    const { rows } = readBugFixRows(root);
    const links = await readPlanStageLinks(plansDir);

    const { unpaired } = pairBugFixes(rows, links, NOW);

    const lost = unpaired.find((entry) => entry.issue === '14');
    expect(lost?.reason).toBe('no-plan-file');
    expect(lost?.bug.sessionId).toBe(NO_FILE_BUG.sessionId);
    expect(unpaired).toHaveLength(2);
  });
});
