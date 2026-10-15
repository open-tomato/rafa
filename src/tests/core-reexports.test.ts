/**
 * The names `src/tiers/routing.ts` and `src/board/spec-review.ts` re-export
 * are core's own bindings, the learning library still declares its own
 * contract, and the cut table lists no upward edge from core's config or
 * ports folders.
 */
import { describe, expect, test } from 'bun:test';

import * as specReview from '../board/spec-review.js';
import * as core from '../core/config/index.js';
import * as learning from '../learning/index.js';
import * as ports from '../ports/spec-review.js';
import * as routing from '../tiers/routing.js';

const CORE_PACKAGE = '@open-tomato/rafa';

interface CutEdge {
  readonly from: string;
  readonly fromPackage: string;
}

interface CutPackage {
  readonly name: string;
  readonly edges: readonly CutEdge[];
}

describe('routing re-exports', () => {
  test('DEFAULT_ROUTES and DEFAULT_ROUTING are the core bindings', () => {
    expect(routing.DEFAULT_ROUTES).toBe(core.DEFAULT_ROUTES);
    expect(routing.DEFAULT_ROUTING).toBe(core.DEFAULT_ROUTING);
  });
});

describe('spec-review re-exports', () => {
  test('the two value names are the ports bindings', () => {
    expect(specReview.SPEC_REVIEW_VERDICTS).toBe(ports.SPEC_REVIEW_VERDICTS);
    expect(specReview.SPEC_REVIEW_ANSWERS).toBe(ports.SPEC_REVIEW_ANSWERS);
  });
});

describe('learning library', () => {
  test('exports its own bounds', () => {
    expect(learning.CONFIDENCE_MIN).toBeNumber();
    expect(learning.CONFIDENCE_MAX).toBeNumber();
  });

  test('declares the three contract types in its own files', async () => {
    const index = await Bun.file(new URL('../learning/index.ts', import.meta.url)).text();
    const types = await Bun.file(new URL('../learning/types.ts', import.meta.url)).text();
    const identity = await Bun.file(new URL('../learning/identity.ts', import.meta.url)).text();
    expect(index).toMatch(/BlessedBundle[\s\S]*?from '\.\/types\.js'/);
    expect(index).toMatch(/SyncPayload[\s\S]*?from '\.\/types\.js'/);
    expect(index).toMatch(/MergeResult[\s\S]*?from '\.\/types\.js'/);
    expect(index).toMatch(/CONFIDENCE_MIN[\s\S]*?from '\.\/identity\.js'/);
    for (const name of ['BlessedBundle', 'SyncPayload', 'MergeResult']) {
      expect(types).toMatch(new RegExp(`export (interface|type) ${name}\\b`));
    }
    for (const name of ['CONFIDENCE_MIN', 'CONFIDENCE_MAX']) {
      expect(identity).toMatch(new RegExp(`export const ${name}\\b`));
    }
  });
});

describe('cut table', () => {
  test('lists no edge of the core package from config or ports', async () => {
    const table = (await Bun.file(
      new URL('../../docs/survey/cut-table.json', import.meta.url),
    ).json()) as { packages: readonly CutPackage[] };
    const pkg = table.packages.find((entry) => entry.name === CORE_PACKAGE);
    expect(pkg).toBeDefined();
    const offending = (pkg?.edges ?? []).filter(
      (edge) => edge.from.startsWith('src/core/config/') || edge.from.startsWith('src/ports/'),
    );
    expect(offending).toEqual([]);
  });
});
