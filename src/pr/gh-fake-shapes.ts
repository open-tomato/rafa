/**
 * What `gh` writes about a pull request, as recorded: the records the
 * fake in `./gh-fake.ts` holds, the payloads it answers with, and the
 * failures it answers instead.
 *
 * Split out of `./gh-fake.ts` so neither file carries two concerns: this
 * one is the shape of an answer and nothing else — every function here is
 * pure and none of them knows which commands exist — and `./gh-fake.ts`
 * is the command surface, the repository it holds and the strictness over
 * both. Together they are the `gh pr` half of the discipline
 * `src/adapters/tracker/github-fake.ts` holds for issues.
 *
 * ## Recorded
 *
 * Every shape below was read off `gh` 2.100.0 on 2026-09-18, with
 * read-only commands against the public `cli/cli` and `oven-sh/bun`
 * repositories and against `open-tomato/rafa`, from a scratch directory
 * with `--repo`. Each was taken, not assumed:
 *
 *   - `gh pr view <n> --json <fields>` and `gh pr list --json <fields>`
 *     write exactly the fields asked for, keys sorted by code unit, so
 *     `mergeStateStatus` comes before `mergeable`. Both end their output
 *     with a newline.
 *   - An author is `{"id","is_bot","login","name"}` for a person and
 *     `{"is_bot","login"}` for a bot — no `id` and no `name`. A bot's
 *     login is the app path: `cli/cli`'s dependabot pull requests answer
 *     `app/dependabot`, NOT `dependabot[bot]`.
 *   - A label is `{"id","name","description","color"}`, in that order,
 *     which is the issue shape the tracker fake already writes.
 *   - `gh pr list` answered its rows newest first, and `--head` with no
 *     open pull request on the branch answered `[]` and exit 0.
 *   - A merged pull request answers `state` `MERGED` with `mergeable`
 *     and `mergeStateStatus` both `UNKNOWN` (`cli/cli#14447`).
 *   - `statusCheckRollup` carries two kinds of entry. A `CheckRun` is
 *     `{"__typename","completedAt","conclusion","detailsUrl","name",
 *     "startedAt","status","workflowName"}`; while it is in flight its
 *     `status` is `IN_PROGRESS`, its `conclusion` an empty string and its
 *     `completedAt` `0001-01-01T00:00:00Z`. A `StatusContext` — a check
 *     posted by a service outside Actions, `buildkite/bun` on
 *     `oven-sh/bun#43320` — carries different keys entirely:
 *     `{"__typename","context","startedAt","state","targetUrl"}`, so a
 *     reader that expects `name` and `conclusion` on every entry reads
 *     undefined off a real pull request.
 *   - `gh pr checks <n> --json name,state,link` writes `state` as the
 *     conclusion of a finished CheckRun, `IN_PROGRESS` for a running
 *     one, and `PENDING` for a waiting StatusContext. WITH `--json` it
 *     exits 0 on a red pull request (`cli/cli#14035`, one `FAILURE`
 *     row); WITHOUT it, the same pull request exits 1. On a pull request
 *     with no checks at all it exits 1 either way, writes nothing to
 *     stdout, and writes `no checks reported on the '<branch>' branch`
 *     to stderr (`cli/cli#1`, `#5`, `#12`).
 *   - `gh pr view <n> --web` exits 0 writing nothing to either stream,
 *     with `BROWSER` set to a command that consumes the URL. Passing
 *     `--web` with `--json` exits 1 with ``cannot use `--web` with
 *     `--json` `` on stderr.
 *   - A pull request that does not exist exits 1 with `GraphQL: Could
 *     not resolve to a PullRequest with the number of <n>.
 *     (repository.pullRequest)` on stderr.
 *   - `gh run view <id> --log-failed` writes one TAB-separated line per
 *     log line, `<job>\t<step>\t<timestamp> <text>`. The step column
 *     read `UNKNOWN STEP` on EVERY line of all three failed runs read
 *     (`cli/cli` 34978884017 and 34857793347, `oven-sh/bun`
 *     34037088339), so the failing step name is NOT readable from this
 *     command on 2.100.0 — `gh run view <id> --json jobs` carries it, on
 *     each job's `steps[]` as `{"name","number","conclusion","status"}`.
 *     A run that does not exist exits 1 with `failed to get run: HTTP
 *     404: Not Found (<api url>)`; a run whose log has been dropped
 *     exits 1 with `failed to get run log: log not found`
 *     (`cli/cli` 34856988782).
 *   - `gh api <path>` writes its JSON with NO trailing newline, where
 *     every `--json` command ends with one. On a 404 it exits 1, writes
 *     the error body to stdout and `gh: <message> (HTTP 404)` to stderr.
 *   - An issue comment read through `gh api repos/<repo>/issues/<n>/comments`
 *     carries `url`, `html_url`, `issue_url`, `id`, `node_id`, `user`,
 *     `created_at`, `updated_at`, `author_association`, `body`,
 *     `reactions`, `performed_via_github_app` and `minimized`, with `id`
 *     a number and `user.type` `User`. The same comment read through
 *     `gh pr view <n> --json comments` carries `createdAt` and NO
 *     `updatedAt`, and its `author` is `{"login"}` alone — which is why
 *     the port's `PullRequestComment` (`./types.ts`) is filled from the
 *     REST path and not from the `--json` field.
 *   - `gh api repos/<repo>/collaborators/<login>/permission` answers
 *     `{"permission","role_name","user"}`; `admin` for a write-holder
 *     and `read` for an outsider on a public repository. A login that is
 *     no GitHub account is the 404 above, with the message
 *     `<login> is not a user`.
 *
 * Read the same way on 2026-09-22, again off `gh` 2.100.0 with read-only
 * commands, for the workflow count:
 *
 *   - `gh api repos/<repo>/actions/workflows` answers
 *     `{"total_count","workflows"}` and exit 0. `open-tomato/rafa`, which
 *     has no workflow, answered exactly `{"total_count":0,"workflows":[]}`
 *     with no trailing newline. `cli/cli` answered 21, each workflow
 *     `{"id","node_id","name","path","state","created_at","updated_at",
 *     "url","html_url","badge_url"}` in that order, `state` read as
 *     `active` or `disabled_manually`. `github/docs` answered
 *     `total_count` 119 beside a `workflows` array of 30: without
 *     `--paginate` the array is the first page and `total_count` the
 *     whole count, so only `total_count` counts.
 *   - A repository the account cannot read (`open-tomato/no-such-repo-rafa86`)
 *     is the 404 above: message `Not Found`, documentation URL
 *     `https://docs.github.com/rest/actions/workflows#list-repository-workflows`.
 *   - No repository read answered the workflows path with a 403, so its
 *     403 is the ENVELOPE recorded off two sibling `actions` paths
 *     (`repos/github/docs/actions/permissions` and
 *     `repos/cli/cli/actions/secrets`): exit 1, the body
 *     `{"message","documentation_url","status":"403"}` on stdout and
 *     `gh: <message> (HTTP 403)` on stderr, the 404's shape with the
 *     other status. The message it carries is the `actions/permissions`
 *     one verbatim, beside the workflows documentation URL.
 *
 * Read the same way on 2026-09-24, again off `gh` 2.100.0 with read-only
 * commands, for the merged list:
 *
 *   - `gh pr list --state merged --limit <n> --json
 *     headRefName,headRefOid,mergedAt,number` writes those four keys in
 *     that order and ends with a newline, `mergedAt` an ISO 8601 instant
 *     such as `2026-09-23T16:38:29Z`. Its rows came newest CREATED first
 *     — `createdAt` and `number` both descending over 100 rows of
 *     `cli/cli` — and NOT in `mergedAt` order: `cli/cli#14509` was merged
 *     at 16:38 and listed ahead of `#14507`, merged at 21:21 the same day.
 *   - An OPEN pull request answers `mergedAt` null (`cli/cli#14485`).
 *   - `open-tomato/rafa`'s merged rows still answered `headRefName` for
 *     heads the remote no longer held, `git ls-remote` finding neither
 *     `feat/rafa-100-rafa-doctor-deep` nor
 *     `feat/rafa-123-rafa-issue-list-roadmap`.
 *
 * NOT recorded, because reading one would write to a repository: what
 * `gh pr merge`, `gh pr edit`, a comment POST and a comment PATCH write
 * when they succeed, and what any of them writes when it fails. So the
 * fake writes NOTHING on a successful merge or body edit, and a caller
 * reads that outcome from the exit code alone; a merge refusal is
 * planted by the case that wants one. `gh pr edit --help`, read on
 * 2026-09-20 off the same 2.100.0, carries `-b, --body string` as "Set
 * the new body" and says the pull request's URL is printed to stdout —
 * help text, not a run, which is why the fake writes no URL and nothing
 * in `./gh.ts` reads one.
 *
 * Where a `gh api` payload is answered, the fake writes the recorded keys
 * this plan's adapter reads and leaves the rest of GitHub's payload out:
 * `reactions`, `performed_via_github_app` and `minimized` on a comment,
 * and every key of a `user` but `login` and `type`. A `--json` payload
 * has no such licence: `gh` writes exactly the fields asked for, and so
 * does the fake.
 */
import type { GhResult } from '../adapters/tracker/github.js';

/** Who opened a pull request, or wrote a comment, as the fake holds it. */
export interface FakePrAuthor {
  readonly login: string;
  /** True for an app account, whose login is an `app/<name>` path. */
  readonly isBot: boolean;
  /** The display name a person carries. A bot has none, as recorded. */
  readonly name?: string;
}

/** Which rollup entry a check is written as; see the module note. */
export type FakeCheckKind = 'check-run' | 'status-context';

/** One check on a pull request. */
export interface FakePrCheck {
  readonly name: string;
  /** GitHub's raw state: a conclusion, `IN_PROGRESS`, or `PENDING`. */
  readonly state: string;
  readonly link: string;
  /** `check-run` when left out. */
  readonly kind?: FakeCheckKind;
  /** The workflow a `check-run` belongs to. Empty when left out. */
  readonly workflowName?: string;
}

/** One comment on a pull request, as both comment readings answer it. */
export interface FakePrComment {
  /** The REST id, which `gh api .../issues/comments/<id>` takes. */
  readonly id: number;
  readonly author: FakePrAuthor;
  readonly body: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  /** `MEMBER`, `OWNER`, `CONTRIBUTOR` or `NONE`; `MEMBER` when left out. */
  readonly authorAssociation?: string;
}

/** One pull request the fake repository holds. */
export interface FakePullRequest {
  readonly number: number;
  readonly title: string;
  readonly body: string;
  readonly author: FakePrAuthor;
  readonly headRefName: string;
  readonly baseRefName: string;
  readonly headRefOid: string;
  readonly isCrossRepository: boolean;
  readonly state: 'OPEN' | 'CLOSED' | 'MERGED';
  /**
   * When the pull request was merged, ISO 8601; null for one that is
   * not, as recorded for an open one. A case that turns a pull request
   * `MERGED` through `update` sets this too, or the merged list writes
   * the null a real merged row never carries.
   */
  readonly mergedAt: string | null;
  readonly mergeable: 'MERGEABLE' | 'CONFLICTING' | 'UNKNOWN';
  /** `CLEAN`, `BLOCKED`, `DIRTY`, `BEHIND` or `UNKNOWN`, verbatim. */
  readonly mergeStateStatus: string;
  readonly labels: readonly string[];
  readonly updatedAt: string;
  readonly checks: readonly FakePrCheck[];
  readonly comments: readonly FakePrComment[];
}

/** A pull request to plant: its number, and whatever it is not the default of. */
export type FakePullRequestSeed =
  & Partial<Omit<FakePullRequest, 'number'>>
  & { readonly number: number };

/** The fields `gh pr view` and `gh pr list` are asked for here. */
export const PULL_FIELDS: ReadonlySet<string> = new Set([
  'author',
  'baseRefName',
  'body',
  'comments',
  'headRefName',
  'headRefOid',
  'isCrossRepository',
  'labels',
  'mergeStateStatus',
  'mergeable',
  'mergedAt',
  'number',
  'state',
  'statusCheckRollup',
  'title',
  'updatedAt',
  'url',
]);

/** The fields `gh pr checks` is asked for here. */
export const CHECK_FIELDS: ReadonlySet<string> = new Set(['link', 'name', 'state']);

/** The states `gh pr list --state` takes. */
export const LIST_STATES: ReadonlySet<string> = new Set(['all', 'closed', 'merged', 'open']);

/** How many pull requests `gh pr list` writes when nothing says otherwise. */
export const DEFAULT_LIST_LIMIT = 30;

/** Recorded in a repository with no remote. */
export const NO_REMOTES = 'no git remotes found\n';

/** Recorded when a run exists and its log has been dropped. */
export const LOG_NOT_FOUND = 'failed to get run log: log not found\n';

/** Recorded when `--web` and `--json` are passed together. */
export const WEB_WITH_JSON = 'cannot use `--web` with `--json`\n';

/** The states a check is still in flight in, as recorded and as GitHub spells them. */
const IN_FLIGHT_STATES: ReadonlySet<string> = new Set([
  'EXPECTED',
  'IN_PROGRESS',
  'PENDING',
  'QUEUED',
  'REQUESTED',
  'WAITING',
]);

/** A finished check's `completedAt` is a real instant; a running one's is this. */
const NEVER_COMPLETED = '0001-01-01T00:00:00Z';

/** What a seed leaves out, minus the number, the author, the head and the merge instant. */
const PULL_DEFAULTS = {
  title: 'a pull request',
  body: '',
  baseRefName: 'main',
  isCrossRepository: false,
  state: 'OPEN',
  mergeable: 'MERGEABLE',
  mergeStateStatus: 'CLEAN',
  labels: [],
  updatedAt: '2026-09-18T11:00:00Z',
  checks: [],
  comments: [],
} as const satisfies Omit<FakePullRequest, 'number' | 'author' | 'headRefName' | 'headRefOid' | 'mergedAt'>;

/** The author a seed that names none carries. */
const DEFAULT_AUTHOR: FakePrAuthor = Object.freeze({ login: 'octo', isBot: false, name: 'Octo Cat' });

/** A successful answer. */
export function ok(stdout = ''): GhResult {
  return { ok: true, stdout, stderr: '' };
}

/** A failed answer, which may still have written a body to stdout. */
export function failed(stderr: string, stdout = ''): GhResult {
  return { ok: false, stdout, stderr };
}

/** Whether a value is an answer rather than a record read out of the fake. */
export function isResult(value: object): value is GhResult {
  return 'ok' in value;
}

/** The HTTP statuses a `gh api` failure is recorded for. */
export type FakeHttpStatus = 403 | 404;

/** A recorded `gh api` failure: the body on stdout, `gh: <message> (HTTP <status>)` on stderr. */
export function httpFailure(status: FakeHttpStatus, message: string, documentationUrl: string): GhResult {
  return failed(
    `gh: ${message} (HTTP ${status})\n`,
    JSON.stringify({ message, documentation_url: documentationUrl, status: String(status) }),
  );
}

/** The recorded 404: the body on stdout, `gh: <message> (HTTP 404)` on stderr. */
export function notFound(message: string, documentationUrl: string): GhResult {
  return httpFailure(404, message, documentationUrl);
}

/** The documentation URL the workflows path's failures carry, as recorded. */
export const WORKFLOWS_DOCS = 'https://docs.github.com/rest/actions/workflows#list-repository-workflows';

/** The message the recorded `actions` 403 carries; see the module note. */
export const ACTIONS_FORBIDDEN =
  'You must have repository read permissions or have the repository Actions policies fine-grained permission.';

/** How many workflows one page of `gh api .../actions/workflows` holds, as recorded. */
export const WORKFLOWS_PAGE = 30;

/** The recorded failure of the workflows path under one status. */
export function workflowsFailure(status: FakeHttpStatus): GhResult {
  return status === 404
    ? httpFailure(404, 'Not Found', WORKFLOWS_DOCS)
    : httpFailure(403, ACTIONS_FORBIDDEN, WORKFLOWS_DOCS);
}

/** Recorded for a pull request number the repository has none of. */
export function missingPull(raw: string): GhResult {
  return failed(`GraphQL: Could not resolve to a PullRequest with the number of ${raw}. (repository.pullRequest)\n`);
}

/** Recorded for a pull request with no checks at all. */
export function noChecksReported(branch: string): GhResult {
  return failed(`no checks reported on the '${branch}' branch\n`);
}

/** Recorded for a run id the repository has none of. */
export function missingRun(repo: string, id: string): GhResult {
  const url = `https://api.github.com/repos/${repo}/actions/runs/${id}?exclude_pull_requests=true`;
  return failed(`failed to get run: HTTP 404: Not Found (${url})\n`);
}

/** A pull request's own URL. */
export function pullUrl(repo: string, number: number): string {
  return `https://github.com/${repo}/pull/${number}`;
}

/**
 * A seed filled out into the pull request the repository holds.
 *
 * A `MERGED` seed that names no `mergedAt` is merged at its `updatedAt`,
 * a merge being the last time a merged pull request moved; any other
 * state is merged at null.
 */
export function fillSeed(seed: FakePullRequestSeed): FakePullRequest {
  const updatedAt = seed.updatedAt ?? PULL_DEFAULTS.updatedAt;
  return {
    ...PULL_DEFAULTS,
    author: DEFAULT_AUTHOR,
    headRefName: `feat/pr-${seed.number}`,
    headRefOid: String(seed.number).padStart(40, '0'),
    mergedAt: seed.state === 'MERGED'
      ? updatedAt
      : null,
    ...seed,
  };
}

/** An author as `--json author` writes it: no `id` and no `name` for a bot. */
function renderAuthor(author: FakePrAuthor): Record<string, unknown> {
  return author.isBot
    ? { is_bot: true, login: author.login }
    : { id: `MDQ6VXNlcmZha2U${author.login}`, is_bot: false, login: author.login, name: author.name ?? author.login };
}

/** One rollup entry, in the shape its `__typename` carries. */
function renderRollupEntry(check: FakePrCheck, at: string): Record<string, unknown> {
  if (check.kind === 'status-context') {
    return {
      __typename: 'StatusContext',
      context: check.name,
      startedAt: at,
      state: check.state,
      targetUrl: check.link,
    };
  }
  const running = IN_FLIGHT_STATES.has(check.state);
  return {
    __typename: 'CheckRun',
    completedAt: running
      ? NEVER_COMPLETED
      : at,
    conclusion: running
      ? ''
      : check.state,
    detailsUrl: check.link,
    name: check.name,
    startedAt: at,
    status: running
      ? check.state
      : 'COMPLETED',
    workflowName: check.workflowName ?? '',
  };
}

/** A comment as `--json comments` writes it: `createdAt`, and no `updatedAt`. */
function renderEmbeddedComment(comment: FakePrComment, url: string): Record<string, unknown> {
  return {
    id: `IC_kwDOfake${comment.id}`,
    author: { login: comment.author.login },
    authorAssociation: comment.authorAssociation ?? 'MEMBER',
    body: comment.body,
    createdAt: comment.createdAt,
    includesCreatedEdit: comment.createdAt !== comment.updatedAt,
    isMinimized: false,
    minimizedReason: '',
    reactionGroups: [],
    url: `${url}#issuecomment-${comment.id}`,
    viewerDidAuthor: false,
  };
}

/** The fields asked for, in the code-unit order `gh` writes them in. */
function pick(values: Record<string, unknown>, fields: readonly string[]): Record<string, unknown> {
  return Object.fromEntries([...fields].sort().map((field) => [field, values[field]]));
}

/** A pull request as `gh pr view --json` and `gh pr list --json` write it. */
export function renderPull(
  pull: FakePullRequest,
  fields: readonly string[],
  repo: string,
): Record<string, unknown> {
  const url = pullUrl(repo, pull.number);
  return pick({
    author: renderAuthor(pull.author),
    baseRefName: pull.baseRefName,
    body: pull.body,
    comments: pull.comments.map((comment) => renderEmbeddedComment(comment, url)),
    headRefName: pull.headRefName,
    headRefOid: pull.headRefOid,
    isCrossRepository: pull.isCrossRepository,
    labels: pull.labels.map((name, index) => ({ id: `LA_fake${index}`, name, description: '', color: 'ededed' })),
    mergeStateStatus: pull.mergeStateStatus,
    mergeable: pull.mergeable,
    mergedAt: pull.mergedAt,
    number: pull.number,
    state: pull.state,
    statusCheckRollup: pull.checks.map((check) => renderRollupEntry(check, pull.updatedAt)),
    title: pull.title,
    updatedAt: pull.updatedAt,
    url,
  }, fields);
}

/** One check row as `gh pr checks --json` writes it. */
export function renderCheckRow(check: FakePrCheck, fields: readonly string[]): Record<string, unknown> {
  return pick({ link: check.link, name: check.name, state: check.state }, fields);
}

/** A comment as `gh api` writes it: the recorded keys this plan reads. */
export function renderRestComment(
  comment: FakePrComment,
  pull: FakePullRequest,
  repo: string,
): Record<string, unknown> {
  return {
    url: `https://api.github.com/repos/${repo}/issues/comments/${comment.id}`,
    html_url: `${pullUrl(repo, pull.number)}#issuecomment-${comment.id}`,
    issue_url: `https://api.github.com/repos/${repo}/issues/${pull.number}`,
    id: comment.id,
    node_id: `IC_kwDOfake${comment.id}`,
    user: {
      login: comment.author.login,
      type: comment.author.isBot
        ? 'Bot'
        : 'User',
    },
    created_at: comment.createdAt,
    updated_at: comment.updatedAt,
    author_association: comment.authorAssociation ?? 'MEMBER',
    body: comment.body,
  };
}

/** The permission payload the collaborators endpoint answers. */
export function renderPermission(login: string, permission: string): Record<string, unknown> {
  return {
    permission,
    role_name: permission,
    user: { login, type: 'User' },
  };
}

/** One workflow the fake repository holds. */
export interface FakeWorkflow {
  readonly name: string;
  /** `active` when left out; `disabled_manually` was also recorded. */
  readonly state?: string;
}

/** One workflow as the workflows path writes it, keys in the recorded order. */
function renderWorkflow(workflow: FakeWorkflow, index: number, repo: string): Record<string, unknown> {
  const id = 25016 + index;
  const file = `${workflow.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.yml`;
  return {
    id,
    node_id: `W_kwDOfake${id}`,
    name: workflow.name,
    path: `.github/workflows/${file}`,
    state: workflow.state ?? 'active',
    created_at: '2026-09-18T11:00:00.000+02:00',
    updated_at: '2026-09-18T11:00:00.000+02:00',
    url: `https://api.github.com/repos/${repo}/actions/workflows/${id}`,
    html_url: `https://github.com/${repo}/blob/main/.github/workflows/${file}`,
    badge_url: `https://github.com/${repo}/workflows/${encodeURIComponent(workflow.name)}/badge.svg`,
  };
}

/**
 * The workflows payload: `total_count` the whole count, `workflows` the
 * first page of {@link WORKFLOWS_PAGE} alone, as recorded unpaginated.
 */
export function renderWorkflows(workflows: readonly FakeWorkflow[], repo: string): Record<string, unknown> {
  return {
    total_count: workflows.length,
    workflows: workflows.slice(0, WORKFLOWS_PAGE).map((workflow, index) => renderWorkflow(workflow, index, repo)),
  };
}

/**
 * The `--log-failed` text of one job, in the recorded TAB shape.
 *
 * The step column is `UNKNOWN STEP` because that is what `gh` 2.100.0
 * wrote on every line of every failed run read; see the module note.
 */
export function logFailedText(job: string, lines: readonly string[], at = '2026-09-18T11:30:00Z'): string {
  return lines.map((line) => `${job}\tUNKNOWN STEP\t${at} ${line}\n`).join('');
}
