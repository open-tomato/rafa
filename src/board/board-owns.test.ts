/**
 * Tests for the board ownership resolver (`src/board/board-owns.ts`):
 * which source gives a board its folders, and which board owns a path
 * under CODEOWNERS, under `Owns:` lines, and with neither.
 *
 * Every case but the last is a pure call over literal boards and
 * CODEOWNERS text; the last plants files in scratch repositories under
 * `tmpdir`.
 *
 * ## The controls
 *
 *  - Last-match-wins is read both ways round, the same two lines in
 *    either order, so a resolver taking the first match fails one.
 *  - Deepest-folder-wins is read with the boards in either order, so a
 *    resolver taking the first board listed fails one.
 *  - Each "`Owns:` is ignored under CODEOWNERS" case has a twin with no
 *    file where the same `Owns:` line decides, so a resolver that never
 *    reads `Owns:` fails the twin.
 */
import type { OwnedBoard } from './board-owns.js';

import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { boardFolders, ownedBoard, owningBoard, readBoardOwnership } from './board-owns.js';
import { parseCodeowners } from './codeowners.js';

const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-board-owns-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** A board with `owner` and `owns`. */
function board(number: number, owner: string | null, owns: readonly string[] = []): OwnedBoard {
  return { number, owner, owns };
}

const LOOP = board(31, '@acme/loop', ['src']);
const DOCS = board(40, '@acme/docs', ['docs', 'src/board']);

describe('ownedBoard', () => {
  it('reads the owner and folders from the body', () => {
    const body = 'Owner: @acme/loop\nOwns: ./src/board/, docs\n\n- [ ] #252 epics\n';
    expect(ownedBoard({ number: 31, body })).toEqual({ number: 31, owner: '@acme/loop', owns: ['src/board', 'docs'] });
  });

  it('reads a body with neither line as no owner and no folders', () => {
    expect(ownedBoard({ number: 7, body: '- [ ] #252 epics\n' })).toEqual({ number: 7, owner: null, owns: [] });
  });
});

describe('boardFolders', () => {
  const codeowners = parseCodeowners('/src/ @acme/loop\n/docs/ @ACME/Docs @someone\n/src/board/ @acme/loop\n');

  it('answers the CODEOWNERS patterns naming the owner, case folded, in file order', () => {
    expect(boardFolders(LOOP, codeowners)).toEqual({ board: 31, source: 'codeowners', folders: ['/src/', '/src/board/'] });
    expect(boardFolders(DOCS, codeowners)).toEqual({ board: 40, source: 'codeowners', folders: ['/docs/'] });
  });

  it('answers no folders for an owner no CODEOWNERS line names, ignoring its Owns: line', () => {
    expect(boardFolders(board(9, '@acme/none', ['lib']), codeowners))
      .toEqual({ board: 9, source: 'codeowners', folders: [] });
  });

  it('answers the Owns: folders when there is no CODEOWNERS file', () => {
    expect(boardFolders(board(9, '@acme/none', ['lib']), null)).toEqual({ board: 9, source: 'owns', folders: ['lib'] });
  });

  it('answers the whole repository for a board with no owner under CODEOWNERS, even with an Owns: line', () => {
    expect(boardFolders(board(9, null, ['lib']), codeowners)).toEqual({ board: 9, source: 'repository', folders: [] });
  });

  it('answers the whole repository with neither CODEOWNERS nor an Owns: line', () => {
    expect(boardFolders(board(9, '@acme/loop'), null)).toEqual({ board: 9, source: 'repository', folders: [] });
  });
});

describe('owningBoard under CODEOWNERS', () => {
  it('follows the last matching line, read both ways round', () => {
    const loopLast = parseCodeowners('/src/ @acme/docs\n/src/ @acme/loop\n');
    const docsLast = parseCodeowners('/src/ @acme/loop\n/src/ @acme/docs\n');
    expect(owningBoard('src/a.ts', [LOOP, DOCS], loopLast)).toEqual({ board: 31, source: 'codeowners', match: '/src/' });
    expect(owningBoard('src/a.ts', [LOOP, DOCS], docsLast)).toEqual({ board: 40, source: 'codeowners', match: '/src/' });
  });

  it('lets a later, broader line beat an earlier, deeper one', () => {
    const codeowners = parseCodeowners('/src/board/ @acme/docs\n*.ts @acme/loop\n');
    expect(owningBoard('src/board/x.ts', [LOOP, DOCS], codeowners)?.board).toBe(31);
    expect(owningBoard('src/board/x.md', [LOOP, DOCS], codeowners)?.board).toBe(40);
  });

  it('ignores Owns: lines, where the same lines decide without the file', () => {
    const codeowners = parseCodeowners('/src/ @acme/loop\n');
    expect(owningBoard('src/board/x.ts', [LOOP, DOCS], codeowners)?.board).toBe(31);
    expect(owningBoard('src/board/x.ts', [LOOP, DOCS], null)?.board).toBe(40);
  });

  it('takes the first listed owner that a board names', () => {
    const codeowners = parseCodeowners('/src/ @stranger @acme/docs @acme/loop\n');
    expect(owningBoard('src/a.ts', [LOOP, DOCS], codeowners)?.board).toBe(40);
  });

  it('gives two boards naming one handle to the lower number', () => {
    const codeowners = parseCodeowners('/src/ @acme/loop\n');
    const twin = board(12, '@acme/loop');
    expect(owningBoard('src/a.ts', [LOOP, twin], codeowners)?.board).toBe(12);
  });

  it('falls to the whole-repository board when the last match unassigns, even over an earlier owned line', () => {
    const codeowners = parseCodeowners('/src/ @acme/loop\n/src/gen/\n');
    const whole = board(50, null);
    expect(owningBoard('src/gen/a.ts', [LOOP, whole], codeowners)).toEqual({ board: 50, source: 'repository', match: null });
    expect(owningBoard('src/gen/a.ts', [LOOP], codeowners)).toBeNull();
    expect(owningBoard('src/a.ts', [LOOP, whole], codeowners)?.board).toBe(31);
  });

  it('answers null for a path no line matches and no whole-repository board', () => {
    const codeowners = parseCodeowners('/src/ @acme/loop\n');
    expect(owningBoard('README.md', [LOOP, DOCS], codeowners)).toBeNull();
    expect(owningBoard('README.md', [LOOP, board(60, null)], codeowners)?.board).toBe(60);
  });

  it('answers null for a last match naming only handles no board has', () => {
    const codeowners = parseCodeowners('/src/ @acme/loop\n/src/ @stranger\n');
    expect(owningBoard('src/a.ts', [LOOP], codeowners)).toBeNull();
  });
});

describe('owningBoard with Owns: lines', () => {
  it('lets the deepest folder win, whichever board is listed first', () => {
    expect(owningBoard('src/board/x.ts', [LOOP, DOCS], null)).toEqual({ board: 40, source: 'owns', match: 'src/board' });
    expect(owningBoard('src/board/x.ts', [DOCS, LOOP], null)).toEqual({ board: 40, source: 'owns', match: 'src/board' });
    expect(owningBoard('src/cli/x.ts', [DOCS, LOOP], null)).toEqual({ board: 31, source: 'owns', match: 'src' });
  });

  it('holds a folder itself but never a sibling sharing its prefix', () => {
    const narrow = board(8, '@a/b', ['src/b']);
    expect(owningBoard('src/b', [narrow], null)?.board).toBe(8);
    expect(owningBoard('src/b/', [narrow], null)?.board).toBe(8);
    expect(owningBoard('src/board/x.ts', [narrow], null)).toBeNull();
  });

  it('reads ./ and / openings off the path', () => {
    expect(owningBoard('./docs/a.md', [LOOP, DOCS], null)?.board).toBe(40);
    expect(owningBoard('/docs/a.md', [LOOP, DOCS], null)?.board).toBe(40);
  });

  it('gives two boards naming one folder to the lower number', () => {
    expect(owningBoard('lib/a.ts', [board(20, null, ['lib']), board(10, null, ['lib'])], null)?.board).toBe(10);
  });

  it('falls to the lowest whole-repository board outside every folder', () => {
    const boards = [LOOP, board(70, null), board(60, '@acme/x')];
    expect(owningBoard('README.md', boards, null)).toEqual({ board: 60, source: 'repository', match: null });
    expect(owningBoard('src/a.ts', boards, null)?.board).toBe(31);
  });

  it('answers null outside every folder with no whole-repository board', () => {
    expect(owningBoard('README.md', [LOOP, DOCS], null)).toBeNull();
  });
});

describe('readBoardOwnership', () => {
  /** A scratch repository holding `files`, repo-relative path to text. */
  function plantRepo(files: Readonly<Record<string, string>>): string {
    const root = mkdtempSync(join(tempBase, 'repo-'));
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(join(root, path, '..'), { recursive: true });
      writeFileSync(join(root, path), text);
    }
    return root;
  }

  it('reads the CODEOWNERS file once and answers every board under it', () => {
    const root = plantRepo({ '.github/CODEOWNERS': '/src/ @acme/loop\n' });
    const ownership = readBoardOwnership(root, [LOOP, DOCS]);
    expect(ownership.codeowners?.path).toBe('.github/CODEOWNERS');
    expect(ownership.boards).toEqual([
      { board: 31, source: 'codeowners', folders: ['/src/'] },
      { board: 40, source: 'codeowners', folders: [] },
    ]);
  });

  it('answers the Owns: folders in a repository without the file', () => {
    const root = plantRepo({ 'README.md': 'hello\n' });
    const ownership = readBoardOwnership(root, [LOOP, board(5, null)]);
    expect(ownership.codeowners).toBeNull();
    expect(ownership.boards).toEqual([
      { board: 31, source: 'owns', folders: ['src'] },
      { board: 5, source: 'repository', folders: [] },
    ]);
  });
});
