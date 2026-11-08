/**
 * `rafa instinct pairs --unpaired --output=json`, spawned as the real
 * `rafa` binary in a scratch project holding a fixture store and fixture
 * plans: the proof that the command answers one pair and lists one bug
 * filed by a sweep as `no-link`, with exit code 0, and writes no file
 * under the fixture.
 *
 * Bug #12 is filed by one session and fixed by the one task of a stage
 * whose context names it; bug #13 is filed by a sweep no plan names. The
 * store is written through the store writers under the scratch
 * repository, never the repository's own store.
 */
import type { ReportBug } from '@open-tomato/rafa/report/parse';
import type { FindingsDispatch } from '@open-tomato/rafa/store/findings';

import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { writeTaskReport } from '@open-tomato/rafa/store/reports';
import { writeTrackerRef } from '@open-tomato/rafa/store/tracker-refs';
import { writeTriage } from '@open-tomato/rafa/store/triage';

import { eventsOf, expectExit, plantScratchRepo, runRafa } from './cli-capture.js';

const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-instinct-pairs-spawned-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

const PAIRS_WORDS = ['instinct', 'pairs', '--unpaired', '--output=json'];
const FIX_TASK = 'Guard the reader';
const BUG_WORDS = 'the reader drops the last entry';
const BUG_ARTIFACT = 'reader drops the last entry';

const FIX_PLAN = [
  '# Plan: Fixes',
  '',
  '```rafa:plan',
  'stub: rafa-900-fixes',
  '```',
  '',
  '# Stage: Fix',
  '',
  '```rafa:stage-context',
  'This stage fixes #12, filed by a sweep.',
  '```',
  '',
  `- [x] ${FIX_TASK}  {agent=loop-implementer}`,
  '',
].join('\n');

const FILING: FindingsDispatch = { sessionId: 'session-file-12', planStub: 'rafa-899-sweep', taskLine: 'Sweep the readers' };
const SWEEP: FindingsDispatch = { sessionId: 'session-file-13', planStub: 'rafa-898-sweep', taskLine: 'Sweep the writers' };
const FIXING: FindingsDispatch = {
  sessionId: 'session-fix-12',
  planStub: 'rafa-900-fixes',
  taskLine: `${FIX_TASK}  {agent=loop-implementer}`,
};

function at(iso: string): { now: () => Date } {
  return { now: () => new Date(iso) };
}

function reportBug(what: string, artifact: string): ReportBug {
  return { what, artifact, security: false, kind: 'bug', module: null, action: null, reproduce: null, cause: null, extras: [] };
}

/** Files one bug from `from` as GitHub issue `issue`. */
function fileBug(root: string, from: FindingsDispatch, issue: number, words: string, artifact: string, iso: string): void {
  writeTriage(root, { dispatch: from, outcome: 'done', blockers: [], outOfScopeBugs: [reportBug(words, artifact)] }, at(iso));
  writeTrackerRef(root, {
    dispatch: from,
    outcome: 'done',
    artifact: `PLAN_TRACKER-${from.planStub ?? ''}.md: ${artifact}`,
    ref: { opt: issue, kind: 'github', externalId: String(issue), url: `https://github.com/o/r/issues/${String(issue)}` },
  }, at(iso));
}

/** Every file under `dir` with its bytes, by path, for a before and after. */
function snapshot(dir: string): Record<string, string> {
  const files: Record<string, string> = {};
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) Object.assign(files, snapshot(path));
    else files[path] = readFileSync(path).toString('base64');
  }
  return files;
}

describe('rafa instinct pairs, spawned, over a fixture store', () => {
  it('answers one pair and one no-link sweep bug with exit code 0, changing no file', () => {
    const scratch = plantScratchRepo(tempBase);
    const root = scratch.repo;
    mkdirSync(join(root, '.rafa', 'plans'), { recursive: true });
    writeFileSync(join(root, '.rafa', 'plans', 'PLAN-rafa-900-fixes.md'), FIX_PLAN);
    fileBug(root, FILING, 12, BUG_WORDS, BUG_ARTIFACT, '2026-11-01T10:00:00.000Z');
    fileBug(root, SWEEP, 13, 'the writer truncates the tail', 'writer truncates the tail', '2026-11-01T11:00:00.000Z');
    writeTaskReport(root, { dispatch: FIXING, outcome: 'done', report: { status: 'done' } }, at('2026-11-02T10:00:00.000Z'));
    const before = snapshot(root);

    const answered = runRafa(scratch, root, PAIRS_WORDS);

    expectExit(answered, 0, scratch);
    const data = eventsOf(answered.stdout).find((event) => event.type === 'result')?.data as {
      total: number;
      paired: number;
      pairs: { issue: string; fixing_plan: string }[];
      unpaired: { issue: string; plan: string | null; reason: string }[];
    };
    expect(data.total).toBe(2);
    expect(data.paired).toBe(1);
    expect(data.pairs).toHaveLength(1);
    expect(data.pairs[0]).toMatchObject({ issue: '12', fixing_plan: 'rafa-900-fixes' });
    expect(data.unpaired).toEqual([{ issue: '13', plan: 'rafa-898-sweep', reason: 'no-link' }]);
    expect(snapshot(root)).toEqual(before);
  }, 60_000);
});
