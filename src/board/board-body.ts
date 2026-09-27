/**
 * The body of a board issue, read: its ordered checklist, the handle its
 * `Owner:` line names and the folders its `Owns:` line names, with every
 * line a body got wrong named as a problem.
 *
 * A board is an open issue labelled `type:roadmap`
 * (`.rafa/specs/rafa-245-boards-several-roadmaps-per.md`). Its body holds
 * an ordered `- [ ] #<n>` checklist of epics (spec lines still work), an
 * optional `Owner:` line and an optional `Owns:` line:
 *
 * ```markdown
 * Owner: @open-tomato/loop
 * Owns: src/board/, ./src/commands
 *
 * - [ ] #252 epics and boards
 * - [ ] #260 the release epic
 * ```
 *
 * Nothing here spawns `gh`, reads git or opens a file:
 * {@link readBoardBody} is a pure function over the body text, so every
 * case in `./board-body.test.ts` is a literal string.
 *
 * ## The checklist is the roadmap's
 *
 * The ordered lines are {@link parseRoadmapBody}'s answer, taken whole,
 * so a board and the one roadmap it replaces are read by one rule. Which
 * line is an epic and which a spec is the board listing's to say, not
 * this module's.
 *
 * ## The field lines
 *
 * `Owner:` and `Owns:` are found by the epic body's own field reader
 * (`findField` in `./epic-body.ts`): case folded, at the start of a line
 * after up to three spaces and an optional bullet, emphasis taken off,
 * the colon required, fenced lines skipped, and the FIRST such line is
 * the field — a second is left alone. Both lines are optional, so their
 * absence is no problem.
 *
 * - The OWNER is one handle, backticks taken off: `@login` for a person
 *   or `@org/team` for a team. A login or org is letters, digits and
 *   single hyphens, neither opening nor closing with one, up to 39
 *   characters, as GitHub allows; a team slug is letters, digits, `-`,
 *   `_` and `.`. Anything else — no `@`, two handles, a blank line after
 *   the colon — is malformed: it is reported and the board read as having
 *   NO owner, because a guessed owner would hand a team folders nobody
 *   gave it.
 * - The OWNS line names folders separated by commas or whitespace,
 *   backticks taken off. Each is normalised to a repo-relative path:
 *   every leading `./` and every trailing `/` taken off, so `./src/board/`
 *   and `src/board` are one folder and a deepest-folder comparison reads
 *   them alike. The normalised folders are deduped in the order written.
 *   A folder that is absolute (opens with `/`), climbs out with a `..`
 *   segment, or normalises to nothing (`.`, `./`) is malformed: the
 *   readable folders are kept and the rejected ones are named in one
 *   problem. An empty `Owns:` line reads as no folders, as the epic body
 *   reads one.
 *
 * ## Problems
 *
 * A malformed line is reported in {@link BoardBody.problems}, one entry per
 * line: the reader never throws, because a board read that stopped on one
 * badly written line would hide the rest of the board.
 * {@link boardBodyProblemMessage} spells the sentence a report prints for
 * each.
 */
import type { RoadmapLine } from './roadmap.js';

import { bodyLines, findField } from './epic-body.js';
import { parseRoadmapBody } from './roadmap.js';

/** The optional owner field's name. */
export const OWNER_FIELD = 'Owner';

/** The optional owned-folders field's name. */
export const BOARD_OWNS_FIELD = 'Owns';

/** A GitHub login or organisation: alphanumerics and single inner hyphens, up to 39. */
const LOGIN = '[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}';

/** A team slug after the organisation's slash. */
const TEAM = '[A-Za-z0-9][A-Za-z0-9_.-]*';

/** One owner handle, whole: `@login` or `@org/team`. */
const HANDLE = new RegExp(`^@${LOGIN}(?:/${TEAM})?$`, 'u');

/** What separates two folders on an `Owns:` line. */
const OWNS_SEPARATOR = /[\s,]+/u;

/** Which line a problem is about. */
export type BoardBodyProblemKind =
  /** An `Owner:` line that is not one `@login` or `@org/team`. */
  | 'malformed-owner'
  /** An `Owns:` line naming a folder that is not repo-relative. */
  | 'malformed-owns';

/** One malformed line in a board body. */
export interface BoardBodyProblem {
  /** Which line it is about. */
  readonly kind: BoardBodyProblemKind;
  /** The 1-based line it sits on. */
  readonly line: number;
  /** What the line said after its colon, trimmed. */
  readonly text: string;
  /** The folders rejected, as written; empty for an owner problem. */
  readonly rejected: readonly string[];
}

/** A board body, read. */
export interface BoardBody {
  /** The checklist, as {@link parseRoadmapBody} reads it. */
  readonly lines: readonly RoadmapLine[];
  /** The owner handle, `@login` or `@org/team`; null when absent or malformed. */
  readonly owner: string | null;
  /** The owned folders, repo-relative, deduped in order; empty when none. */
  readonly owns: readonly string[];
  /** Every malformed line, owner first. */
  readonly problems: readonly BoardBodyProblem[];
}

/** `text` with backticks taken off and trimmed. */
function undressed(text: string): string {
  return text.replaceAll('`', ' ').trim();
}

/** `folder` with every leading `./` and every trailing `/` taken off. */
export function normaliseFolder(folder: string): string {
  let path = folder;
  while (path.startsWith('./')) path = path.slice(2);
  while (path.endsWith('/')) path = path.slice(0, -1);
  return path;
}

/** True when the normalised `path` names a folder inside the repository. */
function isRepoRelative(path: string): boolean {
  if (path === '' || path === '.' || path.startsWith('/')) return false;
  return !path.split('/').includes('..');
}

/** The folders and rejected entries an `Owns:` line's text names. */
function ownedFolders(text: string): { readonly owns: readonly string[]; readonly rejected: readonly string[] } {
  const named = undressed(text).split(OWNS_SEPARATOR)
    .filter((folder) => folder !== '');
  const owns = named.map(normaliseFolder).filter(isRepoRelative);
  const rejected = named.filter((folder) => !isRepoRelative(normaliseFolder(folder)));
  return { owns: [...new Set(owns)], rejected };
}

/**
 * The board body `body`, read: its checklist, owner and folders, and
 * every malformed line in {@link BoardBody.problems}. Never throws; the
 * module note holds why.
 */
export function readBoardBody(body: string): BoardBody {
  const lines = bodyLines(body);
  const ownerLine = findField(lines, OWNER_FIELD);
  const ownsLine = findField(lines, BOARD_OWNS_FIELD);

  const handle = ownerLine === null
    ? null
    : undressed(ownerLine.text);
  const isOwned = handle !== null && HANDLE.test(handle);
  const folders = ownsLine === null
    ? { owns: [], rejected: [] }
    : ownedFolders(ownsLine.text);

  const problems: readonly (BoardBodyProblem | null)[] = [
    ownerLine === null || isOwned
      ? null
      : { kind: 'malformed-owner', line: ownerLine.number, text: ownerLine.text, rejected: Object.freeze([]) },
    ownsLine === null || folders.rejected.length === 0
      ? null
      : { kind: 'malformed-owns', line: ownsLine.number, text: ownsLine.text, rejected: Object.freeze(folders.rejected) },
  ];

  return Object.freeze({
    lines: parseRoadmapBody(body),
    owner: isOwned
      ? handle
      : null,
    owns: Object.freeze(folders.owns),
    problems: Object.freeze(problems.filter((problem) => problem !== null)),
  });
}

/**
 * The sentence a report prints for one of board `issue`'s body problems:
 * the board, the line, what is wrong with it and what an author writes
 * to fix it.
 */
export function boardBodyProblemMessage(issue: number, problem: BoardBodyProblem): string {
  const id = `board #${String(issue)}`;
  const at = `on line ${String(problem.line)}`;

  if (problem.kind === 'malformed-owns') {
    const names = problem.rejected.map((folder) => `"${folder}"`).join(', ');
    return `${id} has an "${BOARD_OWNS_FIELD}:" line ${at} naming ${names}, which is not a folder inside the repository;`
      + ' name folders relative to the repository root, such as src/board';
  }
  return `${id} has an "${OWNER_FIELD}:" line ${at} reading "${problem.text}", which is not one @login or @org/team handle;`
    + ' it is read as having no owner until the line is fixed';
}
