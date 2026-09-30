/**
 * The `native` mode's half of the kept board listing
 * (`./board-cache.ts`): the one `gh api graphql` read of the issues
 * changed since the watermark, and the relationship fields a kept row
 * carries in that mode.
 *
 * `gh issue list` takes no `since`, and the REST issues endpoint the
 * `labels` mode reads answers sub-issues and blockers as counts only, so
 * the incremental read in this mode is its own query over
 * `repository.issues(filterBy: {since})`, asking for the fields
 * `nativeBoardListFields` asks `gh issue list` for.
 *
 * ## What the query answered when it was measured
 *
 * Measured 2026-09-30 with `gh` 2.100.0, read-only, against
 * `open-tomato/rafa` and the #340 scratch repositories; the readings are
 * kept in `context/pull-requests.md` ("Native relationships"). `since` is
 * inclusive, as the REST one is: the issue updated AT the timestamp given
 * is answered. A `since` in 2099 answered no issue, the control that the
 * filter is applied. One page of up to 100 issues cost 4 GraphQL points
 * of the 5,000 an hour, and `--paginate` sent every page in the one `gh`
 * command. A linked issue is answered with the `number`, `title`, `state`
 * and `url` asked for, a foreign blocker's `url` naming its own
 * repository.
 *
 * ## The row it writes
 *
 * The `jq` filter writes each issue with the keys a kept row has: the
 * listing's six, the five relationship fields and `updatedAt`. `gh`
 * writes them in name order, as it does for the `labels` mode's REST
 * read, so a row answered twice is the same bytes both times. Labels are
 * named mappings, `parent` null or a linked issue, and the three lists
 * `{nodes, totalCount}`, each node `{number, title, state, url}`: the
 * shape `parseBoardListing` checks in the `native` mode, so a row it
 * would refuse sends the read back to a full one.
 *
 * {@link nativeRowFields} writes an issue from a full read back into the
 * same shape. `BoardIssueLink` keeps the linked issue's repository and not
 * its `url`, so the `url` is written as
 * `https://github.com/<owner/name>/issues/<number>`: `parseBoardListing`
 * reads only the owner, the name and the number from it, whatever the
 * host, so the issue read back is the issue written. A truncated list is
 * written with its `truncated.total` as `totalCount`, which reads back as
 * the same truncation.
 */
import type { BoardIssue, BoardIssueLink, BoardIssueLinks } from './roadmap-board.js';

/** The GraphQL query the incremental read sends in the `native` mode; see the module note. */
export const NATIVE_CHANGED_QUERY = [
  'query($owner: String!, $repo: String!, $since: DateTime!, $endCursor: String) {',
  ' repository(owner: $owner, name: $repo) {',
  ' issues(first: 100, after: $endCursor, filterBy: {since: $since}, orderBy: {field: UPDATED_AT, direction: ASC}) {',
  ' nodes { number title body state stateReason updatedAt',
  ' labels(first: 100) { nodes { name } }',
  ' parent { number title state url }',
  ' blockedBy(first: 50) { nodes { number title state url } totalCount }',
  ' blocking(first: 50) { nodes { number title state url } totalCount }',
  ' subIssuesSummary { total completed percentCompleted }',
  ' subIssues(first: 100) { nodes { number title state url } totalCount } }',
  ' pageInfo { hasNextPage endCursor } } } }',
].join('');

/** The `jq` filter that writes each changed issue of a page as a kept native row. */
const NATIVE_CHANGED_ROWS = '.data.repository.issues.nodes[] | {number, title, body, state, stateReason,'
  + ' labels: [.labels.nodes[] | {name}], parent, blockedBy, blocking, subIssuesSummary, subIssues, updatedAt}';

/** The `gh api graphql` arguments that read the issues changed since `watermark` in the `native` mode. */
export function nativeChangedArgs(watermark: string): readonly string[] {
  return Object.freeze([
    'api',
    'graphql',
    '--paginate',
    '-F',
    'owner={owner}',
    '-F',
    'repo={repo}',
    '-f',
    `since=${watermark}`,
    '-f',
    `query=${NATIVE_CHANGED_QUERY}`,
    '--jq',
    NATIVE_CHANGED_ROWS,
  ]);
}

/** `link` as the node a kept row holds; see the module note for its `url`. */
function nodeOf(link: BoardIssueLink): Readonly<Record<string, unknown>> {
  return {
    number: link.number,
    title: link.title,
    state: link.state,
    url: `https://github.com/${link.repository}/issues/${String(link.number)}`,
  };
}

/** `links` as the `{nodes, totalCount}` a kept row holds. */
function listOf(links: BoardIssueLinks): Readonly<Record<string, unknown>> {
  return {
    nodes: links.nodes.map(nodeOf),
    totalCount: links.truncated?.total ?? links.nodes.length,
  };
}

/**
 * The five relationship fields of `issue`, as a kept native row holds
 * them, or null when the issue was not read in the `native` mode and
 * carries none of them.
 */
export function nativeRowFields(issue: BoardIssue): Readonly<Record<string, unknown>> | null {
  const { parent, blockedBy, blocking, subIssuesSummary, subIssues } = issue;
  if (parent === undefined || blockedBy === undefined || blocking === undefined
    || subIssuesSummary === undefined || subIssues === undefined) return null;
  return {
    parent: parent === null
      ? null
      : nodeOf(parent),
    blockedBy: listOf(blockedBy),
    blocking: listOf(blocking),
    subIssuesSummary: {
      total: subIssuesSummary.total,
      completed: subIssuesSummary.completed,
      percentCompleted: subIssuesSummary.percentCompleted,
    },
    subIssues: listOf(subIssues),
  };
}
