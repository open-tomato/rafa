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
type KeptGroup = 'backEdge' | 'loadCycle';

/** One rewired package and the files allowed to import it by path. */
interface RewiredRow {
  /** The package, such as `rafa-effort`. */
  readonly packageName: string;
  /** Each allowed file with the group that keeps it on its path. */
  readonly allowed: Readonly<Record<string, KeptGroup>>;
}

/**
 * One row per rewired package. Effort's row is empty. Its six load-cycle
 * files left the row when the first decouple item moved their only
 * effort imports into core, as `packages/rafa/src/schema/frontmatter.ts` and
 * `packages/rafa/src/utils/agent-definition.ts`, and its two
 * declaration-graph files, `src/config-registry.ts` and
 * `src/config/shape.ts`, which `src/config/index.ts` reaches and whose
 * declarations ship as `dist/config/*.d.ts`, left every row in the third
 * decouple item (rafa-1325), which ended the group, as the first ended
 * `libraryChunks`: they imported each package only through its section
 * files, `src/config-schema-<section>.ts`, which that item takes out of
 * the named lists and moves into core. Inventory's last
 * load-cycle file, `packages/rafa-effort/src/effort/skill-use.ts`, imports `bareSkillName` from
 * `packages/rafa-inventory/src/tiers/skill-names.ts`; the import graph held the search's edge into
 * `packages/rafa-effort/src/effort/collect.ts`, which reaches it through `collect-skills.ts`, so
 * the codemod read a cycle through inventory when the rewire ran. The second
 * decouple item cut that edge, and once its survey was regenerated the
 * codemod took the file onto the facade too, so inventory's row is empty.
 * The rewire stage of that item took the other seven files of
 * the row onto the facade: the three effort files of the skills report,
 * `src/start/dispatch.ts`, `handout.ts` and `preflight.ts`, and the CLI's
 * `src/inventory/browse.ts`.
 * Board's 21 load-cycle files are mostly run and pr files that board's files
 * reach through `src/claims/`, `src/next/` and `src/start/`. The same stage took
 * `src/plan/store-rules.ts`, `src/start/preflight-claim.ts` and
 * `preflight-drift.ts` onto the facade.
 * Release's one board importer, `src/board/project/facts.ts`, is a back edge
 * the load-cycle group takes first.
 * Pr's 16 load-cycle files are claims, cleanup, next, start and release files
 * pr's files reach, six of them release files that are back edges the
 * load-cycle group takes first. Its 18 back-edge files are board and release
 * files, every one earlier in the move order.
 * Run's 13 load-cycle files are board, pr and release files run's files
 * reach, every one a back edge the load-cycle group takes first, since run
 * moves last. Pr's `src/triage/kind-route.ts` and `leftover-repair.ts`
 * left the row in the third decouple item: their one run import by path
 * was the `LoopRetries` type of `packages/rafa/src/config-schema-loop-retries.ts`. Run's
 * 15 back-edge files are board and pr files, every one earlier in the
 * move order.
 * No row keeps a file for the library build any more. Board, release, pr
 * and run each take their feature object through a commands entry,
 * `@open-tomato/rafa-<name>/commands`, which the roster alone imports, so a
 * library entry that reaches a facade no longer reaches the feature's lazy
 * command modules, the cause that kept 68 files on their paths, and those
 * files import the facades.
 */
const REWIRED: readonly RewiredRow[] = [
  {
    allowed: {},
    packageName: 'rafa-effort',
  },
  {
    allowed: {},
    packageName: 'rafa-inventory',
  },
  {
    allowed: {
      'src/bugs/filed-values.ts': 'loadCycle',
      'src/claims/ahead.ts': 'loadCycle',
      'src/claims/drift.ts': 'loadCycle',
      'src/claims/labels.ts': 'loadCycle',
      'src/commands/switch.ts': 'loadCycle',
      'src/epic/verify-run.ts': 'loadCycle',
      'src/next/hop-action.ts': 'loadCycle',
      'src/next/hop-rows.ts': 'loadCycle',
      'src/next/owner-gate.ts': 'loadCycle',
      'src/next/readings.ts': 'loadCycle',
      'src/next/relations-mode.ts': 'loadCycle',
      'src/next/sources.ts': 'loadCycle',
      'src/next/state.ts': 'loadCycle',
      'src/pr/gh-close.ts': 'loadCycle',
      'src/pr/gh.ts': 'loadCycle',
      'src/pr/owner-approval.ts': 'loadCycle',
      'src/start/stale-docs.ts': 'loadCycle',
      'src/start/triage.ts': 'loadCycle',
      'src/triage/bug-filing.ts': 'loadCycle',
      'src/triage/refs-section.ts': 'loadCycle',
      'src/triage/triage.ts': 'loadCycle',
    },
    packageName: 'rafa-board',
  },
  {
    allowed: {
      'src/board/project/facts.ts': 'loadCycle',
      'src/docs/release-issue.ts': 'loadCycle',
    },
    packageName: 'rafa-release',
  },
  {
    allowed: {
      'src/board/project/add-filed.ts': 'backEdge',
      'src/claims/git.ts': 'loadCycle',
      'src/claims/lost.ts': 'loadCycle',
      'src/cleanup/past-head.ts': 'loadCycle',
      'src/cleanup/worktrees.ts': 'loadCycle',
      'src/commands/epic/close-docs.ts': 'backEdge',
      'src/commands/epic/close-triage.ts': 'backEdge',
      'src/commands/epic/close.ts': 'backEdge',
      'src/commands/issue/create-bug.ts': 'backEdge',
      'src/commands/issue/create.ts': 'backEdge',
      'src/commands/release/fragment.ts': 'backEdge',
      'src/commands/release/list.ts': 'backEdge',
      'src/commands/release/publish.ts': 'backEdge',
      'src/commands/release/release-commit.ts': 'backEdge',
      'src/commands/release/settle.ts': 'backEdge',
      'src/commands/release/status-fragments.ts': 'loadCycle',
      'src/commands/release/status-packages.ts': 'backEdge',
      'src/commands/release/status-stale-docs.ts': 'backEdge',
      'src/commands/release/status.ts': 'backEdge',
      'src/commands/release/tag-units.ts': 'backEdge',
      'src/commands/release/tag.ts': 'backEdge',
      'src/next/epic-end.ts': 'loadCycle',
      'src/next/hint.ts': 'loadCycle',
      'src/next/hop-rows.ts': 'loadCycle',
      'src/next/readings.ts': 'loadCycle',
      'src/release/branch-forecast.ts': 'loadCycle',
      'src/release/fragment-tree.ts': 'loadCycle',
      'src/release/prepare.ts': 'backEdge',
      'src/release/settle-pr.ts': 'loadCycle',
      'src/release/verify.ts': 'backEdge',
      'src/start/branch-decision.ts': 'loadCycle',
      'src/start/pr-lifecycle.ts': 'loadCycle',
      'src/start/pr-retarget.ts': 'loadCycle',
      'src/start/suite-blocker.ts': 'loadCycle',
    },
    packageName: 'rafa-pr',
  },
  {
    allowed: {
      'src/board/gate.ts': 'loadCycle',
      'src/board/issue-edit-state.ts': 'backEdge',
      'src/board/project/rules.ts': 'loadCycle',
      'src/board/roadmap-claims.ts': 'loadCycle',
      'src/board/setup.ts': 'loadCycle',
      'src/board/spec-source.ts': 'backEdge',
      'src/cleanup/groups.ts': 'loadCycle',
      'src/cleanup/steps.ts': 'loadCycle',
      'src/commands/board/list.ts': 'backEdge',
      'src/commands/epic/close-triage.ts': 'backEdge',
      'src/commands/epic/close.ts': 'backEdge',
      'src/commands/epic/new.ts': 'backEdge',
      'src/commands/issue/ready.ts': 'backEdge',
      'src/commands/pr/merge-cleanup.ts': 'backEdge',
      'src/commands/pr/merge-followups.ts': 'backEdge',
      'src/commands/pr/merge-loop-worktree.ts': 'backEdge',
      'src/commands/pr/merge.ts': 'backEdge',
      'src/commands/pr/retarget.ts': 'backEdge',
      'src/commands/pr/triage-resolve.ts': 'backEdge',
      'src/commands/pr/triage.ts': 'backEdge',
      'src/commands/pr/wait.ts': 'backEdge',
      'src/next/epic-end.ts': 'loadCycle',
      'src/next/owner-gate.ts': 'loadCycle',
      'src/next/relation-readings.ts': 'loadCycle',
      'src/next/settle-step.ts': 'loadCycle',
      'src/next/sources.ts': 'loadCycle',
      'src/triage/base-run.ts': 'loadCycle',
      'src/triage/inherited.ts': 'loadCycle',
    },
    packageName: 'rafa-run',
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
