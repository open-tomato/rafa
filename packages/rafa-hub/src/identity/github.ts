/**
 * The repository-permission identity adapter: the hub's default
 * {@link HubIdentity}. It reads the caller's GitHub token from the
 * request, asks GitHub for the repository `hub.repository` names with
 * that token, and serves the caller when the permission GitHub answers
 * is one of `TRUSTED_PERMISSIONS` (`admin`, `maintain`, `write`), the
 * ones the board's trust check trusts (`src/board/trust.ts`, reached
 * through `@open-tomato/rafa/store`).
 *
 * ## What it asks GitHub
 *
 * Two requests, both sent with the caller's token and nothing else:
 *
 *   1. `GET /user`, for the login the caller is named by. A `401` means
 *      GitHub does not know the token (`unauthenticated`); a `403` that
 *      is not a rate limit means a token GitHub knows that names no
 *      user, such as an app installation's (`forbidden`).
 *   2. `GET /repos/{owner}/{name}` of `hub.repository`, for the
 *      `permissions` GitHub answers for that login. The highest one set
 *      is the role: `admin`, `maintain`, `push` (`write`), `triage`,
 *      `pull` (`read`). A `404` is a repository the login cannot see,
 *      and a role outside `TRUSTED_PERMISSIONS`, or no `permissions` at
 *      all, is `forbidden`.
 *
 * The repository asked about is always the one the adapter was opened
 * with. Nothing a request carries, a path, a query or a header, names
 * another: a token with write access to some other repository is
 * refused.
 *
 * A request GitHub did not answer, answered with a rate limit (`429`,
 * or a `403` carrying `x-ratelimit-remaining: 0` or `retry-after`), a
 * `5xx` or any status not named above, or a body that is not the JSON
 * asked for, is `unavailable`. So is one that took longer than
 * `timeoutMs`. None of them is an answer about the caller.
 *
 * ## The cache
 *
 * A served answer is kept for `cacheForMs` (`hub.auth.cacheFor`), so a
 * device pulling and pushing does not spend GitHub's rate limit on each
 * request; within that time a token whose permission GitHub has since
 * withdrawn is still served, which is the trade `hub.auth.cacheFor`
 * names. `null` (`false` in the config) asks GitHub on every request.
 * A refusal of any reason is never kept: a token refused now is asked
 * about again on its next request, so a caller granted write, or a
 * GitHub back from an outage, is served at once.
 *
 * The cache is keyed by the token's SHA-256, never the token, and an
 * entry past its time is dropped when it is next looked up or when
 * another answer is kept.
 *
 * ## What it never does
 *
 * It never reads the request's body, never sends the token anywhere
 * but `apiBase`, and never writes the token, or anything GitHub
 * answered in a body, into a refusal message: each message is one line
 * built from the login, the repository and a status code.
 */
import type { HubAction, HubIdentity, IdentityAnswer, IdentityRefusalReason } from './port.js';

import { TRUSTED_PERMISSIONS } from '@open-tomato/rafa/store';

import { HUB_ACTIONS } from './port.js';

/** GitHub's public API, the `apiBase` the hub is opened with outside tests. */
export const GITHUB_API = 'https://api.github.com';

/** The provider a served caller is named under. */
export const GITHUB_PROVIDER = 'github';

/** How long one request to GitHub may take when `timeoutMs` is left out. */
export const DEFAULT_GITHUB_TIMEOUT_MS = 10_000;

/** The API version the adapter asks GitHub to answer in. */
const GITHUB_API_VERSION = '2022-11-28';

/** The user agent GitHub requires of every request. */
const USER_AGENT = 'rafa-hub';

/** How a credential is written in `Authorization`: `Bearer` or GitHub's `token`, either case. */
const CREDENTIAL = /^(?:bearer|token) +(\S+)$/i;

/** A served caller may take every hub action. */
const EVERY_ACTION: readonly HubAction[] = Object.freeze([...HUB_ACTIONS]);

/** What a forbidden refusal says the hub serves. */
const SERVED_ROLES = TRUSTED_PERMISSIONS.join(', ');

/**
 * GitHub's `permissions` flags, highest first, with the role each
 * spells; the first one set is the login's role.
 */
const ROLE_FLAGS: readonly (readonly [string, string])[] = Object.freeze([
  ['admin', 'admin'],
  ['maintain', 'maintain'],
  ['push', 'write'],
  ['triage', 'triage'],
  ['pull', 'read'],
]);

/** What {@link openGitHubIdentity} is opened with. */
export interface GitHubIdentityOptions {
  /** `hub.repository`: the `owner/name` every request is checked against. */
  readonly repository: string;
  /** `hub.auth.cacheFor` in milliseconds, or null to ask GitHub on every request. */
  readonly cacheForMs: number | null;
  /** GitHub's API root, {@link GITHUB_API} in production and a stand-in's URL in tests. */
  readonly apiBase: string;
  /** How long one request to GitHub may take; {@link DEFAULT_GITHUB_TIMEOUT_MS} when left out. */
  readonly timeoutMs?: number;
  /** The clock the cache reads, in epoch milliseconds; `Date.now` when left out. */
  readonly now?: () => number;
}

/** One request's reading from GitHub: its status and parsed body, or why there is none. */
type Asked =
  | { readonly answered: true; readonly status: number; readonly headers: Headers; readonly body: unknown }
  | { readonly answered: false; readonly detail: string };

/** A served answer kept in the cache, and when it stops being served. */
interface Kept {
  readonly answer: IdentityAnswer;
  readonly expiresAt: number;
}

/** A refusal for `reason`, saying `message`. */
function refused(reason: IdentityRefusalReason, message: string): IdentityAnswer {
  return { served: false, refusal: { reason, message } };
}

/** The token `request` carries in `Authorization`, or `undefined`. */
function tokenOf(request: Request): string | undefined {
  return CREDENTIAL.exec(request.headers.get('authorization') ?? '')?.[1];
}

/** The cache key of `token`: its SHA-256, so the cache holds no token. */
function keyOf(token: string): string {
  return new Bun.CryptoHasher('sha256')
    .update(token)
    .digest('hex');
}

/** Whether `raw` is a JSON object, rather than a list, a scalar or null. */
function isRecord(raw: unknown): raw is Readonly<Record<string, unknown>> {
  return typeof raw === 'object' && raw !== null && !Array.isArray(raw);
}

/** `text` on one line, whatever it held. */
function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** Whether a `403` or `429` from GitHub is its rate limit rather than a refusal. */
function isRateLimited(status: number, headers: Headers): boolean {
  if (status === 429) return true;

  return status === 403
    && (headers.get('x-ratelimit-remaining') === '0' || headers.has('retry-after'));
}

/** The role GitHub's `permissions` flags spell, or null when none is set. */
function roleOf(permissions: unknown): string | null {
  if (!isRecord(permissions)) return null;

  const flag = ROLE_FLAGS.find(([name]) => permissions[name] === true);
  return flag === undefined
    ? null
    : flag[1];
}

/** Whether `role` is one of `TRUSTED_PERMISSIONS`. */
function isTrusted(role: string | null): boolean {
  return TRUSTED_PERMISSIONS.some((permission) => permission === role);
}

/** The API path of `repository`, each part escaped. */
function repositoryPath(repository: string): string {
  const parts = repository.split('/').map(encodeURIComponent);
  return `/repos/${parts.join('/')}`;
}

/**
 * Opens the repository-permission adapter over `options`. The answer
 * cache lives as long as the adapter, one per hub process.
 */
export function openGitHubIdentity(options: GitHubIdentityOptions): HubIdentity {
  const { repository, cacheForMs } = options;
  const apiBase = options.apiBase.replace(/\/+$/, '');
  const timeoutMs = options.timeoutMs ?? DEFAULT_GITHUB_TIMEOUT_MS;
  const now = options.now ?? Date.now;
  const kept = new Map<string, Kept>();

  const unavailable = (detail: string): IdentityAnswer => refused(
    'unavailable',
    oneLine(`GitHub did not answer the permission check for ${repository}: ${detail}; try again.`),
  );

  /** Sends one GET to GitHub with `token`, never rejecting. */
  const ask = async (path: string, token: string): Promise<Asked> => {
    try {
      const response = await fetch(`${apiBase}${path}`, {
        headers: {
          'accept': 'application/vnd.github+json',
          'authorization': `Bearer ${token}`,
          'user-agent': USER_AGENT,
          'x-github-api-version': GITHUB_API_VERSION,
        },
        redirect: 'manual',
        signal: AbortSignal.timeout(timeoutMs),
      });
      const text = await response.text();
      let body: unknown = null;
      try {
        body = text === ''
          ? null
          : JSON.parse(text);
      } catch {
        body = undefined;
      }
      return { answered: true, status: response.status, headers: response.headers, body };
    } catch (error) {
      const timedOut = error instanceof Error && error.name === 'TimeoutError';
      return {
        answered: false,
        detail: timedOut
          ? `no answer within ${String(timeoutMs)}ms`
          : 'it could not be reached',
      };
    }
  };

  /** What GitHub's reading of a request other than a success means, or null for a success. */
  const failureOf = (asked: Asked, forbidden: string): IdentityAnswer | null => {
    if (!asked.answered) return unavailable(asked.detail);
    if (isRateLimited(asked.status, asked.headers)) return unavailable(`its rate limit refused it (HTTP ${String(asked.status)})`);
    if (asked.status === 401) return refused('unauthenticated', `GitHub did not accept the token; send one for a login with ${SERVED_ROLES} on ${repository}.`);
    if (asked.status === 403) return refused('forbidden', forbidden);
    if (asked.status < 200 || asked.status >= 300) return unavailable(`HTTP ${String(asked.status)}`);
    if (!isRecord(asked.body)) return unavailable(`HTTP ${String(asked.status)} with a body that is not a JSON object`);
    return null;
  };

  /** Asks GitHub who holds `token` and what they hold on `repository`. */
  const lookUp = async (token: string): Promise<IdentityAnswer> => {
    const user = await ask('/user', token);
    const userFailure = failureOf(user, 'GitHub refused this token a user lookup (HTTP 403); send a user\'s token.');
    if (userFailure !== null) return userFailure;

    const login = user.answered && isRecord(user.body)
      ? user.body['login']
      : undefined;
    if (typeof login !== 'string' || login.trim() === '') return unavailable('the user lookup named no login');

    const repo = await ask(repositoryPath(repository), token);
    if (repo.answered && repo.status === 404) {
      return refused('forbidden', `${login} cannot see ${repository} on GitHub; the hub serves ${SERVED_ROLES}.`);
    }
    const repoFailure = failureOf(repo, `GitHub refused ${login} a lookup of ${repository} (HTTP 403); the hub serves ${SERVED_ROLES}.`);
    if (repoFailure !== null) return repoFailure;

    const role = roleOf(repo.answered && isRecord(repo.body)
      ? repo.body['permissions']
      : undefined);
    if (!isTrusted(role)) {
      return refused('forbidden', `${login} holds ${role ?? 'no permission'} on ${repository}; the hub serves ${SERVED_ROLES}.`);
    }
    return { served: true, caller: { id: login, provider: GITHUB_PROVIDER }, may: EVERY_ACTION };
  };

  /** The kept answer for `key`, dropping it when its time is past. */
  const recall = (key: string): IdentityAnswer | undefined => {
    const entry = kept.get(key);
    if (entry === undefined) return undefined;
    if (now() < entry.expiresAt) return entry.answer;

    kept.delete(key);
    return undefined;
  };

  /** Keeps a served `answer` for `key`, dropping every entry past its time. */
  const keep = (key: string, answer: IdentityAnswer): void => {
    if (cacheForMs === null || !answer.served) return;

    const at = now();
    for (const [other, entry] of kept) {
      if (entry.expiresAt <= at) kept.delete(other);
    }
    kept.set(key, { answer, expiresAt: at + cacheForMs });
  };

  const identify = async (request: Request): Promise<IdentityAnswer> => {
    const token = tokenOf(request);
    if (token === undefined) {
      return refused('unauthenticated', `Send a GitHub token for a login with ${SERVED_ROLES} on ${repository} as Authorization: Bearer.`);
    }
    const key = keyOf(token);
    const remembered = recall(key);
    if (remembered !== undefined) return remembered;

    const answer = await lookUp(token);
    keep(key, answer);
    return answer;
  };

  return { identify };
}
