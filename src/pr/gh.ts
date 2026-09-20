/**
 * The `gh` pull request provider: {@link PullRequests} over a
 * {@link GhRunner}.
 *
 * Every member sends one `gh` command and reads what it wrote. The
 * adapter spawns nothing itself — it is made with the same runner seam
 * the github tracker takes (`src/adapters/tracker/github.ts`), so the
 * cases in `./gh.test.ts` drive it through the recorded fake in
 * `./gh-fake.ts` and none of them reaches GitHub, spawns a process, or
 * reads the configuration `gh` keeps under the home. Authentication is
 * the one `gh` holds: nothing here reads a token, and
 * {@link ghAuthOk} only asks whether it has one.
 *
 * {@link ghPullRequestsIn} is the single place a runner that DOES spawn
 * the real CLI is made, so a caller that wants the real provider names
 * one function and every other caller hands over its own.
 *
 * ## Which repository
 *
 * No command passes `--repo`, and every `gh api` path goes through the
 * `{owner}/{repo}` placeholders. `gh` resolves the repository of the
 * directory the runner runs in, which is what the github tracker does
 * for the same reason: the caller chose the directory, and a second
 * source of truth for the repository is a way for the two halves to
 * disagree.
 *
 * ## The readings that shaped it
 *
 * All recorded in `./gh-fake-shapes.ts`, which is where each one was
 * measured; the consequence for this adapter is here.
 *
 *   - **A red pull request exits 0 under `--json`.** `gh pr checks`
 *     without `--json` exits 1 on a failing check and 0 on a green one;
 *     WITH `--json` it exits 0 either way. So {@link PullRequests.checks}
 *     reads its verdict off the rows, through `parseChecks` and
 *     `verdictOf` in `./checks.js`, and never off the exit code. The one
 *     thing the exit code is read for is the no-checks case, which `gh`
 *     reports by failing with `no checks reported on the '<branch>'
 *     branch` and writing nothing to stdout: that is `none`, a verdict
 *     and not an error, as the port declares.
 *   - **A pull request that does not exist is a FAILURE, not an empty
 *     answer.** `gh pr view <n>` exits 1 writing `GraphQL: Could not
 *     resolve to a PullRequest with the number of <n>.`, which is the
 *     only thing separating it from an outage — both exit 1. So
 *     {@link PullRequests.get} answers null on that message alone and
 *     throws on every other failure, and `gh.test.ts` holds a runner
 *     answering a connection failure as the control that the null is
 *     not simply "it failed".
 *   - **The comment members go through `gh api`, not through `gh pr`.**
 *     `gh pr view --json comments` carries no `updatedAt` and carries
 *     the GraphQL node id, where `editComment` needs the REST id its
 *     PATCH path takes. So `comments`, `comment` and `editComment` read
 *     and write `repos/{owner}/{repo}/issues/<n>/comments` and
 *     `.../issues/comments/<id>`, and the REST id, a number there, is
 *     answered as the port's string.
 *   - **`--paginate` is not sent**, so `comments` reads GitHub's first
 *     page. The triage comment this port exists for is found by scanning
 *     for a marker in a PR's own comments, and a PR with more than a
 *     page of them is not a case this plan builds for; a stage that
 *     needs the rest adds the flag and the fake models it then.
 *   - **A body edit goes through `gh pr edit`, and nothing reads what it
 *     wrote.** `gh pr edit --help` on 2.100.0 carries `-b, --body
 *     string` as "Set the new body" and says the pull request's URL is
 *     printed to stdout; what a successful edit actually writes was not
 *     recorded, a write being the one thing `./gh-fake-shapes.ts` could
 *     not read off a repository. So `editBody` reads the exit code
 *     alone, as `merge` does, and answers nothing. The body travels as
 *     ONE argument after `--body`, never interpolated into a command
 *     line: the runner spawns `gh` with an argument list, so a body
 *     holding newlines, quotes or backticks reaches GitHub as written.
 *
 * ## What is refused, and what is narrowed
 *
 * A pull request number, a comment id and a run id are checked before
 * any argument is built from them, so no caller hands `gh` a flag where
 * a number goes: `get(-1)` would otherwise send `gh pr view -1`. A merge
 * method is checked against {@link MERGE_METHODS} for the same reason —
 * an unchecked one becomes the flag `--<whatever the config said>`.
 *
 * A payload is checked field by field, and a refusal names the field and
 * what was there, because `gh` writing a shape this adapter did not
 * expect is a reading about `gh`, not something to paper over with a
 * default. The two narrowings are deliberately asymmetric:
 *
 *   - An unrecognised `state` is REFUSED. There is no safe answer: open,
 *     closed and merged are three different actions to every caller.
 *   - An unrecognised `mergeable` is read as `unknown`, which is
 *     GitHub's own word for "not computed yet". `unknown` is the
 *     conservative reading — `merge` refuses on it — where refusing the
 *     whole payload would make a PR unreadable over a word GitHub added.
 *     The raw `mergeStateStatus` stays verbatim beside it, so a report
 *     can still name what GitHub said.
 *
 * `failedLog` splits the same way. A run whose log has been dropped
 * (`failed to get run log: log not found`) answers the empty string the
 * port declares, because an expired log is an ordinary state of an old
 * run. A run that does not exist (`HTTP 404`) THROWS, because a run id
 * is derived from a check's link and a wrong one has to be loud rather
 * than read as a run with nothing to say.
 */
import type {
  ChecksReading,
  MergeMethod,
  Mergeability,
  MergeOutcome,
  PullRequestAuthor,
  PullRequestComment,
  PullRequestDetail,
  PullRequestState,
  PullRequestSummary,
  PullRequests,
} from './types.js';
import type { GhResult, GhRunner } from '../adapters/tracker/github.js';

import { createGhRunner } from '../adapters/tracker/github.js';
import { describeValue, isMapping, messageOf } from '../config-sections.js';

import { parseChecks, verdictOf } from './checks.js';
import { MERGE_METHODS, isMergeMethod } from './types.js';

/** What every refusal opens with. */
const PREFIX = 'gh pull requests';

/** The repository placeholders `gh api` expands from the directory it runs in. */
const REPO_PATH = '{owner}/{repo}';

/** The fields a summary is read from. */
const SUMMARY_FIELDS = 'author,baseRefName,headRefName,isCrossRepository,number,state,title,updatedAt,url';

/** The fields a detail is read from: the summary's, and what only a per-PR read answers. */
const DETAIL_FIELDS = `${SUMMARY_FIELDS},body,headRefOid,labels,mergeStateStatus,mergeable`;

/** The fields a check row is read from; `parseChecks` reads exactly these. */
const CHECK_FIELDS = 'name,state,link';

/** How many pull requests `list` asks for: `gh pr list`'s own default. */
const LIST_LIMIT = 30;

/** How many `findOpen` asks for. It answers the first, and `gh` lists newest first. */
const FIND_LIMIT = 1;

/** Recorded in the stderr of a read of a pull request the repository has none of. */
const MISSING_PULL = 'Could not resolve to a PullRequest';

/** Recorded in the stderr of `gh pr checks` on a pull request with no checks at all. */
const NO_CHECKS = 'no checks reported on the';

/** Recorded in the stderr of `gh run view --log-failed` for a run whose log was dropped. */
const LOG_DROPPED = 'log not found';

/** A positive whole number as written, with no leading zero and no sign. */
const WHOLE_NUMBER = /^[1-9]\d*$/;

/** The GitHub pull request state each port state is read from. */
const STATES: ReadonlyMap<string, PullRequestState> = new Map([
  ['OPEN', 'open'],
  ['CLOSED', 'closed'],
  ['MERGED', 'merged'],
]);

/** The mergeability each GitHub word is read as; an unrecognised one is `unknown`. */
const MERGEABILITY: ReadonlyMap<string, Mergeability> = new Map([
  ['MERGEABLE', 'mergeable'],
  ['CONFLICTING', 'conflicting'],
  ['UNKNOWN', 'unknown'],
]);

/** What a failed command wrote, for a refusal or a merge outcome. Never empty. */
function detailOf(result: GhResult, command: string): string {
  const written = result.stderr.trim() || result.stdout.trim();
  if (written !== '') return written;
  return result.ok
    ? `${command} exited 0 and wrote nothing`
    : `${command} exited non-zero and wrote nothing`;
}

/** The error a failed command raises, naming it and what it wrote. */
function failure(command: string, result: GhResult): Error {
  return new Error(`${PREFIX}: ${command} failed: ${detailOf(result, command)}`);
}

/** Refuses a payload, naming the command, where it went wrong, and what was there. */
function refuse(command: string, problem: string): never {
  throw new Error(`${PREFIX}: ${command} answered ${problem}`);
}

/** What `command` wrote, parsed. Refuses, naming the command, when it is not JSON. */
function parseJson(stdout: string, command: string): unknown {
  try {
    return JSON.parse(stdout) as unknown;
  } catch (error) {
    throw new Error(`${PREFIX}: ${command} wrote output that is not JSON: ${messageOf(error)}`, { cause: error });
  }
}

/** The string at `where`, or a refusal. */
function readString(value: unknown, command: string, where: string): string {
  if (typeof value !== 'string') refuse(command, `${where} is ${describeValue(value)}, expected a string`);
  return value;
}

/** The boolean at `where`, or a refusal. */
function readBoolean(value: unknown, command: string, where: string): boolean {
  if (typeof value !== 'boolean') refuse(command, `${where} is ${describeValue(value)}, expected a boolean`);
  return value;
}

/** The mapping at `where`, or a refusal. */
function readMapping(value: unknown, command: string, where: string): Record<string, unknown> {
  if (!isMapping(value)) refuse(command, `${where} is ${describeValue(value)}, expected a mapping`);
  return value;
}

/** The list at `where`, or a refusal. */
function readList(value: unknown, command: string, where: string): unknown[] {
  if (!Array.isArray(value)) refuse(command, `${where} is ${describeValue(value)}, expected a list`);
  return value;
}

/** The positive whole number at `where`, or a refusal. */
function readWholeNumber(value: unknown, command: string, where: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    refuse(command, `${where} is ${describeValue(value)}, expected a positive whole number`);
  }
  return value;
}

/** The state at `where`. An unrecognised word is refused; see the module note. */
function readState(value: unknown, command: string, where: string): PullRequestState {
  const state = STATES.get(readString(value, command, where));
  if (state === undefined) {
    refuse(command, `${where} is ${describeValue(value)}, expected one of: ${[...STATES.keys()].join(', ')}`);
  }
  return state;
}

/** The mergeability at `where`. An unrecognised word reads `unknown`; see the module note. */
function readMergeability(value: unknown, command: string, where: string): Mergeability {
  return MERGEABILITY.get(readString(value, command, where)) ?? 'unknown';
}

/** An author as `--json author` writes it: `login` and `is_bot`. */
function readAuthor(value: unknown, command: string, where: string): PullRequestAuthor {
  const author = readMapping(value, command, where);
  return {
    login: readString(author['login'], command, `${where}.login`),
    isBot: readBoolean(author['is_bot'], command, `${where}.is_bot`),
  };
}

/** The names of the labels at `where`. */
function readLabels(value: unknown, command: string, where: string): string[] {
  return readList(value, command, where).map((label, index) => {
    const named = readMapping(label, command, `${where}[${index}]`);
    return readString(named['name'], command, `${where}[${index}].name`);
  });
}

/** One pull request as `gh pr list` and `gh pr view` write a summary's fields. */
function readSummary(value: unknown, command: string, where: string): PullRequestSummary {
  const pull = readMapping(value, command, where);
  return {
    number: readWholeNumber(pull['number'], command, `${where}.number`),
    title: readString(pull['title'], command, `${where}.title`),
    url: readString(pull['url'], command, `${where}.url`),
    state: readState(pull['state'], command, `${where}.state`),
    headRefName: readString(pull['headRefName'], command, `${where}.headRefName`),
    baseRefName: readString(pull['baseRefName'], command, `${where}.baseRefName`),
    author: readAuthor(pull['author'], command, `${where}.author`),
    isCrossRepository: readBoolean(pull['isCrossRepository'], command, `${where}.isCrossRepository`),
    updatedAt: readString(pull['updatedAt'], command, `${where}.updatedAt`),
  };
}

/** One pull request in full, as `gh pr view` writes the detail fields. */
function readDetail(value: unknown, command: string, where: string): PullRequestDetail {
  const pull = readMapping(value, command, where);
  return {
    ...readSummary(pull, command, where),
    body: readString(pull['body'], command, `${where}.body`),
    headRefOid: readString(pull['headRefOid'], command, `${where}.headRefOid`),
    mergeable: readMergeability(pull['mergeable'], command, `${where}.mergeable`),
    mergeStateStatus: readString(pull['mergeStateStatus'], command, `${where}.mergeStateStatus`),
    labels: readLabels(pull['labels'], command, `${where}.labels`),
  };
}

/** One comment as `gh api` writes the REST resource; see the module note. */
function readComment(value: unknown, command: string, where: string): PullRequestComment {
  const comment = readMapping(value, command, where);
  const user = readMapping(comment['user'], command, `${where}.user`);
  return {
    id: String(readWholeNumber(comment['id'], command, `${where}.id`)),
    author: {
      login: readString(user['login'], command, `${where}.user.login`),
      isBot: readString(user['type'], command, `${where}.user.type`) === 'Bot',
    },
    body: readString(comment['body'], command, `${where}.body`),
    updatedAt: readString(comment['updated_at'], command, `${where}.updated_at`),
    url: readString(comment['html_url'], command, `${where}.html_url`),
  };
}

/** The pull request number `member` was handed, as an argument. Throws when it is not one. */
function pullNumber(value: number, member: string): string {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(
      `${PREFIX}: ${member} refused pull request number ${describeValue(value)},`
        + ' expected a positive whole number',
    );
  }
  return String(value);
}

/** An id or a branch `member` was handed, checked against `WHOLE_NUMBER` or emptiness. */
function textArgument(value: string, member: string, what: string, whole: boolean): string {
  const bad = typeof value !== 'string'
    || value === ''
    || (whole && !(WHOLE_NUMBER.test(value) && Number.isSafeInteger(Number(value))));
  if (bad) {
    const expected = whole
      ? 'a positive whole number with no leading zero'
      : 'a non-empty string';
    throw new TypeError(`${PREFIX}: ${member} refused ${what} ${describeValue(value)}, expected ${expected}`);
  }
  return value;
}

/**
 * The body `member` was handed, a comment's or a pull request's own.
 * Throws when it is not a string; an empty one is a body, and clears
 * whatever was there.
 */
function bodyText(value: string, member: string): string {
  if (typeof value !== 'string') {
    throw new TypeError(`${PREFIX}: ${member} refused a body ${describeValue(value)}, expected a string`);
  }
  return value;
}

/** What a `gh` pull request provider is made with. */
export interface GhPullRequestsOptions {
  /** Runs every `gh` command the provider sends. */
  readonly gh: GhRunner;
}

/** Makes a `gh` pull request provider over `options.gh`; see the module note. */
export function createGhPullRequests(options: GhPullRequestsOptions): PullRequests {
  const { gh } = options;

  /** What `args` wrote to stdout. Throws, naming `command`, when it failed. */
  async function succeed(args: readonly string[], command: string): Promise<string> {
    const result = await gh(args);
    if (!result.ok) throw failure(command, result);
    return result.stdout;
  }

  /** The comment path of one pull request, and the path of one comment. */
  const commentsPath = (number: string): string => `repos/${REPO_PATH}/issues/${number}/comments`;
  const commentPath = (id: string): string => `repos/${REPO_PATH}/issues/comments/${id}`;

  const pulls: PullRequests = {
    kind: 'gh',

    findOpen: async (branch: string): Promise<PullRequestSummary | null> => {
      const head = textArgument(branch, 'findOpen', 'branch', false);
      const command = `gh pr list --head ${head}`;
      const stdout = await succeed([
        'pr',
        'list',
        '--state',
        'open',
        '--head',
        head,
        '--limit',
        String(FIND_LIMIT),
        '--json',
        SUMMARY_FIELDS,
      ], command);
      const rows = readList(parseJson(stdout, command), command, 'its output');
      return rows.length === 0
        ? null
        : readSummary(rows[0], command, 'row 0');
    },

    list: async (): Promise<readonly PullRequestSummary[]> => {
      const command = 'gh pr list';
      const stdout = await succeed(
        ['pr', 'list', '--state', 'open', '--limit', String(LIST_LIMIT), '--json', SUMMARY_FIELDS],
        command,
      );
      const rows = readList(parseJson(stdout, command), command, 'its output');
      return rows.map((row, index) => readSummary(row, command, `row ${index}`));
    },

    get: async (number: number): Promise<PullRequestDetail | null> => {
      const target = pullNumber(number, 'get');
      const command = `gh pr view ${target}`;
      const result = await gh(['pr', 'view', target, '--json', DETAIL_FIELDS]);
      if (!result.ok) {
        // The one failure that is an answer: see the module note.
        if (result.stderr.includes(MISSING_PULL)) return null;
        throw failure(command, result);
      }
      return readDetail(parseJson(result.stdout, command), command, 'the pull request');
    },

    checks: async (number: number): Promise<ChecksReading> => {
      const target = pullNumber(number, 'checks');
      const command = `gh pr checks ${target}`;
      const result = await gh(['pr', 'checks', target, '--json', CHECK_FIELDS]);
      if (!result.ok) {
        if (result.stderr.includes(NO_CHECKS)) return { rows: [], verdict: 'none' };
        throw failure(command, result);
      }
      // The verdict comes off the rows, never off the exit code; see the module note.
      const rows = parseChecks(result.stdout);
      return { rows, verdict: verdictOf(rows) };
    },

    browse: async (number: number): Promise<void> => {
      const target = pullNumber(number, 'browse');
      await succeed(['pr', 'view', target, '--web'], `gh pr view ${target} --web`);
    },

    merge: async (number: number, method: MergeMethod): Promise<MergeOutcome> => {
      const target = pullNumber(number, 'merge');
      if (!isMergeMethod(method)) {
        throw new TypeError(
          `${PREFIX}: merge refused method ${describeValue(method)},`
            + ` expected one of: ${MERGE_METHODS.join(', ')}`,
        );
      }
      const command = `gh pr merge ${target} --${method}`;
      const result = await gh(['pr', 'merge', target, `--${method}`]);
      return { merged: result.ok, detail: detailOf(result, command) };
    },

    editBody: async (number: number, body: string): Promise<void> => {
      const target = pullNumber(number, 'editBody');
      const text = bodyText(body, 'editBody');
      const command = `gh pr edit ${target} --body <body>`;
      // Nothing reads what the edit wrote; see the module note.
      await succeed(['pr', 'edit', target, '--body', text], command);
    },

    comments: async (number: number): Promise<readonly PullRequestComment[]> => {
      const path = commentsPath(pullNumber(number, 'comments'));
      const command = `gh api ${path}`;
      const stdout = await succeed(['api', path], command);
      const rows = readList(parseJson(stdout, command), command, 'its output');
      return rows.map((row, index) => readComment(row, command, `comment ${index}`));
    },

    comment: async (number: number, body: string): Promise<PullRequestComment> => {
      const path = commentsPath(pullNumber(number, 'comment'));
      const text = bodyText(body, 'comment');
      const command = `gh api -X POST ${path}`;
      const stdout = await succeed(['api', path, '-X', 'POST', '-f', `body=${text}`], command);
      return readComment(parseJson(stdout, command), command, 'the comment');
    },

    editComment: async (id: string, body: string): Promise<PullRequestComment> => {
      const path = commentPath(textArgument(id, 'editComment', 'comment id', true));
      const text = bodyText(body, 'editComment');
      const command = `gh api -X PATCH ${path}`;
      const stdout = await succeed(['api', path, '-X', 'PATCH', '-f', `body=${text}`], command);
      return readComment(parseJson(stdout, command), command, 'the comment');
    },

    failedLog: async (runId: string): Promise<string> => {
      const id = textArgument(runId, 'failedLog', 'run id', true);
      const command = `gh run view ${id} --log-failed`;
      const result = await gh(['run', 'view', id, '--log-failed']);
      if (result.ok) return result.stdout;
      // A dropped log is an ordinary state of an old run; a missing run is not.
      if (result.stderr.includes(LOG_DROPPED)) return '';
      throw failure(command, result);
    },
  };
  return Object.freeze(pulls);
}

/**
 * Whether `gh` can be asked at all: on `PATH`, and authenticated for the
 * host of the directory its runner runs in.
 *
 * `gh auth status` exits 0 when it is and non-zero when it is not, and
 * the runner answers a `gh` that is not installed as a failure too
 * (`createGhRunner` turns the spawn's throw into `ok` false), so one
 * reading covers both. Nothing here reads what it wrote: the run's CI
 * gate only decides whether to skip itself, and the preflight items that
 * report WHY are a separate reading.
 */
export async function ghAuthOk(gh: GhRunner): Promise<boolean> {
  const result = await gh(['auth', 'status']);
  return result.ok;
}

/**
 * The `gh` provider for the repository of `cwd`, over a runner that
 * spawns the real CLI there.
 *
 * This is the one place the loop's own callers get a provider from until
 * `pr.provider` is read from the config; every test hands over a
 * provider of its own instead.
 */
export function ghPullRequestsIn(cwd: string): PullRequests {
  return createGhPullRequests({ gh: createGhRunner({ cwd }) });
}

/** {@link ghAuthOk} over a runner spawning the real `gh` in `cwd`. */
export function ghAuthOkIn(cwd: string): Promise<boolean> {
  return ghAuthOk(createGhRunner({ cwd }));
}
