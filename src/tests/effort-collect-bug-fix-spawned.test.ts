/**
 * `rafa effort collect --no-git --no-sessions --skills`, spawned twice as
 * the real `rafa` binary in a scratch project holding a fixture store, a
 * fixture plan directory and an empty library: the proof that the bug-fix
 * pass `collect` runs after it answers pushes one lesson with two sources
 * and then, on the second run, changes nothing under `.rafa/instincts/`.
 *
 * Bug #12 is filed by one session and fixed by the one task of a stage
 * whose context names it, with a `done` report recorded after the filing.
 * The store is written through the store writers under the scratch
 * repository, never the repository's own store.
 */
import type { ReportBug } from '@open-tomato/rafa/report/parse';
import type { FindingsDispatch } from '@open-tomato/rafa/store/findings';

import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { writeTaskReport } from '@open-tomato/rafa/store/reports';
import { writeTrackerRef } from '@open-tomato/rafa/store/tracker-refs';
import { writeTriage } from '@open-tomato/rafa/store/triage';
import { sessionLogDir } from '@open-tomato/rafa-effort/effort/collect';
import { parseInstinct } from '@open-tomato/rafa-inventory/schema/instinct';

import { expectExit, plantScratchRepo, runRafa } from './cli-capture.js';

const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-collect-bug-fix-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

const COLLECT_WORDS = ['effort', 'collect', '--no-git', '--no-sessions', '--skills'];
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

/** Every file of the library with its bytes, for a before and after. */
function snapshot(dir: string): Record<string, string> {
  if (!existsSync(dir)) return {};
  return Object.fromEntries(readdirSync(dir).sort()
    .map((name) => [name, readFileSync(join(dir, name), 'utf8')]));
}

describe('rafa effort collect, spawned, over a fixture store with one bug-fix pair', () => {
  it('pushes one lesson with two sources, then leaves .rafa/instincts/ unchanged', () => {
    const scratch = plantScratchRepo(tempBase);
    const root = scratch.repo;
    const library = join(root, '.rafa', 'instincts');
    mkdirSync(library, { recursive: true });
    mkdirSync(sessionLogDir(root, scratch.home), { recursive: true });
    mkdirSync(join(root, '.rafa', 'plans'), { recursive: true });
    writeFileSync(join(root, '.rafa', 'plans', 'PLAN-rafa-900-fixes.md'), FIX_PLAN);

    writeTriage(root, { dispatch: FILING, outcome: 'done', blockers: [], outOfScopeBugs: [reportBug(BUG_WORDS, BUG_ARTIFACT)] }, at('2026-11-01T10:00:00.000Z'));
    writeTrackerRef(root, {
      dispatch: FILING,
      outcome: 'done',
      artifact: `PLAN_TRACKER-${FILING.planStub}.md: ${BUG_ARTIFACT}`,
      ref: { opt: 12, kind: 'github', externalId: '12', url: 'https://github.com/o/r/issues/12' },
    }, at('2026-11-01T10:00:00.000Z'));
    writeTaskReport(root, { dispatch: FIXING, outcome: 'done', report: { status: 'done' } }, at('2026-11-02T10:00:00.000Z'));

    const first = runRafa(scratch, root, COLLECT_WORDS);
    expectExit(first, 0, scratch);
    const lessons = readdirSync(library).filter((name) => name.endsWith('.md'));
    expect(lessons).toHaveLength(1);
    const { instinct, issues } = parseInstinct(readFileSync(join(library, lessons[0]!), 'utf8'));
    expect(issues).toEqual([]);
    expect(instinct?.sources).toEqual([FILING.sessionId, FIXING.sessionId]);
    expect(first.stdout).toContain('1 pair pushed');
    const before = snapshot(library);

    const second = runRafa(scratch, root, COLLECT_WORDS);
    expectExit(second, 0, scratch);
    expect(snapshot(library)).toEqual(before);
    expect(second.stdout).toContain('0 pairs pushed');
  }, 60_000);
});
