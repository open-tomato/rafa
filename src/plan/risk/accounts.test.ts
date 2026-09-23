/**
 * Tests for the accounts reader. Every git and `gh` answer is planted
 * through the two seams, and each stub records the argv it was asked,
 * so "gh was not asked" is read off the record rather than inferred.
 */

import type { AccountFinding, AccountSettings, AccountSubject } from './accounts.js';
import type { GhRunner } from '../../adapters/tracker/github.js';
import type { GitRunner } from '../../pr/git.js';

import { describe, expect, it } from 'bun:test';

import { readAccounts, redactRemote, repoSlug, trackerChain } from './accounts.js';

const SSH_ORIGIN = 'git@github.com:open-tomato/rafa.git';

const DEFAULTS: AccountSettings = {
  prProvider: null,
  trackerDefault: 'github',
  trackerFallback: ['local'],
};

interface World {
  readonly git: GitRunner;
  readonly gh: GhRunner;
  readonly gitCalls: string[];
  readonly ghCalls: string[];
}

/** A world whose `origin` has `fetch` and `push` URLs (null: no origin). */
function world(
  urls: { fetch: string | null; push?: string | null },
  ghAnswers: Record<string, { ok: boolean; stdout?: string; stderr?: string }> = {},
): World {
  const gitCalls: string[] = [];
  const ghCalls: string[] = [];
  const push = urls.push === undefined
    ? urls.fetch
    : urls.push;
  const git: GitRunner = (args) => {
    gitCalls.push(args.join(' '));
    const url = args.includes('--push')
      ? push
      : urls.fetch;
    return url === null
      ? { ok: false, stdout: '', stderr: 'error: No such remote \'origin\'\n' }
      : { ok: true, stdout: `${url}\n`, stderr: '' };
  };
  const gh: GhRunner = (args) => {
    const line = args.join(' ');
    ghCalls.push(line);
    const answer = ghAnswers[line] ?? { ok: false, stderr: `unplanted: ${line}` };
    return Promise.resolve({ ok: answer.ok, stdout: answer.stdout ?? '', stderr: answer.stderr ?? '' });
  };
  return { git, gh, gitCalls, ghCalls };
}

const VIEW_OWN = 'repo view --json nameWithOwner,visibility';
const VIEW_RAFA = 'repo view github.com/open-tomato/rafa --json nameWithOwner,visibility';
const RAFA_PUBLIC = { ok: true, stdout: '{"nameWithOwner":"open-tomato/rafa","visibility":"PUBLIC"}\n' };

function textOf(findings: readonly AccountFinding[], subject: AccountSubject): string | undefined {
  return findings.find((f) => f.subject === subject)?.text;
}

describe('readAccounts', () => {
  it('reports four notes of kind account, in order, over a public GitHub origin', async () => {
    const w = world({ fetch: SSH_ORIGIN }, { [VIEW_OWN]: RAFA_PUBLIC, [VIEW_RAFA]: RAFA_PUBLIC });

    const findings = await readAccounts(DEFAULTS, w);

    expect(findings.map((f) => [f.level, f.kind, f.subject])).toEqual([
      ['note', 'account', 'push-remote'],
      ['note', 'account', 'visibility'],
      ['note', 'account', 'issue-tracker'],
      ['note', 'account', 'pr-provider'],
    ]);
    expect(findings.map((f) => f.text)).toEqual([
      `push remote: origin → ${SSH_ORIGIN}`,
      'visibility: open-tomato/rafa is public',
      'issue tracker: github, falling back to local; github files on open-tomato/rafa',
      'pull request provider: gh (inferred from origin), opening pull requests on open-tomato/rafa',
    ]);
  });

  it('reads the push URL with --push, so a pushurl is the remote reported', async () => {
    const w = world(
      { fetch: SSH_ORIGIN, push: 'git@gitlab.com:someone/mirror.git' },
      { [VIEW_OWN]: RAFA_PUBLIC },
    );

    const findings = await readAccounts(DEFAULTS, w);

    expect(w.gitCalls).toContain('remote get-url --push origin');
    expect(textOf(findings, 'push-remote')).toBe('push remote: origin → git@gitlab.com:someone/mirror.git');
    expect(textOf(findings, 'visibility')).toBe('visibility: not read, gitlab.com is not a GitHub host');
    // the provider is still inferred from the fetch URL, which is GitHub
    expect(textOf(findings, 'pr-provider')).toStartWith('pull request provider: gh (inferred from origin)');
  });

  it('reports a private repository as private', async () => {
    const w = world({ fetch: SSH_ORIGIN }, {
      [VIEW_OWN]: RAFA_PUBLIC,
      [VIEW_RAFA]: { ok: true, stdout: '{"nameWithOwner":"open-tomato/rafa","visibility":"PRIVATE"}' },
    });

    expect(textOf(await readAccounts(DEFAULTS, w), 'visibility')).toBe('visibility: open-tomato/rafa is private');
  });

  it('says the visibility was not read when gh fails, naming its first stderr line', async () => {
    const w = world({ fetch: SSH_ORIGIN }, {
      [VIEW_RAFA]: { ok: false, stderr: '\nGraphQL: Could not resolve to a Repository\nmore\n' },
    });

    const findings = await readAccounts(DEFAULTS, w);

    expect(textOf(findings, 'visibility'))
      .toBe('visibility: not read, gh repo view: GraphQL: Could not resolve to a Repository');
    expect(textOf(findings, 'issue-tracker'))
      .toBe('issue tracker: github, falling back to local; github files on the repository gh resolves, '
        + `which it could not: gh repo view: unplanted: ${VIEW_OWN}`);
  });

  it('never guesses a visibility gh did not name', async () => {
    const w = world({ fetch: SSH_ORIGIN }, {
      [VIEW_OWN]: RAFA_PUBLIC,
      [VIEW_RAFA]: { ok: true, stdout: '{"nameWithOwner":"open-tomato/rafa"}' },
    });

    expect(textOf(await readAccounts(DEFAULTS, w), 'visibility'))
      .toBe('visibility: not read, gh named no visibility for open-tomato/rafa');
  });

  it('reads an answer that is not a JSON object as a failed view', async () => {
    const w = world({ fetch: SSH_ORIGIN }, { [VIEW_OWN]: RAFA_PUBLIC, [VIEW_RAFA]: { ok: true, stdout: '[1]' } });

    expect(textOf(await readAccounts(DEFAULTS, w), 'visibility'))
      .toBe('visibility: not read, gh repo view: answered no JSON object');
  });

  it('says the push would fail with no origin, and asks gh nothing about visibility', async () => {
    const w = world({ fetch: null }, {});

    const findings = await readAccounts({ ...DEFAULTS, trackerDefault: 'local', trackerFallback: [] }, w);

    expect(findings.map((f) => f.text)).toEqual([
      'push remote: no origin remote, so the loop\'s push would fail',
      'visibility: not read, there is no push remote',
      'issue tracker: local',
      'pull request provider: none (inferred from origin), so the loop pushes and opens no pull request',
    ]);
    expect(w.ghCalls).toEqual([]);
  });

  it('asks gh nothing for a non-GitHub origin with a local tracker and no provider', async () => {
    const w = world({ fetch: 'https://gitlab.com/o/r.git' });

    const findings = await readAccounts({ ...DEFAULTS, trackerDefault: 'local', trackerFallback: ['local'] }, w);

    expect(w.ghCalls).toEqual([]);
    expect(textOf(findings, 'visibility')).toBe('visibility: not read, gitlab.com is not a GitHub host');
    expect(textOf(findings, 'issue-tracker')).toBe('issue tracker: local');
  });

  it('says a filesystem remote is not a GitHub host', async () => {
    const w = world({ fetch: '/srv/git/rafa.git' });

    expect(textOf(await readAccounts({ ...DEFAULTS, trackerDefault: 'local' }, w), 'visibility'))
      .toBe('visibility: not read, a local path is not a GitHub host');
  });

  it('reports a provider the config set as set in the config', async () => {
    const w = world({ fetch: SSH_ORIGIN }, { [VIEW_OWN]: RAFA_PUBLIC, [VIEW_RAFA]: RAFA_PUBLIC });

    const findings = await readAccounts({ ...DEFAULTS, prProvider: 'none' }, w);

    expect(textOf(findings, 'pr-provider'))
      .toBe('pull request provider: none (set in the config), so the loop pushes and opens no pull request');
  });

  it('never prints a credential a remote URL carries', async () => {
    const secretUrl = 'https://x-access-token:ghp_planted123@github.com/open-tomato/rafa.git';
    const w = world({ fetch: secretUrl }, { [VIEW_OWN]: RAFA_PUBLIC, [VIEW_RAFA]: RAFA_PUBLIC });

    const findings = await readAccounts(DEFAULTS, w);

    // control: the reading did see this remote, and asked gh about it
    expect(textOf(findings, 'push-remote')).toBe('push remote: origin → https://***@github.com/open-tomato/rafa.git');
    expect(w.ghCalls).toContain(VIEW_RAFA);
    expect(JSON.stringify(findings)).not.toContain('ghp_planted123');
  });
});

describe('redactRemote', () => {
  it.each([
    ['https://user:pw@github.com/o/r', 'https://***@github.com/o/r'],
    ['https://ghp_x@github.com/o/r', 'https://***@github.com/o/r'],
    ['ssh://git@ssh.github.com:443/o/r', 'ssh://***@ssh.github.com:443/o/r'],
    ['git@github.com:o/r.git', 'git@github.com:o/r.git'],
    ['https://github.com/o/r', 'https://github.com/o/r'],
    ['/srv/a@b/r.git', '/srv/a@b/r.git'],
  ])('writes %s as %s', (url, redacted) => {
    expect(redactRemote(url)).toBe(redacted);
  });
});

describe('repoSlug', () => {
  it.each([
    [SSH_ORIGIN, 'github.com/open-tomato/rafa'],
    ['https://github.com/Open-Tomato/Rafa.git', 'github.com/open-tomato/rafa'],
    ['ssh://git@ssh.github.com:443/o/r', 'github.com/o/r'],
    ['https://github.com:8443/o/r', 'github.com/o/r'],
  ])('reads %s as %s', (url, slug) => {
    expect(repoSlug(url)).toBe(slug);
  });
});

describe('trackerChain', () => {
  it('keeps a kind named twice at its first place', () => {
    expect(trackerChain({ prProvider: null, trackerDefault: 'local', trackerFallback: ['github', 'local'] }))
      .toEqual(['local', 'github']);
  });
});
