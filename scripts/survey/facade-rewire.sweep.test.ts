/**
 * The rewire guard (#808, pass 3): once a package is rewired, no non-test
 * file outside it imports one of its files by relative path except the
 * files its {@link REWIRED} row names, and each named file still does. A
 * sweep, since it lists the tracked files with `git ls-files`. The rewire
 * stage of each package adds its row; effort's is the first.
 */
import { spawnSync } from 'node:child_process';
import { posix } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, setDefaultTimeout } from 'bun:test';

import { SWEEP_TIMEOUT } from '../../src/tests/sweep-timeout.js';
import { readImporters, readPackageFiles, readPackageStatements } from '../codemod/rewire-groups';

setDefaultTimeout(SWEEP_TIMEOUT);

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** Why a rewired package's file is still imported by path. */
type KeptGroup = 'backEdge' | 'declarationGraph' | 'libraryChunks' | 'loadCycle';

/** One rewired package and the files allowed to import it by path. */
interface RewiredRow {
  /** The package, such as `rafa-effort`. */
  readonly packageName: string;
  /** Each allowed file with the group that keeps it on its path. */
  readonly allowed: Readonly<Record<string, KeptGroup>>;
}

/**
 * One row per rewired package. Effort's six load-cycle files would put the
 * facade on a cycle through effort if they imported it by name, and its two
 * declaration-graph files are reached from `src/config/index.ts`, whose
 * declarations ship as `dist/config/*.d.ts`. Inventory's five load-cycle
 * files would do the same through inventory, and its two back-edge files
 * are effort files, and effort comes before inventory in the move order.
 * Board's 25 load-cycle files are mostly run and pr files that board's files
 * reach through `src/claims/`, `src/next/` and `src/start/`, and its one
 * effort importer, `src/effort/epic-cost.ts`, is a back edge the load-cycle
 * group takes first; its two declaration-graph files are effort's two. Its
 * 21 library-chunk files are reached statically from a library entry, and
 * through the facade that graph would reach board's lazy command modules, so
 * the splitting build would write each as a chunk of its own (one of them
 * rewired alone writes 58 more chunks than the build at `c920603`).
 * Release's one board importer, `src/board/project/facts.ts`, is a back edge
 * the load-cycle group takes first, and its two declaration-graph files are
 * effort's two. Its eight library-chunk files are reached statically from a
 * library entry, and through the facade that graph would reach release's lazy
 * command modules (`RELEASE_FEATURE` re-exports `src/commands/release/index.ts`),
 * one of them rewired alone writing 95 more chunks than the build at `c920603`.
 */
const REWIRED: readonly RewiredRow[] = [
  {
    allowed: {
      'src/agents/roster.ts': 'loadCycle',
      'src/check/run.ts': 'loadCycle',
      'src/config-registry.ts': 'declarationGraph',
      'src/config/shape.ts': 'declarationGraph',
      'src/inventory/record.ts': 'loadCycle',
      'src/inventory/trees.ts': 'loadCycle',
      'src/schema/instinct.ts': 'loadCycle',
      'src/tiers/serve.ts': 'loadCycle',
    },
    packageName: 'rafa-effort',
  },
  {
    allowed: {
      'src/effort/report-skills.ts': 'backEdge',
      'src/effort/skill-facts.ts': 'backEdge',
      'src/effort/skill-use.ts': 'loadCycle',
      'src/start/dispatch.ts': 'loadCycle',
      'src/start/handout.ts': 'loadCycle',
      'src/start/preflight.ts': 'loadCycle',
      'src/start/serving.ts': 'loadCycle',
    },
    packageName: 'rafa-inventory',
  },
  {
    allowed: {
      'src/adapter-registry.ts': 'libraryChunks',
      'src/adapters/planner/claude.ts': 'libraryChunks',
      'src/bugs/filed-values.ts': 'loadCycle',
      'src/claims/ahead.ts': 'loadCycle',
      'src/claims/drift.ts': 'loadCycle',
      'src/claims/labels.ts': 'loadCycle',
      'src/claims/plan-claim.ts': 'libraryChunks',
      'src/commands/plan/blocked-offer.ts': 'libraryChunks',
      'src/commands/plan/claim-route.ts': 'libraryChunks',
      'src/commands/plan/plan-record.ts': 'libraryChunks',
      'src/commands/plan/ready-offer.ts': 'libraryChunks',
      'src/commands/plan/refresh-offer.ts': 'libraryChunks',
      'src/commands/plan/review-gate.ts': 'libraryChunks',
      'src/commands/plan/spec-route.ts': 'libraryChunks',
      'src/commands/switch.ts': 'loadCycle',
      'src/config-registry.ts': 'declarationGraph',
      'src/config/shape.ts': 'declarationGraph',
      'src/effort/epic-cost.ts': 'loadCycle',
      'src/epic/verify-run.ts': 'loadCycle',
      'src/next/hop-action.ts': 'loadCycle',
      'src/next/hop-rows.ts': 'loadCycle',
      'src/next/owner-gate.ts': 'loadCycle',
      'src/next/readings.ts': 'loadCycle',
      'src/next/relations-mode.ts': 'loadCycle',
      'src/next/sources.ts': 'loadCycle',
      'src/next/state.ts': 'loadCycle',
      'src/plan.ts': 'libraryChunks',
      'src/plan/store-rules.ts': 'loadCycle',
      'src/pr/gh-close.ts': 'loadCycle',
      'src/pr/gh.ts': 'loadCycle',
      'src/pr/owner-approval.ts': 'loadCycle',
      'src/start/decision-prompt.ts': 'libraryChunks',
      'src/start/follow-ups.ts': 'libraryChunks',
      'src/start/forced-draft.ts': 'libraryChunks',
      'src/start/preflight-claim.ts': 'loadCycle',
      'src/start/preflight-drift.ts': 'loadCycle',
      'src/start/release-stage.ts': 'libraryChunks',
      'src/start/risk-total.ts': 'libraryChunks',
      'src/start/runner-pr.ts': 'libraryChunks',
      'src/start/stale-docs.ts': 'loadCycle',
      'src/start/suite-steps-run.ts': 'libraryChunks',
      'src/start/triage.ts': 'loadCycle',
      'src/suite/checks.ts': 'libraryChunks',
      'src/suite/owns.ts': 'libraryChunks',
      'src/suite/scope.ts': 'libraryChunks',
      'src/triage/bug-filing.ts': 'loadCycle',
      'src/triage/refs-section.ts': 'loadCycle',
      'src/triage/triage.ts': 'loadCycle',
    },
    packageName: 'rafa-board',
  },
  {
    allowed: {
      'src/board/project/facts.ts': 'loadCycle',
      'src/cleanup/groups.ts': 'libraryChunks',
      'src/config-registry.ts': 'declarationGraph',
      'src/config/shape.ts': 'declarationGraph',
      'src/docs/release-issue.ts': 'loadCycle',
      'src/next/settle-step.ts': 'libraryChunks',
      'src/next/sources.ts': 'libraryChunks',
      'src/pr/settle-waiting.ts': 'libraryChunks',
      'src/start/release-body.ts': 'libraryChunks',
      'src/start/release-stage.ts': 'libraryChunks',
      'src/start/runner-pr.ts': 'libraryChunks',
      'src/start/stale-docs.ts': 'libraryChunks',
    },
    packageName: 'rafa-release',
  },
];

/** A file's path with the relative specifiers it holds that name a package file. */
interface ImportedBy {
  readonly path: string;
  readonly specifiers: readonly string[];
}

/**
 * Checks a row against the files that import the package by path.
 *
 * @param row - The rewired package's row.
 * @param importers - The non-test files outside the package that import a package file by path.
 * @returns One line per fault: an unnamed importer with its specifier, or a named file that no longer imports.
 */
function findViolations(row: RewiredRow, importers: readonly ImportedBy[]): string[] {
  const violations: string[] = [];
  const byPath = new Map(importers.map((importer) => [importer.path, importer]));
  for (const importer of importers) {
    if (!(importer.path in row.allowed)) {
      for (const specifier of importer.specifiers) {
        violations.push(`${row.packageName}: ${importer.path} imports ${specifier} by path`);
      }
    }
  }
  for (const path of Object.keys(row.allowed)) {
    if (!byPath.has(path)) {
      violations.push(`${row.packageName}: ${path} is named but imports no file of the package`);
    }
  }
  return violations.sort();
}

describe('the rewire guard over this repository', () => {
  const listed = spawnSync('git', ['ls-files'], { cwd: REPO_ROOT, encoding: 'utf8' });
  const tracked = listed.stdout.split('\n').filter((line) => line !== '');

  it('lists the tracked files', () => {
    expect(listed.status).toBe(0);
    expect(tracked.length).toBeGreaterThan(0);
  });

  for (const row of REWIRED) {
    it(`${row.packageName}: no file imports it by path except the files its row names`, () => {
      const packageFiles = readPackageFiles(tracked, row.packageName);
      const importers = readImporters(REPO_ROOT, tracked, packageFiles).map((importer) => ({
        path: importer.path,
        specifiers: importer.statements.map((statement) => statement.specifier),
      }));
      expect(findViolations(row, importers)).toEqual([]);
    });
  }
});

describe('the rewire guard over planted files', () => {
  const PACKAGE_FILES = new Set(['src/effort/collect.ts']);
  const resolve = (specifier: string, from: string): string | undefined => posix.join(posix.dirname(from), specifier).replace(/\.js$/, '.ts');
  const row: RewiredRow = { allowed: {}, packageName: 'rafa-effort' };

  /** Plants texts by path and reads their importers as the live case does. */
  function plant(files: Readonly<Record<string, string>>): ImportedBy[] {
    return Object.entries(files)
      .map(([path, text]) => ({
        path,
        specifiers: readPackageStatements(path, text, PACKAGE_FILES, resolve).map((statement) => statement.specifier),
      }))
      .filter((importer) => importer.specifiers.length > 0);
  }

  it('is red naming the file and the specifier of one planted relative import', () => {
    const importers = plant({
      'src/clean.ts': 'import { x } from \'@open-tomato/rafa-effort\';\n',
      'src/planted.ts': 'import collect from \'./effort/collect.js\';\n',
    });
    expect(findViolations(row, importers)).toEqual([
      'rafa-effort: src/planted.ts imports ./effort/collect.js by path',
    ]);
  });

  it('is green when the planted importer is named by the row', () => {
    const importers = plant({ 'src/planted.ts': 'import collect from \'./effort/collect.js\';\n' });
    expect(findViolations({ ...row, allowed: { 'src/planted.ts': 'loadCycle' } }, importers)).toEqual([]);
  });

  it('is red for a named file that imports no package file any more', () => {
    const importers = plant({ 'src/planted.ts': 'import { x } from \'@open-tomato/rafa-effort\';\n' });
    expect(findViolations({ ...row, allowed: { 'src/planted.ts': 'backEdge' } }, importers)).toEqual([
      'rafa-effort: src/planted.ts is named but imports no file of the package',
    ]);
  });
});
