/**
 * The `filedIssues` reading of the `github` Tracker adapter: every issue
 * of a type filed since a time, open or closed, with its title, its body
 * and the time it was created, in one command. rafa's own reading,
 * absent from the source `github.ts` was copied from.
 *
 * ## The listing
 *
 * `filedIssues` is one `gh issue list --state all` narrowed by the
 * `type:` label and by a `--search` of `created:>=<since>`, asking for
 * {@link OPEN_LIST_FIELDS}, the fields `openIssues` asks for, and listing
 * up to {@link OPEN_ISSUES_LIMIT} issues, newest first as `gh` lists
 * them. `--state all` is the point of the reading: an issue closed
 * between its filing and the reading is listed beside the open ones,
 * where the `openIssues` listing loses it.
 *
 * `since` is written to the second in UTC, `created:>=2026-10-14T01:29:39Z`,
 * by {@link searchTimeOf}: the form GitHub search reads, and the form
 * `gh` writes `createdAt` in. The fraction of a second `since` holds is
 * dropped, so an issue filed earlier in the second `since` falls in is
 * listed too; GitHub holds no finer time to tell the two apart. A `since`
 * that is not a valid `Date`, or one whose year is not written in four
 * digits, is refused before anything is sent, as is a type the port does
 * not name.
 *
 * ## The rows
 *
 * Each row is first checked as `find` checks one, by the reader
 * `github.ts` hands over, which answers its ref, and then its title and
 * body as `openIssues` checks them ({@link listedTextOf}): a row failing
 * either fails the whole listing, naming the row.
 *
 * `createdAt` is read by {@link createdAtOf}, as `openIssues` reads it,
 * but where `openIssues` answers null for a row with no readable time,
 * `filedIssues` refuses the whole listing, naming the row: the port's
 * `FiledIssue` is never undated, because a listing by filing time cannot
 * place an issue it holds no time for against `since`, and a caller
 * that read the rest would count a filed issue as not filed.
 *
 * ## Why the readers are handed over
 *
 * `github.ts` makes the reading with {@link createGithubFiledIssues} and
 * hands over the readers it hands `openIssues`, for the reason
 * `github-open-issues.ts` gives: this module imports nothing from
 * `github.ts`, which imports it, and a row is refused for its number,
 * url or labels in the one spelling `find` refuses it in.
 */
import type { GithubOpenIssuesReaders } from './github-open-issues.js';
import type { FiledIssue, IssueRef, IssueType, Tracker } from '@open-tomato/rafa/ports';

import { describeValue } from '@open-tomato/rafa/core/config/sections';

import { createdAtOf, listedTextOf, OPEN_ISSUES_LIMIT, OPEN_LIST_FIELDS } from './github-open-issues.js';
import { ISSUE_TYPES } from './issue-values.js';

/** What every refusal opens with, as `github.ts` spells it. */
const PREFIX = 'github tracker';

/** How the listing is named in what the reading throws, as `github.ts` names it. */
const LIST_COMMAND = 'gh issue list';

/** The qualifier the search is narrowed by, before the time. */
const CREATED_QUALIFIER = 'created:>=';

/** `Date.prototype.toISOString` for a year written in four digits: to the millisecond, in UTC. */
const FOUR_DIGIT_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/** How many characters of {@link FOUR_DIGIT_ISO} reach the second, `2026-10-14T01:29:39`. */
const TO_THE_SECOND = 19;

/** What the reading is made with: the readers `openIssues` is made with. */
export type GithubFiledIssuesReaders = GithubOpenIssuesReaders;

/**
 * `since` as the `created:>=` qualifier reads it: ISO 8601 to the second,
 * in UTC, as `2026-10-14T01:29:39Z`. Throws when `since` is not a valid
 * `Date`, or names a year `toISOString` does not write in four digits.
 *
 * Measured under bun 1.3.14 on 2026-10-15: `new Date(Date.UTC(10000, 0,
 * 1)).toISOString()` answered `+010000-01-01T00:00:00.000Z`, which the
 * cut to the second would turn into no time at all, and
 * `new Date(Number.NaN).toISOString()` threw a `RangeError`.
 */
export function searchTimeOf(since: Date): string {
  const iso = since instanceof Date && !Number.isNaN(since.getTime())
    ? since.toISOString()
    : '';
  if (!FOUR_DIGIT_ISO.test(iso)) {
    throw new TypeError(`${PREFIX}: filedIssues refused since ${describeSince(since)}, expected a valid Date in a four-digit year`);
  }
  return `${iso.slice(0, TO_THE_SECOND)}Z`;
}

/** How a refused `since` is named: a `Date` by what it holds, anything else as `describeValue` names it. */
function describeSince(since: unknown): string {
  if (!(since instanceof Date)) return describeValue(since);
  return Number.isNaN(since.getTime())
    ? 'Invalid Date'
    : since.toISOString();
}

/** The filed issue row `index` answers under `ref`. Throws, naming the row, when its text or time does not read. */
function filedIssueOf(row: unknown, index: number, ref: IssueRef): FiledIssue {
  const { title, body, createdAt } = listedTextOf(row, index);
  const time = createdAtOf(createdAt);
  if (time === null) {
    throw new Error(
      `${PREFIX}: ${LIST_COMMAND} answered row ${index} with createdAt ${describeValue(createdAt)},`
        + ' expected an ISO 8601 date and time with its offset',
    );
  }
  return { ref, title, body, createdAt: time };
}

/** Makes the `filedIssues` reading over the adapter's readers; see the module note. */
export function createGithubFiledIssues(readers: GithubFiledIssuesReaders): NonNullable<Tracker['filedIssues']> {
  const { run, listedRows, refOfRow, typeLabel } = readers;

  return async (type: IssueType, since: Date): Promise<FiledIssue[]> => {
    if (!ISSUE_TYPES.includes(type)) {
      throw new TypeError(
        `${PREFIX}: filedIssues refused type ${describeValue(type)}, expected one of: ${ISSUE_TYPES.join(', ')}`,
      );
    }
    const stdout = await run([
      'issue',
      'list',
      '--state',
      'all',
      '--label',
      typeLabel(type),
      '--search',
      `${CREATED_QUALIFIER}${searchTimeOf(since)}`,
      '--json',
      OPEN_LIST_FIELDS,
      '--limit',
      String(OPEN_ISSUES_LIMIT),
    ], LIST_COMMAND);

    return listedRows(stdout).map((row, index): FiledIssue => filedIssueOf(row, index, refOfRow(row, index)));
  };
}
