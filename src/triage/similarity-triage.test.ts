/**
 * The nearest-open-bug step of loop-owned triage (`src/triage/triage.ts`,
 * step 3 of a public bug's lookup), one case per branch, over a real
 * `local` tracker and the real SQLite store under a temporary root.
 *
 * Every open bug a case compares against is filed by `triageReport`
 * itself with the step left off, so its body is the one triage writes,
 * and every reading is taken off the issue files: the comments an issue
 * holds and the body a new one was filed with. The tracker is wrapped in
 * a recorder that hands each call on, so a case asserts whether the
 * listing was asked for at all. Each absence of a `Possible duplicates`
 * section or of a listing sits beside a case where the same reading sees
 * one.
 *
 * The two report texts the match cases use share 10 of 14 distinct
 * words, counted by hand: `parser drops the last line` / `parse returned
 * too few lines for the input` against `parser drops the final line` /
 * `parse returned too few lines for the text`, so a score of 0.71. The
 * unrelated bug shares one word, `the`, with the second: 1 of 19, 0.05.
 */
import type { TriageOptions, TriageResult } from './triage.js';
import type { IssueType, OpenIssue, Tracker } from '../ports/index.js';
import type { ReportBug, TaskReport } from '../report/parse.js';

import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { createLocalTracker } from '../adapters/tracker/local.js';

import { triageReport } from './triage.js';

const tempBase = mkdtempSync(join(tmpdir(), 'rafa-triage-similarity-'));
let rootCount = 0;

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

const TRACKER_TEXT = ['# Plan', '', '- [BLOCKED] Wire the loop', ''].join('\n');
const BLOCKED_LINE = 2;
const CLOCK = (): string => '2026-10-02T09:00:00.000Z';

/** The first report of the bug the match cases repeat. */
const FIRST: ReportBug = {
  what: 'Parser drops the last line',
  artifact: 'parse returned too few lines for the input',
  security: false,
  extras: [],
};

/** The same bug worded another way: another artifact, so another key, and 10 of 14 words shared. */
const REWORDED: ReportBug = {
  what: 'Parser drops the final line',
  artifact: 'parse returned too few lines for the text',
  security: false,
  extras: [],
};

/** A bug sharing one word, `the`, with {@link REWORDED}. */
const UNRELATED: ReportBug = {
  what: 'Config loader ignores the home file',
  artifact: 'readConfig skipped the home config',
  security: false,
  extras: [],
};

/** A bug sharing no word with any of the above. */
const DISJOINT: ReportBug = {
  what: 'Zebra quokka',
  artifact: 'wombat',
  security: false,
  extras: [],
};

/** What {@link REWORDED} scores against {@link FIRST}, as a filed text shows it. */
const MATCH_SCORE = '0.71';

/** The step's settings at the config's defaults. */
const DEFAULTS: NonNullable<TriageOptions['similarity']> = {
  triageSimilarityThreshold: 0.3,
  triageSimilarityCandidates: 3,
};

/** The method names a recorded tracker was asked, in order. */
type Calls = string[];

/** How a case's recorder differs from the local tracker it wraps. */
interface RecorderOptions {
  /** Leaves `openIssues` out, as a tracker without the reading does. */
  readonly withoutOpenIssues?: boolean;
  /** Replaces `openIssues`. */
  readonly openIssues?: NonNullable<Tracker['openIssues']>;
  /** Replaces `comment`. */
  readonly comment?: Tracker['comment'];
}

/** One case's root, its tracker, and a session that triages one bug. */
interface Case {
  readonly issuesDir: string;
  readonly calls: Calls;
  /** Triages `bug` as one session's report, with `similarity` as given. */
  readonly session: (bug: ReportBug, similarity?: TriageOptions['similarity']) => Promise<TriageResult>;
}

/** `inner`, recording each call before handing it on, changed as `options` say. */
function recorder(inner: Tracker, calls: Calls, options: RecorderOptions): Tracker {
  const record = <T>(name: string, run: () => Promise<T>): Promise<T> => {
    calls.push(name);
    return run();
  };
  const listing = options.openIssues ?? inner.openIssues;
  const openIssues = options.withoutOpenIssues === true || listing === undefined
    ? {}
    : { openIssues: (type: IssueType): Promise<OpenIssue[]> => record('openIssues', () => listing(type)) };
  const comment = options.comment ?? inner.comment;
  return {
    kind: inner.kind,
    capabilities: inner.capabilities,
    preflight: inner.preflight,
    find: (query) => record('find', () => inner.find(query)),
    get: (ref) => record('get', () => inner.get(ref)),
    create: (draft) => record('create', () => inner.create(draft)),
    comment: (ref, body) => record('comment', () => comment(ref, body)),
    transition: (ref, state) => record('transition', () => inner.transition(ref, state)),
    ...openIssues,
  };
}

/** A report holding `bug` alone. */
function reportOf(bug: ReportBug): TaskReport {
  return {
    status: 'blocked',
    feedback: 'The suite is red.',
    findings: [],
    skillsUsed: [],
    blockers: [],
    outOfScopeBugs: [bug],
    changes: [],
    extras: [],
  };
}

/** A fresh root under the temporary directory, its tracker recorded and changed as `options` say. */
function freshCase(options: RecorderOptions = {}): Case {
  const root = join(tempBase, `root-${rootCount}`);
  rootCount += 1;
  mkdirSync(root, { recursive: true });
  const trackerPath = join(root, 'PLAN_TRACKER-demo.md');
  writeFileSync(trackerPath, TRACKER_TEXT, 'utf8');
  const issuesDir = join(root, 'issues');
  const calls: Calls = [];
  const tracker = recorder(createLocalTracker({ issuesDir, fallbackReason: null, now: CLOCK }), calls, options);
  let sessions = 0;
  const session = (bug: ReportBug, similarity?: TriageOptions['similarity']): Promise<TriageResult> => {
    sessions += 1;
    return triageReport({
      repoRoot: root,
      trackerPath,
      lineNum: BLOCKED_LINE,
      dispatch: { sessionId: `session-${sessions}`, planStub: 'demo', taskLine: 'Wire the loop' },
      outcome: 'blocked',
      report: reportOf(bug),
      tracker,
      secrets: [],
      home: join(root, 'home'),
      ...similarity === undefined
        ? {}
        : { similarity },
    });
  };
  return { issuesDir, calls, session };
}

/** The text of every issue file under `dir`, in name order. */
function issueTexts(dir: string): string[] {
  return readdirSync(dir).sort()
    .map((name) => readFileSync(join(dir, name), 'utf8'));
}

/** The list lines of a filed body's `Possible duplicates` section. */
function listedDuplicates(body: string): string[] {
  return body.slice(body.indexOf('## Possible duplicates')).split('\n')
    .filter((line) => line.startsWith('- '));
}

/** The calls made since `mark` calls had been. */
function callsSince(calls: Calls, mark: number): string[] {
  return calls.slice(mark);
}

describe('the nearest open bug at or above the threshold', () => {
  it('is commented on naming its score, nothing filed, and its reference stored under the key', async () => {
    const { issuesDir, calls, session } = freshCase();
    await session(FIRST);
    await session(UNRELATED);
    const mark = calls.length;

    const result = await session(REWORDED, DEFAULTS);

    expect(result.bugs[0]).toMatchObject({
      channel: 'public',
      action: 'commented',
      foundBy: 'similarity',
      stored: 'inserted',
      problem: null,
    });
    expect(result.bugs[0]?.score).toBeCloseTo(10 / 14, 10);
    expect(callsSince(calls, mark)).toEqual(['find', 'openIssues', 'comment']);
    const [first, unrelated] = issueTexts(issuesDir);
    expect(issueTexts(issuesDir)).toHaveLength(2);
    expect(first).toContain(`Jaccard similarity of ${MATCH_SCORE}, at or above the threshold of 0.3`);
    expect(first).toContain('parse returned too few lines for the text');
    expect(unrelated).not.toContain('Jaccard similarity');
  });

  it('is found by its stored reference on the next recurrence, the listing not asked for again', async () => {
    const { calls, session } = freshCase();
    await session(FIRST);
    await session(REWORDED, DEFAULTS);
    const mark = calls.length;

    const again = await session(REWORDED, DEFAULTS);

    expect(again.bugs[0]).toMatchObject({ action: 'commented', foundBy: 'store' });
    expect(again.bugs[0]?.score).toBeUndefined();
    expect(callsSince(calls, mark)).toEqual(['get', 'comment']);
  });

  it('answers failed, naming the issue and its score, when the comment fails', async () => {
    const { issuesDir, session } = freshCase({ comment: () => Promise.reject(new Error('comment refused')) });
    await session(FIRST);

    const result = await session(REWORDED, DEFAULTS);

    expect(result.bugs[0]).toMatchObject({ action: 'failed', foundBy: 'similarity', stored: null });
    expect(result.bugs[0]?.ref).not.toBeNull();
    expect(result.bugs[0]?.score).toBeCloseTo(10 / 14, 10);
    expect(result.bugs[0]?.problem).toContain('comment refused');
    expect(issueTexts(issuesDir)).toHaveLength(1);
  });
});

describe('no open bug at the threshold', () => {
  it('files a new bug whose Possible duplicates section lists the nearest, highest score first', async () => {
    const { issuesDir, session } = freshCase();
    await session(FIRST);
    await session(UNRELATED);

    const result = await session(REWORDED, { ...DEFAULTS, triageSimilarityThreshold: 0.9 });

    expect(result.bugs[0]).toMatchObject({ action: 'filed', foundBy: null, stored: 'inserted', problem: null });
    expect(result.bugs[0]?.score).toBeUndefined();
    const texts = issueTexts(issuesDir);
    expect(texts).toHaveLength(3);
    const filed = texts[2]!;
    expect(filed).toContain('## Possible duplicates');
    expect(filed).toContain('No open bug scored at or above the similarity threshold of 0.9.');
    const listed = listedDuplicates(filed);
    expect(listed).toEqual([
      `- local issue 1 (score ${MATCH_SCORE})`,
      '- local issue 2 (score 0.05)',
    ]);
    expect(texts[0]).not.toContain('Reported again');
  });

  it('lists no more of the nearest than the candidates setting names', async () => {
    const { issuesDir, session } = freshCase();
    await session(FIRST);
    await session(UNRELATED);

    await session(REWORDED, { triageSimilarityThreshold: 0.9, triageSimilarityCandidates: 1 });

    const filed = issueTexts(issuesDir)[2]!;
    const listed = listedDuplicates(filed);
    expect(listed).toEqual([`- local issue 1 (score ${MATCH_SCORE})`]);
  });

  it('files a bug whose section says so when no open bug shares a word with it', async () => {
    const { issuesDir, session } = freshCase();
    await session(FIRST);

    const result = await session(DISJOINT, DEFAULTS);

    expect(result.bugs[0]).toMatchObject({ action: 'filed', problem: null });
    const filed = issueTexts(issuesDir)[1]!;
    expect(filed).toContain('## Possible duplicates');
    expect(filed).toContain('No open bug shares a word with this one.');
  });
});

describe('the step left off or skipped', () => {
  it.each([
    ['a threshold of false', { ...DEFAULTS, triageSimilarityThreshold: false } as const],
    ['the option left out', undefined],
  ])('with %s files with the exact-key lookups alone, never listing the open bugs', async (_name, similarity) => {
    const { issuesDir, calls, session } = freshCase();
    await session(FIRST);
    const mark = calls.length;

    const result = await session(REWORDED, similarity);

    expect(result.bugs[0]).toMatchObject({ action: 'filed', foundBy: null, problem: null });
    expect(callsSince(calls, mark)).toEqual(['find', 'create']);
    const texts = issueTexts(issuesDir);
    expect(texts).toHaveLength(2);
    expect(texts[1]).not.toContain('## Possible duplicates');
    expect(texts[0]).not.toContain('Reported again');
  });

  it('files with no Possible duplicates section for a tracker with no openIssues reading', async () => {
    const { issuesDir, calls, session } = freshCase({ withoutOpenIssues: true });
    await session(FIRST);
    const mark = calls.length;

    const result = await session(REWORDED, DEFAULTS);

    expect(result.bugs[0]).toMatchObject({ action: 'filed', problem: null });
    expect(callsSince(calls, mark)).toEqual(['find', 'create']);
    expect(issueTexts(issuesDir)[1]).not.toContain('## Possible duplicates');
  });

  it('never lists the open bugs for a bug the exact key finds', async () => {
    const { calls, session } = freshCase();
    await session(FIRST);
    const mark = calls.length;

    const result = await session(FIRST, DEFAULTS);

    expect(result.bugs[0]).toMatchObject({ action: 'commented', foundBy: 'store' });
    expect(callsSince(calls, mark)).not.toContain('openIssues');
  });

  it('never lists the open bugs for a bug with no artifact, which has no key', async () => {
    const { issuesDir, calls, session } = freshCase();
    await session(FIRST);
    const mark = calls.length;

    const result = await session({ ...REWORDED, artifact: null }, DEFAULTS);

    expect(result.bugs[0]).toMatchObject({ action: 'filed', problem: null });
    expect(callsSince(calls, mark)).toEqual(['create']);
    expect(issueTexts(issuesDir)[1]).not.toContain('## Possible duplicates');
  });

  it('never lists the public open bugs for a security bug', async () => {
    const { calls, session } = freshCase();
    await session(FIRST);
    const mark = calls.length;

    const result = await session({ ...REWORDED, security: true }, DEFAULTS);

    expect(result.bugs[0]).toMatchObject({ channel: 'private', action: 'filed' });
    expect(callsSince(calls, mark)).toEqual([]);
  });
});

describe('a listing that fails', () => {
  it('answers failed with its problem, and files nothing', async () => {
    const { issuesDir, calls, session } = freshCase({ openIssues: () => Promise.reject(new Error('gh issue list refused')) });
    await session(FIRST);
    const mark = calls.length;

    const result = await session(REWORDED, DEFAULTS);

    expect(result.bugs[0]).toMatchObject({ action: 'failed', ref: null, foundBy: null, stored: null });
    expect(result.bugs[0]?.problem).toBe('the public tracker openIssues failed: gh issue list refused');
    expect(callsSince(calls, mark)).toEqual(['find', 'openIssues']);
    expect(issueTexts(issuesDir)).toHaveLength(1);
  });
});
