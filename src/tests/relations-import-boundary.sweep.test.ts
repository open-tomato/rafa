/**
 * A closing test for "Stage: Readers behind the port"
 * (`.rafa/plans/PLAN-rafa-340-relationships-epics-blockers-github.md`):
 * every reader task on that stage's checklist is done, so this file
 * locks the two properties the stage promises.
 *
 * ## The import boundary
 *
 * The plan's hard rule reads: "no module outside
 * `packages/rafa-board/src/board/relations/labels.ts` (and the move and doctor modules that
 * look for the OTHER mode's marks) reads an `epic:` label,
 * `spec:blocked`, or a `Blocked by:` line to learn a relationship." The
 * stage task that asks for this file widens "labels.ts" to the whole
 * `packages/rafa-board/src/board/relations/` directory, which every
 * module there already satisfies.
 *
 * What the stage tasks actually built is narrower than a flat ban,
 * though, and this file audits the real shape rather than the
 * aspirational one. Every reader moved behind the port in this stage —
 * `epics.ts`, `epic-walk.ts`, `roadmap-rows.ts`, `blocked-line.ts`,
 * `epic-context.ts`, `epic-dependents.ts`, `status/render.ts`,
 * `next/state.ts`, the `epic` subcommands and more — branches on
 * `relations.mode`: the `native` branch reads the port, and the
 * `labels` branch keeps calling `EPIC_LABEL_PREFIX`, `SPEC_BLOCKED_LABEL`,
 * `groupByEpicLabel` and `readBlockedBy` directly, exactly as it did
 * before the port existed, so labels-mode output stays byte-identical
 * (the hard rule the baseline captures below exist to police). A few
 * more modules (`setup.ts`, `epic/new.ts`, `epic-tick.ts`,
 * `issue/unblock.ts`, `issue/roadmap-epic-table.ts`,
 * `issue/create-blocked.ts`) write or format a labels-mode-only concern
 * that has no native counterpart yet.
 *
 * So the real invariant is: nothing OUTSIDE this known, closed set of
 * files reads these four names. {@link ALLOWED_IMPORTERS} is that set,
 * one entry per file with the reason it is there, keyed by its
 * repo-relative path; every file under
 * `packages/rafa-board/src/board/relations/` is exempt without being
 * listed, since the plan names the whole directory. A file reads a name by a path to
 * `epics.ts` or `blocked.ts`, or by the board facade,
 * `@open-tomato/rafa-board`, for a name the facade's entry re-exports
 * from either (#808). A file added to this list without a reason
 * is the thing this test exists to make a reviewer notice; a file
 * REMOVED from the codebase's actual imports without the list being
 * trimmed to match fails just as loudly, so the list stays honest in
 * both directions.
 *
 * ## The walk and the two kinds
 *
 * The walk reads every root of `SOURCE_ROOTS` (`./source-roots.ts`), so
 * a file under any package root is read as well as one under `src/`,
 * and it reports each importer by its repo-relative path. Each tracked
 * import is answered with its kind: `type` for an `import type { … }`
 * statement or an inline `type` modifier, `value` otherwise. A type-only
 * import of a tracked name is still an importer: it is shown in the
 * counts beside the value importers and listed when unlisted, never
 * dropped. The planted-tree control proves the package side of the
 * walk reads both kinds.
 *
 * ## The baseline captures
 *
 * The stage task also asks that "the labels baseline captures still
 * match" — that `src/tests/relations-labels-baseline.test.ts`, written
 * before any reader moved behind the port, still passes now that every
 * one of them has. Rather than re-implement its scratch-repo and `gh`
 * stub harness a second time, this file spawns it as `bun test` would,
 * one `bun test <file>` subprocess, and reads its exit code: a passing
 * exit is exactly "the captures still match," and a failing one names
 * the drift on its own stderr.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it, setDefaultTimeout } from 'bun:test';

import { SOURCE_ROOTS } from './source-roots.js';
import { SWEEP_TIMEOUT } from './sweep-timeout.js';

setDefaultTimeout(SWEEP_TIMEOUT);

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** Board's `src/`, repo-relative, which holds the two defining modules and the exempt directory. */
const BOARD_ROOT = 'packages/rafa-board/src';

/** The two modules that define the four names this file tracks, repo-relative. */
const EPICS_MODULE = `${BOARD_ROOT}/board/epics.ts`;
const BLOCKED_MODULE = `${BOARD_ROOT}/board/blocked.ts`;

/** The directory every file of which is exempt without being listed, repo-relative. */
const RELATIONS_PREFIX = `${BOARD_ROOT}/board/relations/`;

/** The four names the stage's hard rule names. */
const TRACKED_NAMES = ['EPIC_LABEL_PREFIX', 'SPEC_BLOCKED_LABEL', 'groupByEpicLabel', 'readBlockedBy'] as const;

/** How a file imports a tracked name: `type` for a type-only import, `value` otherwise. */
type ImportKind = 'type' | 'value';

/** One tracked name a file imports, with its kind. */
interface TrackedImport {
  readonly kind: ImportKind;
  readonly name: string;
}

/**
 * Every file outside `packages/rafa-board/src/board/relations/` allowed
 * to import a tracked name, each with why, keyed by its repo-relative
 * path, forward-slashed.
 */
const ALLOWED_IMPORTERS: Readonly<Record<string, string>> = Object.freeze({
  'packages/rafa-board/src/board/epics.ts': 'the labels-family module itself; its own labels-mode source calls readBlockedBy on a member',
  'packages/rafa-board/src/board/epic-walk.ts': 'the roadmap walk\'s labels-mode remedy wording, unchanged since before the port',
  'packages/rafa-board/src/board/epic-context.ts': 'plan create\'s own single-issue labels-mode --label query, documented as a deliberate exception since it holds no listing',
  'packages/rafa-board/src/board/epic-dependents.ts': 'epic cancel\'s labels-mode branch, reading epic: labels and Blocked by: lines directly; native mode reads the port',
  'packages/rafa-board/src/board/epic-problems.ts': 'the two-epic-label fault finder doctor-epics.ts reports, a labels-mode structural check',
  'packages/rafa-board/src/board/roadmap-rows.ts': 'the roadmap table\'s labels-mode branch, per its own module note',
  'packages/rafa-board/src/board/blocked-issues.ts': 'the labels-mode reading of every open spec:blocked issue, behind the doctor row and status\'s count',
  'packages/rafa-board/src/board/blocked-line.ts': 'the walk\'s labels-mode-only remedy: "take spec:blocked off #n"',
  'packages/rafa-board/src/board/epic-tick.ts': 'the epic tick pr merge and the labels adapter share, matching a member against its epic: label',
  'packages/rafa-board/src/board/unblock.ts': 'the unblock run rafa issue unblock and pr merge share, a labels-mode-only reading of Blocked by: lines and write of spec:blocked',
  'packages/rafa-board/src/board/setup.ts': 'writes the spec:blocked label definition during rafa init',
  'src/status/render.ts': 'status\'s labels-mode wording for the blocked count',
  'src/status/blocked-count.ts': 'status\'s labels-mode wording when the count could not be read',
  'packages/rafa-run/src/next/state.ts': 'next\'s labels-mode remedy wording',
  'src/commands/doctor-blocked.ts': 'the doctor row\'s clean line, counting the issues labelled spec:blocked',
  'src/commands/doctor-epics.ts': 'the doctor row reporting epic: labels',
  'src/commands/doctor-marks.ts': 'the doctor row naming the other mode\'s marks, which in native mode looks for epic: labels, spec:blocked and Blocked by: lines',
  'packages/rafa-board/src/commands/epic/move.ts': 'the move module',
  'packages/rafa-board/src/commands/epic/new.ts': 'writes the new epic:<slug> label',
  'packages/rafa-board/src/commands/epic/close.ts': 'epic close\'s labels-mode branch, finding members by the epic: label',
  'packages/rafa-board/src/commands/epic/cancel.ts': 'epic cancel\'s labels-mode branch, checking whether a member carries spec:blocked',
  'packages/rafa-board/src/commands/epic/cancel-unblock.ts': 'epic cancel\'s labels-mode branch, reading a waited-on outsider\'s Blocked by: line',
  'packages/rafa-board/src/commands/issue/roadmap-epic-table.ts': 'the roadmap epic table\'s labels-mode branch',
  'packages/rafa-board/src/commands/issue/unblock.ts': 'rafa issue unblock, a labels-mode-only command, wording its lines with spec:blocked',
  'packages/rafa-board/src/commands/issue/create-blocked.ts': 'rafa issue create\'s spec:blocked mark from a spec\'s Blocked by: line, a labels-mode write #467 moves behind the port',
  'packages/rafa-run/src/suite/owns.ts': 'the stage step\'s Owns: lookup, finding a spec\'s epic by its epic: label the way epic-context.ts does; a failed read only widens the step to the whole suite',
});

/**
 * Every `.ts` source file under `dir` of `base`, repo-relative and
 * forward-slashed, its `.test.ts` and `.d.ts` files and `testdata/`
 * fixtures left out.
 */
function listSourceFiles(base: string, dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(join(base, dir)).sort()) {
    if (entry === 'testdata') continue;
    const path = posix.join(dir, entry);
    if (statSync(join(base, path)).isDirectory()) {
      found.push(...listSourceFiles(base, path));
      continue;
    }
    if (extname(entry) !== '.ts') continue;
    if (entry.endsWith('.test.ts') || entry.endsWith('.d.ts')) continue;
    found.push(path);
  }
  return found;
}

/** The board package's facade, which a file outside the package imports board's names by (#808). */
const BOARD_FACADE = '@open-tomato/rafa-board';

/** The facade's entry, repo-relative, whose `export { … } from '…'` statements name each re-exported name's file. */
const BOARD_FACADE_ENTRY = 'packages/rafa-board/index.ts';

/** The pattern the facade's entry is read with: its `export { … } from '…'` statements. */
const NAMED_STATEMENT = /export\s+(?:type\s+)?\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]/gs;

/** The pattern a source is read with: its `import { … } from '…'` statements, `import type` captured. */
const IMPORT_STATEMENT = /import\s+(type\s+)?\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]/gs;

/** `../board/epics.js` resolved against the repo-relative `fromFile`'s directory, as a repo-relative `.ts` path. */
function resolvedImportTarget(fromFile: string, specifier: string): string | null {
  if (!specifier.startsWith('.')) return null;
  const withoutExt = specifier.replace(/\.js$/, '');
  return `${posix.join(posix.dirname(fromFile), withoutExt)}.ts`;
}

/** The names of a `{ … }` clause, each as its file exports it, ahead of any `as`, with whether it carries an inline `type`. */
function clauseEntries(clause: string): { readonly inlineType: boolean; readonly name: string }[] {
  return clause
    .split(',')
    .map((piece) => piece.trim().split(/\s+as\s+/)[0]?.trim() ?? '')
    .filter((piece) => piece.length > 0)
    .map((piece) => {
      const inlineType = /^type\s+/.test(piece);
      return { inlineType, name: piece.replace(/^type\s+/, '') };
    });
}

/** Each name the board facade re-exports, keyed to the repo-relative source file it re-exports it from. */
function facadeOrigins(): Map<string, string | null> {
  const origins = new Map<string, string | null>();
  for (const match of readFileSync(join(REPO_ROOT, BOARD_FACADE_ENTRY), 'utf8').matchAll(NAMED_STATEMENT)) {
    const target = resolvedImportTarget(BOARD_FACADE_ENTRY, match[2] ?? '');
    for (const { name } of clauseEntries(match[1] ?? '')) origins.set(name, target);
  }
  return origins;
}

const FACADE_ORIGINS = facadeOrigins();

/**
 * Every tracked name a `{ ... } from '...'` import statement in `text`
 * pulls from `epics.ts` or `blocked.ts`, with its kind: by a path to
 * either, or by the board facade, for a name the facade re-exports from
 * either. `filePath` is repo-relative.
 */
function trackedImportsOf(filePath: string, text: string): TrackedImport[] {
  const found: TrackedImport[] = [];
  for (const match of text.matchAll(IMPORT_STATEMENT)) {
    const statementType = match[1] !== undefined;
    const specifier = match[3] ?? '';
    const reachesTracked = (name: string): boolean => {
      const target = specifier === BOARD_FACADE
        ? FACADE_ORIGINS.get(name)
        : resolvedImportTarget(filePath, specifier);
      return target === EPICS_MODULE || target === BLOCKED_MODULE;
    };
    for (const { inlineType, name } of clauseEntries(match[2] ?? '')) {
      if (!(TRACKED_NAMES as readonly string[]).includes(name) || !reachesTracked(name)) continue;
      const kind: ImportKind = statementType || inlineType
        ? 'type'
        : 'value';
      found.push({ kind, name });
    }
  }
  return found;
}

/**
 * Every file under `roots` of `base` that imports a tracked name, keyed
 * by its repo-relative path, with each tracked import and its kind.
 */
function importersIn(base: string = REPO_ROOT, roots: readonly string[] = SOURCE_ROOTS): Map<string, TrackedImport[]> {
  const importers = new Map<string, TrackedImport[]>();
  for (const path of roots.flatMap((root) => listSourceFiles(base, root))) {
    const tracked = trackedImportsOf(path, readFileSync(join(base, path), 'utf8'));
    if (tracked.length > 0) importers.set(path, tracked);
  }
  return importers;
}

/** The importers outside the relations directory and absent from {@link ALLOWED_IMPORTERS}, each with its imports. */
function unlistedImporters(importers: ReadonlyMap<string, readonly TrackedImport[]>): [string, readonly TrackedImport[]][] {
  return [...importers.entries()]
    .filter(([path]) => !path.startsWith(RELATIONS_PREFIX))
    .filter(([path]) => !(path in ALLOWED_IMPORTERS));
}

/** How many importers read a tracked name as a value at least once, and how many read them as types only. */
function kindCounts(importers: ReadonlyMap<string, readonly TrackedImport[]>): { readonly type: number; readonly value: number } {
  const all = [...importers.values()];
  const value = all.filter((imports) => imports.some((entry) => entry.kind === 'value')).length;
  return { type: all.length - value, value };
}

describe('the walk over a planted tree', () => {
  const PLANTED_VALUE = 'packages/rafa-pr/src/planted.ts';
  const PLANTED_TYPE = 'packages/rafa-pr/src/planted-type.ts';
  const base = mkdtempSync(join(tmpdir(), 'relations-import-boundary-'));
  for (const root of SOURCE_ROOTS) mkdirSync(join(base, root), { recursive: true });
  const plant = (path: string, text: string): void => {
    mkdirSync(dirname(join(base, path)), { recursive: true });
    writeFileSync(join(base, path), text);
  };
  plant(PLANTED_VALUE, 'import { EPIC_LABEL_PREFIX } from \'@open-tomato/rafa-board\';\n');
  plant(PLANTED_TYPE, 'import type { readBlockedBy } from \'@open-tomato/rafa-board\';\n');
  const planted = importersIn(base);

  afterAll(() => {
    rmSync(base, { recursive: true, force: true });
  });

  it('reads a value import and a type import under pr\'s root as unlisted, each with its kind', () => {
    expect(unlistedImporters(planted)).toEqual([
      [PLANTED_TYPE, [{ kind: 'type', name: 'readBlockedBy' }]],
      [PLANTED_VALUE, [{ kind: 'value', name: 'EPIC_LABEL_PREFIX' }]],
    ]);
  });

  it('counts the planted value importer and the planted type-only importer side by side', () => {
    expect(kindCounts(planted)).toEqual({ type: 1, value: 1 });
  });

  it('reads an inline type modifier as a type import, so it is never dropped', () => {
    expect(trackedImportsOf(PLANTED_VALUE, 'import { type readBlockedBy, SPEC_BLOCKED_LABEL } from \'@open-tomato/rafa-board\';')).toEqual([
      { kind: 'type', name: 'readBlockedBy' },
      { kind: 'value', name: 'SPEC_BLOCKED_LABEL' },
    ]);
  });
});

describe('the board relationship symbols stay behind the port', () => {
  const importers = importersIn();
  const counts = kindCounts(importers);

  it('finds every current importer, proving the scan is not vacuous', () => {
    expect(importers.size).toBeGreaterThan(0);
    expect(importers.get(`${RELATIONS_PREFIX}labels.ts`)).toBeDefined();
  });

  it('reads the importers by kind: value importers above zero and type-only importers as measured', () => {
    expect(counts.value).toBeGreaterThan(0);
    expect(counts.type).toBe(0);
  });

  it('reads the facade\'s three tracked names as re-exported from epics.ts or blocked.ts, so a facade import is read and not skipped', () => {
    expect(TRACKED_NAMES.filter((name) => FACADE_ORIGINS.has(name)).map((name) => [name, FACADE_ORIGINS.get(name)])).toEqual([
      ['EPIC_LABEL_PREFIX', EPICS_MODULE],
      ['SPEC_BLOCKED_LABEL', BLOCKED_MODULE],
      ['readBlockedBy', BLOCKED_MODULE],
    ]);
  });

  it('imports EPIC_LABEL_PREFIX, SPEC_BLOCKED_LABEL, groupByEpicLabel or readBlockedBy from no file outside packages/rafa-board/src/board/relations/, the move module, the doctor rows and the documented labels-mode branches', () => {
    const unlisted = unlistedImporters(importers);
    console.log(
      `relations-import-boundary: ${importers.size} importer(s), ${counts.value} value and ${counts.type} type-only; `
      + `${unlisted.length} unlisted`,
    );
    expect(unlisted).toEqual([]);
  });

  it('carries no stale entry: every allowed path still imports a tracked name', () => {
    const stale = Object.keys(ALLOWED_IMPORTERS).filter((path) => !importers.has(path));
    expect(stale).toEqual([]);
  });
});

describe('the labels baseline captures', () => {
  it('still match, once every reader in this stage is behind the port', () => {
    const baseline = join(REPO_ROOT, 'src', 'tests', 'relations-labels-baseline.test.ts');
    expect(() => execFileSync('bun', ['test', baseline], {
      cwd: REPO_ROOT,
      stdio: 'pipe',
      timeout: SWEEP_TIMEOUT,
    })).not.toThrow();
  }, SWEEP_TIMEOUT);
});
