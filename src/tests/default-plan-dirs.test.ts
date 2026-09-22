/**
 * The tree stays swept: no tracked file outside the test suite still
 * names `.plans/` or `.specs/`, the two directories rafa-49 moved off
 * in favour of the `.rafa/plans` and `.rafa/specs` defaults.
 *
 * Tests keep the exemption the sweep itself carved out for them: a
 * `*.test.ts` case or a fixture under `src/tests/` may plant a custom
 * `plan.dir` or `specs.dir` on purpose, and each one that does says so
 * in a sentence on the case or the file. `src/project/pre-init-dirs.ts`
 * carries the same kind of exemption for a production file: naming the
 * two old directories verbatim is its entire job, not a regression. This
 * suite is what holds every OTHER tracked file to the sweep instead, so
 * a doc comment or a runbook line that regresses to the old path is
 * caught before it can spread.
 *
 * ## Joined prose, not a line-anchored grep
 *
 * Prose in this repository wraps by hand, which is why the sweep tasks
 * this suite closes out all read a whitespace-normalised copy of a
 * file rather than `git grep` output — the same method
 * `routing-table-agents.test.ts` and `repo-hygiene.test.ts` use.
 * `forbiddenTokensIn` collapses every run of whitespace (spaces, tabs,
 * blank lines) to one space before testing for the literal `.plans/`
 * and `.specs/` substrings, and their slashless `.plans` and `.specs`
 * spellings, so irregular spacing around a mention, a mention that sits
 * on its own wrapped line, or one that names the directory as a bare
 * word without a trailing slash, cannot hide it the way a pattern
 * anchored to one line's exact shape could.
 *
 * ## The exemption is a path rule, not a content rule
 *
 * `isScannedPath` excludes a path two ways: it ends in `.test.ts`, or it
 * sits under `src/tests/`. Both hold regardless of what the file says,
 * which is what lets `src/tests/loop-session-fixtures.ts` — a fixture
 * module, not itself a `*.test.ts` file — keep planting non-default
 * directories without becoming an offender.
 *
 * ## The controls
 *
 * The live claim is an empty offender list, which is exactly what a
 * scanner that has stopped scanning also answers. Nothing in the live
 * tree can demonstrate the scan still fires, so the proof is run against
 * IN-MEMORY text instead: a planted mention of `.plans/`, one of
 * `.specs/`, one carrying both tokens at once, and one surrounded by the
 * irregular tabs and blank lines hand-wrapped prose actually produces.
 * None of the four touch a file on disk, so a clean run of this suite
 * never depends on the plant having been reverted.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'bun:test';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

/**
 * The paths rafa-49 swept every tracked file off of: the slashed forms
 * that name the directory in a path, and the slashless forms that name
 * it as a bare word (a doc referring to "the .plans directory" without
 * a trailing slash is just as much a regression as the slashed form).
 */
const FORBIDDEN_TOKENS = ['.plans/', '.specs/', '.plans', '.specs'] as const;

export interface ScanOffender {
  readonly path: string;
  readonly tokens: readonly string[];
}

/**
 * The one production file exempt from the sweep on its own terms: its
 * whole purpose is naming the two directories rafa used before it had
 * defaults, so `rafa doctor` can warn a project still points at them.
 * See its module note for why the literal old names have to appear
 * there verbatim.
 */
const PRE_INIT_DIRS_PATH = 'src/project/pre-init-dirs.ts';

/**
 * Whether a tracked path is in scope for the sweep.
 *
 * Tests keep their fixtures: a `*.test.ts` case anywhere, or any file
 * under `src/tests/` regardless of its own extension, is exempt. So is
 * {@link PRE_INIT_DIRS_PATH}.
 */
export function isScannedPath(path: string): boolean {
  if (path.endsWith('.test.ts')) return false;
  if (path.startsWith('src/tests/')) return false;
  if (path === PRE_INIT_DIRS_PATH) return false;
  return true;
}

/** Escapes a literal token for use inside a `RegExp`. */
function escapeForRegExp(token: string): string {
  return token.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
}

/**
 * Whether `token` names the directory in `joined`.
 *
 * A slashed token (`.plans/`) is a plain substring test: the trailing
 * slash is already a boundary of its own. A slashless token (`.plans`)
 * instead needs a word boundary on both sides, or it would also fire on
 * an identifier that merely contains the spelling — `context.plansDir`,
 * `tracking.plans` as a config key, `list.plans` as a property path —
 * none of which name the swept directory at all.
 */
function tokenMatches(token: string, joined: string): boolean {
  if (token.endsWith('/')) return joined.includes(token);
  const pattern = new RegExp(`(?<![\\w.])${escapeForRegExp(token)}(?!\\w)`);
  return pattern.test(joined);
}

/**
 * Every forbidden token the text names, read over whitespace-joined
 * prose so a mention split across a hand-wrapped line still matches.
 */
export function forbiddenTokensIn(text: string): string[] {
  const joined = text.replace(/\s+/g, ' ');
  return FORBIDDEN_TOKENS.filter((token) => tokenMatches(token, joined));
}

/**
 * Everything git tracks, as one listing.
 *
 * A failure to run is thrown rather than answered as an empty list: an
 * empty list would make the whole suite pass vacuously, which is the
 * silent fallback this file exists to rule out.
 */
function trackedFiles(root: string): string[] {
  const result = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' });
  return result.split('\0').filter((path) => path !== '');
}

/** The scanned paths carrying at least one forbidden token, with which. */
function scanOffenders(paths: readonly string[], root: string): ScanOffender[] {
  const offenders: ScanOffender[] = [];
  for (const path of paths) {
    const text = readFileSync(join(root, path), 'utf8');
    const tokens = forbiddenTokensIn(text);
    if (tokens.length > 0) offenders.push({ path, tokens });
  }
  return offenders;
}

const TRACKED = trackedFiles(REPO_ROOT);
const SCANNED = TRACKED.filter(isScannedPath);

describe('no tracked file outside the test suite still names .plans/ or .specs/', () => {
  it('has a live tracked set, narrowed by the test exemption', () => {
    expect(TRACKED.length).toBeGreaterThan(0);
    expect(SCANNED.length).toBeGreaterThan(0);
    // Without this, an exemption that swallowed the whole tree would
    // leave every case below vacuously green.
    expect(SCANNED.length).toBeLessThan(TRACKED.length);
  });

  it('excludes *.test.ts files, everything under src/tests/, and pre-init-dirs.ts, nothing else', () => {
    expect(isScannedPath('src/tests/default-plan-dirs.test.ts')).toBe(false);
    expect(isScannedPath('src/tests/loop-session-fixtures.ts')).toBe(false);
    expect(isScannedPath('src/board/gate.test.ts')).toBe(false);
    expect(isScannedPath('src/project/pre-init-dirs.ts')).toBe(false);
    expect(isScannedPath('AGENTS.md')).toBe(true);
    expect(isScannedPath('src/board/gate.ts')).toBe(true);
  });

  it('finds nothing in the live tree', () => {
    const offenders = scanOffenders(SCANNED, REPO_ROOT)
      .map((offender) => `${offender.path}: ${offender.tokens.join(', ')}`);
    expect(offenders).toEqual([]);
  });

  it('catches a planted mention of .plans/, proving the scan can fail', () => {
    const clean = 'The board reads plans from the default directory.';
    expect(forbiddenTokensIn(clean)).toEqual([]);

    // `.plans/` also contains the slashless `.plans` token, so both fire.
    const planted = 'The board used to read from `.plans/` before the move.';
    expect(forbiddenTokensIn(planted)).toEqual(['.plans/', '.plans']);
  });

  it('catches a planted mention of .specs/', () => {
    // `.specs/` also contains the slashless `.specs` token, so both fire.
    const planted = 'Specs used to live under `.specs/` in this checkout.';
    expect(forbiddenTokensIn(planted)).toEqual(['.specs/', '.specs']);
  });

  it('catches both tokens at once, in the order they are declared', () => {
    const planted = 'Move from `.plans/` and `.specs/` to the new defaults.';
    expect(forbiddenTokensIn(planted)).toEqual(['.plans/', '.specs/', '.plans', '.specs']);
  });

  it('catches a mention regardless of the irregular whitespace around it', () => {
    const wrapped = 'The old default lived\tunder   the tracked `.plans/`\n\ndirectory before the move.';
    expect(forbiddenTokensIn(wrapped)).toEqual(['.plans/', '.plans']);
  });

  it('catches a planted slashless mention of .plans, proving the widened scan can fail', () => {
    const clean = 'The board reads plans from the default directory.';
    expect(forbiddenTokensIn(clean)).toEqual([]);

    const planted = 'Config used to default the .plans directory before the move.';
    expect(forbiddenTokensIn(planted)).toEqual(['.plans']);
  });

  it('catches a planted slashless mention of .specs', () => {
    const planted = 'Config used to default the .specs directory before the move.';
    expect(forbiddenTokensIn(planted)).toEqual(['.specs']);
  });

  it('throws rather than answering an empty listing where git cannot run', () => {
    // An empty list would satisfy the live claim above for the wrong
    // reason: nothing to scan, rather than nothing to report.
    expect(() => trackedFiles(join(REPO_ROOT, 'does-not-exist'))).toThrow();
  });
});
