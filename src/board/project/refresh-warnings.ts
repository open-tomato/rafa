/**
 * The warning lines of the refresh (`./refresh.ts`): the four rows of the
 * spec's "What can go wrong" table
 * (`.rafa/specs/rafa-791-github-project-each-repository.md`), each one
 * line naming its fix, and the line of an issue whose facts could not be
 * read (`.rafa/specs/rafa-924-board-project-fixes.md`). The project is a mirror and the issues stay the
 * source of truth, so a failed project write never fails the command
 * that called it: the caller prints these after its own output and keeps
 * its own exit code.
 *
 * | Failure | Line | Fix named |
 * |---|---|---|
 * | No `project` scope | {@link scopeWarning} | {@link PROJECT_SCOPE_FIX} |
 * | A write refused by the rate limit | {@link rateLimitWarning} | {@link BOARD_SYNC_FIX} |
 * | `board.project.number` names no project | {@link notFoundWarning} | {@link INIT_BOARD_FIX} |
 * | A field or option renamed on the project | {@link skippedFieldWarning} | {@link DOCTOR_FIX} |
 * | An issue whose facts could not be read | {@link notRefreshedWarning} | none: the next refresh reads it again |
 *
 * ## Telling a missing scope apart
 *
 * {@link isMissingProjectScope} reads a `ProjectPortError`'s detail, what
 * `gh` wrote. It is NOT a reading: both `gh` accounts on hand held the
 * `project` scope, and removing it from one was not done for a test.
 * The words matched are GitHub's documented GraphQL refusal, an error of
 * `type` `INSUFFICIENT_SCOPES` whose message says the token "has not
 * been granted the required scopes" and names `'read:project'`, and the
 * hint `gh` adds, `needs the "read:project" scope`. A detail must name a
 * scope refusal AND the project scope, so a refusal over another scope
 * is not answered with a fix that would not help.
 */
import type { FactsRefusal } from './facts.js';
import type { FieldMismatch, ProjectRef } from './port.js';

import { ProjectPortError } from './port.js';

/** The fix of a token without the `project` scope. */
export const PROJECT_SCOPE_FIX = 'gh auth refresh -s project';

/** The fix of writes the rate limit refused: the sync catches up. */
export const BOARD_SYNC_FIX = 'rafa board sync';

/** The fix of a `board.project.number` that names no project. */
export const INIT_BOARD_FIX = 'rafa init --board';

/** The fix of a field or option the project does not hold as the template has it. */
export const DOCTOR_FIX = 'rafa doctor';

/** A refusal over scopes, as GitHub's GraphQL error type or its message words it. */
const SCOPE_REFUSAL = /INSUFFICIENT_SCOPES|not been granted the required scopes|needs the "[^"]*" scope/u;

/** The `project` or `read:project` scope, quoted as GitHub and `gh` quote a scope. */
const PROJECT_SCOPE = /['"](?:read:|write:)?project['"]/u;

/** True when `error` is a port refusal whose detail says the token lacks the `project` scope; see the module note. */
export function isMissingProjectScope(error: unknown): boolean {
  if (!(error instanceof ProjectPortError)) return false;
  return SCOPE_REFUSAL.test(error.detail) && PROJECT_SCOPE.test(error.detail);
}

/** The line of a token without the `project` scope. */
export function scopeWarning(): string {
  return `The project was not updated: the gh token has no \`project\` scope. Run \`${PROJECT_SCOPE_FIX}\`, then \`${BOARD_SYNC_FIX}\`.`;
}

/** The line of writes the rate limit refused, leaving `notUpdated` issues behind. */
export function rateLimitWarning(notUpdated: number): string {
  const issues = notUpdated === 1
    ? '1 issue was'
    : `${String(notUpdated)} issues were`;
  return `The project was not fully updated: GitHub's rate limit refused the writes, and ${issues} not updated. Run \`${BOARD_SYNC_FIX}\` to catch up.`;
}

/** The line of a `board.project.number` that names no project of the owner `ref` holds. */
export function notFoundWarning(ref: ProjectRef): string {
  return `The project was not updated: board.project.number ${String(ref.number)} was not found among ${ref.owner}'s projects. Run \`${INIT_BOARD_FIX}\` to make one.`;
}

/** The line of a field skipped while the rest were written. */
export function skippedFieldWarning(mismatch: FieldMismatch): string {
  return `The project's field "${mismatch.template.name}" was skipped and the rest were written: ${mismatch.sentence} Run \`${DOCTOR_FIX}\`.`;
}

/** The line of an issue the refresh left alone, its facts refused: `#<n> not refreshed: <reason>`. */
export function notRefreshedWarning(refusal: FactsRefusal): string {
  return `#${String(refusal.number)} not refreshed: ${refusal.reason}`;
}
