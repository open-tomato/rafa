/**
 * Tests for the `filedIssues` reading of the `github` Tracker adapter
 * (`packages/rafa-board/src/adapters/tracker/github-filed-issues.ts`).
 *
 * The reading is made here over readers this file writes: a `run` that
 * answers one scripted stdout and records the command, and the plainest
 * listing readers. No case spawns `gh` or reaches GitHub. The reading as
 * `createGithubTracker` wires it, over the adapter's own readers and the
 * recorded fake, is held in `github.test.ts`.
 *
 * Each refused row sits beside the same listing without it, answered:
 * the control that the refusal is of that row and not of the listing.
 * Each refused `since` or type sits beside one that is sent, so the
 * empty command record is not a reading that sends nothing at all.
 *
 * The times `gh` writes were read on 2026-10-12 with `gh` 2.102.0:
 * `gh issue list --repo cli/cli --state open --limit 2 --json
 * number,createdAt` wrote `createdAt` as `2026-10-12T05:50:18Z`, the
 * shape the dated rows here hold.
 *
 * Five mutations of the module were driven on 2026-10-15 over this file
 * and `github.test.ts`, at 184 pass before, the module restored
 * byte-identical (sha256) after each. Listing `--state open` reddened
 * the command case here and the closed-since case in `github.test.ts`.
 * An undated row answered reddened the six undated rows here and the
 * undated case there. The fraction of a second kept reddened the four
 * written times, both command cases and the closed-since case. The type
 * check dropped reddened the refused type case alone, and the four-digit
 * shape check dropped the two refused years alone.
 */
import type { GithubFiledIssuesReaders } from './github-filed-issues.js';
import type { FiledIssue, IssueRef, Tracker } from '@open-tomato/rafa/ports';

import { describe, expect, it } from 'bun:test';

import { createGithubFiledIssues, searchTimeOf } from './github-filed-issues.js';
import { OPEN_ISSUES_LIMIT, OPEN_LIST_FIELDS } from './github-open-issues.js';

/** A time as `gh` 2.102.0 wrote one on 2026-10-12. */
const RECORDED_TIME = '2026-10-12T05:50:18Z';

/** The cut-off the cases list from, with a fraction of a second the search drops. */
const SINCE = new Date('2026-10-14T01:29:39.512Z');

/** One row `gh issue list` writes for `filedIssues`, dated, with any field replaced. */
function row(number: number, fields: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    number,
    url: `https://example.test/issues/${number}`,
    labels: [],
    title: `Bug ${number}`,
    body: 'b',
    createdAt: RECORDED_TIME,
    ...fields,
  };
}

/** The ref the readers here answer for row `index`: numbered by its place in the listing. */
function refOfIndex(index: number): IssueRef {
  return { opt: 0, kind: 'github', externalId: String(index + 1), url: null };
}

/** The reading over a `gh` that writes `stdout`, with any reader replaced, and every command it was handed. */
function readingOver(
  stdout: string,
  replaced: Partial<GithubFiledIssuesReaders> = {},
): { filedIssues: NonNullable<Tracker['filedIssues']>; calls: string[][] } {
  const calls: string[][] = [];
  const filedIssues = createGithubFiledIssues({
    run: async (args) => {
      calls.push([...args]);
      return Promise.resolve(stdout);
    },
    listedRows: (text) => JSON.parse(text) as unknown[],
    refOfRow: (_row, index) => refOfIndex(index),
    typeLabel: (type) => `type:${type}`,
    ...replaced,
  });
  return { filedIssues, calls };
}

/** The bugs filed since {@link SINCE} a listing of `rows` answers. */
async function filedBugsOf(rows: readonly unknown[]): Promise<FiledIssue[]> {
  return readingOver(JSON.stringify(rows)).filedIssues('bug', SINCE);
}

describe('the command the reading sends', () => {
  it('sends one gh issue list in any state, under the type label, searching from the time to the second', async () => {
    const { filedIssues, calls } = readingOver('[]');

    expect(await filedIssues('bug', SINCE)).toEqual([]);
    expect(calls).toEqual([[
      'issue', 'list', '--state', 'all', '--label', 'type:bug', '--search', 'created:>=2026-10-14T01:29:39Z',
      '--json', 'number,url,labels,title,body,createdAt', '--limit', '1000',
    ]]);
    expect([OPEN_LIST_FIELDS, OPEN_ISSUES_LIMIT]).toEqual(['number,url,labels,title,body,createdAt', 1000]);
  });

  it('writes the time in UTC, whatever offset the Date was made with', async () => {
    const { filedIssues, calls } = readingOver('[]');

    await filedIssues('spike', new Date('2026-10-14T03:29:39+02:00'));

    expect(calls.map((args) => [args[5], args[7]])).toEqual([['type:spike', 'created:>=2026-10-14T01:29:39Z']]);
  });
});

describe('the since the reading is asked for', () => {
  it.each([
    ['as gh writes one', new Date(RECORDED_TIME), '2026-10-12T05:50:18Z'],
    ['with a fraction of a second, dropped', new Date('2026-10-12T05:50:18.999Z'), '2026-10-12T05:50:18Z'],
    ['at the epoch', new Date(0), '1970-01-01T00:00:00Z'],
    ['in the last year written in four digits', new Date(Date.UTC(9999, 11, 31, 23, 59, 59)), '9999-12-31T23:59:59Z'],
  ])('writes a since %s', (_label, since, written) => {
    expect(searchTimeOf(since)).toBe(written);
  });

  it.each([
    ['an invalid Date', new Date(Number.NaN), 'Invalid Date'],
    ['a year past four digits', new Date(Date.UTC(10_000, 0, 1)), '+010000-01-01T00:00:00.000Z'],
    ['a year before the first', new Date(Date.UTC(-1, 0, 1)), '-000001-01-01T00:00:00.000Z'],
    ['a string', RECORDED_TIME, '"2026-10-12T05:50:18Z"'],
    ['a number', 0, '0'],
  ])('refuses %s, sending nothing, beside a since it sends', async (_label, since, named) => {
    const { filedIssues, calls } = readingOver('[]');

    // A cast: the refusal is of a value the port's type may not let through.
    await expect(filedIssues('bug', since as Date)).rejects.toThrow(
      `github tracker: filedIssues refused since ${named}, expected a valid Date in a four-digit year`,
    );
    expect(calls).toEqual([]);
    expect(await filedIssues('bug', SINCE)).toEqual([]);
    expect(calls).toHaveLength(1);
  });
});

describe('the type the reading is asked for', () => {
  it('refuses a type the port does not name, sending nothing, beside one it names', async () => {
    const { filedIssues, calls } = readingOver('[]');

    // A cast: the refusal is of a value the port's type would not let through.
    await expect(filedIssues('bug,chore' as 'bug', SINCE)).rejects.toThrow(
      'github tracker: filedIssues refused type "bug,chore", expected one of: code, bug, spike, adr, chore, package-api, epic, spec',
    );
    expect(calls).toEqual([]);
    expect(await filedIssues('chore', SINCE)).toEqual([]);
    expect(calls.map((args) => args[5])).toEqual(['type:chore']);
  });
});

describe('the rows the reading answers', () => {
  it('answers each row with its ref, title, body and time, in the order listed', async () => {
    const asked: [unknown, number][] = [];
    const rows = [row(7, { title: 'Closed since', createdAt: '2026-10-14T02:00:00Z' }), row(3, { body: 'Two.\n' })];
    const { filedIssues } = readingOver(JSON.stringify(rows), {
      refOfRow: (listed, index) => {
        asked.push([listed, index]);
        return { ...refOfIndex(index), module: 'auth' };
      },
    });

    expect(await filedIssues('bug', SINCE)).toStrictEqual([
      { ref: { ...refOfIndex(0), module: 'auth' }, title: 'Closed since', body: 'b', createdAt: '2026-10-14T02:00:00Z' },
      { ref: { ...refOfIndex(1), module: 'auth' }, title: 'Bug 3', body: 'Two.\n', createdAt: RECORDED_TIME },
    ]);
    expect(asked).toEqual([[rows[0], 0], [rows[1], 1]]);
  });

  it.each([
    ['with an offset', '2026-10-14T03:29:39+02:00'],
    ['with a fraction of a second', '2026-10-14T01:29:39.123Z'],
  ])('answers a createdAt %s as written', async (_label, createdAt) => {
    expect((await filedBugsOf([row(1, { createdAt })])).map((issue) => issue.createdAt)).toEqual([createdAt]);
  });

  it.each([
    ['no createdAt', { createdAt: undefined }, 'createdAt undefined'],
    ['a null createdAt', { createdAt: null }, 'createdAt null'],
    ['a word', { createdAt: 'yesterday' }, 'createdAt "yesterday"'],
    ['a month that does not exist', { createdAt: '2026-13-01T00:00:00Z' }, 'createdAt "2026-13-01T00:00:00Z"'],
    ['a time with no offset', { createdAt: '2026-10-12T05:50:18' }, 'createdAt "2026-10-12T05:50:18"'],
    ['a number', { createdAt: 1_791_784_218_000 }, 'createdAt 1791784218000'],
  ])('refuses the listing for a row with %s, naming the row, beside the same listing without it', async (_label, fields, named) => {
    await expect(filedBugsOf([row(1), row(2, fields)])).rejects.toThrow(
      `github tracker: gh issue list answered row 1 with ${named}, expected an ISO 8601 date and time with its offset`,
    );
    expect(await filedBugsOf([row(1)])).toHaveLength(1);
  });

  it.each([
    ['no title', { title: undefined }, 'answered row 1 with title undefined, expected a string'],
    ['no body', { body: undefined }, 'answered row 1 with body undefined, expected a string'],
  ])('refuses a row with %s as openIssues does, beside the same listing without it', async (_label, fields, problem) => {
    await expect(filedBugsOf([row(1), row(2, fields)])).rejects.toThrow(`github tracker: gh issue list ${problem}`);
    expect(await filedBugsOf([row(1)])).toHaveLength(1);
  });

  it('refuses a row for its title before its time', async () => {
    await expect(filedBugsOf([row(1, { title: 4, createdAt: 'yesterday' })])).rejects.toThrow(
      'github tracker: gh issue list answered row 0 with title 4, expected a string',
    );
  });

  it('rejects with what the row reader throws, before the text of that row is read', async () => {
    const { filedIssues } = readingOver(JSON.stringify([row(1, { title: undefined })]), {
      refOfRow: () => {
        throw new Error('github tracker: gh issue list answered row 0 with number "1", expected an issue number');
      },
    });

    await expect(filedIssues('bug', SINCE)).rejects.toThrow('answered row 0 with number "1", expected an issue number');
  });

  it('rejects with what the runner rejects with', async () => {
    const { filedIssues } = readingOver('[]', {
      run: async () => Promise.reject(new Error('github tracker: gh issue list failed: no git remotes found')),
    });

    await expect(filedIssues('bug', SINCE)).rejects.toThrow('github tracker: gh issue list failed: no git remotes found');
  });
});
