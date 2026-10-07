/**
 * Gate 4 of `rafa issue edit`, spec to code: whether the state an issue
 * is in lets an edit through, read from its labels, whether it is open,
 * and whether a saved copy of it sits under `specs.dir`
 * (`.rafa/specs/rafa-812-spec-rafa-issue-edit.md`, the Design table).
 *
 * {@link readEditState} is a pure reading over what the command hands
 * it: it refuses nothing and writes nothing, and the command turns a
 * refusal into `CommandExit(2, {@link editStateRefusalMessage})`, before
 * anything is written. {@link findSavedCopies} is the one read of the
 * filesystem here, and it only lists a directory.
 *
 * ## The table
 *
 * ```text
 * state of the issue                    append            replace / title
 * no plan, not ready                    appended          allowed
 * spec:ready, no saved copy             appended          refused spec-ready
 * saved copy exists (planned)           stale-copy        refused planned
 * rafa:claimed or rafa:in-development   refused           refused in-development
 *                                       in-development
 * closed                                refused closed    refused closed
 * ```
 *
 * The rows are weighed top of the refusals first: closed, then claimed
 * or in development, then `spec:ready`, then the saved copy. So a closed
 * issue a loop still labels is refused as `closed`, the refusal no flag
 * opens, and a ready spec that is also planned is refused for a replace
 * as `spec-ready`, the label a person sees on the board.
 *
 * `--while-in-development` ({@link EditStateInput.whileInDevelopment})
 * opens the append column of the claimed row, for an amendment the
 * running loop must not miss, and nothing else: a replace or a title
 * there stays refused, and a closed issue stays closed. An append it
 * lets through answers `stale-copy`, with the loop's branch named, since
 * the loop plans from the copy it already holds.
 *
 * ## The saved copy
 *
 * A saved copy of issue `n` is a `rafa-<n>-*.md` file directly under
 * `specs.dir` (`./naming.ts`'s spec path), other than the notes file
 * `rafa-<n>-notes.md`, which a person writes before any plan exists and
 * which therefore says nothing about one. `rafa-<n>-.md`, with no slug,
 * is no name `./naming.ts` spells and is not counted. A missing
 * `specs.dir` holds no copy. Two copies of one issue still read as
 * planned: whichever one a plan was made from, the edit makes it stale.
 *
 * ## The branch
 *
 * The claimed row names the loop's branch, {@link branchName} over the
 * issue's number and its title as read BEFORE the edit, since a loop
 * that is already running took its branch from that title.
 */
import { readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { CLAIMED_LABEL, IN_DEVELOPMENT_LABEL } from '../claims/stale.js';

import { boardId, branchName, notesFileName, SPEC_EXTENSION } from './naming.js';
import { SPEC_READY_LABEL } from './readiness.js';

/** What an edit changes: the body by append or by replace, or the title. */
export type EditKind = 'append' | 'replace' | 'title';

/** Why gate 4 refuses an edit, named as `refused <gate>` prints it. */
export type EditStateRefusal = 'closed' | 'in-development' | 'spec-ready' | 'planned';

/** What gate 4 is handed: the issue as read before the edit, and the edit. */
export interface EditStateInput {
  /** The issue's number. */
  readonly issue: number;
  /** The issue's title as read before the edit, which the loop's branch is spelled from. */
  readonly title: string;
  /** False when the tracker holds the issue closed. */
  readonly open: boolean;
  /** The issue's labels as read before the edit. */
  readonly labels: readonly string[];
  /** The saved copies of the issue, as {@link findSavedCopies} lists them. */
  readonly savedCopies: readonly string[];
  /** What the edit changes. */
  readonly kind: EditKind;
  /** True under `--while-in-development`, which opens an append on a claimed issue. */
  readonly whileInDevelopment: boolean;
}

/** What gate 4 answered. */
export type EditStateReading =
  /** The edit may be written; `staleCopy` is true when the outcome is `stale-copy`. */
  | {
    readonly pass: true;
    readonly staleCopy: boolean;
    /** The loop's branch when a claim was let through, or null. */
    readonly branch: string | null;
  }
  /** The edit is refused, for `refusal`. */
  | {
    readonly pass: false;
    readonly refusal: EditStateRefusal;
    /** The loop's branch when the claim refused it, or null. */
    readonly branch: string | null;
  };

/** True when a loop has claimed the issue or is building from it. */
export function isClaimed(labels: readonly string[]): boolean {
  return labels.includes(CLAIMED_LABEL) || labels.includes(IN_DEVELOPMENT_LABEL);
}

/** A refusal reading for `refusal`. */
function refused(refusal: EditStateRefusal, branch: string | null = null): EditStateReading {
  return { pass: false, refusal, branch };
}

/** Gate 4 over `input`; the module note holds the table and its order. */
export function readEditState(input: EditStateInput): EditStateReading {
  if (!input.open) return refused('closed');

  if (isClaimed(input.labels)) {
    const branch = branchName(input.issue, input.title);
    return input.kind === 'append' && input.whileInDevelopment
      ? { pass: true, staleCopy: true, branch }
      : refused('in-development', branch);
  }

  const planned = input.savedCopies.length > 0;
  if (input.kind === 'append') return { pass: true, staleCopy: planned, branch: null };
  if (input.labels.includes(SPEC_READY_LABEL)) return refused('spec-ready');
  if (planned) return refused('planned');
  return { pass: true, staleCopy: false, branch: null };
}

/** The line that rebuilds issue `issue`'s saved copy. */
export function refreshCommand(issue: number): string {
  return `rafa plan create --issue=${String(issue)} --refresh`;
}

/**
 * The sentence a `stale-copy` outcome is reported with: the refresh line,
 * and, when a loop's `branch` let the edit through, that the loop plans
 * from the copy it already has.
 */
export function staleCopyMessage(issue: number, branch: string | null): string {
  const n = String(issue);
  const refresh = refreshCommand(issue);
  if (branch === null) {
    return `Issue #${n} has a saved copy this edit makes stale: ${refresh} rebuilds it.`;
  }
  return `Issue #${n} is under way on ${branch}: the loop plans from the copy it already has, `
    + `and ${refresh} rebuilds that copy.`;
}

/** What an edit of `kind` is called in a refusal. */
function editName(kind: EditKind): string {
  if (kind === 'append') return 'An append to';
  return kind === 'replace'
    ? 'A replace of the body of'
    : 'A title change on';
}

/** The append line a refused replace or title change is pointed at. */
function appendLine(issue: number, extra: string): string {
  return `rafa issue edit ${String(issue)} --append-file=<file> --reason=<text>${extra}`;
}

/**
 * The sentence a refused gate 4 `reading` is refused with, for `input`.
 * Throws a `TypeError` for a passing reading, which has no refusal.
 */
export function editStateRefusalMessage(input: EditStateInput, reading: EditStateReading): string {
  if (reading.pass) throw new TypeError('issue edit state: a passing reading has no refusal to name');
  const what = `${editName(input.kind)} issue #${String(input.issue)}`;
  switch (reading.refusal) {
    case 'closed':
      return `${what} is refused: the issue is closed, and rafa edits open issues only.`;
    case 'in-development': {
      const where = `a loop holds it on ${reading.branch ?? branchName(input.issue, input.title)}`;
      return input.kind === 'append'
        ? `${what} is refused: ${where}; add --while-in-development for an amendment the loop must not miss.`
        : `${what} is refused: ${where}, and a spec under way changes by append: ${appendLine(input.issue, ' --while-in-development')}`;
    }
    case 'spec-ready':
      return `${what} is refused: it carries ${SPEC_READY_LABEL}, and a ready spec changes by append: ${appendLine(input.issue, '')}`;
    case 'planned':
      return `${what} is refused: it has a saved copy under specs.dir, and a planned spec changes by append: ${appendLine(input.issue, '')}`;
  }
}

/** True when `name` is a saved copy's name for `issue`: the module note's rule. */
export function isSavedCopyName(name: string, issue: number): boolean {
  const prefix = `${boardId(issue)}-`;
  return name.startsWith(prefix)
    && name.endsWith(SPEC_EXTENSION)
    && name.length > prefix.length + SPEC_EXTENSION.length
    && name !== notesFileName(issue);
}

/**
 * The saved copies of `issue` directly under `specsDir`, read against
 * `root`: their paths as configured, in name order. A missing `specsDir`
 * answers none; any other failure to list it is thrown.
 */
export function findSavedCopies(root: string, specsDir: string, issue: number): readonly string[] {
  const dir = resolve(root, specsDir);
  let names: readonly string[];
  try {
    names = readdirSync(dir);
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return [];
    throw error;
  }
  return names
    .filter((name) => isSavedCopyName(name, issue))
    .filter((name) => statSync(join(dir, name)).isFile())
    .sort()
    .map((name) => join(specsDir, name));
}
