/**
 * Tests for the kind routing (`src/triage/kind-route.ts`), driven
 * through its one call in `triageReport` so the routing and the bug
 * channel it hands back to are read together.
 *
 * Both trackers are fakes that record every call, and the strict one
 * also rejects every call. A case for every kind but `bug` hands the
 * strict fake as both trackers and asserts it recorded nothing; each sits
 * beside a control that the same fake records a call made of it: the
 * `bug` case, the unconfirmed `own-` claims, kinds left out and the
 * security rule all reach a tracker.
 *
 * The named test is never run: `runTest` is a stub answering from a map
 * by commit and recording each run. The repo root, the plan's tracker
 * file and the store are made under one temporary directory this file
 * creates and removes; a repair is read back off the tracker file and a
 * `docs` row off the fixture store.
 */
import type { BaseRunAnswer, NamedTest } from './base-run.js';
import type { KindRouteOptions } from './kind-route.js';
import type { TriageOptions, TriageResult } from './triage.js';
import type { IssueRef, Tracker, TrackerKind } from '@open-tomato/rafa/ports';
import type { BugKind, ReportBug, TaskReport } from '@open-tomato/rafa/report/parse';
import type { FindingsDispatch } from '@open-tomato/rafa/store/findings';

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { readStaleDocsForPlan } from '@open-tomato/rafa/store/stale-docs';
import { findNextTask } from '@open-tomato/rafa/utils/tracker';
import { ABSENT } from '@open-tomato/rafa-board/refs/stamp';

import { docsWhereOf } from './kind-route.js';
import { LEFTOVER_MARKER } from './leftover-repair.js';
import { triageReport } from './triage.js';

const tempBase = mkdtempSync(join(tmpdir(), 'rafa-kind-route-'));
let rootCount = 0;

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

const TRACKER_TEXT = [
  '# Plan: demo',
  '',
  '- [x] Ship the parser',
  '- [x] Wire the loop  {agent=loop-implementer}',
  '- [ ] Write the docs',
  '',
].join('\n');

/** The open task of {@link TRACKER_TEXT}, counting from zero. */
const OPEN_LINE = 4;

/** The ticked task line the report came from. */
const TASK_LINE = 3;

const DISPATCH: FindingsDispatch = { sessionId: 'session-1', planStub: 'demo', taskLine: 'Wire the loop' };

/** The plan's base and head commits the stub runs answer for. */
const BASE = 'base0000000000000000';
const HEAD = 'head0000000000000000';

/** The test file and case an entry names, as `testFailureOf` reads them. */
const TEST_FILE = 'src/a.test.ts';
const TEST_CASE = 'config > reads the file';
const TEST_ARTIFACT = `${TEST_FILE} > ${TEST_CASE}`;

/** One call a fake tracker received. */
type TrackerCall = readonly [method: string, argument: unknown];

/** A fake tracker and the calls it received. */
interface Fake {
  readonly tracker: Tracker;
  readonly calls: TrackerCall[];
}

/** The reference a recording fake's `create` answers. */
function refOf(kind: TrackerKind): IssueRef {
  return { opt: 0, kind, externalId: '7', url: null };
}

/**
 * A fake that records every call. Strict, every call rejects, so a case
 * whose route reaches it both records the call and fails it; otherwise
 * `find` answers none and `create` answers {@link refOf}.
 */
function fakeTracker(kind: TrackerKind, strict: boolean): Fake {
  const calls: TrackerCall[] = [];
  const record = <T>(method: string, argument: unknown, value: T): Promise<T> => {
    calls.push([method, argument]);
    return strict
      ? Promise.reject(new Error(`the strict fake was called: ${method}`))
      : Promise.resolve(value);
  };
  const tracker: Tracker = {
    kind,
    capabilities: () => ({ projects: false, customFields: false, issueTypes: false }),
    preflight: () => record('preflight', null, { ok: true as const }),
    find: (query) => record('find', query, []),
    get: (ref) => record('get', ref, Promise.reject(new Error('no issue'))) as never,
    create: (draft) => record('create', draft, refOf(kind)),
    comment: (ref, body) => record('comment', { ref, body }, undefined),
    transition: (ref, state) => record('transition', { ref, state }, null as never),
    openIssues: (type) => record('openIssues', type, []),
    edit: (ref, change) => record('edit', { ref, change }, undefined),
  };
  return { tracker, calls };
}

/** One recorded run of the stub runner. */
type Run = readonly [commit: string, test: NamedTest];

/** The stub runner and the runs it made. */
interface Runner {
  readonly runTest: KindRouteOptions['runTest'];
  readonly runs: Run[];
}

/** A runner answering `answers[commit]`, or `unrunnable` for a commit it does not hold. */
function stubRunner(answers: Readonly<Record<string, BaseRunAnswer['answer']>>): Runner {
  const runs: Run[] = [];
  const runTest = (commit: string, test: NamedTest): Promise<BaseRunAnswer> => {
    runs.push([commit, test]);
    const answer = answers[commit];
    if (answer === undefined || answer === 'unrunnable') {
      return Promise.resolve({ answer: 'unrunnable', problem: `no run at ${commit}` });
    }
    return Promise.resolve({ answer });
  };
  return { runTest, runs };
}

/** The plan's files every case reads. */
const PLAN_FILES = ['src/config.ts', 'src/a.test.ts'];

/** Kind options over `runner`, the plan's base and files read, a cap of `retries`. */
function kindsOf(runner: Runner, overrides: Partial<KindRouteOptions> = {}): KindRouteOptions {
  return {
    planBase: { ok: true, base: 'main', sha: BASE },
    head: HEAD,
    planFiles: { ok: true, files: PLAN_FILES },
    runTest: runner.runTest,
    retries: 2,
    ...overrides,
  };
}

/** One out-of-scope entry, public unless `security` says otherwise. */
function entry(kind: BugKind, what: string, artifact: string | null = null, security: boolean | null = false): ReportBug {
  return { what, artifact, security, kind, extras: [] };
}

/** A report holding `bugs` and nothing else. */
function reportOf(bugs: readonly ReportBug[]): TaskReport {
  return {
    status: 'done',
    feedback: null,
    findings: [],
    skillsUsed: [],
    blockers: [],
    outOfScopeBugs: bugs,
    changes: [],
    staleDocs: [],
    extras: [],
  };
}

/** One case's root and tracker file. */
interface Fixture {
  readonly root: string;
  readonly trackerPath: string;
}

/** A fresh root holding the plan's tracker file. */
function fixture(): Fixture {
  const root = join(tempBase, `root-${rootCount}`);
  rootCount += 1;
  mkdirSync(root, { recursive: true });
  const trackerPath = join(root, 'PLAN_TRACKER-demo.md');
  writeFileSync(trackerPath, TRACKER_TEXT);
  return { root, trackerPath };
}

/** What one triage was handed and what it answered. */
interface Triaged {
  readonly fixture: Fixture;
  readonly result: TriageResult;
}

/** Triages `bugs` with `kinds`, both trackers the given fakes. */
async function triage(
  bugs: readonly ReportBug[],
  kinds: KindRouteOptions | undefined,
  trackers: { readonly public: Fake; readonly private: Fake },
  extra: Partial<TriageOptions> = {},
): Promise<Triaged> {
  const at = fixture();
  const result = await triageReport({
    repoRoot: at.root,
    trackerPath: at.trackerPath,
    lineNum: TASK_LINE,
    dispatch: DISPATCH,
    outcome: 'done',
    report: reportOf(bugs),
    tracker: trackers.public.tracker,
    privateTracker: trackers.private.tracker,
    secrets: [],
    verifyRefs: () => Promise.resolve(ABSENT),
    home: '/home/nobody',
    kinds,
    ...extra,
  });
  return { fixture: at, result };
}

/** A strict public and private fake, the private one a `local` tracker. */
function strictPair(): { readonly public: Fake; readonly private: Fake } {
  return { public: fakeTracker('github', true), private: fakeTracker('local', true) };
}

/** A recording public and private fake, the private one a `local` tracker. */
function recordingPair(): { readonly public: Fake; readonly private: Fake } {
  return { public: fakeTracker('github', false), private: fakeTracker('local', false) };
}

/** The only bug row of `result`. */
function onlyRow(result: TriageResult): TriageResult['bugs'][number] {
  expect(result.bugs).toHaveLength(1);
  return result.bugs[0]!;
}

describe('routeByKind through triageReport: no tracker call for any kind but bug', () => {
  const cases: readonly (readonly [string, ReportBug, string, string, BugKind])[] = [
    ['convention', entry('convention', 'src/start.ts is past the 800-line ceiling'), 'public', 'pr-body', 'convention'],
    ['docs', entry('docs', 'context/triage.md still names three channels'), 'docs', 'docs', 'docs'],
    ['machine', entry('machine', 'this machine has no xcrun'), 'machine', 'skipped', 'machine'],
    ['own-fallout', entry('own-fallout', 'an earlier task turned the case red', TEST_ARTIFACT), 'public', 'repair', 'own-fallout'],
    ['own-gap', entry('own-gap', 'src/config.ts reads no default'), 'public', 'repair', 'own-gap'],
  ];

  for (const [name, bug, channel, action, kind] of cases) {
    it(`routes the ${name} entry to ${action} with the strict fakes untouched`, async () => {
      const trackers = strictPair();
      const runner = stubRunner({ [BASE]: 'green', [HEAD]: 'red' });

      const { result } = await triage([bug], kindsOf(runner), trackers);

      const row = onlyRow(result);
      expect(trackers.public.calls).toEqual([]);
      expect(trackers.private.calls).toEqual([]);
      expect(row).toMatchObject({ index: 0, channel, action, kind, ref: null });
    });
  }

  it('control: a bug entry reaches the public fake, which records the call', async () => {
    const trackers = strictPair();

    const { result } = await triage([entry('bug', 'the parser drops a key')], kindsOf(stubRunner({})), trackers);

    expect(trackers.public.calls.map(([method]) => method)).toEqual(['create']);
    expect(onlyRow(result)).toMatchObject({ action: 'failed', channel: 'public', kind: 'bug' });
  });

  it('control: a bug entry with a recording fake is filed once, under the kind bug', async () => {
    const trackers = recordingPair();

    const { result } = await triage([entry('bug', 'the parser drops a key')], kindsOf(stubRunner({})), trackers);

    expect(trackers.public.calls.map(([method]) => method)).toEqual(['create']);
    expect(trackers.private.calls).toEqual([]);
    expect(onlyRow(result)).toMatchObject({ action: 'filed', channel: 'public', kind: 'bug' });
  });
});

describe('routeByKind: claims the check does not confirm are filed as bugs', () => {
  it('files an own-fallout claim whose case is green on the head, running no base', async () => {
    const trackers = recordingPair();
    const runner = stubRunner({ [BASE]: 'green', [HEAD]: 'green' });

    const { result } = await triage([entry('own-fallout', 'it broke', TEST_ARTIFACT)], kindsOf(runner), trackers);

    expect(onlyRow(result)).toMatchObject({ action: 'filed', kind: 'bug' });
    expect(trackers.public.calls.map(([method]) => method)).toContain('create');
    expect(runner.runs).toEqual([[HEAD, { file: TEST_FILE, name: TEST_CASE }]]);
  });

  it('files an own-gap claim naming a file outside the plan\'s commits', async () => {
    const trackers = recordingPair();

    const { result } = await triage([entry('own-gap', 'src/other.ts was left half done')], kindsOf(stubRunner({})), trackers);

    expect(onlyRow(result)).toMatchObject({ action: 'filed', kind: 'bug' });
    expect(trackers.public.calls.map(([method]) => method)).toEqual(['create']);
  });

  it('files a named case whose plan base was not read, having run the head alone', async () => {
    const trackers = recordingPair();
    const runner = stubRunner({ [HEAD]: 'red' });
    const kinds = kindsOf(runner, { planBase: { ok: false, base: 'main', problem: 'no origin/main' } });

    const { result } = await triage([entry('own-fallout', 'it broke', TEST_ARTIFACT)], kinds, trackers);

    expect(onlyRow(result)).toMatchObject({ action: 'filed', kind: 'bug' });
    expect(runner.runs.map(([commit]) => commit)).toEqual([HEAD]);
  });

  it('files a named case whose runner throws, rather than rejecting', async () => {
    const trackers = recordingPair();
    const kinds = kindsOf(stubRunner({}), { runTest: () => Promise.reject(new Error('spawn failed')) });

    const { result } = await triage([entry('own-fallout', 'it broke', TEST_ARTIFACT)], kinds, trackers);

    expect(onlyRow(result)).toMatchObject({ action: 'filed', kind: 'bug' });
  });

  it('files a named case with no head commit read, running nothing', async () => {
    const trackers = recordingPair();
    const runner = stubRunner({ [BASE]: 'green', [HEAD]: 'red' });

    const { result } = await triage([entry('own-fallout', 'it broke', TEST_ARTIFACT)], kindsOf(runner, { head: null }), trackers);

    expect(onlyRow(result)).toMatchObject({ action: 'filed', kind: 'bug' });
    expect(runner.runs).toEqual([]);
  });
});

describe('routeByKind: the check finds what a session called a bug', () => {
  it('repairs a bug whose case is green on the base and red on the head, head run first', async () => {
    const trackers = strictPair();
    const runner = stubRunner({ [BASE]: 'green', [HEAD]: 'red' });

    const { result } = await triage([entry('bug', 'the case went red', TEST_ARTIFACT)], kindsOf(runner), trackers);

    expect(onlyRow(result)).toMatchObject({ action: 'repair', kind: 'own-fallout' });
    expect(trackers.public.calls).toEqual([]);
    expect(runner.runs.map(([commit]) => commit)).toEqual([HEAD, BASE]);
  });

  it('answers a case red on the base and the head as inherited, creating nothing', async () => {
    const trackers = recordingPair();
    const runner = stubRunner({ [BASE]: 'red', [HEAD]: 'red' });

    const { result } = await triage([entry('bug', 'the case is red', TEST_ARTIFACT)], kindsOf(runner), trackers);

    expect(onlyRow(result)).toMatchObject({ action: 'inherited', kind: 'bug' });
    expect(trackers.public.calls.map(([method]) => method)).not.toContain('create');
  });

  it('runs no test for a docs, convention or machine entry that names one', async () => {
    const runner = stubRunner({ [BASE]: 'green', [HEAD]: 'red' });
    const bugs = (['docs', 'convention', 'machine'] as const).map((kind) => entry(kind, 'see the case', TEST_ARTIFACT));

    const { result } = await triage(bugs, kindsOf(runner), strictPair());

    expect(result.bugs.map((row) => row.kind)).toEqual(['docs', 'convention', 'machine']);
    expect(runner.runs).toEqual([]);
  });
});

describe('routeByKind: the repair task and its cap', () => {
  it('inserts the repair directly above the first open task, marked and declared', async () => {
    const runner = stubRunner({ [BASE]: 'green', [HEAD]: 'red' });

    const { fixture: at, result } = await triage([entry('own-fallout', 'the case went red', TEST_ARTIFACT)], kindsOf(runner), strictPair());

    const lines = readFileSync(at.trackerPath, 'utf8').split('\n');
    expect(onlyRow(result).repairLine).toBe(OPEN_LINE);
    expect(lines[OPEN_LINE]).toStartWith('- [BLOCKED] Repair the own-fallout leftover: the case went red');
    expect(lines[OPEN_LINE]).toContain(`${LEFTOVER_MARKER}  {agent=build-error-resolver}`);
    expect(lines[OPEN_LINE + 1]).toBe('- [ ] Write the docs');
    expect(findNextTask(readFileSync(at.trackerPath, 'utf8'))?.lineNum).toBe(OPEN_LINE);
  });

  it('answers follow-up and leaves the tracker file alone under the default cap of false', async () => {
    const kinds = kindsOf(stubRunner({}), { retries: false });

    const { fixture: at, result } = await triage([entry('own-gap', 'src/config.ts reads no default')], kinds, strictPair());

    expect(onlyRow(result)).toMatchObject({ action: 'follow-up', kind: 'own-gap', problem: null });
    expect(readFileSync(at.trackerPath, 'utf8')).toBe(TRACKER_TEXT);
  });

  it('inserts one repair under a cap of one and makes the second leftover a follow-up', async () => {
    const kinds = kindsOf(stubRunner({}), { retries: 1 });
    const bugs = [entry('own-gap', 'src/config.ts reads no default'), entry('own-gap', 'src/config.ts writes no default')];

    const { fixture: at, result } = await triage(bugs, kinds, strictPair());

    expect(result.bugs.map((row) => row.action)).toEqual(['repair', 'follow-up']);
    expect(readFileSync(at.trackerPath, 'utf8').split(LEFTOVER_MARKER)).toHaveLength(2);
  });

  it('answers follow-up naming the failure when the tracker file cannot be read', async () => {
    const extra = { trackerPath: join(tempBase, 'no-such-tracker.md') };

    const { result } = await triage([entry('own-gap', 'src/config.ts reads no default')], kindsOf(stubRunner({})), strictPair(), extra);

    const row = onlyRow(result);
    expect(row.action).toBe('follow-up');
    expect(row.problem).toContain('the repair task was not inserted');
  });

  it('redacts a named secret out of the repair line', async () => {
    const secrets = [{ name: 'GITHUB_TOKEN', value: 'ghp_secretvalue123' }];

    const { fixture: at } = await triage(
      [entry('own-gap', 'src/config.ts logs ghp_secretvalue123')],
      kindsOf(stubRunner({})),
      strictPair(),
      { secrets },
    );

    const text = readFileSync(at.trackerPath, 'utf8');
    expect(text).not.toContain('ghp_secretvalue123');
    expect(text).toContain('[redacted: GITHUB_TOKEN]');
  });
});

describe('routeByKind: the docs row', () => {
  it('stores a docs entry as a sighting whose where is the first path it names', async () => {
    const bug = entry('docs', 'context/triage.md names three channels, as README.md does');

    const { fixture: at } = await triage([bug], kindsOf(stubRunner({})), strictPair());

    const rows = readStaleDocsForPlan(at.root, 'demo');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: 'sighting', where: 'context/triage.md', what: bug.what, sessionId: 'session-1' });
  });

  it('reads the where from the artifact when the what names no path, and null when neither does', () => {
    expect(docsWhereOf({ what: 'a page is stale', artifact: 'see docs/guide.md:12' })).toBe('docs/guide.md');
    expect(docsWhereOf({ what: 'a page is stale', artifact: null })).toBeNull();
  });
});

describe('routeByKind: the security rule and kinds left out', () => {
  it('sends a security convention entry to the private fake, the public one untouched', async () => {
    const trackers = recordingPair();

    const { result } = await triage([entry('convention', 'a token logged in src/start.ts', null, true)], kindsOf(stubRunner({})), trackers);

    expect(onlyRow(result)).toMatchObject({ channel: 'private', action: 'filed', kind: 'convention' });
    expect(trackers.public.calls).toEqual([]);
    expect(trackers.private.calls.map(([method]) => method)).toEqual(['create']);
  });

  it('sends an own-fallout entry with no flag to the private fake, running no test and adding no repair', async () => {
    const trackers = recordingPair();
    const runner = stubRunner({ [BASE]: 'green', [HEAD]: 'red' });

    const { fixture: at, result } = await triage([entry('own-fallout', 'it broke', TEST_ARTIFACT, null)], kindsOf(runner), trackers);

    expect(onlyRow(result)).toMatchObject({ channel: 'private', kind: 'own-fallout' });
    expect(runner.runs).toEqual([]);
    expect(readFileSync(at.trackerPath, 'utf8')).toBe(TRACKER_TEXT);
  });

  it('files a convention entry as a bug when kinds are left out, its row carrying no kind', async () => {
    const trackers = recordingPair();

    const { result } = await triage([entry('convention', 'src/start.ts is past the 800-line ceiling')], undefined, trackers);

    const row = onlyRow(result);
    expect(row).toMatchObject({ channel: 'public', action: 'filed' });
    expect(row.kind).toBeUndefined();
    expect(trackers.public.calls.map(([method]) => method)).toEqual(['create']);
  });
});
