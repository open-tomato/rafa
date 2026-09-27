/**
 * `owningBoard` over a scratch repository read by `readBoardOwnership`
 * (`src/board/board-owns.ts`): two boards and a real CODEOWNERS file on
 * disk, read the way a command reads them, not literal text handed to a
 * pure call.
 *
 * The unit tests in `board-owns.test.ts` already cover the ranking rules
 * over literal input; this file holds the three claims that only show up
 * once a file is actually read from a repository:
 *
 *  - Every path's owning board matches the LAST CODEOWNERS line matching
 *    it, read straight off disk.
 *  - The same boards' `Owns:` folders decide ownership only in the twin
 *    repository that has no CODEOWNERS file; with the file present they
 *    are read (`readBoardOwnership` still reports the `Owns:` folders as
 *    unused) but never change who owns a path.
 *  - A board with neither an `Owner:` naming a CODEOWNERS line nor an
 *    `Owns:` line owns every path, CODEOWNERS or not.
 */
import type { OwnedBoard } from './board-owns.js';

import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { owningBoard, readBoardOwnership } from './board-owns.js';
import { lastMatchingRule, ownersOf } from './codeowners.js';

const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-board-owns-integration-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** A scratch repository holding `files`, repo-relative path to text. */
function plantRepo(files: Readonly<Record<string, string>>): string {
  const root = mkdtempSync(join(tempBase, 'repo-'));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(root, path, '..'), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

/** A board with `owner` and `owns`. */
function board(number: number, owner: string | null, owns: readonly string[] = []): OwnedBoard {
  return { number, owner, owns };
}

const LOOP = board(31, '@acme/loop', ['src']);
const DOCS = board(40, '@acme/docs', ['docs']);

const CODEOWNERS_TEXT = [
  '*             @acme/loop',
  '/src/         @acme/loop',
  '/src/gen/     @acme/docs',
  '/docs/        @acme/docs',
  '/docs/legal/  @acme/loop',
].join('\n');

const PATHS = [
  'README.md',
  'src/index.ts',
  'src/gen/api.ts',
  'src/gen/deep/api.ts',
  'docs/guide.md',
  'docs/legal/notice.md',
];

describe('owningBoard over a scratch repository with CODEOWNERS', () => {
  const root = plantRepo({ '.github/CODEOWNERS': `${CODEOWNERS_TEXT}\n` });
  const ownership = readBoardOwnership(root, [LOOP, DOCS]);

  it('reads the file once, from .github/CODEOWNERS', () => {
    expect(ownership.codeowners?.path).toBe('.github/CODEOWNERS');
  });

  it('gives every path to the board the LAST matching CODEOWNERS line names', () => {
    for (const path of PATHS) {
      const rule = lastMatchingRule({ rules: ownership.codeowners?.rules ?? [] }, path);
      const owners = ownersOf({ rules: ownership.codeowners?.rules ?? [] }, path);
      const wantedBoard = owners.includes('@acme/docs')
        ? 40
        : owners.includes('@acme/loop')
          ? 31
          : null;

      const owner = owningBoard(path, [LOOP, DOCS], ownership.codeowners);

      expect(owner?.board ?? null).toBe(wantedBoard);
      expect(owner?.match ?? null).toBe(wantedBoard === null
        ? null
        : (rule?.pattern ?? null));
    }
  });

  it('ignores both boards\' Owns: lines while the file exists', () => {
    // Owns: src -> LOOP and Owns: docs -> DOCS would give the same answer
    // here, so this reads a path where Owns: and CODEOWNERS disagree: the
    // rule at the top of the file hands src/gen to loop's Owns: folder but
    // the last matching CODEOWNERS line hands it to docs.
    expect(owningBoard('src/gen/api.ts', [LOOP, DOCS], ownership.codeowners)?.board).toBe(40);
  });
});

describe('owningBoard over the same boards without CODEOWNERS', () => {
  const root = plantRepo({ 'README.md': '# hi\n' });
  const ownership = readBoardOwnership(root, [LOOP, DOCS]);

  it('finds no file and falls back to each board\'s Owns: folders', () => {
    expect(ownership.codeowners).toBeNull();
    expect(ownership.boards).toEqual([
      { board: 31, source: 'owns', folders: ['src'] },
      { board: 40, source: 'owns', folders: ['docs'] },
    ]);
  });

  it('now lets Owns: decide the same path CODEOWNERS gave to the other board', () => {
    // Same path as the CODEOWNERS case above, opposite board: proof that
    // Owns: only speaks once the file is gone, not merely that both
    // resolvers can name board 40 somehow.
    expect(owningBoard('src/gen/api.ts', [LOOP, DOCS], ownership.codeowners)?.board).toBe(31);
  });

  it('leaves a path outside every Owns: folder with no owner', () => {
    expect(owningBoard('README.md', [LOOP, DOCS], ownership.codeowners)).toBeNull();
  });
});

describe('a board with neither an Owner: nor an Owns: line', () => {
  const WHOLE = board(99, null);

  it('owns every path once CODEOWNERS is read, alongside a board CODEOWNERS does name', () => {
    const root = plantRepo({ 'CODEOWNERS': '/src/ @acme/loop\n' });
    const ownership = readBoardOwnership(root, [LOOP, WHOLE]);

    for (const path of ['src/a.ts', 'docs/a.md', 'README.md', 'anywhere/deep/file.ts']) {
      const owner = owningBoard(path, [LOOP, WHOLE], ownership.codeowners);
      if (path.startsWith('src/')) {
        expect(owner?.board).toBe(31);
      } else {
        expect(owner).toEqual({ board: 99, source: 'repository', match: null });
      }
    }
  });

  it('owns every path once CODEOWNERS is absent too', () => {
    const root = plantRepo({ 'README.md': '# hi\n' });
    const ownership = readBoardOwnership(root, [WHOLE]);

    expect(ownership.codeowners).toBeNull();
    for (const path of ['src/a.ts', 'docs/a.md', 'README.md', 'anywhere/deep/file.ts']) {
      expect(owningBoard(path, [WHOLE], ownership.codeowners)).toEqual({ board: 99, source: 'repository', match: null });
    }
  });
});
