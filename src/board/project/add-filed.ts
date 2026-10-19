/**
 * The bugs rafa files on its own, onto the project: {@link addFiledBugs}
 * takes what `triageReport` (`src/triage/triage.ts`) answered for one
 * report, a loop task's out-of-scope bugs or the bugs the gate of
 * `rafa epic close` files, and adds each bug it filed on the public
 * GitHub tracker to the repository's project through
 * {@link addAndRefreshIssue}, the step `rafa issue create` takes for the
 * issue it files (`.rafa/specs/rafa-1008-bugs-rafa-files-itself.md`).
 *
 * ## Which bugs are added
 *
 * A bug is added when it was settled `filed` (`action`) on the `public`
 * channel and its `ref` names a `github` issue: its number is the ref's
 * `externalId` read as an integer. Every other bug sends nothing: one
 * commented on, inherited, failed, skipped or routed elsewhere was not
 * filed here; a security bug goes to the private tracker; a bug filed on
 * a `local` or `linear` tracker has no GitHub issue to add. A ref whose
 * `externalId` is not a positive integer is passed over, since no issue
 * number can be read off it.
 *
 * ## In the order filed, one after the other
 *
 * Each add, with its refresh, is awaited before the next is sent, in the
 * order of `bugs`, so the write pause between refreshes paces a report
 * with many bugs rather than sending their writes at once. The answer is
 * every add's lines, in that order.
 *
 * ## Never a failure of its caller
 *
 * {@link addAndRefreshIssue} never rejects: each problem is a warning line
 * the caller prints, and the task or the gate carries on. With
 * `board.project.number` unset nothing is sent and no runner is opened,
 * and the answer is empty.
 *
 * `src/triage/` imports nothing from `src/board/`: this module reads its
 * types alone, and its callers hand it the result they already hold.
 */
import type { AddIssueOptions } from './add-issue.js';
import type { BugTriage, TriageResult } from '../../triage/triage.js';

import { addAndRefreshIssue } from './add-issue.js';

/** A positive integer written in decimal, with no leading zero. */
const ISSUE_NUMBER = /^[1-9][0-9]*$/;

/** The GitHub issue number `bug` was filed as on the public tracker, or null when it was not. */
export function filedIssueNumber(bug: BugTriage): number | null {
  if (bug.channel !== 'public' || bug.action !== 'filed') return null;
  if (bug.ref === null || bug.ref.kind !== 'github') return null;
  if (!ISSUE_NUMBER.test(bug.ref.externalId)) return null;
  const number = Number(bug.ref.externalId);
  return Number.isSafeInteger(number)
    ? number
    : null;
}

/**
 * Adds every bug of `result` filed on the public GitHub tracker to the
 * project at `board.project.number`, each refreshed through
 * {@link addAndRefreshIssue} before the next is sent, and answers every
 * warning line in the order filed; never rejects, and sends nothing with
 * the number unset. See the module note.
 */
export async function addFiledBugs(
  options: AddIssueOptions,
  result: Pick<TriageResult, 'bugs'>,
): Promise<readonly string[]> {
  if (options.config.boardProjectNumber === null) return [];
  const issues = result.bugs.flatMap((bug) => {
    const number = filedIssueNumber(bug);
    return number === null
      ? []
      : [number];
  });
  const lines: string[] = [];
  for (const issue of issues) {
    // Awaited in turn on purpose: the write pause paces the adds.
    lines.push(...await addAndRefreshIssue(options, issue));
  }
  return lines;
}
