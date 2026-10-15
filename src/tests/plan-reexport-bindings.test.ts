import { describe, expect, test } from 'bun:test';

import * as plan from '../core/plan/index.js';
import * as declaration from '../utils/declaration.js';
import * as planStamp from '../utils/plan-stamp.js';
import * as tracker from '../utils/tracker.js';

interface CutTable {
  packages: {
    edges: { from: string; fromPackage: string; to: string }[];
  }[];
}

const PLAN_STAMP_NAMES = [
  'isStampableStub',
  'planStampLine',
  'planStubFromPath',
  'planStubFromPrompt',
  'stampPrompt',
] as const;

const TRACKER_NAMES = [
  'blockerComment',
  'escapeBlockerText',
  'repairsComment',
  'splitBlockerComment',
  'trackerPathFor',
  'unescapeBlockerText',
] as const;

function expectSameBindings(
  oldModule: Record<string, unknown>,
  names: readonly string[],
): void {
  const barrel: Record<string, unknown> = plan;
  for (const name of names) {
    expect(barrel[name]).toBeDefined();
    expect(oldModule[name]).toBe(barrel[name]);
  }
}

describe('plan re-exports are the same bindings as the plan barrel', () => {
  test('utils/plan-stamp.ts', () => {
    expectSameBindings(planStamp, PLAN_STAMP_NAMES);
    expect(Object.keys(planStamp).sort()).toEqual([...PLAN_STAMP_NAMES].sort());
  });

  test('utils/declaration.ts re-exports every runtime name it has', () => {
    const names = Object.keys(declaration);
    expect(names.length).toBeGreaterThan(0);
    expectSameBindings(declaration, names);
  });

  test('utils/tracker.ts, for the moved names', () => {
    expectSameBindings(tracker, TRACKER_NAMES);
  });
});

describe('docs/survey/cut-table.json', () => {
  test('lists no edge of @open-tomato/rafa from src/core/plan/', async () => {
    const table = (await Bun.file('docs/survey/cut-table.json').json()) as CutTable;
    const planEdges = table.packages
      .flatMap((entry) => entry.edges)
      .filter(
        (edge) => edge.fromPackage === '@open-tomato/rafa' &&
          edge.from.startsWith('src/core/plan/'),
      );
    expect(planEdges).toEqual([]);
  });
});
