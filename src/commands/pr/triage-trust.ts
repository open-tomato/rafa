/**
 * Board trust as `rafa pr triage` asks it: the marker comment read only
 * from an author allowed to change the repository, and the pull request
 * `--resolve` refuses to act on when its author is not.
 *
 * `src/board/trust.ts` answers WHETHER a login is trusted — the one
 * permission reading, the `board.trustedAuthors` allow-list, and the
 * failed lookup that is a refusal rather than a pass. This module is
 * what the triage command DOES with that answer, which the PR commands
 * spec spells differently for each of its two readings:
 *
 *   - A `rafa:pr-triage` marker comment from an untrusted author is
 *     IGNORED and REPORTED, never refused. A stranger can comment on a
 *     public pull request, and a command that exited 2 over one would
 *     hand anybody a way to stop rafa triaging a repository at all.
 *   - A pull request `--resolve` would act on is REFUSED when its
 *     author is untrusted, with exit 2 — `TRUST_REFUSAL_EXIT`, the
 *     spec's own code — and `trustRefusalMessage`'s sentence, unless
 *     the author is listed in `board.trustedAuthors` or is a known bump
 *     bot ({@link DEPENDENCY_BUMP_AUTHORS}, which is `dependabot[bot]`
 *     today).
 *
 * ## Why the comment is where the check bites
 *
 * The triage comment is a STORE and not only a report
 * (`src/pr/triage/comment.ts`): its `head` decides whether the pull
 * request is assessed again, its `attempts` is the resolve counter, and
 * the `<details>` under it carries a follow-up prompt a session is
 * handed as it stands. All three are text off the board, and on a public
 * repository anyone at all can write a comment carrying the marker. So
 * the reader asks who wrote one before anything in it is read, and
 * `readTriageBlock` is never reached for a comment this module dropped.
 *
 * ## Ignored means passed over, not "there is no triage"
 *
 * {@link readTrustedTriageComment} walks the marker comments newest
 * first and answers the FIRST trusted one, so a planted comment posted
 * after rafa's own does not hide it. The alternative — reading the
 * newest marker comment and answering null when it is untrusted — would
 * let a stranger's comment mask the real triage, which is the stored
 * head, the attempt count and the comment a later run edits: a run that
 * saw none of them would post a second rafa comment and start the
 * attempt count again from zero.
 *
 * One lookup per LOGIN, not per comment: the readings are memoised for
 * the call, so a pull request carrying six comments from one account
 * spends one `gh api`.
 *
 * ## The repository a sentence names
 *
 * `gh` resolves the repository from the directory it runs in, so
 * nothing here is told which repository it is working on — the same rule
 * `src/pr/gh.ts` keeps for every path it builds. The name in a sentence
 * is therefore a LABEL and not an input to the lookup:
 * {@link repoLabel} takes `owner/name` out of the pull request's own
 * URL, falls back to the normalised `origin` remote, and says
 * {@link UNNAMED_REPO} when there is neither. A label read off the pull
 * request cannot disagree with the pull request the sentence is about.
 *
 * ## Nothing here spawns either
 *
 * The permission lookup arrives as a {@link Permissions} seam, which
 * {@link ghPermissionsIn} makes over a `gh` runner for a root. Every
 * case in `./triage-trust.test.ts` hands over a recorded fake or a
 * literal answer, and none of them reaches GitHub.
 */
import type { Permissions, TrustReading } from '../../board/trust.js';
import type { PullRequestComment, PullRequestDetail } from '../../pr/index.js';

import { createGhRunner } from '../../adapters/tracker/github.js';
import {
  createGhPermissions,
  readAuthorTrust,
  requireTrustedAuthor,
  trustRefusalClause,
} from '../../board/trust.js';
import { DEPENDENCY_BUMP_AUTHORS } from '../../pr/triage/classes.js';
import { triageComments } from '../../pr/triage/comment.js';
import { normalizeRemote } from '../../schema/project-id.js';

/** What a sentence calls a repository it could name no other way. */
export const UNNAMED_REPO = 'this repository';

/** What a reported comment is called, which is the marker without its HTML. */
export const TRIAGE_COMMENT_NAME = 'rafa:pr-triage';

/** `owner/name` inside a pull request URL, whatever host it is on. */
const PULL_URL = /^https?:\/\/[^/]+\/([^/]+\/[^/]+)\/pull\/\d+/;

/** What the triage command reads trust through, for one repository. */
export interface TriageTrust {
  /** The permission lookup; {@link ghPermissionsIn} makes the `gh` one. */
  readonly permissions: Permissions;
  /** `board.trustedAuthors`: the logins trusted without a lookup. */
  readonly trustedAuthors: readonly string[];
  /** What a sentence calls the repository; see {@link repoLabel}. */
  readonly repo: string;
}

/** One marker comment that was passed over, and why. */
export interface IgnoredTriageComment {
  /** The comment's provider id, so a report can be matched to a comment. */
  readonly id: string;
  /** The comment's own URL, which is what a person opens. */
  readonly url: string;
  /** The login that wrote it. */
  readonly author: string;
  /** The whole sentence reporting it; see {@link ignoredCommentMessage}. */
  readonly reason: string;
}

/** The marker comment a triage may read, and the ones it passed over. */
export interface TrustedTriageComment {
  /** The newest marker comment from a trusted author, or null when there is none. */
  readonly comment: PullRequestComment | null;
  /** Every newer marker comment that was ignored, newest first. */
  readonly ignored: readonly IgnoredTriageComment[];
}

/** A `gh` permission lookup for the repository holding `root`. */
export function ghPermissionsIn(root: string): Permissions {
  return createGhPermissions({ gh: createGhRunner({ cwd: root }) });
}

/**
 * What a sentence calls the repository: `owner/name` from the pull
 * request's URL, the normalised `origin` remote when the URL names
 * none, and {@link UNNAMED_REPO} when neither does. See the module note.
 */
export function repoLabel(url: string, remote: string | null): string {
  const named = PULL_URL.exec(url.trim())?.[1];
  if (named !== undefined) return named;
  const normalized = remote === null
    ? ''
    : normalizeRemote(remote.trim());
  return normalized === ''
    ? UNNAMED_REPO
    : normalized;
}

/**
 * The sentence one ignored marker comment is reported with: which
 * comment, who wrote it, what GitHub said about their access, and that
 * nothing in it was read.
 *
 * The claim about access is `trustRefusalClause`'s, so this sentence and
 * the `--resolve` refusal cannot come to disagree about what a reading
 * means.
 */
export function ignoredCommentMessage(
  comment: PullRequestComment,
  reading: TrustReading,
  repo: string,
): string {
  const who = `was written by ${reading.login}, ${trustRefusalClause(repo, reading)}`;
  return `the ${TRIAGE_COMMENT_NAME} comment ${comment.url} ${who};`
    + ' it was ignored and nothing in it was read';
}

/** A trust reading per login, memoised for one call; see the module note. */
function memoisedTrust(trust: TriageTrust): (login: string) => Promise<TrustReading> {
  const read = new Map<string, Promise<TrustReading>>();
  return (login: string): Promise<TrustReading> => {
    const seen = read.get(login);
    if (seen !== undefined) return seen;
    const reading = readAuthorTrust({
      login,
      permissions: trust.permissions,
      trustedAuthors: trust.trustedAuthors,
    });
    read.set(login, reading);
    return reading;
  };
}

/**
 * The newest marker comment written by an author trusted with board
 * text, and every newer one that was passed over on the way to it.
 *
 * Answers a reading rather than throwing: an untrusted comment is
 * ignored and reported, never refused. See the module note for why the
 * walk does not stop at the first untrusted comment.
 */
export async function readTrustedTriageComment(
  comments: readonly PullRequestComment[],
  trust: TriageTrust,
): Promise<TrustedTriageComment> {
  const trustOf = memoisedTrust(trust);
  const ignored: IgnoredTriageComment[] = [];
  for (const comment of triageComments(comments)) {
    const reading = await trustOf(comment.author.login);
    if (reading.trusted) return { comment, ignored };
    ignored.push({
      id: comment.id,
      url: comment.url,
      author: comment.author.login,
      reason: ignoredCommentMessage(comment, reading, trust.repo),
    });
  }
  return { comment: null, ignored };
}

/**
 * Lets a `--resolve` run act on `detail`, and throws
 * `CommandExit(2, trustRefusalMessage)` when its author is trusted with
 * nothing.
 *
 * The known bump bots are allowed alongside `board.trustedAuthors`,
 * which is the spec's rule: a dependabot pull request is exactly the
 * one `--resolve` exists for, and the bot holds no write access to
 * report.
 */
export async function requireTrustedResolveAuthor(
  detail: Pick<PullRequestDetail, 'author' | 'number'>,
  trust: TriageTrust,
): Promise<TrustReading> {
  const reading = await readAuthorTrust({
    login: detail.author.login,
    permissions: trust.permissions,
    trustedAuthors: [...trust.trustedAuthors, ...DEPENDENCY_BUMP_AUTHORS],
  });
  requireTrustedAuthor({ kind: 'pull request', number: detail.number, repo: trust.repo }, reading);
  return reading;
}
