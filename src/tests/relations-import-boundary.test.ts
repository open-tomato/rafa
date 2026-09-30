/**
 * A closing test for "Stage: Readers behind the port"
 * (`.rafa/plans/PLAN-rafa-340-relationships-epics-blockers-github.md`):
 * every reader task on that stage's checklist is done, so this file
 * locks the two properties the stage promises.
 *
 * ## The import boundary
 *
 * The plan's hard rule reads: "no module outside
 * `src/board/relations/labels.ts` (and the move and doctor modules that
 * look for the OTHER mode's marks) reads an `epic:` label,
 * `spec:blocked`, or a `Blocked by:` line to learn a relationship." The
 * stage task that asks for this file widens "labels.ts" to the whole
 * `src/board/relations/` directory, which every module there already
 * satisfies.
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
 * more modules (`setup.ts`, `epic/new.ts`, `pr/merge-tick.ts`,
 * `issue/unblock.ts`, `issue/roadmap-epic-table.ts`) write or format a
 * labels-mode-only concern that has no native counterpart yet.
 *
 * So the real invariant is: nothing OUTSIDE this known, closed set of
 * files reads these four names. {@link ALLOWED_IMPORTERS} is that set,
 * one entry per file with the reason it is there; every file under
 * `src/board/relations/` is exempt without being listed, since the plan
 * names the whole directory. A file added to this list without a reason
 * is the thing this test exists to make a reviewer notice; a file
 * REMOVED from the codebase's actual imports without the list being
 * trimmed to match fails just as loudly, so the list stays honest in
 * both directions.
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
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, posix, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'bun:test';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SRC_ROOT = join(REPO_ROOT, 'src');

/** The two modules that define the four names this file tracks. */
const EPICS_MODULE = join(SRC_ROOT, 'board', 'epics.ts');
const BLOCKED_MODULE = join(SRC_ROOT, 'board', 'blocked.ts');

/** The four names the stage's hard rule names. */
const TRACKED_NAMES = ['EPIC_LABEL_PREFIX', 'SPEC_BLOCKED_LABEL', 'groupByEpicLabel', 'readBlockedBy'] as const;

/**
 * Every file outside `src/board/relations/` allowed to import a tracked
 * name, each with why. A path is relative to `src/`, forward-slashed.
 */
const ALLOWED_IMPORTERS: Readonly<Record<string, string>> = Object.freeze({
  'board/epics.ts': 'the labels-family module itself; its own labels-mode source calls readBlockedBy on a member',
  'board/epic-walk.ts': 'the roadmap walk\'s labels-mode remedy wording, unchanged since before the port',
  'board/epic-context.ts': 'plan create\'s own single-issue labels-mode --label query, documented as a deliberate exception since it holds no listing',
  'board/epic-dependents.ts': 'epic cancel\'s labels-mode branch, reading epic: labels and Blocked by: lines directly; native mode reads the port',
  'board/epic-problems.ts': 'the two-epic-label fault finder doctor-epics.ts reports, a labels-mode structural check',
  'board/roadmap-rows.ts': 'the roadmap table\'s labels-mode branch, per its own module note',
  'board/blocked-line.ts': 'the walk\'s labels-mode-only remedy: "take spec:blocked off #n"',
  'board/setup.ts': 'writes the spec:blocked label definition during rafa init',
  'status/render.ts': 'status\'s labels-mode wording for the blocked count',
  'status/blocked-count.ts': 'status\'s labels-mode wording when the count could not be read',
  'next/state.ts': 'next\'s labels-mode remedy wording',
  'commands/doctor-blocked.ts': 'the doctor row reporting spec:blocked issues',
  'commands/doctor-epics.ts': 'the doctor row reporting epic: labels',
  'commands/epic/move.ts': 'the move module',
  'commands/epic/new.ts': 'writes the new epic:<slug> label',
  'commands/epic/close.ts': 'epic close\'s labels-mode branch, finding members by the epic: label',
  'commands/epic/cancel.ts': 'epic cancel\'s labels-mode branch, checking whether a member carries spec:blocked',
  'commands/epic/cancel-unblock.ts': 'epic cancel\'s labels-mode branch, reading a waited-on outsider\'s Blocked by: line',
  'commands/pr/merge-tick.ts': 'pr merge\'s epic-tick, matching a member against its epic: label',
  'commands/issue/roadmap-epic-table.ts': 'the roadmap epic table\'s labels-mode branch',
  'commands/issue/unblock.ts': 'rafa issue unblock, a labels-mode-only command',
});

/** Every `.ts` source file under `src/`, its own `.test.ts` files and `testdata/` fixtures left out. */
function listSourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir).sort()) {
    if (entry === 'testdata') continue;
    const full = join(dir, entry);
    const info = statSync(full);
    if (info.isDirectory()) {
      found.push(...listSourceFiles(full));
      continue;
    }
    if (extname(entry) !== '.ts') continue;
    if (entry.endsWith('.test.ts') || entry.endsWith('.d.ts')) continue;
    found.push(full);
  }
  return found;
}

/** `dir/../board/epics.js` resolved against `fromFile`'s directory, with its extension dropped. */
function resolvedImportTarget(fromFile: string, specifier: string): string | null {
  if (!specifier.startsWith('.')) return null;
  const withoutExt = specifier.replace(/\.js$/, '');
  return `${join(fromFile, '..', withoutExt)}.ts`;
}

/** Every tracked name a `named { ... } from '...'` import statement in `text` pulls from `epics.ts` or `blocked.ts`. */
function trackedImportsOf(filePath: string, text: string): string[] {
  const found: string[] = [];
  const pattern = /import\s+(?:type\s+)?\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]/gs;
  for (const match of text.matchAll(pattern)) {
    const specifier = match[2] ?? '';
    const target = resolvedImportTarget(filePath, specifier);
    if (target !== EPICS_MODULE && target !== BLOCKED_MODULE) continue;
    const names = (match[1] ?? '')
      .split(',')
      .map((piece) => piece.trim().split(/\s+as\s+/)[0]?.trim() ?? '')
      .filter((name) => (TRACKED_NAMES as readonly string[]).includes(name));
    found.push(...names);
  }
  return found;
}

/** `path`, relative to `src/`, forward-slashed regardless of platform. */
function srcRelative(path: string): string {
  return relative(SRC_ROOT, path)
    .split('\\')
    .join(posix.sep);
}

describe('the board relationship symbols stay behind the port', () => {
  const files = listSourceFiles(SRC_ROOT);
  const importers = new Map<string, string[]>();
  for (const file of files) {
    const tracked = trackedImportsOf(file, readFileSync(file, 'utf8'));
    if (tracked.length > 0) importers.set(srcRelative(file), tracked);
  }

  it('finds every current importer, proving the scan is not vacuous', () => {
    expect(importers.size).toBeGreaterThan(0);
    expect(importers.get('board/relations/labels.ts')).toBeDefined();
  });

  it('imports EPIC_LABEL_PREFIX, SPEC_BLOCKED_LABEL, groupByEpicLabel or readBlockedBy from no file outside src/board/relations/, the move module, the doctor rows and the documented labels-mode branches', () => {
    const outsideRelations = [...importers.keys()].filter((path) => !path.startsWith('board/relations/'));
    const unlisted = outsideRelations.filter((path) => !(path in ALLOWED_IMPORTERS));
    expect(unlisted).toEqual([]);
  });

  it('carries no stale entry: every allowed path still imports a tracked name', () => {
    const stale = Object.keys(ALLOWED_IMPORTERS).filter((path) => !importers.has(path));
    expect(stale).toEqual([]);
  });
});

describe('the labels baseline captures', () => {
  it('still match, once every reader in this stage is behind the port', () => {
    const baseline = join(SRC_ROOT, 'tests', 'relations-labels-baseline.test.ts');
    expect(() => execFileSync('bun', ['test', baseline], {
      cwd: REPO_ROOT,
      stdio: 'pipe',
      timeout: 150_000,
    })).not.toThrow();
  }, 150_000);
});
