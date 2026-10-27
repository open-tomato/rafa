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
 * Board's 19 load-cycle files are mostly run and pr files that board's files
 * reach through `src/claims/`, `src/next/` and `src/start/`. On the graph the
 * fourth decouple item's survey regenerated, the codemod reads 15 of them on
 * a load cycle and `src/claims/drift.ts`, `src/claims/labels.ts`,
 * `src/commands/switch.ts` and `src/start/triage.ts` to rewire. The dry run
 * takes all four now, the facade having the names they import, so they stay
 * on their paths until the rewire runs. On the graph the fifth decouple
 * item's survey regenerated, with board's back edges into run and pr gone,
 * the codemod reads none of the nineteen on a load cycle and all nineteen to
 * rewire, refusing `scanClaimBranches` of `packages/rafa-board/src/board/roadmap.ts` in
 * `src/next/readings.ts` and `src/next/sources.ts`. The 19 load-cycle files
 * took the facade in pass 4c, since decouple 5 ended the cycles that kept
 * them, once those two took `scanClaimBranches` from
 * `packages/rafa-board/src/board/branch-scan.ts`, so board's row was
 * empty until the seven readings interfaces moved into
 * `packages/rafa-board/src/next/relation-readings.ts`, a board file, and
 * `src/next/readings.ts` re-exported them from its path; it is empty again
 * since `readings.ts` takes them from the facade by name, before the
 * move. The same stage took
 * `src/plan/store-rules.ts`, `src/start/preflight-claim.ts` and
 * `preflight-drift.ts` onto the facade. `packages/rafa-board/src/claims/ahead.ts` and
 * `packages/rafa-board/src/epic/verify-run.ts` left the row in the fourth decouple item, which
 * places them in board by name, and `src/claims/plan-claim.ts`, which took
 * them by path then, took the facade.
 * Release's one board importer, `packages/rafa-board/src/board/project/facts.ts`, left the row
 * in the fourth decouple item: its one release import by path was
 * `directoryPrefix` and `fragmentIdOf`, which it takes from
 * `@open-tomato/rafa/release/fragment` now. `packages/rafa-release/src/docs/release-issue.ts`
 * stayed, for `SettleForecast` and `nextVersion`, until the sixth decouple
 * item placed it in release by name, so its imports are inside release
 * and the row is empty.
 * Pr's 13 load-cycle files are claims, cleanup, next, start and release files
 * pr's files reach, three of them release files that are back edges the
 * load-cycle group takes first. `packages/rafa/src/claims/git.ts`,
 * `packages/rafa/src/start/branch-decision.ts` and `packages/rafa-release/src/release/fragment-tree.ts` left the
 * row in the fourth decouple item: their one pr import by path was the pr
 * barrel, for core's git names and `WorkingTreeStatus`, which they take from
 * `@open-tomato/rafa/core/git` now. Its 12 back-edge files are release
 * files, every one earlier in the move order.
 * `packages/rafa-board/src/commands/issue/create.ts` left them in the same item: its one pr
 * import by path was `TRIAGE_MODULE`, which it takes from
 * `@open-tomato/rafa/triage/filed-text` now. So did
 * `packages/rafa-board/src/commands/issue/create-bug.ts`, whose pr imports by path were
 * `packages/rafa/src/bugs/fill.ts` and `packages/rafa/src/bugs/versions.ts`,
 * which the item's move list took into core.
 * `packages/rafa-board/src/board/project/add-filed.ts`, `packages/rafa-board/src/commands/epic/close-triage.ts`
 * and `packages/rafa-board/src/commands/epic/close.ts` left them in the fifth decouple item:
 * their pr imports by path were `triageReport` and its types, which they
 * reach through core's service registry,
 * `@open-tomato/rafa/core/services`, and its `TriagedBug` and
 * `TriageServiceResult`. `packages/rafa-board/src/commands/epic/close-docs.ts`, the last
 * board file among them, left them in the same item: its pr import by
 * path was `addStaleDocLine`, which it reaches through the same registry.
 * The sixth decouple item took ten back-edge and three load-cycle files
 * off the row, the release commands, `packages/rafa-release/src/next/epic-end.ts`,
 * `packages/rafa-release/src/release/branch-forecast.ts`, `prepare.ts` and `verify.ts`: their
 * one pr import by path was the pr barrel, for core's git names, which
 * they take from `@open-tomato/rafa/core/git` now. `packages/rafa-release/src/cleanup/past-head.ts`
 * left it in the same item: its one pr import by path was
 * `MergedPullRequest` of `packages/rafa/src/pr/types.ts`, which the item's
 * core move list took into core. `packages/rafa-release/src/release/settle-pr.ts` left it in
 * the same item: its one pr import by path was the pr barrel, for the port
 * types it takes from `@open-tomato/rafa/pr/types` now.
 * `packages/rafa-release/src/commands/release/status-stale-docs.ts` left it in the same item:
 * its one pr import by path was `packages/rafa-release/src/docs/open-lines.ts`, which the item
 * placed in release by name. `packages/rafa-release/src/commands/release/settle.ts`, the last
 * release file on the row, left it in the same item: its one pr import
 * by path was `ghPullRequestsIn`, which it reaches through core's service
 * registry as `pullRequestsIn`. So the row kept 8 load-cycle files and
 * no back-edge file. The seventh decouple item (rafa-1368) took
 * `src/cleanup/worktrees.ts` and `src/start/pr-retarget.ts` off the row,
 * since it places them in pr by name, and `src/next/hint.ts`, whose pr
 * imports by path were `src/next/sources.ts` and `relations-mode.ts`,
 * which it places in run. It named the seven run files that import a pr
 * file by path once those placements are made: `src/cleanup/index.ts` and
 * `steps.ts` (`./worktrees.js`, and `./groups.js` for `steps.ts`),
 * `src/start/wrap-up-run.ts` (`./pr-retarget.js`) and
 * `src/next/owner-gate.ts`, `relations-mode.ts`, `settle-step.ts` and
 * `sources.ts` (files of `src/pr/`), each in the load-cycle group until
 * the item's rewire task read it. Its dry run read the four `src/next/`
 * files on a load cycle and the other three to rewire, and the codemod
 * took `src/cleanup/index.ts`, `steps.ts` and `src/start/wrap-up-run.ts`
 * onto the facade. So the row keeps 9 load-cycle files and no back-edge
 * file.
 * Run's five load-cycle files are board, pr and release files run's files
 * reach, every one a back edge the load-cycle group takes first, since run
 * moves last. Board's `packages/rafa-board/src/board/gate.ts`, `packages/rafa-board/src/board/project/rules.ts`,
 * `packages/rafa-board/src/board/roadmap-claims.ts` and `packages/rafa-board/src/board/setup.ts` left them, and
 * `packages/rafa-board/src/board/issue-edit-state.ts` left the back-edge files, in the fourth
 * decouple item: their run imports by path were
 * `packages/rafa/src/plan/validate.ts`, `packages/rafa/src/claims/stale.ts`,
 * `packages/rafa/src/claims/git.ts` and
 * `packages/rafa/src/start/branch-decision.ts`, which the item's move list
 * took into core. Pr's `src/triage/kind-route.ts` and `leftover-repair.ts`
 * left the row in the third decouple item: their one run import by path
 * was the `LoopRetries` type of `packages/rafa/src/config-schema-loop-retries.ts`. Pr's
 * `src/triage/base-run.ts` and `inherited.ts` left the row in the seventh
 * decouple item: their run imports by path were the suite runner,
 * `src/suite/run.ts`, which the item moved into core as
 * `packages/rafa/src/suite/run.ts`. Run's
 * five back-edge files are pr files, every one earlier in the move
 * order. `packages/rafa-board/src/board/spec-source.ts` and `packages/rafa-board/src/commands/epic/close.ts`
 * left them in the fourth decouple item: their one run import by path was
 * `packages/rafa-board/src/claims/ahead.ts` and `packages/rafa-board/src/epic/verify-run.ts`, which it places in
 * board by name. `packages/rafa-board/src/commands/board/list.ts` and `packages/rafa-board/src/commands/epic/new.ts`
 * left them in the same item: their one run import by path was
 * `defaultBoardOnce` of `src/commands/switch.ts`, which it moves into
 * board's `packages/rafa-board/src/board/default-board-once.ts`. `packages/rafa-board/src/commands/issue/ready.ts`
 * and `packages/rafa-board/src/commands/epic/close-triage.ts` left them in the fifth decouple
 * item: their run imports by path were `endWithNextStep` and
 * `readStaleDocsVersion`, which they call through core's service
 * registry. Pr's `src/commands/pr/merge-cleanup.ts`, `merge-followups.ts`
 * and `triage-resolve.ts` left them in the seventh decouple item: their
 * one run import by path each was a constant, `RUNTIME_SUBDIR`,
 * `RAFA_PACKAGE_NAME` and `CI_POLL_INTERVAL_MS`, which the item moved
 * into core. The same item placed `src/cleanup/steps.ts`,
 * `src/next/owner-gate.ts`, `settle-step.ts` and `sources.ts` in run by
 * name, so their run imports are inside run and they left the row, and
 * placed `src/cleanup/worktrees.ts` and `src/start/pr-retarget.ts` in pr,
 * so `src/cleanup/groups.ts`, `src/commands/pr/merge-loop-worktree.ts`
 * and `retarget.ts`, whose run imports by path were those two files, left
 * it too. `src/commands/pr/merge.ts` left it in the same item: its run
 * import by path was `endWithNextStep`, which it calls through core's
 * service registry. So the row keeps no load-cycle file and two
 * back-edge files, `src/commands/pr/triage.ts` and `wait.ts`, for
 * `endWithNextStep` of `src/next/ending.ts`.
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
    allowed: {},
    packageName: 'rafa-board',
  },
  {
    allowed: {},
    packageName: 'rafa-release',
  },
  {
    allowed: {
      'src/claims/lost.ts': 'loadCycle',
      'src/next/hop-rows.ts': 'loadCycle',
      'src/next/owner-gate.ts': 'loadCycle',
      'src/next/readings.ts': 'loadCycle',
      'src/next/relations-mode.ts': 'loadCycle',
      'src/next/settle-step.ts': 'loadCycle',
      'src/next/sources.ts': 'loadCycle',
      'src/start/pr-lifecycle.ts': 'loadCycle',
      'src/start/suite-blocker.ts': 'loadCycle',
    },
    packageName: 'rafa-pr',
  },
  {
    allowed: {
      'src/commands/pr/triage.ts': 'backEdge',
      'src/commands/pr/wait.ts': 'backEdge',
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
