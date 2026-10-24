/**
 * Tests for the reading "out-of-scope entries by routed kind"
 * (`report-kinds.ts`).
 *
 * The store cases write a fixture store of their own under the system's
 * temporary directory, through `writeBugRoutes`, the writer the triage
 * step stores its routes with, so each row's columns are the ones that
 * writer fills and not ones a case planted. None opens `.rafa/effort/`.
 *
 * Each case that expects nothing read holds a control beside it that
 * reads something, so an answer of no plan cannot come from a reader
 * that never reads.
 */
import type { RoutedEntry } from './report-kinds.js';
import type { BugKind } from '@open-tomato/rafa/report/parse';
import type { BugRouteEntry } from '@open-tomato/rafa/store/bug-routes';

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { BUG_KINDS } from '@open-tomato/rafa/report/parse';
import { writeBugRoutes } from '@open-tomato/rafa/store/bug-routes';
import { sqliteStorePath } from '@open-tomato/rafa/store/sqlite';
import { writeTriage } from '@open-tomato/rafa/store/triage';
import { afterAll, describe, expect, it } from 'bun:test';

import { countBugKinds, readBugKinds } from './report-kinds.js';

const tempRoot = mkdtempSync(join(tmpdir(), 'rafa-report-kinds-'));
let planted = 0;

afterAll(() => {
  rmSync(tempRoot, { recursive: true, force: true });
});

/** A root of its own under the suite's temporary directory, holding no store. */
function freshRoot(): string {
  planted += 1;
  return join(tempRoot, `${planted}-repo`);
}

/** Stores one session's routed entries under a root and plan, as the triage step does. */
function storeRoutes(
  root: string,
  sessionId: string,
  planStub: string | null,
  routes: readonly BugRouteEntry[],
): void {
  const result = writeBugRoutes(root, {
    dispatch: { sessionId, planStub, taskLine: 'A task' },
    routes,
  });
  if (result.appended !== routes.length) {
    throw new Error(`stored ${result.appended} of ${routes.length} routes`);
  }
}

/** A routed entry at a place in its report. */
function entry(entryIndex: number, kind: BugKind, route: BugRouteEntry['route']): BugRouteEntry {
  return { entryIndex, what: `entry ${entryIndex}`, said: kind, kind, route };
}

/**
 * One entry of every kind, each on the route the plan's routes give it,
 * and a second `bug` the check left inherited, so `bug` counts two and
 * one of seven entries is filed.
 */
const EVERY_KIND: readonly BugRouteEntry[] = [
  entry(0, 'bug', 'filed'),
  entry(1, 'own-fallout', 'repair'),
  entry(2, 'own-gap', 'follow-up'),
  entry(3, 'convention', 'pr-body'),
  entry(4, 'docs', 'docs'),
  entry(5, 'machine', 'machine'),
  entry(6, 'bug', 'inherited'),
];

/** A count of zero for every kind but those named. */
function kindCounts(counts: Partial<Record<BugKind, number>>): Record<BugKind, number> {
  return { ...Object.fromEntries(BUG_KINDS.map((kind) => [kind, 0])), ...counts } as Record<BugKind, number>;
}

describe('countBugKinds', () => {
  it('counts one plan by its routed kind, not the kind the session said', () => {
    const rows: RoutedEntry[] = [
      { planStub: 'p', kind: 'bug', route: 'filed' },
      { planStub: 'p', kind: 'bug', route: 'private' },
      { planStub: 'p', kind: 'own-gap', route: 'repair' },
      { planStub: 'p', kind: 'own-gap', route: 'follow-up' },
    ];

    expect(countBugKinds(rows)).toEqual([{
      planStub: 'p',
      entries: 4,
      kinds: kindCounts({ 'bug': 2, 'own-gap': 2 }),
      filed: 1,
      filedShare: 0.25,
    }]);
  });

  it('answers no plan for no row', () => {
    expect(countBugKinds([])).toEqual([]);
  });

  it('lists plans by stub, the rows under no plan last', () => {
    const rows: RoutedEntry[] = [
      { planStub: null, kind: 'machine', route: 'machine' },
      { planStub: 'zeta', kind: 'bug', route: 'filed' },
      { planStub: 'alpha', kind: 'docs', route: 'docs' },
    ];

    expect(countBugKinds(rows).map((plan) => plan.planStub)).toEqual(['alpha', 'zeta', null]);
    expect(countBugKinds(rows).map((plan) => plan.filedShare)).toEqual([0, 1, 0]);
  });
});

describe('readBugKinds', () => {
  it('counts a fixture plan holding every kind, and keeps another plan apart', () => {
    const root = freshRoot();
    storeRoutes(root, 's-1', 'rafa-1077-fixture', EVERY_KIND.slice(0, 4));
    storeRoutes(root, 's-2', 'rafa-1077-fixture', EVERY_KIND.slice(4));
    storeRoutes(root, 's-3', 'other-plan', [entry(0, 'bug', 'filed')]);

    expect(readBugKinds(root)).toEqual({
      plans: [
        {
          planStub: 'other-plan',
          entries: 1,
          kinds: kindCounts({ bug: 1 }),
          filed: 1,
          filedShare: 1,
        },
        {
          planStub: 'rafa-1077-fixture',
          entries: 7,
          kinds: kindCounts({
            'bug': 2,
            'own-fallout': 1,
            'own-gap': 1,
            'convention': 1,
            'docs': 1,
            'machine': 1,
          }),
          filed: 1,
          filedShare: 1 / 7,
        },
      ],
      problem: null,
    });
  });

  it('counts a route a resumed triage writes again once', () => {
    const root = freshRoot();
    storeRoutes(root, 's-1', 'p', [entry(0, 'bug', 'filed')]);
    const again = writeBugRoutes(root, {
      dispatch: { sessionId: 's-1', planStub: 'p', taskLine: 'A task' },
      routes: [entry(0, 'bug', 'filed')],
    });

    expect(again.skipped).toBe(1);
    expect(readBugKinds(root).plans.map((plan) => plan.entries)).toEqual([1]);
  });

  it('answers no plan for a store holding no bug_routes row', () => {
    const root = freshRoot();
    writeTriage(root, {
      dispatch: { sessionId: 's-1', planStub: 'p', taskLine: 'A task' },
      outcome: 'done',
      blockers: [],
      outOfScopeBugs: [{ what: 'a bug', artifact: null, security: false, kind: 'bug', extras: [] }],
    });

    // The store exists, and holds a row of another table.
    expect(existsSync(sqliteStorePath(root))).toBe(true);
    expect(readBugKinds(root)).toEqual({ plans: [], problem: null });

    // The control: one route written into that same store is read.
    storeRoutes(root, 's-1', 'p', [entry(0, 'bug', 'filed')]);
    expect(readBugKinds(root).plans).toHaveLength(1);
  });

  it('answers no plan for a root with no store, and creates none', () => {
    const root = freshRoot();

    expect(readBugKinds(root)).toEqual({ plans: [], problem: null });
    expect(existsSync(sqliteStorePath(root))).toBe(false);
  });

  it('answers a problem in place of a throw for a store it cannot read', () => {
    const root = freshRoot();
    const path = sqliteStorePath(root);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, 'not a database, at any length a header could need to be read\n'.repeat(64));

    const reading = readBugKinds(root);

    expect(reading.plans).toEqual([]);
    expect(reading.problem).toStartWith(`cannot read the bug routes in ${path}: `);
  });
});
