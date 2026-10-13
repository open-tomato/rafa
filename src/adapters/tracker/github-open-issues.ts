/**
 * The `openIssues` reading of the `github` Tracker adapter: every open
 * issue of a type, with its title, its body and the time it was
 * created, in one command. rafa's own reading, absent from the source
 * `github.ts` was copied from.
 *
 * ## The listing
 *
 * `openIssues` is one `gh issue list --state open` narrowed by the
 * `type:` label, asking for {@link OPEN_LIST_FIELDS}: what `find` asks
 * for, and each row's title, body and `createdAt` beside it, so no issue
 * is read with a `get` of its own and no time with a `gh issue view` of
 * its own. It lists up to {@link OPEN_ISSUES_LIMIT} issues, newest first
 * as `gh` lists them, where `find` stops at 30 unless told otherwise. An
 * issue with no `type:` label, which `get` reads as `code`, is not
 * listed for `code`, as `find` by type does not find it either. A type
 * the port does not name is refused before anything is sent.
 *
 * ## The rows
 *
 * Each row is first checked as `find` checks one, by the reader
 * `github.ts` hands over, which answers its ref. Then its title and body
 * are checked here: a row whose title or body is not a string fails the
 * whole listing, naming the row, because an issue with no text is one
 * the caller cannot compare.
 *
 * `createdAt` is read more leniently, by {@link createdAtOf}: a row
 * with no `createdAt`, or one that does not read as a time, answers
 * null and fails nothing. A caller asking what was filed since a time
 * can say which issue it has no time for; a listing refused whole would
 * take the titles and bodies of every other issue with it.
 *
 * Read off `gh` 2.102.0 on 2026-10-12, `gh issue list --repo cli/cli
 * --state open --limit 2 --json number,createdAt` wrote
 * `[{"createdAt":"2026-10-12T05:50:18Z","number":14647},{"createdAt":"2026-10-08T19:15:57Z","number":14627}]`:
 * ISO 8601 to the second, in UTC.
 *
 * ## Why the readers are handed over
 *
 * `github.ts` makes the reading with {@link createGithubOpenIssues} and
 * hands over its own command runner and listing readers, rather than
 * this module importing them, as it does for `github-edit.ts`. This
 * module then imports nothing from `github.ts`, which imports it, and a
 * row is refused for its number, url or labels in the one spelling
 * `find` refuses it in.
 */
import type { IssueRef, IssueType, OpenIssue, Tracker } from '../../ports/index.js';

import { describeValue, isMapping } from '../../core/config/sections.js';

import { ISSUE_TYPES } from './issue-values.js';

/** What every refusal opens with, as `github.ts` spells it. */
const PREFIX = 'github tracker';

/** How the listing is named in what the reading throws, as `github.ts` names it. */
const LIST_COMMAND = 'gh issue list';

/** The fields `openIssues` asks `gh issue list` for: `find`'s, the text, and the time. */
export const OPEN_LIST_FIELDS = 'number,url,labels,title,body,createdAt';

/**
 * How many open issues `openIssues` lists: past it the oldest are left
 * out. `gh issue list` honours a limit above 100: read off `gh` 2.101.0
 * on 2026-10-02, `gh issue list --repo cli/cli --state open --limit 150
 * --json number` answered 150 rows.
 */
export const OPEN_ISSUES_LIMIT = 1000;

/**
 * An ISO 8601 date and time with its offset: to the minute, to the
 * second, or to a fraction of one, ending `Z` or `+hh:mm`.
 */
const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/;

/** What the reading is made with: the adapter's own runner and listing readers. */
export interface GithubOpenIssuesReaders {
  /** Runs `gh` with `args` and answers what it wrote to stdout. Rejects, naming `command`, when it failed. */
  readonly run: (args: readonly string[], command: string) => Promise<string>;
  /** What `gh issue list` wrote, as a list. Throws when it is not JSON or not a list. */
  readonly listedRows: (stdout: string) => unknown[];
  /**
   * The ref row `index` of a listing answers, the row checked as `find`
   * checks one. Throws, naming the row, when it is not an issue.
   */
  readonly refOfRow: (row: unknown, index: number) => IssueRef;
  /** The label an issue of `type` carries, which the listing is narrowed by. */
  readonly typeLabel: (type: IssueType) => string;
}

/**
 * The `createdAt` a listed row answers: `value` as written when it is
 * an ISO 8601 date and time with its offset that names a real instant,
 * else null.
 *
 * The shape is checked as well as the instant because `Date.parse`
 * alone reads more than a time `gh` would write. Measured under bun
 * 1.3.14 on 2026-10-12: `Date.parse('1')` answered 978307200000, the
 * first day of 2001, and `Date.parse('October 2 2026')` a time too,
 * while `Date.parse('2026-13-01T00:00:00Z')` answered NaN, which is what
 * the shape alone would let through.
 */
export function createdAtOf(value: unknown): string | null {
  return typeof value === 'string' && ISO_DATE_TIME.test(value) && !Number.isNaN(Date.parse(value))
    ? value
    : null;
}

/** The open issue row `index` answers under `ref`. Throws, naming the row, when its title or body is not a string. */
function openIssueOf(row: unknown, index: number, ref: IssueRef): OpenIssue {
  // The row reader refused any row that is not a mapping.
  const fields: Record<string, unknown> = isMapping(row)
    ? row
    : {};
  const { title, body, createdAt } = fields;
  if (typeof title !== 'string') {
    throw new Error(`${PREFIX}: ${LIST_COMMAND} answered row ${index} with title ${describeValue(title)}, expected a string`);
  }
  if (typeof body !== 'string') {
    throw new Error(`${PREFIX}: ${LIST_COMMAND} answered row ${index} with body ${describeValue(body)}, expected a string`);
  }
  return { ref, title, body, createdAt: createdAtOf(createdAt) };
}

/** Makes the `openIssues` reading over the adapter's readers; see the module note. */
export function createGithubOpenIssues(readers: GithubOpenIssuesReaders): NonNullable<Tracker['openIssues']> {
  const { run, listedRows, refOfRow, typeLabel } = readers;

  return async (type: IssueType): Promise<OpenIssue[]> => {
    if (!ISSUE_TYPES.includes(type)) {
      throw new TypeError(
        `${PREFIX}: openIssues refused type ${describeValue(type)}, expected one of: ${ISSUE_TYPES.join(', ')}`,
      );
    }
    const stdout = await run([
      'issue',
      'list',
      '--state',
      'open',
      '--json',
      OPEN_LIST_FIELDS,
      '--limit',
      String(OPEN_ISSUES_LIMIT),
      '--label',
      typeLabel(type),
    ], LIST_COMMAND);

    return listedRows(stdout).map((row, index): OpenIssue => openIssueOf(row, index, refOfRow(row, index)));
  };
}
