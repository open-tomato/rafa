/**
 * Tests for the strict recorded `gh` fake (`src/pr/gh-fake.ts`).
 *
 * Every rule the fake enforces sits here beside a command it accepts, so
 * a refusal case cannot pass on a fake that refuses everything. The
 * answers themselves — key order, author shapes, the recorded failure
 * text — are held in `./gh-fake-shapes.test.ts`; this file holds which
 * commands exist, what each one accepts, what the repository does when
 * one arrives, and that every call is recorded. No case spawns anything.
 *
 * The strictness is the point: an adapter that sends `--delete-branch`,
 * an unmodelled `--json` field or a `gh api` path nobody recorded fails
 * the case that sent it, where a lenient fake would answer as if the
 * invocation had been checked against `gh`.
 *
 * Twelve mutations of the two modules were driven on 2026-09-18, one run
 * each over this file and `gh-fake-shapes.test.ts`, with 58 pass before
 * and after and both modules restored byte-identical (sha256), and every
 * one reddened at least one case. Ten reddened a case here and none in
 * the shapes file: an unmodelled flag ignored (four cases), a pull
 * request with no checks answered green, any `--json` field accepted,
 * pull requests listed oldest first, a `gh api` payload given a trailing
 * newline, a merge leaving the `mergeable` reading alone, another
 * repository accepted through `--repo`, a run with a dropped log answered
 * as empty, a comment PATCH leaving `updated_at` alone, and an unknown
 * login answered as a reader rather than a 404 — the last being the
 * mutation the trust stage cannot afford, since it turns a failed
 * permission lookup into a pass. The remaining two reddened the shapes
 * file alone and are recorded there.
 */
import type { FakePrGh } from './gh-fake.js';

import { describe, expect, it } from 'bun:test';

import { createFakePrGh, logFailedText } from './gh-fake.js';

/** The fields a `pr view` case asks for unless it says otherwise. */
const VIEW = ['pr', 'view', '7', '--json', 'number,state'];

/** A failure writing `stderr` and nothing to stdout. */
function failure(stderr: string): { ok: false; stdout: string; stderr: string } {
  return { ok: false, stdout: '', stderr };
}

/** A fake holding one open pull request, number 7. */
function withOnePull(): FakePrGh {
  const fake = createFakePrGh();
  fake.plant({ number: 7, title: 'a change', headRefName: 'feat/rafa-20' });
  return fake;
}

/** What a command wrote to stdout, parsed. */
async function json(fake: FakePrGh, args: readonly string[]): Promise<unknown> {
  const result = await fake.run(args);
  expect(result.ok).toBe(true);
  return JSON.parse(result.stdout);
}

describe('what the fake refuses', () => {
  it.each([
    [['pr', 'edit', '7'], 'fake gh: unhandled command pr edit 7\n'],
    [['pr', 'comment', '7', '--body', 'hi'], 'fake gh: unhandled command pr comment 7 --body hi\n'],
    [['pr', 'create', '--title', 't'], 'fake gh: unhandled command pr create --title t\n'],
    [['run', 'list'], 'fake gh: unhandled command run list\n'],
    [['auth', 'status'], 'fake gh: unhandled command auth status\n'],
  ])('refuses the command %p it does not model', async (args, stderr) => {
    expect(await createFakePrGh().run(args)).toEqual(failure(stderr));
  });

  it.each([
    [['pr', 'merge', '7', '--squash', '--delete-branch'], 'fake gh: pr merge does not model flag --delete-branch\n'],
    [['pr', 'merge', '7', '--squash', '--auto'], 'fake gh: pr merge does not model flag --auto\n'],
    [['pr', 'merge', '7', '--squash', '--admin'], 'fake gh: pr merge does not model flag --admin\n'],
    [['pr', 'list', '--json', 'number', '--author', 'octo'], 'fake gh: pr list does not model flag --author\n'],
  ])('refuses the flag %p it does not model', async (args, stderr) => {
    expect(await withOnePull().run(args)).toEqual(failure(stderr));
  });

  it('refuses a --json field it does not model, beside the read it accepts', async () => {
    const fake = withOnePull();

    expect(await fake.run(['pr', 'view', '7', '--json', 'number,reviewDecision']))
      .toEqual(failure('fake gh: does not model --json field "reviewDecision"\n'));
    expect((await fake.run(VIEW)).ok).toBe(true);
  });

  it('refuses a value flag with no argument, and a wrong count of positionals', async () => {
    const fake = withOnePull();

    expect(await fake.run(['pr', 'view', '7', '--json']))
      .toEqual(failure('fake gh: pr view --json needs an argument\n'));
    expect(await fake.run(['pr', 'view', '--json', 'number']))
      .toEqual(failure('fake gh: pr view takes 1 arguments besides its flags, and was handed 0\n'));
  });

  it('records every call it was handed, refused ones included, frozen', async () => {
    const fake = withOnePull();

    await fake.run(['pr', 'edit', '7']);
    await fake.run(VIEW);

    expect(fake.calls()).toEqual([['pr', 'edit', '7'], VIEW]);
    expect(Object.isFrozen(fake.calls()[0])).toBe(true);
  });
});

describe('which repository a command acts on', () => {
  it('accepts its own repository by name and refuses another', async () => {
    const fake = withOnePull();

    expect((await fake.run([...VIEW, '--repo', 'open-tomato/rafa'])).ok).toBe(true);
    expect(await fake.run([...VIEW, '--repo', 'cli/cli']))
      .toEqual(failure('fake gh: models one repository, open-tomato/rafa, and was handed --repo cli/cli\n'));
  });

  it('answers no git remotes found in a checkout with no remote', async () => {
    const fake = createFakePrGh({ repo: null });

    expect(await fake.run(['pr', 'list', '--json', 'number'])).toEqual(failure('no git remotes found\n'));
    expect(await fake.run(['api', 'repos/{owner}/{repo}/issues/7/comments']))
      .toEqual(failure('unable to expand placeholder in path: no git remotes found\n'));
  });

  it('refuses an api path naming another repository', async () => {
    expect(await withOnePull().run(['api', 'repos/cli/cli/issues/7/comments']))
      .toEqual(failure('fake gh: models one repository, open-tomato/rafa, and was handed repos/cli/cli/issues/7/comments\n'));
  });
});

describe('gh pr list', () => {
  it('writes open pull requests newest first, ending its output with a newline', async () => {
    const fake = createFakePrGh();
    fake.plant({ number: 3 });
    fake.plant({ number: 9 });
    fake.plant({ number: 5, state: 'MERGED' });

    const result = await fake.run(['pr', 'list', '--json', 'number', '--state', 'open']);

    expect(result.stdout.endsWith('\n')).toBe(true);
    expect(JSON.parse(result.stdout)).toEqual([{ number: 9 }, { number: 3 }]);
  });

  it('answers an empty array for a branch with no open pull request', async () => {
    const fake = withOnePull();

    expect(await json(fake, ['pr', 'list', '--json', 'number', '--head', 'feat/rafa-20']))
      .toEqual([{ number: 7 }]);
    expect(await json(fake, ['pr', 'list', '--json', 'number', '--head', 'no-such-branch']))
      .toEqual([]);
  });

  it('honours --limit and refuses a state and a limit it does not model', async () => {
    const fake = createFakePrGh();
    fake.plant({ number: 1 });
    fake.plant({ number: 2 });

    expect(await json(fake, ['pr', 'list', '--json', 'number', '--limit', '1'])).toEqual([{ number: 2 }]);
    expect(await fake.run(['pr', 'list', '--json', 'number', '--limit', '0']))
      .toEqual(failure('fake gh: does not model --limit 0\n'));
    expect(await fake.run(['pr', 'list', '--json', 'number', '--state', 'draft']))
      .toEqual(failure('fake gh: does not model --state draft\n'));
  });
});

describe('gh pr view', () => {
  it('answers the recorded GraphQL failure for a pull request that does not exist', async () => {
    expect(await createFakePrGh().run(VIEW))
      .toEqual(failure('GraphQL: Could not resolve to a PullRequest with the number of 7. (repository.pullRequest)\n'));
  });

  it('writes nothing for --web, and refuses --web beside --json', async () => {
    const fake = withOnePull();

    expect(await fake.run(['pr', 'view', '7', '--web'])).toEqual({ ok: true, stdout: '', stderr: '' });
    expect(await fake.run(['pr', 'view', '7', '--web', '--json', 'number']))
      .toEqual(failure('cannot use `--web` with `--json`\n'));
  });

  it('refuses a read with no fields at all', async () => {
    expect(await withOnePull().run(['pr', 'view', '7']))
      .toEqual(failure('fake gh: models --json alone, and was handed no fields\n'));
  });
});

describe('gh pr checks', () => {
  it('succeeds on a red pull request, as --json does, and writes every row', async () => {
    const fake = createFakePrGh();
    fake.plant({
      number: 7,
      checks: [
        { name: 'lint', state: 'FAILURE', link: 'https://example.test/lint' },
        { name: 'types', state: 'SUCCESS', link: 'https://example.test/types' },
      ],
    });

    const result = await fake.run(['pr', 'checks', '7', '--json', 'name,state,link']);

    expect(result.ok).toBe(true);
    expect(JSON.parse(result.stdout)).toEqual([
      { link: 'https://example.test/lint', name: 'lint', state: 'FAILURE' },
      { link: 'https://example.test/types', name: 'types', state: 'SUCCESS' },
    ]);
  });

  it('fails naming the branch when the pull request has no checks at all', async () => {
    expect(await withOnePull().run(['pr', 'checks', '7', '--json', 'name,state,link']))
      .toEqual(failure('no checks reported on the \'feat/rafa-20\' branch\n'));
  });
});

describe('gh pr merge', () => {
  it('merges once, leaving the recorded merged reading, and refuses the second merge', async () => {
    const fake = withOnePull();

    expect(await fake.run(['pr', 'merge', '7', '--squash'])).toEqual({ ok: true, stdout: '', stderr: '' });
    expect(fake.pull(7)).toMatchObject({ state: 'MERGED', mergeable: 'UNKNOWN', mergeStateStatus: 'UNKNOWN' });
    expect(await fake.run(['pr', 'merge', '7', '--squash']))
      .toEqual(failure('fake gh: pull request 7 is MERGED, and a merge is modelled for an open one alone\n'));
  });

  it.each([
    [['pr', 'merge', '7'], 0],
    [['pr', 'merge', '7', '--squash', '--rebase'], 2],
  ])('refuses %p, which names %p merge methods', async (args, count) => {
    expect(await withOnePull().run(args)).toEqual(failure(
      `fake gh: pr merge models exactly one of --squash, --merge and --rebase, and was handed ${String(count)}\n`,
    ));
  });

  it('fails with the refusal a case planted, leaving the pull request open', async () => {
    const fake = withOnePull();
    fake.refuseMerge(7, 'Pull request is not mergeable: the base branch policy prohibits the merge.\n');

    expect(await fake.run(['pr', 'merge', '7', '--merge']))
      .toEqual(failure('Pull request is not mergeable: the base branch policy prohibits the merge.\n'));
    expect(fake.pull(7)).toMatchObject({ state: 'OPEN' });
  });
});

describe('gh run view', () => {
  it('writes the log a case planted, and refuses a read without --log-failed', async () => {
    const fake = createFakePrGh();
    fake.plantRun('42', logFailedText('gates', ['error: types failed']));

    const result = await fake.run(['run', 'view', '42', '--log-failed']);

    expect(result.ok).toBe(true);
    expect(result.stdout).toContain('gates\tUNKNOWN STEP\t');
    expect(await fake.run(['run', 'view', '42'])).toEqual(failure('fake gh: run view models --log-failed alone\n'));
  });

  it('answers the recorded 404 for a run it holds none of, and the drop for an expired log', async () => {
    const fake = createFakePrGh();
    fake.expireRun('43');

    expect(await fake.run(['run', 'view', '42', '--log-failed'])).toEqual(failure(
      'failed to get run: HTTP 404: Not Found (https://api.github.com/repos/open-tomato/rafa/actions/runs/42?exclude_pull_requests=true)\n',
    ));
    expect(await fake.run(['run', 'view', '43', '--log-failed']))
      .toEqual(failure('failed to get run log: log not found\n'));
  });
});

describe('gh api over comments', () => {
  /** The list path for pull request 7, through the placeholder `gh` expands. */
  const LIST = 'repos/{owner}/{repo}/issues/7/comments';

  it('lists comments with no trailing newline, where every --json read ends with one', async () => {
    const fake = withOnePull();

    const result = await fake.run(['api', LIST]);

    expect(result.ok).toBe(true);
    expect(result.stdout).toBe('[]');
  });

  it('posts a comment, answers it, and reads it back off the list', async () => {
    const fake = withOnePull();

    const posted = await fake.run(['api', LIST, '-X', 'POST', '-f', 'body=first pass']);
    const listed = JSON.parse((await fake.run(['api', LIST])).stdout) as Record<string, unknown>[];

    expect(JSON.parse(posted.stdout)).toMatchObject({ id: 5000000001, body: 'first pass' });
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ id: 5000000001, body: 'first pass' });
  });

  it('edits one comment through PATCH, moving updated_at and leaving created_at', async () => {
    const stamps = ['2026-09-18T12:00:00Z', '2026-09-18T13:00:00Z'];
    let reads = 0;
    const fake = createFakePrGh({
      now: () => {
        const at = stamps[Math.min(reads, stamps.length - 1)] ?? '';
        reads += 1;
        return at;
      },
    });
    fake.plant({ number: 7 });

    await fake.run(['api', LIST, '-X', 'POST', '-f', 'body=first pass']);
    const edited = await fake.run([
      'api',
      'repos/{owner}/{repo}/issues/comments/5000000001',
      '-X',
      'PATCH',
      '-f',
      'body=second pass',
    ]);

    expect(JSON.parse(edited.stdout)).toMatchObject({
      id: 5000000001,
      body: 'second pass',
      created_at: '2026-09-18T12:00:00Z',
      updated_at: '2026-09-18T13:00:00Z',
    });
    expect(fake.pull(7)?.comments).toHaveLength(1);
  });

  it('answers a 404 for a pull request and for a comment it holds none of', async () => {
    const fake = withOnePull();

    const missingPull = await fake.run(['api', 'repos/{owner}/{repo}/issues/9/comments']);
    const missingComment = await fake.run([
      'api',
      'repos/{owner}/{repo}/issues/comments/1',
      '-X',
      'PATCH',
      '-f',
      'body=x',
    ]);

    expect(missingPull.ok).toBe(false);
    expect(missingPull.stderr).toBe('gh: Not Found (HTTP 404)\n');
    expect(JSON.parse(missingPull.stdout)).toMatchObject({ message: 'Not Found', status: '404' });
    expect(missingComment.stderr).toBe('gh: Not Found (HTTP 404)\n');
  });

  it.each([
    [['-X', 'DELETE'], 'fake gh: issue comments model GET and POST alone, and were handed DELETE\n'],
    [['-X', 'POST'], 'fake gh: a comment POST models -f body=<text>\n'],
  ])('refuses the comment write %p', async (flags, stderr) => {
    expect(await withOnePull().run(['api', LIST, ...flags])).toEqual(failure(stderr));
  });

  it('refuses a path it does not model', async () => {
    expect(await withOnePull().run(['api', 'graphql', '-f', 'query=pullRequest'])).toEqual(failure(
      'fake gh: api models the issue comment and collaborator permission paths alone, and was handed graphql\n',
    ));
  });
});

describe('gh api over a collaborator permission', () => {
  it('answers the permission a case planted', async () => {
    const fake = createFakePrGh();
    fake.plantPermission('octo', 'write');

    const payload = await json(fake, ['api', 'repos/{owner}/{repo}/collaborators/octo/permission']);

    expect(payload).toEqual({ permission: 'write', role_name: 'write', user: { login: 'octo', type: 'User' } });
  });

  it('answers the recorded 404 for a login that is no account, so a lookup failure is never a pass', async () => {
    const result = await createFakePrGh().run(['api', 'repos/{owner}/{repo}/collaborators/nobody/permission']);

    expect(result.ok).toBe(false);
    expect(result.stderr).toBe('gh: nobody is not a user (HTTP 404)\n');
    expect(JSON.parse(result.stdout)).toMatchObject({ message: 'nobody is not a user', status: '404' });
  });

  it('refuses a write against the permission path', async () => {
    expect(await createFakePrGh().run(['api', 'repos/{owner}/{repo}/collaborators/octo/permission', '-X', 'PUT']))
      .toEqual(failure('fake gh: a permission is modelled for GET alone, and was handed PUT\n'));
  });
});

describe('what a case can plant and read back', () => {
  it('reads a planted pull request back and replaces it through update', async () => {
    const fake = withOnePull();

    fake.update(7, (pull) => ({ ...pull, mergeable: 'CONFLICTING', mergeStateStatus: 'DIRTY' }));

    expect(await json(fake, ['pr', 'view', '7', '--json', 'mergeable,mergeStateStatus']))
      .toEqual({ mergeStateStatus: 'DIRTY', mergeable: 'CONFLICTING' });
    expect(fake.pull(9)).toBeUndefined();
  });

  it('throws when a case updates a pull request it never planted', () => {
    expect(() => createFakePrGh().update(7, (pull) => pull))
      .toThrow('fake gh: holds no pull request 7');
  });
});
