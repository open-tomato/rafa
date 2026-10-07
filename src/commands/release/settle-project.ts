/**
 * The project refresh `rafa release settle` runs once its release commit
 * is on the base: the issues closed by the pull requests whose fragments
 * it folded, refreshed on the repository's project
 * (`.rafa/specs/rafa-791-github-project-each-repository.md`, "Who calls
 * it": "`rafa release settle` — the issues closed by the pull requests
 * whose fragments it folded").
 *
 * Settle deletes every fragment it folds, and the Stage rule reads an
 * issue whose pull request's shipping fragment is still on the base as
 * In review and one whose fragment is gone as Done. No issue changes in
 * that step, so no other caller refreshes them; this module does.
 *
 * ## When it runs
 *
 * Only after a delivery that left the base without the folded fragments:
 * `pushed`, and `superseded`, where another settle released the same
 * fragments first. A dry run writes nothing; a `pr` delivery leaves the
 * fragments on the base until its release pull request is merged, so a
 * refresh then would read every issue as it already stands; a build or
 * push that failed released nothing. Each of those answers null, as does
 * `board.project.number` unset, having opened no `gh` runner. The
 * issues a `pr` delivery releases are caught up by `rafa board sync`.
 *
 * ## Which issues it refreshes
 *
 * Each folded fragment carries the first-parent commit that added it to
 * the base. One `gh api graphql` query per {@link COMMIT_BATCH} distinct
 * commits reads each commit's `associatedPullRequests`. Measured with
 * `gh` 2.100.0 on 2026-10-07, read-only, on `open-tomato/rafa`: the
 * squash commit of `#856` answered `#856`, MERGED into `main`, its
 * `mergeCommit.oid` the commit itself, closing `#812`; the merge commit
 * of the integration pull request `#813` answered `#813`, closing the
 * fifteen issues its body names; and an oid GitHub does not hold
 * answered `null`, which reads as no pull request.
 *
 * Of a commit's pull requests, the merged ones whose `mergeCommit.oid` is
 * that commit are read; when none is, the merged ones into the settle's
 * base branch (a rebase merge adds a fragment in a commit that is not the
 * merge commit). A commit no pull request brought, a direct push, adds no
 * issue. A pull request's issues are its `closingIssuesReferences` on this
 * repository and the `#<n>` its body closes by GitHub's keywords
 * ({@link closedIssuesIn}), since GitHub links no issue for a pull request
 * into an integration branch. Every issue is named once, in fold order.
 *
 * A pull request merged into an integration branch whose fragment reached
 * the base inside the integration branch's own merge is not one of the
 * pull requests read: the base received the fragment through the
 * integration pull request, and that is the one whose issues are
 * refreshed. `rafa board sync` catches up the rest.
 *
 * ## Never a failure of the settle
 *
 * The release commit is on the base by then and the project is a mirror,
 * so nothing here rejects and the settle keeps its exit code. A query
 * that failed or answered another shape, and a refresh that rejected,
 * each become one line by {@link settleProblemLine} naming
 * `rafa board sync`; the refresh's own warnings are answered as it
 * answers them.
 */
import type { GhRunner } from '../../adapters/tracker/github.js';
import type { RefreshItems } from '../../board/project/add-issue.js';
import type { RefreshConfig } from '../../board/project/refresh.js';
import type { SettleDelivered } from '../../release/settle-tag.js';

import { refreshIssueItems } from '../../board/project/issue-board-refresh.js';
import { BOARD_SYNC_FIX } from '../../board/project/refresh-warnings.js';
import { closedIssuesIn } from '../../board/roadmap.js';
import { describeValue, isMapping, messageOf } from '../../config-sections.js';

/** How many commits one pull request query names. */
export const COMMIT_BATCH = 20;

/** How many pull requests one commit's connection is read to. */
export const COMMIT_PULL_LIMIT = 10;

/** How many issues one pull request's closing references are read to. */
export const CLOSING_LIMIT = 100;

/** What every refusal of the reading opens with. */
const PREFIX = 'release settle project';

/** What {@link refreshProjectAfterSettle} is made with. */
export interface SettleProjectOptions {
  /** What the delivery answered; only `pushed` and `superseded` refresh. */
  readonly delivered: SettleDelivered;
  /** The base branch the settle released on. */
  readonly branch: string;
  /** The config keys the refresh reads. */
  readonly config: RefreshConfig;
  /** Opens the runner every call goes through; called only when there is something to read. */
  readonly openGh: () => GhRunner;
  /** The refresh; `refreshProjectItems` when left out. */
  readonly refresh?: RefreshItems;
}

/** What one refresh after a settle read and asked for. */
export interface SettleProjectRefresh {
  /** The distinct commits that added the folded fragments, in fold order. */
  readonly commits: readonly string[];
  /** The pull requests those commits were brought by, in fold order, each once. */
  readonly pullRequests: readonly number[];
  /** The issues those close, in fold order, each once; empty when the reading failed. */
  readonly issues: readonly number[];
  /** The warning lines for the caller to print after its own output, in order. */
  readonly warnings: readonly string[];
}

/** One merged pull request a commit answered. */
interface CommitPull {
  readonly number: number;
  readonly baseRefName: string;
  readonly mergeCommit: string | null;
  readonly issues: readonly number[];
}

/** A mapping of answer keys. */
type Answer = Readonly<Record<string, unknown>>;

/** `#20, #21`. */
function named(issues: readonly number[]): string {
  return issues.map((issue) => `#${String(issue)}`).join(', ');
}

/** The line of a reading or a refresh that failed; `issues` empty while the issues are not known yet. */
export function settleProblemLine(issues: readonly number[], problem: string): string {
  const which = issues.length === 0
    ? 'the issues this release closes'
    : named(issues);
  return `The project was not updated for ${which}: ${problem}. Run \`${BOARD_SYNC_FIX}\` to catch up.`;
}

/** The alias of the `index`th commit of a query. */
function commitAlias(index: number): string {
  return `c${String(index)}`;
}

/** The argv reading the pull requests of `commits`, each oid a variable under {@link commitAlias}. */
export function commitPullsArgs(commits: readonly string[]): readonly string[] {
  const declared = commits.map((_, index) => `, $${commitAlias(index)}: GitObjectID!`).join('');
  const objects = commits.map((_, index) => ` ${commitAlias(index)}: object(oid: $${commitAlias(index)})`
    + ` { ... on Commit { associatedPullRequests(first: ${String(COMMIT_PULL_LIMIT)})`
    + ' { pageInfo { hasNextPage } nodes { number state baseRefName body mergeCommit { oid }'
    + ` closingIssuesReferences(first: ${String(CLOSING_LIMIT)}) { pageInfo { hasNextPage }`
    + ' nodes { number repository { nameWithOwner } } } } } } }').join('');
  const query = `query($owner: String!, $repo: String!${declared}) { repository(owner: $owner, name: $repo) { nameWithOwner${objects} } }`;
  return Object.freeze([
    'api',
    'graphql',
    '-F',
    'owner={owner}',
    '-F',
    'repo={repo}',
    ...commits.flatMap((commit, index) => ['-f', `${commitAlias(index)}=${commit}`]),
    '-f',
    `query=${query}`,
  ]);
}

/** Refuses an answer, naming where it went wrong and what was there. */
function refuse(problem: string): never {
  throw new Error(`${PREFIX}: ${problem}`);
}

function readMapping(value: unknown, where: string): Answer {
  if (!isMapping(value)) refuse(`${where} is ${describeValue(value)}, expected a mapping`);
  return value;
}

function readList(value: unknown, where: string): readonly unknown[] {
  if (!Array.isArray(value)) refuse(`${where} is ${describeValue(value)}, expected a list`);
  return value;
}

function readNumber(value: unknown, where: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    refuse(`${where} is ${describeValue(value)}, expected a positive whole number`);
  }
  return value;
}

function readString(value: unknown, where: string): string {
  if (typeof value !== 'string') refuse(`${where} is ${describeValue(value)}, expected a string`);
  return value;
}

/** The nodes of the connection at `where`, refusing a second page: a dropped entry would read as complete. */
function readOnePage(value: unknown, where: string): readonly unknown[] {
  const connection = readMapping(value, where);
  if (readMapping(connection['pageInfo'], `${where}.pageInfo`)['hasNextPage'] !== false) {
    refuse(`${where} holds more entries than one page`);
  }
  return readList(connection['nodes'], `${where}.nodes`);
}

/** The pull request at `where`, or null for one that is not merged. */
function readPull(value: unknown, where: string, repository: string): CommitPull | null {
  const pull = readMapping(value, where);
  if (pull['state'] !== 'MERGED') return null;
  const merge = pull['mergeCommit'];
  const linked = readOnePage(pull['closingIssuesReferences'], `${where}.closingIssuesReferences`).flatMap((node, index) => {
    const at = `${where}.closingIssuesReferences[${String(index)}]`;
    const issue = readMapping(node, at);
    const owner = readString(readMapping(issue['repository'], `${at}.repository`)['nameWithOwner'], `${at}.repository.nameWithOwner`);
    return owner.toLowerCase() === repository.toLowerCase()
      ? [readNumber(issue['number'], `${at}.number`)]
      : [];
  });
  return {
    number: readNumber(pull['number'], `${where}.number`),
    baseRefName: readString(pull['baseRefName'], `${where}.baseRefName`),
    mergeCommit: isMapping(merge)
      ? readString(merge['oid'], `${where}.mergeCommit.oid`)
      : null,
    issues: [...linked, ...closedIssuesIn(readString(pull['body'], `${where}.body`))],
  };
}

/** The pull requests that brought `commit`, out of the merged ones it answered; see the module note. */
function broughtBy(pulls: readonly CommitPull[], commit: string, branch: string): readonly CommitPull[] {
  const merged = pulls.filter((pull) => pull.mergeCommit === commit);
  return merged.length > 0
    ? merged
    : pulls.filter((pull) => pull.baseRefName === branch);
}

/** Sends one query for `commits` and answers the pull requests that brought each, in order. */
async function readBatch(gh: GhRunner, commits: readonly string[], branch: string): Promise<readonly CommitPull[]> {
  const result = await gh(commitPullsArgs(commits));
  if (!result.ok) refuse(`gh api graphql failed: ${result.stderr.trim() || result.stdout.trim()}`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    refuse('gh api graphql answered text that is not JSON');
  }
  const data = readMapping(readMapping(parsed, 'the answer')['data'], 'data');
  const answer = readMapping(data['repository'], 'data.repository');
  const repository = readString(answer['nameWithOwner'], 'data.repository.nameWithOwner');
  return commits.flatMap((commit, index) => {
    const where = `commit ${commit}`;
    const object = answer[commitAlias(index)];
    if (object === null || object === undefined) return [];
    const pulls = readOnePage(readMapping(object, where)['associatedPullRequests'], `${where}.associatedPullRequests`)
      .map((pull, at) => readPull(pull, `${where}.associatedPullRequests[${String(at)}]`, repository))
      .filter((pull): pull is CommitPull => pull !== null);
    return broughtBy(pulls, commit, branch);
  });
}

/** The pull requests that brought `commits`, batch by batch, in order. */
async function readPulls(gh: GhRunner, commits: readonly string[], branch: string): Promise<readonly CommitPull[]> {
  const pulls: CommitPull[] = [];
  for (let start = 0; start < commits.length; start += COMMIT_BATCH) {
    pulls.push(...await readBatch(gh, commits.slice(start, start + COMMIT_BATCH), branch));
  }
  return pulls;
}

/** The distinct commits that added the fragments a delivery released, in fold order; null when it released none. */
export function releasedCommits(delivered: SettleDelivered): readonly string[] | null {
  const { outcome } = delivered;
  if (outcome.outcome !== 'pushed' && outcome.outcome !== 'superseded') return null;
  return [...new Set(outcome.build.fragments.map((fragment) => fragment.commit))];
}

/**
 * Refreshes on the project the issues closed by the pull requests whose
 * fragments the settle released; never rejects. Null, having opened no
 * runner, with `board.project.number` unset or a delivery that released
 * nothing. See the module note.
 */
export async function refreshProjectAfterSettle(options: SettleProjectOptions): Promise<SettleProjectRefresh | null> {
  const { config, branch, refresh = refreshIssueItems } = options;
  const commits = releasedCommits(options.delivered);
  if (config.boardProjectNumber === null || commits === null || commits.length === 0) return null;

  const gh = options.openGh();
  let pulls: readonly CommitPull[];
  try {
    pulls = await readPulls(gh, commits, branch);
  } catch (error) {
    return { commits, pullRequests: [], issues: [], warnings: [settleProblemLine([], messageOf(error))] };
  }
  const pullRequests = [...new Set(pulls.map((pull) => pull.number))];
  const issues = [...new Set(pulls.flatMap((pull) => pull.issues))];
  if (issues.length === 0) return { commits, pullRequests, issues, warnings: [] };
  try {
    return { commits, pullRequests, issues, warnings: (await refresh({ config, gh }, issues)).warnings };
  } catch (error) {
    return { commits, pullRequests, issues, warnings: [settleProblemLine(issues, messageOf(error))] };
  }
}
