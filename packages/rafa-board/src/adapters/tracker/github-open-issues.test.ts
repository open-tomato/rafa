/**
 * Tests for the `openIssues` reading of the `github` Tracker adapter
 * (`packages/rafa-board/src/adapters/tracker/github-open-issues.ts`).
 *
 * The reading is made here over readers this file writes: a `run` that
 * answers one scripted stdout and records the command, and the plainest
 * listing readers. No case spawns `gh` or reaches GitHub. The reading as
 * `createGithubTracker` wires it, over the adapter's own readers and the
 * recorded fake, is held in `github.test.ts`.
 *
 * Each null `createdAt` sits beside a dated row in the same listing: the
 * control that the row was read at all, and that a row with no time
 * does not fail the rows around it. Each refusal sits beside a listing
 * that is answered.
 *
 * The times `gh` writes were read on 2026-10-12 with `gh` 2.102.0:
 * `gh issue list --repo cli/cli --state open --limit 2 --json
 * number,createdAt` wrote `createdAt` as `2026-10-12T05:50:18Z`, the
 * shape the dated rows here hold.
 *
 * Five mutations of the module were driven on 2026-10-12 over
 * `src/adapters/tracker/`, at 453 pass before, the module restored
 * byte-identical (sha256) after each. Any string answered as written
 * reddened seven of the ten unparseable rows, all but the number, the
 * null and the mapping, with the lone-value case and the adapter's
 * undated case in `github.test.ts`. The shape check dropped reddened
 * the four rows `Date.parse` reads, which are the bare number, the
 * written date, the date with no time and the time with no offset, with
 * the lone-value case; `Date.parse` dropped, the month that does not
 * exist alone. `createdAt` left out of the fields reddened the fields
 * case here, three cases in `github.test.ts` and the contract's
 * `createdAt` case over the fake, which writes the fields asked for and
 * no more. A row with no time refused reddened seventeen cases, each
 * listing a row with none.
 */
import type { GithubOpenIssuesReaders } from './github-open-issues.js';
import type { IssueRef, OpenIssue, Tracker } from '@open-tomato/rafa/ports';

import { describe, expect, it } from 'bun:test';

import { createdAtOf, createGithubOpenIssues, OPEN_ISSUES_LIMIT, OPEN_LIST_FIELDS } from './github-open-issues.js';

/** A time as `gh` 2.102.0 wrote one on 2026-10-12. */
const RECORDED_TIME = '2026-10-12T05:50:18Z';

/** One row `gh issue list` writes for `openIssues`, with any field replaced. */
function row(number: number, fields: Record<string, unknown> = {}): Record<string, unknown> {
  return { number, url: `https://example.test/issues/${number}`, labels: [], title: `Bug ${number}`, body: 'b', ...fields };
}

/** The ref the readers here answer for row `index`: numbered by its place in the listing. */
function refOfIndex(index: number): IssueRef {
  return { opt: 0, kind: 'github', externalId: String(index + 1), url: null };
}

/** The reading over a `gh` that writes `stdout`, with any reader replaced, and every command it was handed. */
function readingOver(
  stdout: string,
  replaced: Partial<GithubOpenIssuesReaders> = {},
): { openIssues: NonNullable<Tracker['openIssues']>; calls: string[][] } {
  const calls: string[][] = [];
  const openIssues = createGithubOpenIssues({
    run: async (args) => {
      calls.push([...args]);
      return Promise.resolve(stdout);
    },
    listedRows: (text) => JSON.parse(text) as unknown[],
    refOfRow: (_row, index) => refOfIndex(index),
    typeLabel: (type) => `type:${type}`,
    ...replaced,
  });
  return { openIssues, calls };
}

/** The open bugs a listing of `rows` answers. */
async function openBugsOf(rows: readonly unknown[]): Promise<OpenIssue[]> {
  return readingOver(JSON.stringify(rows)).openIssues('bug');
}

describe('the fields the reading asks for', () => {
  it('asks gh issue list for createdAt beside the title and body', () => {
    expect(OPEN_LIST_FIELDS.split(',')).toEqual(['number', 'url', 'labels', 'title', 'body', 'createdAt']);
  });

  it('sends one gh issue list for open issues under the type label', async () => {
    const { openIssues, calls } = readingOver('[]');

    expect(await openIssues('bug')).toEqual([]);
    expect(calls).toEqual([[
      'issue', 'list', '--state', 'open', '--json', OPEN_LIST_FIELDS, '--limit', String(OPEN_ISSUES_LIMIT), '--label', 'type:bug',
    ]]);
  });
});

describe('the createdAt of a listed row', () => {
  it('answers null for a row with no createdAt, beside a dated row in the same listing', async () => {
    const open = await openBugsOf([row(1), row(2, { createdAt: RECORDED_TIME })]);

    expect(open).toStrictEqual([
      { ref: refOfIndex(0), title: 'Bug 1', body: 'b', createdAt: null },
      { ref: refOfIndex(1), title: 'Bug 2', body: 'b', createdAt: RECORDED_TIME },
    ]);
  });

  it.each([
    ['a word', 'yesterday'],
    ['an empty string', ''],
    ['a month that does not exist', '2026-13-01T00:00:00Z'],
    ['a bare number, which Date.parse reads as the year 2001', '1'],
    ['a written date, which Date.parse reads', 'October 2 2026'],
    ['a date with no time', '2026-10-12'],
    ['a time with no offset', '2026-10-12T05:50:18'],
    ['a number', 1_791_784_218_000],
    ['null', null],
    ['a mapping', { date: RECORDED_TIME }],
  ])('answers null for an unparseable createdAt, %s, beside a dated row', async (_label, createdAt) => {
    const open = await openBugsOf([row(1, { createdAt }), row(2, { createdAt: RECORDED_TIME })]);

    expect(open.map((issue) => [issue.title, issue.createdAt])).toEqual([['Bug 1', null], ['Bug 2', RECORDED_TIME]]);
  });

  it.each([
    ['as gh writes one, to the second in UTC', RECORDED_TIME],
    ['with a fraction of a second', '2026-10-12T05:50:18.123Z'],
    ['with an offset', '2026-10-12T07:50:18+02:00'],
    ['to the minute', '2026-10-12T05:50Z'],
  ])('answers a dated createdAt as written, %s', async (_label, createdAt) => {
    const open = await openBugsOf([row(1, { createdAt })]);

    expect(open.map((issue) => issue.createdAt)).toEqual([createdAt]);
    expect(Number.isNaN(Date.parse(createdAt))).toBe(false);
  });

  it('reads each value alone the way a row reads it', () => {
    expect(createdAtOf(RECORDED_TIME)).toBe(RECORDED_TIME);
    expect(createdAtOf(undefined)).toBeNull();
    expect(createdAtOf('1')).toBeNull();
  });
});

describe('the rows the reading answers', () => {
  it('answers each row with the ref its reader answers for it, in the order listed', async () => {
    const asked: [unknown, number][] = [];
    const rows = [row(7, { createdAt: RECORDED_TIME }), row(3)];
    const { openIssues } = readingOver(JSON.stringify(rows), {
      refOfRow: (listed, index) => {
        asked.push([listed, index]);
        return { ...refOfIndex(index), module: 'auth' };
      },
    });

    expect((await openIssues('bug')).map((issue) => issue.ref)).toEqual([
      { ...refOfIndex(0), module: 'auth' },
      { ...refOfIndex(1), module: 'auth' },
    ]);
    expect(asked).toEqual([[rows[0], 0], [rows[1], 1]]);
  });

  it.each([
    ['no title', { title: undefined }, 'answered row 1 with title undefined, expected a string'],
    ['a title that is a number', { title: 4 }, 'answered row 1 with title 4, expected a string'],
    ['no body', { body: undefined }, 'answered row 1 with body undefined, expected a string'],
  ])('refuses a row with %s, naming the row, beside the same listing without it', async (_label, fields, problem) => {
    await expect(openBugsOf([row(1), row(2, fields)])).rejects.toThrow(`github tracker: gh issue list ${problem}`);
    expect(await openBugsOf([row(1)])).toHaveLength(1);
  });

  it('rejects with what the row reader throws, before the text of that row is read', async () => {
    const { openIssues } = readingOver(JSON.stringify([row(1, { title: undefined })]), {
      refOfRow: () => {
        throw new Error('github tracker: gh issue list answered row 0 with number "1", expected an issue number');
      },
    });

    await expect(openIssues('bug')).rejects.toThrow('answered row 0 with number "1", expected an issue number');
  });

  it('rejects with what the runner rejects with', async () => {
    const { openIssues } = readingOver('[]', {
      run: async () => Promise.reject(new Error('github tracker: gh issue list failed: no git remotes found')),
    });

    await expect(openIssues('bug')).rejects.toThrow('github tracker: gh issue list failed: no git remotes found');
  });
});

describe('the type the reading is asked for', () => {
  it('refuses a type the port does not name, sending nothing, beside one it names', async () => {
    const { openIssues, calls } = readingOver('[]');

    // A cast: the refusal is of a value the port's type would not let through.
    await expect(openIssues('bug,chore' as 'bug')).rejects.toThrow(
      'github tracker: openIssues refused type "bug,chore", expected one of: code, bug, spike, adr, chore, package-api, epic, spec',
    );
    expect(calls).toEqual([]);
    expect(await openIssues('chore')).toEqual([]);
    expect(calls.map((args) => args.at(-1))).toEqual(['type:chore']);
  });
});
