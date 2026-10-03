/**
 * Inherited red (`src/triage/inherited.ts`) and how `triageReport`
 * answers it (`src/triage/triage.ts`).
 *
 * The match is read on its own, then through a recording tracker over a
 * temporary directory and the real SQLite store under it: an inherited
 * bug files nothing and comments on its open issue once per run, while a
 * bug whose message differs is filed as before. A run-start failure with
 * no message is matched on test file and case alone, read both as built
 * here and through `runSuite` over `../suite/testdata/no-message.junit.xml`,
 * recorded from bun 1.3.14, whose `<failure>` carries no `message`.
 */
import type { InheritedTriage } from './inherited.js';
import type { TriageResult } from './triage.js';
import type { IssueDraft, IssueRef, Tracker } from '../ports/index.js';
import type { ReportBug, TaskReport } from '../report/parse.js';
import type { SuiteFailure, SuiteSpawner } from '../suite/run.js';

import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { createLocalTracker, localIssuesDir } from '../adapters/tracker/local.js';
import { runSuite } from '../suite/run.js';

import { inheritedFailureOf, isOpenIssueState } from './inherited.js';
import { triageReport } from './triage.js';

const TESTDATA = join(import.meta.dir, '..', 'suite', 'testdata');

const tempBase = mkdtempSync(join(tmpdir(), 'rafa-triage-inherited-'));
let rootCount = 0;

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

const TRACKER_TEXT = ['# Plan', '', '- [BLOCKED] Wire the loop', ''].join('\n');
const BLOCKED_LINE = 2;

/** One red test, as a session quoted bun's output for it. */
const ARTIFACT =
  'src/parse/parse.test.ts:\nerror: expect(received).toBe(expected) at line 12\n(fail) parse > drops the last line [0.19ms]';

/** The run-start failure that test is, as the JUnit file named it. */
const BASELINE_FAILURE: SuiteFailure = {
  file: 'src/parse/parse.test.ts',
  name: 'parse > drops the last line',
  message: 'expect(received).toBe(expected)',
};

const BUG: ReportBug = {
  what: 'Parser drops the last line',
  artifact: ARTIFACT,
  security: false,
  extras: [],
};

describe('inheritedFailureOf', () => {
  it('matches a failure whose file, case and message the bug names, the folder left out', () => {
    const bug = { what: BUG.what, artifact: ARTIFACT.replace('src/parse/', '') };

    expect(inheritedFailureOf(bug, [BASELINE_FAILURE])).toEqual(BASELINE_FAILURE);
  });

  it('matches nothing when the message differs', () => {
    const other = { ...BASELINE_FAILURE, message: 'expect(received).toEqual(expected)' };

    expect(inheritedFailureOf(BUG, [other])).toBeNull();
  });

  it('matches a baseline failure with no message, or a blank one, on file and case alone', () => {
    const { file, name } = BASELINE_FAILURE;
    const noEvidence = { what: BUG.what, artifact: 'src/parse/parse.test.ts > parse > drops the last line' };
    const otherCase = { what: BUG.what, artifact: ARTIFACT.replace('drops the last line', 'keeps the first line') };

    expect(inheritedFailureOf(BUG, [{ file, name }])).toEqual({ file, name });
    expect(inheritedFailureOf(BUG, [{ file, name, message: '  ' }])).toEqual({ file, name, message: '  ' });
    expect(inheritedFailureOf(noEvidence, [{ file, name }])).toEqual({ file, name });
    // Control: the same failure with its message still reads the evidence line, and another case never matches.
    expect(inheritedFailureOf(noEvidence, [BASELINE_FAILURE])).toBeNull();
    expect(inheritedFailureOf(otherCase, [{ file, name }])).toBeNull();
  });

  it('matches the failure runSuite reads from a report whose <failure> has no message, as bun 1.3.14 writes it', async () => {
    const dir = mkdtempSync(join(tempBase, 'suite-'));
    const junitFile = join(dir, 'run.junit.xml');
    const spawn: SuiteSpawner = async () => {
      copyFileSync(join(TESTDATA, 'no-message.junit.xml'), junitFile);
      return { exitCode: 1, stderr: readFileSync(join(TESTDATA, 'no-message.stderr.txt'), 'utf8') };
    };

    const { failures } = await runSuite({ cwd: dir, junitFile, spawn });

    expect(readFileSync(join(TESTDATA, 'no-message.junit.xml'), 'utf8')).toContain('<failure type="AssertionError" />');
    expect(failures).toEqual([{ file: 'src/parse/parse.test.ts', name: 'parse > drops the last line' }]);
    expect(inheritedFailureOf(BUG, failures)).toEqual(failures[0]!);
    // Control: a bug naming another case of that file is not taken for it.
    const otherCase = { what: BUG.what, artifact: ARTIFACT.replace('drops the last line', 'keeps the first line') };
    expect(inheritedFailureOf(otherCase, failures)).toBeNull();
  });

  it('matches nothing for another case or another file', () => {
    expect(inheritedFailureOf(BUG, [{ ...BASELINE_FAILURE, name: 'parse > keeps the first line' }])).toBeNull();
    expect(inheritedFailureOf(BUG, [{ ...BASELINE_FAILURE, file: 'src/parse/lex.test.ts' }])).toBeNull();
  });

  it('matches nothing for a bug naming no test case', () => {
    const bug = { what: 'The build is red', artifact: 'expect(received).toBe(expected)' };

    expect(inheritedFailureOf(bug, [BASELINE_FAILURE])).toBeNull();
  });

  it('answers the first matching failure, in the baseline order', () => {
    const second = { ...BASELINE_FAILURE, message: 'expect(received)' };

    expect(inheritedFailureOf(BUG, [{ ...BASELINE_FAILURE, name: 'other' }, second, BASELINE_FAILURE])).toBe(second);
  });
});

describe('isOpenIssueState', () => {
  it('reads every state before done as open and the three closed ones as closed', () => {
    expect(['backlog', 'todo', 'in-progress', 'in-review'].map((state) => isOpenIssueState(state as 'todo'))).toEqual([true, true, true, true]);
    expect(['done', 'released', 'cancelled'].map((state) => isOpenIssueState(state as 'done'))).toEqual([false, false, false]);
  });
});

interface Recorded {
  readonly tracker: Tracker;
  readonly created: IssueDraft[];
  readonly commented: { readonly ref: IssueRef; readonly body: string }[];
}

/** A local tracker under `root` that records each create and comment. */
function recordingTracker(root: string): Recorded {
  const inner = createLocalTracker({
    issuesDir: localIssuesDir(root),
    fallbackReason: null,
    now: () => '2026-10-02T08:00:00.000Z',
  });
  const created: IssueDraft[] = [];
  const commented: { ref: IssueRef; body: string }[] = [];
  const tracker: Tracker = {
    ...inner,
    create: (draft) => {
      created.push(draft);
      return inner.create(draft);
    },
    comment: (ref, body) => {
      commented.push({ ref, body });
      return inner.comment(ref, body);
    },
  };
  return { tracker, created, commented };
}

function freshRoot(): string {
  const root = join(tempBase, `root-${rootCount}`);
  rootCount += 1;
  mkdirSync(root, { recursive: true });
  return root;
}

function reportOf(bug: ReportBug): TaskReport {
  return {
    status: 'blocked',
    feedback: 'The suite is red.',
    findings: [],
    skillsUsed: [],
    blockers: [],
    outOfScopeBugs: [bug],
    extras: [],
  };
}

function triage(
  root: string,
  recorded: Recorded,
  bug: ReportBug,
  inherited?: InheritedTriage,
): Promise<TriageResult> {
  const trackerPath = join(root, 'PLAN_TRACKER-alpha.md');
  writeFileSync(trackerPath, TRACKER_TEXT, 'utf8');
  return triageReport({
    repoRoot: root,
    trackerPath,
    lineNum: BLOCKED_LINE,
    dispatch: { sessionId: 'session-alpha', planStub: 'alpha', taskLine: 'Wire the loop' },
    outcome: 'blocked',
    report: reportOf(bug),
    tracker: recorded.tracker,
    secrets: [],
    ...(inherited === undefined
      ? {}
      : { inherited }),
  });
}

function inheritedOf(failures: readonly SuiteFailure[]): InheritedTriage {
  return { failures, commented: new Set<string>() };
}

describe('triageReport with the run-start failures', () => {
  it('answers a matching bug inherited and comments on its open issue', async () => {
    const root = freshRoot();
    const recorded = recordingTracker(root);
    const earlier = await triage(root, recorded, BUG);
    const inherited = inheritedOf([BASELINE_FAILURE]);

    const result = await triage(root, recorded, BUG, inherited);

    expect(earlier.bugs[0]).toMatchObject({ action: 'filed' });
    expect(result.bugs[0]).toMatchObject({
      channel: 'public',
      action: 'inherited',
      ref: earlier.bugs[0]!.ref!,
      foundBy: 'store',
      problem: null,
    });
    expect(recorded.created).toHaveLength(1);
    expect(recorded.commented).toHaveLength(1);
    expect(inherited.commented.size).toBe(1);
  });

  it('files nothing and calls nothing to write when no issue is found', async () => {
    const root = freshRoot();
    const recorded = recordingTracker(root);
    const inherited = inheritedOf([BASELINE_FAILURE]);

    const result = await triage(root, recorded, BUG, inherited);

    expect(result.bugs[0]).toMatchObject({ action: 'inherited', ref: null, foundBy: null, stored: null });
    expect(recorded.created).toHaveLength(0);
    expect(recorded.commented).toHaveLength(0);
    expect(inherited.commented.size).toBe(0);
  });

  it('leaves a closed issue alone', async () => {
    const root = freshRoot();
    const recorded = recordingTracker(root);
    const earlier = await triage(root, recorded, BUG);
    await recorded.tracker.transition(earlier.bugs[0]!.ref!, 'done');
    const inherited = inheritedOf([BASELINE_FAILURE]);

    const result = await triage(root, recorded, BUG, inherited);

    expect(result.bugs[0]).toMatchObject({ action: 'inherited', ref: null });
    expect(recorded.created).toHaveLength(1);
    expect(recorded.commented).toHaveLength(0);
    expect(inherited.commented.size).toBe(0);
  });

  it('files a bug whose message differs from the run-start failure', async () => {
    const root = freshRoot();
    const recorded = recordingTracker(root);
    const other = { ...BASELINE_FAILURE, message: 'expect(received).toEqual(expected)' };

    const result = await triage(root, recorded, BUG, inheritedOf([other]));

    expect(result.bugs[0]).toMatchObject({ action: 'filed' });
    expect(recorded.created).toHaveLength(1);
  });

  it('answers a bug inherited whose run-start failure has no message', async () => {
    const root = freshRoot();
    const recorded = recordingTracker(root);
    const { file, name } = BASELINE_FAILURE;

    const result = await triage(root, recorded, BUG, inheritedOf([{ file, name }]));

    expect(result.bugs[0]).toMatchObject({ action: 'inherited' });
    expect(recorded.created).toHaveLength(0);
  });

  it('comments once when the bug is seen twice in one run', async () => {
    const root = freshRoot();
    const recorded = recordingTracker(root);
    await triage(root, recorded, BUG);
    const inherited = inheritedOf([BASELINE_FAILURE]);
    const reworded: ReportBug = {
      ...BUG,
      what: 'Last line lost when parsing',
      artifact: 'parse.test.ts > parse > drops the last line\nerror: expect(received).toBe(expected) at line 40',
    };

    const first = await triage(root, recorded, BUG, inherited);
    const second = await triage(root, recorded, reworded, inherited);

    expect(first.bugs[0]).toMatchObject({ action: 'inherited', foundBy: 'store' });
    expect(second.bugs[0]).toMatchObject({ action: 'inherited', ref: null, foundBy: null });
    expect(recorded.created).toHaveLength(1);
    expect(recorded.commented).toHaveLength(1);
  });

  it('comments again in a run with a set of its own', async () => {
    const root = freshRoot();
    const recorded = recordingTracker(root);
    await triage(root, recorded, BUG);

    await triage(root, recorded, BUG, inheritedOf([BASELINE_FAILURE]));
    await triage(root, recorded, BUG, inheritedOf([BASELINE_FAILURE]));

    expect(recorded.commented).toHaveLength(2);
  });

  it('never reads a security bug against the run-start failures', async () => {
    const root = freshRoot();
    const recorded = recordingTracker(root);
    const privateTracker = createLocalTracker({
      issuesDir: join(root, 'private'),
      fallbackReason: null,
    });
    const trackerPath = join(root, 'PLAN_TRACKER-alpha.md');
    writeFileSync(trackerPath, TRACKER_TEXT, 'utf8');

    const result = await triageReport({
      repoRoot: root,
      trackerPath,
      lineNum: BLOCKED_LINE,
      dispatch: { sessionId: 'session-alpha', planStub: 'alpha', taskLine: 'Wire the loop' },
      outcome: 'blocked',
      report: reportOf({ ...BUG, security: true }),
      tracker: recorded.tracker,
      privateTracker,
      secrets: [],
      inherited: inheritedOf([BASELINE_FAILURE]),
    });

    expect(result.bugs[0]).toMatchObject({ channel: 'private', action: 'filed' });
    expect(recorded.created).toHaveLength(0);
  });
});
