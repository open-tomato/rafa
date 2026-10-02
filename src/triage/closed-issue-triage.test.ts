/**
 * Triage of a bug that recurs in an issue already closed
 * (`src/triage/triage.ts`), over the GitHub adapter's recorded fake
 * (`src/adapters/tracker/github-fake.ts`) and the real SQLite store under a
 * temporary root.
 *
 * A repeat of an issue closed as completed files one new issue that names
 * the old one, and a later repeat comments on the new one. A repeat of an
 * issue closed as `NOT_PLANNED` or as `DUPLICATE` gets one comment and no
 * new issue.
 */
import type { TriageResult } from './triage.js';
import type { FakeGh } from '../adapters/tracker/github-fake.js';
import type { ReportBug, TaskReport } from '../report/parse.js';

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { createFakeGh } from '../adapters/tracker/github-fake.js';
import { createGithubTracker } from '../adapters/tracker/github.js';

import { triageReport } from './triage.js';

const tempBase = mkdtempSync(join(tmpdir(), 'rafa-triage-closed-'));
let rootCount = 0;

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

const TRACKER_TEXT = ['# Plan', '', '- [BLOCKED] Wire the loop', ''].join('\n');
const BLOCKED_LINE = 2;
const ARTIFACT = 'src/parse/parse.test.ts:\nerror: expect(received).toBe(expected)\n(fail) parse > drops the last line';
const BUG: ReportBug = { what: 'Parser drops the last line', artifact: ARTIFACT, security: false, extras: [] };

interface Case {
  readonly root: string;
  readonly fake: FakeGh;
  /** Triages the bug as the session numbered `n` reports it. */
  readonly session: (n: number) => Promise<TriageResult>;
}

function report(): TaskReport {
  return {
    status: 'blocked',
    feedback: 'The suite is red.',
    findings: [],
    skillsUsed: [],
    blockers: [],
    outOfScopeBugs: [BUG],
    extras: [],
  };
}

function freshCase(): Case {
  const root = join(tempBase, `root-${rootCount}`);
  rootCount += 1;
  mkdirSync(root, { recursive: true });
  const fake = createFakeGh();
  const tracker = createGithubTracker({ gh: fake.run });
  const session = (n: number): Promise<TriageResult> => {
    const trackerPath = join(root, `PLAN_TRACKER-plan${n}.md`);
    writeFileSync(trackerPath, TRACKER_TEXT, 'utf8');
    return triageReport({
      repoRoot: root,
      trackerPath,
      lineNum: BLOCKED_LINE,
      dispatch: { sessionId: `session-${n}`, planStub: `plan${n}`, taskLine: 'Wire the loop' },
      outcome: 'blocked',
      report: report(),
      tracker,
      secrets: [],
    });
  };
  return { root, fake, session };
}

describe('a repeat of an issue closed as completed', () => {
  it('files one new issue naming the old one, and a later repeat comments on the new one', async () => {
    const { fake, session } = freshCase();

    const first = await session(1);
    expect(first.bugs[0]).toMatchObject({ action: 'filed', problem: null });
    fake.update('1', (issue) => ({ ...issue, state: 'CLOSED', stateReason: 'COMPLETED' }));

    const second = await session(2);
    expect(second.bugs[0]).toMatchObject({ action: 'filed', problem: null });
    expect(fake.issueCount()).toBe(2);
    expect(fake.issue('1')?.comments).toHaveLength(0);
    expect(fake.issue('2')?.body).toContain('## Supersedes');
    expect(fake.issue('2')?.body).toContain('https://github.com/open-tomato/rafa/issues/1');

    const third = await session(3);
    expect(third.bugs[0]).toMatchObject({ action: 'commented', foundBy: 'store', problem: null });
    expect(fake.issueCount()).toBe(2);
    expect(fake.issue('1')?.comments).toHaveLength(0);
    expect(fake.issue('2')?.comments).toHaveLength(1);
  });
});

describe('a repeat of an issue closed as not planned or as a duplicate', () => {
  it.each(['NOT_PLANNED', 'DUPLICATE'] as const)('closed as %s gets one comment and no new issue', async (stateReason) => {
    const { fake, session } = freshCase();

    await session(1);
    fake.update('1', (issue) => ({ ...issue, state: 'CLOSED', stateReason }));

    const second = await session(2);

    expect(second.bugs[0]).toMatchObject({ action: 'commented', problem: null });
    expect(fake.issueCount()).toBe(1);
    expect(fake.issue('1')?.comments).toHaveLength(1);
    expect(fake.issue('1')?.state).toBe('CLOSED');
  });
});
