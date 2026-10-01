/**
 * A stand-in GitHub for the tests: `Bun.serve` on a free port answering
 * the two requests the repository-permission adapter (`../github.ts`)
 * sends, `GET /user` and `GET /repos/{owner}/{name}`, from a table of
 * tokens held in memory, so no test reaches api.github.com.
 *
 * A token the table lacks is answered `401`. A known token's `/user` is
 * its login, and a repository is answered with the `permissions` flags
 * GitHub sets for the account's role there, or `404` when the account
 * holds no role on it, as GitHub hides a private repository. Every
 * request is recorded, so a case can count what the adapter asked, and
 * {@link StandInGitHub.failWith} makes every request answer one status,
 * as an outage or a rate limit would.
 */

/** A role on a repository, as GitHub's collaborator settings name it. */
export type GitHubRole = 'admin' | 'maintain' | 'write' | 'triage' | 'read';

/** What the stand-in knows of one token. */
export interface StandInAccount {
  readonly login: string;
  /** The account's role per `owner/name`; a repository left out answers `404`. */
  readonly roles: Readonly<Record<string, GitHubRole>>;
  /** A status `/user` answers instead of the login, such as `403` for an app installation's token. */
  readonly userStatus?: number;
}

/** What every request is answered with while a failure is set. */
export interface StandInFailure {
  readonly status: number;
  readonly headers?: Readonly<Record<string, string>>;
  /** The body sent, as written; `{"message":"stand-in failure"}` when left out. */
  readonly body?: string;
  /** How long the stand-in waits before answering. */
  readonly delayMs?: number;
}

/** One request the stand-in was sent. */
export interface AskedRequest {
  readonly method: string;
  /** The path and query, as sent. */
  readonly path: string;
  /** The `Authorization` header, or null. */
  readonly authorization: string | null;
}

/** A running stand-in. */
export interface StandInGitHub {
  /** The API root to open the adapter with. */
  readonly url: string;
  /** Every request sent so far, oldest first. */
  readonly asked: () => readonly AskedRequest[];
  /** Sets, or with `undefined` removes, what `token` is known as. */
  readonly setAccount: (token: string, account: StandInAccount | undefined) => void;
  /** Answers every request with `failure` until called with null. */
  readonly failWith: (failure: StandInFailure | null) => void;
  /** Stops the server. */
  readonly stop: () => Promise<void>;
}

/** GitHub's `permissions` flags for each role. */
const FLAGS: Readonly<Record<GitHubRole, Readonly<Record<string, boolean>>>> = {
  admin: { admin: true, maintain: true, push: true, triage: true, pull: true },
  maintain: { admin: false, maintain: true, push: true, triage: true, pull: true },
  write: { admin: false, maintain: false, push: true, triage: true, pull: true },
  triage: { admin: false, maintain: false, push: false, triage: true, pull: true },
  read: { admin: false, maintain: false, push: false, triage: false, pull: true },
};

/** A repository's API path: `/repos/{owner}/{name}`. */
const REPO_PATH = /^\/repos\/([^/]+)\/([^/]+)$/;

/** How the adapter writes the token. */
const BEARER = /^Bearer (\S+)$/;

/** A JSON response of `status` holding `body`. */
function json(status: number, body: unknown): Response {
  return Response.json(body, { status });
}

/** Starts a stand-in knowing `accounts`, keyed by token. */
export function startStandInGitHub(accounts: Readonly<Record<string, StandInAccount>>): StandInGitHub {
  const known = new Map<string, StandInAccount>(Object.entries(accounts));
  const asked: AskedRequest[] = [];
  let failure: StandInFailure | null = null;

  const answer = (url: URL, account: StandInAccount): Response => {
    if (url.pathname === '/user') {
      return account.userStatus === undefined
        ? json(200, { login: account.login, id: 1, type: 'User' })
        : json(account.userStatus, { message: 'Resource not accessible by integration' });
    }
    const match = REPO_PATH.exec(url.pathname);
    if (match === null) return json(404, { message: 'Not Found' });

    const fullName = `${decodeURIComponent(match[1] ?? '')}/${decodeURIComponent(match[2] ?? '')}`;
    const role = account.roles[fullName];
    return role === undefined
      ? json(404, { message: 'Not Found' })
      : json(200, { full_name: fullName, private: true, permissions: FLAGS[role] });
  };

  const server = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    fetch: async (request) => {
      const url = new URL(request.url);
      const authorization = request.headers.get('authorization');
      asked.push({ method: request.method, path: `${url.pathname}${url.search}`, authorization });
      const failing = failure;
      if (failing !== null) {
        if (failing.delayMs !== undefined) await Bun.sleep(failing.delayMs);
        return new Response(failing.body ?? JSON.stringify({ message: 'stand-in failure' }), {
          status: failing.status,
          headers: { 'content-type': 'application/json', ...failing.headers },
        });
      }
      const token = BEARER.exec(authorization ?? '')?.[1];
      const account = token === undefined
        ? undefined
        : known.get(token);
      return account === undefined
        ? json(401, { message: 'Bad credentials' })
        : answer(url, account);
    },
  });

  return {
    url: server.url.href.replace(/\/$/, ''),
    asked: () => [...asked],
    setAccount: (token, account) => {
      if (account === undefined) {
        known.delete(token);
        return;
      }
      known.set(token, account);
    },
    failWith: (next) => {
      failure = next;
    },
    stop: () => server.stop(true),
  };
}
