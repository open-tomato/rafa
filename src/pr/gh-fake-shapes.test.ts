/**
 * Tests for the recorded answer shapes (`src/pr/gh-fake-shapes.ts`).
 *
 * The fake proves what a `src/pr/` case claims only as far as it answers
 * as `gh` does, so every reading the module note lists is held here as it
 * was recorded on 2026-09-18 off `gh` 2.100.0. A shape that drifts from
 * its recording reddens a case in this file rather than passing quietly
 * and taking the adapter built on it with it.
 *
 * The command surface over these shapes — which commands exist, what each
 * accepts, and what the repository does — is `./gh-fake.test.ts`, whose
 * note records the twelve-mutation drive both files were held to on
 * 2026-09-18. Two of those twelve reddened a case here and none there: a
 * bot author written with `id` and `name`, which reddens the author case,
 * and the `--json` fields left unsorted, which reddens both the pull
 * request and the check row.
 */
import type { FakePrCheck, FakePrComment, FakePullRequest } from './gh-fake-shapes.js';

import { describe, expect, it } from 'bun:test';

import {
  fillSeed,
  logFailedText,
  missingPull,
  missingRun,
  noChecksReported,
  notFound,
  renderCheckRow,
  renderPermission,
  renderPull,
  renderRestComment,
} from './gh-fake-shapes.js';

/** The repository every case here renders against. */
const REPO = 'open-tomato/rafa';

/** A check row, with whatever it is not the default of. */
function check(over: Partial<FakePrCheck> = {}): FakePrCheck {
  return { name: 'lint', state: 'SUCCESS', link: 'https://example.test/1', ...over };
}

/** A comment, with whatever it is not the default of. */
function comment(over: Partial<FakePrComment> = {}): FakePrComment {
  return {
    id: 5000000001,
    author: { login: 'octo', isBot: false, name: 'Octo Cat' },
    body: 'a comment',
    createdAt: '2026-09-18T11:00:00Z',
    updatedAt: '2026-09-18T11:00:00Z',
    ...over,
  };
}

/** A pull request, with whatever it is not the default of. */
function pull(over: Partial<FakePullRequest> = {}): FakePullRequest {
  return { ...fillSeed({ number: 7 }), ...over };
}

describe('the pull request a --json read answers', () => {
  it('writes exactly the fields asked for, with mergeStateStatus ahead of mergeable', () => {
    const rendered = renderPull(pull(), ['url', 'mergeable', 'number', 'mergeStateStatus'], REPO);

    expect(Object.keys(rendered)).toEqual(['mergeStateStatus', 'mergeable', 'number', 'url']);
    expect(rendered).toEqual({
      mergeStateStatus: 'CLEAN',
      mergeable: 'MERGEABLE',
      number: 7,
      url: 'https://github.com/open-tomato/rafa/pull/7',
    });
  });

  it('writes a person as id, is_bot, login and name, and a bot as is_bot and login alone', () => {
    const person = renderPull(pull(), ['author'], REPO)['author'];
    const bot = renderPull(
      pull({ author: { login: 'app/dependabot', isBot: true } }),
      ['author'],
      REPO,
    )['author'];

    expect(Object.keys(person as object)).toEqual(['id', 'is_bot', 'login', 'name']);
    expect(person).toMatchObject({ is_bot: false, login: 'octo', name: 'Octo Cat' });
    expect(Object.keys(bot as object)).toEqual(['is_bot', 'login']);
    expect(bot).toEqual({ is_bot: true, login: 'app/dependabot' });
  });

  it('writes a label as id, name, description and color, in that order', () => {
    const labels = renderPull(pull({ labels: ['dependencies'] }), ['labels'], REPO)['labels'];
    const [first] = labels as Record<string, unknown>[];

    expect(Object.keys(first ?? {})).toEqual(['id', 'name', 'description', 'color']);
    expect(first).toMatchObject({ name: 'dependencies', description: '', color: 'ededed' });
  });

  it('writes a finished CheckRun with its conclusion and a completed status', () => {
    const rollup = renderPull(
      pull({ checks: [check({ state: 'FAILURE', workflowName: 'gates' })] }),
      ['statusCheckRollup'],
      REPO,
    )['statusCheckRollup'];
    const [entry] = rollup as Record<string, unknown>[];

    expect(Object.keys(entry ?? {})).toEqual([
      '__typename',
      'completedAt',
      'conclusion',
      'detailsUrl',
      'name',
      'startedAt',
      'status',
      'workflowName',
    ]);
    expect(entry).toMatchObject({
      __typename: 'CheckRun',
      completedAt: '2026-09-18T11:00:00Z',
      conclusion: 'FAILURE',
      status: 'COMPLETED',
      workflowName: 'gates',
    });
  });

  it('writes a running CheckRun with an empty conclusion and the year-zero completedAt', () => {
    const rollup = renderPull(
      pull({ checks: [check({ state: 'IN_PROGRESS' })] }),
      ['statusCheckRollup'],
      REPO,
    )['statusCheckRollup'];

    expect((rollup as Record<string, unknown>[])[0]).toMatchObject({
      __typename: 'CheckRun',
      completedAt: '0001-01-01T00:00:00Z',
      conclusion: '',
      status: 'IN_PROGRESS',
    });
  });

  it('writes a StatusContext with context, state and targetUrl, and no name or conclusion', () => {
    const rollup = renderPull(
      pull({ checks: [check({ name: 'buildkite/bun', state: 'PENDING', kind: 'status-context' })] }),
      ['statusCheckRollup'],
      REPO,
    )['statusCheckRollup'];
    const [entry] = rollup as Record<string, unknown>[];

    expect(Object.keys(entry ?? {})).toEqual(['__typename', 'context', 'startedAt', 'state', 'targetUrl']);
    expect(entry).toMatchObject({
      __typename: 'StatusContext',
      context: 'buildkite/bun',
      state: 'PENDING',
      targetUrl: 'https://example.test/1',
    });
    expect(entry).not.toHaveProperty('name');
    expect(entry).not.toHaveProperty('conclusion');
  });

  it('writes an embedded comment with createdAt, no updatedAt, and a login-only author', () => {
    const comments = renderPull(pull({ comments: [comment()] }), ['comments'], REPO)['comments'];
    const [entry] = comments as Record<string, unknown>[];

    expect(entry).toMatchObject({
      author: { login: 'octo' },
      authorAssociation: 'MEMBER',
      body: 'a comment',
      createdAt: '2026-09-18T11:00:00Z',
      url: 'https://github.com/open-tomato/rafa/pull/7#issuecomment-5000000001',
    });
    expect(entry).not.toHaveProperty('updatedAt');
  });
});

describe('the check row a gh pr checks read answers', () => {
  it('writes the fields asked for in link, name, state order', () => {
    const row = renderCheckRow(check({ state: 'FAILURE' }), ['state', 'name', 'link']);

    expect(Object.keys(row)).toEqual(['link', 'name', 'state']);
    expect(row).toEqual({ link: 'https://example.test/1', name: 'lint', state: 'FAILURE' });
  });
});

describe('the payloads gh api answers', () => {
  it('writes a comment with its REST id, its html_url and a User type', () => {
    const rendered = renderRestComment(comment(), pull(), REPO);

    expect(rendered).toMatchObject({
      url: 'https://api.github.com/repos/open-tomato/rafa/issues/comments/5000000001',
      html_url: 'https://github.com/open-tomato/rafa/pull/7#issuecomment-5000000001',
      issue_url: 'https://api.github.com/repos/open-tomato/rafa/issues/7',
      id: 5000000001,
      user: { login: 'octo', type: 'User' },
      created_at: '2026-09-18T11:00:00Z',
      updated_at: '2026-09-18T11:00:00Z',
      author_association: 'MEMBER',
      body: 'a comment',
    });
  });

  it('writes a bot comment author as type Bot', () => {
    const rendered = renderRestComment(
      comment({ author: { login: 'app/dependabot', isBot: true } }),
      pull(),
      REPO,
    );

    expect(rendered['user']).toEqual({ login: 'app/dependabot', type: 'Bot' });
  });

  it('writes a permission as permission, role_name and user', () => {
    expect(renderPermission('octo', 'admin')).toEqual({
      permission: 'admin',
      role_name: 'admin',
      user: { login: 'octo', type: 'User' },
    });
  });

  it('writes a 404 body to stdout and the gh line to stderr', () => {
    const result = notFound('octo is not a user', 'https://docs.github.com/x');

    expect(result.ok).toBe(false);
    expect(result.stderr).toBe('gh: octo is not a user (HTTP 404)\n');
    expect(JSON.parse(result.stdout)).toEqual({
      message: 'octo is not a user',
      documentation_url: 'https://docs.github.com/x',
      status: '404',
    });
  });
});

describe('the failures gh writes', () => {
  it('names a pull request that does not exist the way GraphQL does', () => {
    expect(missingPull('999999')).toEqual({
      ok: false,
      stdout: '',
      stderr: 'GraphQL: Could not resolve to a PullRequest with the number of 999999. (repository.pullRequest)\n',
    });
  });

  it('names the branch when a pull request has no checks at all', () => {
    expect(noChecksReported('gh-pr')).toEqual({
      ok: false,
      stdout: '',
      stderr: 'no checks reported on the \'gh-pr\' branch\n',
    });
  });

  it('names the api url when a run does not exist', () => {
    expect(missingRun(REPO, '1').stderr).toBe(
      'failed to get run: HTTP 404: Not Found (https://api.github.com/repos/open-tomato/rafa/actions/runs/1?exclude_pull_requests=true)\n',
    );
  });
});

describe('the log a failed run answers', () => {
  it('writes one tab-separated line per log line, with UNKNOWN STEP as the step', () => {
    const text = logFailedText('lint', ['error: one', 'error: two'], '2026-09-18T11:30:00Z');

    expect(text.split('\n').filter((line) => line !== '')).toEqual([
      'lint\tUNKNOWN STEP\t2026-09-18T11:30:00Z error: one',
      'lint\tUNKNOWN STEP\t2026-09-18T11:30:00Z error: two',
    ]);
  });
});

describe('the pull request a seed fills out', () => {
  it('keeps what the seed names and defaults the rest', () => {
    expect(fillSeed({ number: 21, title: 'rafa-20: pr commands', state: 'MERGED' })).toEqual({
      number: 21,
      title: 'rafa-20: pr commands',
      body: '',
      author: { login: 'octo', isBot: false, name: 'Octo Cat' },
      headRefName: 'feat/pr-21',
      headRefOid: '0000000000000000000000000000000000000021',
      baseRefName: 'main',
      isCrossRepository: false,
      state: 'MERGED',
      mergeable: 'MERGEABLE',
      mergeStateStatus: 'CLEAN',
      labels: [],
      updatedAt: '2026-09-18T11:00:00Z',
      checks: [],
      comments: [],
    });
  });
});
