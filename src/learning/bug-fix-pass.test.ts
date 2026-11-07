/**
 * Tests for the bug-fix pass over a fixture project: a store written
 * through the store writers, plan files in the `plan.dir` its
 * `.rafa/config.yaml` names, and the library under its
 * `.rafa/instincts/`, all under one temporary directory each case makes
 * and removes, the home beside it. No case reads or writes the
 * repository's store, plans or library.
 *
 * Two bugs are filed: #12, fixed by the one task of a stage whose
 * context names it, and #13, filed by a sweep no plan names. What a pass
 * did is read off the disk: the lesson through `parseInstinct`, and the
 * library's whole bytes before and after where a case says nothing was
 * written.
 */
import type { BugFixPassConfig } from './bug-fix-pass.js';
import type { ReportBug } from '@open-tomato/rafa/report/parse';
import type { FindingsDispatch } from '@open-tomato/rafa/store/findings';

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { writeTaskReport } from '@open-tomato/rafa/store/reports';
import { writeTrackerRef } from '@open-tomato/rafa/store/tracker-refs';
import { writeTriage } from '@open-tomato/rafa/store/triage';
import { parseInstinct } from '@open-tomato/rafa-inventory/schema/instinct';

import { runBugFixPass } from './bug-fix-pass.js';

const NOW = new Date('2026-11-10T00:00:00.000Z');

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

let base = '';
let root = '';
let home = '';

/** The clock the writers record with, fixed at `iso`. */
function at(iso: string): { now: () => Date } {
  return { now: () => new Date(iso) };
}

/** An out-of-scope bug as `parseReport` answers one. */
function reportBug(what: string, artifact: string): ReportBug {
  return { what, artifact, security: false, kind: 'bug', module: null, action: null, reproduce: null, cause: null, extras: [] };
}

/** Files one bug from `from` as GitHub issue `issue`, with its own words. */
function fileBug(from: FindingsDispatch, issue: number, words: string, artifact: string, iso: string): void {
  writeTriage(root, { dispatch: from, outcome: 'done', blockers: [], outOfScopeBugs: [reportBug(words, artifact)] }, at(iso));
  writeTrackerRef(root, {
    dispatch: from,
    outcome: 'done',
    artifact: `PLAN_TRACKER-${from.planStub}.md: ${artifact}`,
    ref: { opt: issue, kind: 'github', externalId: String(issue), url: `https://github.com/o/r/issues/${issue}` },
  }, at(iso));
}

/** The library's directory under the fixture project. */
function libraryDir(): string {
  return join(root, '.rafa', 'instincts');
}

/** The library's lesson files, sorted. */
function lessonFiles(): string[] {
  return existsSync(libraryDir())
    ? readdirSync(libraryDir())
      .filter((name) => name.endsWith('.md'))
      .sort()
    : [];
}

/** Every file of the library with its bytes, for a before and after. */
function snapshot(): Record<string, string> {
  if (!existsSync(libraryDir())) return {};
  const names = readdirSync(libraryDir()).sort();
  return Object.fromEntries(names.map((name) => [name, readFileSync(join(libraryDir(), name), 'utf8')]));
}

/** The warning sink of one case, collecting into `warned`. */
function collect(warned: string[]): (message: string) => void {
  return (message) => {
    warned.push(message);
  };
}

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), 'bug-fix-pass-'));
  root = join(base, 'project');
  home = join(base, 'home');
  await mkdir(join(root, '.rafa'), { recursive: true });
  await mkdir(home, { recursive: true });
  await writeFile(join(root, '.rafa', 'config.yaml'), `plan:\n  dir: ${PLAN_DIR}\n`);
  await mkdir(join(root, PLAN_DIR), { recursive: true });
  await writeFile(join(root, PLAN_DIR, 'PLAN-rafa-900-fixes.md'), FIX_PLAN);

  fileBug(FILING, 12, BUG_WORDS, BUG_ARTIFACT, '2026-11-01T10:00:00.000Z');
  fileBug(SWEEP, 13, 'the writer truncates the tail', 'writer truncates the tail', '2026-11-01T11:00:00.000Z');
  writeTaskReport(root, { dispatch: FIXING, outcome: 'done', report: { status: 'done' } }, at('2026-11-02T10:00:00.000Z'));
});

afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

describe('runBugFixPass over a fixture project', () => {
  test('warns once and answers zeros, writing nothing, when the plan directory cannot be listed', async () => {
    await rm(join(root, PLAN_DIR), { recursive: true, force: true });
    await writeFile(join(root, PLAN_DIR), 'a file where the plan directory should be');
    const warned: string[] = [];

    const result = await runBugFixPass({ root, home }, { now: () => NOW, warn: collect(warned) });

    expect(result).toEqual({ pushed: 0, skipped: 0, unpaired: 0 });
    expect(warned).toHaveLength(1);
    expect(warned[0]).toStartWith('bug-fix pass: nothing was pushed: ');
    expect(warned[0]).toContain('ENOTDIR');
    expect(existsSync(libraryDir())).toBe(false);
  });

  test('warns once and answers zeros when the config does not load', async () => {
    await writeFile(join(root, '.rafa', 'config.yaml'), 'plan: [unclosed\n');
    const warned: string[] = [];

    const result = await runBugFixPass({ root, home }, { now: () => NOW, warn: collect(warned) });

    expect(result).toEqual({ pushed: 0, skipped: 0, unpaired: 0 });
    expect(warned).toHaveLength(1);
    expect(warned[0]).toStartWith('bug-fix pass: nothing was pushed: ');
    expect(existsSync(libraryDir())).toBe(false);
  });

  test('warns once and pushes nothing when learning.adapter names another adapter', async () => {
    const config: BugFixPassConfig = { planDir: PLAN_DIR, learningAdapter: 'hub', learningBlessMinConfidence: 0.5 };
    const warned: string[] = [];

    const result = await runBugFixPass({ root, home }, { config, now: () => NOW, warn: collect(warned) });

    expect(result).toEqual({ pushed: 0, skipped: 0, unpaired: 0 });
    expect(warned).toEqual(['bug-fix pass: nothing was pushed: learning.adapter is `hub`, and the pass pushes through `local` only']);
    expect(existsSync(libraryDir())).toBe(false);
  });

  test('answers zeros and warns nothing over a project with no store', async () => {
    await rm(join(root, '.rafa', 'effort'), { recursive: true, force: true });
    const warned: string[] = [];

    const result = await runBugFixPass({ root, home }, { now: () => NOW, warn: collect(warned) });

    expect(result).toEqual({ pushed: 0, skipped: 0, unpaired: 0 });
    expect(warned).toEqual([]);
    expect(existsSync(libraryDir())).toBe(false);
  });

  test('pushes the pair found through the plan.dir the config names, as one lesson with two sources', async () => {
    const warned: string[] = [];

    const result = await runBugFixPass({ root, home }, { now: () => NOW, warn: collect(warned) });

    expect(result).toEqual({ pushed: 1, skipped: 0, unpaired: 1 });
    expect(warned).toEqual([]);
    const files = lessonFiles();
    expect(files).toHaveLength(1);
    const { instinct, issues } = parseInstinct(readFileSync(join(libraryDir(), files[0]!), 'utf8'));
    expect(issues).toEqual([]);
    expect([instinct?.sources, instinct?.usageCount]).toEqual([[FILING.sessionId, FIXING.sessionId], 2]);
    expect([instinct?.trigger, instinct?.action, instinct?.kind, instinct?.signal]).toEqual([
      BUG_WORDS, FIX_TASK, 'gotcha', 'loud',
    ]);
  });

  test('pushes nothing on a second run, skipping the pair the first pushed and leaving the library byte for byte', async () => {
    const first = await runBugFixPass({ root, home }, { now: () => NOW, warn: collect([]) });
    expect(first.pushed).toBe(1);
    const before = snapshot();
    const warned: string[] = [];

    const second = await runBugFixPass({ root, home }, { now: () => new Date('2026-11-11T00:00:00.000Z'), warn: collect(warned) });

    expect(second).toEqual({ pushed: 0, skipped: 1, unpaired: 1 });
    expect(warned).toEqual([]);
    expect(snapshot()).toEqual(before);
  });

  test('reads no plan from the default directory when the config names another', async () => {
    await rm(join(root, '.rafa', 'config.yaml'));

    const result = await runBugFixPass({ root, home }, { now: () => NOW, warn: collect([]) });

    expect(result).toEqual({ pushed: 0, skipped: 0, unpaired: 2 });
    expect(lessonFiles()).toEqual([]);
  });
});
