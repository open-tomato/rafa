/**
 * The tree stays swept of moved paths: no tracked prose or code file still
 * names a `from` path of any move list under `scripts/codemod/moves/`, with
 * the `.ts` dropped or kept. The codemod rewrites such mentions when it
 * runs; this suite holds the tree to it afterwards, so a doc line or a
 * comment written later against the old path is caught.
 *
 * ## Scope
 *
 * Scanned: `.md` files under `context/`, `docs/` (less `docs/survey/`),
 * `.claude/`, `README.md` and `AGENTS.md`, and every code file under
 * `src/`, `scripts/` and `packages/` (JSON is not code here: a package's
 * own tsconfig names `src/…` relative to the package). Exempt: `*.test.ts` files,
 * `src/tests/`, fixture and `testdata/` paths (`isFixturePath`),
 * `CHANGELOG.md`, the move lists and the codemod's own files.
 *
 * ## Joined prose
 *
 * As in `default-plan-dirs.sweep.test.ts`, a file is read as a
 * whitespace-normalised copy, so a path split across a hand-wrapped line
 * still matches.
 *
 * ## Boundaries
 *
 * A path counts only as a whole token: it may not continue a longer path
 * (`packages/rafa/src/utils/git` holds `src/utils/git` and is no stale
 * mention) nor run on into a longer name (`src/utils/git-hooks`).
 *
 * ## The controls
 *
 * The live claim is an empty offender list, which a scanner that stopped
 * scanning also answers. The proof runs against in-memory text: a mention
 * with the extension, one without, and one split across a wrapped line.
 */
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, setDefaultTimeout } from 'bun:test';

import { isFixturePath } from '../fixtures/fixture-path.js';

import { SWEEP_TIMEOUT } from './sweep-timeout.js';

setDefaultTimeout(SWEEP_TIMEOUT);

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const MOVES_DIR = 'scripts/codemod/moves/';
const CODEMOD_DIR = 'scripts/codemod/';
const CODE_EXTENSIONS = ['.ts', '.tsx', '.js', '.mjs', '.cjs', '.mts', '.cts'];
const CODE_ROOTS = ['src/', 'scripts/', 'packages/'];
const PROSE_ROOTS = ['context/', 'docs/', '.claude/'];
const PROSE_FILES = ['README.md', 'AGENTS.md'];
const SURVEY_DIR = 'docs/survey/';
const CHANGELOG_NAME = 'CHANGELOG.md';

interface MoveEntry {
  readonly from: string;
}

/** Every `from` of every move list file under the moves folder. */
async function loadFroms(root: string): Promise<string[]> {
  const dir = join(root, MOVES_DIR);
  const lists = readdirSync(dir)
    .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts') && name !== 'types.ts');
  const froms: string[] = [];
  for (const name of lists) {
    const loaded = await import(join(dir, name)) as Record<string, unknown>;
    for (const value of Object.values(loaded)) {
      if (!Array.isArray(value)) continue;
      for (const entry of value as MoveEntry[]) {
        if (typeof entry?.from === 'string') froms.push(entry.from);
      }
    }
  }
  return froms;
}

/** Whether a tracked path is in scope for the sweep. */
export function isScannedPath(path: string): boolean {
  if (path.endsWith('.test.ts')) return false;
  if (path.startsWith('src/tests/')) return false;
  if (path.startsWith(MOVES_DIR) || path.startsWith(CODEMOD_DIR)) return false;
  if (path === CHANGELOG_NAME || path.endsWith(`/${CHANGELOG_NAME}`)) return false;
  if (isFixturePath(path)) return false;
  if (PROSE_FILES.includes(path)) return true;
  if (path.endsWith('.md')) {
    if (path.startsWith(SURVEY_DIR)) return false;
    return PROSE_ROOTS.some((prefix) => path.startsWith(prefix));
  }
  if (path.startsWith(SURVEY_DIR)) return false;
  return CODE_ROOTS.some((prefix) => path.startsWith(prefix))
    && CODE_EXTENSIONS.some((extension) => path.endsWith(extension));
}

function escapeForRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
}

/** The `from` paths (as listed, `.ts` kept) the text names, joined over whitespace. */
export function stalePathsIn(text: string, froms: readonly string[]): string[] {
  const joined = text.replace(/\s+/g, ' ');
  return froms.filter((from) => {
    const stem = from.replace(/\.ts$/, '');
    const pattern = new RegExp(`(?<![\\w./@-])${escapeForRegExp(stem)}(?![\\w-]|/)`);
    return pattern.test(joined);
  });
}

function trackedFiles(root: string): string[] {
  const result = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' });
  return result.split('\0').filter((path) => path !== '');
}

const FROMS = await loadFroms(REPO_ROOT);
const TRACKED = trackedFiles(REPO_ROOT);
const SCANNED = TRACKED.filter(isScannedPath);

describe('no tracked file still names a path a move list moved away from', () => {
  it('reads a live move list and a live tracked set, narrowed by the exemptions', () => {
    expect(FROMS.length).toBeGreaterThan(0);
    expect(SCANNED.length).toBeGreaterThan(0);
    expect(SCANNED.length).toBeLessThan(TRACKED.length);
  });

  it('excludes tests, src/tests, fixtures, the changelog, the move lists and the codemod, nothing else', () => {
    expect(isScannedPath('src/board/gate.test.ts')).toBe(false);
    expect(isScannedPath('src/tests/moved-paths.sweep.test.ts')).toBe(false);
    expect(isScannedPath('packages/rafa/src/effort/store/testdata/a.json')).toBe(false);
    expect(isScannedPath('CHANGELOG.md')).toBe(false);
    expect(isScannedPath('scripts/codemod/moves/pass-1.ts')).toBe(false);
    expect(isScannedPath('scripts/codemod/pass-moves.ts')).toBe(false);
    expect(isScannedPath('docs/survey/cut-table.md')).toBe(false);
    expect(isScannedPath('context/source.md')).toBe(true);
    expect(isScannedPath('AGENTS.md')).toBe(true);
    expect(isScannedPath('.claude/skills/rafa-tooling/SKILL.md')).toBe(true);
    expect(isScannedPath('src/board/gate.ts')).toBe(true);
    expect(isScannedPath('scripts/survey/core-moves.ts')).toBe(true);
    expect(isScannedPath('packages/rafa/src/utils/git.ts')).toBe(true);
  });

  it('finds nothing in the live tree', () => {
    const offenders: string[] = [];
    for (const path of SCANNED) {
      if (statSync(join(REPO_ROOT, path)).isDirectory()) continue;
      const text = readFileSync(join(REPO_ROOT, path), 'utf8');
      const stale = stalePathsIn(text, FROMS);
      if (stale.length > 0) offenders.push(`${path}: ${stale.join(', ')}`);
    }
    expect(offenders).toEqual([]);
  });

  const LISTED = ['src/utils/git.ts'];

  it('catches a planted mention with the extension', () => {
    expect(stalePathsIn('See `src/utils/git.ts` for the helper.', LISTED)).toEqual(LISTED);
  });

  it('catches a planted mention without the extension', () => {
    expect(stalePathsIn('The helper lives in src/utils/git now.', LISTED)).toEqual(LISTED);
  });

  it('catches a planted mention split across a wrapped line', () => {
    expect(stalePathsIn('The helper lives in\n  src/utils/git.ts\nstill.', LISTED)).toEqual(LISTED);
    expect(stalePathsIn('The helper lives in\n\n  `src/utils/git`\n and more.', LISTED)).toEqual(LISTED);
  });

  it('leaves the new path and longer names alone', () => {
    expect(stalePathsIn('At packages/rafa/src/utils/git.ts and src/utils/git-hooks.ts.', LISTED)).toEqual([]);
  });

  it('throws rather than answering an empty listing where git cannot run', () => {
    expect(() => trackedFiles(join(REPO_ROOT, 'does-not-exist'))).toThrow();
  });
});
