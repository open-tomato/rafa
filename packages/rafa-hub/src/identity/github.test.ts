/**
 * The repository-permission identity adapter (`github.ts`): the port's
 * contract suite over a stand-in GitHub, then what is the adapter's
 * own. That covers which roles it trusts, that it asks only about the
 * repository it was opened with, how long a served token is kept, that
 * no refusal is kept, and what it answers when GitHub does not.
 *
 * Every case serves a stand-in GitHub (`testdata/stand-in-github.ts`)
 * with `Bun.serve` on a free port and counts the requests it was sent,
 * so a case holding that a token was not asked again reads a count
 * that another case, asking again, holds nonzero. The cache's clock is
 * the case's own, moved by hand.
 */
import type { IdentityAnswer } from './port.js';
import type { GitHubRole, StandInGitHub } from './testdata/stand-in-github.js';

import { TRUSTED_PERMISSIONS } from '@open-tomato/rafa/store';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { identityContract } from './contract.js';
import { GITHUB_PROVIDER, openGitHubIdentity } from './github.js';
import { HUB_ACTIONS } from './port.js';
import { startStandInGitHub } from './testdata/stand-in-github.js';

/** The repository the hub is configured with. */
const REPOSITORY = 'open-tomato/rafa';

/** A repository the hub is not configured with. */
const OTHER_REPOSITORY = 'open-tomato/elsewhere';

/** `hub.auth.cacheFor` at its default, `10m`. */
const TEN_MINUTES = 600_000;

const WRITER = 'ghp_writer_token_000000000001';
const READER = 'ghp_reader_token_000000000002';
const STRANGER = 'ghp_stranger_token_0000000003';
const UNKNOWN = 'ghp_unknown_token_00000000004';

identityContract('github', () => {
  const github = startStandInGitHub({
    [WRITER]: { login: 'writer', roles: { [REPOSITORY]: 'write' } },
    [READER]: { login: 'reader', roles: { [REPOSITORY]: 'read' } },
  });
  return {
    identity: openGitHubIdentity({ repository: REPOSITORY, cacheForMs: TEN_MINUTES, apiBase: github.url }),
    served: { authorization: `Bearer ${WRITER}` },
    forbidden: { authorization: `Bearer ${READER}` },
    unrecognised: { authorization: `Bearer ${UNKNOWN}` },
    close: github.stop,
  };
});

/** The reason `answer` was refused for, or `served`. */
function outcomeOf(answer: IdentityAnswer): string {
  return answer.served
    ? 'served'
    : answer.refusal.reason;
}

/** The refusal message of `answer`, failing the case when it was served. */
function messageOf(answer: IdentityAnswer): string {
  if (answer.served) throw new Error('expected a refusal and the request was served');
  return answer.refusal.message;
}

/** A hub request carrying `token` as a bearer credential. */
function hubRequest(token: string, path = '/v1/status', headers: Readonly<Record<string, string>> = {}): Request {
  return new Request(`http://hub.test${path}`, { headers: { ...headers, authorization: `Bearer ${token}` } });
}

describe('the repository-permission identity adapter', () => {
  let github: StandInGitHub;
  let clock = 0;

  /** The adapter over the stand-in, with `cacheForMs` and the case's clock. */
  const open = (cacheForMs: number | null = TEN_MINUTES, timeoutMs?: number) => openGitHubIdentity({
    repository: REPOSITORY,
    cacheForMs,
    apiBase: github.url,
    now: () => clock,
    ...(timeoutMs === undefined
      ? {}
      : { timeoutMs }),
  });

  /** How many requests the stand-in has been sent. */
  const askedCount = (): number => github.asked().length;

  beforeEach(() => {
    clock = 1_000_000;
    github = startStandInGitHub({
      [WRITER]: { login: 'writer', roles: { [REPOSITORY]: 'write' } },
      [READER]: { login: 'reader', roles: { [REPOSITORY]: 'read' } },
      [STRANGER]: { login: 'stranger', roles: { [OTHER_REPOSITORY]: 'admin' } },
    });
  });
  afterEach(async () => {
    await github.stop();
  });

  describe('which callers it serves', () => {
    it.each([...TRUSTED_PERMISSIONS])('serves a login holding %s with every hub action', async (role) => {
      github.setAccount(WRITER, { login: `holds-${role}`, roles: { [REPOSITORY]: role } });

      const answer = await open().identify(hubRequest(WRITER));

      expect(answer).toEqual({ served: true, caller: { id: `holds-${role}`, provider: GITHUB_PROVIDER }, may: [...HUB_ACTIONS] });
    });

    it.each(['triage', 'read'] as const)('refuses a login holding %s as forbidden, naming the role', async (role: GitHubRole) => {
      github.setAccount(READER, { login: 'lesser', roles: { [REPOSITORY]: role } });

      const answer = await open().identify(hubRequest(READER));

      expect(outcomeOf(answer)).toBe('forbidden');
      expect(messageOf(answer)).toBe(`lesser holds ${role} on ${REPOSITORY}; the hub serves admin, maintain, write.`);
    });

    it('refuses a login that cannot see the repository as forbidden', async () => {
      const answer = await open().identify(hubRequest(STRANGER));

      expect(outcomeOf(answer)).toBe('forbidden');
      expect(messageOf(answer)).toBe(`stranger cannot see ${REPOSITORY} on GitHub; the hub serves admin, maintain, write.`);
    });

    it('refuses a token GitHub knows that names no user as forbidden', async () => {
      github.setAccount(WRITER, { login: 'app', roles: { [REPOSITORY]: 'write' }, userStatus: 403 });

      const answer = await open().identify(hubRequest(WRITER));

      expect(outcomeOf(answer)).toBe('forbidden');
    });

    it('refuses a token GitHub does not know as unauthenticated', async () => {
      const answer = await open().identify(hubRequest(UNKNOWN));

      expect(outcomeOf(answer)).toBe('unauthenticated');
      expect(github.asked().map((asked) => asked.path)).toEqual(['/user']);
    });

    it('accepts GitHub\'s token scheme and forwards the token as a bearer credential', async () => {
      const request = new Request('http://hub.test/v1/status', { headers: { authorization: `token ${WRITER}` } });

      const answer = await open().identify(request);

      expect(outcomeOf(answer)).toBe('served');
      expect(github.asked().map((asked) => asked.authorization)).toEqual([`Bearer ${WRITER}`, `Bearer ${WRITER}`]);
    });

    it('refuses a credential of another scheme without asking GitHub', async () => {
      const request = new Request('http://hub.test/v1/status', { headers: { authorization: `Basic ${btoa(`writer:${WRITER}`)}` } });

      const answer = await open().identify(request);

      expect(outcomeOf(answer)).toBe('unauthenticated');
      expect(askedCount()).toBe(0);
    });
  });

  describe('the repository it asks about', () => {
    it('asks GitHub about the configured repository and no other', async () => {
      await open().identify(hubRequest(WRITER));

      expect(github.asked().map((asked) => asked.path)).toEqual(['/user', `/repos/${REPOSITORY}`]);
    });

    it('checks a request naming another repository against the configured one', async () => {
      const identity = open();
      const naming = [
        hubRequest(STRANGER, `/v1/status?repository=${encodeURIComponent(OTHER_REPOSITORY)}`),
        hubRequest(STRANGER, `/v1/repos/${OTHER_REPOSITORY}/status`),
        hubRequest(STRANGER, '/v1/status', { 'x-rafa-repository': OTHER_REPOSITORY }),
      ];

      const answers = await Promise.all(naming.map((request) => identity.identify(request)));

      expect(answers.map(outcomeOf)).toEqual(['forbidden', 'forbidden', 'forbidden']);
      const repositoriesAsked = github.asked()
        .filter((asked) => asked.path !== '/user')
        .map((asked) => asked.path);
      expect(new Set(repositoriesAsked)).toEqual(new Set([`/repos/${REPOSITORY}`]));
    });

    it('serves the same stranger once it is opened on the repository the stranger administers, as the control', async () => {
      const identity = openGitHubIdentity({ repository: OTHER_REPOSITORY, cacheForMs: TEN_MINUTES, apiBase: github.url });

      const answer = await identity.identify(hubRequest(STRANGER));

      expect(outcomeOf(answer)).toBe('served');
    });
  });

  describe('the cache', () => {
    it('does not ask GitHub again about a served token within hub.auth.cacheFor', async () => {
      const identity = open();
      const first = await identity.identify(hubRequest(WRITER));
      const askedOnce = askedCount();
      clock += TEN_MINUTES - 1;

      const second = await identity.identify(hubRequest(WRITER, '/v1/effort/pull?since=%7B%7D'));

      expect(askedOnce).toBe(2);
      expect(askedCount()).toBe(askedOnce);
      expect(second).toEqual(first);
    });

    it('asks GitHub again once hub.auth.cacheFor has passed', async () => {
      const identity = open();
      await identity.identify(hubRequest(WRITER));
      github.setAccount(WRITER, { login: 'writer', roles: { [REPOSITORY]: 'read' } });
      clock += TEN_MINUTES;

      const answer = await identity.identify(hubRequest(WRITER));

      expect(askedCount()).toBe(4);
      expect(outcomeOf(answer)).toBe('forbidden');
    });

    it('serves a token whose write was withdrawn until hub.auth.cacheFor passes', async () => {
      const identity = open();
      await identity.identify(hubRequest(WRITER));
      github.setAccount(WRITER, { login: 'writer', roles: { [REPOSITORY]: 'read' } });
      clock += TEN_MINUTES / 2;

      const answer = await identity.identify(hubRequest(WRITER));

      expect(outcomeOf(answer)).toBe('served');
    });

    it('asks GitHub on every request when hub.auth.cacheFor is false', async () => {
      const identity = open(null);

      const answers = await Promise.all([1, 2, 3].map(async () => identity.identify(hubRequest(WRITER))));

      expect(answers.map(outcomeOf)).toEqual(['served', 'served', 'served']);
      expect(askedCount()).toBe(6);
    });

    it('keeps each token apart, so a served token serves no other', async () => {
      const identity = open();
      await identity.identify(hubRequest(WRITER));

      const answer = await identity.identify(hubRequest(READER));

      expect(outcomeOf(answer)).toBe('forbidden');
      expect(askedCount()).toBe(4);
    });

    it('asks GitHub again about a token it refused as forbidden, and serves it once granted write', async () => {
      const identity = open();
      const refused = await identity.identify(hubRequest(READER));
      const again = await identity.identify(hubRequest(READER));
      github.setAccount(READER, { login: 'reader', roles: { [REPOSITORY]: 'write' } });

      const granted = await identity.identify(hubRequest(READER));

      expect([refused, again, granted].map(outcomeOf)).toEqual(['forbidden', 'forbidden', 'served']);
      expect(askedCount()).toBe(6);
    });

    it('asks GitHub again about a token it refused as unauthenticated', async () => {
      const identity = open();
      await identity.identify(hubRequest(UNKNOWN));
      github.setAccount(UNKNOWN, { login: 'newcomer', roles: { [REPOSITORY]: 'maintain' } });

      const answer = await identity.identify(hubRequest(UNKNOWN));

      expect(outcomeOf(answer)).toBe('served');
      expect(askedCount()).toBe(3);
    });

    it('asks GitHub again after it did not answer, and serves the token once it does', async () => {
      const identity = open();
      github.failWith({ status: 502 });
      const during = await identity.identify(hubRequest(WRITER));
      github.failWith(null);

      const after = await identity.identify(hubRequest(WRITER));

      expect([during, after].map(outcomeOf)).toEqual(['unavailable', 'served']);
      expect(askedCount()).toBe(3);
    });
  });

  describe('when GitHub does not answer', () => {
    const failures = [
      ['a server error', { status: 500 }],
      ['a rate limit (429)', { status: 429 }],
      ['a primary rate limit (403, none remaining)', { status: 403, headers: { 'x-ratelimit-remaining': '0' } }],
      ['a secondary rate limit (403, retry-after)', { status: 403, headers: { 'retry-after': '60' } }],
      ['a body that is not JSON', { status: 200, body: '<html>maintenance</html>' }],
      ['a redirect', { status: 301, headers: { location: 'https://elsewhere.test/user' } }],
    ] as const;

    it.each(failures)('refuses as unavailable on %s, in one line naming neither token nor body', async (_label, failure) => {
      github.failWith(failure);

      const answer = await open().identify(hubRequest(WRITER));

      expect(outcomeOf(answer)).toBe('unavailable');
      const message = messageOf(answer);
      expect(message).toContain(REPOSITORY);
      expect(message).not.toContain('\n');
      expect(message).not.toContain(WRITER);
      expect(message).not.toContain('maintenance');
    });

    it('refuses as unavailable when GitHub takes longer than timeoutMs', async () => {
      github.failWith({ status: 200, delayMs: 500 });

      const answer = await open(TEN_MINUTES, 50).identify(hubRequest(WRITER));

      expect(outcomeOf(answer)).toBe('unavailable');
      expect(messageOf(answer)).toContain('no answer within 50ms');
    });

    it('refuses as unavailable when GitHub cannot be reached', async () => {
      const url = github.url;
      await github.stop();
      const identity = openGitHubIdentity({ repository: REPOSITORY, cacheForMs: TEN_MINUTES, apiBase: url });

      const answer = await identity.identify(hubRequest(WRITER));

      expect(outcomeOf(answer)).toBe('unavailable');
      expect(messageOf(answer)).toBe(`GitHub did not answer the permission check for ${REPOSITORY}: it could not be reached; try again.`);
      github = startStandInGitHub({});
    });

    it('accepts an API root written with a trailing slash', async () => {
      const identity = openGitHubIdentity({ repository: REPOSITORY, cacheForMs: TEN_MINUTES, apiBase: `${github.url}/` });

      const answer = await identity.identify(hubRequest(WRITER));

      expect(outcomeOf(answer)).toBe('served');
    });
  });
});
