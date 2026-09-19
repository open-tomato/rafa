/**
 * Tests for `triage-trust.ts`: which marker comment a triage may read,
 * which one it passes over, and the pull request `--resolve` is refused
 * over.
 *
 * `src/board/trust.test.ts` measures the trust reading itself — the
 * permission lookup, the allow-list and the failed lookup that is a
 * refusal. These cases measure what the triage command DOES with it,
 * over comment lists built here from literals, so every reading is a
 * consequence of one input rather than of a provider's mood.
 *
 * Nothing here spawns or reaches GitHub: the permission lookup is a
 * seam answering literals, and it counts the logins it was asked about,
 * so "one lookup per login" and "the allow-list spends none" are
 * measured rather than assumed. The control that the check could have
 * failed is the pair each case comes in: the same comment list read
 * once with the author trusted and once with them not.
 */
import type { PermissionReading, Permissions } from '../../board/trust.js';
import type { PullRequestComment } from '../../pr/index.js';

import { describe, expect, it } from 'bun:test';

import { CommandExit } from '../../cli/command.js';
import { TRIAGE_MARKER } from '../../pr/triage/comment.js';

import {
  ghPermissionsIn,
  ignoredCommentMessage,
  readTrustedTriageComment,
  repoLabel,
  requireTrustedResolveAuthor,
  TRIAGE_COMMENT_NAME,
  UNNAMED_REPO,
} from './triage-trust.js';

/** The repository every sentence in this file names. */
const REPO = 'open-tomato/rafa';

/** A permission seam answering one permission per login, counting what it was asked. */
function permissionsFor(by: Readonly<Record<string, string>>): {
  permissions: Permissions;
  asked: () => readonly string[];
} {
  let asked: readonly string[] = [];
  return {
    permissions: (login: string): Promise<PermissionReading> => {
      asked = [...asked, login];
      const permission = by[login];
      return Promise.resolve(permission === undefined
        ? { login, permission: null, roleName: null, detail: `${login} is not a user (HTTP 404)` }
        : { login, permission, roleName: permission, detail: '' });
    },
    asked: () => asked,
  };
}

/** What the trust of one case is read through. */
function trustWith(
  by: Readonly<Record<string, string>>,
  trustedAuthors: readonly string[] = [],
): { trust: { permissions: Permissions; trustedAuthors: readonly string[]; repo: string }; asked: () => readonly string[] } {
  const lookup = permissionsFor(by);
  return {
    trust: { permissions: lookup.permissions, trustedAuthors, repo: REPO },
    asked: lookup.asked,
  };
}

/** One comment, carrying the marker unless `marked` says otherwise. */
function comment(id: string, login: string, marked = true): PullRequestComment {
  return {
    id,
    author: { login, isBot: false },
    url: `https://github.com/${REPO}/pull/41#issuecomment-${id}`,
    body: marked
      ? `${TRIAGE_MARKER}\n**rafa triage**: \`ci-lint\`, simple, not resolved`
      : 'Nice one.',
    createdAt: '2026-09-19T09:00:00Z',
    updatedAt: '2026-09-19T09:00:00Z',
  };
}

/** A pull request as the refusal reads it: its number and its author. */
function pull(login: string): { author: { login: string; isBot: boolean }; number: number } {
  return { author: { login, isBot: false }, number: 41 };
}

describe('the repository a sentence names', () => {
  it('takes owner/name out of the pull request URL, whatever the remote says', () => {
    expect(repoLabel('https://github.com/open-tomato/rafa/pull/41', 'git@github.com:someone/else.git'))
      .toBe('open-tomato/rafa');
    expect(repoLabel('https://ghe.example.com/team/tool/pull/7', null)).toBe('team/tool');
  });

  it('falls back to the normalised origin, and says so when there is neither', () => {
    expect(repoLabel('', 'git@github.com:open-tomato/rafa.git')).toBe('github.com/open-tomato/rafa');
    expect(repoLabel('not a url', null)).toBe(UNNAMED_REPO);
    expect(repoLabel('', '   ')).toBe(UNNAMED_REPO);
  });
});

describe('the marker comment a triage may read', () => {
  it('answers the newest marker comment when its author holds write access, spending one lookup', async () => {
    const { trust, asked } = trustWith({ 'rafa-bot': 'write' });

    const found = await readTrustedTriageComment(
      [comment('1', 'someone', false), comment('2', 'rafa-bot')],
      trust,
    );

    expect(found.comment?.id).toBe('2');
    expect(found.ignored).toEqual([]);
    expect(asked()).toEqual(['rafa-bot']);
  });

  it('passes over a planted comment and answers the trusted one under it', async () => {
    const { trust } = trustWith({ 'rafa-bot': 'admin', stranger: 'read' });

    const found = await readTrustedTriageComment(
      [comment('1', 'rafa-bot'), comment('2', 'stranger')],
      trust,
    );

    expect(found.comment?.id).toBe('1');
    expect(found.ignored.map((one) => one.author)).toEqual(['stranger']);
    expect(found.ignored[0]?.reason).toBe(
      `the ${TRIAGE_COMMENT_NAME} comment https://github.com/${REPO}/pull/41#issuecomment-2`
        + ` was written by stranger, who has no write access to ${REPO};`
        + ' it was ignored and nothing in it was read',
    );
  });

  it('answers no comment at all when every marker comment is untrusted', async () => {
    const { trust } = trustWith({ 'rafa-bot': 'admin' });

    const found = await readTrustedTriageComment(
      [comment('1', 'stranger'), comment('2', 'other')],
      trust,
    );

    expect(found.comment).toBeNull();
    expect(found.ignored.map((one) => one.id)).toEqual(['2', '1']);
  });

  it('ignores a comment whose lookup failed, and says the access could not be read', async () => {
    const { trust } = trustWith({});

    const found = await readTrustedTriageComment([comment('1', 'octocat')], trust);

    expect(found.comment).toBeNull();
    expect(found.ignored[0]?.reason).toContain(`whose write access to ${REPO} could not be read`);
    expect(found.ignored[0]?.reason).toContain('octocat is not a user (HTTP 404)');
  });

  it('honours board.trustedAuthors, case-folded, and spends no lookup on a listed author', async () => {
    const { trust, asked } = trustWith({}, ['Rafa-Bot']);

    const found = await readTrustedTriageComment([comment('1', 'rafa-bot')], trust);

    expect(found.comment?.id).toBe('1');
    expect(asked()).toEqual([]);
  });

  it('reads one permission per login, however many comments that login wrote', async () => {
    const { trust, asked } = trustWith({ 'rafa-bot': 'write' });

    const found = await readTrustedTriageComment(
      [comment('1', 'stranger'), comment('2', 'stranger'), comment('3', 'stranger')],
      trust,
    );

    expect(found.comment).toBeNull();
    expect(found.ignored).toHaveLength(3);
    expect(asked()).toEqual(['stranger']);
  });

  it('reads nothing at all from a list carrying no marker comment', async () => {
    const { trust, asked } = trustWith({ 'rafa-bot': 'write' });

    const found = await readTrustedTriageComment([comment('1', 'rafa-bot', false)], trust);

    expect(found).toEqual({ comment: null, ignored: [] });
    expect(asked()).toEqual([]);
  });
});

describe('the sentence one ignored comment is reported with', () => {
  it('refuses to spell a refusal for a trusted reading', () => {
    const reading = { login: 'octocat', trusted: true, source: 'permission', refusal: null, permission: null } as const;

    expect(() => ignoredCommentMessage(comment('1', 'octocat'), reading, REPO)).toThrow(TypeError);
  });
});

describe('the pull request --resolve acts on', () => {
  it('lets a write-holder through, and answers what said so', async () => {
    const { trust } = trustWith({ octocat: 'maintain' });

    const reading = await requireTrustedResolveAuthor(pull('octocat'), trust);

    expect(reading.trusted).toBe(true);
    expect(reading.source).toBe('permission');
  });

  it('refuses an outsider with exit 2 and the spec sentence', async () => {
    const { trust } = trustWith({ octocat: 'read' });

    const refusal = await requireTrustedResolveAuthor(pull('octocat'), trust).catch((error: unknown) => error);

    expect(refusal).toBeInstanceOf(CommandExit);
    expect((refusal as CommandExit).exitCode).toBe(2);
    expect((refusal as CommandExit).message).toBe(
      `pull request #41 was opened by octocat, who has no write access to ${REPO};`
        + ' a member must open the pull request',
    );
  });

  it('refuses a lookup that failed rather than passing it', async () => {
    const { trust } = trustWith({});

    const refusal = await requireTrustedResolveAuthor(pull('octocat'), trust).catch((error: unknown) => error);

    expect((refusal as CommandExit).exitCode).toBe(2);
    expect((refusal as CommandExit).message).toContain('could not be read');
  });

  it('lets dependabot through with no lookup, and an author the config lists', async () => {
    const bot = trustWith({});
    const listed = trustWith({}, ['hubot']);

    const botReading = await requireTrustedResolveAuthor(pull('dependabot[bot]'), bot.trust);
    const listedReading = await requireTrustedResolveAuthor(pull('hubot'), listed.trust);

    expect(botReading.source).toBe('allow-list');
    expect(listedReading.source).toBe('allow-list');
    expect([...bot.asked(), ...listed.asked()]).toEqual([]);
  });
});

describe('the gh lookup the command runs with', () => {
  it('is made for a root, and is a function the caller can hand over', () => {
    expect(typeof ghPermissionsIn('/nowhere')).toBe('function');
  });
});
