/**
 * Triage of one red test met by several plans (`src/triage/triage.ts`).
 *
 * A recording tracker over a temporary directory and the real SQLite store
 * under it: the same test failure worded two ways by two plans files one bug
 * and comments on it, and two different failures in one test case file two.
 */
import type { TriageResult } from './triage.js';
import type { IssueDraft, IssueRef, Tracker } from '../ports/index.js';
import type { ReportBug, TaskReport } from '../report/parse.js';

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { createLocalTracker, localIssuesDir } from '../adapters/tracker/local.js';

import { triageReport } from './triage.js';

const tempBase = mkdtempSync(join(tmpdir(), 'rafa-triage-test-failure-'));
let rootCount = 0;

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

const TRACKER_TEXT = ['# Plan', '', '- [BLOCKED] Wire the loop', ''].join('\n');
const BLOCKED_LINE = 2;

/** One red test, worded as plan A's session quoted bun's output. */
const WORDING_A =
  'src/parse/parse.test.ts:\nerror: expect(received).toBe(expected)\n(fail) parse > drops the last line';
/** The same red test, as plan B's session quoted it: a `file > case` line, no folder. */
const WORDING_B =
  'parse.test.ts > parse > drops the last line\nerror: expect(received).toBe(expected)';

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

function planFile(root: string, stub: string): string {
  const path = join(root, `PLAN_TRACKER-${stub}.md`);
  writeFileSync(path, TRACKER_TEXT, 'utf8');
  return path;
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

function testBug(what: string, artifact: string): ReportBug {
  return { what, artifact, security: false, extras: [] };
}

function triagePlan(
  root: string,
  recorded: Recorded,
  stub: string,
  bug: ReportBug,
): Promise<TriageResult> {
  return triageReport({
    repoRoot: root,
    trackerPath: planFile(root, stub),
    lineNum: BLOCKED_LINE,
    dispatch: { sessionId: `session-${stub}`, planStub: stub, taskLine: 'Wire the loop' },
    outcome: 'blocked',
    report: reportOf(bug),
    tracker: recorded.tracker,
    secrets: [],
  });
}

function freshRoot(): string {
  const root = join(tempBase, `root-${rootCount}`);
  rootCount += 1;
  mkdirSync(root, { recursive: true });
  return root;
}

describe('one red test reported by two plans', () => {
  it('two wordings of one failure file one bug, then comment on it', async () => {
    const root = freshRoot();
    const recorded = recordingTracker(root);

    const first = await triagePlan(root, recorded, 'alpha', testBug('Parser drops the last line', WORDING_A));
    const second = await triagePlan(root, recorded, 'beta', testBug('Last line lost when parsing', WORDING_B));

    expect(first.bugs[0]).toMatchObject({ action: 'filed', problem: null });
    expect(second.bugs[0]).toMatchObject({ action: 'commented', foundBy: 'store', problem: null });
    expect(recorded.created).toHaveLength(1);
    expect(recorded.commented).toHaveLength(1);
    expect(recorded.commented[0]!.ref).toEqual(first.bugs[0]!.ref!);
  });
});

describe('two different failures in one test case', () => {
  it('file two bugs', async () => {
    const root = freshRoot();
    const recorded = recordingTracker(root);
    const other =
      'src/parse/parse.test.ts:\nerror: expect(received).toEqual(expected)\n(fail) parse > drops the last line';

    const first = await triagePlan(root, recorded, 'alpha', testBug('Parser drops the last line', WORDING_A));
    const second = await triagePlan(root, recorded, 'beta', testBug('Parser result differs', other));

    expect(first.bugs[0]).toMatchObject({ action: 'filed' });
    expect(second.bugs[0]).toMatchObject({ action: 'filed', foundBy: null });
    expect(recorded.created).toHaveLength(2);
    expect(recorded.commented).toHaveLength(0);
  });
});
