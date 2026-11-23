/**
 * A stand-in for `gh` for the GitHub ingest's tests: fixture JSON for
 * `gh pr list` and `gh issue list`, every title invented, and stub
 * runners that record each call, so no test runs `gh` or reaches the
 * network. Named without `.test` so bun never runs it alone.
 *
 * | # | State | Head | Closes | Merged (UTC) |
 * |---|---|---|---|---|
 * | 7 | merged | `rafa/atlas-fixture` | 7 | 2026-11-02 09:00 |
 * | 44 | open | `rafa/notes-page` | 42, and #99 of another repository | none |
 * | 45 | merged | `rafa/claimed-bug` | 52 | 2026-11-04 11:00 |
 * | 46 | closed unmerged | `rafa/dropped` | 53 | none |
 * | 61 | merged | `stretch/103` | none | 2026-11-06 10:00 |
 *
 * Pull request 7 is the one the effort fixture's plan names in `ci_facts`,
 * and 61 the one {@link ITEM_SUBJECT}, a commit of the third stretch shape,
 * names last. The issues are those of the board fixture
 * (`board-cache.fixture.ts`), each with an invented open time, and issue
 * 7 and 51 with a close time.
 */
import type { GhResult, GhRunner } from '@open-tomato/rafa-board';

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { gitIn } from './git-repo.fixture.js';

/** The repository every fixture URL names. */
const REPOSITORY = 'https://github.com/fixture-owner/fixture-repo';

/** A closing reference to issue `number` of `repository`. */
function closes(number: number, repository: string = REPOSITORY): { readonly number: number; readonly url: string } {
  return { number, url: `${repository}/issues/${String(number)}` };
}

/** One `gh pr list` row with the fields the ingest asks for. */
function prRow(number: number, fields: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  return {
    number,
    title: `Fixture pull request ${String(number)}`,
    url: `${REPOSITORY}/pull/${String(number)}`,
    baseRefName: 'main',
    createdAt: '2026-11-01T08:00:00Z',
    updatedAt: '2026-11-01T08:00:00Z',
    mergedAt: null,
    closedAt: null,
    additions: 1,
    deletions: 0,
    changedFiles: 1,
    reviews: [],
    closingIssuesReferences: [],
    ...fields,
  };
}

/** The time pull request 7 merged: `plan_facts.merged_at` of the effort fixture's plan. */
export const FIXTURE_PR_MERGED_AT = '2026-11-02T09:00:00.000Z';

/** The pull requests `gh pr list` answers; see the module note. */
export const FIXTURE_PRS: readonly Readonly<Record<string, unknown>>[] = [
  prRow(7, {
    headRefName: 'rafa/atlas-fixture',
    state: 'MERGED',
    mergedAt: '2026-11-02T09:00:00Z',
    closedAt: '2026-11-02T09:00:00Z',
    updatedAt: '2026-11-02T09:05:00Z',
    additions: 3,
    deletions: 1,
    changedFiles: 2,
    reviews: [
      { state: 'COMMENTED', submittedAt: '2026-11-01T12:00:00Z' },
      { state: 'APPROVED', submittedAt: '2026-11-01T10:30:00Z' },
      { state: 'PENDING', submittedAt: null },
    ],
    closingIssuesReferences: [closes(7)],
  }),
  prRow(44, {
    headRefName: 'rafa/notes-page',
    state: 'OPEN',
    closingIssuesReferences: [closes(42), closes(99, 'https://github.com/other-owner/other-repo')],
  }),
  prRow(45, {
    headRefName: 'rafa/claimed-bug',
    state: 'MERGED',
    mergedAt: '2026-11-04T11:00:00Z',
    closedAt: '2026-11-04T11:00:00Z',
    updatedAt: '2026-11-04T11:00:00Z',
    closingIssuesReferences: [closes(52)],
  }),
  prRow(46, {
    headRefName: 'rafa/dropped',
    state: 'CLOSED',
    closedAt: '2026-11-03T15:00:00Z',
    closingIssuesReferences: [closes(53)],
  }),
  prRow(61, {
    headRefName: 'stretch/103',
    state: 'MERGED',
    mergedAt: '2026-11-06T10:00:00Z',
    closedAt: '2026-11-06T10:00:00Z',
    updatedAt: '2026-11-06T10:01:00Z',
  }),
];

/** The newest `updatedAt` of {@link FIXTURE_PRS}: `local.prs`'s `as_of`. */
export const FIXTURE_PRS_AS_OF = '2026-11-06T10:01:00.000Z';

/** The pull requests merged per UTC day. */
export const FIXTURE_MERGES_PER_DAY: Readonly<Record<string, number>> = {
  '2026-11-02': 1,
  '2026-11-04': 1,
  '2026-11-06': 1,
};

/** The issue times `gh issue list` answers, for every issue of the board fixture. */
export const FIXTURE_ISSUE_DATES: readonly Readonly<Record<string, unknown>>[] = [
  { number: 40, createdAt: '2026-10-01T09:00:00Z', closedAt: null },
  { number: 42, createdAt: '2026-10-02T09:00:00Z', closedAt: null },
  { number: 7, createdAt: '2026-10-20T09:00:00Z', closedAt: '2026-11-02T09:00:00Z' },
  { number: 50, createdAt: '2026-10-21T09:00:00Z', closedAt: null },
  { number: 51, createdAt: '2026-10-22T09:00:00Z', closedAt: '2026-10-23T09:00:00Z' },
  { number: 52, createdAt: '2026-10-24T09:00:00Z', closedAt: null },
  { number: 53, createdAt: '2026-10-25T09:00:00Z', closedAt: null },
];

/** The subject of the item commit {@link commitItem} adds: the third stretch shape, its stretch named by pull request 61's head. */
export const ITEM_SUBJECT = 'feat: an invented item (#60) (#61)';

/** Commit {@link ITEM_SUBJECT} on top of the git fixture in `root`, on 2026-11-06 10:00 UTC; answers its sha. */
export function commitItem(root: string): string {
  const at = '2026-11-06T10:00:00Z';
  writeFileSync(join(root, 'item.txt'), 'an item\n');
  gitIn(root, ['add', '--', 'item.txt'], at);
  gitIn(root, ['commit', '--quiet', '-m', ITEM_SUBJECT], at);
  return gitIn(root, ['rev-parse', 'HEAD']);
}

/** A runner and the argument lists it was called with. */
export interface GhStub {
  readonly runner: GhRunner;
  readonly calls: (readonly string[])[];
}

/** A runner answering `answer` for each call, recording it. */
export function stubGh(answer: (args: readonly string[]) => GhResult): GhStub {
  const calls: (readonly string[])[] = [];
  return {
    calls,
    runner: (args) => {
      calls.push(args);
      return Promise.resolve(answer(args));
    },
  };
}

/** A runner answering `prs` to `gh pr list` and `issues` to `gh issue list`, exit 0. */
export function fixtureGh(
  prs: readonly unknown[] = FIXTURE_PRS,
  issues: readonly unknown[] = FIXTURE_ISSUE_DATES,
): GhStub {
  return stubGh((args) => ({
    ok: true,
    stdout: JSON.stringify(args[0] === 'pr'
      ? prs
      : issues),
    stderr: '',
  }));
}

/** The stderr {@link failingGh} answers. */
export const FIXTURE_GH_STDERR = 'HTTP 401: Bad credentials (https://api.github.com/graphql)';

/** A runner answering every call `ok: false` with {@link FIXTURE_GH_STDERR}. */
export function failingGh(): GhStub {
  return stubGh(() => ({ ok: false, stdout: '', stderr: `${FIXTURE_GH_STDERR}\n` }));
}

/** A runner that records each call and throws: a build that must not call `gh` hands it. */
export function throwingGh(): GhStub {
  const calls: (readonly string[])[] = [];
  return {
    calls,
    runner: (args) => {
      calls.push(args);
      throw new Error('the stub gh was called');
    },
  };
}
