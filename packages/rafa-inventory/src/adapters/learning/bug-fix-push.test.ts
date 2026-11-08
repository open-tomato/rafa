/**
 * Tests for pushing bug-fix pairs into the `local` library once each.
 *
 * Every pair is one `pairBugFixes` answers over rows built inline, so the
 * lesson pushed is the one the join builds. Every library is a directory
 * of its own under one temporary directory this file makes and removes;
 * no case writes under the repository or the home. What a push did is
 * read off the disk: the `.md` files through `parseInstinct`, the push
 * log line by line, and the whole directory's bytes before and after
 * where a case says nothing was written.
 *
 * Four mutations were driven on 2026-11-07 over this file and the
 * `logLine` case of `src/tests/inventory-coupled/adapters/learning/local.test.ts`,
 * one run each, with 80 pass before and both modules restored
 * sha1-identical after, and every one reddened at least one case: no
 * logged pair skipped reddened the second-push and other-filer cases;
 * `logLine` not called in `local.ts` reddened seven; no lone retry of a
 * refused session reddened the in-session refusal case alone; and a key
 * read without `filed_by` reddened the other-filer case alone.
 */
import type { BugFixPush } from './bug-fix-push.js';
import type { PushLogLine } from './local.js';
import type { BugFixPair, BugFixRows, PlanStageLink } from '../../report/bug-fix-pairs.js';
import type { Instinct } from '../../schema/instinct.js';

import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';

import { pairBugFixes } from '../../report/bug-fix-pairs.js';
import { parseInstinct } from '../../schema/instinct.js';

import { bugFixPairKey, pushBugFixPairs, readLoggedPairs } from './bug-fix-push.js';
import { PUSH_LOG_FILE } from './local.js';

/** The clock of every join and push here. */
const NOW = new Date('2026-11-07T12:00:00.000Z');

/** When every bug here was filed. */
const FILED_AT = '2026-11-01T10:00:00.000Z';

/** When every fix here was reported. */
const FIXED_AT = '2026-11-03T10:00:00.000Z';

let tempDir = '';
let made = 0;

beforeAll(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'rafa-bug-fix-push-'));
});

afterAll(() => {
  if (tempDir !== '') rmSync(tempDir, { recursive: true, force: true });
});

/** A library directory of its own under this file's temporary directory, not yet on disk. */
function freshDir(name: string): string {
  made += 1;
  return join(tempDir, `${made}-${name}`);
}

/** The options of a push into `instinctsDir`, its home one no case makes. */
function optionsFor(instinctsDir: string, warned: string[] = []): Parameters<typeof pushBugFixPairs>[0] {
  return {
    instinctsDir,
    home: join(tempDir, 'home-no-case-makes'),
    minConfidence: 0.5,
    warn: (message) => {
      warned.push(message);
    },
  };
}

/** What one bug of a fixture names. */
interface BugSpec {
  readonly issue: string;
  readonly filer: string;
  readonly fixer: string;
  readonly words: string;
}

/**
 * The pairs `pairBugFixes` answers for `bugs`: each filed by its `filer`
 * in plan `rafa-900-filer`, and fixed by its `fixer` in a one-task stage
 * whose context names its issue.
 */
function pairsOf(bugs: readonly BugSpec[]): readonly BugFixPair[] {
  const rows: BugFixRows = {
    bugs: bugs.map((spec, index) => ({
      id: `bug-${index}`,
      sessionId: spec.filer,
      planStub: 'rafa-900-filer',
      taskLine: 'Add the filer',
      artifact: `PLAN_TRACKER-rafa-900-filer.md: error ${spec.issue}`,
      trackerRef: { kind: 'github', externalId: spec.issue, url: `https://github.com/o/r/issues/${spec.issue}` },
      outcome: 'done',
      collectedAt: FILED_AT,
    })),
    outOfScope: bugs.map((spec) => ({ sessionId: spec.filer, what: spec.words, artifact: `error ${spec.issue}` })),
    resolved: [],
    reports: bugs.map((spec) => ({
      sessionId: spec.fixer,
      planStub: `rafa-1000-fix-${spec.issue}`,
      taskLine: `Fix the bug of issue ${spec.issue}`,
      outcome: 'done',
      collectedAt: FIXED_AT,
    })),
  };
  const links: PlanStageLink[] = bugs.map((spec) => ({
    stub: `rafa-1000-fix-${spec.issue}`,
    stage: 'Fix',
    context: `This stage fixes #${spec.issue}.`,
    tasks: [`Fix the bug of issue ${spec.issue}`],
  }));
  const { pairs, unpaired } = pairBugFixes(rows, links, NOW);
  expect(unpaired).toEqual([]);
  expect(pairs).toHaveLength(bugs.length);
  return pairs;
}

/** The fixture's first bug: filed by `filer-1`, fixed by `fixer-1`. */
const DOCTOR: BugSpec = {
  issue: '42',
  filer: 'filer-1',
  fixer: 'fixer-1',
  words: 'the doctor test reads env words from the machine',
};

/** A second bug, filed by `filer-2` and fixed by `fixer-2`. */
const BOARD: BugSpec = {
  issue: '43',
  filer: 'filer-2',
  fixer: 'fixer-2',
  words: 'the board refresh drops the stage outline',
};

/** `pair` with its lesson's confidence out of the port's range, which the adapter refuses. */
function refusable(pair: BugFixPair): BugFixPair {
  return { ...pair, lesson: { ...pair.lesson, confidence: 0.95 } };
}

/** Each line of the push log under `dir`, parsed. */
function logOf(dir: string): PushLogLine[] {
  return readFileSync(join(dir, PUSH_LOG_FILE), 'utf8')
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => JSON.parse(line) as PushLogLine);
}

/** The instinct `<id>.md` under `dir` holds, failing the case when it does not read. */
function heldFile(dir: string, id: string): Instinct {
  const parsed = parseInstinct(readFileSync(join(dir, `${id}.md`), 'utf8'));
  expect(parsed.issues).toEqual([]);
  return parsed.instinct!;
}

/** Every `.md` file under `dir`, in name order. */
function lessonFiles(dir: string): string[] {
  return readdirSync(dir)
    .filter((name) => name.endsWith('.md'))
    .sort();
}

/** Every file under `dir` and its bytes, in name order. */
function snapshot(dir: string): [name: string, bytes: string][] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .sort()
    .map((name) => [name, readFileSync(join(dir, name), 'utf8')]);
}

/** The issue of each pair in `pairs`, in order. */
function issuesOf(pairs: readonly BugFixPair[]): string[] {
  return pairs.map((pair) => pair.issue);
}

describe('readLoggedPairs', () => {
  it('answers no key when the library has no push log', async () => {
    const dir = freshDir('no-log');

    expect(await readLoggedPairs(dir)).toEqual([]);
    expect(existsSync(dir)).toBe(false);
  });

  it('reads each bug-fix-pair key once, passing over other rules, torn lines and malformed keys', async () => {
    const dir = freshDir('mixed-log');
    mkdirSync(dir, { recursive: true });
    const key = { ref: 'https://github.com/o/r/issues/42', filed_by: 'filer-1' };
    const other = { ref: 'https://github.com/o/r/issues/43', filed_by: 'filer-2' };
    writeFileSync(join(dir, PUSH_LOG_FILE), [
      JSON.stringify({ source_id: 's', rule: 'new-trigger', pair: { ref: 'not-a-pair-rule', filed_by: 'x' } }),
      JSON.stringify({ source_id: 's', rule: 'bug-fix-pair', pair: key }),
      '{"source_id":"s","rule":"bug-fix-pa',
      JSON.stringify({ source_id: 's', rule: 'bug-fix-pair', pair: { ref: 7, filed_by: 'filer-3' } }),
      JSON.stringify({ source_id: 's', rule: 'bug-fix-pair' }),
      JSON.stringify({ source_id: 's', rule: 'bug-fix-pair', pair: other }),
      JSON.stringify({ source_id: 's', rule: 'bug-fix-pair', pair: key }),
      '',
    ].join('\n'));

    expect(await readLoggedPairs(dir)).toEqual([key, other]);
  });
});

describe('pushBugFixPairs', () => {
  it('writes one lesson with two sources and usage_count 2, logging its decision under bug-fix-pair with its key', async () => {
    const dir = freshDir('first-push');
    const [pair] = pairsOf([DOCTOR]);

    const answer = await pushBugFixPairs(optionsFor(dir), [pair!], NOW);

    expect(answer).toEqual({ pushed: [pair!], skipped: [], problems: [] });
    expect(lessonFiles(dir)).toEqual([`${pair!.lesson.id}.md`]);
    const held = heldFile(dir, pair!.lesson.id);
    expect([held.sources, held.usageCount]).toEqual([['filer-1', 'fixer-1'], 2]);
    expect([held.trigger, held.action, held.kind, held.signal]).toEqual([
      DOCTOR.words, pair!.lesson.action, 'gotcha', 'loud',
    ]);
    expect(logOf(dir)).toEqual([{
      source_id: 'fixer-1',
      rule: 'bug-fix-pair',
      incoming: pair!.lesson,
      produced: [pair!.lesson.id],
      discarded: [],
      pair: { ref: 'https://github.com/o/r/issues/42', filed_by: 'filer-1' },
    }]);
    expect(await readLoggedPairs(dir)).toEqual([bugFixPairKey(pair!)]);
  });

  it('writes no file and appends no line on a second push of the same pairs, answering them skipped', async () => {
    const dir = freshDir('second-push');
    const pairs = pairsOf([DOCTOR, BOARD]);
    const first = await pushBugFixPairs(optionsFor(dir), pairs, NOW);
    expect(issuesOf(first.pushed)).toEqual(['42', '43']);
    const before = snapshot(dir);
    expect(logOf(dir)).toHaveLength(2);

    const second = await pushBugFixPairs(optionsFor(dir), pairs, new Date('2026-11-08T12:00:00.000Z'));

    expect(second).toEqual({ pushed: [], skipped: pairs, problems: [] });
    expect(snapshot(dir)).toEqual(before);
  });

  it('pushes a pair whose key the log does not hold beside one it does, the key read by ref and filing session', async () => {
    const dir = freshDir('other-filer');
    const [doctor] = pairsOf([DOCTOR]);
    await pushBugFixPairs(optionsFor(dir), [doctor!], NOW);
    // The same issue filed again by another session: its key differs by `filed_by` alone.
    const [again] = pairsOf([{ ...DOCTOR, filer: 'filer-9', fixer: 'fixer-9', words: 'the doctor test reads env again' }]);

    const answer = await pushBugFixPairs(optionsFor(dir), [doctor!, again!], NOW);

    expect(answer.skipped).toEqual([doctor!]);
    expect(answer.pushed).toEqual([again!]);
    expect(logOf(dir).map((line) => line.pair)).toEqual([
      { ref: 'https://github.com/o/r/issues/42', filed_by: 'filer-1' },
      { ref: 'https://github.com/o/r/issues/42', filed_by: 'filer-9' },
    ]);
  });

  it('costs one problem line for a refused pair of its own session and pushes the others', async () => {
    const dir = freshDir('refused-alone');
    const [doctor, board] = pairsOf([DOCTOR, BOARD]);
    const refused = refusable(doctor!);

    const answer: BugFixPush = await pushBugFixPairs(optionsFor(dir), [refused, board!], NOW);

    expect(answer.pushed).toEqual([board!]);
    expect(answer.skipped).toEqual([]);
    expect(answer.problems).toHaveLength(1);
    expect(answer.problems[0]).toStartWith(
      'bug-fix pair https://github.com/o/r/issues/42 filed by filer-1 was not pushed: local learning: refused to store a push',
    );
    expect(lessonFiles(dir)).toEqual([`${board!.lesson.id}.md`]);
    expect(logOf(dir).map((line) => line.pair?.filed_by)).toEqual(['filer-2']);
  });

  it('pushes the other pairs of a fixing session alone when one of its pairs is refused', async () => {
    const dir = freshDir('refused-in-session');
    const [doctor, board] = pairsOf([DOCTOR, { ...BOARD, fixer: DOCTOR.fixer }]);
    expect([doctor!.fix.sessionId, board!.fix.sessionId]).toEqual(['fixer-1', 'fixer-1']);

    const answer = await pushBugFixPairs(optionsFor(dir), [refusable(doctor!), board!], NOW);

    expect(answer.pushed).toEqual([board!]);
    expect(answer.problems).toHaveLength(1);
    expect(answer.problems[0]).toContain('filed by filer-1 was not pushed');
    expect(lessonFiles(dir)).toEqual([`${board!.lesson.id}.md`]);
    expect(logOf(dir).map((line) => [line.source_id, line.rule, line.pair?.filed_by])).toEqual([
      ['fixer-1', 'bug-fix-pair', 'filer-2'],
    ]);
  });

  it('pushes the pairs of one fixing session as one payload, each line holding its own key', async () => {
    const dir = freshDir('one-session');
    const pairs = pairsOf([DOCTOR, { ...BOARD, fixer: DOCTOR.fixer }]);

    const answer = await pushBugFixPairs(optionsFor(dir), pairs, NOW);

    expect(answer.pushed).toEqual(pairs);
    expect(logOf(dir).map((line) => [line.source_id, line.pair?.filed_by])).toEqual([
      ['fixer-1', 'filer-1'],
      ['fixer-1', 'filer-2'],
    ]);
    expect(lessonFiles(dir)).toEqual(pairs.map((pair) => `${pair.lesson.id}.md`).sort());
  });

  it('keys a reference with no URL by its kind and issue', async () => {
    const [pair] = pairsOf([DOCTOR]);
    const bare = { ...pair!, bug: { ...pair!.bug, trackerRef: { ...pair!.bug.trackerRef, url: null } } };

    expect(bugFixPairKey(bare)).toEqual({ ref: 'github:42', filed_by: 'filer-1' });
  });

  it('writes nothing and makes no directory when every pair is refused', async () => {
    const dir = freshDir('all-refused');
    const pairs = pairsOf([DOCTOR, BOARD]).map(refusable);

    const answer = await pushBugFixPairs(optionsFor(dir), pairs, NOW);

    expect(answer.pushed).toEqual([]);
    expect(answer.problems).toHaveLength(2);
    expect(existsSync(dir)).toBe(false);
  });
});
