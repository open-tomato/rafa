/**
 * Tests for the recheck reading of the pit stop (`pit-recheck.ts`), over
 * a planted judge seam: the real `judgeBugs` bound to a planted tracker,
 * a planted `gh` behind the board trust and a planted runner, so nothing
 * is spawned and no account is read. Every line is SPELLED here.
 *
 * Controls: the untrusted-author case judges a trusted author's bug
 * beside it, read the same way, which does run; the not-read and
 * none-filed cases count the judge's calls beside the other cases, whose
 * calls are counted at one.
 */
import type { PitFiledReading, PitJudge, PitRecheckBug, PitRecheckRow } from './pit-recheck.js';
import type { RecheckBugOptions, RecheckRun } from '../commands/bug/recheck-run.js';
import type { GhRunner } from '@open-tomato/rafa/core/git';
import type { EditableIssue, IssueRef, Tracker } from '@open-tomato/rafa/ports';

import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ghBoardTrust } from '@open-tomato/rafa-board';
import { afterAll, describe, expect, it } from 'bun:test';

import { judgeBugs } from '../commands/bug/recheck-judge.js';

import { readPitRechecks, renderPitRechecks } from './pit-recheck.js';

/** The kind of the planted tracker, which is not `local`. */
const PROBE = 'probe';

/** The test file every runnable reference names, written in the checkout. */
const TEST_FILE = 'src/a.test.ts';

const checkout = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-pit-recheck-test-')));
mkdirSync(join(checkout, 'src'), { recursive: true });
writeFileSync(join(checkout, TEST_FILE), 'import { test } from "bun:test";\ntest("a case", () => {});\n');

afterAll(() => {
  rmSync(checkout, { recursive: true, force: true });
});

/** The ref of issue `id` on the planted tracker. */
function refOf(id: number): IssueRef {
  return { opt: 0, kind: PROBE, externalId: String(id), url: null };
}

/** A tracker answering `editable` with `authors` by number. */
function plantedTracker(authors: Readonly<Record<string, string>>): Tracker {
  const refuse = (): Promise<never> => Promise.reject(new Error(`${PROBE}: not modelled`));
  return {
    kind: PROBE,
    capabilities: () => ({ projects: false, customFields: false, issueTypes: false }),
    preflight: () => Promise.resolve({ ok: true }),
    find: refuse,
    get: refuse,
    create: refuse,
    comment: refuse,
    transition: refuse,
    editable: (ref: IssueRef): Promise<EditableIssue> => Promise.resolve({
      ref,
      title: '',
      body: '',
      open: true,
      labels: [],
      author: authors[ref.externalId] ?? '',
    }),
  };
}

/** A gh answering each login's permission from `permissions`, `none` for any other. */
function plantedGh(permissions: Readonly<Record<string, string>>): GhRunner {
  return (args) => {
    const login = /collaborators\/([^/]+)\/permission$/.exec(args.join(' '))?.[1];
    if (args[0] !== 'api' || login === undefined) return Promise.resolve({ ok: false, stdout: '', stderr: 'planted gh: not modelled' });
    const permission = permissions[login] ?? 'none';
    return Promise.resolve({ ok: true, stdout: JSON.stringify({ permission, role_name: permission }), stderr: '' });
  };
}

/** A bug body with `rerun` in its `Rerun` section and `reproduce` in its `Reproduce` one. */
function bugBody(rerun: string, reproduce: string): string {
  return ['## What', '', 'It breaks.', '', '## Reproduce', '', reproduce, '', '## Rerun', '', '```', rerun, '```', ''].join('\n');
}

/** Bug `issue` as the filed-since reading carries it. */
function bug(issue: number, rerun: string, reproduce = 'run the suite twice'): PitRecheckBug {
  return { ref: refOf(issue), issue, title: `bug ${String(issue)}`, body: bugBody(rerun, reproduce) };
}

/** A read filed-since reading of `bugs`. */
function filed(bugs: readonly PitRecheckBug[]): PitFiledReading {
  return { ok: true, value: { bugs } };
}

interface Planted {
  readonly judge: PitJudge;
  /** The bugs of each judge call. */
  readonly calls: (readonly number[])[];
  /** The runner's calls. */
  readonly runs: RecheckBugOptions[];
}

/** The judge seam: `judgeBugs` over the planted tracker, gh and a runner answering `answer`. */
function plantJudge(answer: RecheckRun, authors: Readonly<Record<string, string>> = {}): Planted {
  const calls: (readonly number[])[] = [];
  const runs: RecheckBugOptions[] = [];
  const judge: PitJudge = (bugs) => {
    calls.push(bugs.map((entry) => entry.issue));
    return judgeBugs(bugs, {
      tracker: plantedTracker(authors),
      trust: () => ghBoardTrust({ gh: plantedGh({ alice: 'write', mallory: 'read' }), trustedAuthors: [], repo: 'github.com/open-tomato/rafa' }),
      checkout,
      env: { PATH: '/usr/bin:/bin' },
      secrets: [],
      runs: 3,
      timeoutMs: 7000,
      recheck: (options) => {
        runs.push(options);
        return Promise.resolve(answer);
      },
      warn: () => undefined,
    });
  };
  return { judge, calls, runs };
}

const GONE: RecheckRun = { verdict: 'gone', runs: 4, failedRuns: null, timedOutRuns: 0 };

describe('readPitRechecks and renderPitRechecks', () => {
  it('renders a prose Rerun manual with its Reproduce text on an indented line', async () => {
    const planted = plantJudge(GONE);

    const rechecks = await readPitRechecks(planted.judge, filed([bug(11, 'run it by hand and watch', 'open the board and look')]));

    expect(renderPitRechecks(rechecks)).toEqual(['Recheck #11: manual', '    open the board and look']);
    expect(planted.calls).toEqual([[11]]);
    expect(planted.runs).toEqual([]);
  });

  it('renders a failing runnable reference by a trusted author reproduces', async () => {
    const planted = plantJudge({ verdict: 'reproduces', runs: 1, failedRuns: null, timedOutRuns: 0 }, { 12: 'alice' });

    const rechecks = await readPitRechecks(planted.judge, filed([bug(12, `bun test ${TEST_FILE}`)]));

    expect(renderPitRechecks(rechecks)).toEqual(['Recheck #12: reproduces']);
    expect(planted.runs).toHaveLength(1);
  });

  it('renders an untrusted author skipped with its reason, the trusted one beside it run, in filing order, from one judge call', async () => {
    const planted = plantJudge(GONE, { 13: 'mallory', 14: 'alice' });

    const rechecks = await readPitRechecks(planted.judge, filed([bug(13, `bun test ${TEST_FILE}`), bug(14, `bun test ${TEST_FILE}`)]));
    const lines = renderPitRechecks(rechecks);

    expect(planted.calls).toEqual([[13, 14]]);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toStartWith('Recheck #13: skipped: opened by mallory, ');
    expect(lines[1]).toBe('Recheck #14: gone');
    expect(planted.runs.map((call) => call.junitDir.endsWith('issue-14'))).toEqual([true]);
  });

  it('renders a filed-since reading not read as not read with its reason, the judge never called', async () => {
    const planted = plantJudge(GONE);

    const rechecks = await readPitRechecks(planted.judge, { ok: false, reason: 'gh: HTTP 502' });

    expect(rechecks).toEqual({ ok: false, reason: 'gh: HTTP 502' });
    expect(renderPitRechecks(rechecks)).toEqual(['Recheck: not read (gh: HTTP 502).']);
    expect(planted.calls).toEqual([]);
  });

  it('renders none filed as no bug filed since, the judge never called', async () => {
    const planted = plantJudge(GONE);

    const rechecks = await readPitRechecks(planted.judge, filed([]));

    expect(renderPitRechecks(rechecks)).toEqual(['Recheck: no bug filed since.']);
    expect(planted.calls).toEqual([]);
  });

  it('reads a judge that throws as not read with its message', async () => {
    const judge: PitJudge = () => Promise.reject(new Error('the checkout is gone'));

    const rechecks = await readPitRechecks(judge, filed([bug(15, `bun test ${TEST_FILE}`)]));

    expect(renderPitRechecks(rechecks)).toEqual(['Recheck: not read (the checkout is gone).']);
  });

  it('renders stale with its reason and flaky with its failed runs', async () => {
    const stale = await readPitRechecks(plantJudge(GONE).judge, filed([bug(16, 'bun test src/gone.test.ts')]));
    const flakyRow: PitRecheckRow = { issue: 17, verdict: 'flaky', runs: 4, failedRuns: 2, reason: null, reproduce: null };

    expect(renderPitRechecks(stale)).toEqual(['Recheck #16: stale: no file src/gone.test.ts in the checkout']);
    expect(renderPitRechecks({ ok: true, value: [flakyRow] })).toEqual(['Recheck #17: flaky: 2 of 4 runs failed']);
  });
});
