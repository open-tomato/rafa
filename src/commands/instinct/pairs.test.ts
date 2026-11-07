/**
 * Tests for `rafa instinct pairs [--unpaired]`
 * (`src/commands/instinct/pairs.ts`): the counts, pairs and unpaired
 * bugs the join gives, their lines and json data, the push log read as
 * `logged`, and the refusals.
 *
 * Every dispatched case plants a project and a home of its own under a
 * temporary directory of this file's own: a store written through the
 * store writers, a plan file in the `plan.dir` its config names, and,
 * where a case says so, a library the bug-fix pass pushed into. The
 * command is dispatched in-process with streams and a working directory
 * of its own (`src/tests/cli-capture.ts`), so nothing reads the
 * repository's store, plans or library.
 *
 * Two bugs are filed: #12, fixed by the one task of a stage whose
 * context names it, and #13, filed by a sweep no plan names (`no-link`).
 *
 * ## The controls
 *
 * `logged` is 1 after the pass pushed the pair, held BESIDE the same
 * project before the pass, where it is 0: so the count is read off the
 * push log the pass wrote, not assumed. A planted key whose filing
 * session is another's leaves it 0, so the key is matched whole. That
 * nothing is written is read as the planted tree's every path and
 * content before and after, over a run that did list a pair.
 */
import type { InstinctPairsResult } from './pairs.js';
import type { ReportBug } from '@open-tomato/rafa/report/parse';
import type { FindingsDispatch } from '@open-tomato/rafa/store/findings';

import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { writeTaskReport } from '@open-tomato/rafa/store/reports';
import { writeTrackerRef } from '@open-tomato/rafa/store/tracker-refs';
import { writeTriage } from '@open-tomato/rafa/store/triage';

import { runBugFixPass } from '../../learning/bug-fix-pass.js';
import { dispatchInProject, eventsOf, plantProjectConfig } from '../../tests/cli-capture.js';

import { createInstinctPairsCommand, readUnpairedFlag, renderPairs } from './pairs.js';

/** The subject the dispatched cases route through. */
const SUBJECTS = [{ name: 'instinct', summary: 'list the records the instinct scopes hold' }];

/** A temporary directory of this file's own, its path resolved through every link. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-instinct-pairs-')));
let planted = 0;

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** The plan directory the fixture's config names, not the default one. */
const PLAN_DIR = 'docs/plans';

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

/** The issue URL a bug filed as `issue` is referenced by. */
function issueUrl(issue: number): string {
  return `https://github.com/o/r/issues/${String(issue)}`;
}

/** What one case plants: a project and a home. */
interface Planted {
  /** The project root, holding `.rafa/config.yaml`. */
  readonly root: string;
  /** The home the user scope resolves under. */
  readonly home: string;
  /** The directory both are planted under. */
  readonly scope: string;
}

/** The clock the writers record with, fixed at `iso`. */
function at(iso: string): { now: () => Date } {
  return { now: () => new Date(iso) };
}

/** An out-of-scope bug as `parseReport` answers one. */
function reportBug(what: string, artifact: string): ReportBug {
  return { what, artifact, security: false, kind: 'bug', module: null, action: null, reproduce: null, cause: null, extras: [] };
}

/** Files one bug from `from` as GitHub issue `issue`, with its own words. */
function fileBug(root: string, from: FindingsDispatch, issue: number, words: string, artifact: string, iso: string): void {
  writeTriage(root, { dispatch: from, outcome: 'done', blockers: [], outOfScopeBugs: [reportBug(words, artifact)] }, at(iso));
  writeTrackerRef(root, {
    dispatch: from,
    outcome: 'done',
    artifact: `PLAN_TRACKER-${from.planStub ?? ''}.md: ${artifact}`,
    ref: { opt: issue, kind: 'github', externalId: String(issue), url: issueUrl(issue) },
  }, at(iso));
}

/** Plants a project with the fix plan, and the two bugs and the fix in its store unless `store` is false. */
function plant(store = true): Planted {
  planted += 1;
  const scope = join(tempBase, `case-${String(planted)}`);
  const root = join(scope, 'project');
  const home = join(scope, 'home');
  plantProjectConfig(root, `plan:\n  dir: ${PLAN_DIR}\n`);
  mkdirSync(home, { recursive: true });
  mkdirSync(join(root, PLAN_DIR), { recursive: true });
  writeFileSync(join(root, PLAN_DIR, 'PLAN-rafa-900-fixes.md'), FIX_PLAN, 'utf8');
  if (store) {
    fileBug(root, FILING, 12, BUG_WORDS, BUG_ARTIFACT, '2026-11-01T10:00:00.000Z');
    fileBug(root, SWEEP, 13, 'the writer truncates the tail', 'writer truncates the tail', '2026-11-01T11:00:00.000Z');
    writeTaskReport(root, { dispatch: FIXING, outcome: 'done', report: { status: 'done' } }, at('2026-11-02T10:00:00.000Z'));
  }
  return { root, home, scope };
}

/** Dispatches `words` over the command with the planted tree's seams. */
async function run(words: readonly string[], tree: Planted) {
  return dispatchInProject(words, SUBJECTS, [createInstinctPairsCommand()], { root: tree.root, home: tree.home }, { PATH: '' });
}

/** The data of the terminal result event. */
function resultData(stdout: string): unknown {
  return eventsOf(stdout).find((event) => event.type === 'result')?.data;
}

/** The non-empty lines of a capture. */
function linesOf(text: string): string[] {
  return text.split('\n').filter((line) => line !== '');
}

/** Every file under `dir` with its content, by path. */
function snapshot(dir: string): Record<string, string> {
  const files: Record<string, string> = {};
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) Object.assign(files, snapshot(path));
    else files[path] = readFileSync(path, 'utf8');
  }
  return files;
}

/** The library's push log under the planted project. */
function pushLogPath(tree: Planted): string {
  return join(tree.root, '.rafa', 'instincts', 'instincts.ndjson');
}

/** Runs the bug-fix pass over the planted project, its warnings kept off the console. */
async function pushPairs(tree: Planted): Promise<string[]> {
  const warned: string[] = [];
  await runBugFixPass({ root: tree.root, home: tree.home }, {
    warn: (message) => {
      warned.push(message);
    },
  });
  return warned;
}

/** The pair the fixture's #12 gives, as the command gives it. */
function fixturePair(logged: boolean): InstinctPairsResult['pairs'][number] {
  return {
    issue: '12',
    filing_plan: 'rafa-899-sweep',
    fixing_plan: 'rafa-900-fixes',
    trigger: BUG_WORDS,
    action: FIX_TASK,
    logged,
  };
}

describe('the --unpaired flag', () => {
  it('refuses a value typed with it, and reads it on or off otherwise', () => {
    expect(() => readUnpairedFlag({ unpaired: 'yes' })).toThrow('--unpaired takes no value');
    expect(readUnpairedFlag({})).toBe(false);
    expect(readUnpairedFlag({ unpaired: true })).toBe(true);
    expect(readUnpairedFlag({ unpaired: 'false' })).toBe(false);
  });
});

describe('what text mode writes', () => {
  const result: InstinctPairsResult = {
    total: 3,
    paired: 1,
    logged: 0,
    pairs: [fixturePair(false)],
    unpaired: [{ issue: '13', plan: 'rafa-898-sweep', reason: 'no-link' }, { issue: '7', plan: null, reason: 'local-ref' }],
  };

  it('writes the counts, then each pair on three lines, no unpaired bug without the flag', () => {
    expect(renderPairs(result, '/p', false)).toEqual([
      '1 of 3 bug finding(s) paired with the loop that fixed them, 0 of those logged as `bug-fix-pair` (project: /p)',
      '  #12  filed by rafa-899-sweep, fixed by rafa-900-fixes  (not logged)',
      `      trigger: ${BUG_WORDS}`,
      `      action:  ${FIX_TASK}`,
    ]);
  });

  it('adds each unpaired bug as its issue, plan and reason with the flag, a bug outside any plan named so', () => {
    expect(renderPairs(result, '/p', true).slice(4)).toEqual([
      '2 unpaired bug finding(s):',
      '  #13  rafa-898-sweep  no-link',
      '  #7  (no plan)  local-ref',
    ]);
  });
});

describe('rafa instinct pairs over a planted project', () => {
  it('prints one pair of two bug findings, none logged, and lists no unpaired bug without the flag', async () => {
    const tree = plant();

    const answered = await run(['instinct', 'pairs'], tree);

    expect(answered.exitCode).toBe(0);
    expect(answered.stderr).toBe('');
    expect(linesOf(answered.stdout)).toEqual([
      `1 of 2 bug finding(s) paired with the loop that fixed them, 0 of those logged as \`bug-fix-pair\` (project: ${tree.root})`,
      '  #12  filed by rafa-899-sweep, fixed by rafa-900-fixes  (not logged)',
      `      trigger: ${BUG_WORDS}`,
      `      action:  ${FIX_TASK}`,
    ]);
  });

  it('lists the sweep bug no plan names as no-link under --unpaired, with exit code 0', async () => {
    const tree = plant();

    const answered = await run(['instinct', 'pairs', '--unpaired'], tree);

    expect(answered.exitCode).toBe(0);
    expect(linesOf(answered.stdout).slice(4)).toEqual(['1 unpaired bug finding(s):', '  #13  rafa-898-sweep  no-link']);
  });

  it('gives the counts, the pairs and the unpaired bugs as the terminal result\'s data', async () => {
    const tree = plant();

    const answered = await run(['instinct', 'pairs', '--output=json'], tree);

    expect(answered.exitCode).toBe(0);
    expect(resultData(answered.stdout)).toEqual({
      total: 2,
      paired: 1,
      logged: 0,
      pairs: [fixturePair(false)],
      unpaired: [{ issue: '13', plan: 'rafa-898-sweep', reason: 'no-link' }],
    });
  });

  it('counts the pair logged once the pass pushed it, which it did not count before', async () => {
    const tree = plant();
    const before = await run(['instinct', 'pairs', '--output=json'], tree);

    expect(await pushPairs(tree)).toEqual([]);
    const after = await run(['instinct', 'pairs', '--output=json'], tree);

    expect((resultData(before.stdout) as InstinctPairsResult).logged).toBe(0);
    expect(resultData(after.stdout)).toEqual({
      total: 2,
      paired: 1,
      logged: 1,
      pairs: [fixturePair(true)],
      unpaired: [{ issue: '13', plan: 'rafa-898-sweep', reason: 'no-link' }],
    });
  });

  it('counts no pair logged under a key whose filing session is another\'s', async () => {
    const tree = plant();
    mkdirSync(join(tree.root, '.rafa', 'instincts'), { recursive: true });
    writeFileSync(pushLogPath(tree), `${JSON.stringify({ rule: 'bug-fix-pair', pair: { ref: issueUrl(12), filed_by: 'another-session' } })}\n`, 'utf8');

    const answered = await run(['instinct', 'pairs', '--output=json'], tree);

    expect((resultData(answered.stdout) as InstinctPairsResult).logged).toBe(0);
  });

  it('writes no file under the planted tree over a run that lists a pair', async () => {
    const tree = plant();
    await pushPairs(tree);
    const before = snapshot(tree.scope);

    const answered = await run(['instinct', 'pairs', '--unpaired'], tree);

    expect(answered.stdout).toContain('1 of 2 bug finding(s) paired');
    expect(snapshot(tree.scope)).toEqual(before);
  });

  it('names the missing store and counts nothing, with exit code 0, over a project with no store', async () => {
    const tree = plant(false);

    const answered = await run(['instinct', 'pairs', '--unpaired'], tree);

    expect(answered.exitCode).toBe(0);
    expect(linesOf(answered.stdout)).toEqual([
      expect.stringContaining('no effort store at '),
      `0 of 0 bug finding(s) paired with the loop that fixed them, 0 of those logged as \`bug-fix-pair\` (project: ${tree.root})`,
      '0 unpaired bug finding(s):',
    ]);
  });

  it('refuses a positional word with exit code 1 and the usage line', async () => {
    const answered = await run(['instinct', 'pairs', '12'], plant());

    expect(answered.exitCode).toBe(1);
    expect(answered.stdout).toBe('');
    expect(answered.stderr).toContain('Expected no argument');
    expect(answered.stderr).toContain('Usage: rafa instinct pairs [--unpaired]');
  });

  it('refuses a value typed with --unpaired with exit code 1', async () => {
    const answered = await run(['instinct', 'pairs', '--unpaired=yes'], plant());

    expect(answered.exitCode).toBe(1);
    expect(answered.stderr).toContain('--unpaired takes no value');
  });
});
