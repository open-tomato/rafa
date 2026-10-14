/**
 * Tests for the kind routing's readings and route rows in `loop start`'s
 * triage (`start/triage-kinds.ts`).
 *
 * Git is a stub answering by argv and recording each call, and the named
 * test runner a stub recording each run, so no case spawns anything. The
 * store is a fixture store under one temporary directory this file makes
 * and removes, read back through `readBugRoutesForPlan`.
 *
 * Each reading that could be a false negative sits beside its control:
 * an entry with no `kind` key read as null beside the same entry with
 * one; a skipped entry writing no row beside a routed one writing its
 * row; a refused write answering a warning beside the same routes
 * written; a base not read listing no files beside a base read listing
 * them.
 */
import type { StartKindOptions } from './triage-kinds.js';
import type { GitResult } from '../core/git/index.js';
import type { BugRouteEntry } from '../effort/store/bug-routes.js';
import type { FindingsDispatch } from '../effort/store/findings.js';
import type { ReportBug } from '../report/parse.js';
import type { BaseRunAnswer, NamedTest } from '../triage/base-run.js';
import type { BugTriage } from '../triage/triage.js';

import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { readBugRoutesForPlan } from '../effort/store/bug-routes.js';
import { sqliteStorePath } from '../effort/store/sqlite.js';
import { parseReport } from '../report/parse.js';

import {
  bugRouteEntriesOf,
  createKindReader,
  routeOf,
  saidKindsOf,
  storeBugRoutes,
} from './triage-kinds.js';

const tempBase = mkdtempSync(join(tmpdir(), 'rafa-start-triage-kinds-'));
let rootCount = 0;

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** A fresh repo root under the temporary directory. */
function freshRoot(): string {
  const root = join(tempBase, `root-${rootCount}`);
  rootCount += 1;
  mkdirSync(root, { recursive: true });
  return root;
}

const BASE = 'base0000000000000000';
const HEAD = 'head0000000000000000';

const DISPATCH: FindingsDispatch = { sessionId: 'session-1', planStub: 'demo', taskLine: 'Wire the loop' };

/** A git stub: the answers by space-joined argv, and every call it took. */
interface GitStub {
  readonly git: (args: readonly string[]) => GitResult;
  readonly calls: string[];
}

/** A stub answering `answers[argv]`, and a failure for any argv it does not hold. */
function gitStub(answers: Readonly<Record<string, string>>): GitStub {
  const calls: string[] = [];
  return {
    calls,
    git: (args) => {
      const key = args.join(' ');
      calls.push(key);
      const stdout = answers[key];
      return stdout === undefined
        ? { ok: false, stdout: '', stderr: `fatal: no answer for ${key}` }
        : { ok: true, stdout, stderr: '' };
    },
  };
}

/** The answers of a checkout on a plan branch whose base is `origin/integration`. */
const PLAN_GIT: Readonly<Record<string, string>> = {
  'rev-parse HEAD': `${HEAD}\n`,
  'merge-base HEAD refs/remotes/origin/integration': `${BASE}\n`,
  [`diff --name-only -z ${BASE} HEAD --`]: 'src/config.ts\0src/a.test.ts\0',
};

/** A runner stub answering `red` at every commit, and the runs it made. */
function redRunner(): { readonly runTest: NonNullable<StartKindOptions['runTest']>; readonly runs: string[] } {
  const runs: string[] = [];
  return {
    runs,
    runTest: (commit: string, test: NamedTest): Promise<BaseRunAnswer> => {
      runs.push(`${commit} ${test.file} ${test.name}`);
      return Promise.resolve({ answer: 'red' });
    },
  };
}

describe('the readings a report is routed by', () => {
  it('read the base branch of pr.base, the head and the plan\'s files, with the run\'s retry count as the cap', () => {
    const stub = gitStub(PLAN_GIT);
    const read = createKindReader({ checkout: '/checkout', prBase: 'integration', retries: 2, git: stub.git, runTest: redRunner().runTest });

    const options = read();

    expect(options.planBase).toEqual({ ok: true, base: 'integration', sha: BASE });
    expect(options.head).toBe(HEAD);
    expect(options.planFiles).toEqual({ ok: true, files: ['src/config.ts', 'src/a.test.ts'] });
    expect(options.retries).toBe(2);
  });

  it('list no files and run no diff for a base not read, where the same reader with the ref listed does', () => {
    const missing = gitStub({ 'rev-parse HEAD': HEAD });
    const unread = createKindReader({ checkout: '/checkout', prBase: 'integration', retries: false, git: missing.git })();

    expect(unread.planBase.ok).toBe(false);
    expect(unread.planFiles.ok).toBe(false);
    expect(missing.calls.some((call) => call.startsWith('diff '))).toBe(false);

    const listed = gitStub(PLAN_GIT);
    createKindReader({ checkout: '/checkout', prBase: 'integration', retries: false, git: listed.git })();
    expect(listed.calls.some((call) => call.startsWith('diff '))).toBe(true);
  });

  it('read a head git answers no commit for as null', () => {
    const stub = gitStub({});
    expect(createKindReader({ checkout: '/checkout', prBase: 'integration', retries: false, git: stub.git })().head).toBeNull();
  });

  it('resolve an unset pr.base once per run, through origin\'s HEAD, and read the merge base again for each report', () => {
    const stub = gitStub({
      'symbolic-ref --quiet --short refs/remotes/origin/HEAD': 'origin/trunk\n',
      'merge-base HEAD refs/remotes/origin/trunk': BASE,
    });
    const read = createKindReader({ checkout: '/checkout', prBase: null, retries: false, git: stub.git });

    expect(read().planBase).toEqual({ ok: true, base: 'trunk', sha: BASE });
    read();

    expect(stub.calls.filter((call) => call.startsWith('symbolic-ref'))).toHaveLength(1);
    expect(stub.calls.filter((call) => call.startsWith('merge-base'))).toHaveLength(2);
  });

  it('keep one answer per commit, file and case within a report, and run again for the next report', async () => {
    const runner = redRunner();
    const read = createKindReader({ checkout: '/checkout', prBase: 'integration', retries: false, git: gitStub(PLAN_GIT).git, runTest: runner.runTest });
    const test: NamedTest = { file: 'src/a.test.ts', name: 'config > reads the file' };

    const first = read();
    await first.runTest(HEAD, test);
    await first.runTest(HEAD, test);
    await first.runTest(BASE, test);
    expect(runner.runs).toHaveLength(2);

    await read().runTest(HEAD, test);
    expect(runner.runs).toHaveLength(3);
  });
});

/** A report block's body holding `entries` as its out-of-scope list. */
function blockBody(entries: readonly string[]): string {
  return ['status: done', 'out_of_scope_bugs:', ...entries].join('\n');
}

describe('the kind each entry was said as', () => {
  it('is null for an entry with no kind key, where the same entry with one reads that kind', () => {
    const body = blockBody([
      '  - what: "a"',
      '    security: false',
      '  - what: "b"',
      '    security: false',
      '    kind: own-gap',
    ]);
    expect(saidKindsOf(body)).toEqual([null, 'own-gap']);
  });

  it('is null for a value none of the six, which the parser reads as bug', () => {
    expect(saidKindsOf(blockBody(['  - what: "a"', '    kind: oops']))).toEqual([null]);
  });

  it('keeps the parsed list\'s order, an entry the parser drops dropped here too', () => {
    const output = [
      '```rafa:report',
      blockBody([
        '  - "not a mapping"',
        '  - what: "kept"',
        '    security: false',
        '    kind: convention',
      ]),
      '```',
    ].join('\n');
    const reading = parseReport(output);
    if (!reading.present) throw new Error('the fixture report was not read');

    expect(reading.report.outOfScopeBugs).toHaveLength(1);
    expect(saidKindsOf(reading.block.body)).toEqual(['convention']);
  });

  it('is none for a body that does not read, or holds no list', () => {
    expect(saidKindsOf('a: [unclosed')).toEqual([]);
    expect(saidKindsOf('status: done')).toEqual([]);
  });
});

/** A triage row for entry `index`, its unset fields null. */
function row(index: number, fields: Partial<BugTriage>): BugTriage {
  return {
    index,
    channel: 'public',
    action: 'filed',
    ref: null,
    foundBy: null,
    stored: null,
    problem: null,
    ...fields,
  };
}

/** A parsed entry saying `what` under `kind`. */
function entry(what: string | null, kind: ReportBug['kind'] = 'bug'): ReportBug {
  return { what, artifact: null, security: false, kind, extras: [] };
}

describe('the route of an entry', () => {
  it('is where the triage sent it, by channel first and then by action', () => {
    expect(routeOf(row(0, { channel: 'machine', action: 'skipped' }))).toBe('machine');
    expect(routeOf(row(0, { channel: 'private', action: 'failed' }))).toBe('private');
    expect(routeOf(row(0, { channel: 'docs', action: 'docs' }))).toBe('docs');
    expect(routeOf(row(0, { action: 'inherited' }))).toBe('inherited');
    expect(routeOf(row(0, { action: 'repair' }))).toBe('repair');
    expect(routeOf(row(0, { action: 'follow-up' }))).toBe('follow-up');
    expect(routeOf(row(0, { action: 'pr-body' }))).toBe('pr-body');
    expect(routeOf(row(0, { action: 'filed' }))).toBe('filed');
    expect(routeOf(row(0, { action: 'commented' }))).toBe('filed');
    expect(routeOf(row(0, { action: 'failed' }))).toBe('filed');
  });

  it('is none for an entry skipped on a tracked channel, which had no what', () => {
    expect(routeOf(row(0, { action: 'skipped' }))).toBeNull();
  });
});

describe('the rows of a triage', () => {
  it('hold one entry per routed entry, its kind the routed one, else machine on the machine channel, else the parsed one', () => {
    const report = { outOfScopeBugs: [entry('a', 'own-fallout'), entry('b'), entry('c', 'convention'), entry(null)] };
    const result = {
      bugs: [
        row(0, { action: 'repair', kind: 'own-fallout' }),
        row(1, { channel: 'machine', action: 'skipped' }),
        row(2, { action: 'filed' }),
        row(3, { action: 'skipped' }),
      ],
    };

    expect(bugRouteEntriesOf(result, report, ['own-fallout', null, 'convention'])).toEqual([
      { entryIndex: 0, what: 'a', said: 'own-fallout', kind: 'own-fallout', route: 'repair' },
      { entryIndex: 1, what: 'b', said: null, kind: 'machine', route: 'machine' },
      { entryIndex: 2, what: 'c', said: 'convention', kind: 'convention', route: 'filed' },
    ]);
  });
});

/** Routes of one report, two entries. */
const ROUTES: readonly BugRouteEntry[] = [
  { entryIndex: 0, what: 'the leftover', said: 'own-fallout', kind: 'own-fallout', route: 'repair' },
  { entryIndex: 1, what: 'a real bug', said: null, kind: 'bug', route: 'filed' },
];

describe('storing the rows', () => {
  it('writes each under the dispatch, read back under the plan stub in order, and warns of nothing', () => {
    const root = freshRoot();

    expect(storeBugRoutes(root, DISPATCH, ROUTES)).toEqual([]);

    const stored = readBugRoutesForPlan(root, 'demo');
    expect(stored.map(({ entryIndex, what, said, kind, route }) => ({ entryIndex, what, said, kind, route }))).toEqual([...ROUTES]);
    expect(stored.every((read) => read.sessionId === 'session-1' && read.taskLine === 'Wire the loop')).toBe(true);
  });

  it('opens nothing for no routes', () => {
    const root = freshRoot();
    expect(storeBugRoutes(root, DISPATCH, [])).toEqual([]);
    expect(existsSync(sqliteStorePath(root))).toBe(false);
  });

  it('answers one warning for a dispatch the store refuses, writing nothing, where the same routes under a usable one are written', () => {
    const root = freshRoot();

    const warnings = storeBugRoutes(root, { ...DISPATCH, sessionId: '' }, ROUTES);

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toStartWith('out_of_scope_bugs: their routes were not stored: ');
    expect(readBugRoutesForPlan(root, 'demo')).toEqual([]);
  });

  it('answers one warning per entry the store refuses, and writes the others', () => {
    const root = freshRoot();

    const warnings = storeBugRoutes(root, DISPATCH, [{ ...ROUTES[0]!, what: '   ' }, ROUTES[1]!]);

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('bug routes[0].what');
    expect(readBugRoutesForPlan(root, 'demo').map((read) => read.what)).toEqual(['a real bug']);
  });
});
