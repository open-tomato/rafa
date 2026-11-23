/**
 * The GitHub ingest, read only behind `--github` (D9): the project's pull
 * requests into `pr_facts`, stamped `local.prs`, and the open and close
 * times of its issues, which the board ingest writes into `issue_facts`.
 * `gh` is reached only through a `GhRunner`; {@link createAtlasGhRunner}
 * makes rafa-board's `createGhRunner` over the project root with a
 * timeout, and every test hands a stub.
 *
 * 1. **The read** ({@link readGithub}) runs before the replica is opened,
 *    three calls in order: `gh pr list --state all --limit 5000 --json …`
 *    ({@link PR_LIST_FIELDS}), then `gh issue list --state all --limit
 *    5000 --json number,createdAt,closedAt`, then the diff stats. Each list
 *    must exit 0 and answer a JSON list; a list call that exits non-zero,
 *    times out, throws, or answers anything else fails the whole read, and
 *    no later call is made after a failed one. A row that is no pull
 *    request or issue `gh` writes (no positive number, no known state) is
 *    skipped and counted. A list as long as the limit is kept, and named as
 *    possibly cut short.
 * 1a. **The diff stats** (`additions`, `deletions`, `changedFiles`) are no
 *    field of the list: GitHub works them out from each pull request's
 *    diff, and a GraphQL page of 100 of them, the page `gh pr list` asks
 *    for, runs past GitHub's time limit and answers 502 once a repository
 *    holds a few hundred pull requests. They are read by {@link
 *    PR_STATS_ARGS}, `gh api graphql --paginate` in pages of {@link
 *    PR_STATS_PAGE_SIZE}, one JSON object per line, and merged in by
 *    number. A failed diff-stat read fails nothing else: every pull request
 *    keeps NULL stats, and `local.prs` is stamped partial with the reason.
 * 2. **A failed read follows D18.** `local.prs` is stamped with no rows,
 *    `partial`, and a reason holding `gh`'s stderr on one line; every
 *    other source is built as without the flag, so the warning that names
 *    the failure is the one line of `local.prs`, and the build goes on.
 * 3. **`pr_facts`** ({@link ingestGithub}), one row per pull request.
 *    `head_ref` and `base_ref` are its branch names; `state` is `OPEN`,
 *    `CLOSED` or `MERGED`; the four times are ISO-8601 UTC. `review_count`
 *    counts the reviews submitted, and `first_review_at` is the earliest of
 *    their `submittedAt`, NULL with none. `closing_issues_json` is the
 *    numbers of the issues the pull request closes in its own repository,
 *    as a JSON array (`closingIssuesReferences`; GitHub links them only for
 *    a pull request into the default branch). `plan_stub` is filled by
 *    `derive.ts`, through `plan_facts.pr_number`.
 * 4. **What the read hands the other ingests.** {@link issueGithubFactsOf}
 *    answers each issue's open and close times and the pull requests that
 *    close it, open or merged (a closed unmerged one is left out, as
 *    `stageOf` asks), each with `fragment: null`: the read asks for no
 *    pull request's files, so a merged pull request reads as one that
 *    shipped no fragment, and the stage it gives is never In review.
 *    {@link stretchHeadsOf} answers each pull request whose `head_ref` is
 *    `stretch/<n>`, with `n`, so the git ingest marks the third stretch
 *    shape, an item subject, through it (trap 5).
 *
 * `local.prs`'s `as_of` is the newest `updatedAt` of the pull requests,
 * else the read time; its `read_at` the build clock.
 */
import type { IssueGithubFacts, StageLink } from './board.js';
import type { ReplicaBuild, SourceStamp } from '@open-tomato/atlas-data/replica';
import type { GhRunner } from '@open-tomato/rafa-board';

import { createGhRunner } from '@open-tomato/rafa-board';

import { newest, textOrNull } from './columns.js';

/** The `atlas_sources` row `pr_facts` is stamped as. */
export const PRS_SOURCE = 'local.prs';

/** How long one `gh` call may run before it is killed and the read fails: five minutes. */
export const GH_TIMEOUT_MS = 300_000;

/** The most rows each list asks for; a list this long may have been cut short. */
export const GH_LIST_LIMIT = 5000;

/** The fields `gh pr list` is asked for: no diff stat, which {@link PR_STATS_ARGS} reads. */
export const PR_LIST_FIELDS: string = [
  'number', 'title', 'url', 'headRefName', 'baseRefName', 'state', 'createdAt', 'updatedAt', 'mergedAt', 'closedAt',
  'reviews', 'closingIssuesReferences',
].join(',');

/**
 * The pull requests per page of the diff-stat read. Measured 2026-11-23 on
 * a repository of 344 pull requests: pages of 100 answered 502 on the
 * second page, pages of 50 read every one in 7 tries of 8, and pages of 25
 * in 5 of 5, in 15 to 25 seconds.
 */
export const PR_STATS_PAGE_SIZE = 25;

/** The GraphQL query of the diff-stat read; `gh --paginate` fills `$endCursor`. */
const PR_STATS_QUERY = [
  'query($owner: String!, $name: String!, $endCursor: String) {',
  '  repository(owner: $owner, name: $name) {',
  `    pullRequests(first: ${String(PR_STATS_PAGE_SIZE)}, after: $endCursor, states: [OPEN, CLOSED, MERGED]) {`,
  '      nodes { number additions deletions changedFiles }',
  '      pageInfo { hasNextPage endCursor }',
  '    }',
  '  }',
  '}',
].join('\n');

/** The diff-stat read's arguments: `{owner}` and `{repo}` are filled by `gh` from the checkout's remote. */
export const PR_STATS_ARGS: readonly string[] = [
  'api', 'graphql', '--paginate',
  '-F', 'owner={owner}', '-F', 'name={repo}',
  '-f', `query=${PR_STATS_QUERY}`,
  '--jq', '.data.repository.pullRequests.nodes[]',
];

/** The fields `gh issue list` is asked for. */
export const ISSUE_LIST_FIELDS = 'number,createdAt,closedAt';

/** The head ref of a stretch's pull request, capturing its number. */
const STRETCH_HEAD = /^stretch\/(\d+)$/;

/** The repository part of a GitHub issue or pull request URL. */
const REPOSITORY_OF_URL = /^https:\/\/[^/]+\/([^/]+\/[^/]+)\/(?:pull|issues)\/\d+/;

/** A pull request's state, as `gh` writes it. */
export type PullRequestState = 'OPEN' | 'CLOSED' | 'MERGED';

/** One pull request, cut to the fields `pr_facts` holds. */
export interface PullRequestRead {
  readonly number: number;
  readonly title: string;
  readonly headRef: string | null;
  readonly baseRef: string | null;
  readonly state: PullRequestState;
  readonly createdAt: string | null;
  readonly updatedAt: string | null;
  readonly mergedAt: string | null;
  readonly closedAt: string | null;
  readonly additions: number | null;
  readonly deletions: number | null;
  readonly changedFiles: number | null;
  readonly reviewCount: number;
  readonly firstReviewAt: string | null;
  /** The issues it closes in its own repository, ascending. */
  readonly closingIssues: readonly number[];
}

/** One issue's open and close times. */
export interface IssueDates {
  readonly number: number;
  readonly createdAt: string | null;
  readonly closedAt: string | null;
}

/** What one GitHub read gave: the lists, or why there are none. */
export type GithubRead =
  | {
    readonly ok: true;
    readonly prs: readonly PullRequestRead[];
    readonly issues: readonly IssueDates[];
    /** The rows of either list that are no pull request or issue `gh` writes. */
    readonly skipped: number;
    /** The commands whose list reached {@link GH_LIST_LIMIT}. */
    readonly capped: readonly string[];
    /** Why the diff stats were not read, or null when they were. */
    readonly diffStatsFailure: string | null;
  }
  | { readonly ok: false; readonly reason: string };

/** What one GitHub ingest did. */
export interface GithubIngest {
  /** True when the read gave the lists; false with no flag or a failed read. */
  readonly read: boolean;
  readonly prs: number;
  /** `local.prs`. */
  readonly stamps: readonly SourceStamp[];
}

/** What one GitHub ingest is handed. */
export interface GithubIngestOptions {
  /** The read, or null when the build was run without `--github`. */
  readonly read: GithubRead | null;
  /** The build clock, stamped as `read_at`; defaults to the system clock. */
  readonly now?: () => Date;
}

/** The runner over `root`: `gh` spawned there, killed past `timeoutMs`. */
export function createAtlasGhRunner(root: string, timeoutMs: number = GH_TIMEOUT_MS): GhRunner {
  return createGhRunner({ cwd: root, timeoutMs });
}

/** True for a plain object. */
function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The message of a thrown value. */
function messageOf(error: unknown): string {
  return error instanceof Error
    ? error.message
    : String(error);
}

/** `text`'s lines, trimmed and joined on one line; `fallback` when it holds none. */
function oneLine(text: string, fallback: string): string {
  const line = text.split('\n').map((each) => each.trim())
    .filter((each) => each !== '')
    .join(' ');
  return line === ''
    ? fallback
    : line;
}

/** A positive whole number, or null. */
function issueNumberOf(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
    ? value
    : null;
}

/** A time as ISO-8601 UTC, or null when it is absent or does not parse. */
function timeOf(value: unknown): string | null {
  if (typeof value !== 'string' || value === '') return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms)
    ? null
    : new Date(ms).toISOString();
}

/** A whole count of zero or more, or null. */
function countOf(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}

/** The `owner/name` a URL names, or null. */
function repositoryOf(url: unknown): string | null {
  return typeof url === 'string'
    ? REPOSITORY_OF_URL.exec(url)?.[1]?.toLowerCase() ?? null
    : null;
}

/** The submitted reviews' times, earliest first. */
function reviewTimesOf(reviews: unknown): readonly string[] {
  if (!Array.isArray(reviews)) return [];
  return (reviews as readonly unknown[])
    .map((review) => isRecord(review)
      ? timeOf(review['submittedAt'])
      : null)
    .filter((at): at is string => at !== null)
    .sort();
}

/** The issues `references` names in `repository` (any, when it is null), ascending and once each. */
function closingIssuesOf(references: unknown, repository: string | null): readonly number[] {
  if (!Array.isArray(references)) return [];
  const numbers = new Set<number>();
  for (const reference of references as readonly unknown[]) {
    if (!isRecord(reference)) continue;
    const number = issueNumberOf(reference['number']);
    const own = repository === null || repositoryOf(reference['url']) === null || repositoryOf(reference['url']) === repository;
    if (number !== null && own) numbers.add(number);
  }
  return [...numbers].sort((left, right) => left - right);
}

/** One `gh pr list` row cut to a {@link PullRequestRead}, or null when it is no pull request `gh` writes. */
export function pullRequestOf(row: unknown): PullRequestRead | null {
  if (!isRecord(row)) return null;
  const number = issueNumberOf(row['number']);
  const { state } = row;
  if (number === null || (state !== 'OPEN' && state !== 'CLOSED' && state !== 'MERGED')) return null;
  const reviews = reviewTimesOf(row['reviews']);
  return {
    number,
    title: textOrNull(row['title']) ?? '',
    headRef: textOrNull(row['headRefName']),
    baseRef: textOrNull(row['baseRefName']),
    state,
    createdAt: timeOf(row['createdAt']),
    updatedAt: timeOf(row['updatedAt']),
    mergedAt: timeOf(row['mergedAt']),
    closedAt: timeOf(row['closedAt']),
    additions: countOf(row['additions']),
    deletions: countOf(row['deletions']),
    changedFiles: countOf(row['changedFiles']),
    reviewCount: reviews.length,
    firstReviewAt: reviews[0] ?? null,
    closingIssues: closingIssuesOf(row['closingIssuesReferences'], repositoryOf(row['url'])),
  };
}

/** One `gh issue list` row cut to its {@link IssueDates}, or null when it names no issue. */
export function issueDatesOf(row: unknown): IssueDates | null {
  if (!isRecord(row)) return null;
  const number = issueNumberOf(row['number']);
  return number === null
    ? null
    : { number, createdAt: timeOf(row['createdAt']), closedAt: timeOf(row['closedAt']) };
}

/** One pull request's diff stats, as the diff-stat read answers them. */
export interface PullRequestStats {
  readonly number: number;
  readonly additions: number | null;
  readonly deletions: number | null;
  readonly changedFiles: number | null;
}

/** One diff-stat row cut to its {@link PullRequestStats}, or null when it names no pull request. */
export function pullRequestStatsOf(row: unknown): PullRequestStats | null {
  if (!isRecord(row)) return null;
  const number = issueNumberOf(row['number']);
  return number === null
    ? null
    : { number, additions: countOf(row['additions']), deletions: countOf(row['deletions']), changedFiles: countOf(row['changedFiles']) };
}

/** What the diff-stat read gave: its rows cut, or why it failed. */
type StatsRead =
  | { readonly ok: true; readonly rows: readonly PullRequestStats[]; readonly skipped: number }
  | { readonly ok: false; readonly reason: string };

/** Parse the diff-stat read's lines, each one JSON value; fails on the first line that is no JSON. */
function statsOfLines(stdout: string): StatsRead {
  const lines = stdout.split('\n').filter((line) => line.trim() !== '');
  const rows: PullRequestStats[] = [];
  for (const line of lines) {
    let payload: unknown;
    try {
      payload = JSON.parse(line) as unknown;
    } catch (error) {
      return { ok: false, reason: `gh api graphql answered a line that is no JSON (${messageOf(error)})` };
    }
    const stats = pullRequestStatsOf(payload);
    if (stats !== null) rows.push(stats);
  }
  return { ok: true, rows, skipped: lines.length - rows.length };
}

/** Run the diff-stat read ({@link PR_STATS_ARGS}); see the module note. */
async function readStats(runner: GhRunner): Promise<StatsRead> {
  let answered: Awaited<ReturnType<GhRunner>>;
  try {
    answered = await runner(PR_STATS_ARGS);
  } catch (error) {
    return { ok: false, reason: `gh api graphql could not run: ${oneLine(messageOf(error), 'no message')}` };
  }
  return answered.ok
    ? statsOfLines(answered.stdout)
    : { ok: false, reason: `gh api graphql failed: ${oneLine(answered.stderr, 'gh wrote no stderr')}` };
}

/** `prs` with the diff stats of `stats` laid over them by number; a pull request with no stats row keeps its own. */
function withStats(prs: readonly PullRequestRead[], stats: readonly PullRequestStats[]): readonly PullRequestRead[] {
  const byNumber = new Map(stats.map((each) => [each.number, each]));
  return prs.map((pr) => {
    const found = byNumber.get(pr.number);
    return found === undefined
      ? pr
      : { ...pr, additions: found.additions, deletions: found.deletions, changedFiles: found.changedFiles };
  });
}

/** What one list call gave: its rows cut, or why it failed. */
type ListRead<T> =
  | { readonly ok: true; readonly rows: readonly T[]; readonly skipped: number; readonly capped: boolean }
  | { readonly ok: false; readonly reason: string };

/** Run one `gh <noun> list` and cut its rows with `cut`; see the module note. */
async function readList<T>(runner: GhRunner, noun: 'pr' | 'issue', fields: string, cut: (row: unknown) => T | null): Promise<ListRead<T>> {
  const command = `gh ${noun} list`;
  let answered: Awaited<ReturnType<GhRunner>>;
  try {
    answered = await runner([noun, 'list', '--state', 'all', '--limit', String(GH_LIST_LIMIT), '--json', fields]);
  } catch (error) {
    return { ok: false, reason: `${command} could not run: ${oneLine(messageOf(error), 'no message')}` };
  }
  if (!answered.ok) return { ok: false, reason: `${command} failed: ${oneLine(answered.stderr, 'gh wrote no stderr')}` };
  let payload: unknown;
  try {
    payload = JSON.parse(answered.stdout) as unknown;
  } catch (error) {
    return { ok: false, reason: `${command} answered no JSON (${messageOf(error)})` };
  }
  if (!Array.isArray(payload)) return { ok: false, reason: `${command} answered no JSON list` };
  const rows = (payload as readonly unknown[]).map(cut).filter((row): row is T => row !== null);
  return { ok: true, rows, skipped: payload.length - rows.length, capped: payload.length >= GH_LIST_LIMIT };
}

/** Read the pull requests, then the issue dates, then the diff stats, through `runner`; see the module note. Never rejects. */
export async function readGithub(runner: GhRunner): Promise<GithubRead> {
  const prs = await readList(runner, 'pr', PR_LIST_FIELDS, pullRequestOf);
  if (!prs.ok) return prs;
  const issues = await readList(runner, 'issue', ISSUE_LIST_FIELDS, issueDatesOf);
  if (!issues.ok) return issues;
  const stats = await readStats(runner);
  const capped = [
    ...(prs.capped
      ? ['gh pr list']
      : []),
    ...(issues.capped
      ? ['gh issue list']
      : []),
  ];
  return stats.ok
    ? { ok: true, prs: withStats(prs.rows, stats.rows), issues: issues.rows, skipped: prs.skipped + issues.skipped + stats.skipped, capped, diffStatsFailure: null }
    : { ok: true, prs: prs.rows, issues: issues.rows, skipped: prs.skipped + issues.skipped, capped, diffStatsFailure: stats.reason };
}

/** The closing links of each issue, by number: open or merged pull requests, each with no fragment read. */
function linksByIssue(prs: readonly PullRequestRead[]): ReadonlyMap<number, readonly StageLink[]> {
  const links = new Map<number, StageLink[]>();
  for (const pr of [...prs].sort((left, right) => left.number - right.number)) {
    if (pr.state === 'CLOSED') continue;
    const link: StageLink = { state: pr.state, fragment: null };
    for (const issue of pr.closingIssues) links.set(issue, [...(links.get(issue) ?? []), link]);
  }
  return links;
}

/** What the board ingest takes of a read: each issue's times and closing pull requests. */
export function issueGithubFactsOf(read: Extract<GithubRead, { ok: true }>): IssueGithubFacts {
  const links = linksByIssue(read.prs);
  const dates = new Map(read.issues.map((issue) => [issue.number, issue]));
  return {
    pullRequestsOf: (issue) => links.get(issue) ?? [],
    datesOf: (issue) => dates.get(issue),
  };
}

/** Each pull request whose head ref is `stretch/<n>`, with `n` as its digits. */
export function stretchHeadsOf(prs: readonly PullRequestRead[]): ReadonlyMap<number, string> {
  const heads = new Map<number, string>();
  for (const pr of prs) {
    const digits = pr.headRef === null
      ? undefined
      : STRETCH_HEAD.exec(pr.headRef)?.[1];
    if (digits !== undefined) heads.set(pr.number, digits);
  }
  return heads;
}

/** The `pr_facts` columns written, in the order {@link prRow} binds them. */
const PR_COLUMNS: readonly string[] = [
  'number', 'title', 'head_ref', 'base_ref', 'state', 'created_at', 'merged_at', 'closed_at',
  'additions', 'deletions', 'changed_files', 'review_count', 'first_review_at', 'closing_issues_json',
];

/** One pull request's row, in {@link PR_COLUMNS} order. */
function prRow(pr: PullRequestRead): (string | number | null)[] {
  return [
    pr.number, pr.title, pr.headRef, pr.baseRef, pr.state, pr.createdAt, pr.mergedAt, pr.closedAt,
    pr.additions, pr.deletions, pr.changedFiles, pr.reviewCount, pr.firstReviewAt, JSON.stringify(pr.closingIssues),
  ];
}

/** Insert one `pr_facts` row per pull request, the last of a number held twice winning. */
function insertPullRequests(build: ReplicaBuild, prs: readonly PullRequestRead[]): number {
  const insert = build.database.prepare<unknown, (string | number | null)[]>(
    `INSERT OR REPLACE INTO pr_facts (${PR_COLUMNS.join(', ')}) VALUES (${PR_COLUMNS.map(() => '?').join(', ')})`,
  );
  build.database.transaction(() => {
    for (const pr of prs) insert.run(...prRow(pr));
  })();
  return new Set(prs.map((pr) => pr.number)).size;
}

/** The `local.prs` stamp of a read that gave its lists. */
function readStamp(read: Extract<GithubRead, { ok: true }>, readAt: string, rows: number): SourceStamp {
  const reasons = [
    ...(read.diffStatsFailure === null
      ? []
      : [`the diff stats were not read, so additions, deletions and changed_files read NULL: ${read.diffStatsFailure}`]),
    ...(read.skipped === 0
      ? []
      : [`${String(read.skipped)} gh rows were skipped: no pull request or issue gh writes`]),
    ...read.capped.map((command) => `${command} answered ${String(GH_LIST_LIMIT)} rows, its limit, and may be cut short`),
  ];
  const asOf = newest(read.prs.map((pr) => pr.updatedAt)) ?? readAt;
  return {
    source: PRS_SOURCE,
    asOf,
    readAt,
    rows,
    partial: reasons.length > 0,
    reason: reasons.length === 0
      ? null
      : reasons.join('; '),
  };
}

/** Write `pr_facts` from the read and stamp `local.prs`: unread with no flag, failed per D18; see the module note. */
export function ingestGithub(build: ReplicaBuild, options: GithubIngestOptions): GithubIngest {
  const readAt = (options.now ?? (() => new Date()))().toISOString();
  const { read } = options;
  if (read === null || !read.ok) {
    const reason = read === null
      ? 'not read: the build ran without --github'
      : `the GitHub read failed, so every other source is built as without --github: ${read.reason}`;
    const stamp: SourceStamp = { source: PRS_SOURCE, asOf: null, readAt, rows: 0, partial: true, reason };
    build.stampSource(stamp);
    return { read: false, prs: 0, stamps: [stamp] };
  }
  const rows = insertPullRequests(build, read.prs);
  const stamp = readStamp(read, readAt, rows);
  build.stampSource(stamp);
  return { read: true, prs: rows, stamps: [stamp] };
}
