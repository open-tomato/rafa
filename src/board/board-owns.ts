/**
 * Which folders each board owns, and which board owns a path.
 *
 * `.rafa/specs/rafa-245-boards-several-roadmaps-per.md` gives a board its
 * folders by three ranked sources. When the repository has a CODEOWNERS
 * file, a board's folders are the CODEOWNERS paths for its owner team,
 * "read with GitHub's own last-match rule so rafa and GitHub never
 * disagree". Without CODEOWNERS, the board's `Owns:` line applies,
 * deepest folder winning. With neither, the board owns the whole
 * repository.
 *
 * Nothing here spawns or reads git: {@link boardFolders} and
 * {@link owningBoard} are pure over a board list and a CODEOWNERS file
 * already read (`readCodeowners` in `./codeowners.js`), and
 * {@link readBoardOwnership} is the one call that opens the file.
 *
 * ## A board's folders
 *
 * {@link boardFolders} answers one {@link BoardOwnsSource} per board:
 *
 * - `codeowners` when the repository has the file AND the board has an
 *   `Owner:` handle. Its folders are the patterns of every CODEOWNERS
 *   rule naming that handle, in file order, compared case folded as
 *   GitHub compares handles (`rulesNaming`). The list may be empty: an
 *   owner no line names owns nothing, as on GitHub. A pattern listed
 *   here still loses the paths a later line gives someone else; which
 *   board owns one path is {@link owningBoard}'s answer, not this list's.
 * - `owns` when the repository has NO CODEOWNERS file and the board's
 *   `Owns:` line names at least one folder. Under a CODEOWNERS file the
 *   `Owns:` line is never read, so the file is the only word on
 *   ownership once it exists.
 * - `repository` otherwise: the board owns the whole repository, and its
 *   folder list is empty. That covers a board with no `Owner:` line under
 *   a CODEOWNERS file, which has no team for the file to name, so the
 *   one board of a project that never wrote an `Owner:` line keeps
 *   owning everything whether or not the repository has CODEOWNERS.
 *
 * ## The owning board of a path
 *
 * {@link owningBoard} answers one board or null, ranked:
 *
 *  1. Under CODEOWNERS, the LAST matching rule decides (`lastMatchingRule`).
 *     Its owners are taken in the order written, and the first that some
 *     `codeowners` board names wins; two boards naming that one handle
 *     go to the lower number. A path no rule matches, one whose last
 *     match unassigns, and one whose last match names no board's owner
 *     fall to rank 3: an earlier matching line is never consulted,
 *     because on GitHub it no longer owns the path either.
 *  2. Without CODEOWNERS, the DEEPEST `Owns:` folder holding the path
 *     wins, depth counted in segments; a folder holds itself and
 *     everything under it, never a sibling sharing its prefix (`src/b`
 *     does not hold `src/board`). Two boards naming one folder go to the
 *     lower number.
 *  3. The lowest-numbered `repository` board, a whole-repository owner
 *     being the shallowest folder of all; null when there is none.
 *
 * Paths are repo-relative; a leading `./` or `/` and a trailing `/` are
 * taken off before any comparison, as the `Owns:` reader takes them off
 * its folders.
 */
import type { Codeowners } from './codeowners.js';
import type { BoardIssue } from './roadmap-board.js';

import { readBoardBody } from './board-body.js';
import { lastMatchingRule, readCodeowners, rulesNaming } from './codeowners.js';

/** A board, as ownership reads it. */
export interface OwnedBoard {
  /** The board's issue number. */
  readonly number: number;
  /** Its `Owner:` handle, or null when absent or malformed. */
  readonly owner: string | null;
  /** Its `Owns:` folders, repo-relative and normalised; empty when none. */
  readonly owns: readonly string[];
}

/** Where a board's folders came from; the module note ranks them. */
export type BoardOwnsSource = 'codeowners' | 'owns' | 'repository';

/** One board's folders. */
export interface BoardFolders {
  /** The board's issue number. */
  readonly board: number;
  /** Where the folders came from. */
  readonly source: BoardOwnsSource;
  /** CODEOWNERS patterns or `Owns:` folders, in order; empty for `repository`. */
  readonly folders: readonly string[];
}

/** The board owning one path, and what gave it the path. */
export interface PathOwner {
  /** The owning board's issue number. */
  readonly board: number;
  /** Which source decided. */
  readonly source: BoardOwnsSource;
  /** The CODEOWNERS pattern or `Owns:` folder that matched; null for `repository`. */
  readonly match: string | null;
}

/** Every board's folders, read once, with the file they were read under. */
export interface BoardOwnership {
  /** The CODEOWNERS file, or null when the repository has none. */
  readonly codeowners: Codeowners | null;
  /** Each board's folders, in the order the boards were given. */
  readonly boards: readonly BoardFolders[];
}

/** The ownership fields of board `issue`, read from its body. */
export function ownedBoard(issue: Pick<BoardIssue, 'number' | 'body'>): OwnedBoard {
  const { owner, owns } = readBoardBody(issue.body);
  return Object.freeze({ number: issue.number, owner, owns });
}

/**
 * Board `board`'s folders under `codeowners`, the repository's
 * CODEOWNERS file or null when it has none. The module note holds the
 * ranking.
 */
export function boardFolders(board: OwnedBoard, codeowners: Pick<Codeowners, 'rules'> | null): BoardFolders {
  if (codeowners !== null && board.owner !== null) {
    const folders = rulesNaming(codeowners, board.owner).map((rule) => rule.pattern);
    return Object.freeze({ board: board.number, source: 'codeowners', folders: Object.freeze(folders) });
  }
  if (codeowners === null && board.owns.length > 0) {
    return Object.freeze({ board: board.number, source: 'owns', folders: Object.freeze([...board.owns]) });
  }
  return Object.freeze({ board: board.number, source: 'repository', folders: Object.freeze([]) });
}

/** `path` repo-relative: leading `./` and `/`, and trailing `/`, taken off. */
function repoPath(path: string): string {
  let relative = path;
  while (relative.startsWith('./') || relative.startsWith('/')) {
    relative = relative.startsWith('/')
      ? relative.slice(1)
      : relative.slice(2);
  }
  while (relative.endsWith('/')) relative = relative.slice(0, -1);
  return relative;
}

/** True when `folder` is `path` or a folder above it. */
function holds(folder: string, path: string): boolean {
  return path === folder || path.startsWith(`${folder}/`);
}

/** `boards` lowest number first, as a copy. */
function byNumber(boards: readonly BoardFolders[]): readonly BoardFolders[] {
  return [...boards].sort((a, b) => a.board - b.board);
}

/** Rank 1 of the module note: the board the last matching CODEOWNERS rule names. */
function codeownersOwner(
  path: string,
  boards: readonly OwnedBoard[],
  folders: readonly BoardFolders[],
  codeowners: Pick<Codeowners, 'rules'>,
): PathOwner | null {
  const rule = lastMatchingRule(codeowners, path);
  if (rule === null) return null;

  const ranked = byNumber(folders.filter((entry) => entry.source === 'codeowners'));
  const ownerOf = new Map(boards.map((board) => [board.number, board.owner?.toLowerCase() ?? null]));
  for (const named of rule.owners) {
    const wanted = named.toLowerCase();
    const board = ranked.find((entry) => ownerOf.get(entry.board) === wanted);
    if (board !== undefined) return Object.freeze({ board: board.board, source: 'codeowners', match: rule.pattern });
  }
  return null;
}

/** Rank 2 of the module note: the board with the deepest `Owns:` folder holding `path`. */
function ownsOwner(path: string, folders: readonly BoardFolders[]): PathOwner | null {
  let best: { readonly board: number; readonly folder: string; readonly depth: number } | null = null;
  for (const entry of byNumber(folders.filter((candidate) => candidate.source === 'owns'))) {
    for (const folder of entry.folders) {
      const depth = folder.split('/').length;
      if (holds(folder, path) && (best === null || depth > best.depth)) {
        best = { board: entry.board, folder, depth };
      }
    }
  }
  return best === null
    ? null
    : Object.freeze({ board: best.board, source: 'owns', match: best.folder });
}

/**
 * The board owning `path` among `boards` under `codeowners`, the
 * repository's CODEOWNERS file or null when it has none; null when no
 * board owns it. The module note holds the ranking.
 */
export function owningBoard(
  path: string,
  boards: readonly OwnedBoard[],
  codeowners: Pick<Codeowners, 'rules'> | null,
): PathOwner | null {
  const relative = repoPath(path);
  const folders = boards.map((board) => boardFolders(board, codeowners));
  const specific = codeowners === null
    ? ownsOwner(relative, folders)
    : codeownersOwner(relative, boards, folders, codeowners);
  if (specific !== null) return specific;

  const [whole] = byNumber(folders.filter((entry) => entry.source === 'repository'));
  return whole === undefined
    ? null
    : Object.freeze({ board: whole.board, source: 'repository', match: null });
}

/**
 * Every board's folders in the repository at `root`, its CODEOWNERS file
 * read once. Throws, as `readCodeowners` does, when the file is found
 * but cannot be read.
 */
export function readBoardOwnership(root: string, boards: readonly OwnedBoard[]): BoardOwnership {
  const codeowners = readCodeowners(root);
  return Object.freeze({
    codeowners,
    boards: Object.freeze(boards.map((board) => boardFolders(board, codeowners))),
  });
}
