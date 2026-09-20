/**
 * The three writes and one read the readiness gate makes on an issue:
 * the comments of an issue, a comment posted, a comment edited, and one
 * label swapped for another.
 *
 * The gate's not-ready branch posts the planner's gaps as one comment,
 * edits that comment on a rerun, and swaps `spec:ready` for
 * `spec:needs-work` (`.rafa/specs/rafa-20-pr-commands.md`). Those are the
 * only board operations it makes, and this is the seam they go through:
 * {@link IssueBoard} is the interface the gate is written against, and
 * {@link createGhIssueBoard} is the one implementation, over the
 * {@link GhRunner} declared in `src/adapters/tracker/github.ts` and
 * taken by the pull request provider (`src/pr/gh.ts`) and the trust
 * reading (`./trust.ts`) already.
 *
 * Nothing here spawns, so every case in `./issue-board.test.ts` drives a
 * runner of its own and none of them reaches GitHub or reads the
 * configuration `gh` keeps under the home.
 *
 * ## Why not the Tracker port
 *
 * `Tracker` (`src/ports/index.ts`) carries `comment`, and nothing else
 * this needs: it lists no comments, so the marker comment to edit cannot
 * be found through it, it edits none, and it moves no labels — its
 * `create` makes labels and its `transition` opens and closes an issue.
 * Widening a copied port for one command's gate would change a shape
 * open-tomato owns, so the gate takes this narrow interface instead and
 * a later phase can fold it into the port if a second caller wants it.
 *
 * ## The commands
 *
 * | Member | Command |
 * |---|---|
 * | `comments` | `gh api repos/{owner}/{repo}/issues/<n>/comments` |
 * | `comment` | `gh api repos/{owner}/{repo}/issues/<n>/comments -X POST -f body=<body>` |
 * | `editComment` | `gh api repos/{owner}/{repo}/issues/comments/<id> -X PATCH -f body=<body>` |
 * | `swapLabels` | `gh issue edit <n> --remove-label <removed> --add-label <added>` |
 *
 * The comment paths are the REST ones the pull request provider reads
 * and writes, for the reason it records: a pull request IS an issue to
 * that endpoint, `gh pr view --json comments` carries the GraphQL node
 * id where the PATCH path takes the REST id, and the REST resource
 * answers the whole comment to a write. `{owner}/{repo}` is left for
 * `gh` to expand from the directory its runner runs in, so no second
 * source of truth for the repository can disagree with it.
 *
 * `--paginate` is not sent, so `comments` reads the first page, as the
 * pull request provider does and for the same reason: the caller looks
 * for a marker in the issue's own comments, and an issue with more than
 * a page of them is not the case this gate is written for. A marker
 * pushed off the first page costs a second comment, never a wrong one.
 *
 * The label swap is ONE `gh issue edit`, both labels in it, because two
 * commands can half-apply: a removal that lands and an add that does not
 * leaves the issue carrying neither label and the gate's report claiming
 * both. What `gh` does with a label the issue does not carry was not
 * measured — this repository's cases drive a runner, not a repository —
 * and the gate does not depend on it: it swaps only after the label
 * check has READ `spec:ready` off the issue, and a failed swap is
 * reported by its caller rather than thrown past it.
 *
 * ## Arguments are checked before they reach `gh`
 *
 * An issue number must be a positive whole number and a label a
 * non-empty string that does not open with `-`, or the member throws a
 * `TypeError` and sends no command. A label opening with `-` would reach
 * `gh` as a flag rather than as a value, and a number that is not one
 * would reach the API path as a path segment of its own.
 */
import type { GhResult, GhRunner } from '../adapters/tracker/github.js';

import { describeValue, isMapping, messageOf } from '../config-sections.js';

/** What every refusal this module raises opens with. */
const PREFIX = 'board issue';

/** The repository placeholders `gh api` expands from the directory it runs in. */
const REPO_PATH = '{owner}/{repo}';

/** A comment id as the REST resource carries it: a whole number. */
const COMMENT_ID = /^[1-9]\d*$/;

/** One comment on an issue: what the gate needs of it, and nothing more. */
export interface BoardComment {
  /** The REST id, as a string: what the edit path takes. */
  readonly id: string;
  /** The body as written. */
  readonly body: string;
  /** The login that wrote it, or the empty string when none was answered. */
  readonly author: string;
}

/**
 * The reads and writes the readiness gate makes on one issue. Every
 * member rejects with an `Error` naming the command when `gh` failed or
 * answered something else than the shape read here.
 */
export interface IssueBoard {
  /** The issue's comments, oldest first, as GitHub orders them. */
  readonly comments: (issue: number) => Promise<readonly BoardComment[]>;
  /** Posts one comment and answers it. */
  readonly comment: (issue: number, body: string) => Promise<BoardComment>;
  /** Replaces one comment's body and answers it. */
  readonly editComment: (id: string, body: string) => Promise<BoardComment>;
  /** Takes `removed` off the issue and puts `added` on it, in one command. */
  readonly swapLabels: (issue: number, removed: string, added: string) => Promise<void>;
}

/** What {@link createGhIssueBoard} is made with. */
export interface GhIssueBoardOptions {
  /** Runs every `gh` command the board sends. */
  readonly gh: GhRunner;
}

/** What a failed command wrote, for a message. Never empty. */
function detailOf(result: GhResult, command: string): string {
  const written = result.stderr.trim() || result.stdout.trim();
  return written === ''
    ? `${command} failed and wrote nothing`
    : `${command} failed: ${written}`;
}

/** The rejection a failed command raises. */
function failure(command: string, result: GhResult): Error {
  return new Error(`${PREFIX}: ${detailOf(result, command)}`);
}

/** The issue number `member` was handed, as an argument. */
function issueNumber(value: number, member: string): string {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(
      `${PREFIX}: ${member} refused issue number ${describeValue(value)}, expected a positive whole number`,
    );
  }
  return String(value);
}

/** The comment id `editComment` was handed, as a path segment. */
function commentId(value: string): string {
  if (typeof value !== 'string' || !COMMENT_ID.test(value)) {
    throw new TypeError(
      `${PREFIX}: editComment refused comment id ${describeValue(value)},`
        + ' expected a positive whole number with no leading zero',
    );
  }
  return value;
}

/** The body a write was handed. */
function commentBody(value: string, member: string): string {
  if (typeof value !== 'string') {
    throw new TypeError(`${PREFIX}: ${member} refused a body ${describeValue(value)}, expected a string`);
  }
  return value;
}

/** The label `swapLabels` was handed; see the module note on the `-` check. */
function labelName(value: string, what: string): string {
  if (typeof value !== 'string' || value === '' || value.startsWith('-')) {
    throw new TypeError(
      `${PREFIX}: swapLabels refused the ${what} label ${describeValue(value)},`
        + ' expected a non-empty name that does not open with a hyphen',
    );
  }
  return value;
}

/** What `command` wrote, parsed. Refuses, naming the command, when it is not JSON. */
function parseJson(stdout: string, command: string): unknown {
  try {
    return JSON.parse(stdout) as unknown;
  } catch (error) {
    throw new Error(`${PREFIX}: ${command} wrote output that is not JSON: ${messageOf(error)}`, { cause: error });
  }
}

/**
 * One comment as the REST resource writes it. The id is taken as a
 * number and spelled back as a string, because the path takes the REST
 * id; the author is taken from `user.login` when there is one, and left
 * empty rather than refused, since nothing the gate does depends on it.
 */
function readComment(value: unknown, command: string, where: string): BoardComment {
  if (!isMapping(value)) {
    throw new Error(`${PREFIX}: ${command} answered ${where} as ${describeValue(value)}, expected a mapping`);
  }
  const id = value['id'];
  if (typeof id !== 'number' || !Number.isSafeInteger(id) || id < 1) {
    throw new Error(`${PREFIX}: ${command} answered ${where}.id as ${describeValue(id)}, expected a positive whole number`);
  }
  const body = value['body'];
  if (typeof body !== 'string') {
    throw new Error(`${PREFIX}: ${command} answered ${where}.body as ${describeValue(body)}, expected a string`);
  }
  const user = value['user'];
  const login = isMapping(user)
    ? user['login']
    : null;
  return {
    id: String(id),
    body,
    author: typeof login === 'string'
      ? login
      : '',
  };
}

/** Makes the `gh` issue board over `options.gh`; see the module note. */
export function createGhIssueBoard(options: GhIssueBoardOptions): IssueBoard {
  const { gh } = options;

  /** What `args` wrote to stdout. Throws, naming `command`, when it failed. */
  async function succeed(args: readonly string[], command: string): Promise<string> {
    const result = await gh(args);
    if (!result.ok) throw failure(command, result);
    return result.stdout;
  }

  const commentsPath = (number: string): string => `repos/${REPO_PATH}/issues/${number}/comments`;

  const board: IssueBoard = {
    comments: async (issue: number): Promise<readonly BoardComment[]> => {
      const path = commentsPath(issueNumber(issue, 'comments'));
      const command = `gh api ${path}`;
      const rows = parseJson(await succeed(['api', path], command), command);
      if (!Array.isArray(rows)) {
        throw new Error(`${PREFIX}: ${command} answered ${describeValue(rows)}, expected a list of comments`);
      }
      return (rows as readonly unknown[]).map((row, index) => readComment(row, command, `comment ${String(index)}`));
    },

    comment: async (issue: number, body: string): Promise<BoardComment> => {
      const path = commentsPath(issueNumber(issue, 'comment'));
      const text = commentBody(body, 'comment');
      const command = `gh api -X POST ${path}`;
      const stdout = await succeed(['api', path, '-X', 'POST', '-f', `body=${text}`], command);
      return readComment(parseJson(stdout, command), command, 'the comment');
    },

    editComment: async (id: string, body: string): Promise<BoardComment> => {
      const path = `repos/${REPO_PATH}/issues/comments/${commentId(id)}`;
      const text = commentBody(body, 'editComment');
      const command = `gh api -X PATCH ${path}`;
      const stdout = await succeed(['api', path, '-X', 'PATCH', '-f', `body=${text}`], command);
      return readComment(parseJson(stdout, command), command, 'the comment');
    },

    swapLabels: async (issue: number, removed: string, added: string): Promise<void> => {
      const number = issueNumber(issue, 'swapLabels');
      const off = labelName(removed, 'removed');
      const on = labelName(added, 'added');
      await succeed(
        ['issue', 'edit', number, '--remove-label', off, '--add-label', on],
        `gh issue edit ${number} --remove-label ${off} --add-label ${on}`,
      );
    },
  };
  return Object.freeze(board);
}
